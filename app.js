require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const path = require('path');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcryptjs');

// Modeller (Paylaştığın dosya isimlerine göre)
const User = require('./models/User');
const Log = require('./models/Log');
const Payment = require('./models/Payment');
const Victory = require('./models/Victory');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// --- VERİTABANI BAĞLANTISI ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('MongoDB Atlas Bağlantısı Başarılı.'))
    .catch(err => console.error('Bağlantı Hatası:', err));

// --- GÜVENLİK VE YAPILANDIRMA ---
// Helmet: HTTP başlıklarını güvenli hale getirir (CSP esnetildi çünkü videoların oynaması lazım)
app.use(helmet({ contentSecurityPolicy: false })); 
app.use(mongoSanitize()); // NoSQL Injection koruması
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));

// --- SESSION SİSTEMİ ---
app.use(session({
    secret: process.env.SESSION_SECRET || 'bpl_gizli_anahtar_2025',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 } // 1 Günlük oturum
}));

// EJS Sayfalarına 'user' değişkenini global olarak gönder
app.use(async (req, res, next) => {
    if (req.session.userId) {
        const user = await User.findById(req.session.userId);
        res.locals.user = user;
    } else {
        res.locals.user = null;
    }
    next();
});

// --- ROUTER - TEMEL YÖNLENDİRMELER ---

// Ana Sayfa
app.get('/', (req, res) => {
    res.render('index');
});

// Kayıt Ol (POST)
app.post('/register', async (req, res) => {
    try {
        const { nickname, email, password } = req.body;
        const exists = await User.findOne({ $or: [{ email }, { nickname }] });
        if (exists) return res.send('<script>alert("Kullanıcı adı veya Email zaten var!"); window.location="/";</script>');

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({
            nickname,
            email,
            password: hashedPassword,
            bpl: 2500 // Başlangıç Hediyesi
        });
        await newUser.save();
        res.send('<script>alert("Kayıt Başarılı! Giriş Yapın."); window.location="/";</script>');
    } catch (err) {
        res.status(500).send("Kayıt hatası oluştu.");
    }
});

// Giriş Yap (POST)
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.send('<script>alert("Hatalı Bilgiler!"); window.location="/";</script>');
        }
        req.session.userId = user._id;
        res.redirect('/profil');
    } catch (err) {
        res.status(500).send("Giriş hatası.");
    }
});

// --- PROFİL VE ENVANTER İŞLEMLERİ ---

// Profil Sayfasını Görüntüle
app.get('/profil', async (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    try {
        const user = await User.findById(req.session.userId);
        res.render('profil', { user });
    } catch (err) {
        res.status(500).send("Sunucu hatası.");
    }
});

// Arena İçin Hayvan Seçimi (POST)
app.post('/select-animal', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ status: 'error' });
    
    const { animalName } = req.body;
    try {
        await User.findByIdAndUpdate(req.session.userId, {
            selectedAnimal: animalName
        });
        
        // Log Kaydı
        await Log.create({
            type: 'ARENA',
            content: `Kullanıcı savaş için ${animalName} seçti.`,
            userEmail: req.session.nickname // session'da sakladığımız nick
        });

        res.json({ status: 'success', message: `${animalName} seçildi.` });
    } catch (err) {
        res.status(500).json({ status: 'error' });
    }
});

// Enerji Yenileme (Stamina Refill - 10 BPL)
app.post('/refill-stamina', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ status: 'error' });

    const { animalName } = req.body;
    try {
        const user = await User.findById(req.session.userId);
        
        if (user.bpl < 10) {
            return res.json({ status: 'low_balance', message: 'Yetersiz BPL!' });
        }

        // Envanterdeki ilgili hayvanın enerjisini %100 yap
        const itemIndex = user.inventory.findIndex(item => item.name === animalName);
        if (itemIndex > -1) {
            user.inventory[itemIndex].stamina = 100;
            user.bpl -= 10; // Ücreti kes
            await user.save();
            
            res.json({ status: 'success', newBpl: user.bpl });
        } else {
            res.json({ status: 'not_found' });
        }
    } catch (err) {
        res.status(500).json({ status: 'error' });
    }
});






























// Çıkış Yap
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- SOCKET.IO (ARENA & CHAT MANTIĞI BAŞLANGICI) ---
io.on('connection', (socket) => {
    // Burada Arena eşleşmeleri, Chat ve Meeting odaları yönetilecek
    console.log('Aktif Bağlantı:', socket.id);
});

// Sunucuyu Başlat
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});

