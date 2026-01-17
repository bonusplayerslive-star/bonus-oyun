// Path: app.js
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const path = require('path');
require('dotenv').config();

const User = require('./models/User');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { 
    cors: { origin: "*" },
    allowEIO3: true 
});

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

// --- 3. ROTALAR (ROUTES) ---
app.get('/', (req, res) => req.session.userId ? res.redirect('/profil') : res.render('index'));
app.get('/login', (req, res) => res.render('index'));

app.post('/register', async (req, res) => {
    try {
        const { nickname, email, password } = req.body;
        const newUser = new User({ nickname, email, password, bpl: 2500, inventory: [] });
        await newUser.save();
        req.session.userId = newUser._id;
        res.redirect('/profil');
    } catch (err) { res.status(500).send("Hata: " + err.message); }
});

app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (user && user.password === password) {
            req.session.userId = user._id;
            return res.redirect('/profil');
        }
        res.send("Hatalı giriş.");
    } catch (err) { res.send("Bir hata oluştu."); }
});

app.get('/profil', isLoggedIn, async (req, res) => {
    const user = await User.findById(req.user._id);
    res.render('profil', { user });
});

app.get('/chat', isLoggedIn, (req, res) => res.render('chat', { user: req.user }));
app.get('/arena', isLoggedIn, (req, res) => res.render('arena', { user: req.user, opponentNick: req.query.opponent || null }));
app.get('/meeting', isLoggedIn, (req, res) => res.render('meeting', { user: req.user, roomId: req.query.room || "GENEL_KONSEY" }));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// --- 4. SOCKET.IO ANA BLOK (Tüm Mantık Burada) ---
io.on('connection', async (socket) => {
    const s = socket.request.session;
    if (s && s.userId) {
        const user = await User.findById(s.userId);
        if (user) {
            socket.userId = user._id;
            socket.nickname = user.nickname;
            socket.join(user.nickname);
            console.log(`✅ Bağlı: ${socket.nickname}`);
        }
    }

    // ODAYA KATILIM
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

    // MESAJLAŞMA (Döşemeyi Engelleyen Temiz Yapı)
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

    // DAVET & IŞINLANMA
    socket.on('send-invite', (data) => {
        const sharedRoomId = `KONSEY_${socket.nickname}_${Date.now().toString().slice(-4)}`;
        const link = `/${data.type}?room=${sharedRoomId}`;
        io.to(data.to).emit('receive-invite-request', { from: socket.nickname, roomId: sharedRoomId, type: data.type });
        socket.emit('redirect-to-room', link);
    });

    socket.on('accept-invite', (data) => {
        socket.emit('redirect-to-room', `/${data.type}?room=${data.roomId}`);
    });

    // ARENA READY SİNYALİ
    socket.on('arena-ready', async (data) => {
        const { mult, room, nick, animal } = data;
        const sender = await User.findById(socket.userId);
        if (!sender || sender.bpl < (25 * mult)) return socket.emit('error-msg', 'Yetersiz BPL!');
        
        sender.bpl -= (25 * mult);
        await sender.save();
        socket.emit('update-bpl', sender.bpl);

        const playerData = { id: socket.id, userId: sender._id, nick, animal, stats: { power: sender.power || 10, attack: sender.attack || 10, defense: sender.defense || 10 }, cost: 25 * mult };

        if (room) {
            socket.join(room);
            const clients = io.sockets.adapter.rooms.get(room);
            if (clients && clients.size === 2) startBattle(room, 25 * mult);
        } else {
            arenaQueue.push(playerData);
            if (arenaQueue.length >= 2) {
                const p1 = arenaQueue.shift(); const p2 = arenaQueue.shift();
                const aRoom = "arena_" + Date.now();
                const s1 = io.sockets.sockets.get(p1.id); const s2 = io.sockets.sockets.get(p2.id);
                if(s1) s1.join(aRoom); if(s2) s2.join(aRoom);
                startBattle(aRoom, p1.cost, [p1, p2]);
            } else {
                setTimeout(() => {
                    const idx = arenaQueue.findIndex(p => p.id === socket.id);
                    if (idx > -1) createBotMatch(arenaQueue.splice(idx, 1)[0]);
                }, 10000);
            }
        }
    });

    // AYRILMA
    socket.on('disconnect', () => {
        const rId = socket.roomId;
        if (rId && activeRooms[rId]) {
            activeRooms[rId].members = activeRooms[rId].members.filter(m => m.nickname !== socket.nickname);
            socket.to(rId).emit('user-disconnected', socket.peerId);
            updateAllLists(rId);
        }
        arenaQueue = arenaQueue.filter(p => p.id !== socket.id);
    });

    async function updateAllLists(roomId) {
        const allSockets = await io.fetchSockets();
        const globalOnline = allSockets.map(s => ({ nickname: s.nickname }));
        io.emit('update-user-list', globalOnline);
        if (roomId && activeRooms[roomId]) {
            io.to(roomId).emit('update-council-list', activeRooms[roomId].members.map(m => m.nickname));
        }
    }
});

// --- 5. SAVAŞ FONKSİYONLARI (DIŞARIDA) ---
async function startBattle(roomId, cost, players = null) {
    try {
        if (!players) {
            const sockets = await io.in(roomId).fetchSockets();
            players = [];
            for (const s of sockets) {
                const u = await User.findById(s.userId);
                if(u) players.push({ id: s.id, userId: u._id, nick: u.nickname, animal: u.inventory[0]?.name, stats: { p: 10, a: 10, d: 10 } });
            }
        }
        if (players.length < 2) return;
        const winner = players[0]; // Basit mantık, senin orijinal calc'ını buraya ekle
        const prize = Math.floor(cost * 1.8);
        const winnerUser = await User.findById(winner.userId);
        if (winnerUser) { winnerUser.bpl += prize; await winnerUser.save(); }
        io.to(roomId).emit('match-started', { players, winner: { nick: winner.nick }, prize });
    } catch (e) { console.log(e); }
}

async function createBotMatch(player) {
    const botData = { nick: botNames[0], animal: botAnimalsList[0], stats: { power: 10, attack: 10, defense: 10 }, userId: null };
    startBattle(player.id, player.cost, [player, botData]);
}

const PORT = process.env.PORT || 10000;
httpServer.listen(PORT, () => console.log(`🚀 BPL Online on ${PORT}`));
