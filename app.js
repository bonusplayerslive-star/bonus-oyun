/**
 * BPL ULTIMATE - FINAL FULL SYSTEM (FIXED LIMITS & EJS ERRORS)
 */
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo').default;
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');

const User = require('./models/User');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

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

// --- 4. SAYFA YÖNETİMİ (WALLET HATASI BURADA ÇÖZÜLDÜ) ---
app.get('/profil', authRequired, (req, res) => res.render('profil'));
app.get('/market', authRequired, (req, res) => res.render('market'));
app.get('/arena', authRequired, (req, res) => res.render('arena'));
app.get('/development', authRequired, (req, res) => res.render('development'));
app.get('/meeting', authRequired, (req, res) => res.render('meeting'));
app.get('/chat', authRequired, (req, res) => res.render('chat'));

app.get('/wallet', authRequired, (req, res) => {
    // Veriyi doğrudan nesne içinde göndererek EJS'deki 'undefined' hatalarını önlüyoruz
    res.render('wallet', { bpl: res.locals.user.bpl || 0 });
});

// --- 5. MARKET VE GELİŞTİRME API ---

// Satın Alma API (Limit 25 BPL olarak güncellendi)
app.post('/api/buy-item', authRequired, async (req, res) => {
    const { itemName, price } = req.body;
    try {
        const user = await User.findById(req.session.userId);
        
        // Stratejik limit kontrolü: 25 BPL altına düşemez
        if ((user.bpl - price) < 25) { 
            return res.status(400).json({ success: false, error: 'Limit Engelli: Bakiyeniz 25 BPL altına düşemez!' });
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

// Geliştirme API (Geliştirme sayfasındaki 404 hatasını çözer)
app.post('/api/upgrade-stat', authRequired, async (req, res) => {
    try {
        const { animalIndex, statName, cost } = req.body;
        const user = await User.findById(req.session.userId);

        if (!user || !user.inventory[animalIndex]) {
            return res.status(404).json({ success: false, error: 'Hayvan envanterde bulunamadı!' });
        }

        if ((user.bpl - cost) < 25) {
            return res.status(400).json({ success: false, error: 'Bakiye 25 BPL altına düşemez!' });
        }

        // Değişikliği uygula
        const animal = user.inventory[animalIndex];
        if (statName === 'hp') {
            animal.maxHp += 10;
            animal.hp = animal.maxHp;
        } else if (statName === 'atk') {
            animal.atk += 5;
        } else if (statName === 'def') {
            animal.def += 5;
        }

        user.bpl -= cost;
        user.markModified('inventory'); // MongoDB'ye dizinin değiştiğini söyle
        await user.save();

        res.json({ success: true, newBpl: user.bpl });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// Arena için hayvan seçme rotası
app.post('/api/select-animal', authRequired, async (req, res) => {
    const { animalIndex } = req.body;
    try {
        const user = await User.findById(req.session.userId);
        if (!user.inventory[animalIndex]) {
            return res.status(404).json({ success: false, error: 'Hayvan bulunamadı!' });
        }
        
        // Kullanıcının seçili hayvanını güncelle
        user.selectedAnimal = user.inventory[animalIndex].name;
        await user.save();
        
        res.json({ success: true, message: 'Hayvan başarıyla seçildi!' });
    } catch (err) {
        console.error("Arena Seçim Hatası:", err);
        res.status(500).json({ success: false });
    }
});









// --- 6. SOCKET.IO SİSTEMİ (TEK BLOKTA BİRLEŞTİRİLDİ) ---

const onlineUsers = new Map();
let arenaQueue = []; // Tek havuz

// Global online listesi periyodik gönderim
setInterval(() => {
    const users = Array.from(io.sockets.sockets.values()).map(s => ({
        nickname: s.nickname,
        id: s.id
    }));
    io.emit('update-global-online', users);
}, 5000);

let chatHistory = [];
function addToHistory(sender, text) {
    const msg = { sender, text, time: Date.now() };
    chatHistory.push(msg);
    if (chatHistory.length > 50) chatHistory.shift(); // Son 50 mesajı tut
}

io.on('connection', async (socket) => {
    const uId = socket.request.session?.userId;
    if (!uId) return;

    const user = await User.findById(uId);
    if (!user) return;

    // Kullanıcı Bilgilerini Socket'e Tanımla
    socket.nickname = user.nickname;
    onlineUsers.set(user.nickname, socket.id);
    socket.join("general-chat");
    
    // Geçmişi gönder
    socket.emit('load-history', chatHistory);

    // --- CHAT ---
    socket.on('chat-message', (data) => {
        addToHistory(socket.nickname, data.text);
        io.to("general-chat").emit('new-message', { sender: socket.nickname, text: data.text });
    });

    // --- MEETING ---
    socket.on('join-meeting', (roomId) => {
        socket.join(roomId);
        console.log(`🛋️ ${socket.nickname} masaya katıldı: ${roomId}`);
    });

    socket.on('meeting-message', (data) => {
        io.to(data.room).emit('new-meeting-message', {
            sender: socket.nickname,
            text: data.text
        });
    });

    socket.on('mute-user', (data) => {
        io.to(data.roomId).emit('command-mute', { peerId: data.targetPeerId });
    });

    // --- HEDİYE SİSTEMİ ---
    socket.on('send-gift-vip', async (data) => {
        const { targetNick, amount, room } = data;
        const sender = await User.findById(uId);
        const receiver = await User.findOne({ nickname: targetNick });

        if (sender && receiver && sender.bpl >= 5500 && (sender.bpl - amount) >= 25) {
            const tax = amount * 0.25;
            const netAmount = amount - tax;

            sender.bpl -= amount;
            receiver.bpl += netAmount;

            await sender.save();
            await receiver.save();

            io.to(room).emit('new-meeting-message', {
                sender: 'SİSTEM',
                text: `${sender.nickname}, ${targetNick}'e ${amount} BPL gönderdi! (%25 Vergi)`
            });
            socket.emit('update-bpl', sender.bpl);
        }
    });

    // --- ARENA (KAVUŞMA BURADA) ---
    socket.on('arena-join-queue', async (data) => {
        const u = await User.findById(uId);
        if (!u || u.bpl < 25) return socket.emit('error-msg', 'Yetersiz BPL!');

        const player = {
            nickname: u.nickname,
            socketId: socket.id,
            animal: u.selectedAnimal,
            bet: data.bet,
            prize: data.prize,
            power: (u.inventory.find(i => i.name === u.selectedAnimal)?.level || 1) * 10 + Math.random() * 50
        };

        if (arenaQueue.length > 0 && arenaQueue[0].nickname !== u.nickname) {
            const opponent = arenaQueue.shift();
            startBattle(player, opponent, io);
        } else {
            arenaQueue.push(player);
            // 13 Saniye Bot Süresi
            setTimeout(() => {
                const idx = arenaQueue.findIndex(p => p.nickname === player.nickname);
                if (idx !== -1) {
                    const bot = { 
                        nickname: "System_Bot", 
                        animal: "Lion", 
                        power: 40 + Math.random() * 30 
                    };
                    startBattle(arenaQueue.splice(idx, 1)[0], bot, io);
                }
            }, 13000);
        }
    });

    socket.on('disconnect', () => {
        onlineUsers.delete(socket.nickname);
        arenaQueue = arenaQueue.filter(p => p.socketId !== socket.id);
    });
});
    // 5. BAĞLANTI KESİLDİĞİNDE
    socket.on('disconnect', () => {
        onlineUsers.delete(user.nickname);
        console.log(`❌ ${user.nickname} ayrıldı.`);
    });
});

// --- ARENA MATCHMAKING & BOT SİSTEMİ ---
let arenaQueue = []; 

const BOTS = [
    { nickname: "Aslan_Bot", animal: "Lion", power: 45 },
    { nickname: "Kurt_Bot", animal: "Wolf", power: 35 },
    { nickname: "Goril_Bot", animal: "Gorilla", power: 55 }
];

// Ana Socket Bloğu
io.on('connection', async (socket) => {
    const uId = socket.request.session?.userId;
    if (!uId) return;
    const user = await User.findById(uId);
    if (!user) return;

    socket.nickname = user.nickname;
    onlineUsers.set(user.nickname, socket.id);

    // Arena Giriş ve Eşleşme
    socket.on('arena-join-queue', async (data) => {
        // Zaten sıradaysa tekrar ekleme
        if (arenaQueue.find(p => p.nickname === user.nickname)) return;

        const player = {
            nickname: user.nickname,
            socketId: socket.id,
            animal: user.selectedAnimal,
            bet: data.bet || 0,
            prize: data.prize || 0,
            power: (user.inventory.find(i => i.name === user.selectedAnimal)?.level || 1) * 10 + Math.random() * 50
        };

        if (arenaQueue.length > 0) {
            // Eşleşme sağla
            const opponent = arenaQueue.shift();
            startBattle(player, opponent, io);
        } else {
            // Sıraya ekle
            arenaQueue.push(player);
            
            // 13 Saniye Bot Süresi
            setTimeout(() => {
                const idx = arenaQueue.findIndex(p => p.nickname === player.nickname);
                if (idx !== -1) {
                    const botPlayer = BOTS[Math.floor(Math.random() * BOTS.length)];
                    const waitingPlayer = arenaQueue.splice(idx, 1)[0];
                    startBattle(waitingPlayer, botPlayer, io);
                }
            }, 13000);
        }
    });

    socket.on('disconnect', () => {
        onlineUsers.delete(user.nickname);
        arenaQueue = arenaQueue.filter(p => p.socketId !== socket.id);
    });
});

// Battle Fonksiyonu (Dışarıda kalsın)
async function startBattle(p1, p2, io) {
    const winner = p1.power >= p2.power ? p1 : p2;
    const loser = p1.power >= p2.power ? p2 : p1;

    // Ödül İşlemleri
    if (winner.nickname.indexOf('_Bot') === -1) { // Eğer kazanan bot değilse
        const winUser = await User.findOne({ nickname: winner.nickname });
        if (winUser) {
            winUser.bpl += (p1.prize || 100); 
            await winUser.save();
        }
    }

    // Bilgilendirme
    [p1, p2].forEach(p => {
        if (p.socketId) {
            io.to(p.socketId).emit('arena-match-found', {
                opponent: p === p1 ? p2 : p1,
                winner: winner.nickname,
                type: p2.nickname.includes('_Bot') ? 'bot' : 'pvp'
            });
        }
    });

    io.to("general-chat").emit('new-message', {
        sender: "SİSTEM",
        text: `📢 Arena: ${winner.nickname}, ${loser.nickname}'i mağlup etti!`
    });
}
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 SİSTEM AKTİF: ${PORT}`));















