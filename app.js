// --- 1. MODÜLLER VE AYARLAR ---
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const MongoStore = require('connect-mongo'); // OTURUMU KAYDETMEK İÇİN ŞART
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

// --- 3. MIDDLEWARE ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.set('trust proxy', 1);

// OTURUM YÖNETİMİ (v6.0.0 HATASIZ VE KALICI YAPI)
app.use(session({
    secret: process.env.SESSION_SECRET || 'bpl_global_key_2026',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ 
        mongoUrl: process.env.MONGO_URI,
        collectionName: 'sessions'
    }),
    cookie: { 
        secure: process.env.NODE_ENV === 'production', 
        maxAge: 24 * 60 * 60 * 1000 
    }
}));

// Oturum Kontrolü Middleware
const checkAuth = (req, res, next) => {
    if (req.session.userId) return next();
    res.redirect('/');
};

// Sabit Veriler
const MARKET_ANIMALS = [
    { id: 1, name: 'Tiger', price: 1000, img: '/caracter/profile/tiger.jpg' },
    { id: 2, name: 'Lion', price: 1000, img: '/caracter/profile/lion.jpg' },
    { id: 3, name: 'Eagle', price: 1000, img: '/caracter/profile/eagle.jpg' }
];

const eliteBots = [
    { nickname: "X-Terminator", animal: "Tiger" },
    { nickname: "Shadow-Ghost", animal: "Lion" },
    { nickname: "Berserker", animal: "Gorilla" }
];

const last20Victories = [];

// --- 4. ROTALAR (AUTH & ANA SAYFA) ---

app.get('/', (req, res) => {
    if (req.session.userId) return res.redirect('/profil');
    res.render('index', { user: null });
});

app.post('/register', async (req, res) => {
    try {
        let { nickname, email, password } = req.body;
        email = email.trim().toLowerCase();
        
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.send('<script>alert("Bu email zaten kayıtlı!"); window.location.href="/";</script>');

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ 
            nickname: nickname.trim(), 
            email, 
            password: hashedPassword, 
            bpl: 2500,
            inventory: [{ name: 'Eagle', level: 1, stats: { hp: 150, atk: 30 } }] 
        });

        await newUser.save();
        res.send('<script>alert("Kayıt Başarılı! 2500 BPL Hediye Edildi."); window.location.href="/";</script>');
    } catch (e) {
        console.error("Kayıt hatası:", e);
        res.status(500).send("Kayıt hatası.");
    }
});

// LOGIN: TEK VE SAĞLAM BLOK (Çakışma Giderildi)
app.post('/login', async (req, res) => {
    try {
        let { email, password } = req.body;
        const cleanEmail = email.trim().toLowerCase();

        const user = await User.findOne({ email: cleanEmail });
        if (!user) {
            return res.send('<script>alert("Email kayıtlı değil!"); window.location.href="/";</script>');
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (isMatch) {
            req.session.userId = user._id;
            req.session.save((err) => {
                if (err) return res.send("Oturum hatası.");
                res.redirect('/profil');
            });
        } else {
            res.send('<script>alert("Şifre hatalı!"); window.location.href="/";</script>');
        }
    } catch (error) {
        console.error("Login hatası:", error);
        res.status(500).send("Sistem hatası.");
    }
});

app.get('/profil', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        if (!user) return res.redirect('/logout');
        res.render('profil', { user });
    } catch (err) { res.redirect('/'); }
});

// --- 5. ARENA VE MARKET SİSTEMİ ---

app.get('/market', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('market', { user, animals: MARKET_ANIMALS });
});

app.post('/attack-bot', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const bot = eliteBots[Math.floor(Math.random() * eliteBots.length)];
        
        // %60 Kayıp Oranı (Math.random() > 0.6 ise kazanır, yani %40 kazanç)
        const isWin = Math.random() > 0.6;

        if (isWin) {
            user.bpl += 200;
            last20Victories.unshift({ 
                winner: user.nickname, 
                opponent: bot.nickname, 
                reward: 200, 
                time: new Date().toLocaleTimeString() 
            });
            if(last20Victories.length > 20) last20Victories.pop();
            
            await new Victory({ userEmail: user.email, amount: 200, opponent: bot.nickname }).save();
            
            io.emit('new-message', { 
                sender: "ARENA", 
                text: `🏆 ${user.nickname} kazandı!`, 
                isBattleWin: true, 
                winnerNick: user.nickname 
            });
        } else {
            user.bpl = Math.max(0, user.bpl - 200);
            await new Punishment({ userEmail: user.email, amount: 200, reason: "Arena Mağlubiyeti" }).save();
        }

        await user.save();
        res.json({ status: 'success', isWin, newBalance: user.bpl, opponent: bot.nickname });
    } catch (err) { res.status(500).json({ status: 'error' }); }
});

// --- 6. SOCKET.IO (CHAT & TEBRİK) ---
io.on('connection', (socket) => {
    socket.on('register-user', ({ id, nickname }) => {
        socket.userId = id;
        socket.nickname = nickname;
        socket.join('Global');
    });

    socket.on('chat-message', (data) => {
        if(socket.nickname) {
            io.to('Global').emit('new-message', { sender: socket.nickname, text: data.text });
        }
    });

    socket.on('tebrik-et', async (data) => {
        try {
            const sender = await User.findById(socket.userId);
            const receiver = await User.findOne({ nickname: data.winnerNick });
            
            const brut = 500, net = 410, yakim = 90;

            if (sender && receiver && sender.bpl >= brut && sender.nickname !== receiver.nickname) {
                sender.bpl -= brut;
                receiver.bpl += net;
                await sender.save();
                await receiver.save();
                
                await new Log({ type: 'BPL_BURN', content: `Yakıldı: ${yakim} BPL`, userEmail: sender.email }).save();
                io.to('Global').emit('new-message', { sender: "SİSTEM", text: `💎 ${sender.nickname}, ${receiver.nickname}'ı tebrik etti (410 BPL iletildi, 90 BPL yakıldı!)` });
            }
        } catch (err) { console.error("Tebrik hatası:", err); }
    });
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- 7. BAŞLATMA ---
server.listen(PORT, "0.0.0.0", () => {
    console.log(`BPL ECOSYSTEM ONLINE PORT: ${PORT}`);
});
