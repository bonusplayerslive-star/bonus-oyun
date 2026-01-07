const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo').default;
const path = require('path');
require('dotenv').config();

const User = require('./models/User');
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

// --- 1. VERİTABANI VE AYARLAR ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ MongoDB Bağlantısı Başarılı'))
    .catch(err => console.error('❌ MongoDB Hatası:', err));

app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: process.env.SESSION_SECRET || 'bpl_secret_2026',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

// Giriş Kontrolü
async function isLoggedIn(req, res, next) {
    if (req.session.userId) {
        const user = await User.findById(req.session.userId);
        if (user) { 
            req.user = user; 
            res.locals.user = user; 
            return next(); 
        }
    }
    res.redirect('/login');
}

// --- 2. ROTALAR (EJS SAYFALARI) ---

// PROFİL
app.get('/profil', isLoggedIn, (req, res) => res.render('profil', { user: req.user }));

// MARKET (Görsel Yollarını Düzelten Bölüm)
app.get('/market', isLoggedIn, (req, res) => {
    // GitHub yapındaki klasör isimleriyle birebir aynı (image_7891cc.png)
    const animalData = [
        { name: "Tiger", price: 2000, hp: 90, atk: 95 },
        { name: "Lion", price: 2500, hp: 85, atk: 90 },
        { name: "Bear", price: 1000, hp: 120, atk: 70 },
        { name: "Crocodile", price: 1500, hp: 110, atk: 80 },
        { name: "Gorilla", price: 5000, hp: 150, atk: 85 },
        { name: "Rhino", price: 3000, hp: 180, atk: 60 },
        { name: "Snake", price: 800, hp: 50, atk: 100 },
        { name: "Eagle", price: 1200, hp: 60, atk: 95 }
    ];

    // ÖNEMLİ: Dosya adını Tiger.jpg (Büyük T) yapıyoruz (image_95a660 hatası çözümü)
    const processedAnimals = animalData.map(a => ({
        ...a,
        imagePath: `/caracter/move/${a.name}/${a.name}.jpg` 
    }));

    res.render('market', { user: req.user, animals: processedAnimals });
});

// GELİŞTİRME MERKEZİ (image_7889cc Bağlantı Hatası Çözümü)
app.get('/development', isLoggedIn, (req, res) => {
    // Kullanıcının mevcut hayvanının resmini büyük harf kuralına göre ayarla
    const char = req.user.selectedAnimal || "Tiger";
    const charImg = `/caracter/move/${char}/${char}.jpg`;
    res.render('development', { user: req.user, charImg });
});

// ARENA (image_6e9218 Video Hatası Çözümü)
app.get('/arena', isLoggedIn, (req, res) => {
    const char = req.user.selectedAnimal || "Tiger";
    // Video yollarını klasör yapısına göre tam eşliyoruz
    const videoData = {
        idle: `/caracter/move/${char}/${char}.mp4`,
        attack: `/caracter/move/${char}/${char}1.mp4`
    };
    res.render('arena', { user: req.user, videoData, char });
});

// CÜZDAN (image_6e8d80 Hatası Çözümü)
app.get('/wallet', isLoggedIn, (req, res) => {
    res.render('wallet', { 
        user: req.user,
        contract: process.env.CONTRACT_ADDRESS,
        wallet: process.env.WALLET_ADDRESS 
    });
});

// GLOBAL CHAT
app.get('/chat', isLoggedIn, (req, res) => res.render('chat', { user: req.user }));

// --- 3. API İŞLEMLERİ (STAT VE MARKET) ---

app.post('/api/upgrade', isLoggedIn, async (req, res) => {
    try {
        const { statType, cost } = req.body;
        const user = await User.findById(req.user._id);
        if (user.bpl >= cost) {
            user.bpl -= cost;
            if (!user.stats) user.stats = { hp: 100, atk: 10, def: 10 };
            user.stats[statType] += 5;
            user.markModified('stats');
            await user.save();
            return res.json({ success: true, newBpl: user.bpl, newStats: user.stats });
        }
        res.status(400).json({ success: false, message: "Yetersiz BPL!" });
    } catch (err) { res.status(500).json({ success: false }); }
});

// --- 4. SOCKET.IO (CHAT VE ARENA SAVAŞI) ---

io.on('connection', async (socket) => {
    const session = socket.request.session;
    if (session && session.userId) {
        const user = await User.findById(session.userId);
        if (user) { socket.nickname = user.nickname; socket.userId = user._id; }
    }

    socket.on('send-global-msg', (data) => {
        io.emit('receive-global-msg', {
            sender: socket.nickname,
            text: data.text,
            time: new Date().toLocaleTimeString()
        });
    });
});

// BAŞLAT
const PORT = process.env.PORT || 10000;
httpServer.listen(PORT, '0.0.0.0', () => console.log(`🚀 Sistem Port ${PORT} üzerinde hazır!`));

