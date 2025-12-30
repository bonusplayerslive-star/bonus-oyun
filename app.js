const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const app = express();

// --- 🛡️ Güvenli Şifreleme (bcryptjs Gerektirmez) ---
const hashPassword = (p) => p ? crypto.scryptSync(p, 'bonus-salt-123', 64).toString('hex') : '';
const comparePassword = (p, h) => p && h ? crypto.scryptSync(p, 'bonus-salt-123', 64).toString('hex') === h : false;

// --- ⚙️ Middleware ---
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');

app.use(session({
    secret: process.env.SESSION_SECRET || 'gizli_bonus',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

// --- 🍃 MongoDB Bağlantısı ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('Sistem Aktif: MongoDB Bağlantısı Başarılı'))
    .catch(err => console.error('Bağlantı Hatası:', err));

// --- 📂 8 Modelin Tamamı Dahil Edildi ---
const User = require('./models/User');
const ArenaLog = require('./models/ArenaLogs');
const Income = require('./models/Income');
const Log = require('./models/Log');
const Payment = require('./models/Payment');
const Punishment = require('./models/Punishment');
const Victory = require('./models/Victory');
const Withdrawal = require('./models/Withdrawal');

// --- 🚀 Rotalar (Routes) ---

app.get('/', (req, res) => res.render('index', { user: req.session.user || null }));

// KAYIT OL (400 Hatası Çözümü)
app.post('/register', async (req, res) => {
    try {
        // Formundaki 'name' etiketlerine göre veriyi çekiyoruz
        const username = req.body.username || req.body.operator_nickname; 
        const email = req.body.email || req.body.email_address;
        const password = req.body.password || req.body.secure_password;

        if (!username || !email || !password) {
            return res.status(400).send(`Eksik veri! Gelenler: Username: ${username}, Email: ${email}`);
        }

        const newUser = new User({
            username,
            email,
            password: hashPassword(password),
            bpl: 100
        });

        await newUser.save();
        res.redirect('/');
    } catch (error) {
        res.status(500).send("Sunucu hatası: " + error.message);
    }
});

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

app.get('/profil', async (req, res) => {
    if (!req.session.user) return res.redirect('/');
    const user = await User.findById(req.session.user._id);
    res.render('profil', { user });
});

app.get('/arena', (req, res) => res.render('arena', { user: req.session.user }));
app.get('/market', (req, res) => res.render('market', { user: req.session.user }));
app.get('/wallet', (req, res) => res.render('wallet', { user: req.session.user }));

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Port ${PORT} üzerinde sistem hazır!`));
