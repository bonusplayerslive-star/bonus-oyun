/**
 * BPL ULTIMATE - CORE APPLICATION
 */
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const sessionMiddleware = session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ 
        mongoUrl: MONGO_URI, 
        ttl: 24 * 60 * 60 
    }),
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
});
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');

const User = require('./models/User');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// --- 1. VERİTABANI VE SESSION ---
const MONGO_URI = process.env.MONGO_URI;
const SESSION_SECRET = process.env.SESSION_SECRET || 'bpl_ultimate_secret_2024';

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Bağlandı'))
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

// --- 2. MIDDLEWARES ---
app.use(async (req, res, next) => {
    res.locals.user = null;
    if (req.session && req.session.userId) {
        try {
            const user = await User.findById(req.session.userId);
            if (user) res.locals.user = user;
        } catch (e) { console.error("Middleware Hatası:", e); }
    }
    next();
});

const authRequired = (req, res, next) => {
    if (req.session && req.session.userId) return next();
    res.redirect('/');
};

const adminRequired = (req, res, next) => {
    if (res.locals.user && res.locals.user.role === 'admin') return next();
    res.status(403).send("Admin yetkisi gerekiyor.");
};

// --- 3. AUTH ROTALARI ---
app.get('/', (req, res) => {
    if (req.session.userId) return res.redirect('/profil');
    res.render('index', { title: 'BPL Ultimate' });
});

// --- AUTH ROTALARI ---
app.post('/auth/register', async (req, res) => {
    const { nickname, email, password } = req.body;
    try {
        const existing = await User.findOne({ $or: [{ email: email.toLowerCase() }, { nickname: nickname.trim() }] });
        if (existing) return res.status(400).send("Bu bilgiler zaten kullanımda.");

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

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
        res.status(500).send("Kayıt başarısız: " + err.message);
    }
});

app.post('/register', (req, res) => res.redirect(307, '/auth/register'));

app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email: email.toLowerCase().trim() });
        if (!user) return res.status(400).send("Kullanıcı bulunamadı.");
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).send("Şifre yanlış.");
        req.session.userId = user._id;
        res.redirect('/profil');
    } catch (err) { res.status(500).send("Giriş hatası."); }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- 4. OYUN SAYFALARI ---
app.get('/profil', authRequired, (req, res) => res.render('profil', { user: res.locals.user }));
app.get('/market', authRequired, (req, res) => res.render('market', { user: res.locals.user }));
app.get('/arena', authRequired, (req, res) => res.render('arena', { user: res.locals.user }));
app.get('/development', authRequired, (req, res) => res.render('development', { user: res.locals.user }));
app.get('/wallet', authRequired, (req, res) => res.render('wallet', { user: res.locals.user }));
app.get('/meeting', authRequired, (req, res) => res.render('meeting', { user: res.locals.user }));

// --- 5. MARKET VE GELİŞTİRME API ---
app.post('/api/buy-item', authRequired, async (req, res) => {
    const { itemName, price } = req.body;
    try {
        const user = await User.findById(req.session.userId);
        if (user.inventory.length >= 3) return res.status(400).json({ success: false, error: 'Karakter sınırı 3!' });
        if (user.bpl < price) return res.status(400).json({ success: false, error: 'Bakiye yetersiz!' });
        
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

app.post('/api/upgrade-stat', authRequired, async (req, res) => {
    const { animalName, statType } = req.body;
    const cost = (statType === 'def') ? 10 : 15;
    try {
        const user = await User.findById(req.session.userId);
        if (user.bpl < cost) return res.status(400).json({ success: false, error: 'Yetersiz BPL.' });
        const idx = user.inventory.findIndex(a => a.name === animalName);
        if (idx === -1) return res.status(404).json({ success: false });

        let increase = (statType === 'hp') ? 10 : 5;
        user.bpl -= cost;
        if (statType === 'hp') {
            user.inventory[idx].maxHp += increase;
            user.inventory[idx].hp = user.inventory[idx].maxHp;
        } else {
            user.inventory[idx][statType] += increase;
        }
        await user.save();
        res.json({ success: true, newBalance: user.bpl });
    } catch (err) { res.status(500).json({ success: false }); }
});

// --- 6. ADMIN VE SOCKET ---
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

    socket.on('start-bot-battle', async (data) => {
        const myAnimal = user.inventory.find(a => a.name === user.selectedAnimal);
        if (!myAnimal || myAnimal.stamina < 10) return socket.emit('error', { msg: "Stamina az!" });
        const isWin = Math.random() > 0.4;
        const prize = isWin ? (120 * data.multiplier) : 0;
        socket.emit('battle-result', { isWin, prize, opponentName: "Bot", opponentAnimal: "Wolf" });
        // Stat güncelleme mantığı buraya eklenebilir
    });

    socket.on('disconnect', () => onlineUsers.delete(user.nickname));
});

// --- 7. HATA YAKALAMA VE START ---
app.use((req, res) => res.status(404).render('error', { message: 'Sayfa bulunamadı!', user: res.locals.user }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Sunucu ${PORT} üzerinde aktif!`));


