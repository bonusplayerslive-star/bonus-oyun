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

app.use(session({
    secret: 'bpl_ozel_anahtar',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

const checkAuth = (req, res, next) => {
    if (req.session.userId) next(); else res.redirect('/');
};

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_APP_PASS }
});

// --- 4. GLOBAL DEĞİŞKENLER & VERİLER ---
const MARKET_ANIMALS = [
    { id: 1, name: 'Bear', price: 1000, img: '/caracter/profile/Bear.jpg' },
    { id: 2, name: 'Crocodile', price: 1000, img: '/caracter/profile/Crocodile.jpg' },
    { id: 3, name: 'Eagle', price: 1000, img: '/caracter/profile/Eagle.jpg' },
    { id: 4, name: 'Gorilla', price: 5000, img: '/caracter/profile/Gorilla.jpg' },
    { id: 5, name: 'Kurd', price: 1000, img: '/caracter/profile/Kurd.jpg' },
    { id: 6, name: 'Lion', price: 5000, img: '/caracter/profile/Lion.jpg' },
    { id: 7, name: 'Falcon', price: 1000, img: '/caracter/profile/Peregrinefalcon.jpg' },
    { id: 8, name: 'Rhino', price: 5000, img: '/caracter/profile/Rhino.jpg' },
    { id: 9, name: 'Snake', price: 1000, img: '/caracter/profile/Snake.jpg' },
    { id: 10, name: 'Tiger', price: 5000, img: '/caracter/profile/Tiger.jpg' }
];

const eliteBots = [
    { nickname: "X-Terminator", animal: "Tiger", level: 15 },
    { nickname: "Shadow-Ghost", animal: "Wolf", level: 22 },
    { nickname: "Cyber-Predator", animal: "Eagle", level: 18 },
    { nickname: "Night-Stalker", animal: "Lion", level: 25 }
];

let last20Victories = [];

// --- 5. ROTALAR (GET) ---
app.get('/', (req, res) => res.render('index', { user: req.session.userId || null }));

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

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- 6. İŞLEM ROTALARI (POST) ---

// Kayıt & Giriş
app.post('/register', async (req, res) => {
    const { nickname, email, password } = req.body;
    try {
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.send('<script>alert("E-posta kayıtlı!"); window.location.href="/";</script>');
        
        const newUser = new User({ nickname, email, password, bpl: 2500, inventory: [] });
        await newUser.save();
        await new Log({ type: 'REGISTER', content: `Yeni kullanıcı: ${nickname}`, userEmail: email }).save();
        res.send('<script>alert("Başarılı! Giriş yapabilirsin."); window.location.href="/";</script>');
    } catch (err) { res.status(500).send("Hata oluştu."); }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email, password });
    if (user) {
        req.session.userId = user._id;
        await new Log({ type: 'LOGIN', content: 'Giriş yapıldı', userEmail: email }).save();
        res.redirect('/profil');
    } else {
        res.send('<script>alert("Hatalı giriş!"); window.location.href="/";</script>');
    }
});

// Market & Geliştirme
app.post('/buy-animal', checkAuth, async (req, res) => {
    const { animalId } = req.body;
    const user = await User.findById(req.session.userId);
    const animal = MARKET_ANIMALS.find(a => a.id == animalId);
    if (!animal || user.bpl < animal.price) return res.json({ status: 'error', msg: 'Yetersiz bakiye!' });
    
    user.bpl -= animal.price;
    user.inventory.push({ name: animal.name, img: animal.img, level: 1, stats: { hp: 100, atk: 20, def: 10 } });
    await user.save();
    res.json({ status: 'success', msg: `${animal.name} alındı!`, newBalance: user.bpl });
});

app.post('/upgrade-stat', checkAuth, async (req, res) => {
    const { animalName, statType, cost } = req.body;
    const user = await User.findById(req.session.userId);
    const animal = user.inventory.find(a => a.name === animalName);
    if (!animal || user.bpl < cost) return res.json({ status: 'error', msg: 'Hata!' });

    if(statType === 'hp') animal.stats.hp += 10;
    else if(statType === 'atk') animal.stats.atk += 5;
    
    user.bpl -= cost;
    user.markModified('inventory');
    await user.save();
    res.json({ status: 'success', newBalance: user.bpl.toLocaleString() });
});

// Arena Bot Savaşı
app.post('/attack-bot', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const animalName = req.query.animal?.toLowerCase() || "bear";
        const isWin = Math.random() > 0.5;

        if (isWin) {
            user.bpl += 200;
            last20Victories.unshift({ winner: user.nickname, opponent: "Elite Bot", reward: 200, time: new Date().toLocaleTimeString() });
            if(last20Victories.length > 20) last20Victories.pop();
            io.emit('new-message', { sender: "ARENA", text: `🏆 ${user.nickname} kazandı!`, isBattleWin: true, winnerNick: user.nickname });
        } else {
            if (user.bpl >= 200) user.bpl -= 200;
        }
        await user.save();
        res.json({ status: 'success', animation: { isWin, actionVideo: `/caracter/move/${animalName}/${animalName}1.mp4` }, newBalance: user.bpl });
    } catch (e) { res.status(500).json({ status: 'error' }); }
});

// Ödeme Doğrulama (BSCScan)
app.post('/verify-payment', checkAuth, async (req, res) => {
    const { txid, usd, bpl } = req.body;
    try {
        const duplicate = await Payment.findOne({ txid });
        if (duplicate) return res.json({ status: 'error', msg: 'Zaten onaylı!' });

        const url = `https://api.bscscan.com/api?module=proxy&action=eth_getTransactionReceipt&txhash=${txid}&apikey=${process.env.BSCSCAN_API_KEY}`;
        const response = await axios.get(url);
        if (response.data.result?.status === "0x1") {
            const user = await User.findById(req.session.userId);
            user.bpl += parseInt(bpl);
            await user.save();
            await new Payment({ userId: user._id, txid, amountUSD: usd, status: 'COMPLETED' }).save();
            return res.json({ status: 'success', msg: 'BPL Yüklendi!' });
        }
        res.json({ status: 'error', msg: 'İşlem geçersiz.' });
    } catch (e) { res.status(500).json({ status: 'error' }); }
});

// --- 7. SOCKET.IO MANTIĞI ---
io.on('connection', (socket) => {
    socket.on('register-user', ({ id, nickname }) => {
        socket.userId = id;
        socket.nickname = nickname;
        socket.join('Global');
    });

    socket.on('chat-message', (data) => {
        io.to('Global').emit('new-message', { sender: socket.nickname, text: data.text });
    });

    // Transfer & Yakım Sitemi
    socket.on('transfer-bpl', async (data) => {
        const sender = await User.findById(socket.userId);
        const receiver = await User.findOne({ nickname: data.to });
        if (sender && receiver && sender.bpl >= 6000 && data.amount <= 1000) {
            const tax = Math.floor(data.amount * 0.25);
            sender.bpl -= data.amount;
            receiver.bpl += (data.amount - tax);
            await sender.save(); await receiver.save();
            await new Log({ type: 'BPL_BURN', content: `Vergi: ${tax}`, userEmail: sender.email }).save();
            socket.emit('gift-result', { message: 'Gönderildi!', newBalance: sender.bpl });
        }
    });

    // Tebrik Sistemi
    socket.on('tebrik-et', async (data) => {
        const sender = await User.findById(socket.userId);
        const receiver = await User.findOne({ nickname: data.winnerNick });
        if (sender && receiver && sender.bpl >= 5000) {
            const brut = 500; const tax = brut * 0.18;
            sender.bpl -= brut; receiver.bpl += (brut - tax);
            await sender.save(); await receiver.save();
            await new Log({ type: 'BPL_BURN', content: `Tebrik yakımı: ${tax}`, userEmail: sender.email }).save();
            io.to('Global').emit('new-message', { sender: "SİSTEM", text: `💎 ${sender.nickname} -> ${receiver.nickname} (410 BPL)` });
        }
    });
});

// --- 8. BAŞLATMA ---
server.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 BPL SISTEM AKTIF: PORT ${PORT}`);
});
