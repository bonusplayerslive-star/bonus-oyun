require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const axios = require('axios');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');

const connectDB = require('./db');
const User = require('./models/User');
const Log = require('./models/Log');
const Payment = require('./models/Payment'); // Yeni eklenen model

connectDB();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 10000; 
app.set('trust proxy', 1);

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 15, message: "Çok fazla deneme yaptınız." });

app.use(bodyParser.json()); 
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
    secret: 'bpl_ozel_anahtar', 
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, // HTTPS kullanmıyorsan false kalmalı
        maxAge: 24 * 60 * 60 * 1000,
        httpOnly: true 
    }
}));
app.set('view engine', 'ejs');

// --- MONGODB LOG FONKSİYONU ---
const dbLog = async (type, content) => {
    try {
        const newLog = new Log({ type, content });
        await newLog.save();
        console.log(`[DB LOG] ${type}: ${content}`);
    } catch (err) {
        console.error("Log kaydı başarısız:", err.message);
    }
};

const checkAuth = (req, res, next) => {
    if (req.session.userId) next(); else res.redirect('/');
};

// --- HTTP ROTALARI (GET) ---
app.get('/', (req, res) => {
    const userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    res.render('index', { articles: ["Arena Yayında!", "Market Güncellendi"], userIp, forceHelp: false });
});

app.get('/profil', checkAuth, async (req, res) => {
    try { const user = await User.findById(req.session.userId); res.render('profil', { user }); } catch (e) { res.redirect('/'); }
});

app.get('/market', checkAuth, async (req, res) => {
    try { const user = await User.findById(req.session.userId); res.render('market', { user }); } catch (e) { res.redirect('/profil'); }
});

app.get('/development', checkAuth, async (req, res) => {
    try { 
        const user = await User.findById(req.session.userId); 
        const selectedAnimal = req.query.animal;
        res.render('development', { user, selectedAnimal }); 
    } catch (e) { res.redirect('/profil'); }
});

app.get('/wallet', checkAuth, async (req, res) => {
    try { const user = await User.findById(req.session.userId); res.render('wallet', { user }); } catch (e) { res.redirect('/profil'); }
});

app.get('/payment', checkAuth, async (req, res) => {
    try { 
        const user = await User.findById(req.session.userId); 
        const packages = [{ usd: 10, bpl: 1000 }, { usd: 50, bpl: 5500 }, { usd: 100, bpl: 12000 }];
        res.render('payment', { user, packages, paymentText: process.env.WALLET_ADDRESS }); 
    } catch (e) { res.redirect('/profil'); }
});

app.get('/arena', checkAuth, async (req, res) => {
    try { 
        const user = await User.findById(req.session.userId); 
        const selectedAnimal = req.query.animal;
        // Basit bir rakip listesi (kendisi hariç rastgele 5 kişi)
        const opponents = await User.find({ _id: { $ne: user._id } }).limit(5);
        res.render('arena', { user, selectedAnimal, opponents }); 
    } catch (e) { res.redirect('/profil'); }
});

app.get('/chat', checkAuth, async (req, res) => {
    try { const user = await User.findById(req.session.userId); res.render('chat', { user, room: 'Global' }); } catch (e) { res.redirect('/profil'); }
});

app.get('/meeting', checkAuth, async (req, res) => {
    try { 
        const user = await User.findById(req.session.userId); 
        const roomId = req.query.roomId || 'GlobalMasa';
        res.render('meeting', { user, roomId }); 
    } catch (e) { res.redirect('/profil'); }
});

// --- HTTP ROTALARI (POST) ---
app.post('/login', authLimiter, async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email, password });
    if (user) {
        req.session.userId = user._id;
        res.redirect('/profil');
    } else {
        res.send(`<script>alert("Hatalı Giriş!"); window.location.href="/";</script>`);
    }
});

app.post('/register', authLimiter, async (req, res) => {
    try {
        const newUser = new User({ ...req.body, bpl: 2500, inventory: [], stats: {} });
        await newUser.save();
        res.send('<script>alert("Kayıt Başarılı!"); window.location.href="/";</script>');
    } catch (e) { res.send("Kayıt Hatası."); }
});

app.post('/buy-animal', checkAuth, async (req, res) => {
    const { animalName, price } = req.body;
    try {
        const user = await User.findById(req.session.userId);
        if (user && user.bpl >= price) {
            user.bpl -= price;
            if (!user.inventory.includes(animalName)) user.inventory.push(animalName);
            if(!user.stats) user.stats = {};
            user.stats[animalName] = { hp: 100, atk: 15, def: 10 };
            user.markModified('stats'); 
            await user.save();
            await dbLog('MARKET', `${user.nickname} ${animalName} satın aldı.`);
            res.json({ status: 'success', newBalance: user.bpl });
        } else res.json({ status: 'error', msg: 'Yetersiz Bakiye!' });
    } catch (e) { res.json({ status: 'error' }); }
});

// --- GELİŞTİRME MERKEZİ ---
app.post('/upgrade-stat', checkAuth, async (req, res) => {
    const { animalName, statType, cost } = req.body;
    try {
        const user = await User.findById(req.session.userId);
        if (!user || user.bpl < cost) return res.json({ status: 'error', msg: 'Yetersiz bakiye!' });
        if (!user.inventory.includes(animalName)) return res.json({ status: 'error', msg: 'Hayvan sizde yok!' });

        if (!user.stats) user.stats = {};
        if (!user.stats[animalName]) user.stats[animalName] = { hp: 100, atk: 15, def: 10 };

        if (statType === 'hp') user.stats[animalName].hp += 10;
        else if (statType === 'atk') user.stats[animalName].atk += 5;
        else if (statType === 'def') user.stats[animalName].def += 5;
        else if (statType === 'battleMode') user.stats[animalName].atk += 20;

        user.bpl -= cost;
        user.markModified('stats');
        await user.save();
        await dbLog('DEVELOPMENT', `${user.nickname}, ${animalName} ${statType} yükseltti.`);
        res.json({ status: 'success', newBalance: user.bpl });
    } catch (e) { res.json({ status: 'error', msg: 'Sistem hatası.' }); }
});

// --- ARENA SAVAŞ MANTIĞI ---
app.post('/attack', checkAuth, async (req, res) => {
    try {
        const { defenderId, animalName } = req.body;
        const attacker = await User.findById(req.session.userId);
        const defender = await User.findById(defenderId);

        if (!attacker || !defender) return res.json({ status: 'error', msg: 'Kullanıcı bulunamadı.' });

        const aStats = (attacker.stats && attacker.stats[animalName]) ? attacker.stats[animalName] : { hp: 100, atk: 15, def: 10 };
        const dAnimal = defender.inventory[0] || "Bilinmeyen";
        const dStats = (defender.stats && defender.stats[dAnimal]) ? defender.stats[dAnimal] : { hp: 100, atk: 10, def: 5 };

        const dmgToDef = Math.max(5, aStats.atk - dStats.def);
        const dmgToAtk = Math.max(5, dStats.atk - aStats.def);

        let winner = (dmgToDef >= dmgToAtk) ? attacker.nickname : defender.nickname;
        let reward = (winner === attacker.nickname) ? 100 : 0;

        if (reward > 0) {
            attacker.bpl += reward;
            await attacker.save();
        }

        const logMsg = `${attacker.nickname} vs ${defender.nickname} | Kazanan: ${winner}`;
        await dbLog('ARENA', logMsg);

        res.json({ status: 'success', winner, reward, msg: logMsg, newBalance: attacker.bpl });
    } catch (e) { res.json({ status: 'error', msg: 'Savaş hatası.' }); }
});

// --- PREMİUM ÇEKİM SİSTEMİ (%30 KESİNTİ) ---
app.post('/withdraw', checkAuth, async (req, res) => {
    const { amount } = req.body;
    try {
        const user = await User.findById(req.session.userId);
        const requested = parseInt(amount);

        // Kural: En az 9750 bakiye olmalı (7500 net çekim için gerekli min bakiye)
        if (user.bpl < 9750) return res.json({ status: 'error', msg: 'Minimum 9750 BPL bakiyeniz olmalıdır.' });
        if (requested < 7500 || user.bpl < requested) return res.json({ status: 'error', msg: 'Geçersiz miktar.' });

        const fee = requested * 0.30;
        const netAmount = requested - fee;

        user.bpl -= requested;
        await user.save();

        const newPayment = new Payment({
            email: user.email,
            requestedBpl: requested,
            fee: fee,
            netAmount: netAmount,
            status: 'Beklemede'
        });
        await newPayment.save();

        await dbLog('WALLET', `${user.nickname} çekim yaptı. Net: ${netAmount} BPL`);
        res.json({ status: 'success', msg: `Talebiniz alındı. %30 kesinti sonrası net: ${netAmount} BPL` });
    } catch (e) { res.json({ status: 'error', msg: 'İşlem başarısız.' }); }
});

app.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) return res.json({ status: 'error', msg: 'Kullanıcı bulunamadı.' });
        await dbLog('FORGOT_PASS', `Sıfırlama isteği: ${email}`);
        res.json({ status: 'success', msg: 'Talebiniz alındı.' });
    } catch (e) { res.json({ status: 'error' }); }
});

// --- SOCKET.IO SİSTEMİ ---
const broadcastActiveCount = () => {
    const count = io.engine.clientsCount;
    io.emit('update-active-count', count);
};

io.on('connection', (socket) => {
    broadcastActiveCount();

    socket.on('join-chat', (data) => {
        socket.join(data.room);
        socket.nickname = data.nickname;
        socket.roomId = data.room;
        socket.to(data.room).emit('user-joined', { nickname: data.nickname, socketId: socket.id });
    });

    socket.on('chat-message', (data) => {
        io.to(data.room).emit('new-message', { sender: data.nickname, text: data.message });
    });

    socket.on('send-gift', async (data) => {
        try {
            const sender = await User.findById(data.userId);
            const receiver = await User.findOne({ nickname: data.to });
            if (sender && receiver && sender.bpl >= 6000 && data.amount <= 500) {
                sender.bpl -= data.amount;
                receiver.bpl += data.amount;
                await sender.save();
                await receiver.save();
                await dbLog('GIFT', `${sender.nickname} -> ${receiver.nickname} (${data.amount} BPL)`);
                socket.emit('gift-result', { success: true, message: "Hediye gönderildi!", newBalance: sender.bpl });
                io.to(data.room).emit('new-message', { sender: "SİSTEM", text: `🎁 ${sender.nickname}, ${receiver.nickname}'e ${data.amount} BPL gönderdi!` });
            }
        } catch (err) {}
    });

    socket.on('disconnect', () => {
        broadcastActiveCount();
        if (socket.roomId) socket.to(socket.roomId).emit('user-left', socket.id);
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`BPL SİSTEMİ AKTİF | PORT: ${PORT}`);
});
