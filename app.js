require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const MongoStore = require('connect-mongo'); // v6 sürümü için
const mongoose = require('mongoose');
const path = require('path');
const bcrypt = require('bcryptjs');

// MODELLER
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

// MIDDLEWARE
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- HATASIZ OTURUM YÖNETİMİ (v6.0.0 UYUMLU) ---
app.use(session({
    secret: process.env.SESSION_SECRET || 'bpl_global_2026',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ 
        mongoUrl: process.env.MONGO_URI,
        collectionName: 'sessions',
        stringify: false // Verimlilik için
    }),
    cookie: { 
        secure: false, // Render HTTP için
        maxAge: 24 * 60 * 60 * 1000 
    }
}));

// Global Kullanıcı Verisi (EJS Entegrasyonu)
app.use(async (req, res, next) => {
    res.locals.user = req.session.userId ? await User.findById(req.session.userId) : null;
    next();
});

const checkAuth = (req, res, next) => req.session.userId ? next() : res.redirect('/');

// --- ROTALAR ---
app.get('/', (req, res) => res.render('index'));
app.get('/profil', checkAuth, (req, res) => res.render('profil'));
app.get('/arena', checkAuth, (req, res) => res.render('arena'));
app.get('/market', checkAuth, (req, res) => res.render('market'));
app.get('/development', checkAuth, (req, res) => res.render('development'));
app.get('/wallet', checkAuth, (req, res) => res.render('wallet'));
app.get('/chat', checkAuth, (req, res) => res.render('chat'));
app.get('/meeting/:roomId', checkAuth, (req, res) => res.render('meeting', { roomId: req.params.roomId }));

// --- POST İŞLEMLERİ ---

// Login Sistemi
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (user && await bcrypt.compare(password, user.password)) {
        req.session.userId = user._id;
        return req.session.save(() => res.redirect('/profil'));
    }
    res.send('<script>alert("Hata!"); window.location.href="/";</script>');
});

// İletişim (180 Karakter Sınırı)
app.post('/contact', async (req, res) => {
    const { email, note } = req.body;
    if (note.length <= 180) {
        await new Log({ type: 'CONTACT', content: note, userEmail: email }).save();
        res.send('<script>alert("İletildi."); window.location.href="/";</script>');
    }
});

// Arena Bot Sistemi (%60 Kayıp)
app.post('/arena/battle', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    const bots = ['Lion', 'Goril', 'Tiger', 'Eagle'];
    const botOpponent = bots[Math.floor(Math.random() * bots.length)];
    
    const userWins = Math.random() > 0.6; 
    let prize = userWins ? 150 : -50;
    
    user.bpl += prize;
    if(user.bpl < 0) user.bpl = 0;
    await user.save();

    if(userWins) {
        await new Victory({ userEmail: user.email, amount: 150, opponent: botOpponent }).save();
    } else {
        await new Punishment({ userEmail: user.email, amount: 50, reason: "Arena Kaybı" }).save();
    }

    res.json({ win: userWins, opponent: botOpponent, newBpl: user.bpl });
});

// --- SOCKET.IO (CHAT & HEDİYE YAKIM) ---
io.on('connection', (socket) => {
    socket.on('send-tebrik', async (data) => {
        const { senderNick, receiverNick } = data;
        const sender = await User.findOne({ nickname: senderNick });
        const receiver = await User.findOne({ nickname: receiverNick });
        
        const brut = 450, net = 410, burn = 40;

        if (sender && receiver && sender.bpl >= brut) {
            sender.bpl -= brut;
            receiver.bpl += net;
            await sender.save(); await receiver.save();

            await new Log({ type: 'BPL_BURN', content: `Yakıldı: ${burn}`, userEmail: sender.email }).save();

            io.emit('new-message', { 
                sender: "SİSTEM", 
                text: `💎 ${sender.nickname} -> ${receiver.nickname} (410 BPL iletildi)` 
            });
        }
    });
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`BPL ONLINE: ${PORT}`));
