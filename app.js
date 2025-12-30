const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const app = express();

// --- 🛡️ Hata Vermeyen Şifreleme Fonksiyonları ---
const hashPassword = (password) => {
    if (!password) return '';
    return crypto.scryptSync(password, 'bonus-salt-key-123', 64).toString('hex');
};

const comparePassword = (inputPassword, storedHash) => {
    if (!inputPassword || !storedHash) return false;
    const hash = crypto.scryptSync(inputPassword, 'bonus-salt-key-123', 64).toString('hex');
    return hash === storedHash;
};

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
    .then(() => console.log('MongoDB Bağlantısı Başarılı'))
    .catch(err => console.error('Bağlantı Hatası:', err));

// --- 📂 8 Farklı Modelin Tamamı ---
const User = require('./models/User');
const ArenaLog = require('./models/ArenaLogs');
const Income = require('./models/Income');
const Log = require('./models/Log');
const Payment = require('./models/Payment');
const Punishment = require('./models/Punishment');
const Victory = require('./models/Victory');
const Withdrawal = require('./models/Withdrawal');

// --- 🚀 Rotalar (Routes) ---

// 1. Ana Sayfa (index.ejs)
app.get('/', (req, res) => res.render('index', { user: req.session.user || null }));

// 2. Kayıt İşlemi (Hata Onarıldı)
app.post('/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        if (!username || !email || !password) return res.status(400).send("Tüm alanları doldurun.");

        const hashedPassword = hashPassword(password);
        const newUser = new User({
            username,
            email,
            password: hashedPassword,
            bpl: 100,
            caracters: [] // Boş bir karakter dizisiyle başla
        });

        await newUser.save();
        res.redirect('/');
    } catch (error) {
        console.error("Register Hatası:", error);
        res.status(500).send("Kayıt sırasında hata oluştu. Lütfen bilgileri kontrol edin.");
    }
});

// 3. Giriş İşlemi
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });

        if (user && comparePassword(password, user.password)) {
            req.session.user = user;
            res.redirect('/profil');
        } else {
            res.send('Hatalı bilgiler! <a href="/">Geri Dön</a>');
        }
    } catch (error) {
        res.status(500).send("Giriş hatası.");
    }
});

// 4. Profil Sayfası (Karakter Resimleri Dahil)
app.get('/profil', async (req, res) => {
    if (!req.session.user) return res.redirect('/');
    const userData = await User.findById(req.session.user._id);
    const logs = await Log.find({ userId: userData._id }).sort({ createdAt: -1 }).limit(5);
    res.render('profil', { user: userData, logs });
});

// 5. Arena, Market, Wallet (Tüm Görünümler)
app.get('/arena', async (req, res) => {
    if (!req.session.user) return res.redirect('/');
    const logs = await ArenaLog.find().sort({ createdAt: -1 }).limit(10);
    res.render('arena', { user: req.session.user, logs });
});

app.get('/market', async (req, res) => {
    if (!req.session.user) return res.redirect('/');
    const items = await Income.find(); 
    res.render('market', { user: req.session.user, items });
});

app.get('/wallet', async (req, res) => {
    if (!req.session.user) return res.redirect('/');
    const history = await Payment.find({ userId: req.session.user._id });
    res.render('wallet', { user: req.session.user, history });
});

// 6. Çıkış
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- 🌐 Port Ayarı ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Bombayı Patlattık: Port ${PORT}`));
