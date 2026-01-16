const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo'); // .default kullanma, aşağıda hallediyoruz
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const axios = require('axios');

const User = require('./models/User');
// const Withdraw = require('./models/Withdraw'); // Eğer hata verirse yorumdan çıkarırsın

const app = express(); // ÖNCE BU: Uygulamayı başlatıyoruz
const server = http.createServer(app);
const io = socketIo(server);

// --- 1. VERİTABANI VE SESSION ---
const MONGO_URI = process.env.MONGO_URI;
mongoose.connect(MONGO_URI).then(() => console.log('✅ Veritabanı Bağlandı'));

// Session yapılandırması (app tanımlandıktan sonra olmalı!)
app.use(session({
    secret: process.env.SESSION_SECRET || 'bpl_ultimate_secret',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: MONGO_URI }),
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');

// Socket.io Session Erişimi
io.use((socket, next) => {
    // Session middleware'i manuel tetikleme
    const req = socket.request;
    const res = {};
    session({
        secret: process.env.SESSION_SECRET || 'bpl_ultimate_secret',
        store: MongoStore.create({ mongoUrl: MONGO_URI }),
        resave: false,
        saveUninitialized: false
    })(req, res, next);
});

// --- 2. SOKET MANTIĞI ---
io.on('connection', async (socket) => {
    // Kullanıcı kontrolü
    if (!socket.request.session || !socket.request.session.userId) return;
    
    const user = await User.findById(socket.request.session.userId);
    if (!user) return;

    socket.nickname = user.nickname;

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
        if (socket.currentRoom) socket.to(socket.currentRoom).emit('user-disconnected', socket.peerId);
    });
});

// --- 3. ROTALAR ---
app.get('/meeting', (req, res) => {
    res.render('meeting', { role: req.query.role || 'guest' });
});

app.get('/profil', async (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    const user = await User.findById(req.session.userId);
    res.render('profil', { user });
});

// Port Dinleme
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Sistem Aktif: ${PORT}`));
