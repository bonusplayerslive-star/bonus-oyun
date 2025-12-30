// --- 1. MODÜLLER VE AYARLAR ---
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const path = require('path');
const axios = require('axios');

// --- 2. VERİTABANI VE MODELLER ---
const connectDB = require('./db');
const User = require('./models/User');
const Log = require('./models/Log');
const Payment = require('./models/Payment');

connectDB();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 10000;

// --- 3. MIDDLEWARE ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.set('trust proxy', 1);

app.use(session({
    secret: 'bpl_ozel_anahtar',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

const checkAuth = (req, res, next) => {
    if (req.session.userId) next(); else res.redirect('/');
};

const MARKET_ANIMALS = [
    { id: 1, name: 'Tiger', price: 1000, img: '/caracter/profile/tiger.jpg' },
    { id: 2, name: 'Lion', price: 1000, img: '/caracter/profile/lion.jpg' },
    { id: 3, name: 'Eagle', price: 1000, img: '/caracter/profile/eagle.jpg' }
];

const eliteBots = [
    { nickname: "X-Terminator", animal: "Tiger" },
    { nickname: "Shadow-Ghost", animal: "Lion" }
];

const last20Victories = [];

// --- 4. ROTALAR (AUTH & ANA SAYFA) ---

app.get('/', (req, res) => {
    res.render('index', { user: req.session.userId || null });
});

app.post('/register', async (req, res) => {
    const { nickname, email, password } = req.body;
    try {
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.send('<script>alert("Bu e-posta kayıtlı!"); window.location.href="/";</script>');

        const newUser = new User({
            nickname,
            email,
            password,
            bpl: 2500,
            inventory: []
        });

        await newUser.save();
        await new Log({ type: 'REGISTER', content: `Yeni kullanıcı: ${nickname}`, userEmail: email }).save();
        res.send('<script>alert("Kayıt başarılı! Giriş yapabilirsin."); window.location.href="/";</script>');
    } catch (err) {
        res.status(500).send("Kayıt hatası!");
    }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email, password });
    if (user) {
        req.session.userId = user._id;
        res.redirect('/profil');
    } else {
        res.send('<script>alert("Hatalı giriş!"); window.location.href="/";</script>');
    }
});

app.get('/profil', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('profil', { user });
});

// --- 5. ARENA VE MARKET SİSTEMİ ---

app.post('/attack-bot', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const bot = eliteBots[Math.floor(Math.random() * eliteBots.length)];
        const animalName = (req.query.animal || "tiger").toLowerCase();
        const isWin = Math.random() > 0.5;

        if (isWin) {
            user.bpl += 200;
            last20Victories.unshift({ winner: user.nickname, opponent: bot.nickname, reward: 200, time: new Date().toLocaleTimeString() });
            if(last20Victories.length > 20) last20Victories.pop();
            
            io.emit('new-message', { sender: "ARENA", text: `🏆 ${user.nickname} kazandı!`, isBattleWin: true, winnerNick: user.nickname });
        } else {
            if (user.bpl >= 200) user.bpl -= 200;
        }

        await user.save();
        res.json({ status: 'success', isWin, newBalance: user.bpl, opponent: bot.nickname });
    } catch (err) { res.status(500).json({ status: 'error' }); }
});

// --- 6. SOCKET.IO (CHAT & TRANSFER) ---
io.on('connection', (socket) => {
    socket.on('register-user', ({ id, nickname }) => {
        socket.userId = id;
        socket.nickname = nickname;
        socket.join('Global');
    });

    socket.on('chat-message', (data) => {
        io.to('Global').emit('new-message', { sender: socket.nickname, text: data.text });
    });

    socket.on('tebrik-et', async (data) => {
        const sender = await User.findById(socket.userId);
        const receiver = await User.findOne({ nickname: data.winnerNick });
        if (sender && receiver && sender.bpl >= 5000) {
            sender.bpl -= 500;
            receiver.bpl += 410; // %18 kesinti (90 BPL yakıldı)
            await sender.save();
            await receiver.save();
            await new Log({ type: 'BPL_BURN', content: `Tebrik yakımı: 90 BPL`, userEmail: sender.email }).save();
            io.to('Global').emit('new-message', { sender: "SİSTEM", text: `💎 ${sender.nickname}, ${receiver.nickname}'ı tebrik etti!` });
        }
    });
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`BPL ECOSYSTEM RUNNING ON PORT ${PORT}`);
});
