// --- 1. MODÜLLER VE AYARLAR ---
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const mongoose = require('mongoose');
const path = require('path');
const axios = require('axios');

// --- 2. VERİTABANI VE MODELLER ---
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

// --- 4. SABİT VERİLER ---
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

// --- 5. SAYFA ROTALARI (GET) ---
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
    res.render('arena', { user, selectedAnimal: user.inventory[0]?.name || "Karakter Yok", lastVictories: [] });
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

// --- 6. İŞLEM ROTALARI (POST) ---

// HATAYI DÜZELTEN KAYIT ROTASI
app.post('/register', async (req, res) => {
    const { nickname, email, password } = req.body;
    try {
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.send('<script>alert("E-posta zaten kayıtlı!"); window.location.href="/";</script>');

        const newUser = new User({ 
            nickname, 
            email, 
            password, // Gerçek projelerde şifrelemiş olmalısınız
            bpl: 2500, 
            inventory: [] 
        });
        await newUser.save();
        res.send('<script>alert("Kayıt başarılı! Giriş yapabilirsiniz."); window.location.href="/";</script>');
    } catch (err) { 
        console.error(err);
        res.status(500).send("Kayıt sırasında hata oluştu."); 
    }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email, password });
    if (user) {
        req.session.userId = user._id;
        res.redirect('/profil');
    } else {
        res.send('<script>alert("Giriş bilgileri hatalı!"); window.location.href="/";</script>');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- 7. SOCKET.IO SİSTEMİ (RENDER HATASINI DÜZELTEN BLOK) ---
io.on('connection', (socket) => {
    console.log('Yeni bağlantı:', socket.id);

    socket.on('register-user', (data) => {
        if (data && data.nickname) {
            socket.userId = data.id;
            socket.nickname = data.nickname;
            socket.join('Global');
        }
    });

    socket.on('chat-message', (data) => {
        if (data.text) {
            io.to('Global').emit('new-message', { sender: socket.nickname || "Misafir", text: data.text });
        }
    });

    socket.on('join-meeting', (roomId) => {
        socket.join(roomId);
        console.log(`Kullanıcı ${socket.nickname} VIP odaya girdi.`);
    });

    socket.on('send-gift-vip', async (data) => {
        try {
            const sender = await User.findById(data.senderId);
            const receiver = await User.findOne({ nickname: data.targetNick });
            if (sender && receiver && sender.bpl >= 5000) {
                const tax = (data.tax || 25) / 100;
                const netAmount = Math.floor(data.amount * (1 - tax));
                sender.bpl -= data.amount;
                receiver.bpl += netAmount;
                await sender.save(); await receiver.save();
                io.to(data.room).emit('new-message', { sender: "SİSTEM", text: `🎁 ${sender.nickname} -> ${receiver.nickname}: ${data.amount} BPL gönderdi!` });
                socket.emit('gift-result', { status: 'success' });
            }
        } catch (e) { console.error(e); }
    });

    socket.on('disconnect', () => console.log('Bağlantı kesildi.'));
});

// --- 8. SUNUCU ---
server.listen(PORT, "0.0.0.0", () => {
    console.log(`BPL ECOSYSTEM AKTİF: PORT ${PORT}`);
});
