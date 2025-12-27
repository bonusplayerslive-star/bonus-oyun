// Path: app.js
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
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// Render ve HTTPS ayarları
const PORT = process.env.PORT || 10000; 
app.set('trust proxy', 1); 

app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https' && process.env.NODE_ENV === 'production') {
        res.redirect(`https://${req.header('host')}${req.url}`);
    } else { next(); }
});

// Global Değişkenler
const activeMeetings = {};
let ipLoginAttempts = {};

// Loglama Sistemi (Hata payı minimize edildi)
const LOG_PATHS = {
    MARKET: 'public/caracter/burning/market.txt',
    ARENA: 'public/caracter/burning/arena.dat',
    DEV: 'public/caracter/burning/development.txt',
    GIFT: 'data/gift/interruption.txt',
    MEETING: 'public/caracter/burning/meeting.txt',
    WALLET_WITHDRAW: 'data/game/wallet/wallet.dat',
    SUPPORT: 'data/support/tickets.txt' 
};

const logToFile = (relativePath, content) => {
    const fullPath = path.join(__dirname, relativePath);
    const dir = path.dirname(fullPath);
    try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const logLine = `${new Date().toLocaleString('tr-TR')} | ${content}\n`;
        fs.appendFileSync(fullPath, logLine, 'utf8');
    } catch (err) { console.error("Log hatası:", err.message); }
};

// Middleware
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

// --- ROUTES ---

app.get('/', (req, res) => {
    const userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    let isBlocked = false;
    let remainingTime = 0;

    if (ipLoginAttempts[userIp] && ipLoginAttempts[userIp].count >= 4) {
        const simdi = Date.now();
        if (simdi < ipLoginAttempts[userIp].banUntil) {
            isBlocked = true;
            remainingTime = Math.ceil((ipLoginAttempts[userIp].banUntil - simdi) / (1000 * 60));
        }
    }

    res.render('index', { 
        articles: ["Arena Güncellendi!", "BPL Elite Market Yayında"],
        userIp: userIp,
        isBlocked: isBlocked,
        remainingTime: remainingTime
    });
});

const checkAuth = (req, res, next) => {
    if (req.session.userId) next(); else res.redirect('/');
};

// Destek Formu - bonusplayerslive@gmail.com entegre edildi
app.post('/contact-submit', async (req, res) => {
    const { email, message } = req.body;
    const userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    try {
        logToFile(LOG_PATHS.SUPPORT, `TALEP: [${email}] Mesaj: ${message}`);
        res.json({ status: 'success', msg: 'Mesajınız iletildi. bonusplayerslive@gmail.com üzerinden de bize ulaşabilirsiniz.' });
    } catch (e) { res.json({ status: 'error', msg: 'Hata oluştu.' }); }
});

// Sayfa Yönlendirmeleri
app.get('/profil', checkAuth, async (req, res) => { 
    try {
        const user = await User.findById(req.session.userId);
        res.render('profil', { user });
    } catch (e) { res.redirect('/'); }
});

app.get('/market', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        res.render('market', { user }); 
    } catch (e) { res.redirect('/profil'); }
});

// Market Satın Alma - "Sunucu Hatası" Düzeltildi
app.post('/buy-animal', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const { animalName, price } = req.body;

        if (user && user.bpl >= price) {
            user.bpl -= price;
            if (!user.inventory.includes(animalName)) {
                user.inventory.push(animalName);
            }
            if(!user.stats) user.stats = {};
            user.stats[animalName] = { hp: 100, atk: 10, def: 10 };

            // Veritabanına değişiklikleri zorla bildir
            user.markModified('stats');
            user.markModified('inventory');
            await user.save();

            res.json({ status: 'success', newBalance: user.bpl });
        } else {
            res.json({ status: 'error', msg: 'Bakiye yetersiz.' });
        }
    } catch (e) {
        console.error("Market hatası:", e);
        res.status(500).json({ status: 'error', msg: 'Sunucu hatası oluştu!' });
    }
});

// Giriş Sistemi - Render Çökme Hatası (Status 1) Onarıldı
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    if (ipLoginAttempts[userIp] && ipLoginAttempts[userIp].count >= 4) {
        if (Date.now() < ipLoginAttempts[userIp].banUntil) {
            return res.send('<script>alert("Erişim geçici olarak kısıtlandı!"); window.location.href="/";</script>');
        }
    }

    try {
        const user = await User.findOne({ email, password });
        if (user) {
            delete ipLoginAttempts[userIp]; 
            req.session.userId = user._id;
            res.redirect('/profil');
        } else {
            if (!ipLoginAttempts[userIp]) ipLoginAttempts[userIp] = { count: 1 };
            else ipLoginAttempts[userIp].count++;

            if (ipLoginAttempts[userIp].count >= 4) {
                ipLoginAttempts[userIp].banUntil = Date.now() + (120 * 60 * 1000);
            }
            res.send('<script>alert("Hatalı giriş!"); window.location.href="/";</script>');
        }
    } catch (e) { res.redirect('/'); }
});

// Kayıt Sistemi
app.post('/register', async (req, res) => {
    try {
        const newUser = new User({ ...req.body, bpl: 2500 });
        await newUser.save();
        res.send('<script>alert("Kayıt başarılı!"); window.location.href="/";</script>');
    } catch (e) { res.send("Kayıt sırasında hata oluştu."); }
});

// --- SOCKET.IO SİSTEMİ ---
io.on('connection', (socket) => {
    socket.on('join-chat', (data) => {
        socket.join(data.room);
        socket.nickname = data.nickname;
        socket.roomName = data.room;
        socket.to(data.room).emit('user-joined', { nickname: data.nickname });
    });

    socket.on('chat-message', (data) => {
        io.to(data.room).emit('new-message', { sender: data.nickname, text: data.message });
    });

    // Arena Arama ve Bot Mantığı
    socket.on('start-search', () => {
        setTimeout(() => {
            socket.emit('match-found', { 
                matchId: `match_${Date.now()}`, 
                opponent: { nickname: "BPL_BOT_01", animal: "Kurt" } 
            });
        }, 4000);
    });

    // WebRTC Sinyalleşme (Görüntülü Görüşme)
    socket.on('webrtc-offer', (data) => { socket.to(data.toSocket).emit('webrtc-offer', data); });
    socket.on('webrtc-answer', (data) => { socket.to(data.toSocket).emit('webrtc-answer', data); });
    socket.on('webrtc-ice-candidate', (data) => { socket.to(data.toSocket).emit('webrtc-ice-candidate', data); });

    socket.on('disconnect', () => {
        if (socket.roomName) socket.to(socket.roomName).emit('user-left', socket.nickname);
    });
});

// Sunucu Başlatma
server.listen(PORT, "0.0.0.0", () => {
    console.log(`BPL Elite Sunucusu ${PORT} portunda aktif.`);
});
