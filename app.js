require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const axios = require('axios');
const session = require('express-session');
const rateLimit = require('express-rate-limit');

const connectDB = require('./db');
const User = require('./models/User');

// Veritabanı bağlantısı
connectDB();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 10000; 
app.set('trust proxy', 1);

// ODA YÖNETİM MERKEZİ
const activeMeetings = {};
let ipLoginAttempts = {};

// GÜVENLİK
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 15, message: "Çok fazla deneme yaptınız." });

// MIDDLEWARE
app.use(bodyParser.json()); 
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
    secret: 'bpl_ozel_anahtar', 
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));
app.set('view engine', 'ejs');

// LOG SİSTEMİ
const logToFile = (relativePath, content) => {
    const fullPath = path.join(__dirname, relativePath);
    const dir = path.dirname(fullPath);
    try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const logLine = `${new Date().toLocaleString('tr-TR')} | ${content}\n`;
        fs.appendFileSync(fullPath, logLine, 'utf8');
    } catch (err) { console.error("Log hatası:", err.message); }
};

const LOG_PATHS = {
    MARKET: 'public/caracter/burning/market.txt',
    ARENA: 'public/caracter/burning/arena.dat',
    GIFT: 'data/gift/interruption.txt',
    MEETING: 'public/caracter/burning/meeting.txt',
    WALLET: 'data/game/wallet/wallet.dat'
};

// AUTH KONTROLÜ
const checkAuth = (req, res, next) => {
    if (req.session.userId) next(); else res.redirect('/');
};

// --- ROTALAR (SAYFALAR) ---

app.get('/', (req, res) => {
    const userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    res.render('index', { articles: ["Arena Yayında!", "Market Güncellendi"], userIp, forceHelp: false });
});

app.get('/profil', checkAuth, async (req, res) => {
    try { const user = await User.findById(req.session.userId); res.render('profil', { user }); } catch (e) { res.redirect('/'); }
});

app.get('/market', checkAuth, async (req, res) => {
    try { const user = await User.findById(req.session.userId); res.render('market', { user }); } catch (e) { res.redirect('/profil'); }
});

app.get('/development', checkAuth, async (req, res) => {
    try { const user = await User.findById(req.session.userId); res.render('development', { user }); } catch (e) { res.redirect('/profil'); }
});

app.get('/wallet', checkAuth, async (req, res) => {
    try { const user = await User.findById(req.session.userId); res.render('wallet', { user }); } catch (e) { res.redirect('/profil'); }
});

app.get('/payment', checkAuth, async (req, res) => {
    try { 
        const user = await User.findById(req.session.userId); 
        const packages = [{ usd: 10, bpl: 1000 }, { usd: 50, bpl: 5500 }, { usd: 100, bpl: 12000 }];
        res.render('payment', { user, packages, paymentText: process.env.WALLET_ADDRESS }); 
    } catch (e) { res.redirect('/profil'); }
});

app.get('/arena', checkAuth, async (req, res) => {
    try { const user = await User.findById(req.session.userId); res.render('arena', { user }); } catch (e) { res.redirect('/profil'); }
});

app.get('/chat', checkAuth, async (req, res) => {
    try { const user = await User.findById(req.session.userId); res.render('chat', { user, room: 'Global' }); } catch (e) { res.redirect('/profil'); }
});

app.get('/meeting', checkAuth, async (req, res) => {
    try { 
        const user = await User.findById(req.session.userId); 
        const roomId = req.query.roomId;
        res.render('meeting', { user, roomId }); 
    } catch (e) { res.redirect('/profil'); }
});

// --- AUTH İŞLEMLERİ ---

app.post('/login', authLimiter, async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email, password });
    if (user) {
        req.session.userId = user._id;
        res.redirect('/profil');
    } else {
        res.send(`<script>alert("Hatalı Giriş!"); window.location.href="/";</script>`);
    }
});

app.post('/register', authLimiter, async (req, res) => {
    try {
        const newUser = new User({ ...req.body, bpl: 2500, inventory: [], stats: {} });
        await newUser.save();
        res.send('<script>alert("Kayıt Başarılı!"); window.location.href="/";</script>');
    } catch (e) { res.send("Kayıt Hatası."); }
});

app.post('/change-password', checkAuth, async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.session.userId, { password: req.body.password });
        res.json({ status: 'success' });
    } catch (e) { res.json({ status: 'error' }); }
});

// --- OYUN VE MARKET SİSTEMLERİ ---

app.post('/buy-animal', checkAuth, async (req, res) => {
    const { animalName, price } = req.body;
    try {
        const user = await User.findById(req.session.userId);
        if (user && user.bpl >= price) {
            user.bpl -= price;
            user.inventory.push(animalName);
            if(!user.stats) user.stats = {};
            user.stats[animalName] = { hp: 100, atk: 15, def: 10 };
            user.markModified('stats'); 
            await user.save();
            logToFile(LOG_PATHS.MARKET, `${user.nickname} aldı: ${animalName}`);
            res.json({ status: 'success', newBalance: user.bpl });
        } else res.json({ status: 'error', msg: 'Yetersiz Bakiye!' });
    } catch (e) { res.json({ status: 'error' }); }
});

app.post('/upgrade-stat', checkAuth, async (req, res) => {
    const { animalName, statType } = req.body;
    const prices = { hp: 50, atk: 40, def: 35 };
    try {
        const user = await User.findById(req.session.userId);
        const price = prices[statType];
        if (user && user.bpl >= price) {
            user.bpl -= price;
            user.stats[animalName][statType] += (statType === 'hp' ? 10 : 5);
            user.markModified('stats');
            await user.save();
            res.json({ status: 'success', newBalance: user.bpl });
        } else res.json({ status: 'error', msg: 'Bakiye yetersiz!' });
    } catch (e) { res.json({ status: 'error' }); }
});

app.post('/withdraw', checkAuth, async (req, res) => {
    const { amount } = req.body;
    try {
        const user = await User.findById(req.session.userId);
        if (amount >= 7500 && user.bpl >= amount) {
            user.bpl -= amount;
            await user.save();
            logToFile(LOG_PATHS.WALLET, `${user.nickname} çekim talebi: ${amount}`);
            res.json({ status: 'success', msg: 'Talebiniz alındı.' });
        } else res.json({ status: 'error', msg: 'Limit dışı veya yetersiz bakiye.' });
    } catch (e) { res.json({ status: 'error' }); }
});

// --- SOCKET.IO (ARENA, CHAT, MEETING) ---

io.on('connection', (socket) => {
    // Chat & Meeting
    socket.on('join-chat', (data) => {
        socket.join(data.room);
        socket.nickname = data.nickname;
        socket.to(data.room).emit('user-joined', { nickname: data.nickname });
    });

    socket.on('chat-message', (data) => {
        io.to(data.room).emit('new-message', { sender: data.nickname, text: data.message });
    });

    // Arena Sistemi
    socket.on('join-arena', async (data) => {
        socket.join("arena_lobby");
        const user = await User.findById(data.userId);
        if (user) {
            socket.userData = { userId: user._id.toString(), nickname: user.nickname, animal: data.selectedAnimal || "Kurd" };
        }
    });

    socket.on('start-search', () => {
        const lobby = io.sockets.adapter.rooms.get("arena_lobby");
        if (lobby && lobby.size >= 1) { // 1 kişi bile olsa botla eşleştir
            const matchId = `match_${Date.now()}`;
            const botData = { nickname: "Savaşçı_Bot", animal: "Snake", userId: "BOT123" };
            const winnerId = Math.random() > 0.4 ? socket.userData.userId : "BOT123";
            socket.emit('match-found', { matchId, winnerId, opponent: botData });
        }
    });

    socket.on('claim-victory', async (data) => {
        const user = await User.findById(data.userId);
        if (user) { user.bpl += 50; await user.save(); logToFile(LOG_PATHS.ARENA, `${user.nickname} +50 BPL`); }
    });

    // WebRTC (Meeting)
    socket.on('webrtc-offer', (data) => socket.to(data.toSocket).emit('webrtc-offer', data));
    socket.on('webrtc-answer', (data) => socket.to(data.toSocket).emit('webrtc-answer', data));
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`BPL SİSTEMİ ÇALIŞIYOR | PORT: ${PORT}`);
});
