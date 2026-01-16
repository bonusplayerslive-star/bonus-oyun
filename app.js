const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo'); 
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');
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
    secret: process.env.SESSION_SECRET || 'bpl_secret_2024',
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

// --- 2. BSC SCAN & ÖDEME SİSTEMİ ---
app.post('/verify-payment', async (req, res) => {
    try {
        const { txid, bpl } = req.body;
        const user = await User.findById(req.session.userId);
        if (!user) return res.json({ status: 'error', msg: 'Oturum yok.' });
        if (user.usedHashes.includes(txid)) return res.json({ status: 'error', msg: 'Bu işlem zaten yapılmış!' });

        const bscUrl = `https://api.bscscan.com/api?module=proxy&action=eth_getTransactionReceipt&txhash=${txid}&apikey=${process.env.BSCSCAN_API_KEY}`;
        const response = await axios.get(bscUrl);
        const receipt = response.data.result;

        if (receipt && receipt.status === "0x1") {
            user.bpl += parseInt(bpl);
            user.usedHashes.push(txid);
            await user.save();
            return res.json({ status: 'success', msg: `${bpl} BPL eklendi!` });
        }
        res.json({ status: 'error', msg: 'İşlem onaylanmadı.' });
    } catch (err) { res.json({ status: 'error', msg: 'Sistem hatası.' }); }
});

// --- 3. GELİŞTİRME (STAT UPGRADE) ---
app.post('/api/upgrade-stat', async (req, res) => {
    try {
        const { animalName, statType } = req.body;
        const user = await User.findById(req.session.userId);
        const animal = user.inventory.find(a => a.name === animalName);
        const cost = (statType === 'def') ? 10 : 15;

        if (user.bpl < cost + 25) return res.json({ success: false, error: 'Limit 25 BPL!' });

        if (statType === 'hp') { animal.hp += 10; animal.maxHp += 10; }
        else if (statType === 'atk') animal.atk += 5;
        else if (statType === 'def') animal.def += 5;

        user.bpl -= cost;
        user.markModified('inventory');
        await user.save();
        res.json({ success: true, newBalance: user.bpl, stats: animal });
    } catch (err) { res.json({ success: false }); }
});

// --- 4. CÜZDAN KAYIT & ÇEKİM ---
app.post('/api/save-wallet-address', async (req, res) => {
    try {
        const { bnb_address } = req.body;
        await User.findByIdAndUpdate(req.session.userId, { bnb_address });
        res.json({ success: true });
    } catch (err) { res.json({ success: false }); }
});

app.post('/api/withdraw-request', async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const amount = user.bpl - 5000;
        if (amount <= 0) return res.json({ success: false, error: 'Minimum 5000 kalmalı.' });

        const request = new Withdraw({
            userId: user._id, nickname: user.nickname,
            requestedAmount: amount, finalAmount: amount * 0.75,
            walletAddress: user.bnb_address
        });
        await request.save();
        user.bpl = 5000;
        await user.save();
        res.json({ success: true, msg: 'Talep iletildi.' });
    } catch (err) { res.json({ success: false }); }
});

// --- 5. ARENA & CHAT & MEETING SOKET SİSTEMİ ---
const onlineUsers = new Map();
let arenaQueue = [];

io.on('connection', async (socket) => {
    const user = await User.findById(socket.request.session?.userId);
    if (!user) return;
    socket.nickname = user.nickname;
    onlineUsers.set(user.nickname, socket.id);
    socket.join("general-chat");

    // ARENA
    socket.on('arena-join-queue', () => {
        if (arenaQueue.find(p => p.socketId === socket.id)) return;
        arenaQueue.push({ nickname: socket.nickname, socketId: socket.id, dbData: user });
        if (arenaQueue.length >= 2) {
            const p1 = arenaQueue.shift(); const p2 = arenaQueue.shift();
            // startBattle fonksiyonunu buraya dahil et (Önceki kodda var)
        }
    });

    // CHAT & MEETING (Önceki stabil kodun aynısı buraya gelecek)
    socket.on('disconnect', () => onlineUsers.delete(socket.nickname));
});

// Rotalar
app.get('/profil', (req, res) => res.render('profil'));
app.get('/wallet', (req, res) => res.render('wallet'));
app.get('/market', (req, res) => res.render('market'));
app.get('/arena', (req, res) => res.render('arena'));

server.listen(3000, () => console.log('🚀 BPL ULTIMATE FULL AKTİF!'));
