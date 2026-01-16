const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const axios = require('axios');

const User = require('./models/User');

// --- 1. UYGULAMAYI BAŞLAT (SIRALAMA KRİTİK!) ---
const app = express(); // ÖNCE BU SATIR ÇALIŞMALI
const server = http.createServer(app);
const io = socketIo(server);

// --- 2. VERİTABANI VE SESSION ---
const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Veritabanı Bağlandı'))
    .catch(err => console.error('❌ DB Hatası:', err));

// Session yapılandırması - app tanımlandıktan SONRA olmalı
const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'bpl_ultimate_secret',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ 
        mongoUrl: MONGO_URI,
        collectionName: 'sessions'
    }),
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

// --- 3. SOKET MANTIĞI ---
io.on('connection', async (socket) => {
    const userId = socket.request.session?.userId;
    if (!userId) return;

    const user = await User.findById(userId);
    if (!user) return;

    socket.nickname = user.nickname;

    socket.on('join-meeting', (data) => {
        socket.join(data.roomId);
        socket.peerId = data.peerId;
        socket.currentRoom = data.roomId;
        socket.to(data.roomId).emit('user-connected', { 
            peerId: data.peerId, 
            nickname: socket.nickname 
        });
    });

    socket.on('meeting-message', (data) => {
        io.to(data.roomId).emit('new-meeting-message', { 
            sender: socket.nickname, 
            text: data.text 
        });
    });

    socket.on('disconnect', () => {
        if (socket.currentRoom) {
            socket.to(socket.currentRoom).emit('user-disconnected', socket.peerId);
        }
    });
});

// --- 4. ROTALAR ---
app.get('/', (req, res) => {
    res.render('index'); // Ana sayfanın adını kontrol et
});

app.get('/meeting', (req, res) => {
    res.render('meeting', { 
        roomId: req.query.room || 'global',
        role: req.query.role || 'guest'
    });
});

app.get('/profil', async (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    const user = await User.findById(req.session.userId);
    res.render('profil', { user });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Sistem Aktif: ${PORT}`));
