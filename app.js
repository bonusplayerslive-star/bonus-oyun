require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const mongoose = require('mongoose');
const axios = require('axios');
const nodemailer = require('nodemailer');


const connectDB = require('./db');
const User = require('./models/User');
const Log = require('./models/Log');
const Payment = require('./models/Payment');
const Victory = require('./models/Victory'); 
const Punishment = require('./models/Punishment');
const Income = require('./models/Income'); 

connectDB();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 10000;
app.set('trust proxy', 1);

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

const onlineUsers = {}; 
const busyUsers = new Set();

const checkAuth = (req, res, next) => {
    if (req.session.userId) next(); else res.redirect('/');
};


// --- NODEMAILER AYARI (En üste require'ların yanına ekle) ---


const transporter = nodemailer.createTransport({
    service: 'gmail', // veya .env içindeki bilgiler
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// --- 1. COMMAND CENTER (CONTACT) ROTASI ---
app.post('/contact', async (req, res) => {
    try {
        const { email, note } = req.body;
        // 1. Mongo'ya Kaydet (Log modelini kullanabilirsin veya yeni Contact modeli)
        const newLog = new Log({
            userId: req.session.userId || null,
            action: 'CONTACT_FORM',
            details: `Email: ${email}, Message: ${note}`
        });
        await newLog.save();

        // 2. Mail Gönder (Opsiyonel)
        console.log(`📩 Yeni Destek Mesajı: ${email} -> ${note}`);
        
        res.send('<script>alert("Transmission Received! We will contact you."); window.location.href="/";</script>');
    } catch (e) {
        console.error("Contact Error:", e);
        res.status(500).send("Command Center Offline!");
    }
});

// --- 2. FORGOT PASSWORD ROTASI ---
app.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email });

        if (!user) {
            return res.send('<script>alert("User not found!"); window.location.href="/";</script>');
        }

        // Şifreyi mail atıyoruz (Güvenlik için normalde link gönderilir ama senin isteğin üzerine şifreyi atıyoruz)
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'BPL Ecosystem - Password Recovery',
            text: `Your current password is: ${user.password} \n\nPlease change it after login.`
        };

        await transporter.sendMail(mailOptions);
        res.send('<script>alert("Password sent to your email!"); window.location.href="/";</script>');
    } catch (e) {
        console.error("Forgot Pass Error:", e);
        res.send('<script>alert("Mail System Error!"); window.location.href="/";</script>');
    }
});

// --- ROTALAR ---
app.get('/', (req, res) => res.render('index', { userIp: req.ip }));
app.get('/profil', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('profil', { user });
});
app.get('/market', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('market', { user });
});
app.get('/arena', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('arena', { user, selectedAnimal: req.query.animal });
});
app.get('/chat', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('chat', { user });
});
app.get('/wallet', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('wallet', { user });
});
app.get('/payment', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('payment', { user });
});
app.get('/meeting', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    const roomId = req.query.roomId || "BPL-CENTRAL"; 
    res.render('meeting', { user, roomId });
});
app.get('/development', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('development', { user });
});

// --- POST İŞLEMLERİ ---
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email, password });
    if (user) { req.session.userId = user._id; res.redirect('/profil'); }
    else res.send('<script>alert("Hatalı Giriş!"); window.location.href="/";</script>');
});

app.post('/register', async (req, res) => {
    try {
        const newUser = new User({ ...req.body, bpl: 2500 });
        await newUser.save();
        res.send('<script>alert("Kayıt Başarılı!"); window.location.href="/";</script>');
    } catch (e) { res.send("Kayıt Hatası!"); }
});

app.post('/upgrade-stat', checkAuth, async (req, res) => {
    try {
        const { animalName, statType, cost } = req.body;
        const user = await User.findById(req.session.userId);
        if (user.bpl < cost) return res.json({ status: 'error', msg: 'Yetersiz BPL!' });
        user.bpl -= cost;
        if (!user.stats[animalName]) user.stats[animalName] = { hp: 100, atk: 20, def: 10 };
        if (statType === 'hp') user.stats[animalName].hp += 10;
        else if (statType === 'atk') user.stats[animalName].atk += 5;
        else if (statType === 'def') user.stats[animalName].def += 5;
        user.markModified('stats'); 
        await user.save();
        res.json({ status: 'success', newBalance: user.bpl });
    } catch (e) { res.json({ status: 'error', msg: 'Sunucu hatası!' }); }
});

// --- SOCKET SİSTEMİ ---
io.on('connection', (socket) => {
    socket.on('register-user', (data) => {
        socket.nickname = data.nickname;
        socket.userId = data.id;
        onlineUsers[data.nickname] = socket.id;
        io.emit('update-online-players', Object.keys(onlineUsers).length);
    });

    socket.on('join-arena', () => {
        const opponentNickname = Object.keys(onlineUsers).find(nick => 
            nick !== socket.nickname && !busyUsers.has(nick)
        );
        if (opponentNickname) {
            const opponentSocketId = onlineUsers[opponentNickname];
            const roomId = `arena_${socket.nickname}_${opponentNickname}`;
            socket.join(roomId);
            const opponentSocket = io.sockets.sockets.get(opponentSocketId);
            if (opponentSocket) opponentSocket.join(roomId);
            busyUsers.add(socket.nickname);
            busyUsers.add(opponentNickname);
            io.to(roomId).emit('match-found', { player1: socket.nickname, player2: opponentNickname, roomId: roomId });
        } else {
            socket.emit('waiting-for-opponent');
        }
    });

    socket.on('chat-message', (data) => {
        io.emit('new-message', { sender: data.nickname, text: data.message });
    });

    socket.on('disconnect', () => {
        if (socket.nickname) {
            delete onlineUsers[socket.nickname];
            busyUsers.delete(socket.nickname);
            io.emit('update-online-players', Object.keys(onlineUsers).length);
        }
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`BPL SERVER RUNNING ON PORT ${PORT}`);
});

