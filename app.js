const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const path = require('path');
require('dotenv').config();

const User = require('./models/User');
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

// --- BAĞLANTILAR VE AYARLAR ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ MongoDB Bağlantısı Başarılı'))
    .catch(err => console.error('❌ Veritabanı Hatası:', err));

app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: process.env.SESSION_SECRET || 'bpl_gizli_2026',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

// Giriş Kontrolü Middleware
async function isLoggedIn(req, res, next) {
    if (req.session.userId) {
        const user = await User.findById(req.session.userId);
        if (user) { req.user = user; res.locals.user = user; return next(); }
    }
    res.redirect('/login');
}

// --- SAYFA ROTALARI ---

// 1. Profil Sayfası
app.get('/profil', isLoggedIn, (req, res) => {
    res.render('profil', { user: req.user });
});

// 2. Arena Sayfası (404 Video Hatalarını Çözen Dinamik Yapı)
app.get('/arena', isLoggedIn, (req, res) => {
    // GitHub yapındaki büyük harf klasör isimlerine uyum sağlamak için:
    const char = req.user.selectedAnimal || "Tiger";
    const formattedChar = char.charAt(0).toUpperCase() + char.slice(1);
    
    res.render('arena', { 
        user: req.user, 
        formattedChar,
        // Dosya yollarını büyük harfe zorluyoruz
        movePath: `/caracter/move/${formattedChar}/` 
    });
});

// 3. Global Chat
app.get('/chat', isLoggedIn, (req, res) => {
    res.render('chat', { user: req.user });
});

// 4. Market (500 Hatasını Önlemek İçin Veri Gönderimi)
app.get('/market', isLoggedIn, (req, res) => {
    const shopItems = [
        { id: "p1", name: "Enerji İksiri", price: 500, type: "powerup" },
        { id: "p2", name: "Hız Botu", price: 1000, type: "boost" }
    ];
    res.render('market', { user: req.user, items: shopItems });
});

// --- AUTH İŞLEMLERİ ---
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email, password });
    if (user) {
        req.session.userId = user._id;
        res.redirect('/profil');
    } else {
        res.send("<script>alert('Hata!'); window.location='/';</script>");
    }
});

// Sunucuyu Başlat
const PORT = process.env.PORT || 10000;
httpServer.listen(PORT, '0.0.0.0', () => console.log(`🚀 Port ${PORT} aktif.`));
