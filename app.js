// --- 1. MODÜLLER VE GÜVENLİK ---
require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const path = require('path');
const bcrypt = require('bcryptjs');

// --- 2. VERİTABANI VE MODELLER ---
const connectDB = require('./db');
const User = require('./models/User');
const ArenaLog = require('./models/ArenaLogs');

connectDB();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 10000;

// --- 3. MIDDLEWARE YAPILANDIRMASI ---
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Loglardaki virgül hatası burada giderildi
app.use(session({
    secret: process.env.SESSION_SECRET || 'bpl_global_secret_key_2026',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
    cookie: { 
        secure: false, // Render HTTP üzerinden çalıştığı için false kalmalı
        maxAge: 24 * 60 * 60 * 1000 
    }
}));

// Global Kullanıcı Değişkeni
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

// Yetki Kontrolü (Giriş yapmayanları ana sayfaya atar)
const checkAuth = (req, res, next) => {
    if (req.session.userId) return next();
    res.redirect('/');
};

// --- 4. AUTH SİSTEMİ (Giriş/Kayıt) ---

// Kayıt: 2500 BPL + Eagle Karakteri
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
                { name: 'Eagle', level: 1, img: '/caracter/profile/eagle.jpg', stats: { hp: 150, atk: 30, def: 20 } }
            ] 
        });
        await newUser.save();
        res.send('<script>alert("Kayıt Başarılı! 2500 BPL Tanımlandı."); window.location.href="/";</script>');
    } catch (err) { res.status(500).send("Kayıt sırasında hata oluştu."); }
});

// Login: Bcrypt Karşılaştırmalı ve Session Kayıtlı
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email });
        if (user && await bcrypt.compare(password, user.password)) {
            req.session.userId = user._id;
            req.session.user = user;
            
            // Session'ı DB'ye kaydet ve yönlendir
            return req.session.save(() => {
                res.redirect('/profil');
            });
        }
        res.send('<script>alert("E-posta veya şifre hatalı!"); window.location.href="/";</script>');
    } catch (err) { res.redirect('/'); }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- 5. KOMUTA MERKEZİ ROTALARI ---

app.get('/profil', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        res.render('profil', { user });
    } catch (err) { res.redirect('/logout'); }
});

app.get('/market', checkAuth, (req, res) => res.render('market'));
app.get('/development', checkAuth, (req, res) => res.render('development'));
app.get('/arena', checkAuth, (req, res) => res.render('arena'));
app.get('/wallet', checkAuth, (req, res) => res.render('wallet'));
app.get('/meeting/:roomId', checkAuth, (req, res) => res.render('meeting', { roomId: req.params.roomId }));

// --- 6. SOCKET.IO (Chat ve Arena) ---
io.on('connection', (socket) => {
    socket.on('join-chat', (nickname) => {
        socket.nickname = nickname;
        socket.join('GlobalChat');
    });

    socket.on('chat-message', (msg) => {
        io.to('GlobalChat').emit('new-message', {
            sender: socket.nickname || "Misafir",
            text: msg
        });
    });
});

// --- 7. SUNUCU BAŞLATMA ---
server.listen(PORT, "0.0.0.0", () => {
    console.log(`BPL ENGINE AKTİF: ${PORT}`);
});
