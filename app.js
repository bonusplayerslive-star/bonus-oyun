require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const rateLimit = require('express-rate-limit');

const connectDB = require('./db');
const User = require('./models/User');
const Log = require('./models/Log');
const Payment = require('./models/Payment');

connectDB();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 10000; 
app.set('trust proxy', 1);

// Güvenlik Sınırı
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, message: "Çok fazla deneme." });

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

// --- LOG FONKSİYONU ---
const dbLog = async (type, content) => {
    try {
        const newLog = new Log({ type, content });
        await newLog.save();
    } catch (err) { console.error("Log hatası:", err.message); }
};

const checkAuth = (req, res, next) => {
    if (req.session.userId) next(); else res.redirect('/');
};

// --- GET ROTALARI ---
app.get('/', (req, res) => {
    res.render('index', { userIp: req.ip });
});

app.get('/profil', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('profil', { user });
});

app.get('/market', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('market', { user });
});

app.get('/development', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('development', { user, selectedAnimal: req.query.animal });
});

app.get('/wallet', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('wallet', { user });
});

app.get('/payment', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('payment', { user, paymentText: process.env.WALLET_ADDRESS });
});

app.get('/arena', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('arena', { user, selectedAnimal: req.query.animal });
});

app.get('/chat', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('chat', { user });
});

app.get('/meeting', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('meeting', { user, roomId: req.query.roomId || 'GlobalMasa' });
});

// --- POST İŞLEMLERİ (GİRİŞ/KAYIT) ---
app.post('/login', authLimiter, async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email, password });
    if (user) { req.session.userId = user._id; res.redirect('/profil'); }
    else res.send('<script>alert("Hatalı Giriş!"); window.location.href="/";</script>');
});

app.post('/register', authLimiter, async (req, res) => {
    try {
        const newUser = new User({ ...req.body, bpl: 2500 });
        await newUser.save();
        res.send('<script>alert("2500 BPL ile Kayıt Başarılı!"); window.location.href="/";</script>');
    } catch (e) { res.send("Kayıt Hatası: Veriler kullanımda olabilir."); }
});

// --- MARKET & GELİŞTİRME ---
app.post('/buy-animal', checkAuth, async (req, res) => {
    const { animalName, price } = req.body;
    const user = await User.findById(req.session.userId);
    if (user.bpl >= price) {
        user.bpl -= price;
        if (!user.inventory.includes(animalName)) user.inventory.push(animalName);
        user.stats[animalName] = { hp: 120, atk: 20, def: 15 };
        user.markModified('stats');
        await user.save();
        res.json({ status: 'success', newBalance: user.bpl });
    } else res.json({ status: 'error', msg: 'Yetersiz Bakiye!' });
});

app.post('/upgrade-stat', checkAuth, async (req, res) => {
    const { animalName, statType, cost } = req.body;
    const user = await User.findById(req.session.userId);
    if (user.bpl >= cost) {
        user.bpl -= cost;
        user.stats[animalName][statType] += (statType === 'hp' ? 20 : 5);
        user.markModified('stats');
        await user.save();
        res.json({ status: 'success', newBalance: user.bpl });
    } else res.json({ status: 'error' });
});

// --- ARENA SAVAŞ SİSTEMİ (BOT DAHİL) ---
app.post('/attack-bot', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    const animal = req.body.animal || user.inventory[0];
    const userStats = user.stats[animal] || { atk: 15, def: 10 };
    
    // Bot %55 kazanma şansı mantığı (Oyuncunun gücü botu etkiler)
    const winChance = 0.45 + (userStats.atk / 500); 
    const isWin = Math.random() < winChance;
    
    let reward = isWin ? 150 : 0;
    if(isWin) { user.bpl += reward; await user.save(); }
    
    await dbLog('ARENA_BOT', `${user.nickname} botla savaştı. Sonuç: ${isWin ? 'KAZANDI' : 'KAYBETTİ'}`);
    res.json({ status: 'success', winner: isWin ? user.nickname : 'Elite_Bot', reward, newBalance: user.bpl });
});

// --- CÜZDAN (WITHDRAW) ---
app.post('/withdraw', checkAuth, async (req, res) => {
    const { amount } = req.body;
    const user = await User.findById(req.session.userId);
    if (user.bpl >= amount && amount >= 7500) {
        const net = amount * 0.7; // %30 kesinti
        user.bpl -= amount;
        await user.save();
        const p = new Payment({ email: user.email, requestedBpl: amount, netAmount: net, status: 'Beklemede' });
        await p.save();
        res.json({ status: 'success', msg: `Talep alındı. Net: ${net} BPL` });
    } else res.json({ status: 'error', msg: 'Yetersiz bakiye veya limit altı.' });
});

// --- SOCKET.IO (CHAT, ARENA LIST, GIFT) ---
let onlineArena = [];
io.on('connection', (socket) => {
    
    socket.on('join-arena', (data) => {
        socket.userId = data.id;
        socket.nickname = data.nickname;
        if(!onlineArena.find(u => u.id === data.id)) onlineArena.push(data);
        io.emit('arena-list-update', onlineArena);
    });

    socket.on('chat-message', (data) => {
        io.emit('new-message', { sender: data.nickname, text: data.message });
    });

    socket.on('send-gift', async (data) => {
        const sender = await User.findById(socket.userId);
        const receiver = await User.findOne({ nickname: data.to });
        if(sender && receiver && sender.bpl >= 6000) {
            sender.bpl -= 100; receiver.bpl += 100;
            await sender.save(); await receiver.save();
            io.emit('new-message', { sender: 'SİSTEM', text: `🎁 ${sender.nickname} -> ${receiver.nickname} hediye gönderdi!` });
        }
    });

    socket.on('disconnect', () => {
        onlineArena = onlineArena.filter(u => u.id !== socket.userId);
        io.emit('arena-list-update', onlineArena);
    });
});

server.listen(PORT, "0.0.0.0", () => console.log(`BPL ONLINE | PORT: ${PORT}`));
