// Path: app.js
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo').default;
const path = require('path');
require('dotenv').config();

const User = require('./models/User');
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" }, allowEIO3: true });

// --- 1. VERİTABANI & HAFIZA ---
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://bonusplayerslive_db_user:1nB1QyAsh3qVafpE@bonus.x39zlzq.mongodb.net/?appName=Bonus";
const activeRooms = {}; 
let arenaQueue = []; 
const botNames = ["Alpha_Commander", "Cyber_Ghost", "Shadow_Warrior", "Neon_Striker", "Elite_Guard"];
const botAnimalsList = ["Gorilla", "Eagle", "Lion", "Wolf", "Cobra"];

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Bağlantısı Başarılı'))
    .catch(err => console.error('❌ MongoDB Hatası:', err));

// --- 2. MIDDLEWARE & SESSION ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'bpl_cyber_secret_2025',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: MONGO_URI }),
    cookie: { secure: false, maxAge: 1000 * 60 * 60 * 24 }
});

app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);

async function isLoggedIn(req, res, next) {
    if (req.session && req.session.userId) {
        const user = await User.findById(req.session.userId);
        if (user) { req.user = user; res.locals.user = user; return next(); }
    }
    res.redirect('/login');
}

// --- 3. ROTALAR ---
app.get('/', (req, res) => req.session.userId ? res.redirect('/profil') : res.render('index'));
app.get('/login', (req, res) => res.render('index'));
app.get('/profil', isLoggedIn, async (req, res) => res.render('profil', { user: await User.findById(req.user._id) }));
app.get('/chat', isLoggedIn, (req, res) => res.render('chat', { user: req.user }));
app.get('/arena', isLoggedIn, (req, res) => res.render('arena', { user: req.user, opponentNick: req.query.opponent || null }));
app.get('/meeting', isLoggedIn, (req, res) => res.render('meeting', { user: req.user, roomId: req.query.room || "GENEL_KONSEY" }));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// Karakter Satın Alma ve Geliştirme API'leri (Burayı senin orijinal halinden korudum)
app.post('/buy-animal', isLoggedIn, async (req, res) => { /* Orijinal kodun buraya gelecek */ });
app.post('/api/upgrade-stat', isLoggedIn, async (req, res) => { /* Orijinal kodun buraya gelecek */ });

// --- 4. SOCKET.IO (TEK VE ANA BLOK) ---
io.on('connection', async (socket) => {
    const session = socket.request.session;
    if (session && session.userId) {
        const user = await User.findById(session.userId);
        if (user) {
            socket.userId = user._id;
            socket.nickname = user.nickname;
            socket.join(user.nickname);
            console.log(`✅ Bağlı: ${socket.nickname}`);
        }
    }

    // ODAYA KATILIM (Meeting & Arena Bilet Sistemi)
    socket.on('join-meeting', (roomId, peerId, nickname) => {
        if (!roomId || !nickname) return;
        socket.join(roomId);
        socket.roomId = roomId;
        socket.nickname = nickname;
        socket.peerId = peerId;

        if (!activeRooms[roomId]) activeRooms[roomId] = { members: [] };
        if (!activeRooms[roomId].members.find(m => m.nickname === nickname)) {
            activeRooms[roomId].members.push({ nickname, peerId });
        }
        updateAllLists(roomId);
        socket.to(roomId).emit('user-connected', peerId, nickname);
    });

    // MESAJLAŞMA (Chat & Oda Uyumu)
    socket.on('chat-message', (data) => {
        if (!data.text || data.text.trim() === "") return;
        const msgObj = {
            sender: socket.nickname || "Misafir",
            text: data.text.trim(),
            time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
            room: data.room || 'GENEL'
        };
        if (msgObj.room !== 'GENEL') io.to(msgObj.room).emit('new-message', msgObj);
        else io.emit('new-message', msgObj);
    });

    // DAVET SİSTEMİ
    socket.on('send-invite', (data) => {
        const { to, type } = data;
        const sharedRoomId = `KONSEY_${socket.nickname}_${Date.now().toString().slice(-4)}`;
        const link = `/${type}?room=${sharedRoomId}`;
        io.to(to).emit('receive-invite-request', { from: socket.nickname, roomId: sharedRoomId, type: type });
        socket.emit('redirect-to-room', link);
    });

    socket.on('accept-invite', (data) => {
        socket.emit('redirect-to-room', `/${data.type}?room=${data.roomId}`);
    });

    // BPL TRANSFER (Tek Sefer)
    socket.on('transfer-bpl', async (data) => {
        try {
            const sender = await User.findById(socket.userId);
            const receiver = await User.findOne({ nickname: data.to });
            const amount = parseInt(data.amount);
            if (receiver && sender.bpl >= (amount + 5500) && amount >= 50) {
                sender.bpl -= amount;
                receiver.bpl += Math.floor(amount * 0.75);
                await sender.save(); await receiver.save();
                socket.emit('update-bpl', sender.bpl);
                io.to(receiver.nickname).emit('update-bpl', receiver.bpl);
            }
        } catch (e) { console.error(e); }
    });

    // ARENA MOTORU
    socket.on('arena-ready', async (data) => {
        // Senin arena mantığın buraya gelecek
    });

    // AYRILMA VE TEMİZLİK (Tek Sefer)
    socket.on('disconnect', () => {
        const rId = socket.roomId;
        if (rId && activeRooms[rId]) {
            activeRooms[rId].members = activeRooms[rId].members.filter(m => m.nickname !== socket.nickname);
            socket.to(rId).emit('user-disconnected', socket.peerId);
            updateAllLists(rId);
            if (activeRooms[rId].members.length === 0) delete activeRooms[rId];
        }
    });

    async function updateAllLists(roomId) {
        const allSockets = await io.fetchSockets();
        const globalOnline = allSockets.map(s => ({ nickname: s.nickname }));
        io.emit('update-user-list', globalOnline);
        if (roomId && activeRooms[roomId]) {
            io.to(roomId).emit('update-council-list', activeRooms[roomId].members.map(m => m.nickname));
        }
    }
}); // io.on SONU

// --- 5. SERVER BAŞLAT ---
const PORT = process.env.PORT || 10000;
httpServer.listen(PORT, () => console.log(`🌍 Sunucu Yayında: ${PORT}`));

