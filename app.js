/**
 * BPL ULTIMATE - FINAL FULL SYSTEM (FIXED LIMITS & EJS ERRORS)
 */
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo').default ; // .default kaldırıldı, yeni sürümle uyumlu
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');

const User = require('./models/User');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// --- GLOBAL DEĞİŞKENLER ---
const onlineUsers = new Map();
let arenaQueue = [];
let chatHistory = [];

const BOTS = [
    { nickname: "Aslan_Bot", animal: "Lion", power: 45 },
    { nickname: "Kurt_Bot", animal: "Wolf", power: 35 },
    { nickname: "Goril_Bot", animal: "Gorilla", power: 55 },
    { nickname: "Rhino_Bot", animal: "Rhino", power: 57 }
];

function addToHistory(sender, text) {
    const msg = { sender, text, time: Date.now() };
    chatHistory.push(msg);
    if (chatHistory.length > 50) chatHistory.shift();
}

// --- 1. VERİTABANI VE SESSION ---
const MONGO_URI = process.env.MONGO_URI;
const SESSION_SECRET = process.env.SESSION_SECRET || 'bpl_ultimate_megasecret_2024';

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Bağlantısı Başarılı'))
    .catch(err => console.error('❌ MongoDB Hatası:', err));

app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionMiddleware = session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: MONGO_URI, ttl: 24 * 60 * 60 }),
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
});
app.use(sessionMiddleware);

io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
});

// --- 2. KULLANICI KONTROLÜ ---
app.use(async (req, res, next) => {
    res.locals.user = null;
    if (req.session && req.session.userId) {
        try {
            const user = await User.findById(req.session.userId);
            if (user) res.locals.user = user;
        } catch (e) { console.error("Session Hatası:", e); }
    }
    next();
});

const authRequired = (req, res, next) => {
    if (req.session && req.session.userId) return next();
    res.redirect('/');
};

// --- 3. ANA ROTALAR ---
app.get('/', (req, res) => {
    if (req.session.userId) return res.redirect('/profil');
    res.render('index', { title: 'BPL Ultimate' });
});

app.post('/register', async (req, res) => {
    const { nickname, email, password } = req.body;
    try {
        const existing = await User.findOne({ $or: [{ email: email.toLowerCase() }, { nickname: nickname.trim() }] });
        if (existing) return res.status(400).send("Bu bilgiler kullanımda.");

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({
            nickname: nickname.trim(),
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            bpl: 2500,
            inventory: [],
            selectedAnimal: "none"
        });

        const savedUser = await newUser.save();
        req.session.userId = savedUser._id;
        res.redirect('/profil');
    } catch (err) { res.status(500).send("Kayıt hatası."); }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email: email.toLowerCase().trim() });
        if (user && await bcrypt.compare(password, user.password)) {
            req.session.userId = user._id;
            req.session.user = user;
            return res.redirect('/profil');
        }
        res.status(401).send("Hatalı giriş bilgileri.");
    } catch (err) { res.status(500).send("Giriş hatası."); }
});

// --- 4. SAYFA YÖNETİMİ ---
app.get('/profil', authRequired, (req, res) => res.render('profil'));
app.get('/market', authRequired, (req, res) => res.render('market'));
app.get('/arena', authRequired, (req, res) => res.render('arena'));
app.get('/development', authRequired, (req, res) => res.render('development'));
app.get('/meeting', authRequired, (req, res) => res.render('meeting'));
app.get('/chat', authRequired, (req, res) => res.render('chat'));
app.get('/wallet', authRequired, (req, res) => res.render('wallet', { bpl: res.locals.user.bpl || 0 }));

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- 5. MARKET VE GELİŞTİRME API ---
app.post('/api/buy-item', authRequired, async (req, res) => {
    const { itemName, price } = req.body;
    try {
        const user = await User.findById(req.session.userId);
        if ((user.bpl - price) < 25) { 
            return res.status(400).json({ success: false, error: 'Limit Engeli: Bakiyeniz 25 BPL altına düşemez!' });
        }
        user.bpl -= price;
        user.inventory.push({
            name: itemName,
            img: `/caracter/profile/${itemName}.jpg`,
            stamina: 100, hp: 100, maxHp: 100, atk: 50, def: 30, level: 1
        });
        await user.save();
        res.json({ success: true, newBpl: user.bpl });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/api/upgrade-stat', authRequired, async (req, res) => {
    try {
        const { animalName, statType } = req.body;
        const user = await User.findById(req.session.userId);
        const animal = user.inventory.find(a => a.name === animalName);

        if (!animal) return res.status(404).json({ success: false, error: 'Hayvan bulunamadı!' });

        const cost = (statType === 'def') ? 10 : 15;
        if (user.bpl < cost + 25) return res.status(400).json({ success: false, error: 'Yetersiz bakiye (Alt limit 25 BPL)!' });

        if (statType === 'hp') {
            animal.maxHp = (animal.maxHp || 100) + 10;
            animal.hp = animal.maxHp;
        } else if (statType === 'atk') {
            animal.atk += 5;
        } else if (statType === 'def') {
            animal.def += 5;
        }

        user.bpl -= cost;
        user.markModified('inventory');
        await user.save();
        res.json({ success: true, newBalance: user.bpl });
    } catch (err) { res.status(500).json({ success: false }); }
});

// Profil sayfasındaki seçimi veritabanına kaydeder
// Profil sayfasındaki seçimi veritabanına kaydeder
app.post('/api/select-animal', authRequired, async (req, res) => {
    try {
        const { animalName } = req.body;
        // userId üzerinden kullanıcıyı bul (Garanti yöntem)
        const user = await User.findById(req.session.userId);

        if (!user) return res.json({ success: false, error: 'Kullanıcı bulunamadı.' });

        // Envanterde bu hayvan var mı kontrol et
        const hasAnimal = user.inventory.some(i => i.name === animalName);
        if (!hasAnimal) return res.json({ success: false, error: 'Bu hayvana sahip değilsiniz.' });

        user.selectedAnimal = animalName;
        await user.save();

        res.json({ success: true });
    } catch (err) {
        console.error("Seçim Hatası:", err);
        res.json({ success: false, error: 'Sunucu hatası.' });
    }
});

// --- app.js İçindeki io.on('connection') Bölümü ---
io.on('connection', async (socket) => {
    const uId = socket.request.session?.userId;
    if (!uId) return;

    const user = await User.findById(uId);
    if (!user) return;

    socket.userId = uId;
    socket.nickname = user.nickname;
    
    // Online listesini Map olarak tutuyoruz
    onlineUsers.set(user.nickname, { 
        id: socket.id, 
        nickname: user.nickname 
    });

    socket.join("general-chat");

    const broadcastOnlineList = () => {
        const usersArray = Array.from(onlineUsers.values());
        io.to("general-chat").emit('update-online-users', usersArray);
    };
    broadcastOnlineList();

    socket.emit('load-history', chatHistory);

    socket.on('chat-message', (data) => {
        addToHistory(socket.nickname, data.text);
        io.to("general-chat").emit('new-message', { sender: socket.nickname, text: data.text });
    });

    // --- 1. KONSEY (MEETING) SİSTEMİ ---
    socket.on('join-meeting', (data) => {
        const { roomId, peerId, nickname } = data;
        socket.join(roomId);
        // Odaya girene o anki bakiyesini yolla (VIP hediye sonrası güncel kalsın)
        socket.emit('update-bpl', user.bpl);
        io.to(roomId).emit('room-info', { owner: roomId });
        socket.to(roomId).emit('user-connected', { peerId, nickname });
    });

    socket.on('send-meeting-invite', (data) => {
        const target = onlineUsers.get(data.target);
        if (target) {
            io.to(target.id).emit('meeting-invite-received', { from: socket.nickname });
        }
    });

    socket.on('meeting-message', (data) => {
        io.to(data.room).emit('new-meeting-message', { sender: socket.nickname, text: data.text });
    });

    // --- 2. HEDİYE SİSTEMİ (%30 KESİNTİ VE ANLIK GÜNCELLEME) ---
    socket.on('send-gift-bpl', async (data) => {
        const { to, amount } = data;
        const amt = parseInt(amount);
        if (amt < 10) return socket.emit('error', 'Minimum 10 BPL gönderebilirsiniz.');

        const sender = await User.findById(socket.userId);
        const receiver = await User.findOne({ nickname: to });

        if (sender && receiver && sender.bpl >= amt) {
            const tax = Math.floor(amt * 0.30); // %30 Kesinti
            const netAmount = amt - tax;

            sender.bpl -= amt;
            receiver.bpl += netAmount;

            await sender.save();
            await receiver.save();

            // Gönderene anlık bakiye
            socket.emit('update-bpl', sender.bpl);

            // Alıcıya anlık bakiye (Eğer online ise)
            const receiverSocket = onlineUsers.get(to);
            if (receiverSocket) {
                io.to(receiverSocket.id).emit('update-bpl', receiver.bpl);
            }

            io.to("general-chat").emit('new-message', { 
                sender: 'SİSTEM', 
                text: `🎁 ${sender.nickname}, ${receiver.nickname}'e ${amt} BPL gönderdi! (${netAmount} BPL ulaştı, %30 masraf kesildi)` 
            });
        } else {
            socket.emit('error', 'Yetersiz bakiye!');
        }
    });

// --- ARENA GLOBAL DEĞİŞKENLER ---
const BOTS = ['Lion', 'Kurd', 'Peregrinefalcon', 'Rhino'];
let arenaQueue = []; 

// --- ARENA MOTORU ---
async function startBattle(p1, p2, io) {
    let winner;
    
    // 1. KURAL: BOT %55 İHTİMALLE KAZANIR
    const isP1Bot = !p1.socketId;
    const isP2Bot = !p2.socketId;

    if (isP1Bot || isP2Bot) {
        const botWon = Math.random() < 0.55; 
        if (isP2Bot) {
            winner = botWon ? p2 : p1;
        } else {
            winner = botWon ? p1 : p2;
        }
    } else {
        winner = p1.power >= p2.power ? p1 : p2;
    }

    // Kazanan oyuncu ise ödülü ver
    if (winner.socketId) {
        try {
            const User = require('./models/User'); // Modelin yolundan emin olun
            const winUser = await User.findOne({ nickname: winner.nickname });
            if (winUser) {
                winUser.bpl += p1.prize;
                await winUser.save();
                io.to(winner.socketId).emit('update-bpl', winUser.bpl);
            }
        } catch (err) { console.error("Ödül Hatası:", err); }
    }

    // 2. KURAL: VİDEO VERİLERİ
    const matchData = (p, opp) => ({
        opponent: opp.nickname,
        opponentAnimal: opp.animal, 
        winnerNick: winner.nickname,
        winnerAnimal: winner.animal, 
        prize: p.prize
    });

    if (p1.socketId) io.to(p1.socketId).emit('arena-match-found', matchData(p1, p2));
    if (p2.socketId) io.to(p2.socketId).emit('arena-match-found', matchData(p2, p1));
}

// --- IO CONNECTION ---
io.on('connection', (socket) => {

    // A. DAVET KABULÜ
    socket.on('arena-invite-accept', async (data) => {
        try {
            const user1 = await User.findOne({ nickname: socket.nickname });
            const user2 = await User.findOne({ nickname: data.from });
            const inviterSocketId = onlineUsers.get(data.from); // onlineUsers Map olmalı

            if (user1 && user2 && inviterSocketId) {
                const bet = 25;
                if (user1.bpl < bet || user2.bpl < bet) return socket.emit('error', 'Bakiye yetersiz!');

                user1.bpl -= bet; user2.bpl -= bet;
                await user1.save(); await user2.save();

                socket.emit('update-bpl', user1.bpl);
                io.to(inviterSocketId).emit('update-bpl', user2.bpl);

                startBattle(
                    { nickname: user1.nickname, socketId: socket.id, animal: user1.selectedAnimal || 'Lion', power: Math.random()*100, prize: 50 },
                    { nickname: user2.nickname, socketId: inviterSocketId, animal: user2.selectedAnimal || 'Lion', power: Math.random()*100, prize: 50 },
                    io
                );
            }
        } catch (e) { console.log("Arena Davet Hatası:", e); }
    });

    // B. SIRAYA GİRME
    socket.on('arena-join-queue', async (data) => {
        try {
            const user = await User.findOne({ nickname: socket.nickname });
            if (!user || user.bpl < data.bet) return socket.emit('error', 'Yetersiz bakiye!');

            user.bpl -= data.bet;
            await user.save();
            socket.emit('update-bpl', user.bpl);

            const player = {
                nickname: user.nickname,
                socketId: socket.id,
                animal: user.selectedAnimal || 'Lion',
                power: Math.random() * 100,
                prize: data.prize
            };

            if (arenaQueue.length > 0) {
                const opponent = arenaQueue.shift();
                startBattle(player, opponent, io);
            } else {
                arenaQueue.push(player);
                setTimeout(async () => {
                    const idx = arenaQueue.findIndex(p => p.socketId === socket.id);
                    if (idx !== -1) {
                        const waitingPlayer = arenaQueue.splice(idx, 1)[0];
                        const botName = BOTS[Math.floor(Math.random() * BOTS.length)];
                        startBattle(waitingPlayer, {
                            nickname: botName + "_Bot",
                            socketId: null,
                            animal: botName,
                            power: Math.random() * 100,
                            prize: data.prize
                        }, io);
                    }
                }, 10000);
            }
        } catch (e) { console.log("Arena Sıra Hatası:", e); }
    });

    socket.on('disconnect', () => {
        arenaQueue = arenaQueue.filter(p => p.socketId !== socket.id);
    });
}); // <--- io.on kapanışı

// --- SERVER BAŞLATMA ---
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 SİSTEM AKTİF: ${PORT}`));

