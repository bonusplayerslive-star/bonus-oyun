// --- 1. MODÜLLER VE AYARLAR ---
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const mongoose = require('mongoose');
const path = require('path');
const bcrypt = require('bcryptjs'); // Şifre güvenliği için şart

// --- 2. VERİTABANI VE MODELLER ---
const connectDB = require('./db');
const User = require('./models/User');
const Log = require('./models/Log');
// const Payment = require('./models/Payment'); // Gerekirse aktif edersin

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
    cookie: { 
        secure: process.env.NODE_ENV === 'production', // Render'da true olması gerekebilir
        maxAge: 24 * 60 * 60 * 1000 
    }
}));

// Oturum Kontrolü Middleware
const checkAuth = (req, res, next) => {
    if (req.session.userId) {
        next();
    } else {
        res.redirect('/');
    }
};

// Sabit Veriler
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
    // Eğer zaten giriş yapmışsa profile yönlendir
    if (req.session.userId) return res.redirect('/profil');
    res.render('index', { user: null });
});

app.post('/register', async (req, res) => {
    // name="nickname" ejs'de doğru yazılmalı!
    const { nickname, email, password } = req.body;
    try {
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.send('<script>alert("Bu e-posta kayıtlı!"); window.location.href="/";</script>');

        // Şifreyi hashleyerek kaydet (Güvenlik için)
        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = new User({
            nickname,
            email,
            password: hashedPassword,
            bpl: 2500,
            inventory: []
        });

        await newUser.save();
        await new Log({ type: 'REGISTER', content: `Yeni kullanıcı: ${nickname}`, userEmail: email }).save();
        res.send('<script>alert("Kayıt başarılı! Giriş yapabilirsin."); window.location.href="/";</script>');
    } catch (err) {
        console.error(err);
        res.status(500).send("Kayıt sırasında teknik bir hata oluştu!");
    }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email });
        if (user && await bcrypt.compare(password, user.password)) {
            req.session.userId = user._id;
            res.redirect('/profil');
        } else {
            res.send('<script>alert("Hatalı e-posta veya şifre!"); window.location.href="/";</script>');
        }
    } catch (err) {
        res.status(500).send("Giriş hatası!");
    }
});

app.get('/profil', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        if (!user) return res.redirect('/logout');
        res.render('profil', { user });
    } catch (err) {
        res.redirect('/');
    }
});

// --- 5. ARENA VE MARKET SİSTEMİ ---

app.get('/market', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('market', { user, animals: MARKET_ANIMALS });
});

app.post('/attack-bot', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const bot = eliteBots[Math.floor(Math.random() * eliteBots.length)];
        const isWin = Math.random() > 0.5;

        if (isWin) {
            user.bpl += 200;
            last20Victories.unshift({ 
                winner: user.nickname, 
                opponent: bot.nickname, 
                reward: 200, 
                time: new Date().toLocaleTimeString() 
            });
            if(last20Victories.length > 20) last20Victories.pop();
            
            io.emit('new-message', { 
                sender: "ARENA", 
                text: `🏆 ${user.nickname} kazandı!`, 
                isBattleWin: true, 
                winnerNick: user.nickname 
            });
        } else {
            if (user.bpl >= 200) user.bpl -= 200;
        }

        await user.save();
        res.json({ status: 'success', isWin, newBalance: user.bpl, opponent: bot.nickname });
    } catch (err) { 
        res.status(500).json({ status: 'error' }); 
    }
});

// --- 6. SOCKET.IO (CHAT & TRANSFER) ---
io.on('connection', (socket) => {
    socket.on('register-user', ({ id, nickname }) => {
        socket.userId = id;
        socket.nickname = nickname;
        socket.join('Global');
    });

    socket.on('chat-message', (data) => {
        if(socket.nickname) {
            io.to('Global').emit('new-message', { sender: socket.nickname, text: data.text });
        }
    });

    socket.on('tebrik-et', async (data) => {
        try {
            const sender = await User.findById(socket.userId);
            const receiver = await User.findOne({ nickname: data.winnerNick });
            
            if (sender && receiver && sender.bpl >= 5000 && sender.nickname !== receiver.nickname) {
                sender.bpl -= 500;
                receiver.bpl += 410; // %18 kesinti
                await sender.save();
                await receiver.save();
                
                await new Log({ type: 'BPL_BURN', content: `Tebrik yakımı: 90 BPL`, userEmail: sender.email }).save();
                io.to('Global').emit('new-message', { sender: "SİSTEM", text: `💎 ${sender.nickname}, ${receiver.nickname}'ı tebrik etti!` });
            }
        } catch (err) {
            console.error("Tebrik hatası:", err);
        }
    });
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- 7. BAŞLATMA ---
server.listen(PORT, "0.0.0.0", () => {
    console.log(`
    =========================================
    BPL ECOSYSTEM AKTİF!
    PORT: ${PORT}
    VERİTABANI: Bağlantı Kuruluyor...
    =========================================
    `);
});
