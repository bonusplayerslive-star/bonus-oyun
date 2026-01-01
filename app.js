require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const session = require('express-session');
const MongoStore = require('connect-mongo'); 
const mongoose = require('mongoose');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

// --- 1. VERİTABANI BAĞLANTISI ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB Atlas Bağlantısı Başarılı"))
    .catch(err => console.error("❌ MongoDB Hatası:", err));

const User = require('./models/User');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 10000;

// --- 2. MIDDLEWARE & AYARLAR ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Render HTTPS ve Proxy Desteği
app.set('trust proxy', 1);

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false, // Bahsettiğin "false" değerlerinden biri buydu, oturum çakışmasını önler
    saveUninitialized: false, // Boş oturum oluşturulmasını engeller, veritabanını şişirmez
    store: MongoStore.create({ 
        mongoUrl: process.env.MONGO_URI,
        collectionName: 'sessions',
        stringify: false, // Veriyi JSON olarak sakla (bahsettiğin ek ayarlardan biri)
        autoRemove: 'native' // MongoDB'nin kendi TTL indeksini kullanmasını sağlar
    }),
    cookie: { 
        secure: process.env.NODE_ENV === 'production', 
        sameSite: 'lax', 
        maxAge: 24 * 60 * 60 * 1000 
    }
}));
// --- 3. MAİL MOTORU (Şifremi Unuttum İçin) ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_APP_PASS
    }
});

// --- 4. ROTALAR (AUTH) ---

app.get('/', (req, res) => {
    if (req.session.userId) return res.redirect('/profil');
    res.render('index', { user: null });
});

// KAYIT (REGISTER)
app.post('/register', async (req, res) => {
    try {
        let { nickname, email, password } = req.body;
        const cleanEmail = email.trim().toLowerCase();
        
        const existingUser = await User.findOne({ $or: [{ email: cleanEmail }, { nickname: nickname.trim() }] });
        if (existingUser) return res.send('<script>alert("Email veya Nickname zaten kayıtlı!"); window.location.href="/";</script>');

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ 
            nickname: nickname.trim(), 
            email: cleanEmail, 
            password: hashedPassword, 
            bpl: 2500,
            inventory: [{ name: 'Eagle', level: 1, stats: { hp: 150, atk: 30, def: 10 } }] 
        });

        const savedUser = await newUser.save();
        
        // Kayıt sonrası otomatik login
        req.session.userId = savedUser._id;
        req.session.save((err) => {
            if (err) return res.redirect('/');
            res.redirect('/profil');
        });
    } catch (e) {
        console.error(e);
        res.status(500).send("Kayıt hatası oluştu.");
    }
});

// GİRİŞ (LOGIN)
app.post('/login', async (req, res) => {
    try {
        let { email, password } = req.body;
        const cleanEmail = email.trim().toLowerCase();

        const user = await User.findOne({ email: cleanEmail });
        if (!user) return res.send('<script>alert("Bu email adresi kayıtlı değil!"); window.location.href="/";</script>');

        const isMatch = await bcrypt.compare(password, user.password);
        if (isMatch) {
            req.session.userId = user._id;
            req.session.save((err) => {
                if (err) return res.status(500).send("Oturum kaydedilemedi.");
                res.redirect('/profil');
            });
        } else {
            res.send('<script>alert("Şifre yanlış!"); window.location.href="/";</script>');
        }
    } catch (error) {
        res.status(500).send("Sistem hatası.");
    }
});

// PROFİL (Giriş kontrolü dahil)
app.get('/profil', async (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    try {
        const user = await User.findById(req.session.userId);
        if (!user) return res.redirect('/logout');
        res.render('profil', { 
            user, 
            wallet: process.env.WALLET_ADDRESS,
            contract: process.env.CONTRACT_ADDRESS 
        });
    } catch (err) { res.redirect('/'); }
});

// --- 5. ŞİFREMİ UNUTTUM SİSTEMİ ---

app.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    try {
        const user = await User.findOne({ email: email.trim().toLowerCase() });
        if (!user) return res.send('<script>alert("Email bulunamadı!"); window.location.href="/";</script>');

        const token = crypto.randomBytes(20).toString('hex');
        user.resetPasswordToken = token;
        user.resetPasswordExpires = Date.now() + 3600000; // 1 saat geçerli
        await user.save();

        const resetLink = `https://bonus-oyun.onrender.com/reset/${token}`;
        
        await transporter.sendMail({
            to: user.email,
            subject: 'BPL ECOSYSTEM - Şifre Sıfırlama',
            html: `<h3>Şifrenizi sıfırlamak için <a href="${resetLink}">buraya tıklayın</a>.</h3>`
        });

        res.send('<script>alert("Sıfırlama maili gönderildi!"); window.location.href="/";</script>');
    } catch (err) { res.status(500).send("İşlem başarısız."); }
});

// ÇIKIŞ
app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.redirect('/');
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 BPL Sunucusu Hazır | Port: ${PORT}`);
});

