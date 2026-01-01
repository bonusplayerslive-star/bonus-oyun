// --- 1. MODÜLLER VE AYARLAR ---
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');

// KRİTİK HATA ÇÖZÜMÜ: v6+ için bu satır hayatidir
const MongoStore = require('connect-mongo'); 

const mongoose = require('mongoose');
const path = require('path');
const bcrypt = require('bcryptjs');

// --- 2. VERİTABANI VE MODELLER ---
const connectDB = require('./db');
const User = require('./models/User');
const Log = require('./models/Log');
const Victory = require('./models/Victory');
const Punishment = require('./models/Punishment');

connectDB();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 10000;

// --- 3. MIDDLEWARE (OTURUM VE GÜVENLİK) ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Render HTTPS/Proxy ayarı (Login sorununu çözer)
app.set('trust proxy', 1);

// HATASIZ OTURUM YÖNETİMİ
app.use(session({
    secret: process.env.SESSION_SECRET || 'bpl_global_key_2026',
    resave: true,
    saveUninitialized: false,
    store: MongoStore.create({ 
        mongoUrl: process.env.MONGO_URI,
        collectionName: 'sessions',
        ttl: 14 * 24 * 60 * 60 
    }),
    cookie: { 
        secure: process.env.NODE_ENV === 'production', 
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000 
    }
}));

// Giriş Kontrolü
const checkAuth = (req, res, next) => {
    if (req.session && req.session.userId) return next();
    res.redirect('/');
};

// --- 4. ROTALAR (AUTH & ANA SAYFA) ---

app.get('/', (req, res) => {
    if (req.session.userId) return res.redirect('/profil');
    res.render('index', { user: null });
});

// KAYIT: Email temizliği ve Otomatik Login
app.post('/register', async (req, res) => {
    try {
        let { nickname, email, password } = req.body;
        const cleanEmail = email.trim().toLowerCase();
        
        const existingUser = await User.findOne({ email: cleanEmail });
        if (existingUser) return res.send('<script>alert("Bu email zaten kayıtlı!"); window.location.href="/";</script>');

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ 
            nickname: nickname.trim(), 
            email: cleanEmail, 
            password: hashedPassword, 
            bpl: 2500,
            inventory: [{ name: 'Eagle', level: 1, stats: { hp: 150, atk: 30 } }] 
        });

        const savedUser = await newUser.save();
        
        // Kayıt sonrası otomatik oturum açma
        req.session.userId = savedUser._id;
        req.session.save(() => res.redirect('/profil'));
    } catch (e) {
        res.status(500).send("Kayıt hatası.");
    }
});

// LOGIN: Çakışma giderilmiş temiz blok
app.post('/login', async (req, res) => {
    try {
        let { email, password } = req.body;
        const cleanEmail = email.trim().toLowerCase();

        const user = await User.findOne({ email: cleanEmail });
        if (!user) return res.send('<script>alert("Email kayıtlı değil!"); window.location.href="/";</script>');

        const isMatch = await bcrypt.compare(password, user.password);
        if (isMatch) {
            req.session.userId = user._id;
            req.session.save(() => res.redirect('/profil'));
        } else {
            res.send('<script>alert("Şifre hatalı!"); window.location.href="/";</script>');
        }
    } catch (error) {
        res.status(500).send("Login hatası.");
    }
});

app.get('/profil', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        if (!user) return res.redirect('/logout');
        res.render('profil', { user });
    } catch (err) { res.redirect('/'); }
});

// --- 5. ARENA SİSTEMİ (%60 KAYIP) ---
app.post('/attack-bot', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        
        // Şans Faktörü: %60 Kaybetme (0.6'dan büyük gelirse kazanır)
        const isWin = Math.random() > 0.6;
        let amount = 200;

        if (isWin) {
            user.bpl += amount;
            await new Victory({ userEmail: user.email, amount: amount, opponent: "Elite Bot" }).save();
            io.emit('new-message', { sender: "ARENA", text: `🏆 ${user.nickname} botu paramparça etti!` });
        } else {
            user.bpl = Math.max(0, user.bpl - amount);
            await new Punishment({ userEmail: user.email, amount: amount, reason: "Arena Mağlubiyeti" }).save();
        }

        await user.save();
        res.json({ status: 'success', isWin, newBalance: user.bpl });
    } catch (err) { res.status(500).json({ status: 'error' }); }
});

// --- 6. SOCKET.IO (CHAT & TEBRİK YAKIMI) ---
io.on('connection', (socket) => {
    socket.on('chat-message', (data) => {
        io.emit('new-message', { sender: "Kullanıcı", text: data.text });
    });

    // Tebrik: 500 BPL Gönderilir -> 410 Gider, 90 Yakılır
    socket.on('tebrik-et', async (data) => {
        try {
            const sender = await User.findById(data.senderId);
            const receiver = await User.findOne({ nickname: data.winnerNick });
            const brut = 500, net = 410, burn = 90;

            if (sender && receiver && sender.bpl >= brut) {
                sender.bpl -= brut;
                receiver.bpl += net;
                await sender.save();
                await receiver.save();
                
                await new Log({ type: 'BPL_BURN', content: `Yakılan: ${burn}`, userEmail: sender.email }).save();
                io.emit('new-message', { sender: "SİSTEM", text: `💎 ${sender.nickname}, ${receiver.nickname}'ı tebrik etti! 90 BPL yakıldı.` });
            }
        } catch (e) { console.error(e); }
    });
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.clearCookie('connect.sid');
    res.redirect('/');
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`BPL ECOSYSTEM AKTİF: ${PORT}`);
});
