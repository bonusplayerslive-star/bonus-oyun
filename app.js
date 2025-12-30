require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const path = require('path');
const bcrypt = require('bcryptjs');

const connectDB = require('./db');
const User = require('./models/User');

connectDB();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 10000;

// --- MARKET VERİLERİ (Görsel 210a9b.png'ye göre tam liste) ---
const MARKET_ANIMALS = [
    { id: 1, name: 'Bear', price: 1000, img: '/caracter/profile/Bear.jpg' },
    { id: 2, name: 'Crocodile', price: 1000, img: '/caracter/profile/Crocodile.jpg' },
    { id: 3, name: 'Eagle', price: 1000, img: '/caracter/profile/Eagle.jpg' },
    { id: 4, name: 'Gorilla', price: 5000, img: '/caracter/profile/Gorilla.jpg' },
    { id: 5, name: 'Kurd', price: 1000, img: '/caracter/profile/Kurd.jpg' },
    { id: 6, name: 'Lion', price: 5000, img: '/caracter/profile/Lion.jpg' },
    { id: 7, name: 'Peregrinefalcon', price: 1000, img: '/caracter/profile/Peregrinefalcon.jpg' },
    { id: 8, name: 'Rhino', price: 5000, img: '/caracter/profile/Rhino.jpg' },
    { id: 9, name: 'Snake', price: 1000, img: '/caracter/profile/Snake.jpg' },
    { id: 10, name: 'Tiger', price: 5000, img: '/caracter/profile/Tiger.jpg' }
];

// --- MIDDLEWARE ---
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: 'bpl_mega_secret_2025',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

const checkAuth = (req, res, next) => {
    if (req.session.userId) return next();
    res.redirect('/');
};

// --- AUTH ROTALARI (image_2f1e40.png hatasını çözen kısım) ---
app.post('/register', async (req, res) => {
    try {
        const { nickname, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ 
            nickname, 
            password: hashedPassword, 
            bpl: 1000, // Başlangıç hediyesi
            inventory: [{ name: 'Eagle', stats: { hp: 100, atk: 20, def: 10 } }] 
        });
        await newUser.save();
        res.redirect('/');
    } catch (e) { res.send("Kayıt hatası: " + e.message); }
});

app.post('/login', async (req, res) => {
    try {
        const { nickname, password } = req.body;
        const user = await User.findOne({ nickname });
        if (user && await bcrypt.compare(password, user.password)) {
            req.session.userId = user._id;
            return res.redirect('/profil');
        }
        res.send("Hatalı giriş bilgileri!");
    } catch (e) { res.send("Giriş hatası!"); }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- SAYFA ROTALARI ---
app.get('/', (req, res) => res.render('index', { user: req.session.userId || null }));

app.get('/profil', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('profil', { user });
});

app.get('/market', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('market', { user, animals: MARKET_ANIMALS });
});

app.get('/development', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('development', { user });
});

app.get('/arena', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    const selected = user.inventory.length > 0 ? user.inventory[0].name : "Eagle";
    res.render('arena', { user, selectedAnimal: selected });
});

// --- OYUN MANTIĞI: ARENA (HEDİYE & CEZA SİSTEMİ) ---
app.post('/attack-bot', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        if (user.bpl < 100) return res.json({ status: 'error', msg: 'Savaş için en az 100 BPL gerekli!' });

        const animalName = req.body.animal || "Eagle";
        const randomSeed = Math.random();
        let reward = 0;
        let message = "";
        let isWin = false;

        if (randomSeed > 0.5) { // %50 KAZANMA
            isWin = true;
            reward = 250; 
            if (randomSeed > 0.9) { // %10 KRİTİK HEDİYE
                reward = 1000;
                message = "🔥 KRİTİK VURUŞ! 1000 BPL KAZANDIN!";
            } else {
                message = "🏆 Zafer! 250 BPL kazandın.";
            }
        } else { // %50 KAYBETME (CEZA)
            isWin = false;
            reward = -150;
            message = "💀 Mağlubiyet! 150 BPL kaybettin.";
        }

        user.bpl += reward;
        await user.save();

        res.json({
            status: 'success',
            msg: message,
            animation: {
                actionVideo: `/caracter/move/${animalName}/${animalName}1.mp4`,
                winVideo: `/caracter/move/${animalName}/${animalName}.mp4`,
                isWin
            },
            newBalance: user.bpl
        });
    } catch (e) { res.status(500).json({ status: 'error' }); }
});

// --- GELİŞTİRME SİSTEMİ (image_1fa9bd.png hatasını çözen kısım) ---
app.post('/upgrade-stat', checkAuth, async (req, res) => {
    const { animalName, statType, cost } = req.body;
    try {
        const user = await User.findById(req.session.userId);
        const animal = user.inventory.find(a => a.name === animalName);
        
        if (!animal || user.bpl < cost) return res.json({ status: 'error', msg: 'Yetersiz bakiye!' });

        if (statType === 'hp') animal.stats.hp += 15;
        else if (statType === 'atk') animal.stats.atk += 8;
        else if (statType === 'def') animal.stats.def += 5;

        user.bpl -= cost;
        user.markModified('inventory');
        await user.save();

        res.json({ status: 'success', msg: 'Sistem Güncellendi!', newBalance: user.bpl });
    } catch (e) { res.json({ status: 'error', msg: 'Sunucu hatası.' }); }
});

// --- SOCKET.IO ---
io.on('connection', (socket) => {
    socket.on('register-user', (data) => {
        socket.userId = data.id;
        socket.nickname = data.nickname;
        socket.join('Global');
    });

    socket.on('chat-message', (data) => {
        io.to('Global').emit('new-message', { sender: socket.nickname, text: data.text });
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`BPL ECOSYSTEM AKTIF: ${PORT}`);
});
