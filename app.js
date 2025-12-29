require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const mongoose = require('mongoose');
const axios = require('axios');
const nodemailer = require('nodemailer');

// --- VERİTABANI BAĞLANTISI VE MODELLER ---
const connectDB = require('./db');
const User = require('./models/User');
const Log = require('./models/Log');
const Payment = require('./models/Payment');
const Victory = require('./models/Victory');
const Punishment = require('./models/Punishment');
const Income = require('./models/Income');
const Withdrawal = require('./models/Withdrawal');

connectDB();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 10000;
app.set('trust proxy', 1);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
    secret: 'bpl_ozel_anahtar',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));
app.set('view engine', 'ejs');

// --- GLOBAL DEĞİŞKENLER & AUTH ---
const onlineUsers = {}; 
const busyUsers = new Set();

const checkAuth = (req, res, next) => {
    if (req.session.userId) next(); else res.redirect('/');
};

// --- NODEMAILER (GMAIL SMTP) ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS // Gmail "Uygulama Şifresi" kullanılmalı
    }
});

// --- MARKET KATALOĞU ---
const MARKET_ANIMALS = [
    { id: 1, name: 'Bear', price: 1000, img: '/caracter/profile/bear.jpg' },
    { id: 2, name: 'Crocodile', price: 1000, img: '/caracter/profile/crocodile.jpg' },
    { id: 3, name: 'Eagle', price: 1000, img: '/caracter/profile/eagle.jpg' },
    { id: 4, name: 'Gorilla', price: 5000, img: '/caracter/profile/gorilla.jpg' },
    { id: 5, name: 'Kurd', price: 1000, img: '/caracter/profile/kurd.jpg' },
    { id: 6, name: 'Lion', price: 5000, img: '/caracter/profile/lion.jpg' },
    { id: 7, name: 'Falcon', price: 1000, img: '/caracter/profile/peregrinefalcon.jpg' },
    { id: 8, name: 'Rhino', price: 5000, img: '/caracter/profile/rhino.jpg' },
    { id: 9, name: 'Snake', price: 1000, img: '/caracter/profile/snake.jpg' },
    { id: 10, name: 'Tiger', price: 5000, img: '/caracter/profile/tiger.jpg' }
];

// ==========================================
// 1. MARKET (SATIN ALMA) - FIX: UNDEFINED HATASI ÇÖZÜMÜ
// ==========================================
app.post('/buy-animal', checkAuth, async (req, res) => {
    try {
        const { animalId } = req.body;
        const user = await User.findById(req.session.userId);
        const animal = MARKET_ANIMALS.find(a => a.id == animalId);

        if (!animal) return res.json({ status: 'error', msg: 'Karakter bulunamadı!' });
        if (user.inventory.length >= 3) return res.json({ status: 'error', msg: 'Çanta dolu! (Max 3)' });
        if (user.bpl < animal.price) return res.json({ status: 'error', msg: 'Bakiye yetersiz!' });

        // Ödeme ve Envanter Ekleme
        user.bpl -= animal.price;
        user.inventory.push({
            name: animal.name,
            img: animal.img,
            level: 1,
            stats: { hp: 100, atk: 20 }
        });

        await user.save();
        
        // Log Kaydı
        await new Log({ type: 'MARKET', content: `${user.nickname} satın aldı: ${animal.name}`, userEmail: user.email }).save();

        res.json({ status: 'success', msg: `${animal.name} orduna katıldı!`, newBalance: user.bpl });
    } catch (err) {
        res.json({ status: 'error', msg: 'Sistem hatası!' });
    }
});

// ==========================================
// 2. İLETİŞİM & ŞİFRE (NODEMAILER & LOG)
// ==========================================
app.post('/contact', async (req, res) => {
    const { email, note } = req.body;
    try {
        // Hem Log'a kaydet hem admin'e mail at
        await new Log({ type: 'CONTACT', content: note, userEmail: email, status: 'PENDING' }).save();
        
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: process.env.EMAIL_USER, // Bildirim sana gelsin
            subject: 'BPL Yeni Destek Mesajı',
            text: `Mesaj: ${note} \n Gönderen: ${email}`
        });
        res.send('<script>alert("Mesajın kumandana iletildi!"); window.location.href="/";</script>');
    } catch (err) { res.send('Hata oluştu!'); }
});

app.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) return res.send('Kullanıcı bulunamadı!');

        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'BPL Şifre Kurtarma',
            text: `Selam Kumandan ${user.nickname}, şifren: ${user.password}`
        });
        
        await new Log({ type: 'FORGOT_PASSWORD', content: 'Şifre sıfırlama talebi gönderildi', userEmail: email }).save();
        res.send('<script>alert("Şifren e-postana gönderildi!"); window.location.href="/";</script>');
    } catch (err) { res.send('Mail gönderilemedi!'); }
});

// ==========================================
// 3. ARENA VE CÜZDAN (TEMEL ROTALAR)
// ==========================================
app.get('/profil', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('profil', { user }); // Yeni profile.ejs ile tam uyumlu
});

app.get('/market', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('market', { user, animals: MARKET_ANIMALS });
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email, password });
    if (user) { 
        req.session.userId = user._id; 
        await new Log({ type: 'LOGIN', content: 'Giriş yapıldı', userEmail: email }).save();
        res.redirect('/profil'); 
    } else {
        res.send('<script>alert("Hatalı giriş!"); window.location.href="/";</script>');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- SERVER BAŞLATMA ---
server.listen(PORT, "0.0.0.0", () => {
    console.log(`
    =========================================
    BPL ECOSYSTEM OPERATIONAL ON PORT ${PORT}
    VERITABANI: BAGLANDI
    MAIL SISTEMI: AKTIF
    MARKET: HAZIR
    =========================================
    `);
});
