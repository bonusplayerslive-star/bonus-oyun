const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const app = express();

// --- 🛡️ Güvenli Şifreleme (Render Dostu) ---
const hashPassword = (password) => crypto.scryptSync(password, 'bonus-salt-key-123', 64).toString('hex');
const comparePassword = (inputPassword, storedHash) => crypto.scryptSync(inputPassword, 'bonus-salt-key-123', 64).toString('hex') === storedHash;

// --- ⚙️ Middleware & Görünüm Ayarları ---
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
    secret: process.env.SESSION_SECRET || 'gizli_bonus_anahtari',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 } 
}));

// --- 🍃 MongoDB Bağlantısı ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('Sistem Aktif: MongoDB Bağlantısı Başarılı'))
    .catch(err => console.error('Bağlantı Hatası:', err));

// --- 📂 Tüm Modelleri Bağlama (Görseldeki Liste) ---
const User = require('./models/User');
const ArenaLog = require('./models/ArenaLogs');
const Income = require('./models/Income');
const Log = require('./models/Log');
const Payment = require('./models/Payment');
const Punishment = require('./models/Punishment');
const Victory = require('./models/Victory');
const Withdrawal = require('./models/Withdrawal');

// --- 🚀 Uygulama Rotaları (Routes) ---

// 1. Ana Sayfa & Giriş Paneli
app.get('/', (req, res) => res.render('index', { user: req.session.user || null }));

// 2. Profil (Kullanıcı Verisi & Karakterler)
app.get('/profil', async (req, res) => {
    if (!req.session.user) return res.redirect('/');
    const userData = await User.findById(req.session.user._id);
    const userLogs = await Log.find({ userId: userData._id }).limit(5); // Son aktiviteler
    res.render('profil', { user: userData, logs: userLogs });
});

// 3. Arena (Savaş Kayıtları İle Birlikte)
app.get('/arena', async (req, res) => {
    if (!req.session.user) return res.redirect('/');
    const logs = await ArenaLog.find().sort({ createdAt: -1 }).limit(10);
    const victories = await Victory.find({ userId: req.session.user._id });
    res.render('arena', { user: req.session.user, logs, victories });
});

// 4. Market & Gelirler (Income)
app.get('/market', async (req, res) => {
    if (!req.session.user) return res.redirect('/');
    const incomes = await Income.find(); 
    res.render('market', { user: req.session.user, incomes });
});

// 5. Cüzdan, Ödemeler & Çekimler (Payment & Withdrawal)
app.get('/wallet', async (req, res) => {
    if (!req.session.user) return res.redirect('/');
    const payments = await Payment.find({ userId: req.session.user._id });
    const withdrawals = await Withdrawal.find({ userId: req.session.user._id });
    res.render('wallet', { user: req.session.user, payments, withdrawals });
});

// 6. Ceza Kontrolü (Punishment)
app.get('/status', async (req, res) => {
    if (!req.session.user) return res.redirect('/');
    const punishment = await Punishment.findOne({ userId: req.session.user._id, active: true });
    res.json(punishment || { message: "Temiz" });
});

// 7. Kayıt & Giriş Mantığı
app.post('/register', async (req, res) => {
    const { username, email, password } = req.body;
    const newUser = new User({ username, email, password: hashPassword(password), bpl: 100 });
    await newUser.save();
    res.redirect('/');
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (user && comparePassword(password, user.password)) {
        req.session.user = user;
        res.redirect('/profil');
    } else {
        res.send('Hatalı bilgiler!');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- 🌐 Port Ayarı ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Sistem Aktif: Port ${PORT}`));
