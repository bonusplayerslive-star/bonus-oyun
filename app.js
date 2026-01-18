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
    secret: 'bpl_cyber_secret_2025',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ 
        mongoUrl: MONGO_URI,
        collectionName: 'sessions' 
    }),
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

// --- 3. ROTALAR (Giriş, Kayıt, Market, Arena, Chat) ---
app.get('/', (req, res) => req.session.userId ? res.redirect('/profil') : res.render('index'));
app.get('/login', (req, res) => res.render('index'));

app.post('/register', async (req, res) => {
    try {
        const { nickname, email, password } = req.body;
        const newUser = new User({ nickname, email, password, bpl: 2500, inventory: [] });
        await newUser.save();
        req.session.userId = newUser._id;
        res.redirect('/profil');
    } catch (err) { res.status(500).send("Kayıt Hatası: " + err.message); }
});

app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (user && user.password === password) {
            req.session.userId = user._id;
            return res.redirect('/profil');
        }
        res.send("<script>alert('Hatalı Giriş!'); window.location='/';</script>");
    } catch (err) { res.send("Hata oluştu."); }
});

app.get('/profil', isLoggedIn, async (req, res) => {
    const user = await User.findById(req.user._id);
    res.render('profil', { user });
});

app.get('/market', isLoggedIn, (req, res) => res.render('market', { user: req.user }));
app.get('/chat', isLoggedIn, (req, res) => res.render('chat', { user: req.user }));
app.get('/arena', isLoggedIn, (req, res) => res.render('arena', { user: req.user, opponentNick: req.query.opponent || null }));
app.get('/meeting', isLoggedIn, (req, res) => res.render('meeting', { user: req.user, roomId: req.query.room || "GENEL_KONSEY" }));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// --- 4. SOCKET.IO (TEK VE ANA BLOK) ---
io.on('connection', async (socket) => {
    const s = socket.request.session;
    if (s && s.userId) {
        const user = await User.findById(s.userId);
        if (user) {
            socket.userId = user._id;
            socket.nickname = user.nickname;
            socket.join(user.nickname);
            console.log(`📡 Bağlantı: ${socket.nickname}`);
        }
    }

    // Odalar ve Toplantılar
    socket.on('join-meeting', (roomId, peerId, nickname) => {
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

    // Mesajlaşma (Döşeme yapmayan temiz mantık)
    socket.on('chat-message', (data) => {
        if (!data.text) return;
        const msg = {
            sender: socket.nickname || "Misafir",
            text: data.text.trim(),
            time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
            room: data.room || 'GENEL'
        };
        if (msg.room !== 'GENEL') io.to(msg.room).emit('new-message', msg);
        else io.emit('new-message', msg);
    });

    // Davet Sistemi
    socket.on('send-invite', (data) => {
        const rId = `KONSEY_${Date.now().toString().slice(-4)}`;
        io.to(data.to).emit('receive-invite-request', { from: socket.nickname, roomId: rId, type: data.type });
        socket.emit('redirect-to-room', `/${data.type}?room=${rId}`);
    });

    // BPL Transferi
    socket.on('transfer-bpl', async (data) => {
        try {
            const sender = await User.findById(socket.userId);
            const receiver = await User.findOne({ nickname: data.to });
            const amount = parseInt(data.amount);
            if (receiver && sender.bpl >= (amount + 5500)) {
                sender.bpl -= amount;
                receiver.bpl += Math.floor(amount * 0.75);
                await sender.save(); await receiver.save();
                socket.emit('update-bpl', sender.bpl);
                io.to(receiver.nickname).emit('update-bpl', receiver.bpl);
            }
        } catch (e) { console.log("Transfer Hatası"); }
    });

    // ARENA MOTORU (Senin orijinal kuyruk mantığın)
    socket.on('arena-ready', async (data) => {
        const { mult, room, nick, animal } = data;
        const sender = await User.findById(socket.userId);
        const fee = 25 * (mult || 1);
        
        if (!sender || sender.bpl < fee) return socket.emit('error-msg', 'Yetersiz BPL!');

        sender.bpl -= fee; await sender.save();
        socket.emit('update-bpl', sender.bpl);

        const playerData = { id: socket.id, userId: sender._id, nick, animal, cost: fee };

        if (room) {
            socket.join(room);
            const clients = io.sockets.adapter.rooms.get(room);
            if (clients && clients.size === 2) startBattle(room, fee);
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
                }, 8000);
            }
        }
    });

    socket.on('disconnect', () => {
        if (socket.roomId && activeRooms[socket.roomId]) {
            activeRooms[socket.roomId].members = activeRooms[socket.roomId].members.filter(m => m.nickname !== socket.nickname);
            updateAllLists(socket.roomId);
        }
        arenaQueue = arenaQueue.filter(p => p.id !== socket.id);
    });

    async function updateAllLists(rId) {
        const all = await io.fetchSockets();
        io.emit('update-user-list', all.map(s => ({ nickname: s.nickname })));
        if (rId && activeRooms[rId]) {
            io.to(rId).emit('update-council-list', activeRooms[rId].members.map(m => m.nickname));
        }
    }
});

// --- 5. SAVAŞ FONKSİYONLARI ---
async function startBattle(roomId, cost, players = null) {
    try {
        if (!players) {
            const sockets = await io.in(roomId).fetchSockets();
            players = [];
            for (const s of sockets) {
                const u = await User.findById(s.userId);
                if(u) players.push({ id: s.id, userId: u._id, nick: u.nickname, animal: u.inventory[0]?.name || "Wolf" });
            }
        }
        if (players.length < 2) return;
        
        const winner = players[0]; // Basit örnek, senin güç hesaplamanı buraya koyabilirsin
        const prize = Math.floor(cost * 1.8);
        const winUser = await User.findById(winner.userId);
        if (winUser) { winUser.bpl += prize; await winUser.save(); }

        io.to(roomId).emit('match-started', { players, winner: { nick: winner.nick, animal: winner.animal }, prize });
    } catch (e) { console.log(e); }
}

async function createBotMatch(p) {
    const bot = { nick: botNames[0], animal: botAnimalsList[0], userId: null };
    startBattle(p.id, p.cost, [p, bot]);
}

// --- 6. SERVER START ---
const PORT = process.env.PORT || 10000;
httpServer.listen(PORT, () => console.log(`🌍 BPL Sunucu Hazır: ${PORT}`));


