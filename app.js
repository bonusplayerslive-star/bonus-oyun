// --- 1. MODÜLLER ---
require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const path = require('path');
const bcrypt = require('bcryptjs');

// --- 2. VERİTABANI BAĞLANTISI ---
const connectDB = require('./db');
const User = require('./models/User');

connectDB(); // MongoDB Atlas Bağlantısı

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 10000;

// --- 3. MIDDLEWARE YAPILANDIRMASI ---
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// GÜNCELLEME: Loglardaki virgül hatası giderildi
app.use(session({
    secret: process.env.SESSION_SECRET || 'bpl_global_secret_key_2026',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ 
        mongoUrl: process.env.MONGO_URI,
        collectionName: 'sessions'
    }),
    cookie: { 
        secure: false, // Render HTTP üzerinden çalıştığı için false kalmalı
        maxAge: 24 * 60 * 60 * 1000 
    }
}));

// Global Kullanıcı Değişkeni (EJS tarafında user.bpl vb. erişimi sağlar)
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

// --- 4. AUTH SİSTEMİ (Giriş/Kayıt) ---

app.get('/', (req, res) => res.render('index'));

// KAYIT: Bcrypt ile şifreleme ve hediye BPL/Karakter
app.post('/register', async (req, res) => {
    const { nickname, email, password } = req.body;
    try {
        const exists = await User.findOne({ email });
        if (exists) return res.send('<script>alert("Bu e-posta kayıtlı!"); window.location.href="/";</script>');
        
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ 
            nickname, 
            email, 
            password: hashedPassword, 
            bpl: 2500,
            inventory: [
                { name: 'Eagle', level: 1, img: '/caracter/profile/eagle.jpg', stats: { hp: 150, atk: 30, def: 20 } },
                { name: 'Bear', level: 1, img: '/caracter/profile/bear.jpg', stats: { hp: 100, atk: 20, def: 15 } }
            ] 
        });
        await newUser.save();
        res.send('<script>alert("Kayıt Başarılı! 2500 BPL Hediye Edildi."); window.location.href="/";</script>');
    } catch (err) { res.status(500).send("Kayıt Hatası: " + err.message); }
});

// LOGIN: Atlas bağlantısını kontrol eder ve giriş yaptırır
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email });
        // Atlas'taki şifrelenmiş veri ile karşılaştırma yapar
        if (user && await bcrypt.compare(password, user.password)) {
            req.session.userId = user._id;
            req.session.user = user;
            
            // Session'ı DB'ye kaydeder ve yönlendirir
            return req.session.save(() => {
                res.redirect('/profil');
            });
        }
        res.send('<script>alert("Hatalı Giriş Bilgileri!"); window.location.href="/";</script>');
    } catch (err) { res.redirect('/'); }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- 5. PROFİL (Korumalı Rota) ---
app.get('/profil', async (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    try {
        const user = await User.findById(req.session.userId);
        res.render('profil', { user }); // Envanter görüntüsü burada render edilir
    } catch (err) { res.redirect('/'); }
});

// --- 6. SUNUCU BAŞLATMA ---
server.listen(PORT, "0.0.0.0", () => {
    console.log(`BPL ENGINE AKTİF: ${PORT}`);
});
