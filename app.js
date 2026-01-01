// --- 1. MODÜLLER VE AYARLAR ---
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const MongoStore = require('connect-mongo'); // require('connect-mongo').default; yerine bu daha güvenlidir
const mongoose = require('mongoose');
const path = require('path');
const bcrypt = require('bcryptjs');

// --- 2. VERİTABANI VE MODELLER ---
const connectDB = require('./db');
const User = require('./models/User');
const Log = require('./models/Log');
const Victory = require('./models/Victory');
const Punishment = require('./models/Punishment');

connectDB();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 10000;

// --- 3. MIDDLEWARE ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.set('trust proxy', 1);

// OTURUM YÖNETİMİ (v6.0.0 HATASIZ YAPI)
app.use(session({
    secret: process.env.SESSION_SECRET || 'bpl_global_key_2026',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ 
        mongoUrl: process.env.MONGO_URI,
        collectionName: 'sessions',
        ttl: 14 * 24 * 60 * 60 
    }),
    cookie: { 
        secure: process.env.NODE_ENV === 'production', 
        maxAge: 24 * 60 * 60 * 1000 
    }
}));

// Oturum Kontrolü Middleware
const checkAuth = (req, res, next) => {
    if (req.session.userId) return next();
    res.redirect('/');
};

// --- 4. ROTALAR ---

app.get('/', (req, res) => {
    if (req.session.userId) return res.redirect('/profil');
    res.render('index', { user: null });
});

// KAYIT (REGISTER) - Kayıttan sonra direkt giriş yaptırır
app.post('/register', async (req, res) => {
    try {
        let { nickname, email, password } = req.body;
        const cleanEmail = email.trim().toLowerCase();
        
        const existingUser = await User.findOne({ email: cleanEmail });
        if (existingUser) return res.send('<script>alert("Bu email zaten kayıtlı!"); window.location.href="/";</script>');

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ 
            nickname: nickname.trim(), 
            email: cleanEmail, 
            password: hashedPassword, 
            bpl: 2500,
            inventory: [{ name: 'Eagle', level: 1, stats: { hp: 150, atk: 30 } }] 
        });

        const savedUser = await newUser.save();
        
        // ÖNEMLİ: Kayıt olduktan sonra oturumu hemen açıyoruz
        req.session.userId = savedUser._id;
        req.session.save((err) => {
            if (err) return res.redirect('/');
            res.send('<script>alert("Hoş geldiniz! 2500 BPL hesabınıza yüklendi."); window.location.href="/profil";</script>');
        });

    } catch (e) {
        console.error("Kayıt hatası:", e);
        res.status(500).send("Kayıt hatası.");
    }
});

// GİRİŞ (LOGIN)
app.post('/login', async (req, res) => {
    try {
        let { email, password } = req.body;
        const cleanEmail = email.trim().toLowerCase();

        const user = await User.findOne({ email: cleanEmail });
        if (!user) return res.send('<script>alert("Email kayıtlı değil!"); window.location.href="/";</script>');

        const isMatch = await bcrypt.compare(password, user.password);
        if (isMatch) {
            req.session.userId = user._id;
            req.session.save((err) => {
                if (err) return res.send("Oturum hatası.");
                res.redirect('/profil');
            });
        } else {
            res.send('<script>alert("Şifre yanlış!"); window.location.href="/";</script>');
        }
    } catch (error) {
        res.status(500).send("Sistem hatası.");
    }
});

app.get('/profil', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        if (!user) return res.redirect('/logout');
        res.render('profil', { user });
    } catch (err) { res.redirect('/'); }
});

// --- 5. ARENA VE MARKET ---

app.get('/market', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    const animals = [
        { id: 1, name: 'Tiger', price: 1000, img: '/caracter/profile/tiger.jpg' },
        { id: 2, name: 'Lion', price: 1000, img: '/caracter/profile/lion.jpg' },
        { id: 3, name: 'Eagle', price: 1000, img: '/caracter/profile/eagle.jpg' }
    ];
    res.render('market', { user, animals });
});

app.post('/attack-bot', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const isWin = Math.random() > 0.6; // %60 Kayıp

        if (isWin) {
            user.bpl += 200;
            await new Victory({ userEmail: user.email, amount: 200, opponent: "Elite Bot" }).save();
        } else {
            user.bpl = Math.max(0, user.bpl - 200);
            await new Punishment({ userEmail: user.email, amount: 200, reason: "Arena Yenilgisi" }).save();
        }

        await user.save();
        res.json({ status: 'success', isWin, newBalance: user.bpl });
    } catch (err) { res.status(500).json({ status: 'error' }); }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`BPL ECOSYSTEM AKTİF - PORT: ${PORT}`);
});
