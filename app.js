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

// --- 1. AYARLAR VE VERİTABANI ---
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

// Giriş Kontrol Middleware
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

// --- 2. SAYFA ROTALARI (EJS) ---

// ANA SAYFA
app.get('/', (req, res) => res.render('index'));

// PROFİL
app.get('/profil', isLoggedIn, (req, res) => res.render('profil', { user: req.user }));

// MARKET
app.get('/market', isLoggedIn, (req, res) => {
    const animalData = [
        { name: "Tiger", price: 2000, hp: 90, atk: 95 },
        { name: "Lion", price: 2500, hp: 85, atk: 90 },
        { name: "Bear", price: 1000, hp: 120, atk: 70 },
        { name: "Crocodile", price: 1500, hp: 110, atk: 80 },
        { name: "Falcon", price: 1000, hp: 60, atk: 95 },
        { name: "Gorilla", price: 5000, hp: 150, atk: 85 },
        { name: "Rhino", price: 3000, hp: 180, atk: 60 },
        { name: "Snake", price: 800, hp: 50, atk: 100 },
        { name: "Eagle", price: 1200, hp: 60, atk: 95 },
        { name: "Wolf", price: 1100, hp: 70, atk: 85 }
    ];

    const processedAnimals = animalData.map(a => ({
        ...a,
        imagePath: `/caracter/profile/${a.name}.jpg` 
    }));
    res.render('market', { user: req.user, animals: processedAnimals });
});

// GELİŞTİRME MERKEZİ
app.get('/development', isLoggedIn, (req, res) => {
    const char = req.user.selectedAnimal || "Tiger";
    // ÖNEMLİ: Dosya yolu hatası düzeltildi (Slash eklendi)
    const charImg = `/caracter/profile/${char}.jpg`; 
    res.render('development', { user: req.user, charImg });
});

// ARENA
app.get('/arena', isLoggedIn, (req, res) => {
    const char = req.user.selectedAnimal || "Tiger";
    const profileImg = `/caracter/profile/${char}.jpg`;
    const videoData = {
        idle: `/caracter/move/${char}/${char}.mp4`,
        attack: `/caracter/move/${char}/${char}1.mp4`
    };
    res.render('arena', { user: req.user, videoData, profileImg, char });
});

// CÜZDAN & ÖDEME
app.get('/wallet', isLoggedIn, (req, res) => {
    res.render('wallet', { 
        user: req.user,
        contract: process.env.CONTRACT_ADDRESS || '0x...',
        wallet: process.env.WALLET_ADDRESS || '0x...'
    });
});

// DİĞER SAYFALAR
app.get('/chat', isLoggedIn, (req, res) => res.render('chat', { user: req.user }));
app.get('/meeting', isLoggedIn, (req, res) => res.render('meeting', { user: req.user }));

// --- 3. API İŞLEMLERİ ---

// Geliştirme (Stat Upgrade)
app.post('/api/upgrade-stat', isLoggedIn, async (req, res) => {
    try {
        const { statType, animalName } = req.body;
        const user = await User.findById(req.user._id);
        const cost = (statType === 'def') ? 10 : 15;

        if (user.bpl >= cost) {
            user.bpl -= cost;
            // Envanterdeki ilgili hayvanın statlarını bul ve artır
            const animal = user.inventory.find(a => a.name === animalName);
            if (animal) {
                if (!animal.stats) animal.stats = { hp: 100, atk: 10, def: 10 };
                
                if (statType === 'hp') animal.hp += 10;
                else if (statType === 'atk') animal.atk += 5;
                else if (statType === 'def') animal.def += 5;

                user.markModified('inventory');
                await user.save();
                return res.json({ success: true, newBalance: user.bpl });
            }
        }
        res.status(400).json({ success: false, message: "Yetersiz BPL veya Hayvan Bulunamadı!" });
    } catch (err) { res.status(500).json({ success: false }); }
});

// --- 4. SOCKET.IO (CHAT SİSTEMİ) ---
io.on('connection', (socket) => {
    socket.on('register-user', (data) => {
        socket.nickname = data.nickname;
        console.log(`👤 ${data.nickname} bağlandı.`);
    });

    socket.on('send-global-msg', (data) => {
        io.emit('receive-global-msg', {
            sender: socket.nickname || 'Misafir',
            text: data.text,
            time: new Date().toLocaleTimeString()
        });
    });

    socket.on('disconnect', () => {
        console.log('❌ Bir kullanıcı ayrıldı.');
    });
});

// --- BAŞLAT ---
const PORT = process.env.PORT || 10000;
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`
    🚀 ============================================
       BPL SISTEM PORT ${PORT} ÜZERİNDE AKTİF
       MOD: Üretim (Production)
    ===============================================
    `);
});
