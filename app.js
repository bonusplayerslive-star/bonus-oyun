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

// --- 2. VERİTABANI VE MODELLER (Sol Menüdeki Tüm Modeller) ---
const connectDB = require('./db');
const User = require('./models/User');
const Log = require('./models/Log');
const Payment = require('./models/Payment');
const Income = require('./models/Income');
const Victory = require('./models/Victory');
const Punishment = require('./models/Punishment');
const Withdrawal = require('./models/Withdrawal');
const ArenaLogs = require('./models/ArenaLogs');

connectDB();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 10000;

// --- 3. BELLEKTE TUTULAN VERİLER ---
const last20Victories = [];
const MARKET_ANIMALS = [
    { id: 1, name: 'Bear', price: 1000, img: '/caracter/profile/bear.jpg' },
    { id: 2, name: 'Crocodile', price: 1000, img: '/caracter/profile/crocodile.jpg' },
    { id: 3, name: 'Eagle', price: 1000, img: '/caracter/profile/eagle.jpg' },
    { id: 4, name: 'Gorilla', price: 5000, img: '/caracter/profile/gorilla.jpg' },
    { id: 5, name: 'Kurd', price: 1000, img: '/caracter/profile/kurd.jpg' },
    { id: 6, name: 'Lion', price: 5000, img: '/caracter/profile/lion.jpg' },
    { id: 7, name: 'Falcon', price: 1000, img: '/caracter/profile/peregrinefalcon.jpg' },
    { id: 8, name: 'Rhino', price: 5000, img: '/caracter/profile/rhino.jpg' },
    { id: 9, name: 'Snake', price: 1000, img: '/caracter/profile/snake.jpg' },
    { id: 10, name: 'Tiger', price: 5000, img: '/caracter/profile/tiger.jpg' }
];

// --- 4. MIDDLEWARE ---
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

// --- 5. ROTALAR (MENÜ VE SAYFALAR) ---

app.get('/', (req, res) => res.render('index', { user: req.session.userId || null }));

app.get('/profil', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('profil', { user });
});

app.get('/market', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('market', { user, animals: MARKET_ANIMALS });
});

app.get('/arena', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('arena', { 
        user, 
        selectedAnimal: user.inventory[0]?.name || "Karakter Yok",
        lastVictories: last20Victories 
    });
});

app.get('/wallet', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('wallet', { user });
});

app.get('/development', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('development', { user });
});

app.get('/meeting', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('meeting', { user, roomId: "BPL-VIP-KONSEY" });
});

app.get('/chat', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('chat', { user });
});

// --- 6. AUTH VE İŞLEMLER ---

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email, password });
    if (user) { req.session.userId = user._id; res.redirect('/profil'); }
    else res.send('<script>alert("Hatalı!"); window.location.href="/";</script>');
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.post('/attack-bot', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        if (!user || user.bpl < 200) return res.json({ status: 'error', msg: 'Yetersiz BPL!' });

        let animalName = (req.body.animal || "eagle").toLowerCase().trim();
        const isWin = Math.random() > 0.5;

        if (isWin) {
            user.bpl += 200;
            io.to('Global').emit('new-message', { sender: "ARENA", text: `${user.nickname} kazandı!` });
        } else {
            user.bpl -= 200;
        }
        await user.save();
        res.json({ status: 'success', animation: { isWin, animalName }, newBalance: user.bpl });
    } catch (err) { res.status(500).json({ status: 'error' }); }
});

// --- 7. SOCKET.IO SİSTEMİ (Hata Düzeltilmiş Tek Blok) ---
io.on('connection', (socket) => {
    console.log('Bağlantı sağlandı:', socket.id);

    socket.on('register-user', (data) => {
        if (data && data.nickname) {
            socket.userId = data.id;
            socket.nickname = data.nickname;
            socket.join('Global');
        }
    });

    socket.on('chat-message', (data) => {
        io.to('Global').emit('new-message', { sender: socket.nickname, text: data.text });
    });

    // --- VIP KONSEY (MEETING) MANTIĞI ---
    socket.on('join-meeting', (roomId) => {
        socket.join(roomId);
        console.log(`VIP odaya giriş: ${roomId}`);
    });

    socket.on('send-gift-vip', async (data) => {
        try {
            const sender = await User.findById(data.senderId);
            const receiver = await User.findOne({ nickname: data.targetNick });
            if (sender && receiver && sender.bpl >= 5000) {
                const tax = data.tax / 100;
                const netAmount = Math.floor(data.amount * (1 - tax));
                sender.bpl -= data.amount;
                receiver.bpl += netAmount;
                await sender.save(); await receiver.save();
                io.to(data.room).emit('new-message', { sender: "SİSTEM", text: `🎁 ${sender.nickname} -> ${receiver.nickname}: ${data.amount} BPL` });
                socket.emit('gift-result', { status: 'success' });
            }
        } catch (e) { console.error(e); }
    });

    socket.on('disconnect', () => console.log('Ayrıldı.'));
});

// --- 8. SUNUCU BAŞLATMA ---
server.listen(PORT, "0.0.0.0", () => {
    console.log(`BPL ECOSYSTEM AKTİF: PORT ${PORT}`);
});
