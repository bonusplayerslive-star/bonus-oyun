
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

let ipLoginAttempts = {};

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
    res.render('index', { articles: ["Arena Yayında!", "Market Güncellendi"], userIp, forceHelp: false, isBlocked, remainingTime });
});

const checkAuth = (req, res, next) => {
    if (req.session.userId) { next(); } else { res.redirect('/'); }
};

app.post('/contact-submit', async (req, res) => {
    const { email, message } = req.body;
    const userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    try {
        logToFile(LOG_PATHS.SUPPORT, `DESTEK TALEBİ: [IP: ${userIp}] [Email: ${email}] Mesaj: ${message}`);
        res.json({ status: 'success', msg: 'Mesajınız başarıyla iletildi. Destek için: bonusplayerslive@gmail.com' });
    } catch (e) { res.json({ status: 'error', msg: 'Mesaj iletilemedi.' }); }
});

app.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) return res.json({ status: 'error', msg: 'Bu e-posta adresi sistemde kayıtlı değil.' });
        logToFile(LOG_PATHS.DEV, `ŞİFRE SIFIRLAMA TALEBİ: ${email}`);
        res.json({ status: 'success', msg: 'Şifre sıfırlama bağlantısı e-posta adresinize gönderildi.' });
    } catch (e) { res.json({ status: 'error', msg: 'İşlem sırasında bir hata oluştu.' }); }
});

// Sayfalar
app.get('/profil', checkAuth, async (req, res) => { try { const user = await User.findById(req.session.userId); res.render('profil', { user }); } catch (e) { res.redirect('/'); } });
app.get('/market', checkAuth, async (req, res) => { try { const user = await User.findById(req.session.userId); res.render('market', { user }); } catch (e) { res.redirect('/'); } });
app.get('/wallet', checkAuth, async (req, res) => { try { const user = await User.findById(req.session.userId); res.render('wallet', { user }); } catch (e) { res.redirect('/'); } });
app.get('/arena', checkAuth, async (req, res) => { try { const user = await User.findById(req.session.userId); res.render('arena', { user }); } catch (e) { res.redirect('/'); } });
app.get('/chat', checkAuth, async (req, res) => { try { const user = await User.findById(req.session.userId); res.render('chat', { user, room: 'Global' }); } catch (e) { res.redirect('/'); } });
app.get('/development', checkAuth, async (req, res) => { try { const user = await User.findById(req.session.userId); res.render('development', { user }); } catch (e) { res.redirect('/'); } });
app.get('/payment', checkAuth, async (req, res) => { try { const user = await User.findById(req.session.userId); const packages = [{ usd: 10, bpl: 1000 }, { usd: 50, bpl: 5500 }, { usd: 100, bpl: 12000 }]; res.render('payment', { user, packages, paymentText: process.env.WALLET_ADDRESS }); } catch (e) { res.redirect('/'); } });
app.get('/meeting', checkAuth, async (req, res) => { try { const user = await User.findById(req.session.userId); const roomId = req.query.roomId; if (!user || !roomId) return res.redirect('/profil'); res.render('meeting', { user, roomId }); } catch (e) { res.redirect('/profil'); } });

app.post('/login', authLimiter, async (req, res) => {
    const { email, password } = req.body;
    const userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (ipLoginAttempts[userIp] && ipLoginAttempts[userIp].count >= 4) {
        const simdi = Date.now();
        if (simdi < ipLoginAttempts[userIp].banUntil) {
            const kalanDakika = Math.ceil((ipLoginAttempts[userIp].banUntil - simdi) / (1000 * 60));
            return res.send(`<script>alert("IP adresiniz engellendi! Kalan: ${kalanDakika} dakika."); window.location.href="/";</script>`);
        } else { delete ipLoginAttempts[userIp]; }
    }
    const user = await User.findOne({ email, password });
    if (user) {
        delete ipLoginAttempts[userIp]; 
        req.session.userId = user._id;
        res.redirect(`/profil`);
    } else {
        if (!ipLoginAttempts[userIp]) { ipLoginAttempts[userIp] = { count: 1 }; } else { ipLoginAttempts[userIp].count++; }
        if (ipLoginAttempts[userIp].count >= 4) {
            ipLoginAttempts[userIp].banUntil = Date.now() + (120 * 60 * 1000);
            return res.send('<script>alert("4 kez hatalı giriş! 120 dakika boyunca form kilitlendi."); window.location.href="/";</script>');
        }
        res.send(`<script>alert("Hatalı Giriş! Kalan hakkınız: ${4 - ipLoginAttempts[userIp].count}"); window.location.href="/";</script>`);
    }
});

app.post('/register', authLimiter, async (req, res) => {
    try {
        const newUser = new User({ ...req.body, bpl: 2500 });
        await newUser.save();
        res.send('<script>alert("Kayıt Başarılı!"); window.location.href="/";</script>');
    } catch (e) { res.send("Kayıt Hatası: Veriler geçersiz."); }
});

app.post('/create-meeting', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        if (user && user.bpl >= 50) {
            user.bpl -= 50;
            await user.save();
            const roomId = Math.random().toString(36).substring(2, 7);
            activeMeetings[roomId] = { hostId: user._id.toString(), startTime: Date.now(), maxTime: 90 * 60 * 1000, inviteLimit: 5 * 60 * 1000 };
            logToFile(LOG_PATHS.MEETING, `${user.nickname} oda kurdu: ${roomId}`);
            res.redirect(`/meeting?roomId=${roomId}&userId=${user._id}`);
        } else { res.send('<script>alert("Yetersiz Bakiye! (50 BPL)"); window.history.back();</script>'); }
    } catch (e) { res.redirect('/profil'); }
});

// --- SOCKET SİSTEMİ (BOT KAZANMA AYARI BURADA) ---
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

    socket.on('join-arena', async (data) => {
        socket.join("arena_lobby");
        try {
            const user = await User.findById(data.userId);
            if (!user) return;
            const animalName = data.selectedAnimal || user.inventory[0] || "Gökdoğan";
            socket.userData = { userId: user._id.toString(), nickname: user.nickname, animal: animalName, stats: { hp: user.stats[animalName]?.hp || 100, atk: user.stats[animalName]?.atk || 10 } };
        } catch (err) { }
    });

    socket.on('start-search', () => {
        const lobby = io.sockets.adapter.rooms.get("arena_lobby");
        if (lobby && lobby.size >= 2) {
            const opponentId = Array.from(lobby).find(id => id !== socket.id);
            const oppSocket = io.sockets.sockets.get(opponentId);
            if(oppSocket && oppSocket.userData && socket.userData) {
                const matchId = `match_${Date.now()}`;
                socket.leave("arena_lobby"); oppSocket.leave("arena_lobby");
                socket.join(matchId); oppSocket.join(matchId);
                
                // --- BOT KAZANMA ORANI AYARI ---
                let winnerId;
                // Eğer karşıdaki rakip bot ise (İsminde Savaşçı geçiyorsa)
                const isOpponentBot = oppSocket.userData.nickname.includes("Savaşçı");
                
                if (isOpponentBot) {
                    // Botun kazanma şansı %40, Kullanıcının (Senin) kazanma şansın %60
                    winnerId = Math.random() < 0.6 ? socket.userData.userId : oppSocket.userData.userId;
                } else {
                    // İkisi de gerçek oyuncuysa %50 - %50
                    winnerId = Math.random() > 0.5 ? socket.userData.userId : oppSocket.userData.userId;
                }
                
                socket.emit('match-found', { matchId, winnerId, opponent: oppSocket.userData });
                oppSocket.emit('match-found', { matchId, winnerId, opponent: socket.userData });
            }
        }
    });

    socket.on('claim-victory', async (data) => {
        try {
            const user = await User.findById(data.userId);
            if (user) { user.bpl += 50; await user.save(); logToFile(LOG_PATHS.ARENA, `ZAFER: ${user.nickname} +50 BPL`); }
        } catch (e) { }
    });

    // Diğer Socket İşlemleri (Gift, WebRTC vs.)
    socket.on('send-gift', async (data) => { /* Hediye kodları buraya gelecek */ });
    socket.on('webrtc-offer', (data) => { socket.to(data.toSocket).emit('webrtc-offer', { offer: data.offer, fromSocket: socket.id, senderNick: data.senderNick }); });
    socket.on('webrtc-answer', (data) => { socket.to(data.toSocket).emit('webrtc-answer', { answer: data.answer, fromSocket: socket.id }); });
    socket.on('webrtc-ice-candidate', (data) => { socket.to(data.toSocket).emit('webrtc-ice-candidate', { candidate: data.candidate, fromSocket: socket.id }); });
    socket.on('disconnect', () => { if (socket.roomName) socket.to(socket.roomName).emit('user-left', socket.id); });
});

// Market İşlemleri
app.post('/buy-animal', checkAuth, async (req, res) => {
    const { animalName, price } = req.body;
    try {
        const user = await User.findById(req.session.userId);
        if (user && user.bpl >= price) {
            user.bpl -= price; user.inventory.push(animalName);
            if(!user.stats) user.stats = {};
            user.stats[animalName] = { hp: 100, atk: 10, def: 10, tempPower: false };
            user.markModified('stats'); await user.save();
            logToFile(LOG_PATHS.MARKET, `${user.nickname} satın aldı: ${animalName}`);
            res.json({ status: 'success', newBalance: user.bpl });
        } else res.json({ status: 'error', msg: 'Yetersiz Bakiye!' });
    } catch (e) { res.json({ status: 'error' }); }
});

app.post('/upgrade-stat', checkAuth, async (req, res) => {
    const { animalName, statType } = req.body;
    const prices = { hp: 50, atk: 40, def: 35, battleMode: 15 };
    try {
        const user = await User.findById(req.session.userId);
        const price = prices[statType];
        if (user && user.bpl >= price) {
            user.bpl -= price; user.stats[animalName][statType] += statType === 'hp' ? 10 : 5;
            user.markModified('stats'); await user.save();
            res.json({ status: 'success', newBalance: user.bpl });
        } else res.json({ status: 'error' });
    } catch (e) { res.json({ status: 'error' }); }
});

app.post('/sell-character', checkAuth, async (req, res) => {
    const { hayvan, fiyat } = req.body;
    try {
        const user = await User.findById(req.session.userId);
        if (user.inventory.length <= 1) return res.json({ status: 'error', msg: 'En az 1 karakter kalmalı!' });
        const index = user.inventory.indexOf(hayvan);
        if (index > -1) {
            user.inventory.splice(index, 1); user.bpl += (fiyat * 0.70);
            await user.save(); logToFile(LOG_PATHS.MARKET, `${user.nickname} sattı: ${hayvan}`);
            res.json({ status: 'success', msg: `Satıldı.` });
        }
    } catch (e) { res.json({ status: 'error' }); }
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`SUNUCU AKTİF | Port: ${PORT}`);
});
