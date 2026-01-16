const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo').default; 
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

// DÜZELTİLEN KISIM: connect-mongo kullanımı
app.use(session({
    secret: process.env.SESSION_SECRET || 'bpl_ultimate_secret',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: MONGO_URI,
        collectionName: 'sessions'
    }),
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');

io.use((socket, next) => {
    const session = socket.request.session;
    if (session && session.userId) {
        next();
    } else {
        next(new Error("Unauthorized"));
    }
});

// --- 2. BSC SCAN VERIFICATION ---
app.post('/verify-payment', async (req, res) => {
    try {
        const { txid, bpl } = req.body;
        const user = await User.findById(req.session.userId);
        if (!user || user.usedHashes.includes(txid)) return res.json({ status: 'error', msg: 'İşlem zaten kayıtlı!' });
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

// --- 3. ARENA MANTIĞI ---
async function startBattle(p1, p2, io) {
    try {
        const p1WinChance = 50 + ((p1.dbData.atk || 10) - (p2.dbData.def || 10));
        const winner = Math.random() * 100 <= p1WinChance ? p1 : p2;
        if (winner.socketId !== 'bot') {
            await User.findByIdAndUpdate(winner.dbData._id, { $inc: { bpl: 100 } });
            io.to(winner.socketId).emit('update-bpl', 100);
        }
        const data = { winnerNick: winner.nickname, prize: 100, p1Nick: p1.nickname, p2Nick: p2.nickname };
        if (p1.socketId !== 'bot') io.to(p1.socketId).emit('arena-match-found', data);
        if (p2.socketId !== 'bot') io.to(p2.socketId).emit('arena-match-found', data);
    } catch (e) { console.log(e); }
}

// --- 4. SOKET SİSTEMİ ---
const onlineUsers = new Map();
let arenaQueue = [];

io.on('connection', async (socket) => {
    const user = await User.findById(socket.request.session.userId);
    if (!user) return;
    socket.nickname = user.nickname;
    onlineUsers.set(user.nickname, socket.id);

    socket.on('arena-join-queue', () => {
        if (arenaQueue.find(p => p.socketId === socket.id)) return;
        arenaQueue.push({ nickname: socket.nickname, socketId: socket.id, dbData: user });
        if (arenaQueue.length >= 2) {
            startBattle(arenaQueue.shift(), arenaQueue.shift(), io);
        } else {
            setTimeout(() => {
                const idx = arenaQueue.findIndex(p => p.socketId === socket.id);
                if (idx !== -1) {
                    const p = arenaQueue.splice(idx, 1)[0];
                    startBattle(p, { nickname: "BOT_Kurt", socketId: 'bot', dbData: { atk: 10, def: 10 } }, io);
                }
            }, 5000);
        }
    });

    socket.on('join-meeting', (data) => {
        socket.join(data.roomId);
        socket.peerId = data.peerId;
        socket.currentRoom = data.roomId;
        socket.to(data.roomId).emit('user-connected', { peerId: data.peerId, nickname: socket.nickname });
    });

    socket.on('disconnect', () => {
        onlineUsers.delete(socket.nickname);
        if (socket.currentRoom) socket.to(socket.currentRoom).emit('user-disconnected', socket.peerId);
        arenaQueue = arenaQueue.filter(p => p.socketId !== socket.id);
    });
});

app.get('/profil', async (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    const user = await User.findById(req.session.userId);
    res.render('profil', { user });
});
app.get('/meeting', (req, res) => res.render('meeting', { roomId: req.query.room || 'global' }));

server.listen(process.env.PORT || 3000, () => console.log('🚀 BPL ONLINE'));

