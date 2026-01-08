require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo').default;
const path = require('path');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcryptjs');
const nodemailer = require("nodemailer");

// Modeller
const User = require('./models/User');
const Log = require('./models/Log');
const Payment = require('./models/Payment');
// Not: Victory veya Withdraw modelin varsa require etmeyi unutma

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// --- VERİTABANI BAĞLANTISI ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('🛡️ MongoDB Atlas Bağlantısı Başarılı.'))
    .catch(err => console.error('❌ Bağlantı Hatası:', err));

// --- GÜVENLİK VE YAPILANDIRMA ---
app.use(helmet({ contentSecurityPolicy: false })); 
app.use(mongoSanitize());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));

// --- SESSION SİSTEMİ ---
const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'bpl_gizli_anahtar_2025',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 } // 1 Günlük
});

app.use(sessionMiddleware);

// Socket.io Session Entegrasyonu (KRİTİK)
io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
});

// --- MIDDLEWARES ---
const isAdmin = (req, res, next) => {
    if (req.session.userId && req.session.user && req.session.user.role === 'admin') {
        return next();
    }
    res.status(403).send('Erişim Engellendi: Bu alan sadece yöneticiler içindir.');
};

// EJS Sayfalarına 'user' değişkenini global olarak gönder
app.use(async (req, res, next) => {
    if (req.session.userId) {
        try {
            const user = await User.findById(req.session.userId);
            res.locals.user = user;
            req.session.user = user; // Session'ı güncel tut
        } catch (err) {
            res.locals.user = null;
        }
    } else {
        res.locals.user = null;
    }
    next();
});

// --- GET ROUTES (SAYFALAR) ---

app.get('/', (req, res) => {
    if (req.session.userId) return res.redirect('/profil');
    res.render('index');
});

app.get('/profil', async (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    try {
        const user = await User.findById(req.session.userId);
        res.render('profil', { user });
    } catch (err) { res.status(500).send("Profil hatası."); }
});

app.get('/market', async (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    try {
        const user = await User.findById(req.session.userId);
        res.render('market', { user });
    } catch (err) { res.status(500).send("Market hatası."); }
});

app.get('/arena', async (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    try {
        const user = await User.findById(req.session.userId);
        res.render('arena', { user });
    } catch (err) { res.status(500).send("Arena hatası."); }
});

app.get('/admin', isAdmin, async (req, res) => {
    try {
        const payments = await Payment.find({ status: 'pending' }).populate('userId');
        res.render('admin', { payments });
    } catch (err) { res.status(500).send("Admin hatası."); }
});

app.get('/wallet', async (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    try {
        const user = await User.findById(req.session.userId);
        const payments = await Payment.find({ userId: user._id }).sort({ createdAt: -1 });
        res.render('wallet', { user, payments });
    } catch (err) { res.status(500).send("Cüzdan hatası."); }
});

app.get('/leaderboard', async (req, res) => {
    try {
        const topPlayers = await User.find({}).sort({ bpl: -1 }).limit(10).select('nickname bpl selectedAnimal');
        res.render('leaderboard', { topPlayers });
    } catch (err) { res.status(500).send("Sıralama hatası."); }
});

// --- AUTH & POST ROUTES ---

app.post('/register', async (req, res) => {
    try {
        const { nickname, email, password } = req.body;
        const exists = await User.findOne({ $or: [{ email }, { nickname }] });
        if (exists) return res.send('<script>alert("Kullanıcı adı veya Email zaten var!"); window.location="/";</script>');

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ nickname, email, password: hashedPassword, bpl: 2500 });
        await newUser.save();
        res.send('<script>alert("Kayıt Başarılı! Giriş Yapın."); window.location="/";</script>');
    } catch (err) { res.status(500).send("Kayıt hatası."); }
});

app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.send('<script>alert("Hatalı Bilgiler!"); window.location="/";</script>');
        }
        if (user.role === 'banned') return res.send(`SÜRGÜN EDİLDİNİZ! Neden: ${user.banReason}`);

        req.session.userId = user._id;
        req.session.user = user;
        res.redirect('/profil');
    } catch (err) { res.status(500).send("Giriş hatası."); }
});

// --- MARKET & GAME LOGIC ---

app.post('/api/buy-item', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ success: false });
    const { itemName, price } = req.body;
    const SAFETY_LIMIT = 5500;

    try {
        const user = await User.findById(req.session.userId);
        if (user.bpl - price < SAFETY_LIMIT) return res.status(400).json({ success: false, error: 'Limit engeli!' });
        if (user.inventory.some(item => item.name === itemName)) return res.status(400).json({ success: false, error: 'Zaten sahipsiniz.' });

        user.bpl -= price;
        // app.js içindeki /api/buy-item kısmında bul ve değiştir:
user.inventory.push({
    name: itemName,
    // itemName 'Tiger' olarak geliyorsa, yol tam olarak /caracter/profile/Tiger.jpg olur
    img: `/caracter/profile/${itemName}.jpg`, 
    stamina: 100,
    level: 1,
    stats: { hp: 100, atk: 70, def: 50 }
});
        await user.save();
        res.json({ success: true, newBpl: user.bpl });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/api/upgrade-stat', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ success: false });
    const { animalName, statType } = req.body;
    const costs = { hp: 15, atk: 15, def: 10 };
    const gains = { hp: 10, atk: 5, def: 5 };

    try {
        const user = await User.findById(req.session.userId);
        const animal = user.inventory.find(a => a.name === animalName);
        if (!animal || user.bpl < costs[statType]) return res.status(400).json({ success: false });

        user.bpl -= costs[statType];
        animal.stats[statType] += gains[statType];
        user.markModified('inventory');
        await user.save();
        res.json({ success: true, newBalance: user.bpl });
    } catch (err) { res.status(500).json({ success: false }); }
});

// --- ADMIN OPERATIONS ---

app.post('/admin/approve-payment', isAdmin, async (req, res) => {
    const { paymentId } = req.body;
    try {
        const payment = await Payment.findById(paymentId).populate('userId');
        if (!payment || payment.status !== 'pending') return res.json({ msg: 'Geçersiz işlem.' });

        payment.userId.bpl += payment.amount_bpl;
        payment.status = 'approved';
        await payment.userId.save();
        await payment.save();

        res.json({ msg: 'Ödeme onaylandı.' });
    } catch (err) { res.status(500).json({ msg: 'Onay hatası.' }); }
});

app.post('/admin/ban-user', isAdmin, async (req, res) => {
    const { userId, reason } = req.body;
    try {
        await User.findByIdAndUpdate(userId, { role: 'banned', banReason: reason });
        res.json({ msg: 'Kullanıcı yasaklandı.' });
    } catch (err) { res.status(500).json({ msg: 'Hata.' }); }
});

// --- SOCKET.IO LOGIC ---

io.on('connection', (socket) => {
    const sessionUser = socket.request.session.user;
    if (!sessionUser) return socket.disconnect();

    console.log(`🌐 Bağlantı: ${sessionUser.nickname}`);

    socket.on('chat-message', (data) => {
        io.emit('new-message', { sender: sessionUser.nickname, text: data.text });
    });

    // Arena Eşleşme Mantığı (Kısaltılmış)
    socket.on('find-match', async (data) => {
        // Eşleşme kodlarını buraya ekleyebilirsin
        socket.emit('new-message', { sender: 'SİSTEM', text: 'Arena eşleşme aranıyor...' });
    });

    socket.on('disconnect', () => {
        console.log(`❌ Ayrıldı: ${sessionUser.nickname}`);
    });
});

// --- LOGOUT & START ---

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

app.get('*', (req, res) => { res.status(404).render('404'); });

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`🚀 Sunucu ${PORT} portunda operasyona hazır.`);
});


