const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const crypto = require('crypto'); // bcryptjs yerine yerleşik crypto modülü
require('dotenv').config();

const app = express();

// --- Şifreleme Fonksiyonları (bcrypt yerine) ---
const hashPassword = (password) => {
    // 'salt-key' kısmını daha güvenli bir kelimeyle değiştirebilirsin
    return crypto.scryptSync(password, 'bonus-salt-123', 64).toString('hex');
};

const comparePassword = (inputPassword, storedHash) => {
    const hash = crypto.scryptSync(inputPassword, 'bonus-salt-123', 64).toString('hex');
    return hash === storedHash;
};

// --- Middleware ---
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');

app.use(session({
    secret: 'bonus_secret_key',
    resave: false,
    saveUninitialized: true
}));

// --- MongoDB Bağlantısı ---
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/bonus_game')
    .then(() => console.log('MongoDB Bağlantısı Başarılı'))
    .catch(err => console.error('Bağlantı Hatası:', err));

// --- Modeller (Klasör yapına göre) ---
const User = require('./models/User');

// --- Rotalar (Routes) ---

// Ana Sayfa
app.get('/', (req, res) => {
    res.render('index', { user: req.session.user });
});

// Kayıt Ol (Register)
app.post('/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        const hashedPassword = hashPassword(password); // Yeni şifreleme metodu
        
        const newUser = new User({
            username,
            email,
            password: hashedPassword,
            bpl: 100 // Başlangıç puanı
        });

        await newUser.save();
        res.redirect('/login');
    } catch (error) {
        res.status(500).send("Kayıt sırasında hata oluştu.");
    }
});

// Giriş Yap (Login)
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (user && comparePassword(password, user.password)) { // Yeni karşılaştırma metodu
        req.session.user = user;
        res.redirect('/profil');
    } else {
        res.send('Hatalı e-posta veya şifre!');
    }
});

// Profil Sayfası (Karakterlerin göründüğü yer)
app.get('/profil', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    res.render('profil', { user: req.session.user });
});

// Çıkış
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// Port Ayarı
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Sistem Aktif: Port ${PORT}`);
});
