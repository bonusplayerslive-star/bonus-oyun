// Path: app.js

// --- 1. MODÜLLER ---
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo').default; // .default hatası giderildi
const path = require('path');
require('dotenv').config();

const User = require('./models/User');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { 
    cors: { origin: "*" },
    allowEIO3: true 
});

// --- 2. VERİTABANI BAĞLANTISI ---
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://bonusplayerslive_db_user:1nB1QyAsh3qVafpE@bonus.x39zlzq.mongodb.net/?appName=Bonus";

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Bağlantısı Başarılı'))
    .catch(err => console.error('❌ MongoDB Hatası:', err));

// --- 3. MIDDLEWARE & SESSION ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'bpl_cyber_secret_2025',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ 
        mongoUrl: MONGO_URI,
        collectionName: 'sessions'
    }),
    cookie: { 
        secure: false, 
        maxAge: 1000 * 60 * 60 * 24 
    }
});

app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);

// Güvenlik Kapısı
async function isLoggedIn(req, res, next) {
    if (req.session && req.session.userId) {
        const user = await User.findById(req.session.userId);
        if (user) {
            req.user = user;
            res.locals.user = user;
            return next();
        }
    }
    res.redirect('/login');
}

// --- 4. ROTALAR (ROUTES) ---

app.get('/', (req, res) => {
    if (req.session.userId) return res.redirect('/profil');
    res.render('index'); 
});

app.get('/login', (req, res) => res.render('index'));

app.post('/register', async (req, res) => {
    try {
        const { nickname, email, password } = req.body;
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.send("<script>alert('E-posta kayıtlı!'); window.location='/';</script>");
        const newUser = new User({ nickname, email, password, bpl: 2500, inventory: [], selectedAnimal: 'Tiger' });
        await newUser.save();
        req.session.userId = newUser._id;
        res.redirect('/profil');
    } catch (err) { res.status(500).send("Hata: " + err.message); }
});

app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email, password });
        if (user) {
            req.session.userId = user._id;
            res.redirect('/profil');
        } else {
            res.send("<script>alert('Hatalı giriş!'); window.location='/';</script>");
        }
    } catch (err) { res.status(500).send("Giriş başarısız."); }
});

app.get('/profil', isLoggedIn, async (req, res) => {
    const user = await User.findById(req.user._id);
    res.render('profil', { user });
});

app.get('/arena', isLoggedIn, (req, res) => res.render('arena', { user: req.user }));
app.get('/market', isLoggedIn, (req, res) => res.render('market', { user: req.user }));
app.get('/chat', isLoggedIn, (req, res) => res.render('chat', { user: req.user }));
app.get('/meeting', isLoggedIn, (req, res) => res.render('meeting', { user: req.user }));
app.get('/development', isLoggedIn, async (req, res) => {
    const user = await User.findById(req.user._id);
    res.render('development', { user });
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// --- API İŞLEMLERİ (Market & Geliştirme) ---
app.post('/api/buy-item', isLoggedIn, async (req, res) => {
    try {
        const { itemName, price } = req.body;
        const user = await User.findById(req.user._id);
        if (user.bpl < price) return res.json({ success: false, error: "Yetersiz BPL!" });
        user.bpl -= price;
        user.inventory.push({ name: itemName, hp: 100, maxHp: 100, atk: 20, def: 15, level: 1 });
        await user.save();
        res.json({ success: true, newBalance: user.bpl });
    } catch (err) { res.json({ success: false, error: "Sunucu hatası!" }); }
});

// --- 5. SOCKET.IO İŞLEMLERİ ---
let arenaWaitingPool = [];

io.on('connection', async (socket) => {
    const session = socket.request.session;
    if (session && session.userId) {
        const user = await User.findById(session.userId);
        if (user) {
            socket.userId = user._id;
            socket.nickname = user.nickname;
            socket.animal = user.selectedAnimal || "Tiger";
        }
    }

    // --- GENEL CHAT & TRANSFER ---
    socket.on('chat-message', (data) => {
        io.emit('new-message', {
            sender: socket.nickname || "Bilinmeyen",
            text: data.text,
            time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
        });
    });

    socket.on('transfer-bpl', async (data) => {
        try {
            const sender = await User.findById(socket.userId);
            const receiver = await User.findOne({ nickname: data.to });
            const amount = parseInt(data.amount);
            if (receiver && sender.bpl >= amount + 500 && amount >= 50) {
                sender.bpl -= amount;
                receiver.bpl += (amount * 0.8);
                await sender.save(); await receiver.save();
                socket.emit('gift-result', { success: true, message: "Transfer Başarılı!", newBalance: sender.bpl });
            } else {
                socket.emit('gift-result', { success: false, message: "Limit yetersiz veya alıcı yok!" });
            }
        } catch (e) { console.log(e); }
    });

    // --- ARENA SİSTEMİ ---
    socket.on('find-match', async (data) => {
        arenaWaitingPool = arenaWaitingPool.filter(s => s.connected && s.id !== socket.id);
        if (arenaWaitingPool.length > 0) {
            const opponentSocket = arenaWaitingPool.shift();
            const roomId = `arena_${opponentSocket.id}_${socket.id}`;
            socket.join(roomId);
            opponentSocket.join(roomId);

            const matchData = {
                roomId: roomId,
                isWin: Math.random() > 0.5,
                prize: 50 * (data.multiplier || 1),
                players: [
                    { id: socket.id, nick: socket.nickname, animal: data.myAnimal },
                    { id: opponentSocket.id, nick: opponentSocket.nickname, animal: opponentSocket.animal }
                ]
            };
            io.to(roomId).emit('pvp-found', matchData);
        } else {
            socket.animal = data.myAnimal;
            arenaWaitingPool.push(socket);
        }
    });

    socket.on('start-bot-battle', async (data) => {
        arenaWaitingPool = arenaWaitingPool.filter(s => s.id !== socket.id);
        try {
            const user = await User.findById(socket.userId);
            const isWin = Math.random() > 0.6;
            const prize = isWin ? 50 : 0;
            if(user) {
                user.bpl += (isWin ? (prize * data.multiplier) : -25);
                await user.save();
            }
            socket.emit('battle-result', {
                isWin,
                opponentName: "Cyber_Bot_Alpha",
                opponentAnimal: "Lion",
                prize: prize * (data.multiplier || 1)
            });
        } catch (e) { console.log(e); }
    });

    // --- TOPLANTI & ÖZEL DAVET ---
    socket.on('join-meeting', (data) => {
        const roomId = data.roomId || "GENEL_KONSEY";
        socket.join(roomId);
        socket.currentRoom = roomId;
        socket.to(roomId).emit('user-connected', { nickname: socket.nickname, id: socket.id });
    });

    socket.on('send-challenge', async (data) => {
        const sender = await User.findById(socket.userId);
        if (sender && sender.bpl >= 5505) { // 5500 limit + 5 bilet
            sender.bpl -= 5; await sender.save();
            io.emit('challenge-received', { from: socket.nickname, target: data.target, ticket: Math.random().toString(36).substring(7) });
            socket.emit('update-bpl', sender.bpl);
        }
    });

    // --- VIP HEDİYE SİSTEMİ (5500 SINIRI) ---
    socket.on('send-gift-vip', async (data) => {
        try {
            const { targetNick, amount, room } = data;
            const sender = await User.findById(socket.userId);
            const receiver = await User.findOne({ nickname: targetNick });

            if (!receiver || sender.nickname === targetNick) return;
            if (sender.bpl - amount < 5500) {
                return socket.emit('new-message', { sender: "SİSTEM", text: "❌ Bakiyeniz 5500 BPL altına düşemez!" });
            }

            sender.bpl -= amount;
            receiver.bpl += (amount * 0.9);
            await sender.save(); await receiver.save();

            socket.emit('update-bpl', sender.bpl);
            io.to(room || "GENEL_KONSEY").emit('new-message', {
                sender: "SİSTEM",
                text: `🎁 ${sender.nickname}, ${receiver.nickname} kullanıcısına ${amount} BPL gönderdi!`
            });
        } catch (err) { console.error(err); }
    });

    socket.on('disconnect', () => {
        arenaWaitingPool = arenaWaitingPool.filter(s => s.id !== socket.id);
    });
});

// --- 6. BAŞLAT ---
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`🌍 Sunucu Yayında: http://localhost:${PORT}`));

