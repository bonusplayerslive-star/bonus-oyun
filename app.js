require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const path = require('path');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

// VERİTABANI BAĞLANTISI
const connectDB = require('./db');
const User = require('./models/User');
const ArenaLog = require('./models/ArenaLogs');
const Contact = mongoose.model('Contact', new mongoose.Schema({ 
    email: String, 
    note: { type: String, maxlength: 180 }, 
    date: { type: Date, default: Date.now }
}));

connectDB();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// MIDDLEWARE
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// OTURUM YÖNETİMİ (Loglardaki hatalar giderildi)
app.use(session({
    secret: process.env.SESSION_SECRET || 'bpl_super_secret_2026',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// GLOBAL USER (EJS DOSYALARI İLE İLİŞKİ)
app.use(async (req, res, next) => {
    res.locals.user = req.session.userId ? await User.findById(req.session.userId) : null;
    next();
});

const checkAuth = (req, res, next) => req.session.userId ? next() : res.redirect('/');

// --- ROTALAR (GET - Tüm EJS Dosyaları Bağlandı) ---
app.get('/', (req, res) => res.render('index'));
app.get('/profil', checkAuth, (req, res) => res.render('profil'));
app.get('/market', checkAuth, (req, res) => res.render('market'));
app.get('/development', checkAuth, (req, res) => res.render('development'));
app.get('/arena', checkAuth, (req, res) => res.render('arena'));
app.get('/wallet', checkAuth, (req, res) => res.render('wallet'));
app.get('/chat', checkAuth, (req, res) => res.render('chat'));

// --- POST İŞLEMLERİ (Kayıt, Giriş, İletişim) ---

app.post('/register', async (req, res) => {
    try {
        const { nickname, email, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ 
            nickname, email, password: hashedPassword, bpl: 2500,
            inventory: [{ name: 'Eagle', level: 1, stats: { hp: 150, atk: 30 } }] 
        });
        await newUser.save();
        res.redirect('/');
    } catch (e) { res.send("Kayıt hatası!"); }
});

app.post('/login', async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    if (user && await bcrypt.compare(req.body.password, user.password)) {
        req.session.userId = user._id;
        return req.session.save(() => res.redirect('/profil'));
    }
    res.send('<script>alert("Hatalı Giriş!"); window.location.href="/";</script>');
});

app.post('/contact', async (req, res) => {
    const { email, note } = req.body;
    if(note.length <= 180) {
        await new Contact({ email, note }).save();
        res.send('<script>alert("Mesajınız iletildi."); window.location.href="/";</script>');
    } else { res.send("Not 180 karakteri aşamaz!"); }
});

// --- ARENA BOT SİSTEMİ (%60 KAYBETME ORANI) ---
app.post('/arena/battle', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    const bots = ['Lion', 'Goril', 'Tiger', 'Eagle'];
    const botOpponent = bots[Math.floor(Math.random() * bots.length)];
    
    // Kazanma Şansı %40 (Kaybetme %60)
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

// --- MARKET VE GELİŞTİRME ---
app.post('/market/buy', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    const { itemName, price } = req.body;
    if(user.bpl >= price) {
        user.bpl -= price;
        user.inventory.push({ name: itemName, level: 1 });
        await user.save();
        res.json({ success: true });
    } else { res.json({ success: false, msg: "Yetersiz BPL" }); }
});

app.post('/develop/:charName', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    const char = user.inventory.find(i => i.name === req.params.charName);
    const cost = char.level * 500;
    
    if(user.bpl >= cost) {
        user.bpl -= cost;
        char.level += 1;
        await user.save();
        res.json({ success: true, level: char.level });
    } else { res.json({ success: false }); }
});

// --- SOCKET SİSTEMİ (Hediye & Sohbet) ---
io.on('connection', (socket) => {
    socket.on('chat-gift', async (data) => {
        const sender = await User.findById(data.senderId);
        const receiver = await User.findOne({ nickname: data.receiverNick });
        if(sender && receiver && sender.bpl >= data.amount) {
            sender.bpl -= data.amount;
            receiver.bpl += data.amount;
            await sender.save(); await receiver.save();
            io.emit('gift-alert', { msg: `${sender.nickname}, ${receiver.nickname}'a ${data.amount} BPL gönderdi!` });
        }
    });
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`BPL Ecosystem Yayında: ${PORT}`));
