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
    res.render('chat', { user });
});

// --- BEŞGEN KONSEY (MEETING) ROTASI ---
app.get('/meeting', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        
        // Kullanıcı kontrolü
        if (!user) return res.redirect('/login');

        // Giriş Ücreti (Örneğin 50 BPL)
        const entryFee = 50;
        if (user.bpl < entryFee) {
            return res.render('profil', { 
                user, 
                error: 'Konseye giriş için yeterli BPL yok!' 
            });
        }

        // Bakiye düş ve kaydet
        user.bpl -= entryFee;
        await user.save();

        const roomId = "BPL-VIP-KONSEY";
        res.render('meeting', { 
            user: user, 
            roomId: roomId 
        });
    } catch (err) {
        console.error("Meeting Hatası:", err);
        res.redirect('/profil');
    }
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

// --- 7. MARKET VE GELİŞTİRME SİSTEMİ (GÜNCEL) ---
app.post('/upgrade-stat', checkAuth, async (req, res) => {
    const { animalName, statType, cost } = req.body;
    try {
        const user = await User.findById(req.session.userId);
        const idx = user.inventory.findIndex(a => a.name === animalName);
        
        if (idx === -1) return res.json({ status: 'error', msg: 'Hayvan bulunamadı!' });
        if (user.bpl < cost) return res.json({ status: 'error', msg: 'Bakiye yetersiz!' });

        const animal = user.inventory[idx];
        let message = "";

        // Geliştirme Mantığı ve Mesaj Tanımlama
        if(statType === 'hp') {
            animal.stats.hp += 10;
            message = "Can (HP) +10 artırıldı.";
        } else if(statType === 'atk') {
            animal.stats.atk += 5;
            message = "Saldırı (ATK) +5 artırıldı.";
        } else if(statType === 'def') {
            animal.stats.def = (animal.stats.def || 0) + 5;
            message = "Savunma (DEF) +5 artırıldı.";
        } else if(statType === 'crit') {
            message = "Kritik Şans geliştirildi.";
        }

        user.bpl -= cost;
        user.markModified('inventory');
        await user.save();

        // Yanıtın içine 'msg' ekledik
        res.json({ 
            status: 'success', 
            msg: message, 
            newBalance: user.bpl 
        });
    } catch (err) { 
        res.status(500).json({ status: 'error', msg: 'Sistem hatası!' }); 
    }
});

// --- 8. ARENA VE SAVAŞ MANTIĞI ---
app.post('/attack-bot', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        if (!user || user.bpl < 200) {
            return res.json({ status: 'error', msg: 'Savaşa girmek için 200 BPL gerekli!' });
        }
        let animalName = (req.body.animal || "eagle").toLowerCase().trim();
        const isWin = Math.random() > 0.5;
        if (isWin) {
            user.bpl += 200;
            const winMsg = `🏆 ${user.nickname}, Arena'da ${animalName} ile büyük bir zafer kazandı!`;
            io.to('Global').emit('new-message', { sender: "ARENA_SISTEM", text: winMsg });
        } else {
            user.bpl -= 200;
        }
        await user.save();
        res.json({
            status: 'success',
            animation: {
                actionVideo: `/caracter/move/${animalName}/${animalName}1.mp4`,
                winVideo: `/caracter/move/${animalName}/${animalName}.mp4`,
                isWin: isWin
            },
            newBalance: user.bpl
        });
    } catch (err) {
        res.status(500).json({ status: 'error', msg: 'Sunucu hatası!' });
    }
});

// --- 9. ÖDEME VE CÜZDAN DOĞRULAMA ---
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
        } else { res.json({ status: 'error', msg: 'Veri uyuşmuyor!' }); }
    } catch (err) { res.status(500).json({ status: 'error' }); }
});

// --- 10. SOCKET.IO SİSTEMİ (TÜM MANTIK TEK BİR BLOK İÇİNDE) ---
io.on('connection', (socket) => {
    
    // [KULLANICI KAYDI]
    socket.on('register-user', (data) => {
        if (data && data.nickname) {
            socket.userId = data.id;
            socket.nickname = data.nickname;
            socket.join('Global');
            console.log(`${socket.nickname} bağlandı.`);
        }
    });

    // [GLOBAL CHAT]
    socket.on('chat-message', (data) => {
        if (data.text && data.text.trim() !== "") {
            io.to('Global').emit('new-message', { 
                sender: socket.nickname || "Kumandan", 
                text: data.text 
            });
        }
    });

    // [BPL TRANSFERİ]
    socket.on('transfer-bpl', async (data) => {
        try {
            const sender = await User.findById(socket.userId);
            const receiver = await User.findOne({ nickname: data.to });
            if (sender && receiver && sender.bpl >= 6000) {
                const amount = Math.min(data.amount, 1000);
                const tax = Math.floor(amount * 0.25);
                sender.bpl -= amount;
                receiver.bpl += (amount - tax);
                await sender.save(); await receiver.save();
                socket.emit('gift-result', { newBalance: sender.bpl, message: 'Başarıyla gönderildi!' });
            }
        } catch (e) { console.error(e); }
    });
// --- 10. SOCKET.IO SİSTEMİ (TÜM MANTIK TEK BİR BLOK İÇİNDE) ---
io.on('connection', (socket) => {
    
    // [KULLANICI KAYDI]
    socket.on('register-user', (data) => {
        if (data && data.nickname) {
            socket.userId = data.id;
            socket.nickname = data.nickname;
            socket.join('Global');
            console.log(`${socket.nickname} bağlandı.`);
        }
    });

    // [GLOBAL CHAT]
    socket.on('chat-message', (data) => {
        if (data.text && data.text.trim() !== "") {
            const targetRoom = data.room || 'Global';
            io.to(targetRoom).emit('new-message', { 
                sender: socket.nickname || "Kumandan", 
                text: data.text 
            });
        }
    });

    // [BPL TRANSFERİ]
    socket.on('transfer-bpl', async (data) => {
        try {
            const sender = await User.findById(socket.userId);
            const receiver = await User.findOne({ nickname: data.to });
            if (sender && receiver && sender.bpl >= 6000) {
                const amount = Math.min(data.amount, 1000);
                const tax = Math.floor(amount * 0.25);
                sender.bpl -= amount;
                receiver.bpl += (amount - tax);
                await sender.save(); await receiver.save();
                socket.emit('gift-result', { newBalance: sender.bpl, message: 'Başarıyla gönderildi!' });
            }
        } catch (e) { console.error(e); }
    });

    // [VIP ODAYA KATILIM]
    socket.on('join-meeting', (data) => {
        // Data objesi veya direkt roomId gelme durumuna göre kontrol
        const roomId = (typeof data === 'string') ? data : data.roomId;
        if (roomId) {
            socket.join(roomId);
            console.log(`VIP Odaya Giriş: ${socket.nickname || 'Bilinmeyen'} -> ${roomId}`);
            
            io.to(roomId).emit('new-message', { 
                sender: "SİSTEM", 
                text: `🔥 ${socket.nickname || 'Bir üye'} konseye katıldı!` 
            });
        }
    });

    // [VIP HEDİYE SİSTEMİ]
    socket.on('send-gift-vip', async (data) => {
        try {
            const senderId = data.senderId || socket.userId;
            const sender = await User.findById(senderId);
            const receiver = await User.findOne({ nickname: data.targetNick });
            
            if (sender && receiver && sender.bpl >= 5000) {
                const taxPercent = data.tax / 100;
                const netAmount = Math.floor(data.amount * (1 - taxPercent));
                
                sender.bpl -= data.amount;
                receiver.bpl += netAmount;
                
                await sender.save(); 
                await receiver.save();
                
                io.to(data.room).emit('new-message', { 
                    sender: "SİSTEM", 
                    text: `🎁 ${sender.nickname} -> ${receiver.nickname}: ${data.amount} BPL gönderildi!` 
                });
                
                socket.emit('gift-result', { 
                    status: 'success', 
                    message: 'İşlem Başarılı!', 
                    newBalance: sender.bpl 
                });
            }
        } catch (e) { console.error(e); }
    });

    // [VIP ARENA SAVAŞI]
    socket.on('start-vip-battle', async (data) => {
        try {
            const p1 = await User.findOne({ nickname: data.p1 });
            const p2 = await User.findOne({ nickname: data.p2 });
            
            if (p1 && p1.bpl >= 200) {
                p1.bpl -= 200;
                await p1.save();
                
                const winner = Math.random() > 0.5 ? p1 : p2;
                const animal = (p1.selectedAnimal || "eagle").toLowerCase();
                
                io.to(data.room).emit('battle-video-play', {
                    winner: winner.nickname,
                    moveVideo: `/caracter/move/${animal}/${animal}1.mp4`,
                    video: `/caracter/move/${animal}/${animal}.mp4`
                });
            }
        } catch (e) { console.error(e); }
    });

    // [AYRILMA]
    socket.on('disconnect', () => { 
        console.log('Bir kumandan ayrıldı.'); 
    });

}); // <--- TÜM SOKETLER BU PARANTEZİN İÇİNDE KALMAK ZORUNDA

// --- 11. SUNUCU BAŞLATMA ---
server.listen(PORT, "0.0.0.0", () => {
    console.log(`BPL ECOSYSTEM AKTİF: PORT ${PORT}`);
});




