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
// Geliştirme API - TAMİR EDİLDİ
app.post('/api/upgrade-stat', authRequired, async (req, res) => {
    try {
        const { animalName, statType } = req.body; // Frontend'den bunlar geliyor
        const user = await User.findById(req.session.userId);

        // Envanterde ismiyle bul
        const animal = user.inventory.find(a => a.name === animalName);

        if (!animal) {
            return res.status(404).json({ success: false, error: 'Hayvan envanterde bulunamadı!' });
        }

        // Fiyat belirleme (Backend kontrolü)
        const cost = (statType === 'def') ? 10 : 15;

        if ((user.bpl - cost) < 25) {
            return res.status(400).json({ success: false, error: 'Bakiye 25 BPL altına düşemez!' });
        }

        // İstatistiği yükselt
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

        // Frontend'in beklediği formatta cevap dön: { success, newBalance }
        res.json({ success: true, newBalance: user.bpl });
    } catch (err) {
        console.error("Geliştirme Hatası:", err);
        res.status(500).json({ success: false, error: 'Sunucu hatası oluştu.' });
    }
});

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

// --- 6. LOGOUT ROTASI ---
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- 7. SOCKET.IO SİSTEMİ (TEK BLOKTA BİRLEŞTİRİLDİ) ---
const onlineUsers = new Map();
let arenaQueue = []; 

const BOTS = [
    { nickname: "Aslan_Bot", animal: "Lion", power: 45 },
    { nickname: "Kurt_Bot", animal: "Wolf", power: 35 },
    { nickname: "Goril_Bot", animal: "Gorilla", power: 55 },
    { nickname: "Rhino_Bot", animal: "Rhino", power: 57 }
];

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
    if (chatHistory.length > 50) chatHistory.shift();
}

io.on('connection', async (socket) => {
    const uId = socket.request.session?.userId;
    if (!uId) return;

    const user = await User.findById(uId);
    if (!user) return;

    socket.nickname = user.nickname;
    onlineUsers.set(user.nickname, socket.id);
    socket.join("general-chat");
    socket.emit('load-history', chatHistory);

    // --- CHAT SİSTEMİ ---
    socket.on('chat-message', (data) => {
        addToHistory(socket.nickname, data.text);
        io.to("general-chat").emit('new-message', { sender: socket.nickname, text: data.text });
    });

    // --- MEETING SİSTEMİ ---
    socket.on('join-meeting', (roomId) => {
        socket.join(roomId);
    });

    socket.on('meeting-message', (data) => {
        io.to(data.room).emit('new-meeting-message', { sender: socket.nickname, text: data.text });
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
            const netAmount = amount * 0.75; // %25 vergi
            sender.bpl -= amount;
            receiver.bpl += netAmount;
            await sender.save();
            await receiver.save();

            io.to(room).emit('new-meeting-message', {
                sender: 'SİSTEM',
                text: `${sender.nickname}, ${targetNick}'e ${amount} BPL gönderdi!`
            });
            socket.emit('update-bpl', sender.bpl);
        }
    });

    // --- ARENA SİSTEMİ ---
    socket.on('arena-join-queue', async (data) => {
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
            const opponent = arenaQueue.shift();
            startBattle(player, opponent, io);
        } else {
            arenaQueue.push(player);
            setTimeout(() => {
                const idx = arenaQueue.findIndex(p => p.nickname === player.nickname);
                if (idx !== -1) {
                    const randomBot = BOTS[Math.floor(Math.random() * BOTS.length)];
                    startBattle(arenaQueue.splice(idx, 1)[0], randomBot, io);
                }
            }, 13000);
        }
    });

    // --- DISCONNECT ---
    socket.on('disconnect', () => {
        onlineUsers.delete(socket.nickname);
        arenaQueue = arenaQueue.filter(p => p.socketId !== socket.id);
        console.log(`❌ ${socket.nickname} ayrıldı.`);
    });
});

// --- BATTLE FONKSİYONU ---
async function startBattle(p1, p2, io) {
    const winner = p1.power >= p2.power ? p1 : p2;
    const loser = p1.power >= p2.power ? p2 : p1;

    // Kazanan bot değilse ödül ver
    if (!winner.nickname.includes('_Bot')) {
        const winUser = await User.findOne({ nickname: winner.nickname });
        if (winUser) {
            winUser.bpl += (p1.prize || 100);
            await winUser.save();
        }
    }

    [p1, p2].forEach(p => {
        if (p.socketId) {
            io.to(p.socketId).emit('arena-match-found', {
                opponent: p === p1 ? p2 : p1,
                winner: winner.nickname
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

