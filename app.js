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
const char = req.user.selectedAnimal || "Tiger"; // Örn: "Tiger"
// Klasör adı: Tiger, Dosya adı: tiger1.mp4 (Eğer GitHub'da böyleyse)
const videoPath = `/caracter/move/${char}/${char.toLowerCase()}1.mp4`;
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

// --- MARKET SAYFASI ---
app.get('/market', isLoggedIn, (req, res) => {
    // GitHub klasör isimlerinle (image_7891cc.png) birebir aynı liste
    const animals = [
        { name: "Lion", price: 2500, hp: "85%", atk: "90%" },
        { name: "Tiger", price: 2000, hp: "80%", atk: "95%" },
        { name: "Bear", price: 1000, hp: "95%", atk: "75%" },
        { name: "Crocodile", price: 1500, hp: "90%", atk: "80%" },
        { name: "Falcon", price: 1200, hp: "40%", atk: "95%" },
        { name: "Gorilla", price: 3000, hp: "100%", atk: "85%" },
        { name: "Rhino", price: 2800, hp: "100%", atk: "60%" },
        { name: "Snake", price: 800, hp: "30%", atk: "100%" }
    ];

    // EJS'ye gönderirken resim yollarını klasör yapına göre kuruyoruz
    // Örnek: /caracter/move/Tiger/tiger.png (veya .jpg)
    res.render('market', { 
        user: req.user, 
        animals: animals 
    });
});
// Hayvan Satın Alma API
app.post('/api/market/buy-animal', isLoggedIn, async (req, res) => {
    try {
        const { animalName, price } = req.body;
        const user = await User.findById(req.user._id);

        if (user.bpl >= price) {
            user.bpl -= price;
            // Kullanıcının envanterine ekle veya seçili hayvanı değiştir
            user.selectedAnimal = animalName; 
            user.inventory.push({ name: animalName, type: 'animal' });
            await user.save();
            return res.json({ success: true, newBpl: user.bpl });
        }
        res.status(400).json({ success: false, message: "BPL yetersiz!" });
    } catch (err) { res.status(500).json({ success: false }); }
});
// --- GELİŞTİRME MERKEZİ ---
app.get('/development', isLoggedIn, (req, res) => {
    res.render('development', { user: req.user });
});

// İstatistik Yükseltme API (Bağlantı Hatası Almamak İçin)
app.post('/api/upgrade', isLoggedIn, async (req, res) => {
    try {
        const { statType, cost } = req.body;
        const user = await User.findById(req.user._id);

        if (user.bpl >= cost) {
            user.bpl -= cost;
            
            if (!user.stats) user.stats = { hp: 100, atk: 10, def: 10 };
            
            // Stat artırımı
            if (statType === 'hp') user.stats.hp += 10;
            else if (statType === 'atk') user.stats.atk += 2;
            else if (statType === 'def') user.stats.def += 2;

            user.markModified('stats');
            await user.save();

            return res.json({ success: true, newBpl: user.bpl, newStats: user.stats });
        }
        res.status(400).json({ success: false, message: "Bakiye yetersiz!" });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// İstatistik Yükseltme API
app.post('/api/upgrade', isLoggedIn, async (req, res) => {
    try {
        const { statType, cost } = req.body; // hp, atk, def
        const user = await User.findById(req.user._id);

        if (user.bpl >= cost) {
            user.bpl -= cost;
            
            // Stats objesinin varlığını kontrol et (image_7a4c43'teki hataları önler)
            if (!user.stats) {
                user.stats = { hp: 100, atk: 10, def: 10 };
            }

            // Stat tipine göre artır
            if (statType === 'hp') user.stats.hp += 10;
            else if (statType === 'atk') user.stats.atk += 2;
            else if (statType === 'def') user.stats.def += 2;

            user.markModified('stats'); // MongoDB'ye objenin değiştiğini bildir
            await user.save();

            return res.json({ 
                success: true, 
                newBpl: user.bpl, 
                newStats: user.stats 
            });
        }
        res.status(400).json({ success: false, message: "Bakiye yetersiz!" });
    } catch (err) {
        console.error("Upgrade Hatası:", err);
        res.status(500).json({ success: false });
    }
});

// --- WALLET SAYFASI ---
app.get('/wallet', isLoggedIn, (req, res) => {
    res.render('wallet', { 
        user: req.user,
        // image_78ec5a.png görselindeki ENV verileri
        contract: process.env.CONTRACT_ADDRESS,
        adminWallet: process.env.WALLET_ADDRESS
    });
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




