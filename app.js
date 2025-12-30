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
const Payment = require('./models/Payment');

connectDB();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 10000;

// --- 3. SABİTLER ---
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

// --- 4. MIDDLEWARE ---
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: 'bpl_ozel_anahtar',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

const checkAuth = (req, res, next) => {
    if (req.session.userId) next(); else res.redirect('/');
};

// --- 5. ROTALAR (GET) ---
app.get('/', (req, res) => res.render('index', { user: req.session.userId || null }));
app.get('/profil', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('profil', { user });
});
app.get('/arena', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('arena', { user, selectedAnimal: user.inventory[0]?.name || "Eagle" });
});
app.get('/market', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('market', { user, animals: MARKET_ANIMALS });
});
app.get('/wallet', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('wallet', { user });
});

// --- BEŞGEN KONSEY ---
app.get('/meeting', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        if (user.bpl < 50) return res.render('profil', { user, error: 'Yetersiz BPL!' });
        user.bpl -= 50; await user.save();
        res.render('meeting', { user, roomId: "BPL-VIP-KONSEY" });
    } catch (e) { res.redirect('/profil'); }
});

// --- 6. İŞLEM ROTALARI (POST) ---
app.post('/attack-bot', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        if (user.bpl < 200) return res.json({ status: 'error', msg: 'Yetersiz BPL!' });
        
        // ÖNEMLİ: Klasör isimleri büyük harf ise .toLowerCase() kullanma!
        let animalName = req.body.animal || "Eagle"; 
        const isWin = Math.random() > 0.5;
        
        user.bpl += isWin ? 200 : -200;
        await user.save();

        if (isWin) io.emit('new-message', { sender: "ARENA", text: `🏆 ${user.nickname} kazandı!` });

        res.json({
            status: 'success',
            animation: { 
                actionVideo: `/caracter/move/${animalName}/${animalName}1.mp4`, 
                winVideo: `/caracter/move/${animalName}/${animalName}.mp4`, 
                isWin 
            },
            newBalance: user.bpl
        });
    } catch (err) { res.status(500).json({ status: 'error' }); }
});

// --- ÖDEME DOĞRULAMA (EKSİKTİ, GERİ GELDİ) ---
app.post('/verify-payment', checkAuth, async (req, res) => {
    const { txid, bpl } = req.body;
    try {
        const check = await Payment.findOne({ txid });
        if (check) return res.json({ status: 'error', msg: 'Bu işlem zaten kaydedilmiş!' });
        
        // BSCScan API kontrolü buraya gelecek (process.env.BSCSCAN_API_KEY ile)
        const user = await User.findById(req.session.userId);
        user.bpl += parseInt(bpl);
        await user.save();
        await new Payment({ userId: user._id, txid, amountBPL: bpl, status: 'COMPLETED' }).save();
        res.json({ status: 'success', msg: 'Yükleme başarılı!' });
    } catch (e) { res.json({ status: 'error' }); }
});

// --- 10. SOCKET.IO (TÜMÜ İÇERİDE) ---
io.on('connection', (socket) => {
    socket.on('register-user', (data) => {
        socket.userId = data.id;
        socket.nickname = data.nickname;
        socket.join('Global');
    });

    socket.on('chat-message', (data) => {
        io.to(data.room || 'Global').emit('new-message', { sender: socket.nickname, text: data.text });
    });

    socket.on('join-meeting', (roomId) => {
        socket.join(roomId);
        io.to(roomId).emit('new-message', { sender: "SİSTEM", text: `🔥 ${socket.nickname} bağlandı.` });
    });

    socket.on('send-gift-vip', async (data) => {
        const sender = await User.findById(socket.userId);
        const receiver = await User.findOne({ nickname: data.targetNick });
        if (sender && receiver && sender.bpl >= data.amount) {
            sender.bpl -= data.amount;
            receiver.bpl += Math.floor(data.amount * 0.8); // %20 vergi
            await sender.save(); await receiver.save();
            io.to(data.room).emit('new-message', { sender: "SİSTEM", text: `🎁 ${sender.nickname} -> ${receiver.nickname}: ${data.amount} BPL!` });
            socket.emit('gift-result', { status: 'success', newBalance: sender.bpl });
        }
    });

    socket.on('disconnect', () => console.log('Ayrıldı.'));
});

server.listen(PORT, "0.0.0.0", () => console.log(`PORT ${PORT} AKTİF`));
