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
const io = socketIo(server);

const PORT = process.env.PORT || 10000; 
app.set('trust proxy', 1);

const activeMeetings = {};
let ipLoginAttempts = {};

// GÜVENLİK SINIRLAMALARI
const generalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, message: "Çok fazla istek attınız." });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 15, message: "Çok fazla deneme yaptınız." });

// MIDDLEWARE
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

// LOG SİSTEMİ
const logToFile = (relativePath, content) => {
    const fullPath = path.join(__dirname, relativePath);
    const dir = path.dirname(fullPath);
    try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const logLine = `${new Date().toLocaleString('tr-TR')} | ${content}\n`;
        fs.appendFileSync(fullPath, logLine, 'utf8');
    } catch (err) { console.error("Log yazma hatası:", err.message); }
};

const LOG_PATHS = {
    MARKET: 'public/caracter/burning/market.txt',
    ARENA: 'public/caracter/burning/arena.dat',
    GIFT: 'data/gift/interruption.txt',
    SUPPORT: 'data/support/tickets.txt',
    WALLET: 'data/game/wallet/wallet.dat'
};

// ANA SAYFA VE AUTH
app.get('/', (req, res) => {
    const userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    let isBlocked = false;
    let remainingTime = 0;
    if (ipLoginAttempts[userIp] && ipLoginAttempts[userIp].count >= 4) {
        const simdi = Date.now();
        if (simdi < ipLoginAttempts[userIp].banUntil) {
            isBlocked = true;
            remainingTime = Math.ceil((ipLoginAttempts[userIp].banUntil - simdi) / (1000 * 60));
        } else { delete ipLoginAttempts[userIp]; }
    }
    res.render('index', { articles: ["Arena Yayında!", "Market Güncellendi"], userIp, forceHelp: false, isBlocked, remainingTime });
});

const checkAuth = (req, res, next) => {
    if (req.session.userId) next(); else res.redirect('/');
};

// --- ROTALAR ---
app.get('/profil', checkAuth, async (req, res) => { try { const user = await User.findById(req.session.userId); res.render('profil', { user }); } catch (e) { res.redirect('/'); } });
app.get('/market', checkAuth, async (req, res) => { try { const user = await User.findById(req.session.userId); res.render('market', { user }); } catch (e) { res.redirect('/'); } });
app.get('/wallet', checkAuth, async (req, res) => { try { const user = await User.findById(req.session.userId); res.render('wallet', { user }); } catch (e) { res.redirect('/'); } });
app.get('/arena', checkAuth, async (req, res) => { try { const user = await User.findById(req.session.userId); res.render('arena', { user }); } catch (e) { res.redirect('/'); } });
app.get('/chat', checkAuth, async (req, res) => { try { const user = await User.findById(req.session.userId); res.render('chat', { user, room: 'Global' }); } catch (e) { res.redirect('/'); } });
app.get('/meeting', checkAuth, async (req, res) => { try { const user = await User.findById(req.session.userId); const roomId = req.query.roomId; res.render('meeting', { user, roomId }); } catch (e) { res.redirect('/profil'); } });

app.post('/login', authLimiter, async (req, res) => {
    const { email, password } = req.body;
    const userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const user = await User.findOne({ email, password });
    if (user) {
        delete ipLoginAttempts[userIp];
        req.session.userId = user._id;
        res.redirect('/profil');
    } else {
        ipLoginAttempts[userIp] = ipLoginAttempts[userIp] || { count: 0 };
        ipLoginAttempts[userIp].count++;
        if (ipLoginAttempts[userIp].count >= 4) ipLoginAttempts[userIp].banUntil = Date.now() + (120 * 60 * 1000);
        res.send(`<script>alert("Hatalı Giriş!"); window.location.href="/";</script>`);
    }
});

app.post('/register', authLimiter, async (req, res) => {
    try {
        const newUser = new User({ ...req.body, bpl: 2500 });
        await newUser.save();
        res.send('<script>alert("Kayıt Başarılı!"); window.location.href="/";</script>');
    } catch (e) { res.send("Kayıt Hatası."); }
});

// --- MARKET İŞLEMLERİ ---
app.post('/buy-animal', checkAuth, async (req, res) => {
    const { animalName, price } = req.body;
    try {
        const user = await User.findById(req.session.userId);
        if (user && user.bpl >= price) {
            user.bpl -= price;
            user.inventory.push(animalName);
            if(!user.stats) user.stats = {};
            user.stats[animalName] = { hp: 100, atk: 10, def: 10 };
            user.markModified('stats'); 
            await user.save();
            logToFile(LOG_PATHS.MARKET, `${user.nickname} aldı: ${animalName}`);
            res.json({ status: 'success', newBalance: user.bpl });
        } else res.json({ status: 'error', msg: 'Yetersiz Bakiye!' });
    } catch (e) { res.json({ status: 'error', msg: 'Sunucu hatası oluştu.' }); }
});

// --- SOCKET.IO SİSTEMLERİ ---
io.on('connection', (socket) => {
    socket.on('join-arena', async (data) => {
        socket.join("arena_lobby");
        try {
            const user = await User.findById(data.userId);
            if (user) {
                const animal = data.selectedAnimal || "Gökdoğan";
                socket.userData = { 
                    userId: user._id.toString(), 
                    nickname: user.nickname, 
                    animal: animal 
                };
            }
        } catch (err) { }
    });

    socket.on('start-search', () => {
        const lobby = io.sockets.adapter.rooms.get("arena_lobby");
        if (lobby && lobby.size >= 1) {
            const players = Array.from(lobby);
            const opponentId = players.find(id => id !== socket.id);
            
            // Bot Ayarı (Eğer kimse yoksa veya bot gerekiyorsa)
            let oppSocket = io.sockets.sockets.get(opponentId);
            if (!oppSocket) {
                // Manuel Bot Tanımlama
                oppSocket = { 
                    userData: { nickname: "Savaşçı_Bot", animal: "Kurd", userId: "BOT123" },
                    emit: () => {}, join: () => {}, leave: () => {}
                };
            }

            const matchId = `match_${Date.now()}`;
            socket.leave("arena_lobby");
            socket.join(matchId);

            // Bot galibiyet oranı %40 (Senin kazanma şansın %60)
            const isBot = oppSocket.userData.nickname.includes("Savaşçı");
            const winnerId = isBot ? (Math.random() < 0.6 ? socket.userData.userId : "BOT123") 
                                   : (Math.random() > 0.5 ? socket.userData.userId : oppSocket.userData.userId);

            socket.emit('match-found', { matchId, winnerId, opponent: oppSocket.userData });
        }
    });

    socket.on('claim-victory', async (data) => {
        try {
            const user = await User.findById(data.userId);
            if (user) { 
                user.bpl += 50; 
                await user.save(); 
                logToFile(LOG_PATHS.ARENA, `${user.nickname} kazandı +50 BPL`);
            }
        } catch (e) { }
    });

    socket.on('send-gift', async (data) => {
        try {
            const sender = await User.findById(data.userId);
            const receiver = await User.findOne({ nickname: data.to });
            if (sender && receiver && sender.bpl >= 6000 && data.amount <= 500) {
                sender.bpl -= data.amount; receiver.bpl += data.amount;
                await sender.save(); await receiver.save();
                io.emit('new-message', { sender: "SİSTEM", text: `🎁 ${sender.nickname} -> ${receiver.nickname} hediye!` });
            }
        } catch (e) { }
    });

    // WebRTC Sinyalleşme
    socket.on('webrtc-offer', (data) => socket.to(data.toSocket).emit('webrtc-offer', data));
    socket.on('webrtc-answer', (data) => socket.to(data.toSocket).emit('webrtc-answer', data));
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`BPL SİSTEMİ ÇALIŞIYOR | PORT: ${PORT}`);
});
