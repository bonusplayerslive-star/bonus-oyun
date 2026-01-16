require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const bcrypt = require('bcrypt');
const User = require('./models/User'); 

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 10000;

// --- VERİTABANI BAĞLANTISI ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ BPL Veritabanı Aktif'))
    .catch(err => console.error('❌ DB Hatası:', err));

// --- GÜVENLİK VE AYARLAR ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(helmet({ contentSecurityPolicy: false })); 
app.use(mongoSanitize());

// --- SESSION YÖNETİMİ ---
app.use(session({
    secret: process.env.SESSION_SECRET || 'bpl_super_secret_2026',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 } // 24 Saat
}));

const isAuth = (req, res, next) => {
    if (req.session.user) return next();
    res.redirect('/');
};

// --- ROTALAR (ROUTES) ---
app.get('/', (req, res) => {
    if (req.session.user) return res.redirect('/profil');
    res.render('index');
});

app.get('/profil', isAuth, async (req, res) => {
    const user = await User.findById(req.session.user._id);
    res.render('profil', { user });
});

app.get('/chat', isAuth, async (req, res) => {
    const user = await User.findById(req.session.user._id);
    res.render('chat', { user });
});

app.get('/arena', isAuth, async (req, res) => {
    const user = await User.findById(req.session.user._id);
    res.render('arena', { user });
});

app.get('/meeting', isAuth, async (req, res) => {
    const user = await User.findById(req.session.user._id);
    res.render('meeting', { user, role: req.query.role || 'guest' });
});

// --- KAYIT & GİRİŞ ---
app.post('/register', async (req, res) => {
    try {
        const { nickname, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ 
            nickname, 
            password: hashedPassword,
            bpl: 1000,
            selectedAnimal: 'none'
        });
        await newUser.save();
        res.redirect('/');
    } catch (err) { res.send("Kayıt hatası veya kullanıcı adı dolu."); }
});

app.post('/login', async (req, res) => {
    try {
        const { nickname, password } = req.body;
        const user = await User.findOne({ nickname });
        if (user && await bcrypt.compare(password, user.password)) {
            req.session.user = user;
            return res.redirect('/profil');
        }
        res.send("Hatalı kullanıcı adı veya şifre!");
    } catch (err) { res.status(500).send("Sunucu hatası!"); }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- SOCKET LOGIC ---
const onlineUsers = new Map();

io.on('connection', (socket) => {
    socket.on('update-online-status', (data) => {
        socket.nickname = data.nickname;
        onlineUsers.set(data.nickname, socket.id);
        io.emit('online-list', Array.from(onlineUsers.keys()));
    });

    socket.on('chat-message', (data) => {
        io.emit('new-chat-message', { from: socket.nickname, msg: data.msg });
    });

    // Hediye Sistemi
    socket.on('send-gift', async (data) => {
        const sender = await User.findOne({ nickname: socket.nickname });
        if (sender && sender.bpl >= data.amount && data.amount >= 5500) {
            const netAmount = Math.floor(data.amount * 0.7);
            await User.findOneAndUpdate({ nickname: data.receiver }, { $inc: { bpl: netAmount } });
            const updatedSender = await User.findOneAndUpdate({ nickname: socket.nickname }, { $inc: { bpl: -data.amount } }, { new: true });

            if (onlineUsers.has(data.receiver)) {
                io.to(onlineUsers.get(data.receiver)).emit('gift-received', { from: socket.nickname, amount: netAmount });
                const target = await User.findOne({ nickname: data.receiver });
                io.to(onlineUsers.get(data.receiver)).emit('update-balance', target.bpl);
            }
            socket.emit('update-balance', updatedSender.bpl);
        } else {
            socket.emit('error-msg', 'Yetersiz bakiye veya geçersiz tutar.');
        }
    });

    // Arena & Meeting
    socket.on('invite-to-arena', (target) => {
        if (onlineUsers.has(target)) {
            io.to(onlineUsers.get(target)).emit('arena-invitation', { from: socket.nickname });
        }
    });

    socket.on('create-meeting', async () => {
        const user = await User.findOne({ nickname: socket.nickname });
        if (user && user.bpl >= 50) {
            const updated = await User.findOneAndUpdate({ nickname: socket.nickname }, { $inc: { bpl: -50 } }, { new: true });
            socket.emit('meeting-created', { roomId: `room_${socket.nickname}` });
            socket.emit('update-balance', updated.bpl);
        } else {
            socket.emit('error-msg', 'Oda açmak için 50 BPL gerekli.');
        }
    });

    socket.on('disconnect', () => {
        if (socket.nickname) {
            onlineUsers.delete(socket.nickname);
            io.emit('online-list', Array.from(onlineUsers.keys()));
        }
    });
});

server.listen(PORT, () => {
    console.log(`🚀 BPL Sistemi Aktif: http://localhost:${PORT}`);
});
