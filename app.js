// Path: app.js

// --- 1. MODÜLLER ---
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const path = require('path');
require('dotenv').config();

const User = require('./models/User');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { 
    cors: { origin: "*" },
    allowEIO3: true 
});

// --- 2. VERİTABANI BAĞLANTISI ---
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://bonusplayerslive_db_user:1nB1QyAsh3qVafpE@bonus.x39zlzq.mongodb.net/?appName=Bonus";

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Bağlantısı Başarılı'))
    .catch(err => console.error('❌ MongoDB Hatası:', err));

// --- 3. MIDDLEWARE & SESSION ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'bpl_cyber_secret_2025',
    resave: false,
    saveUninitialized: false,
    store: (typeof MongoStore.create === 'function') 
        ? MongoStore.create({ mongoUrl: MONGO_URI, collectionName: 'sessions' })
        : new MongoStore({ mongoUrl: MONGO_URI, collectionName: 'sessions' }),
    cookie: { 
        secure: false, 
        maxAge: 1000 * 60 * 60 * 24 
    }
});

app.use(sessionMiddleware);
io.engine.use(sessionMiddleware); 

// Güvenlik Kapısı (Middleware)
async function isLoggedIn(req, res, next) {
    if (req.session && req.session.userId) {
        try {
            const user = await User.findById(req.session.userId);
            if (user) {
                req.user = user;
                res.locals.user = user;
                return next();
            }
        } catch (err) { console.error("Session hatası:", err); }
    }
    res.redirect('/login');
}

// --- 4. ROTALAR (ROUTES) ---

app.get('/', (req, res) => {
    if (req.session.userId) return res.redirect('/profil');
    res.render('index'); 
});

app.get('/login', (req, res) => res.render('index'));

app.get('/profil', isLoggedIn, (req, res) => {
    res.render('profil', { user: req.user });
});

// Arena Sistemi (Büyük harf duyarlılığı için optimize edildi)
app.get('/arena', isLoggedIn, (req, res) => {
    // Karakter isminin ilk harfini büyük yaparak gönder (Örn: lion -> Lion)
    const charName = req.user.selectedAnimal || "Tiger";
    const formattedChar = charName.charAt(0).toUpperCase() + charName.slice(1).toLowerCase();
    res.render('arena', { user: req.user, formattedChar });
});

// Yeni Eklenen Rotalar (404 Hatalarını Çözer)
app.get('/market', isLoggedIn, (req, res) => res.render('market', { user: req.user }));
app.get('/wallet', isLoggedIn, (req, res) => res.render('wallet', { user: req.user }));
app.get('/development', isLoggedIn, (req, res) => res.render('development', { user: req.user }));
app.get('/chat', isLoggedIn, (req, res) => res.render('chat', { user: req.user }));
app.get('/meeting', isLoggedIn, (req, res) => res.render('meeting', { user: req.user }));

// Karakter Geliştirme (POST API)
app.post('/upgrade-character', isLoggedIn, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        const cost = 500; 
        if (user.bpl >= cost) {
            user.bpl -= cost;
            user.level = (user.level || 1) + 1;
            await user.save();
            return res.json({ success: true, newBpl: user.bpl, newLevel: user.level });
        }
        res.status(400).json({ success: false, message: "Yetersiz bakiye!" });
    } catch (err) { res.status(500).json({ success: false }); }
});

// AUTH İŞLEMLERİ
app.post('/register', async (req, res) => {
    try {
        const { nickname, email, password } = req.body;
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.send("<script>alert('E-posta kayıtlı!'); window.location='/';</script>");
        
        // Başlangıç değerleri (İlk harf büyük: Tiger)
        const newUser = new User({ 
            nickname, email, password, 
            bpl: 2500, inventory: [], selectedAnimal: 'Tiger', level: 1 
        });
        await newUser.save();
        req.session.userId = newUser._id;
        res.redirect('/profil');
    } catch (err) { res.status(500).send("Hata: " + err.message); }
});

app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email, password });
        if (user) {
            req.session.userId = user._id;
            res.redirect('/profil');
        } else {
            res.send("<script>alert('Hatalı giriş!'); window.location='/';</script>");
        }
    } catch (err) { res.status(500).send("Giriş başarısız."); }
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// --- 5. SOCKET.IO (GERÇEK ZAMANLI İŞLEMLER) ---
io.on('connection', async (socket) => {
    const session = socket.request.session;
    if (session && session.userId) {
        const user = await User.findById(session.userId);
        if (user) {
            socket.userId = user._id;
            socket.nickname = user.nickname;
        }
    }

    socket.on('chat-message', (data) => {
        io.emit('new-message', {
            sender: socket.nickname || "Misafir",
            text: data.text,
            time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
        });
    });

    // Arena Savaş Mantığı
    socket.on('start-bot-battle', async (data) => {
        try {
            const user = await User.findById(socket.userId);
            if(!user) return;

            const isWin = Math.random() > 0.5;
            const prize = isWin ? 100 : -50;
            
            user.bpl += prize;
            if (user.bpl < 0) user.bpl = 0;
            await user.save();

            socket.emit('update-bpl', user.bpl);
            // Savaş bittiğinde sonucu büyük harf formatıyla döndür
            socket.emit('battle-result', { 
                isWin, 
                prize, 
                newBpl: user.bpl,
                charName: user.selectedAnimal // "Lion", "Tiger" vb.
            });
        } catch (e) { console.log(e); }
    });
});

// --- 6. BAŞLAT ---
const PORT = process.env.PORT || 10000;
httpServer.listen(PORT, '0.0.0.0', () => console.log(`🚀 BPL Sistemi Yayında: Port ${PORT}`));
