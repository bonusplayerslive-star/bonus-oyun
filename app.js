// Path: app.js

// --- 1. MODÜLLER ---
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
        secure: false, // HTTPS kullanıyorsanız true yapın
        maxAge: 1000 * 60 * 60 * 24 
    }
});

app.use(sessionMiddleware);
io.engine.use(sessionMiddleware); // Socket.io'nun session'a erişmesini sağlar

// Güvenlik Kapısı (Middleware)
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

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

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

    // --- GENEL CHAT ---
    socket.on('chat-message', (data) => {
        io.emit('new-message', {
            sender: socket.nickname || "Bilinmeyen",
            text: data.text,
            time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
        });
    });

    // --- VIP KONSEY (MEETING) SİSTEMİ ---
    socket.on('join-meeting', (data) => {
        const roomId = data.roomId || "GENEL_KONSEY";
        socket.join(roomId);
        socket.currentRoom = roomId;
        socket.peerId = data.peerId; // WebRTC için Peer ID sakla
        
        // Diğer üyelere yeni birinin katıldığını bildir
        socket.to(roomId).emit('user-connected', { 
            nickname: socket.nickname, 
            id: socket.id,
            peerId: data.peerId 
        });
    });

    socket.on('send-meeting-message', (data) => {
        const room = socket.currentRoom || "GENEL_KONSEY";
        io.to(room).emit('new-meeting-message', {
            sender: socket.nickname,
            text: data.text
        });
    });

    // --- VIP HEDİYE SİSTEMİ (5500 SINIRI) ---
    socket.on('send-gift-vip', async (data) => {
        try {
            const { targetNick, amount, room } = data;
            const sender = await User.findById(socket.userId);
            const receiver = await User.findOne({ nickname: targetNick });

            if (!receiver || sender.nickname === targetNick) return;
            
            // Limit Kontrolü
            if (sender.bpl - amount < 5500) {
                return socket.emit('new-message', { sender: "SİSTEM", text: "❌ İşlem başarısız: Bakiyeniz 5500 BPL altına düşemez!" });
            }

            sender.bpl -= amount;
            receiver.bpl += (amount * 0.9); // %10 Komisyon
            await sender.save(); await receiver.save();

            // Bakiyeleri anlık güncelle (Sadece ilgili iki kişiye)
            socket.emit('update-bpl', sender.bpl);
            
            // Eğer alıcı o an online ise onun bakiyesini de güncelle
            const receiverSocket = Array.from(io.sockets.sockets.values()).find(s => s.nickname === targetNick);
            if (receiverSocket) {
                receiverSocket.emit('update-bpl', receiver.bpl);
            }

            io.to(room || "GENEL_KONSEY").emit('new-message', {
                sender: "SİSTEM",
                text: `🎁 ${sender.nickname}, ${receiver.nickname} kullanıcısına ${amount} BPL lojistik destek sağladı!`
            });
        } catch (err) { console.error(err); }
    });

    // --- DÜELLO & CHALLENGE ---
    socket.on('send-challenge', async (data) => {
        const sender = await User.findById(socket.userId);
        if (sender && sender.bpl >= 5505) { 
            sender.bpl -= 5; await sender.save();
            const challengeRoom = `arena_${Date.now()}`;
            io.emit('challenge-received', { 
                from: socket.nickname, 
                target: data.target, 
                room: challengeRoom 
            });
            socket.emit('update-bpl', sender.bpl);
        }
    });

    // --- ARENA / BOT BATTLE ---
    socket.on('start-bot-battle', async (data) => {
        try {
            const user = await User.findById(socket.userId);
            const isWin = Math.random() > 0.6;
            const prize = isWin ? (50 * (data.multiplier || 1)) : -25;
            
            if(user) {
                user.bpl += prize;
                await user.save();
                socket.emit('update-bpl', user.bpl);
            }

            socket.emit('battle-result', {
                isWin,
                opponentName: "Cyber_Bot_Alpha",
                opponentAnimal: "Lion",
                prize: isWin ? prize : 25
            });
        } catch (e) { console.log(e); }
    });

    socket.on('disconnect', () => {
        if (socket.currentRoom) {
            socket.to(socket.currentRoom).emit('user-disconnected', socket.peerId);
        }
        arenaWaitingPool = arenaWaitingPool.filter(s => s.id !== socket.id);
    });
});

// --- 6. BAŞLAT ---
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`🌍 Bonus Players Live Yayında: http://localhost:${PORT}`));

