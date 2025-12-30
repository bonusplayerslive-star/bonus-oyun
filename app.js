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

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_APP_PASS
    }
});

// --- 5. ANA SAYFA VE MENÜ ROTALARI ---

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
    res.render('chat', { user }); // views/chat.ejs dosyanızın olması gerekir
});





// --- 6. AUTH VE İŞLEM ROTALARI ---

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
    if (user) {
        req.session.userId = user._id;
        res.redirect('/profil');
    } else {
        res.send('<script>alert("Hatalı!"); window.location.href="/";</script>');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- 7. MARKET VE GELİŞTİRME SİSTEMİ ---

app.post('/buy-animal', checkAuth, async (req, res) => {
    try {
        const { animalId } = req.body;
        const user = await User.findById(req.session.userId);
        const animal = MARKET_ANIMALS.find(a => a.id == animalId);

        if (!animal || user.bpl < animal.price || user.inventory.length >= 3) {
            return res.json({ status: 'error', msg: 'Şartlar sağlanmadı!' });
        }

        user.bpl -= animal.price;
        user.inventory.push({ name: animal.name, img: animal.img, level: 1, stats: { hp: 100, atk: 20, def: 10 } });
        await user.save();
        res.json({ status: 'success', msg: 'Hayırlı olsun!', newBalance: user.bpl });
    } catch (err) { res.json({ status: 'error', msg: 'Hata!' }); }
});

app.post('/upgrade-stat', checkAuth, async (req, res) => {
    const { animalName, statType, cost } = req.body;
    try {
        const user = await User.findById(req.session.userId);
        const idx = user.inventory.findIndex(a => a.name === animalName);
        if (idx === -1 || user.bpl < cost) return res.json({ status: 'error', msg: 'Hata!' });

        const animal = user.inventory[idx];
        if(statType === 'hp') animal.stats.hp += 10;
        else if(statType === 'atk') animal.stats.atk += 5;

        user.bpl -= cost;
        user.markModified('inventory');
        await user.save();
        res.json({ status: 'success', newBalance: user.bpl });
    } catch (err) { res.status(500).json({ status: 'error' }); }
});

// --- 8. ARENA VE SAVAŞ MANTIĞI ---

app.post('/attack-bot', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const bot = eliteBots[Math.floor(Math.random() * eliteBots.length)];
        const animalParam = req.query.animal || (user.inventory[0] ? user.inventory[0].name : "eagle");
        const animalName = animalParam.toLowerCase();

        const isWin = Math.random() > 0.5;

        if (isWin) {
            user.bpl += 200;
            last20Victories.unshift({ winner: user.nickname, opponent: bot.nickname, reward: 200, time: new Date().toLocaleTimeString() });
            if(last20Victories.length > 20) last20Victories.pop();

            io.emit('new-message', {
                sender: "ARENA_SISTEM",
                text: `🏆 ${user.nickname} kazandı!`,
                winnerNick: user.nickname,
                isBattleWin: true 
            });
        } else {
            if (user.bpl >= 200) user.bpl -= 200;
        }

        await user.save();
        res.json({
            status: 'success',
            opponent: bot.nickname,
            animation: {
                actionVideo: `/caracter/move/${animalName}/${animalName}1.mp4`,
                winVideo: `/caracter/move/${animalName}/${animalName}.mp4`,
                isWin: isWin
            },
            newBalance: user.bpl
        });
    } catch (err) { res.status(500).json({ status: 'error' }); }
});

// --- 9. ÖDEME VE CÜZDAN DOĞRULAMA (BSCScan) ---

app.post('/verify-payment', checkAuth, async (req, res) => {
    const { txid, usd, bpl } = req.body;
    try {
        const checkDuplicate = await Payment.findOne({ txid });
        if (checkDuplicate) return res.json({ status: 'error', msg: 'Zaten kullanılmış!' });

        const apiKey = process.env.BSCSCAN_API_KEY;
        const companyWallet = process.env.WALLET_ADDRESS.toLowerCase();
        const usdtContract = process.env.CONTRACT_ADDRESS.toLowerCase();
        
        const url = `https://api.bscscan.com/api?module=proxy&action=eth_getTransactionReceipt&txhash=${txid}&apikey=${apiKey}`;
        const response = await axios.get(url);
        const receipt = response.data.result;

        if (!receipt || receipt.status !== "0x1") return res.json({ status: 'error', msg: 'Geçersiz İşlem!' });

        let validTransfer = false;
        receipt.logs.forEach(log => {
            const isUSDT = log.address.toLowerCase() === usdtContract;
            const toCompany = log.topics[2] && log.topics[2].toLowerCase().includes(companyWallet.replace('0x', ''));
            if (isUSDT && toCompany) validTransfer = true;
        });

        if (validTransfer) {
            const user = await User.findById(req.session.userId);
            user.bpl += parseInt(bpl);
            await user.save();
            await new Payment({ userId: user._id, txid, amountUSD: usd, amountBPL: bpl, status: 'COMPLETED' }).save();
            res.json({ status: 'success', msg: 'BPL Yüklendi!' });
        } else {
            res.json({ status: 'error', msg: 'Veri uyuşmuyor!' });
        }
    } catch (err) { res.status(500).json({ status: 'error' }); }
});

// --- 10. SOCKET.IO SİSTEMİ ---
io.on('connection', (socket) => {
    
    // Kullanıcı odaya kayıt olur
    socket.on('register-user', ({ id, nickname }) => {
        socket.userId = id;
        socket.nickname = nickname;
        socket.join('Global');
    });

    // Chat Mesajlaşma
    socket.on('chat-message', (data) => {
        if (data.text && data.text.trim() !== "") {
            io.to('Global').emit('new-message', { 
                sender: socket.nickname || "Kumandan", 
                text: data.text 
            });
        }
    });

    // BPL Transferi
    socket.on('transfer-bpl', async (data) => {
        try {
            const sender = await User.findById(socket.userId);
            const receiver = await User.findOne({ nickname: data.to });
            if (sender && receiver && sender.bpl >= 6000) {
                const amount = Math.min(data.amount, 1000);
                const tax = Math.floor(amount * 0.25);
                sender.bpl -= amount;
                receiver.bpl += (amount - tax);
                await sender.save(); 
                await receiver.save();
                socket.emit('gift-result', { newBalance: sender.bpl, message: 'Gönderildi!' });
            }
        } catch (e) { console.error("Transfer hatası:", e); }
    });

    // Tebrik Sistemi
    socket.on('tebrik-et', async (data) => {
        try {
            const sender = await User.findById(socket.userId);
            const receiver = await User.findOne({ nickname: data.winnerNick });
            if (sender && receiver && sender.bpl >= 5000) {
                sender.bpl -= 500;
                receiver.bpl += 410;
                await sender.save();
                await receiver.save();
                io.to('Global').emit('new-message', { 
                    sender: "SİSTEM", 
                    text: `💎 ${sender.nickname}, ${receiver.nickname} kumandana moral verdi!` 
                });
            }
        } catch (e) { console.error("Tebrik hatası:", e); }
    });

}); // io.on BİTİŞİ (Sadece 1 tane yeterli!)

// --- 11. SUNUCU BAŞLATMA ---
server.listen(PORT, "0.0.0.0", () => {
    console.log(`BPL ECOSYSTEM AKTİF: PORT ${PORT}`);
});
