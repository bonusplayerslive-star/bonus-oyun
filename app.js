// --- 1. MODÜLLER VE YAPILANDIRMA ---
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const path = require('path');
const bcrypt = require('bcryptjs'); // Render uyumluluğu için
const mongoose = require('mongoose');

// Veritabanı Bağlantısı
const connectDB = require('./db');
connectDB();

// MODELLER
const User = require('./models/User');
const ArenaLogs = require('./models/ArenaLogs');
const Income = require('./models/Income');
const Log = require('./models/Log');
const Payment = require('./models/Payment');
const Punishment = require('./models/Punishment');
const Victory = require('./models/Victory');
const Withdrawal = require('./models/Withdrawal');
const UserActions = require('./models/userActions');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 10000;

// MARKET VERİLERİ (Görüntüdeki dosya isimlerine tam uyumlu)
const MARKET_ANIMALS = [
    { id: 1, name: 'Bear', price: 1000, img: '/caracter/profile/Bear.jpg' },
    { id: 2, name: 'Crocodile', price: 1000, img: '/caracter/profile/Crocodile.jpg' },
    { id: 3, name: 'Eagle', price: 1000, img: '/caracter/profile/Eagle.jpg' },
    { id: 4, name: 'Gorilla', price: 5000, img: '/caracter/profile/Gorilla.jpg' },
    { id: 5, name: 'Kurd', price: 1000, img: '/caracter/profile/Kurd.jpg' },
    { id: 6, name: 'Lion', price: 5000, img: '/caracter/profile/Lion.jpg' },
    { id: 7, name: 'Peregrinefalcon', price: 1000, img: '/caracter/profile/Peregrinefalcon.jpg' },
    { id: 8, name: 'Rhino', price: 5000, img: '/caracter/profile/Rhino.jpg' },
    { id: 9, name: 'Snake', price: 1000, img: '/caracter/profile/Snake.jpg' },
    { id: 10, name: 'Tiger', price: 5000, img: '/caracter/profile/Tiger.jpg' }
];

// --- 2. MIDDLEWARE ---
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: 'BPL_MEGA_SYSTEM_SECRET_2025',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

const checkAuth = (req, res, next) => {
    if (req.session.userId) return next();
    res.redirect('/');
};

// --- 3. AUTH ROTALARI ---
app.post('/login', async (req, res) => {
    try {
        const { nickname, password } = req.body;
        const user = await User.findOne({ nickname });
        if (user && await bcrypt.compare(password, user.password)) {
            req.session.userId = user._id;
            await UserActions.create({ userId: user._id, action: 'Login' });
            return res.redirect('/profil');
        }
        res.send("<script>alert('Bilgiler hatalı!'); window.location='/';</script>");
    } catch (e) { res.status(500).send("Hata: " + e.message); }
});

app.post('/register', async (req, res) => {
    try {
        const { nickname, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ 
            nickname, 
            password: hashedPassword, 
            inventory: [{ name: 'Eagle', stats: { hp: 100, atk: 20, def: 10 }, level: 1 }] 
        });
        await newUser.save();
        res.redirect('/');
    } catch (e) { res.status(500).send("Kayıt başarısız."); }
});

// --- 4. SAYFA ROTALARI ---
app.get('/', (req, res) => res.render('index', { user: req.session.userId || null }));
app.get('/profil', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('profil', { user });
});
app.get('/arena', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('arena', { user, selectedAnimal: user.inventory[0]?.name || "Eagle" });
});
app.get('/market', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('market', { user, animals: MARKET_ANIMALS });
});
app.get('/wallet', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('wallet', { user });
});

// --- 5. OYUN MANTIĞI ---
app.post('/attack-bot', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    const animalName = req.body.animal;
    const luck = Math.random();
    let isWin = luck > 0.45;
    let reward = isWin ? 250 : -150;

    user.bpl += reward;
    await user.save();
    await ArenaLogs.create({ challenger: user.nickname, opponent: 'Sistem Botu', winner: isWin ? user.nickname : 'Bot', totalPrize: reward });

    res.json({
        status: 'success',
        newBalance: user.bpl,
        animation: {
            actionVideo: `/caracter/move/${animalName}/${animalName}1.mp4`,
            winVideo: `/caracter/move/${animalName}/${animalName}.mp4`,
            isWin
        }
    });
});

// --- 6. SOCKET & SERVER ---
io.on('connection', (socket) => {
    socket.on('chat-message', (data) => io.emit('new-message', data));
});

server.listen(PORT, "0.0.0.0", () => console.log(`Sistem Aktif: ${PORT}`));
