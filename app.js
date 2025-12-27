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
const Log = require('./models/Log'); // Yeni eklenen satır
connectDB();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 10000; 
app.set('trust proxy', 1);

const LOG_PATHS = {
    MARKET: 'public/caracter/burning/market.txt',
    ARENA: 'public/caracter/burning/arena.dat',
    GIFT: 'data/gift/interruption.txt',
    MEETING: 'public/caracter/burning/meeting.txt',
    WALLET: 'data/game/wallet/wallet.dat'
};

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 15, message: "Çok fazla deneme yaptınız." });

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

const logToFile = (relativePath, content) => {
    const fullPath = path.join(__dirname, relativePath);
    const dir = path.dirname(fullPath);
    try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const logLine = `${new Date().toLocaleString('tr-TR')} | ${content}\n`;
        fs.appendFileSync(fullPath, logLine, 'utf8');
    } catch (err) { console.error("Log hatası:", err.message); }

const dbLog = async (type, content) => {
    try {
        const newLog = new Log({ type, content });
        await newLog.save();
        console.log(`[DB LOG] ${type}: ${content}`);
    } catch (err) {
        console.error("MongoDB Log hatası:", err.message);
    }
};


    
};

const checkAuth = (req, res, next) => {
    if (req.session.userId) next(); else res.redirect('/');
};

// --- ROTALAR ---

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
        res.render('arena', { user, selectedAnimal }); 
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

// --- ELITE MASA KURMA (POST) ---
app.post('/create-meeting', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        if (user && user.bpl >= 50) {
            user.bpl -= 50;
            await user.save();
            const roomId = "Masa_" + Math.random().toString(36).substr(2, 5);
            logToFile(LOG_PATHS.MEETING, `${user.nickname} masa kurdu: ${roomId}`);
            res.redirect(`/meeting?roomId=${roomId}&userId=${user._id}`);
        } else {
            res.send('<script>alert("Yetersiz Bakiye! Masa kurmak için 50 BPL gereklidir."); window.location.href="/chat";</script>');
        }
    } catch (e) { res.redirect('/chat'); }
});

// --- AUTH VE OYUN İŞLEMLERİ ---

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

app.post('/change-password', checkAuth, async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.session.userId, { password: req.body.password });
        res.json({ status: 'success' });
    } catch (e) { res.json({ status: 'error' }); }
});

app.post('/buy-animal', checkAuth, async (req, res) => {
    const { animalName, price } = req.body;
    try {
        const user = await User.findById(req.session.userId);
        if (user && user.bpl >= price) {
            user.bpl -= price;
            if (!user.inventory.includes(animalName)) {
                user.inventory.push(animalName);
            }
            if(!user.stats) user.stats = {};
            user.stats[animalName] = { hp: 100, atk: 15, def: 10 };
            user.markModified('stats'); 
            await user.save();
            logToFile(LOG_PATHS.MARKET, `${user.nickname} aldı: ${animalName}`);
            res.json({ status: 'success', newBalance: user.bpl });
        } else res.json({ status: 'error', msg: 'Yetersiz Bakiye!' });
    } catch (e) { res.json({ status: 'error' }); }
});

app.post('/upgrade-stat', checkAuth, async (req, res) => {
    const { animalName, statType } = req.body;
    const prices = { hp: 50, atk: 40, def: 35 };
    try {
        const user = await User.findById(req.session.userId);
        const price = prices[statType];
        if (user && user.bpl >= price) {
            user.bpl -= price;
            if (!user.stats[animalName]) user.stats[animalName] = { hp: 100, atk: 15, def: 10 };
            user.stats[animalName][statType] += (statType === 'hp' ? 10 : 5);
            user.markModified('stats');
            await user.save();
            res.json({ status: 'success', newBalance: user.bpl });
        } else res.json({ status: 'error', msg: 'Bakiye yetersiz!' });
    } catch (e) { res.json({ status: 'error' }); }
});

app.post('/withdraw', checkAuth, async (req, res) => {
    const { amount } = req.body;
    try {
        const user = await User.findById(req.session.userId);
        if (amount >= 7500 && user.bpl >= amount) {
            user.bpl -= amount;
            await user.save();
            logToFile(LOG_PATHS.WALLET, `${user.nickname} çekim talebi: ${amount}`);
            res.json({ status: 'success', msg: 'Talebiniz alındı.' });
        } else res.json({ status: 'error', msg: 'Limit dışı veya yetersiz bakiye.' });
    } catch (e) { res.json({ status: 'error' }); }
});

// --- SOCKET.IO (ARENA, CHAT, MEETING) ---

io.on('connection', (socket) => {
    
    // --- CHAT VE TOPLANTI SİSTEMİ ---
    socket.on('join-chat', (data) => {
        socket.join(data.room);
        socket.nickname = data.nickname;
        socket.roomId = data.room; 
        
        socket.to(data.room).emit('user-joined', { 
            nickname: data.nickname, 
            socketId: socket.id 
        });

        socket.emit('sync-meeting', { remaining: 90 * 60 * 1000 });
        
        // Sistem mesajı: Birisi odaya katıldı
        io.to(data.room).emit('new-message', { sender: "SİSTEM", text: `${data.nickname} lobiye bağlandı.` });
    });

    // Chat Mesajları (chat.ejs)
    socket.on('chat-message', (data) => {
        io.to(data.room).emit('new-message', { sender: data.nickname, text: data.message });
    });

    // Toplantı Mesajları (meeting.ejs)
    socket.on('meeting-msg', (data) => {
        io.to(data.room).emit('new-meeting-msg', { sender: data.sender, text: data.text });
    });

    // Özel Davet / Sinyal Mekanizması
    socket.on('send-private-invite', (data) => {
        // Chat sayfasındaki herkese bu sinyali gönder (Frontend'de toNick kontrolü var)
        io.emit('receive-meeting-invite', data);
    });

    // Hediye Gönderme Sistemi (chat.ejs)
    socket.on('send-gift', async (data) => {
        try {
            const sender = await User.findById(data.userId);
            const receiver = await User.findOne({ nickname: data.to });

            if (sender && receiver && sender.bpl >= 6000 && data.amount <= 500) {
                sender.bpl -= data.amount;
                receiver.bpl += data.amount;
                await sender.save();
                await receiver.save();

                logToFile(LOG_PATHS.GIFT, `${sender.nickname} -> ${receiver.nickname}: ${data.amount} BPL`);

                socket.emit('gift-result', { 
                    success: true, 
                    message: `${data.to} kullanıcısına ${data.amount} BPL gönderildi!`,
                    newBalance: sender.bpl 
                });

                io.to(data.room).emit('new-message', { 
                    sender: "SİSTEM", 
                    text: `🎁 ${sender.nickname}, ${receiver.nickname} kullanıcısına ${data.amount} BPL hediye etti!` 
                });
            }
        } catch (err) { console.error("Hediye hatası:", err); }
    });

    // --- WebRTC SİNYALLEŞME ---
    socket.on('webrtc-offer', (data) => {
        socket.to(data.toSocket).emit('webrtc-offer', {
            offer: data.offer,
            fromSocket: socket.id,
            senderNick: data.senderNick
        });
    });

    socket.on('webrtc-answer', (data) => {
        socket.to(data.toSocket).emit('webrtc-answer', {
            answer: data.answer,
            fromSocket: socket.id
        });
    });

    socket.on('webrtc-ice-candidate', (data) => {
        socket.to(data.toSocket).emit('webrtc-ice-candidate', {
            candidate: data.candidate,
            fromSocket: socket.id
        });
    });

    // --- ARENA SİSTEMİ ---
    socket.on('join-arena', async (data) => {
        socket.join("arena_lobby");
        const user = await User.findById(data.userId);
        if (user) {
            socket.userData = { userId: user._id.toString(), nickname: user.nickname, animal: data.selectedAnimal };
        }
    });

    socket.on('start-search', () => {
        const lobby = io.sockets.adapter.rooms.get("arena_lobby");
        if (lobby && lobby.size >= 1) {
            const botData = { nickname: "Savaşçı_Bot", animal: "Snake", userId: "BOT123" };
            const winnerId = Math.random() > 0.4 ? (socket.userData ? socket.userData.userId : "BOT123") : "BOT123";
            socket.emit('match-found', { matchId: `match_${Date.now()}`, winnerId, opponent: botData });
        }
    });

    socket.on('claim-victory', async (data) => {
        const user = await User.findById(data.userId);
        if (user) { user.bpl += 50; await user.save(); logToFile(LOG_PATHS.ARENA, `${user.nickname} +50 BPL`); }
    });

    // --- AYRILMA ---
    socket.on('disconnect', () => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('user-left', socket.id);
        }
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`BPL SİSTEMİ ÇALIŞIYOR | PORT: ${PORT}`);
});

