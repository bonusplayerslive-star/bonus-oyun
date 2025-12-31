require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const path = require('path');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

// MODELLER (Yüklediğiniz dosyalara göre)
const connectDB = require('./db');
const User = require('./models/User');
const ArenaLog = require('./models/ArenaLogs');
const Message = mongoose.model('Contact', new mongoose.Schema({ email: String, note: String, date: { type: Date, default: Date.now }}));

connectDB();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 10000;

// MIDDLEWARE
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// OTURUM YÖNETİMİ (image_d73c5e.png hatası giderildi)
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// GLOBAL DEĞİŞKEN
app.use(async (req, res, next) => {
    res.locals.user = req.session.userId ? await User.findById(req.session.userId) : null;
    next();
});

const checkAuth = (req, res, next) => req.session.userId ? next() : res.redirect('/');

// --- ROTALAR (GET) ---
app.get('/', (req, res) => res.render('index'));
app.get('/profil', checkAuth, (req, res) => res.render('profil'));
app.get('/market', checkAuth, (req, res) => res.render('market'));
app.get('/development', checkAuth, (req, res) => res.render('development'));
app.get('/arena', checkAuth, (req, res) => res.render('arena'));
app.get('/wallet', checkAuth, (req, res) => res.render('wallet'));
app.get('/chat', checkAuth, (req, res) => res.render('chat'));

// --- ROTALAR (POST) ---

// Giriş & Kayıt
app.post('/register', async (req, res) => {
    const { nickname, email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ nickname, email, password: hashedPassword, bpl: 2500, inventory: [{ name: 'Eagle', level: 1, stats: { hp: 150, atk: 30 } }] });
    await newUser.save();
    res.redirect('/');
});

app.post('/login', async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    if (user && await bcrypt.compare(req.body.password, user.password)) {
        req.session.userId = user._id;
        return req.session.save(() => res.redirect('/profil'));
    }
    res.send('<script>alert("Hata!"); window.location.href="/";</script>');
});

// İletişim Formu (Max 180 Karakter)
app.post('/contact', async (req, res) => {
    const { email, note } = req.body;
    if(note.length > 180) return res.send("Not çok uzun!");
    await new Message({ email, note }).save();
    res.send('<script>alert("Mesajınız iletildi."); window.location.href="/";</script>');
});

// Arena Bot Sistemi (Kazanan 150 BPL, Kaybeden -50 BPL)
app.post('/arena/battle', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    const bots = ['Lion', 'Goril', 'Tiger', 'Eagle'];
    const botOpponent = bots[Math.floor(Math.random() * bots.length)];
    
    // %60 Kullanıcı Kaybetme Mantığı
    const userWins = Math.random() > 0.6; 
    let prize = userWins ? 150 : -50;
    
    user.bpl += prize;
    if(user.bpl < 0) user.bpl = 0;
    await user.save();

    const log = new ArenaLog({
        challenger: user.nickname,
        opponent: botOpponent + " (BOT)",
        winner: userWins ? user.nickname : botOpponent,
        totalPrize: prize
    });
    await log.save();

    res.json({ win: userWins, opponent: botOpponent, newBpl: user.bpl });
});

// Geliştirme (Level Up)
app.post('/develop/:charName', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    const char = user.inventory.find(i => i.name === req.params.charName);
    const cost = char.level * 500;
    
    if(user.bpl >= cost) {
        user.bpl -= cost;
        char.level += 1;
        char.stats.atk += 10;
        await user.save();
        res.json({ success: true, level: char.level });
    } else {
        res.json({ success: false, msg: "Yetersiz BPL" });
    }
});

// --- SOCKET SİSTEMİ (Global Chat & Odalar) ---
io.on('connection', (socket) => {
    socket.on('send-gift', async (data) => { // Sohbetten hediye gönderimi
        const sender = await User.findById(data.senderId);
        const receiver = await User.findOne({ nickname: data.receiverNick });
        if(sender.bpl >= data.amount) {
            sender.bpl -= data.amount;
            receiver.bpl += data.amount;
            await sender.save(); await receiver.save();
            io.emit('gift-announce', { msg: `${sender.nickname}, ${receiver.nickname}'a ${data.amount} BPL hediye etti!` });
        }
    });
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

server.listen(PORT, () => console.log(`Sistem aktif: ${PORT}`));
