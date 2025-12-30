// --- 1. MODÜLLER VE AYARLAR ---
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const path = require('path');

const connectDB = require('./db');
const User = require('./models/User');
const Payment = require('./models/Payment');

connectDB();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 10000;

// --- 2. SABİT VERİLER (Klasör adlarıyla birebir aynı olmalı) ---
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

// --- 3. MIDDLEWARE ---
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: 'bpl_secret_key_2024',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// Giriş kontrolü
const checkAuth = (req, res, next) => {
    if (req.session.userId) next(); else res.redirect('/');
};

// --- 4. SAYFA YÖNLENDİRMELERİ (GET) ---
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
    // İlk hayvanı seçili getir, yoksa "Eagle" varsay
    const selected = user.inventory && user.inventory.length > 0 ? user.inventory[0].name : "Eagle";
    res.render('arena', { user, selectedAnimal: selected });
});

app.get('/development', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('development', { user });
});

app.get('/wallet', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('wallet', { user });
});

app.get('/meeting', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        if (user.bpl < 50) return res.render('profil', { user, error: 'Konsey girişi 50 BPL!' });
        user.bpl -= 50; await user.save();
        res.render('meeting', { user, roomId: "BPL-VIP-KONSEY" });
    } catch (e) { res.redirect('/profil'); }
});

// --- 5. OYUN VE İŞLEM MANTIĞI (POST) ---

// Arena Savaşı (Bot)
app.post('/attack-bot', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        if (!user || user.bpl < 200) return res.json({ status: 'error', msg: 'Yetersiz BPL! (Min: 200)' });
        
        const animalName = req.body.animal || "Eagle"; 
        const isWin = Math.random() > 0.45; // %55 şans

        user.bpl += isWin ? 200 : -200;
        await user.save();

        if (isWin) {
            io.to('Global').emit('new-message', { 
                sender: "ARENA", 
                text: `🏆 ${user.nickname} botu mağlup etti ve 200 BPL kazandı!` 
            });
        }

        res.json({
            status: 'success',
            animation: { 
                actionVideo: `/caracter/move/${animalName}/${animalName}1.mp4`, 
                winVideo: `/caracter/move/${animalName}/${animalName}.mp4`, 
                isWin 
            },
            newBalance: user.bpl
        });
    } catch (err) { res.status(500).json({ status: 'error', msg: 'Savaş başlatılamadı.' }); }
});

// Karakter Geliştirme (Upgrade)
app.post('/upgrade-stat', checkAuth, async (req, res) => {
    const { animalName, statType, cost } = req.body;
    try {
        const user = await User.findById(req.session.userId);
        const animal = user.inventory.find(a => a.name === animalName);
        
        if (!animal || user.bpl < cost) {
            return res.json({ status: 'error', msg: 'Bakiye yetersiz veya karakter bulunamadı.' });
        }

        // İstatistik artırımı
        if(statType === 'hp') animal.stats.hp += 10;
        else if(statType === 'atk') animal.stats.atk += 5;
        else if(statType === 'def') animal.stats.def = (animal.stats.def || 0) + 5;

        user.bpl -= cost;
        user.markModified('inventory'); // Array içindeki değişiklikleri Mongoose'a bildir
        await user.save();
        
        res.json({ status: 'success', msg: `${statType.toUpperCase()} başarıyla artırıldı!`, newBalance: user.bpl });
    } catch (e) { res.json({ status: 'error', msg: 'Geliştirme hatası.' }); }
});

// --- 6. SOCKET.IO SİSTEMİ ---
io.on('connection', (socket) => {
    console.log('Bir kullanıcı bağlandı:', socket.id);

    socket.on('register-user', (data) => {
        if(data && data.id) {
            socket.userId = data.id;
            socket.nickname = data.nickname;
            socket.join('Global');
        }
    });

    socket.on('chat-message', (data) => {
        io.to(data.room || 'Global').emit('new-message', { 
            sender: socket.nickname || "Misafir", 
            text: data.text 
        });
    });

    socket.on('join-meeting', (roomId) => {
        socket.join(roomId);
        io.to(roomId).emit('new-message', { 
            sender: "SİSTEM", 
            text: `🔥 ${socket.nickname || 'Bir üye'} konseye katıldı.` 
        });
    });

    socket.on('disconnect', () => {
        console.log('Kullanıcı ayrıldı.');
    });
});

// --- 7. SUNUCU BAŞLATMA ---
server.listen(PORT, "0.0.0.0", () => {
    console.log(`
    =========================================
    🚀 BPL ECOSYSTEM AKTİF
    📡 PORT: ${PORT}
    🔗 MOD: Üretim (Production)
    =========================================
    `);
});
