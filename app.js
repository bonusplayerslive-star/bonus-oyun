require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const mongoose = require('mongoose');
const axios = require('axios');
const nodemailer = require('nodemailer');

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const mongoose = require('mongoose');
const axios = require('axios');
const nodemailer = require('nodemailer');

// MODELLER (Her işlem ayrı dosyada/koleksiyonda)
const connectDB = require('./db');
const User = require('./models/User');
const Log = require('./models/Log');           // Genel sistem logları
const Payment = require('./models/Payment');   // BscScan paket onayları
const Victory = require('./models/Victory');   // Savaş sonuçları
const Punishment = require('./models/Punishment'); // Ceza kayıtları
const Income = require('./models/Income');     // BPL gelir/gider detayları
const Withdrawal = require('./models/Withdrawal'); // Wallet çekim istekleri

connectDB();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 10000;
app.set('trust proxy', 1);

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

const onlineUsers = {}; 
const busyUsers = new Set();

const checkAuth = (req, res, next) => {
    if (req.session.userId) next(); else res.redirect('/');
};

// --- NODEMAILER AYARI ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// ==========================================
// 1. MARKET MANTIĞI (10 HAYVAN & ÇANTA SINIRI)
// ==========================================
const MARKET_ANIMALS = [
    { id: 1, name: 'Cyber Wolf', price: 1000, img: '/caracter/market/wolf.png' },
    { id: 2, name: 'Neon Tiger', price: 2000, img: '/caracter/market/tiger.png' },
    { id: 3, name: 'Bio Rhino', price: 3000, img: '/caracter/market/rhino.png' },
    { id: 4, name: 'Plasma Eagle', price: 4000, img: '/caracter/market/eagle.png' },
    { id: 5, name: 'Droid Bear', price: 5000, img: '/caracter/market/bear.png' },
    { id: 6, name: 'Mecha Lion', price: 7000, img: '/caracter/market/lion.png' },
    { id: 7, name: 'Volt Cobra', price: 8000, img: '/caracter/market/cobra.png' },
    { id: 8, name: 'Aero Shark', price: 10000, img: '/caracter/market/shark.png' },
    { id: 9, name: 'Titan Mammoth', price: 15000, img: '/caracter/market/mammoth.png' },
    { id: 10, name: 'Dark Dragon', price: 25000, img: '/caracter/market/dragon.png' }
];

app.post('/buy-animal', checkAuth, async (req, res) => {
    try {
        const { animalId } = req.body;
        const user = await User.findById(req.session.userId);
        const animal = MARKET_ANIMALS.find(a => a.id == animalId);

        // Çanta sınırı: 3 hayvandan fazlası için wallet'tan satış şart
        if (user.inventory.length >= 3) {
            return res.json({ status: 'error', msg: 'Bag full! Sell animals in Wallet to buy new ones.' });
        }

        if (user.bpl < animal.price) {
            return res.json({ status: 'error', msg: 'Insufficient BPL!' });
        }

        // BPL Kesintisi ve Envanter Ekleme
        user.bpl -= animal.price;
        user.inventory.push({ name: animal.name, level: 1, xp: 0 });
        
        // Logla: Gelir/Gider Tablosuna (Income)
        await new Income({ 
            userId: user._id, 
            type: 'SPEND', 
            amount: animal.price, 
            details: `Bought ${animal.name}` 
        }).save();

        await user.save();
        res.json({ status: 'success', msg: `${animal.name} joined your squad!` });
    } catch (e) { res.status(500).json({ status: 'error' }); }
});

// ==========================================
// 2. WALLET & PAYMENT (BSCSCAN ONAYI & ÇEKİM)
// ==========================================
app.post('/verify-payment', checkAuth, async (req, res) => {
    const { txHash, packageId } = req.body;
    try {
        // BscScan API üzerinden TX kontrolü (Gerçek projede API KEY kullanın)
        const response = await axios.get(`https://api.bscscan.com/api?module=transaction&action=gettxreceiptstatus&txhash=${txHash}&apikey=${process.env.BSCSCAN_KEY}`);
        
        if (response.data.status === "1") {
            const user = await User.findById(req.session.userId);
            const packages = { '1': 5000, '2': 12000, '3': 30000 };
            const amount = packages[packageId];

            user.bpl += amount;
            await user.save();

            // Ödeme kaydını Logla
            await new Payment({ userId: user._id, txHash, amount, status: 'COMPLETED' }).save();
            await new Log({ userId: user._id, action: 'PAYMENT_VERIFIED', details: `TX: ${txHash}` }).save();

            res.json({ status: 'success', msg: 'BPL credited to your account!' });
        } else {
            res.json({ status: 'error', msg: 'Transaction not found or failed!' });
        }
    } catch (e) { res.status(500).send("Verification Error"); }
});

app.post('/request-withdrawal', checkAuth, async (req, res) => {
    const { amount, walletAddress } = req.body;
    const user = await User.findById(req.session.userId);

    if (user.bpl < amount) return res.send('Insufficient balance');

    user.bpl -= amount;
    await user.save();

    // Çekim isteğini Mongoya İşle
    await new Withdrawal({ userId: user._id, amount, walletAddress, status: 'PENDING' }).save();
    res.send('<script>alert("Withdrawal request sent!"); window.location.href="/wallet";</script>');
});

// ==========================================
// 3. ARENA (DOĞRUDAN SALDIRI & SAVAŞ LOGLARI)
// ==========================================
// Burası lobby'yi atlayıp direkt server üzerinden eşleşmeyi sağlar
app.get('/arena/quick-attack', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    if (!req.query.animal) return res.redirect('/profil?msg=SelectCharacterFirst');
    
    // Rastgele bir rakip bul (Boşta olan)
    const opponentNickname = Object.keys(onlineUsers).find(nick => 
        nick !== user.nickname && !busyUsers.has(nick)
    );

    if (opponentNickname) {
        res.render('arena', { user, selectedAnimal: req.query.animal, opponent: opponentNickname });
    } else {
        res.render('arena', { user, selectedAnimal: req.query.animal, opponent: 'AI_BOT_BPL' });
    }
});

// Savaş Sonu Ödül ve Loglama
app.post('/battle-end', checkAuth, async (req, res) => {
    const { winner, loser, prize, details } = req.body;
    
    // Galibiyet Kaydı
    await new Victory({ winner, loser, prize, battleDetails: details }).save();
    
    // Kazananın BPL'ini güncelle
    const winnerUser = await User.findOne({ nickname: winner });
    if (winnerUser) {
        winnerUser.bpl += parseInt(prize);
        await winnerUser.save();
        await new Income({ userId: winnerUser._id, type: 'EARN', amount: prize, details: 'Battle Victory' }).save();
    }
    res.json({ status: 'ok' });
});

// ==========================================
// 4. DİĞER ROTALAR (MEETING, CHAT, CONTACT)
// ==========================================
app.get('/', (req, res) => res.render('index', { userIp: req.ip }));

app.get('/profil', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('profil', { user });
});

app.get('/meeting', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    // Beşgen masa düzeni ve iPhone fix (Session üzerinden roomId kontrolü)
    res.render('meeting', { user, roomId: "BPL-CENTRAL-5GEN" });
});

app.post('/contact', async (req, res) => {
    const { email, note } = req.body;
    const contactLog = new Log({ 
        userId: req.session.userId || null, 
        action: 'CONTACT', 
        details: `From: ${email} | Note: ${note}` 
    });
    await contactLog.save();
    res.send('<script>alert("Transmission Received!"); window.location.href="/";</script>');
});

app.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (user) {
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'BPL Recovery',
            text: `Commander, your access code is: ${user.password}`
        });
        res.send('<script>alert("Access code sent to mail!"); window.location.href="/";</script>');
    } else res.send('User not found');
});

// ==========================================
// 5. SOCKET SİSTEMİ (ARENA & CHAT)
// ==========================================
io.on('connection', (socket) => {
    socket.on('register-user', (data) => {
        socket.nickname = data.nickname;
        onlineUsers[data.nickname] = socket.id;
        io.emit('update-online-players', Object.keys(onlineUsers).length);
        // Logla: Sisteme giriş yapıldı
        new Log({ action: 'SOCKET_CONNECT', details: `${data.nickname} is online` }).save();
    });

    socket.on('chat-message', (data) => {
        io.emit('new-message', { sender: data.nickname, text: data.message });
    });

    // Global Chat'ten Savaşa Davet
    socket.on('challenge-request', (data) => {
        const targetSid = onlineUsers[data.target];
        if (targetSid) {
            io.to(targetSid).emit('challenge-received', { from: socket.nickname });
        }
    });

    socket.on('disconnect', () => {
        if (socket.nickname) {
            delete onlineUsers[socket.nickname];
            busyUsers.delete(socket.nickname);
            io.emit('update-online-players', Object.keys(onlineUsers).length);
        }
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`BPL ECOSYSTEM OPERATIONAL ON PORT ${PORT}`);
});
const connectDB = require('./db');
const User = require('./models/User');
const Log = require('./models/Log');
const Payment = require('./models/Payment');
const Victory = require('./models/Victory'); 
const Punishment = require('./models/Punishment');
const Income = require('./models/Income'); 

connectDB();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 10000;
app.set('trust proxy', 1);

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

const onlineUsers = {}; 
const busyUsers = new Set();

const checkAuth = (req, res, next) => {
    if (req.session.userId) next(); else res.redirect('/');
};


// --- NODEMAILER AYARI (En üste require'ların yanına ekle) ---


const transporter = nodemailer.createTransport({
    service: 'gmail', // veya .env içindeki bilgiler
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// --- 1. COMMAND CENTER (CONTACT) ROTASI ---
app.post('/contact', async (req, res) => {
    try {
        const { email, note } = req.body;
        // 1. Mongo'ya Kaydet (Log modelini kullanabilirsin veya yeni Contact modeli)
        const newLog = new Log({
            userId: req.session.userId || null,
            action: 'CONTACT_FORM',
            details: `Email: ${email}, Message: ${note}`
        });
        await newLog.save();

        // 2. Mail Gönder (Opsiyonel)
        console.log(`📩 Yeni Destek Mesajı: ${email} -> ${note}`);
        
        res.send('<script>alert("Transmission Received! We will contact you."); window.location.href="/";</script>');
    } catch (e) {
        console.error("Contact Error:", e);
        res.status(500).send("Command Center Offline!");
    }
});

// --- 2. FORGOT PASSWORD ROTASI ---
app.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email });

        if (!user) {
            return res.send('<script>alert("User not found!"); window.location.href="/";</script>');
        }

        // Şifreyi mail atıyoruz (Güvenlik için normalde link gönderilir ama senin isteğin üzerine şifreyi atıyoruz)
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'BPL Ecosystem - Password Recovery',
            text: `Your current password is: ${user.password} \n\nPlease change it after login.`
        };

        await transporter.sendMail(mailOptions);
        res.send('<script>alert("Password sent to your email!"); window.location.href="/";</script>');
    } catch (e) {
        console.error("Forgot Pass Error:", e);
        res.send('<script>alert("Mail System Error!"); window.location.href="/";</script>');
    }
});

// --- ROTALAR ---
app.get('/', (req, res) => res.render('index', { userIp: req.ip }));
app.get('/profil', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('profil', { user });
});
app.get('/market', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('market', { user });
});
app.get('/arena', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('arena', { user, selectedAnimal: req.query.animal });
});
app.get('/chat', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('chat', { user });
});
app.get('/wallet', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('wallet', { user });
});
app.get('/payment', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('payment', { user });
});
app.get('/meeting', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    const roomId = req.query.roomId || "BPL-CENTRAL"; 
    res.render('meeting', { user, roomId });
});
app.get('/development', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('development', { user });
});

// --- POST İŞLEMLERİ ---
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email, password });
    if (user) { req.session.userId = user._id; res.redirect('/profil'); }
    else res.send('<script>alert("Hatalı Giriş!"); window.location.href="/";</script>');
});

app.post('/register', async (req, res) => {
    try {
        const newUser = new User({ ...req.body, bpl: 2500 });
        await newUser.save();
        res.send('<script>alert("Kayıt Başarılı!"); window.location.href="/";</script>');
    } catch (e) { res.send("Kayıt Hatası!"); }
});

app.post('/upgrade-stat', checkAuth, async (req, res) => {
    try {
        const { animalName, statType, cost } = req.body;
        const user = await User.findById(req.session.userId);
        if (user.bpl < cost) return res.json({ status: 'error', msg: 'Yetersiz BPL!' });
        user.bpl -= cost;
        if (!user.stats[animalName]) user.stats[animalName] = { hp: 100, atk: 20, def: 10 };
        if (statType === 'hp') user.stats[animalName].hp += 10;
        else if (statType === 'atk') user.stats[animalName].atk += 5;
        else if (statType === 'def') user.stats[animalName].def += 5;
        user.markModified('stats'); 
        await user.save();
        res.json({ status: 'success', newBalance: user.bpl });
    } catch (e) { res.json({ status: 'error', msg: 'Sunucu hatası!' }); }
});

// --- SOCKET SİSTEMİ ---
io.on('connection', (socket) => {
    socket.on('register-user', (data) => {
        socket.nickname = data.nickname;
        socket.userId = data.id;
        onlineUsers[data.nickname] = socket.id;
        io.emit('update-online-players', Object.keys(onlineUsers).length);
    });

    socket.on('join-arena', () => {
        const opponentNickname = Object.keys(onlineUsers).find(nick => 
            nick !== socket.nickname && !busyUsers.has(nick)
        );
        if (opponentNickname) {
            const opponentSocketId = onlineUsers[opponentNickname];
            const roomId = `arena_${socket.nickname}_${opponentNickname}`;
            socket.join(roomId);
            const opponentSocket = io.sockets.sockets.get(opponentSocketId);
            if (opponentSocket) opponentSocket.join(roomId);
            busyUsers.add(socket.nickname);
            busyUsers.add(opponentNickname);
            io.to(roomId).emit('match-found', { player1: socket.nickname, player2: opponentNickname, roomId: roomId });
        } else {
            socket.emit('waiting-for-opponent');
        }
    });

    socket.on('chat-message', (data) => {
        io.emit('new-message', { sender: data.nickname, text: data.message });
    });

    socket.on('disconnect', () => {
        if (socket.nickname) {
            delete onlineUsers[socket.nickname];
            busyUsers.delete(socket.nickname);
            io.emit('update-online-players', Object.keys(onlineUsers).length);
        }
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`BPL SERVER RUNNING ON PORT ${PORT}`);
});


