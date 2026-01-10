/**
 * BPL ULTIMATE - FULL SYSTEM (ARENA, MARKET, MEETING, WALLET)
 */
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo').default;
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');

const User = require('./models/User');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// --- 1. VERİTABANI VE SESSION GÜVENLİĞİ ---
const MONGO_URI = process.env.MONGO_URI;
const SESSION_SECRET = process.env.SESSION_SECRET || 'bpl_ultimate_megasecret_2024';

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Bağlantısı Başarılı'))
    .catch(err => console.error('❌ MongoDB Hatası:', err));

app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionMiddleware = session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: MONGO_URI, ttl: 24 * 60 * 60 }),
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
});
app.use(sessionMiddleware);

io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
});

// --- 2. GLOBAL KULLANICI YÖNETİMİ ---
app.use(async (req, res, next) => {
    res.locals.user = null;
    if (req.session && req.session.userId) {
        try {
            const user = await User.findById(req.session.userId);
            if (user) res.locals.user = user;
        } catch (e) { console.error("Session Hatası:", e); }
    }
    next();
});

const authRequired = (req, res, next) => {
    if (req.session && req.session.userId) return next();
    res.redirect('/');
};

// --- 3. AUTH (KAYIT VE GİRİŞ) SİSTEMİ ---
app.get('/', (req, res) => {
    if (req.session.userId) return res.redirect('/profil');
    res.render('index', { title: 'BPL Ultimate' });
});

// Kayıt rotasındaki 404 hatası ve parantez hataları burada çözüldü
app.post('/register', async (req, res) => {
    const { nickname, email, password } = req.body;
    try {
        const existing = await User.findOne({ $or: [{ email: email.toLowerCase() }, { nickname: nickname.trim() }] });
        if (existing) return res.status(400).send("Bu bilgiler kullanımda.");

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({
            nickname: nickname.trim(),
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            bpl: 2500,
            inventory: [],
            selectedAnimal: "none",
            stats: { wins: 0, losses: 0 }
        });

        const savedUser = await newUser.save();
        req.session.userId = savedUser._id;
        res.redirect('/profil');
    } catch (err) {
        console.error("Kayıt Hatası:", err);
        res.status(500).send("Sistem hatası: " + err.message);
    }
});

// --- 4. TÜM OYUN SAYFALARI (SAVAŞ, MARKET, DAVET, CÜZDAN) ---
app.get('/profil', authRequired, (req, res) => res.render('profil', { user: res.locals.user }));
app.get('/market', authRequired, (req, res) => res.render('market', { user: res.locals.user }));
app.get('/arena', authRequired, (req, res) => res.render('arena', { user: res.locals.user }));
app.get('/development', authRequired, (req, res) => res.render('development', { user: res.locals.user }));
app.get('/wallet', authRequired, (req, res) => res.render('wallet', { user: res.locals.user }));
app.get('/meeting', authRequired, (req, res) => res.render('meeting', { user: res.locals.user }));

// --- 5. MARKET API (HEDİYE/SATIN ALMA) ---
app.post('/api/buy-item', authRequired, async (req, res) => {
    const { itemName, price } = req.body;
    try {
        const user = await User.findById(req.session.userId);
        if (user.bpl < price) return res.status(400).json({ success: false, error: 'BPL Yetersiz!' });
        
        user.bpl -= price;
        user.inventory.push({
            name: itemName,
            img: `/caracter/profile/${itemName}.jpg`,
            stamina: 100, hp: 100, maxHp: 100, atk: 50, def: 30, level: 1
        });
        await user.save();
        res.json({ success: true, newBpl: user.bpl });
    } catch (err) { res.status(500).json({ success: false }); }
});

// --- 6. ARENA VE CHAT (SAVAŞ SİSTEMİ) ---
const onlineUsers = new Map();
io.on('connection', async (socket) => {
    const uId = socket.request.session?.userId;
    if (!uId) return;
    const user = await User.findById(uId);
    if (!user) return;
    
    onlineUsers.set(user.nickname, socket.id);
    socket.join("general-chat");

    socket.on('chat-message', (data) => {
        io.to("general-chat").emit('new-message', { sender: user.nickname, text: data.text });
    });

    socket.on('disconnect', () => onlineUsers.delete(user.nickname));
});

// --- 7. SUNUCU BAŞLATMA ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 BPL ULTIMATE TÜM SİSTEMLER AKTİF: ${PORT}`));
