require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');
const User = require('./models/User');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 10000;
const onlineUsers = new Map();

// Veritabanı Bağlantısı
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ BPL ULTIMATE: Bağlantı Başarılı'))
    .catch(err => console.error('❌ MongoDB Hatası:', err));

app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'bpl_gizli_2025',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
});

app.use(sessionMiddleware);
io.use((socket, next) => sessionMiddleware(socket.request, {}, next));

// Kullanıcı Middleware
app.use(async (req, res, next) => {
    res.locals.user = null;
    if (req.session.userId) {
        const user = await User.findById(req.session.userId);
        if (user) res.locals.user = user;
    }
    next();
});

const authRequired = (req, res, next) => {
    if (req.session.userId) return next();
    res.redirect('/');
};

// --- ROTALAR ---
app.get('/', (req, res) => req.session.userId ? res.redirect('/chat') : res.render('index'));
app.post('/register', async (req, res) => {
    const { nickname, email, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({
            nickname: nickname.trim(),
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            bpl: 2500 // Başlangıç Bonusu
        });
        await newUser.save();
        req.session.userId = newUser._id;
        res.redirect('/chat');
    } catch (err) { res.status(400).send("Kayıt hatası!"); }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (user && await bcrypt.compare(password, user.password)) {
        req.session.userId = user._id;
        return res.redirect('/chat');
    }
    res.status(401).send("Hatalı giriş!");
});

app.get('/chat', authRequired, (req, res) => res.render('chat'));
app.get('/arena', authRequired, (req, res) => res.render('arena'));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });



// SATIN ALMA API'Sİ
app.post('/api/buy-item', authRequired, async (req, res) => {
    const { itemName, price } = req.body;
    try {
        const user = await User.findById(req.session.userId);
        
        if (user.bpl < price) return res.json({ success: false, error: "Bakiye yetersiz!" });
        if (user.inventory.length >= 3) return res.json({ success: false, error: "Envanter dolu (Maks 3)!" });

        // Hayvanı envantere ekle
        user.inventory.push({
            name: itemName,
            hp: 100, maxHp: 100,
            level: 1,
            stamina: 100
        });

        user.bpl -= price;
        await user.save();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: "İşlem sırasında hata oluştu." });
    }
});

// MEETING SOCKET MANTIĞI
io.on('connection', (socket) => {
    socket.on('join-meeting', ({ roomId, peerId, nickname }) => {
        socket.join(roomId);
        socket.to(roomId).emit('user-connected', { peerId, nickname });

        socket.on('disconnect', () => {
            socket.to(roomId).emit('user-disconnected', peerId);
        });
    });
});



// HAYVAN SEÇİM API'Sİ
app.post('/api/select-animal', authRequired, async (req, res) => {
    const { animalName } = req.body;
    try {
        const user = await User.findById(req.session.userId);
        
        // Envanterde bu hayvan var mı kontrolü
        const hasAnimal = user.inventory.some(item => item.name === animalName);
        
        if (hasAnimal) {
            user.selectedAnimal = animalName;
            await user.save();
            return res.json({ success: true });
        } else {
            return res.json({ success: false, error: "Bu varlık envanterinizde bulunmuyor." });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: "Sunucu hatası." });
    }
});




// --- SOCKET.IO ---
io.on('connection', async (socket) => {
    const uId = socket.request.session?.userId;
    if (!uId) return;
    const user = await User.findById(uId);
    if (!user) return;

    socket.userId = uId;
    socket.nickname = user.nickname;
    onlineUsers.set(user.nickname, socket.id);
    io.emit('online-list', Array.from(onlineUsers.keys()));

    socket.on('chat-message', (data) => {
        io.emit('new-chat-message', { sender: socket.nickname, text: data.text });
    });

    socket.on('invite-to-arena', (target) => {
        const targetSid = onlineUsers.get(target);
        if (targetSid) io.to(targetSid).emit('arena-invitation', { from: socket.nickname, roomId: `Arena-${socket.id}` });
    });

    socket.on('disconnect', () => {
        onlineUsers.delete(socket.nickname);
        io.emit('online-list', Array.from(onlineUsers.keys()));
    });
});

server.listen(PORT, () => console.log(`🚀 BPL ULTIMATE AKTİF: ${PORT}`));


