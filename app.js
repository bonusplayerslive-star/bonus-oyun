// --- 1. MODÜLLER VE AYARLAR ---
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const mongoose = require('mongoose');
const path = require('path');
const axios = require('axios');

// --- 2. VERİTABANI VE MODELLER ---
const connectDB = require('./db');
const User = require('./models/User');
const Log = require('./models/Log');
const Payment = require('./models/Payment');
const Income = require('./models/Income');
const Victory = require('./models/Victory');
const Punishment = require('./models/Punishment');
const Withdrawal = require('./models/Withdrawal');
const ArenaLogs = require('./models/ArenaLogs');

connectDB();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 10000;

// --- 3. MIDDLEWARE (ARA KATMANLAR) ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.set('trust proxy', 1);





app.use(session({
    secret: 'bpl_ozel_anahtar',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// Giriş Kontrolü
const checkAuth = (req, res, next) => {
    if (req.session.userId) next(); else res.redirect('/');
};

// --- 4. SAYFA ROTALARI (GET) ---

app.get('/', (req, res) => res.render('index', { user: req.session.userId || null }));

app.get('/profil', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('profil', { user });
});

app.get('/market', checkAuth, async (req, res) => {
const MARKET_ANIMALS = [
    { id: 1, name: 'Bear', price: 1000, img: '/caracter/profile/bear.jpg' },
    { id: 2, name: 'Crocodile', price: 1000, img: '/caracter/profile/crocodile.jpg' },
    { id: 3, name: 'Eagle', price: 1000, img: '/caracter/profile/eagle.jpg' },
    { id: 4, name: 'Gorilla', price: 5000, img: '/caracter/profile/gorilla.jpg' },
    { id: 5, name: 'Kurd', price: 1000, img: '/caracter/profile/kurd.jpg' },
    { id: 6, name: 'Lion', price: 5000, img: '/caracter/profile/lion.jpg' },
    { id: 7, name: 'Falcon', price: 1000, img: '/caracter/profile/peregrinefalcon.jpg' },
    { id: 8, name: 'Rhino', price: 5000, img: '/caracter/profile/rhino.jpg' },
    { id: 9, name: 'Snake', price: 1000, img: '/caracter/profile/snake.jpg' },
    { id: 10, name: 'Tiger', price: 5000, img: '/caracter/profile/tiger.jpg' }
];

    
    const user = await User.findById(req.session.userId);
    res.render('market', { user });
});

app.get('/arena', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('arena', { user, selectedAnimal: user.inventory[0]?.name || "Eagle" });
});

app.get('/wallet', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('wallet', { user });
});

app.get('/payment', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('payment', { user });
});

app.get('/chat', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('chat', { user });
});

app.get('/meeting', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('meeting', { user, roomId: "BPL-VIP-KONSEY" });
});

app.get('/development', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('development', { user });
});

// --- 5. İŞLEM ROTALARI (POST) ---

app.post('/register', async (req, res) => {
    const { nickname, email, password } = req.body;
    try {
        const exists = await User.findOne({ email });
        if (exists) return res.send('<script>alert("E-posta kayıtlı!"); window.location.href="/";</script>');
        const newUser = new User({ nickname, email, password, bpl: 2500, inventory: [] });
        await newUser.save();
        res.send('<script>alert("Kayıt başarılı!"); window.location.href="/";</script>');
    } catch (err) { res.status(500).send("Sunucu hatası!"); }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email, password });
        if (user) {
            req.session.userId = user._id;
            res.redirect('/profil');
        } else {
            res.send('<script>alert("Hatalı giriş!"); window.location.href="/";</script>');
        }
    } catch (err) { res.redirect('/'); }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.post('/register', async (req, res) => {
    try {
        const { nickname, email, password } = req.body;
        
        // E-posta kontrolü
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.send('<script>alert("Bu e-posta zaten kayıtlı!"); window.location.href="/";</script>');

        const newUser = new User({ 
            nickname, 
            email, 
            password, 
            bpl: 2500, // Yeni kayıt hediyesi
            inventory: [] // Envanter boş başlar, marketten kendisi alır
        });

        await newUser.save();
        res.send('<script>alert("Başarıyla orduya katıldın! 2500 BPL hediyen tanımlandı. Marketten hayvanını alarak başlayabilirsin."); window.location.href="/";</script>');
    } catch (err) { 
        console.error("Kayıt Hatası:", err);
        res.status(500).send("Sistem hatası oluştu."); 
    }
});

// Örnek Satın Alma Rotası Mantığı
app.post('/buy-animal', checkAuth, async (req, res) => {
    const { animalName, price } = req.body;
    const user = await User.findById(req.session.userId);

    if (user.bpl >= price) {
        user.bpl -= price;
        user.inventory.push({
            name: animalName,
            level: 1,
            // Dosya yolunu küçük harf ve .jpg olarak zorluyoruz
            img: `/caracter/profile/${animalName.toLowerCase()}.jpg`, 
            stats: { hp: 100, atk: 20, def: 15 }
        });
        await user.save();
        res.json({ status: 'success' });
    } else {
        res.json({ status: 'error', msg: 'Yetersiz BPL!' });
    }
});

app.post('/attack-bot', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        if (!user || user.bpl < 200) {
            return res.json({ status: 'error', msg: 'Yetersiz bakiye!' });
        }

        // Gelen hayvan ismini olduğu gibi alıyoruz (Eagle, Bear vb.)
        const animalName = (req.body.animal || "Eagle").trim();
        
        const isWin = Math.random() > 0.5;

        if (isWin) {
            user.bpl += 200;
            io.to('GlobalChat').emit('new-message', { 
                sender: "ARENA", 
                text: `🏆 ${user.nickname}, ${animalName} ile zafer kazandı!` 
            });
        } else {
            user.bpl -= 200;
        }

        await user.save();

        // Dosya Yolları: /caracter/move/Eagle/Eagle1.mp4 gibi
        res.json({ 
            status: 'success', 
            animation: { 
                isWin: isWin,
                actionVideo: `/caracter/move/${animalName}/${animalName}1.mp4`, 
                winVideo: `/caracter/move/${animalName}/${animalName}.mp4`
            }
        });

    } catch (err) {
        res.status(500).json({ status: 'error', msg: 'Sunucu hatası!' });
    }
});

// --- 6. SOCKET.IO SİSTEMİ (ARENA VE CHAT HATALARINI ÇÖZER) ---
io.on('connection', (socket) => {
    console.log('Bir kullanıcı bağlandı:', socket.id);

    socket.on('register-user', (data) => {
        if (data && data.nickname) {
            socket.userId = data.id;
            socket.nickname = data.nickname;
            socket.join('Global');
        }
    });

    socket.on('chat-message', (data) => {
        io.to('Global').emit('new-message', { sender: socket.nickname || "Misafir", text: data.text });
    });

    socket.on('join-meeting', (roomId) => {
        socket.join(roomId);
        console.log(`VIP Konseyine Katılım: ${socket.nickname}`);
    });

    socket.on('disconnect', () => console.log('Kullanıcı ayrıldı.'));
});

// --- 7. BAŞLATMA ---
server.listen(PORT, "0.0.0.0", () => {
    console.log(`SUNUCU ÇALIŞIYOR: ${PORT}`);
});




