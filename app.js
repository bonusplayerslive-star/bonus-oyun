const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo'); 
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const axios = require('axios');

const User = require('./models/User');
const Withdraw = require('./models/Withdraw');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// --- 1. VERİTABANI VE SESSION ---
const MONGO_URI = process.env.MONGO_URI;
mongoose.connect(MONGO_URI).then(() => console.log('✅ Veritabanı Bağlandı'));

// DÜZELTME: MongoStore tanımı Render için en stabil hale getirildi
const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'bpl_ultimate_secret',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: MONGO_URI }),
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
});

app.use(sessionMiddleware);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');

// Socket.io Session Entegrasyonu
io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
});

// --- 2. BSC SCAN VERIFICATION ---
app.post('/verify-payment', async (req, res) => {
    try {
        const { txid, bpl } = req.body;
        const user = await User.findById(req.session.userId);
        if (!user || user.usedHashes.includes(txid)) return res.json({ status: 'error', msg: 'Hata!' });
        const bscUrl = `https://api.bscscan.com/api?module=proxy&action=eth_getTransactionReceipt&txhash=${txid}&apikey=${process.env.BSCSCAN_API_KEY}`;
        const response = await axios.get(bscUrl);
        if (response.data.result?.status === "0x1") {
            user.bpl += parseInt(bpl);
            user.usedHashes.push(txid);
            await user.save();
            return res.json({ status: 'success' });
        }
        res.json({ status: 'error' });
    } catch (err) { res.json({ status: 'error' }); }
});

// --- 3. SOKET SİSTEMİ (ARENA & MEETING) ---
const onlineUsers = new Map();

io.on('connection', async (socket) => {
    const userId = socket.request.session?.userId;
    if (!userId) return;

    const user = await User.findById(userId);
    if (!user) return;

    socket.nickname = user.nickname;
    onlineUsers.set(user.nickname, socket.id);

    // Meeting Bağlantısı
    socket.on('join-meeting', (data) => {
        socket.join(data.roomId);
        socket.peerId = data.peerId;
        socket.currentRoom = data.roomId;
        socket.to(data.roomId).emit('user-connected', { peerId: data.peerId, nickname: socket.nickname });
    });

    socket.on('meeting-message', (data) => {
        io.to(data.roomId).emit('new-meeting-message', { sender: socket.nickname, text: data.text });
    });

    socket.on('disconnect', () => {
        onlineUsers.delete(socket.nickname);
        if (socket.currentRoom) socket.to(socket.currentRoom).emit('user-disconnected', socket.peerId);
    });
});

// Rotalar
app.get('/profil', async (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    const user = await User.findById(req.session.userId);
    res.render('profil', { user });
});

app.get('/meeting', (req, res) => {
    res.render('meeting', { roomId: req.query.room || 'global' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Sistem Aktif: ${PORT}`));
