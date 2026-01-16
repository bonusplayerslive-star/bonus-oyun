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

io.use((socket, next) => { sessionMiddleware(socket.request, {}, next); });

// --- 2. BSC SCAN VERIFICATION ---
app.post('/verify-payment', async (req, res) => {
    try {
        const { txid, bpl } = req.body;
        const user = await User.findById(req.session.userId);
        if (!user || user.usedHashes.includes(txid)) return res.json({ status: 'error', msg: 'Hatalı işlem!' });

        const bscUrl = `https://api.bscscan.com/api?module=proxy&action=eth_getTransactionReceipt&txhash=${txid}&apikey=${process.env.BSCSCAN_API_KEY}`;
        const response = await axios.get(bscUrl);
        if (response.data.result?.status === "0x1") {
            user.bpl += parseInt(bpl);
            user.usedHashes.push(txid);
            await user.save();
            return res.json({ status: 'success', msg: 'BPL Yüklendi!' });
        }
        res.json({ status: 'error', msg: 'Onaylanmadı.' });
    } catch (err) { res.json({ status: 'error' }); }
});

// --- 3. STAT UPGRADE (GELİŞTİRME) ---
app.post('/api/upgrade-stat', async (req, res) => {
    try {
        const { animalName, statType } = req.body;
        const user = await User.findById(req.session.userId);
        const animal = user.inventory.find(a => a.name === animalName);
        const cost = (statType === 'def') ? 10 : 15;

        if (user.bpl < cost + 25) return res.json({ success: false, error: 'Yetersiz BPL!' });

        if (statType === 'hp') { animal.hp += 10; animal.maxHp += 10; }
        else if (statType === 'atk') animal.atk += 5;
        else if (statType === 'def') animal.def += 5;

        user.bpl -= cost;
        user.markModified('inventory');
        await user.save();
        res.json({ success: true, newBalance: user.bpl, stats: animal });
    } catch (err) { res.json({ success: false }); }
});

// --- 4. SAVAŞ MANTIĞI (ARENA) ---
async function startBattle(p1, p2, io) {
    try {
        const p1WinChance = 50 + ((p1.dbData.atk || 0) - (p2.dbData.def || 0));
        const winner = Math.random() * 100 <= p1WinChance ? p1 : p2;
        const prize = 100;

        if (winner.socketId !== 'bot') {
            const winUser = await User.findById(winner.dbData._id);
            winUser.bpl += prize;
            await winUser.save();
            io.to(winner.socketId).emit('update-bpl', winUser.bpl);
        }

        const data = { winnerNick: winner.nickname, prize, p1Nick: p1.nickname, p2Nick: p2.nickname };
        if (p1.socketId !== 'bot') io.to(p1.socketId).emit('arena-match-found', data);
        if (p2.socketId !== 'bot') io.to(p2.socketId).emit('arena-match-found', data);
    } catch (e) { console.log(e); }
}

// --- 5. SOKET SİSTEMİ (CHATS, ARENA, MEETING) ---
const onlineUsers = new Map();
let arenaQueue = [];

io.on('connection', async (socket) => {
    const user = await User.findById(socket.request.session?.userId);
    if (!user) return;

    socket.nickname = user.nickname;
    onlineUsers.set(user.nickname, socket.id);
    socket.join("general-chat");

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

    socket.on('meeting-message', (data) => {
        io.to(data.roomId).emit('new-meeting-message', { sender: socket.nickname, text: data.text });
    });

    socket.on('disconnect', () => {
        onlineUsers.delete(socket.nickname);
        if (socket.currentRoom) socket.to(socket.currentRoom).emit('user-disconnected', socket.peerId);
        arenaQueue = arenaQueue.filter(p => p.socketId !== socket.id);
    });
});

// --- 6. ROTALAR ---
app.get('/profil', async (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    const user = await User.findById(req.session.userId);
    res.render('profil', { user });
});
app.get('/arena', (req, res) => res.render('arena'));
app.get('/chat', (req, res) => res.render('chat'));
app.get('/meeting', (req, res) => res.render('meeting', { role: req.query.role || 'guest' }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Sistem Aktif: ${PORT}`));
