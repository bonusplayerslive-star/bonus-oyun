// --- 1. MODÜLLER VE GÜVENLİK YAPILANDIRMASI ---
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const path = require('path');
const bcrypt = require('bcryptjs'); // Render logundaki "Module Not Found" hatası için kritik
const mongoose = require('mongoose');

// Veritabanı Bağlantısı
const connectDB = require('./db');
connectDB();

// MODELLER (Görsel image_2f2d08.png'deki tam liste)
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

// --- 2. MARKET VE KARAKTER VERİLERİ (Büyük/Küçük Harf Duyarlı) ---
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

// --- 3. MIDDLEWARE (ARA KATMAN) AYARLARI ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: 'BPL_MEGA_SYSTEM_SECRET_2025',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// Kimlik Doğrulama Kontrolü
const checkAuth = (req, res, next) => {
    if (req.session.userId) return next();
    res.redirect('/');
};

// --- 4. AUTH SİSTEMİ (Login/Register Hataları İçin) ---

// Giriş (Cannot POST /login hatasını çözer)
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
    } catch (e) { res.status(500).send("Sunucu Hatası: " + e.message); }
});

// Kayıt
app.post('/register', async (req, res) => {
    try {
        const { nickname, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ 
            nickname, 
            password: hashedPassword, 
            bpl: 1000, 
            inventory: [{ name: 'Eagle', stats: { hp: 100, atk: 20, def: 10 }, level: 1 }] 
        });
        await newUser.save();
        res.redirect('/');
    } catch (e) { res.status(500).send("Kayıt başarısız."); }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- 5. TEMEL SAYFA ROTALARI ---

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
    const selected = user.inventory.length > 0 ? user.inventory[0].name : "Eagle";
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

app.get('/payment', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('payment', { user });
});

app.get('/meeting', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('meeting', { user });
});

// Beşgen Masa (Cannot POST /create-meeting hatasını çözer)
app.post('/create-meeting', checkAuth, (req, res) => {
    res.redirect('/meeting');
});

// --- 6. ARENA VE EKONOMİ SİSTEMİ (Hediye/Ceza Mantığı) ---

app.post('/attack-bot', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const animalName = req.body.animal;
        
        const luck = Math.random();
        let isWin = luck > 0.45; // %55 kazanma şansı
        let reward = isWin ? 250 : -150;
        let message = isWin ? "Savaşı Kazandın!" : "Savaşı Kaybettin!";

        // Efsanevi Hediye Sistemi
        if (isWin && luck > 0.95) {
            reward = 2000;
            message = "🔥 KRİTİK BAŞARI! 2000 BPL HEDİYE KAZANDIN!";
            await Victory.create({ userId: user._id, amount: 2000, type: 'Jackpot' });
        } else if (!isWin) {
            await Punishment.create({ userId: user._id, amount: 150, reason: 'Arena Mağlubiyeti' });
        }

        user.bpl += reward;
        await user.save();

        // Log Kayıtları
        await ArenaLogs.create({ userId: user._id, animal: animalName, result: isWin ? 'Win' : 'Loss', change: reward });

        res.json({
            status: 'success',
            msg: message,
            newBalance: user.bpl,
            animation: {
                actionVideo: `/caracter/move/${animalName}/${animalName}1.mp4`,
                winVideo: `/caracter/move/${animalName}/${animalName}.mp4`,
                isWin
            }
        });
    } catch (e) { res.status(500).json({ status: 'error' }); }
});

// Karakter Geliştirme (Upgrade)
app.post('/upgrade-stat', checkAuth, async (req, res) => {
    try {
        const { animalName, statType, cost } = req.body;
        const user = await User.findById(req.session.userId);
        const animal = user.inventory.find(a => a.name === animalName);

        if (!animal || user.bpl < cost) return res.json({ status: 'error', msg: 'İşlem reddedildi.' });

        if (statType === 'hp') animal.stats.hp += 20;
        else if (statType === 'atk') animal.stats.atk += 10;
        else if (statType === 'def') animal.stats.def += 5;

        user.bpl -= cost;
        user.markModified('inventory');
        await user.save();
        await Log.create({ userId: user._id, action: `Upgrade ${statType}`, details: animalName });

        res.json({ status: 'success', msg: 'Geliştirme Tamamlandı!', newBalance: user.bpl });
    } catch (e) { res.json({ status: 'error' }); }
});

// --- 7. CANLI ETKİLEŞİM (Socket.io) ---
io.on('connection', (socket) => {
    socket.on('chat-message', (data) => {
        io.emit('new-message', { user: data.nickname, text: data.message });
    });
});

// --- 8. SUNUCU BAŞLATMA ---
server.listen(PORT, "0.0.0.0", () => {
    console.log(`
    ===========================================
    BPL MEGA ECOSYSTEM AKTİF: PORT ${PORT}
    DURUM: TÜM SİSTEMLER ÇALIŞIYOR
    ===========================================
    `);
});
