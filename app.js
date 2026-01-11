/**
 * BPL ULTIMATE - FINAL FULL SYSTEM (FIXED LIMITS & EJS ERRORS)
 */
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo').default; 
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');

const User = require('./models/User');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// --- GLOBAL DEĞİŞKENLER (TEK SEFER TANIMLANIR) ---
const onlineUsers = new Map();
let arenaQueue = [];
let chatHistory = [];
const BOTS = ['Lion', 'Kurd', 'Peregrinefalcon', 'Rhino'];

function addToHistory(sender, text) {
    const msg = { sender, text, time: Date.now() };
    chatHistory.push(msg);
    if (chatHistory.length > 50) chatHistory.shift();
}

// --- 1. VERİTABANI VE SESSION ---
const MONGO_URI = process.env.MONGO_URI;
const SESSION_SECRET = process.env.SESSION_SECRET || 'bpl_ultimate_megasecret_2024';

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Bağlantısı Başarılı'))
    .catch(err => console.error('❌ MongoDB Hatası:', err));

app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionMiddleware = session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: MONGO_URI, ttl: 24 * 60 * 60 }),
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
});
app.use(sessionMiddleware);

io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
});

// --- 2. KULLANICI KONTROLÜ ---
app.use(async (req, res, next) => {
    res.locals.user = null;
    if (req.session && req.session.userId) {
        try {
            const user = await User.findById(req.session.userId);
            if (user) res.locals.user = user;
        } catch (e) { console.error("Session Hatası:", e); }
    }
    next();
});

const authRequired = (req, res, next) => {
    if (req.session && req.session.userId) return next();
    res.redirect('/');
};

// --- 3. ANA ROTALAR ---
app.get('/', (req, res) => {
    if (req.session.userId) return res.redirect('/profil');
    res.render('index', { title: 'BPL Ultimate' });
});

app.post('/register', async (req, res) => {
    const { nickname, email, password } = req.body;
    try {
        const existing = await User.findOne({ $or: [{ email: email.toLowerCase() }, { nickname: nickname.trim() }] });
        if (existing) return res.status(400).send("Bu bilgiler kullanımda.");

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({
            nickname: nickname.trim(),
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            bpl: 2500,
            inventory: [],
            selectedAnimal: "none"
        });

        const savedUser = await newUser.save();
        req.session.userId = savedUser._id;
        res.redirect('/profil');
    } catch (err) { res.status(500).send("Kayıt hatası."); }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email: email.toLowerCase().trim() });
        if (user && await bcrypt.compare(password, user.password)) {
            req.session.userId = user._id;
            return res.redirect('/profil');
        }
        res.status(401).send("Hatalı giriş bilgileri.");
    } catch (err) { res.status(500).send("Giriş hatası."); }
});

// --- 4. SAYFA YÖNETİMİ ---
app.get('/profil', authRequired, (req, res) => res.render('profil'));
app.get('/market', authRequired, (req, res) => res.render('market'));
app.get('/arena', authRequired, (req, res) => res.render('arena'));
app.get('/development', authRequired, (req, res) => res.render('development'));
app.get('/meeting', authRequired, (req, res) => res.render('meeting'));
app.get('/chat', authRequired, (req, res) => res.render('chat'));
app.get('/wallet', authRequired, (req, res) => res.render('wallet', { bpl: res.locals.user.bpl || 0 }));

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- 5. MARKET VE GELİŞTİRME API ---
app.post('/api/buy-item', authRequired, async (req, res) => {
    const { itemName, price } = req.body;
    try {
        const user = await User.findById(req.session.userId);
        if ((user.bpl - price) < 25) { 
            return res.status(400).json({ success: false, error: 'Limit Engeli: Bakiyeniz 25 BPL altına düşemez!' });
        }
        user.bpl -= price;
        user.inventory.push({
            name: itemName,
            img: `/caracter/profile/${itemName}.jpg`,
            stamina: 100, hp: 100, maxHp: 100, atk: 50, def: 30, level: 1
        });
        await user.save();
        res.json({ success: true, newBpl: user.bpl });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/api/select-animal', authRequired, async (req, res) => {
    try {
        const { animalName } = req.body;
        const user = await User.findById(req.session.userId);
        if (!user) return res.json({ success: false, error: 'Kullanıcı bulunamadı.' });
        const hasAnimal = user.inventory.some(i => i.name === animalName);
        if (!hasAnimal) return res.json({ success: false, error: 'Bu hayvana sahip değilsiniz.' });
        user.selectedAnimal = animalName;
        await user.save();
        res.json({ success: true });
    } catch (err) { res.json({ success: false, error: 'Sunucu hatası.' }); }
});

// --- ARENA SAVAŞ MOTORU ---
async function startBattle(p1, p2, io) {
    let winner;
    const isP1Bot = !p1.socketId;
    const isP2Bot = !p2.socketId;

    if (isP1Bot || isP2Bot) {
        const botWon = Math.random() < 0.55; 
        winner = isP2Bot ? (botWon ? p2 : p1) : (botWon ? p1 : p2);
    } else {
        winner = p1.power >= p2.power ? p1 : p2;
    }

    if (winner.socketId) {
        try {
            const winUser = await User.findOne({ nickname: winner.nickname });
            if (winUser) {
                winUser.bpl += p1.prize;
                await winUser.save();
                io.to(winner.socketId).emit('update-bpl', winUser.bpl);
            }
        } catch (err) { console.error("Ödül Hatası:", err); }
    }

    const matchData = (p, opp) => ({
        opponent: opp.nickname,
        opponentAnimal: opp.animal, 
        winnerNick: winner.nickname,
        winnerAnimal: winner.animal, 
        prize: p.prize
    });

    if (p1.socketId) io.to(p1.socketId).emit('arena-match-found', matchData(p1, p2));
    if (p2.socketId) io.to(p2.socketId).emit('arena-match-found', matchData(p2, p1));
}

// --- 6. SOCKET.IO (TEK BİR CONNECTION BLOĞU) ---
io.on('connection', async (socket) => {
    const uId = socket.request.session?.userId;
    if (!uId) return;

    const user = await User.findById(uId);
    if (!user) return;

    socket.userId = uId;
    socket.nickname = user.nickname;
    onlineUsers.set(user.nickname, socket.id);

    socket.join("general-chat");

    const broadcastOnlineList = () => {
        const usersArray = Array.from(onlineUsers.keys()).map(nick => ({ nickname: nick }));
        io.to("general-chat").emit('update-online-users', usersArray);
    };
    broadcastOnlineList();

    socket.emit('load-history', chatHistory);

    socket.on('chat-message', (data) => {
        addToHistory(socket.nickname, data.text);
        io.to("general-chat").emit('new-message', { sender: socket.nickname, text: data.text });
    });

    // Meeting Olayları
    socket.on('join-meeting', (data) => {
        const { roomId, peerId, nickname } = data;
        socket.join(roomId);
        socket.emit('update-bpl', user.bpl);
        io.to(roomId).emit('room-info', { owner: roomId });
        socket.to(roomId).emit('user-connected', { peerId, nickname });
    });

    socket.on('send-meeting-invite', (data) => {
        const targetSocketId = onlineUsers.get(data.target);
        if (targetSocketId) io.to(targetSocketId).emit('meeting-invite-received', { from: socket.nickname });
    });

    // Hediye Sistemi
    socket.on('send-gift-bpl', async (data) => {
        const { to, amount } = data;
        const amt = parseInt(amount);
        if (amt < 10) return socket.emit('error', 'Minimum 10 BPL.');
        const sender = await User.findById(socket.userId);
        const receiver = await User.findOne({ nickname: to });

        if (sender && receiver && sender.bpl >= amt) {
            const netAmount = Math.floor(amt * 0.70);
            sender.bpl -= amt;
            receiver.bpl += netAmount;
            await sender.save(); await receiver.save();
            socket.emit('update-bpl', sender.bpl);
            const rSId = onlineUsers.get(to);
            if (rSId) io.to(rSId).emit('update-bpl', receiver.bpl);
            io.to("general-chat").emit('new-message', { sender: 'SİSTEM', text: `🎁 ${sender.nickname}, ${receiver.nickname}'e ${amt} BPL gönderdi!` });
        }
    });

    // ARENA SİSTEMİ
    socket.on('arena-invite-accept', async (data) => {
        try {
            const u1 = await User.findOne({ nickname: socket.nickname });
            const u2 = await User.findOne({ nickname: data.from });
            const s2Id = onlineUsers.get(data.from);
            if (u1 && u2 && s2Id) {
                if (u1.bpl < 25 || u2.bpl < 25) return socket.emit('error', 'Bakiize yetersiz!');
                u1.bpl -= 25; u2.bpl -= 25;
                await u1.save(); await u2.save();
                socket.emit('update-bpl', u1.bpl);
                io.to(s2Id).emit('update-bpl', u2.bpl);
                startBattle(
                    { nickname: u1.nickname, socketId: socket.id, animal: u1.selectedAnimal || 'Lion', power: Math.random()*100, prize: 50 },
                    { nickname: u2.nickname, socketId: s2Id, animal: u2.selectedAnimal || 'Lion', power: Math.random()*100, prize: 50 },
                    io
                );
            }
        } catch (e) { console.log(e); }
    });

    socket.on('arena-join-queue', async (data) => {
        try {
            const u = await User.findById(socket.userId);
            if (!u || u.bpl < data.bet) return socket.emit('error', 'Yetersiz bakiye!');
            u.bpl -= data.bet; await u.save();
            socket.emit('update-bpl', u.bpl);
            const player = { nickname: u.nickname, socketId: socket.id, animal: u.selectedAnimal || 'Lion', power: Math.random()*100, prize: data.prize };
            
            if (arenaQueue.length > 0) {
                startBattle(player, arenaQueue.shift(), io);
            } else {
                arenaQueue.push(player);
                setTimeout(() => {
                    const idx = arenaQueue.findIndex(p => p.socketId === socket.id);
                    if (idx !== -1) {
                        const p = arenaQueue.splice(idx, 1)[0];
                        const bName = BOTS[Math.floor(Math.random() * BOTS.length)];
                        startBattle(p, { nickname: bName + "_Bot", socketId: null, animal: bName, power: Math.random()*100, prize: data.prize }, io);
                    }
                }, 10000);
            }
        } catch (e) { console.log(e); }
    });

    socket.on('disconnect', () => {
        onlineUsers.delete(socket.nickname);
        arenaQueue = arenaQueue.filter(p => p.socketId !== socket.id);
        broadcastOnlineList();
    });
});

// --- SERVER BAŞLATMA ---
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 SİSTEM AKTİF: ${PORT}`));
