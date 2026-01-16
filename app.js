require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo').default;
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

// BURASI EKSİKTİ:
const PORT = process.env.PORT || 10000;

// --- VERİTABANI BAĞLANTISI ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ BPL Veritabanı Aktif'))
    .catch(err => console.error('❌ DB Hatası:', err));

// --- AYARLAR ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(helmet({ contentSecurityPolicy: false })); 
app.use(mongoSanitize());

// --- SESSION YÖNETİMİ (v6 Kesin Çözüm) ---
app.use(session({
    secret: process.env.SESSION_SECRET || 'bpl_super_secret_2026',
    resave: false,
    saveUninitialized: false,
    store: new MongoStore({ 
        mongoUrl: process.env.MONGO_URI,
        collectionName: 'sessions',
        ttl: 14 * 24 * 60 * 60
    }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 } 
}));

// GİRİŞ KONTROLÜ
const isAuth = (req, res, next) => {
    if (req.session.user) return next();
    res.redirect('/');
};

// --- ROTALAR ---
app.get('/', (req, res) => {
    if (req.session.user) return res.redirect('/profil');
    res.render('index');
});

app.get('/profil', isAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.user._id);
        res.render('profil', { user });
    } catch (err) { res.redirect('/logout'); }
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


// --- YENİ KAYIT ROTASI ---
app.get('/register', (req, res) => {
    res.render('register'); // register.ejs dosyanın olduğunu varsayıyorum
});

app.post('/register', async (req, res) => {
    try {
        const { nickname, password } = req.body;
        const hashedPassword = await require('bcrypt').hash(password, 10);
        const newUser = new User({ 
            nickname, 
            password: hashedPassword, 
            bpl: 2500, 
            selectedAnimal: 'none' 
        });
        await newUser.save();
        res.redirect('/');
    } catch (err) {
        res.status(500).send("Kayıt sırasında hata oluştu: " + err.message);
    }
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

    socket.on('disconnect', () => {
        if (socket.nickname) {
            onlineUsers.delete(socket.nickname);
            io.emit('online-list', Array.from(onlineUsers.keys()));
        }
    });
});

// SUNUCUYU BAŞLAT
server.listen(PORT, () => {
    console.log(`🚀 BPL Sistemi Aktif: http://localhost:${PORT}`);
});



