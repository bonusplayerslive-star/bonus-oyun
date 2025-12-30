// --- 1. MODÜLLER VE GÜVENLİK ---
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const path = require('path');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

// Veritabanı Bağlantısı
const connectDB = require('./db');
connectDB();

// Modeller (Görsel image_2f2d08.png'deki tam liste)
const User = require('./models/User');
const Payment = require('./models/Payment');
const ArenaLogs = require('./models/ArenaLogs');
const Victory = require('./models/Victory');
const Punishment = require('./models/Punishment');
const Income = require('./models/Income');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 10000;

// --- 2. MARKET VERİLERİ (Büyük/Küçük Harf Duyarlı) ---
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

// --- 3. MIDDLEWARE AYARLARI ---
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: 'bpl_mega_ecosystem_2025_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// Giriş Kontrolü
const checkAuth = (req, res, next) => {
    if (req.session.userId) return next();
    res.redirect('/');
};

// --- 4. AUTH & KAYIT SİSTEMİ (Cannot POST /login Çözümü) ---
app.post('/register', async (req, res) => {
    try {
        const { nickname, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ 
            nickname, 
            password: hashedPassword, 
            bpl: 1000, // Hoşgeldin bonusu
            inventory: [{ name: 'Eagle', stats: { hp: 100, atk: 20, def: 10 }, level: 1 }] 
        });
        await newUser.save();
        res.redirect('/');
    } catch (e) { res.status(500).send("Kayıt sırasında hata oluştu: " + e.message); }
});

app.post('/login', async (req, res) => {
    try {
        const { nickname, password } = req.body;
        const user = await User.findOne({ nickname });
        if (user && await bcrypt.compare(password, user.password)) {
            req.session.userId = user._id;
            return res.redirect('/profil');
        }
        res.send("<script>alert('Hatalı bilgiler!'); window.location='/';</script>");
    } catch (e) { res.status(500).send("Giriş hatası!"); }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- 5. SAYFA YÖNLENDİRMELERİ ---
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

// Beşgen Masa (Meeting) Sayfası ve Rotaları
app.get('/meeting', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('meeting', { user, roomId: "BPL-CENTRAL" });
});

app.post('/create-meeting', checkAuth, (req, res) => {
    // Toplantı odası oluşturma mantığı buraya gelir
    res.redirect('/meeting');
});

// --- 6. GELİŞMİŞ OYUN MANTIĞI (HEDİYE & CEZA & LOGLAMA) ---

app.post('/attack-bot', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        if (user.bpl < 150) return res.json({ status: 'error', msg: 'Savaş maliyeti 150 BPL!' });

        const animalName = req.body.animal;
        const randomVal = Math.random();
        let isWin = randomVal > 0.45; // %55 kazanma şansı
        let amount = isWin ? 300 : -150;
        let message = isWin ? "Zafer! 300 BPL kazandın." : "Mağlubiyet! 150 BPL kaybettin.";

        // Kritik Hediye Sistemi
        if (isWin && randomVal > 0.92) {
            amount = 1500;
            message = "🔥 EFSANEVİ ZAFER! 1500 BPL HEDİYE KAZANDIN!";
            await Victory.create({ userId: user._id, amount: 1500, type: 'Legendary' });
        } else if (!isWin) {
            await Punishment.create({ userId: user._id, amount: 150, reason: 'Arena Loss' });
        }

        user.bpl += amount;
        await user.save();

        // Arena Log Kaydı
        await ArenaLogs.create({ userId: user._id, animal: animalName, result: isWin ? 'Win' : 'Loss', change: amount });

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
    } catch (e) { res.status(500).json({ status: 'error', msg: 'Sistem hatası.' }); }
});

// Karakter Geliştirme (Upgrade)
app.post('/upgrade-stat', checkAuth, async (req, res) => {
    const { animalName, statType, cost } = req.body;
    try {
        const user = await User.findById(req.session.userId);
        const animal = user.inventory.find(a => a.name === animalName);

        if (!animal || user.bpl < cost) return res.json({ status: 'error', msg: 'Bakiye veya Karakter geçersiz.' });

        if (statType === 'hp') animal.stats.hp += 20;
        else if (statType === 'atk') animal.stats.atk += 10;
        else if (statType === 'def') animal.stats.def += 5;

        user.bpl -= cost;
        user.markModified('inventory');
        await user.save();

        res.json({ status: 'success', msg: `${statType.toUpperCase()} Seviyesi Yükseltildi!`, newBalance: user.bpl });
    } catch (e) { res.json({ status: 'error', msg: 'Geliştirme başarısız.' }); }
});

// --- 7. SOCKET.IO GERÇEK ZAMANLI SİSTEMLER ---
io.on('connection', (socket) => {
    console.log('Kullanıcı Bağlandı:', socket.id);

    socket.on('register-session', (data) => {
        socket.nickname = data.nickname;
        socket.join('GlobalRoom');
    });

    socket.on('chat-message', (data) => {
        io.to('GlobalRoom').emit('new-message', {
            sender: socket.nickname || 'Anonim',
            text: data.text,
            time: new Date().toLocaleTimeString()
        });
    });

    socket.on('disconnect', () => {
        console.log('Kullanıcı Ayrıldı.');
    });
});

// --- 8. SUNUCU BAŞLATMA ---
server.listen(PORT, "0.0.0.0", () => {
    console.log(`
    ██████╗ ██████╗ ██╗     
    ██╔══██╗██╔══██╗██║     
    ██████╔╝██████╔╝██║     
    ██╔══██╗██╔═══╝ ██║     
    ██████╔╝██║     ███████╗
    ╚═════╝ ╚═╝     ╚══════╝
    BPL ECOSYSTEM AKTİF: http://localhost:${PORT}
    `);
});
