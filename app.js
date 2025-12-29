// --- 1. MODÜLLER VE AYARLAR ---
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const path = require('path');

// --- 2. VERİTABANI VE MODELLER ---
const connectDB = require('./db');
const User = require('./models/User');
const Log = require('./models/Log');
const Payment = require('./models/Payment');
const Income = require('./models/Income');
const Victory = require('./models/Victory');
const Punishment = require('./models/Punishment');
const Withdrawal = require('./models/Withdrawal');

connectDB(); // MongoDB bağlantısını başlatır

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 10000;

// --- 3. MIDDLEWARE (ARA YAZILIMLAR) ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views')); //
app.use(express.static(path.join(__dirname, 'public'))); //
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.set('trust proxy', 1);

app.use(session({
    secret: 'bpl_ozel_anahtar',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 saat
}));

// --- 4. YARDIMCI FONKSİYONLAR & GLOBAL DEĞİŞKENLER ---
const checkAuth = (req, res, next) => {
    if (req.session.userId) next(); else res.redirect('/');
};

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.MAIL_USER, // Render'daki karşılığı
        pass: process.env.MAIL_APP_PASS // Render'daki karşılığı
    }
});

// --- KULLANICI KAYIT (REGISTER) ---
app.post('/register', async (req, res) => {
    const { nickname, email, password } = req.body;
    try {
        // 1. E-posta zaten kullanılıyor mu kontrol et
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.send('<script>alert("Bu e-posta zaten kayıtlı!"); window.location.href="/";</script>');
        }

        // 2. Yeni kullanıcıyı oluştur (Başlangıç parası: 2500 BPL)
        const newUser = new User({
            nickname,
            email,
            password,
            bpl: 2500, // Yeni gelen kumandana hoş geldin hediyesi
            inventory: []
        });

        // 3. Veritabanına kaydet
        await newUser.save();

        // 4. Log kaydı oluştur
        await new Log({ 
            type: 'REGISTER', 
            content: `Yeni kullanıcı katıldı: ${nickname}`, 
            userEmail: email 
        }).save();

        res.send('<script>alert("Kayıt başarılı! Şimdi giriş yapabilirsin."); window.location.href="/";</script>');
    } catch (err) {
        console.error("Kayıt Hatası:", err);
        res.status(500).send("Kayıt sırasında bir sunucu hatası oluştu.");
    }
});


// --- HAYVAN GELİŞTİRME (UPGRADE) ---
app.post('/upgrade-animal', checkAuth, async (req, res) => {
    const { animalIndex } = req.body;
    const upgradeCost = 50; // Her geliştirme 500 BPL olsun

    try {
        const user = await User.findById(req.session.userId);
        const animal = user.inventory[animalIndex];

        if (user.bpl < upgradeCost) {
            return res.json({ status: 'error', msg: 'Yetersiz BPL bakiyesi!' });
        }

        // İstatistikleri Ateşliyoruz
        animal.level += 1;
        animal.stats.hp += 20;  // Her seviyede +20 Can
        animal.stats.atk += 10; // Her seviyede +10 Saldırı

        user.bpl -= upgradeCost;
        user.markModified('inventory'); // MongoDB'ye envanterin değiştiğini haber ver
        await user.save();

        res.json({ 
            status: 'success', 
            msg: `${animal.name} seviye atladı! Yeni Seviye: ${animal.level}`,
            newBpl: user.bpl 
        });

    } catch (err) {
        res.status(500).json({ status: 'error', msg: 'Geliştirme başarısız.' });
    }
});








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

// --- 5. ANA ROTALAR ---

// FIX: Cannot GET / hatasını önleyen ana sayfa rotası
app.get('/', (req, res) => {
    res.render('index', { user: req.session.userId || null });
});

app.get('/profil', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('profil', { user }); //
});

app.get('/market', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('market', { user, animals: MARKET_ANIMALS }); //
});

// --- 6. İŞLEM ROTALARI (AUTH, MARKET, CONTACT) ---

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

// --- STAT GELİŞTİRME MERKEZİ ---
app.post('/upgrade-stat', checkAuth, async (req, res) => {
    const { animalName, statType, cost } = req.body;

    try {
        const user = await User.findById(req.session.userId);
        
        // Envanterde doğru hayvanı bul
        const animalIndex = user.inventory.findIndex(a => a.name === animalName);
        
        if (animalIndex === -1) return res.json({ status: 'error', msg: 'Hayvan bulunamadı!' });
        if (user.bpl < cost) return res.json({ status: 'error', msg: 'Bakiye yetersiz!' });

        const animal = user.inventory[animalIndex];

        // Geliştirme Mantığı
        switch(statType) {
            case 'hp': animal.stats.hp += 10; break;
            case 'atk': animal.stats.atk += 5; break;
            case 'def': animal.stats.def = (animal.stats.def || 0) + 5; break;
            case 'crit': animal.stats.crit = (animal.stats.crit || 0) + 5; break; // Yeni Özellik!
            case 'battleMode': 
                // Geçici güçlendirme mantığı buraya
                animal.stats.atk += 20; 
                break;
        }

        user.bpl -= cost;
        user.markModified('inventory'); // MongoDB'ye dizinin değiştiğini fısılda
        await user.save();

        res.json({ 
            status: 'success', 
            newBalance: user.bpl.toLocaleString(),
            msg: 'Gelişim tamamlandı!' 
        });

    } catch (err) {
        res.status(500).json({ status: 'error', msg: 'Sunucu hatası!' });
    }
});




app.post('/buy-animal', checkAuth, async (req, res) => {
    try {
        const { animalId } = req.body;
        const user = await User.findById(req.session.userId);
        const animal = MARKET_ANIMALS.find(a => a.id == animalId);

        if (!animal) return res.json({ status: 'error', msg: 'Karakter bulunamadı!' });
        if (user.inventory.length >= 3) return res.json({ status: 'error', msg: 'Çanta dolu! (Max 3)' });
        if (user.bpl < animal.price) return res.json({ status: 'error', msg: 'Bakiye yetersiz!' });

        user.bpl -= animal.price;
        user.inventory.push({
            name: animal.name,
            img: animal.img,
            level: 1,
            stats: { hp: 100, atk: 20 }
        });

        await user.save();
        await new Log({ type: 'MARKET', content: `${user.nickname} satın aldı: ${animal.name}`, userEmail: user.email }).save();

        res.json({ status: 'success', msg: `${animal.name} orduna katıldı!`, newBalance: user.bpl });
    } catch (err) {
        res.json({ status: 'error', msg: 'Sistem hatası!' });
    }
});

app.post('/contact', async (req, res) => {
    const { email, note } = req.body;
    try {
        await new Log({ type: 'CONTACT', content: note, userEmail: email, status: 'PENDING' }).save();
        await transporter.sendMail({
            from: process.env.MAIL_USER,
            to: process.env.MAIL_USER,
            subject: 'BPL Yeni Destek Mesajı',
            text: `Mesaj: ${note} \n Gönderen: ${email}`
        });
        res.send('<script>alert("Mesajın kumandana iletildi!"); window.location.href="/";</script>');
    } catch (err) { res.send('Hata oluştu!'); }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- 7. SUNUCU BAŞLATMA ---
server.listen(PORT, "0.0.0.0", () => {
    console.log(`
    =========================================
    BPL ECOSYSTEM OPERATIONAL ON PORT ${PORT}
    VERITABANI: BAGLANDI
    MAIL SISTEMI: AKTIF
    =========================================
    `);
});





