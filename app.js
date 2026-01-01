// --- 1. MODÜLLER VE AYARLAR ---
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const MongoStore = require('connect-mongo'); 
const mongoose = require('mongoose');
const path = require('path');
const bcrypt = require('bcryptjs');

// --- 2. VERİTABANI VE MODELLER ---
const connectDB = require('./db');
const User = require('./models/User');
const Log = require('./models/Log');

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

// RENDER İÇİN KRİTİK AYAR: Proxy'ye güven
app.set('trust proxy', 1);

// OTURUM YÖNETİMİ (RENDER VE v6 UYUMLU)
app.use(session({
    secret: process.env.SESSION_SECRET || 'bpl_ozel_anahtar_2026',
    resave: true, // Oturumu her seferinde güncelle
    saveUninitialized: false,
    store: MongoStore.create({ 
        mongoUrl: process.env.MONGO_URI,
        collectionName: 'sessions'
    }),
    cookie: { 
        // Render HTTPS kullandığı için production'da true olmalı
        secure: process.env.NODE_ENV === 'production', 
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000 
    }
}));

const checkAuth = (req, res, next) => {
    if (req.session && req.session.userId) {
        return next();
    }
    res.redirect('/');
};

// --- 4. ROTALAR ---

app.get('/', (req, res) => {
    if (req.session.userId) return res.redirect('/profil');
    res.render('index', { user: null });
});

// KAYIT VE OTOMATİK GİRİŞ
app.post('/register', async (req, res) => {
    try {
        let { nickname, email, password } = req.body;
        const cleanEmail = email.trim().toLowerCase();
        
        const existingUser = await User.findOne({ email: cleanEmail });
        if (existingUser) return res.send('<script>alert("Bu email zaten kayıtlı!"); window.location.href="/";</script>');

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ 
            nickname: nickname.trim(), 
            email: cleanEmail, 
            password: hashedPassword, 
            bpl: 2500,
            inventory: [{ name: 'Eagle', level: 1, stats: { hp: 150, atk: 30 } }] 
        });

        const savedUser = await newUser.save();
        
        // KAYIT SONRASI OTURUMU BAŞLAT
        req.session.userId = savedUser._id;
        req.session.save((err) => {
            if (err) return res.redirect('/');
            res.redirect('/profil'); // Alert koymadan direkt yönlendirme daha sağlıklıdır
        });
    } catch (e) {
        res.status(500).send("Kayıt hatası.");
    }
});

// LOGIN
app.post('/login', async (req, res) => {
    try {
        let { email, password } = req.body;
        const cleanEmail = email.trim().toLowerCase();

        const user = await User.findOne({ email: cleanEmail });
        if (!user) return res.send('<script>alert("Email kayıtlı değil!"); window.location.href="/";</script>');

        const isMatch = await bcrypt.compare(password, user.password);
        if (isMatch) {
            req.session.userId = user._id;
            req.session.save((err) => {
                if (err) return res.send("Oturum hatası.");
                res.redirect('/profil');
            });
        } else {
            res.send('<script>alert("Şifre yanlış!"); window.location.href="/";</script>');
        }
    } catch (error) {
        res.status(500).send("Sistem hatası.");
    }
});

app.get('/profil', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        if (!user) return res.redirect('/logout');
        res.render('profil', { user });
    } catch (err) { res.redirect('/'); }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.clearCookie('connect.sid'); // Çerezi temizle
    res.redirect('/');
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`BPL ECOSYSTEM ÇALIŞIYOR: ${PORT}`);
});
