require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo'); // .default hatasını kökten sildik
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const User = require('./models/User');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// --- GLOBAL DEĞİŞKENLER VE PORT ---
const PORT = process.env.PORT || 10000; // Render için hayati önemde
const onlineUsers = new Map();
let arenaQueue = [];

// --- 1. VERİTABANI VE SESSION ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ BPL ULTIMATE: MongoDB Bağlantısı Başarılı'))
    .catch(err => console.error('❌ MongoDB Hatası:', err));

app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'bpl_ultimate_2026',
    resave: false,
    saveUninitialized: false,
store: MongoStore.create({ 
    mongoUrl: process.env.MONGO_URI 
})
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
});
app.use(sessionMiddleware);

io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
});

// --- 2. KULLANICI KONTROLÜ ---
app.use(async (req, res, next) => {
    res.locals.user = null;
    if (req.session && req.session.userId) {
        try {
            const user = await User.findById(req.session.userId);
            if (user) res.locals.user = user;
        } catch (e) { console.error("Session Hatası:", e); }
    }
    next();
});

const authRequired = (req, res, next) => {
    if (req.session && req.session.userId) return next();
    res.redirect('/');
};

// --- 3. ROTALAR (LOGIN/REGISTER/PROFIL) ---
app.get('/', (req, res) => {
    if (req.session.userId) return res.redirect('/profil');
    res.render('index');
});

app.post('/register', async (req, res) => {
    const { nickname, email, password } = req.body;
    try {
        const existing = await User.findOne({ $or: [{ email: email.toLowerCase() }, { nickname: nickname.trim() }] });
        if (existing) return res.status(400).send("Bu bilgiler kullanımda.");
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({
            nickname: nickname.trim(),
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            bpl: 2500,
            inventory: [],
            selectedAnimal: "none"
        });
        const savedUser = await newUser.save();
        req.session.userId = savedUser._id;
        res.redirect('/profil');
    } catch (err) { res.status(500).send("Kayıt hatası."); }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email: email.toLowerCase().trim() });
        if (user && await bcrypt.compare(password, user.password)) {
            req.session.userId = user._id;
            return res.redirect('/profil');
        }
        res.status(401).send("Hatalı giriş bilgileri.");
    } catch (err) { res.status(500).send("Giriş hatası."); }
});

app.get('/profil', authRequired, (req, res) => res.render('profil'));
app.get('/market', authRequired, (req, res) => res.render('market'));
app.get('/arena', authRequired, (req, res) => res.render('arena'));
app.get('/chat', authRequired, (req, res) => res.render('chat'));

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- 4. SOCKET.IO (ARENA & CHAT) ---
io.on('connection', async (socket) => {
    const uId = socket.request.session?.userId;
    if (!uId) return;
    const user = await User.findById(uId);
    if (!user) return;

    socket.userId = uId;
    socket.nickname = user.nickname;
    onlineUsers.set(user.nickname, socket.id);

    // Online Listesi
    const usersArray = Array.from(onlineUsers.keys()).map(nick => ({ nickname: nick }));
    io.emit('update-user-list', usersArray);

    socket.on('chat-message', (data) => {
        io.emit('new-chat-message', { sender: socket.nickname, text: data.text });
    });

    socket.on('disconnect', () => {
        onlineUsers.delete(socket.nickname);
        io.emit('update-user-list', Array.from(onlineUsers.keys()).map(nick => ({ nickname: nick })));
    });
});

// SUNUCUYU BAŞLAT
server.listen(PORT, () => {
    console.log(`🚀 BPL ULTIMATE AKTİF: Port ${PORT}`);
});

