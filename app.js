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

connectDB();

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// Render HTTPS ve Port Ayarları
const PORT = process.env.PORT || 10000; 
app.set('trust proxy', 1); 

app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https' && process.env.NODE_ENV === 'production') {
        res.redirect(`https://${req.header('host')}${req.url}`);
    } else { next(); }
});

const activeMeetings = {};
let ipLoginAttempts = {};

// Log Yolları
const LOG_PATHS = {
    MARKET: 'public/caracter/burning/market.txt',
    ARENA: 'public/caracter/burning/arena.dat',
    DEV: 'public/caracter/burning/development.txt',
    GIFT: 'data/gift/interruption.txt',
    MEETING: 'public/caracter/burning/meeting.txt',
    WALLET_WITHDRAW: 'data/game/wallet/wallet.dat',
    SUPPORT: 'data/support/tickets.txt' 
};

const logToFile = (relativePath, content) => {
    const fullPath = path.join(__dirname, relativePath);
    const dir = path.dirname(fullPath);
    try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(fullPath, `${new Date().toLocaleString('tr-TR')} | ${content}\n`, 'utf8');
    } catch (err) { console.error("Log Hatası:", err.message); }
};

app.use(bodyParser.json()); 
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
    secret: 'bpl_secret', 
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));
app.set('view engine', 'ejs');

// --- ROUTES ---

app.get('/', (req, res) => {
    const userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    let isBlocked = false;
    if (ipLoginAttempts[userIp] && ipLoginAttempts[userIp].count >= 4) {
        if (Date.now() < ipLoginAttempts[userIp].banUntil) isBlocked = true;
    }
    res.render('index', { articles: ["BPL Elite Yayında!"], userIp, isBlocked });
});

const checkAuth = (req, res, next) => {
    if (req.session.userId) next(); else res.redirect('/');
};

// Destek Formu - İstediğin mail adresi eklendi
app.post('/contact-submit', async (req, res) => {
    const { email, message } = req.body;
    const userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    try {
        logToFile(LOG_PATHS.SUPPORT, `DESTEK: [${email}] ${message}`);
        res.json({ status: 'success', msg: 'Mesaj kaydedildi. Destek: bonusplayerslive@gmail.com' });
    } catch (e) { res.json({ status: 'error' }); }
});

app.get('/profil', checkAuth, async (req, res) => { 
    const user = await User.findById(req.session.userId);
    res.render('profil', { user });
});

app.get('/market', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('market', { user });
});

// Market Satın Alma - "Sunucu Hatası" Çözüldü
app.post('/buy-animal', checkAuth, async (req, res) => {
    try {
        const { animalName, price } = req.body;
        const user = await User.findById(req.session.userId);
        if (user && user.bpl >= price) {
            user.bpl -= price;
            if (!user.inventory.includes(animalName)) user.inventory.push(animalName);
            if (!user.stats) user.stats = {};
            user.stats[animalName] = { hp: 100, atk: 10, def: 10 };
            
            user.markModified('stats');
            user.markModified('inventory');
            await user.save();
            res.json({ status: 'success', newBalance: user.bpl });
        } else { res.json({ status: 'error', msg: 'Yetersiz Bakiye!' }); }
    } catch (e) { res.status(500).json({ status: 'error' }); }
});

// Login - "Status 1" Çökmesi Çözüldü
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    const user = await User.findOne({ email, password });
    if (user) {
        delete ipLoginAttempts[userIp];
        req.session.userId = user._id;
        res.redirect('/profil');
    } else {
        if (!ipLoginAttempts[userIp]) ipLoginAttempts[userIp] = { count: 1 };
        else ipLoginAttempts[userIp].count++;

        if (ipLoginAttempts[userIp].count >= 4) {
            ipLoginAttempts[userIp].banUntil = Date.now() + (120 * 60 * 1000);
        }
        res.send('<script>alert("Hatalı Giriş!"); window.location.href="/";</script>');
    }
});

// --- SOCKET.IO (Chat, Arena, WebRTC) ---
io.on('connection', (socket) => {
    socket.on('join-chat', (data) => {
        socket.join(data.room);
        socket.nickname = data.nickname;
        socket.roomName = data.room;
    });

    socket.on('chat-message', (data) => {
        io.to(data.room).emit('new-message', { sender: data.nickname, text: data.message });
    });

    // Arena Arama ve Bot Sistemi
    socket.on('start-search', () => {
        setTimeout(() => {
            socket.emit('match-found', { 
                matchId: `bot_${Date.now()}`, 
                opponent: { nickname: "BOT_CELL", animal: "Kurt" } 
            });
        }, 3000);
    });

    // WebRTC Sinyalleşme
    socket.on('webrtc-offer', (data) => { socket.to(data.toSocket).emit('webrtc-offer', data); });
    socket.on('webrtc-answer', (data) => { socket.to(data.toSocket).emit('webrtc-answer', data); });
    socket.on('webrtc-ice-candidate', (data) => { socket.to(data.toSocket).emit('webrtc-ice-candidate', data); });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`Sunucu ${PORT} portunda aktif.`);
});
