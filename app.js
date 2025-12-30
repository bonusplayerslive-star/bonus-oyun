const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const app = express();

// --- 🛡️ Hata Onarıcı Şifreleme (bcryptjs bağımlılığı yoktur) ---
const hashPassword = (p) => p ? crypto.scryptSync(p, 'bonus-salt-123', 64).toString('hex') : '';
const comparePassword = (p, h) => p && h ? crypto.scryptSync(p, 'bonus-salt-123', 64).toString('hex') === h : false;

// --- ⚙️ Middleware Ayarları ---
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
    secret: process.env.SESSION_SECRET || 'bonus_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

// --- 🍃 MongoDB Bağlantısı ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('Sistem Aktif: MongoDB Bağlantısı Başarılı'))
    .catch(err => console.error('Bağlantı Hatası:', err));

// --- 📂 8 Farklı Modelin Sisteme Dahil Edilmesi ---
const User = require('./models/User');
const ArenaLog = require('./models/ArenaLogs');
const Income = require('./models/Income');
const Log = require('./models/Log');
const Payment = require('./models/Payment');
const Punishment = require('./models/Punishment');
const Victory = require('./models/Victory');
const Withdrawal = require('./models/Withdrawal');

// --- 🚀 Uygulama Rotaları (Routes) ---

// 1. Ana Sayfa & Giriş
app.get('/', (req, res) => res.render('index', { user: req.session.user || null }));

// 2. Kayıt İşlemi (400 Hatasını Alan Kısım Burası)
app.post('/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        // Eğer bu alanlar boşsa 400 hatası döner
        if (!username || !email || !password) return res.status(400).send("Tüm alanları doldurun.");

        const newUser = new User({
            username,
            email,
            password: hashPassword(password),
            bpl: 100, // Başlangıç parası
            caracters: [] // Boş karakter dizisi
        });

        await newUser.save();
        res.redirect('/');
    } catch (error) {
        console.error(error);
        res.status(500).send("Kayıt sırasında teknik bir hata oluştu.");
    }
});

// 3. Giriş İşlemi
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (user && comparePassword(password, user.password)) {
        req.session.user = user;
        res.redirect('/profil');
    } else {
        res.send('Hatalı bilgiler! <a href="/">Geri Dön</a>');
    }
});

// 4. Profil Sayfası (Karakter Resimleri İle)
app.get('/profil', async (req, res) => {
    if (!req.session.user) return res.redirect('/');
    const user = await User.findById(req.session.user._id);
    const logs = await Log.find({ userId: user._id }).sort({ createdAt: -1 }).limit(5);
    res.render('profil', { user, logs });
});

// 5. Arena & Savaş Kayıtları
app.get('/arena', async (req, res) => {
    if (!req.session.user) return res.redirect('/');
    const arenaLogs = await ArenaLog.find().sort({ createdAt: -1 }).limit(10);
    const userVictories = await Victory.find({ userId: req.session.user._id });
    res.render('arena', { user: req.session.user, arenaLogs, userVictories });
});

// 6. Market & Gelirler (Income)
app.get('/market', async (req, res) => {
    if (!req.session.user) return res.redirect('/');
    const marketItems = await Income.find(); 
    res.render('market', { user: req.session.user, marketItems });
});

// 7. Cüzdan & Ödemeler (Payment & Withdrawal)
app.get('/wallet', async (req, res) => {
    if (!req.session.user) return res.redirect('/');
    const payments = await Payment.find({ userId: req.session.user._id });
    const withdrawals = await Withdrawal.find({ userId: req.session.user._id });
    res.render('wallet', { user: req.session.user, payments, withdrawals });
});

// 8. Çıkış
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- 🌐 Port Ayarı ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Bombayı Patlattık! Port: ${PORT}`));
