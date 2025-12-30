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

// --- 4. YARDIMCI VE GLOBAL DEĞİŞKENLER ---
const checkAuth = (req, res, next) => {
    if (req.session.userId) next(); else res.redirect('/');
};

const last20Victories = [];
const eliteBots = [
    { nickname: "X-Terminator", animal: "Tiger", level: 15 },
    { nickname: "Shadow-Ghost", animal: "Wolf", level: 22 },
    { nickname: "Cyber-Predator", animal: "Eagle", level: 18 },
    { nickname: "Night-Stalker", animal: "Lion", level: 25 }
];

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

// --- 5. ANA ROTALAR ---
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
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// --- 6. İŞLEM ROTALARI (REGISTER, LOGIN, UPGRADE) ---
app.post('/register', async (req, res) => {
    const { nickname, email, password } = req.body;
    try {
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.send('<script>alert("Kayıtlı!"); window.location.href="/";</script>');
        const newUser = new User({ nickname, email, password, bpl: 2500, inventory: [] });
        await newUser.save();
        res.send('<script>alert("Başarılı!"); window.location.href="/";</script>');
    } catch (err) { res.status(500).send("Hata!"); }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email, password });
    if (user) { req.session.userId = user._id; res.redirect('/profil'); } 
    else res.send('<script>alert("Hatalı!"); window.location.href="/";</script>');
});

app.post('/upgrade-stat', checkAuth, async (req, res) => {
    const { animalName, statType, cost } = req.body;
    try {
        const user = await User.findById(req.session.userId);
        const animal = user.inventory.find(a => a.name === animalName);
        if (user.bpl < cost) return res.json({ status: 'error', msg: 'Bakiye yetersiz!' });
        if (statType === 'hp') animal.stats.hp += 10;
        else if (statType === 'atk') animal.stats.atk += 5;
        user.bpl -= cost;
        user.markModified('inventory');
        await user.save();
        res.json({ status: 'success', newBalance: user.bpl });
    } catch (err) { res.status(500).json({ status: 'error' }); }
});

// --- 7. KARAKTER SATIŞ VE YAKIM ---
app.post('/sell-character', checkAuth, async (req, res) => {
    try {
        const { userId, animalIndex, fiyat } = req.body;
        const user = await User.findById(userId);
        if (user.inventory.length <= 1) return res.json({ status: 'error', msg: 'Son karakter satılamaz!' });
        const burnTax = Math.floor(fiyat * 0.30);
        const refund = fiyat - burnTax;
        user.inventory.splice(animalIndex, 1);
        user.bpl += refund;
        user.markModified('inventory');
        await user.save();
        await new Log({ type: 'BPL_BURN', content: `Satış Yakımı: ${burnTax} BPL`, userEmail: user.email }).save();
        res.json({ status: 'success', newBpl: user.bpl });
    } catch (err) { res.status(500).json({ status: 'error' }); }
});

// --- 8. ÖDEME ONAY (DETAYLI ANALİZ) ---
app.post('/verify-payment', checkAuth, async (req, res) => {
    const { txid, usd, bpl, userId } = req.body;
    try {
        const checkDuplicate = await Payment.findOne({ txid });
        if (checkDuplicate) return res.json({ status: 'error', msg: 'Onaylanmış işlem!' });

        const apiKey = process.env.BSCSCAN_API_KEY;
        const companyWallet = process.env.WALLET_ADDRESS.toLowerCase();
        const usdtContract = process.env.CONTRACT_ADDRESS.toLowerCase();
        const url = `https://api.bscscan.com/api?module=proxy&action=eth_getTransactionReceipt&txhash=${txid}&apikey=${apiKey}`;
        
        const response = await axios.get(url);
        const receipt = response.data.result;

        if (receipt && receipt.status === "0x1") {
            let valid = false;
            receipt.logs.forEach(log => {
                const isUSDT = log.address.toLowerCase() === usdtContract;
                const toCompany = log.topics[2] && log.topics[2].toLowerCase().includes(companyWallet.replace('0x', ''));
                if (isUSDT && toCompany) valid = true;
            });

            if (valid) {
                const user = await User.findById(userId);
                user.bpl += parseInt(bpl);
                await user.save();
                await new Payment({ userId, txid, amountUSD: usd, amountBPL: bpl, status: 'COMPLETED' }).save();
                return res.json({ status: 'success', msg: 'BPL Yüklendi!' });
            }
        }
        res.json({ status: 'error', msg: 'Doğrulanamadı!' });
    } catch (err) { res.status(500).json({ status: 'error' }); }
});

// --- 9. ARENA SAVAŞI (MASRAFSIZ 200 ÖDÜL) ---
app.post('/attack-bot', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const bot = eliteBots[Math.floor(Math.random() * eliteBots.length)];
        const isWin = Math.random() > 0.5;
        const animalName = req.query.animal ? req.query.animal.toLowerCase() : "eagle";

        if (isWin) {
            user.bpl += 200;
            last20Victories.unshift({ winner: user.nickname, opponent: bot.nickname, reward: 200, time: new Date().toLocaleTimeString() });
            if(last20Victories.length > 20) last20Victories.pop();
            io.emit('new-message', { sender: "ARENA", text: `🏆 ${user.nickname} kazandı!`, winnerNick: user.nickname, isBattleWin: true });
        } else {
            if (user.bpl >= 200) user.bpl -= 200;
        }
        await user.save();
        res.json({ status: 'success', isWin, newBalance: user.bpl, animation: {
            actionVideo: `/caracter/move/${animalName}/${animalName}1.mp4`,
            winVideo: `/caracter/move/${animalName}/${animalName}.mp4`
        }});
    } catch (err) { res.status(500).json({ status: 'error' }); }
});

// --- 10. SOCKET.IO (TRANSFER, CHAT, ELİT TEBRİK) ---
io.on('connection', (socket) => {
    socket.on('register-user', ({ id, nickname }) => {
        socket.userId = id;
        socket.nickname = nickname;
        socket.join('Global');
    });

    socket.on('chat-message', (data) => {
        io.to('Global').emit('new-message', { sender: socket.nickname, text: data.text });
    });

    socket.on('transfer-bpl', async (data) => {
        try {
            const sender = await User.findById(socket.userId);
            const receiver = await User.findOne({ nickname: data.to });
            const amount = Math.min(Math.abs(data.amount), 1000);
            const tax = Math.floor(amount * 0.25);
            const net = amount - tax;

            if (sender.bpl >= 6000 && sender.bpl >= amount) {
                sender.bpl -= amount;
                receiver.bpl += net;
                await sender.save(); await receiver.save();
                await new Log({ type: 'BPL_BURN', content: `Transfer Yakımı: ${tax} BPL`, userEmail: sender.email }).save();
                socket.emit('gift-result', { newBalance: sender.bpl, message: 'Gönderildi!' });
            }
        } catch (e) { console.error(e); }
    });

    socket.on('tebrik-et', async (data) => {
        try {
            const sender = await User.findById(socket.userId);
            const receiver = await User.findOne({ nickname: data.winnerNick });
            if (sender.bpl >= 5000) {
                const tax = 500 * 0.18;
                sender.bpl -= 500;
                receiver.bpl += (500 - tax);
                await sender.save(); await receiver.save();
                io.emit('new-message', { sender: "SİSTEM", text: `💎 ${sender.nickname} tebrik etti!` });
            }
        } catch (e) { console.error(e); }
    });
});

server.listen(PORT, "0.0.0.0", () => { console.log(`BPL ONLINE: ${PORT}`); });
