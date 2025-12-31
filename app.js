// --- 1. MODÜLLER VE AYARLAR ---
require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
// DÜZELTME: v6+ için modül çağrısı bu şekilde olmalı
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
const ArenaLog = require('./models/ArenaLogs');

connectDB();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 10000;

// --- 3. MIDDLEWARE ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- HATAYI BİTİREN OTURUM YÖNETİMİ ---
app.use(session({
    secret: process.env.SESSION_SECRET || 'bpl_global_secret_2026',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ 
        mongoUrl: process.env.MONGO_URI,
        collectionName: 'sessions', // Atlas'ta bu isimle görünecek
        ttl: 14 * 24 * 60 * 60 // 14 gün
    }),
    cookie: { 
        secure: false, // Render HTTP (SSL yoksa) için false
        maxAge: 24 * 60 * 60 * 1000 
    }
}));

// Global User Değişkeni (EJS dosyaları için)
app.use(async (req, res, next) => {
    try {
        res.locals.user = req.session.userId ? await User.findById(req.session.userId) : null;
        next();
    } catch (err) { next(err); }
});

const checkAuth = (req, res, next) => req.session.userId ? next() : res.redirect('/');

// --- 4. ROTALAR (GET) ---
app.get('/', (req, res) => res.render('index'));
app.get('/profil', checkAuth, (req, res) => res.render('profil'));
app.get('/market', checkAuth, (req, res) => res.render('market'));
app.get('/development', checkAuth, (req, res) => res.render('development'));
app.get('/arena', checkAuth, (req, res) => res.render('arena'));
app.get('/wallet', checkAuth, (req, res) => res.render('wallet'));
app.get('/chat', checkAuth, (req, res) => res.render('chat'));
app.get('/meeting/:roomId', checkAuth, (req, res) => res.render('meeting', { roomId: req.params.roomId }));

// --- 5. ROTALAR (POST İŞLEMLERİ) ---

// Giriş & Kayıt
app.post('/register', async (req, res) => {
    try {
        const { nickname, email, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ 
            nickname, email, password: hashedPassword, bpl: 2500,
            inventory: [{ name: 'Eagle', level: 1, stats: { hp: 150, atk: 30 } }] 
        });
        await newUser.save();
        res.send('<script>alert("Kayıt Başarılı! 2500 BPL Hediye."); window.location.href="/";</script>');
    } catch (e) { res.status(500).send("Kayıt hatası!"); }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (user && await bcrypt.compare(password, user.password)) {
        req.session.userId = user._id;
        return req.session.save(() => res.redirect('/profil'));
    }
    res.send('<script>alert("Bilgiler hatalı!"); window.location.href="/";</script>');
});

// İletişim Formu (Max 180 Karakter)
app.post('/contact', async (req, res) => {
    const { email, note } = req.body;
    if (note.length > 180) return res.send("Not çok uzun!");
    await new Log({ type: 'CONTACT', content: note, userEmail: email }).save();
    res.send('<script>alert("Mesajınız iletildi."); window.location.href="/";</script>');
});

// Arena Bot Sistemi (%60 Kayıp / %40 Kazanç)
app.post('/arena/battle', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    const bots = ['Lion', 'Goril', 'Tiger', 'Eagle'];
    const botOpponent = bots[Math.floor(Math.random() * bots.length)];
    
    const userWins = Math.random() > 0.6; // Kullanıcı %40 ihtimalle kazanır
    let prize = userWins ? 150 : -50;
    
    user.bpl += prize;
    if(user.bpl < 0) user.bpl = 0;
    await user.save();

    // Loglama (Victory/Punishment)
    if(userWins) {
        await new Victory({ userEmail: user.email, amount: 150, opponent: botOpponent }).save();
    } else {
        await new Punishment({ userEmail: user.email, amount: 50, reason: "Arena Mağlubiyeti" }).save();
    }

    res.json({ win: userWins, opponent: botOpponent, newBpl: user.bpl });
});

// --- 6. SOCKET.IO (CHAT & HEDİYE YAKIM) ---
io.on('connection', (socket) => {
    socket.on('join-room', (roomId) => socket.join(roomId));

    // Tebrik / Hediye (40 BPL Yakımlı)
    socket.on('send-tebrik', async (data) => {
        const { senderNick, receiverNick } = data;
        const sender = await User.findOne({ nickname: senderNick });
        const receiver = await User.findOne({ nickname: receiverNick });

        const brut = 450, net = 410, burn = 40;

        if (sender && receiver && sender.bpl >= brut) {
            sender.bpl -= brut;
            receiver.bpl += net;
            await sender.save(); await receiver.save();

            // Yakım Logu
            await new Log({ type: 'BPL_BURN', content: `Yakım: ${burn} BPL`, userEmail: sender.email }).save();

            io.emit('new-message', { 
                sender: "SİSTEM", 
                text: `💎 ${sender.nickname}, ${receiver.nickname} için 410 BPL ateşledi!` 
            });
        }
    });

    socket.on('chat-message', (data) => {
        io.to(data.room).emit('new-message', { sender: data.sender, text: data.text });
    });
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

server.listen(PORT, () => console.log(`BPL ECOSYSTEM ONLINE: ${PORT}`));
