
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

const connectDB = require('./db');
const User = require('./models/User');

// Veritabanı bağlantısı
connectDB();

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

// HTTPS Yönlendirmesi
app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https' && process.env.NODE_ENV === 'production') {
        res.redirect(`https://${req.header('host')}${req.url}`);
    } else {
        next();
    }
});

// --- RENDER İÇİN KRİTİK PORT VE PROXY AYARI ---
const PORT = process.env.PORT || 10000; 
app.set('trust proxy', 1); 

// ODA YÖNETİM MERKEZİ (Meeting.ejs ile uyumlu)
const activeMeetings = {};

// --- GÜVENLİK VE SINIRLANDIRICILAR ---
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: "Çok fazla istek attınız, lütfen biraz bekleyin."
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15, 
    message: "Çok fazla deneme yaptınız. 15 dakika engellendiniz."
});

// IP bazlı yasakları takip etmek için nesne
let ipLoginAttempts = {};

// --- MIDDLEWARE ---
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

// --- LOGLAMA SİSTEMİ ---
const logToFile = (relativePath, content) => {
    const fullPath = path.join(__dirname, relativePath);
    const dir = path.dirname(fullPath);
    try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const logLine = `${new Date().toLocaleString('tr-TR')} | ${content}\n`;
        fs.appendFileSync(fullPath, logLine, 'utf8');
    } catch (err) {
        console.error("Log yazma hatası:", err.message);
    }
};

const LOG_PATHS = {
    MARKET: 'public/caracter/burning/market.txt',
    ARENA: 'public/caracter/burning/arena.dat',
    DEV: 'public/caracter/burning/development.txt',
    GIFT: 'data/gift/interruption.txt',
    MEETING: 'public/caracter/burning/meeting.txt',
    WALLET_WITHDRAW: 'data/game/wallet/wallet.dat',
    PAYMENT_LOG: 'data/game/wallet/payment.dat',
    SUPPORT: 'data/support/tickets.txt' 
};

// --- ANA SAYFA VE IP YÖNETİMİ ---
app.get('/', (req, res) => {
    const userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    let isBlocked = false;
    let remainingTime = 0;

    if (ipLoginAttempts[userIp] && ipLoginAttempts[userIp].count >= 4) {
        const simdi = Date.now();
        if (simdi < ipLoginAttempts[userIp].banUntil) {
            isBlocked = true;
            remainingTime = Math.ceil((ipLoginAttempts[userIp].banUntil - simdi) / (1000 * 60));
        } else {
            delete ipLoginAttempts[userIp]; 
        }
    }

    res.render('index', { 
        articles: ["Arena Yayında!", "Market Güncellendi"],
        userIp: userIp,
        forceHelp: false,
        isBlocked: isBlocked,
        remainingTime: remainingTime
    });
});

const checkAuth = (req, res, next) => {
    if (req.session.userId) {
        next(); 
    } else {
        res.redirect('/'); 
    }
};

// --- DESTEK / ŞİKAYET FORMU ---
app.post('/contact-submit', async (req, res) => {
    const { email, message } = req.body;
    const userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    try {
        // Satır formatı: Tarih | IP | Email | Mesaj
        const logContent = `[${new Date().toLocaleString('tr-TR')}] IP: ${userIp} | E-posta: ${email} | Mesaj: ${message}\n`;
        
        // Log dosyasına ekle (LOG_PATHS.SUPPORT = 'data/support/tickets.txt')
        fs.appendFileSync(path.join(__dirname, LOG_PATHS.SUPPORT), logContent, 'utf8');

        res.json({ 
            status: 'success', 
            msg: 'Mesajınız kaydedildi. Destek için: bonusplayerslive@gmail.com' 
        });
    } catch (e) {
        console.error("Yazma Hatası:", e.message);
        res.json({ status: 'error', msg: 'Mesaj iletilemedi, lütfen mail atın.' });
    }
});

// --- SAYFA ROUTE'LARI ---
app.get('/profil', checkAuth, async (req, res) => { 
    try { const user = await User.findById(req.session.userId); res.render('profil', { user }); } catch (e) { res.redirect('/'); }
});
app.get('/market', checkAuth, async (req, res) => { 
    try { const user = await User.findById(req.session.userId); res.render('market', { user }); } catch (e) { res.redirect('/'); }
});
app.get('/wallet', checkAuth, async (req, res) => { 
    try { const user = await User.findById(req.session.userId); res.render('wallet', { user }); } catch (e) { res.redirect('/'); }
});
app.get('/arena', checkAuth, async (req, res) => { 
    try { const user = await User.findById(req.session.userId); res.render('arena', { user }); } catch (e) { res.redirect('/'); }
});
app.get('/chat', checkAuth, async (req, res) => { 
    try { const user = await User.findById(req.session.userId); res.render('chat', { user, room: 'Global' }); } catch (e) { res.redirect('/'); }
});
app.get('/payment', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const packages = [{ usd: 10, bpl: 1000 }, { usd: 50, bpl: 5500 }, { usd: 100, bpl: 12000 }];
        res.render('payment', { user, packages, paymentText: process.env.WALLET_ADDRESS }); 
    } catch (e) { res.redirect('/'); }
});

app.get('/meeting', checkAuth, async (req, res) => {
    try {
        const { roomId } = req.query;
        const user = await User.findById(req.session.userId);
        if (!user || !roomId) return res.redirect('/profil');
        res.render('meeting', { user, roomId }); 
    } catch (e) { res.redirect('/profil'); }
});

// --- LOGIN VE KAYIT ---
app.post('/login', authLimiter, async (req, res) => {
    const { email, password } = req.body;
    const userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    if (ipLoginAttempts[userIp] && ipLoginAttempts[userIp].count >= 4) {
        const simdi = Date.now();
        if (simdi < ipLoginAttempts[userIp].banUntil) {
            return res.send(`<script>alert("IP Engellendi!"); window.location.href="/";</script>`);
        }
    }

    const user = await User.findOne({ email, password });
    if (user) {
        delete ipLoginAttempts[userIp]; 
        req.session.userId = user._id;
        res.redirect(`/profil`);
    } else {
        if (!ipLoginAttempts[userIp]) ipLoginAttempts[userIp] = { count: 1 };
        else ipLoginAttempts[userIp].count++;

        if (ipLoginAttempts[userIp].count >= 4) {
            ipLoginAttempts[userIp].banUntil = Date.now() + (120 * 60 * 1000);
            return res.send('<script>alert("Kilitlendi."); window.location.href="/";</script>');
        }
        res.send(`<script>alert("Hatalı Giriş!"); window.location.href="/";</script>`);
    }
});

app.post('/register', authLimiter, async (req, res) => {
    try {
        const newUser = new User({ ...req.body, bpl: 2500 });
        await newUser.save();
        res.send('<script>alert("Kayıt Başarılı!"); window.location.href="/";</script>');
    } catch (e) { res.send("Hata!"); }
});

// --- MEETING ODA KURMA ---
app.post('/create-meeting', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        if (user && user.bpl >= 50) {
            user.bpl -= 50; await user.save();
            const roomId = Math.random().toString(36).substring(2, 7);
            activeMeetings[roomId] = { hostId: user._id.toString(), startTime: Date.now(), maxTime: 90 * 60 * 1000, inviteLimit: 5 * 60 * 1000 };
            res.redirect(`/meeting?roomId=${roomId}`);
        } else {
            res.send('<script>alert("Yetersiz Bakiye!"); window.history.back();</script>');
        }
    } catch (e) { res.redirect('/profil'); }
});

// --- SOCKET.IO SİSTEMİ ---
io.on('connection', (socket) => {
    socket.on('join-chat', (data) => {
        socket.join(data.room);
        socket.nickname = data.nickname;
        socket.userId = data.userId;
        socket.roomName = data.room;
        
        const meeting = activeMeetings[data.room];
        if (meeting) {
            const elapsed = Date.now() - meeting.startTime;
            socket.emit('sync-meeting', { remaining: meeting.maxTime - elapsed, canInvite: elapsed < meeting.inviteLimit });
        }
        socket.to(data.room).emit('user-joined', { socketId: socket.id, nickname: data.nickname, userId: data.userId });
    });

    socket.on('chat-message', (data) => { io.to(data.room).emit('new-message', { sender: data.nickname || "Sistem", text: data.message }); });

    socket.on('send-gift', async (data) => {
        try {
            const sender = await User.findById(data.userId);
            const receiver = await User.findOne({ nickname: data.to });
            if (!sender || !receiver || sender.bpl < 6000 || data.amount > 500) return socket.emit('gift-result', { message: "Hata!" });
            sender.bpl -= data.amount; receiver.bpl += data.amount;
            await sender.save(); await receiver.save();
            io.to(data.room).emit('new-message', { sender: "SİSTEM", text: `🎁 ${sender.nickname} -> ${receiver.nickname} | ${data.amount} BPL` });
        } catch (e) { }
    });

    // WebRTC ve Arena logicleri buraya devam eder...
    // BOT VE SEARCH SİSTEMİ (Patlamayı Önleyen Kısım)
    socket.on('join-arena', async (data) => {
        socket.join("arena_lobby");
        try {
            const user = await User.findById(data.userId);
            if (!user) return;
            const animalName = data.selectedAnimal || user.inventory[0] || "Gökdoğan";
            socket.userData = { 
                userId: user._id.toString(), nickname: user.nickname, animal: animalName,
                stats: { hp: user.stats?.[animalName]?.hp || 100, atk: user.stats?.[animalName]?.atk || 10 }
            };
        } catch (err) { }
    });

    socket.on('start-search', () => {
        const lobby = io.sockets.adapter.rooms.get("arena_lobby");
        if (lobby && lobby.size >= 2) {
            const opponentId = Array.from(lobby).find(id => id !== socket.id);
            const oppSocket = io.sockets.sockets.get(opponentId);
            if(oppSocket?.userData && socket.userData) {
                const matchId = `match_${Date.now()}`;
                socket.leave("arena_lobby"); oppSocket.leave("arena_lobby");
                socket.join(matchId); oppSocket.join(matchId);
                const winnerId = Math.random() > 0.5 ? socket.userData.userId : oppSocket.userData.userId;
                socket.emit('match-found', { matchId, winnerId, opponent: oppSocket.userData });
                oppSocket.emit('match-found', { matchId, winnerId, opponent: socket.userData });
            }
        } else {
            setTimeout(() => {
                const currentLobby = io.sockets.adapter.rooms.get("arena_lobby");
                if (currentLobby && currentLobby.has(socket.id)) {
                    const matchId = `bot_${Date.now()}`;
                    socket.leave("arena_lobby"); socket.join(matchId);
                    socket.emit('match-found', { 
                        matchId, winnerId: socket.userData.userId, 
                        opponent: { nickname: "BOT_CELL", animal: "Kurt", userId: "bot" } 
                    });
                }
            }, 5000);
        }
    });

    socket.on('claim-victory', async (data) => {
        try {
            const user = await User.findById(data.userId);
            if (user) { user.bpl += 50; await user.save(); }
        } catch (e) { }
    });
});

// --- SERVER BAŞLATMA ---
server.listen(PORT, "0.0.0.0", () => {
    console.log(`BPL ELITE AKTİF | Port: ${PORT}`);
});

