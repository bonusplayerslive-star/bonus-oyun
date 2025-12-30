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
const axios = require('axios');

// --- 2. VERİTABANI VE MODELLER ---
const connectDB = require('./db');
const User = require('./models/User');
const Log = require('./models/Log');
const Payment = require('./models/Payment');
const Income = require('./models/Income');
const Victory = require('./models/Victory');
const Punishment = require('./models/Punishment');
const Withdrawal = require('./models/Withdrawal');

connectDB();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 10000;

// --- 3. BELLEKTE TUTULAN VERİLER VE SABİTLER ---
const last20Victories = [];
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

// --- 4. MIDDLEWARE ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.set('trust proxy', 1);

app.use(session({
    secret: 'bpl_ozel_anahtar',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

const checkAuth = (req, res, next) => {
    if (req.session.userId) next(); else res.redirect('/');
};

// --- 5. ANA ROTALAR ---
app.get('/', (req, res) => {
    res.render('index', { user: req.session.userId || null });
});

app.get('/profil', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('profil', { user });
});

app.get('/market', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('market', { user, animals: MARKET_ANIMALS });
});

app.get('/arena', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('arena', { 
        user, 
        selectedAnimal: user.inventory[0]?.name || "Karakter Yok",
        lastVictories: last20Victories 
    });
});

app.get('/wallet', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('wallet', { user });
});

app.get('/development', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('development', { user });
});

app.get('/chat', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('chat', { user });
});

// --- BEŞGEN KONSEY (MEETING) ---
app.get('/meeting', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        if (!user) return res.redirect('/');
        const entryFee = 50;
        if (user.bpl < entryFee) {
            return res.render('profil', { user, error: 'Konsey için 50 BPL gerekli!' });
        }
        user.bpl -= entryFee;
        await user.save();
        res.render('meeting', { user, roomId: "BPL-VIP-KONSEY" });
    } catch (err) { res.redirect('/profil'); }
});

// --- 6. AUTH VE İŞLEMLER ---
app.post('/register', async (req, res) => {
    const { nickname, email, password } = req.body;
    try {
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.send('<script>alert("E-posta kayıtlı!"); window.location.href="/";</script>');
        const newUser = new User({ nickname, email, password, bpl: 2500, inventory: [] });
        await newUser.save();
        res.send('<script>alert("Başarılı!"); window.location.href="/";</script>');
    } catch (err) { res.status(500).send("Hata!"); }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email, password });
    if (user) { req.session.userId = user._id; res.redirect('/profil'); } 
    else { res.send('<script>alert("Hatalı!"); window.location.href="/";</script>'); }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.post('/upgrade-stat', checkAuth, async (req, res) => {
    const { animalName, statType, cost } = req.body;
    try {
        const user = await User.findById(req.session.userId);
        const idx = user.inventory.findIndex(a => a.name === animalName);
        if (idx === -1 || user.bpl < cost) return res.json({ status: 'error', msg: 'Hata!' });

        const animal = user.inventory[idx];
        let message = "Geliştirme başarılı.";
        if(statType === 'hp') animal.stats.hp += 10;
        else if(statType === 'atk') animal.stats.atk += 5;
        else if(statType === 'def') animal.stats.def = (animal.stats.def || 0) + 5;

        user.bpl -= cost;
        user.markModified('inventory');
        await user.save();
        res.json({ status: 'success', msg: message, newBalance: user.bpl });
    } catch (err) { res.status(500).json({ status: 'error' }); }
});

app.post('/attack-bot', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        if (!user || user.bpl < 200) return res.json({ status: 'error', msg: 'Yetersiz BPL!' });
        let animalName = (req.body.animal || "eagle").toLowerCase().trim();
        const isWin = Math.random() > 0.5;
        if (isWin) {
            user.bpl += 200;
            io.to('Global').emit('new-message', { sender: "ARENA", text: `🏆 ${user.nickname} kazandı!` });
        } else { user.bpl -= 200; }
        await user.save();
        res.json({
            status: 'success',
            animation: { actionVideo: `/caracter/move/${animalName}/${animalName}1.mp4`, winVideo: `/caracter/move/${animalName}/${animalName}.mp4`, isWin },
            newBalance: user.bpl
        });
    } catch (err) { res.status(500).json({ status: 'error' }); }
});

// --- 10. SOCKET.IO SİSTEMİ (TEK VE DOĞRU BLOK) ---
io.on('connection', (socket) => {
    console.log('Yeni bağlantı sağlandı.');

    socket.on('register-user', (data) => {
        if (data && data.nickname) {
            socket.userId = data.id;
            socket.nickname = data.nickname;
            socket.join('Global');
        }
    });

    socket.on('chat-message', (data) => {
        const targetRoom = data.room || 'Global';
        io.to(targetRoom).emit('new-message', { 
            sender: socket.nickname || "Kumandan", 
            text: data.text 
        });
    });

    socket.on('join-meeting', (data) => {
        const roomId = (typeof data === 'string') ? data : data.roomId;
        if (roomId) {
            socket.join(roomId);
            io.to(roomId).emit('new-message', { sender: "SİSTEM", text: `🔥 ${socket.nickname || 'Üye'} bağlandı.` });
        }
    });

    socket.on('send-gift-vip', async (data) => {
        try {
            const sender = await User.findById(socket.userId);
            const receiver = await User.findOne({ nickname: data.targetNick });
            if (sender && receiver && sender.bpl >= 5000) {
                const netAmount = Math.floor(data.amount * (1 - (data.tax / 100)));
                sender.bpl -= data.amount;
                receiver.bpl += netAmount;
                await sender.save(); await receiver.save();
                io.to(data.room).emit('new-message', { sender: "SİSTEM", text: `🎁 ${sender.nickname} -> ${receiver.nickname}: ${data.amount} BPL!` });
                socket.emit('gift-result', { status: 'success', newBalance: sender.bpl });
            }
        } catch (e) { console.error(e); }
    });

    socket.on('start-vip-battle', async (data) => {
        try {
            const p1 = await User.findOne({ nickname: data.p1 });
            const p2 = await User.findOne({ nickname: data.p2 });
            if (p1 && p1.bpl >= 200) {
                p1.bpl -= 200; await p1.save();
                const winner = Math.random() > 0.5 ? p1 : p2;
                const animal = (p1.selectedAnimal || "eagle").toLowerCase();
                io.to(data.room).emit('battle-video-play', { winner: winner.nickname, moveVideo: `/caracter/move/${animal}/${animal}1.mp4`, video: `/caracter/move/${animal}/${animal}.mp4` });
            }
        } catch (e) { console.error(e); }
    });

    socket.on('disconnect', () => { console.log('Ayrıldı.'); });
});

// --- 11. BAŞLAT ---
server.listen(PORT, "0.0.0.0", () => {
    console.log(`BPL ECOSYSTEM AKTİF: PORT ${PORT}`);
});
