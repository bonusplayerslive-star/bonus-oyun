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
// Modeller (Yolun doğruluğundan emin ol)
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

// Auth Kontrolü
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

app.post('/register', async (req, res) => {
    try {
        const { nickname, password } = req.body;
        
        // Şifreyi 10 tur şifrele
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const newUser = new User({ 
            nickname, 
            password: hashedPassword, // Şifrelenmiş hali kaydet
            bpl: 1000,
            selectedAnimal: 'none'
        });
        
        await newUser.save();
        res.redirect('/');
    } catch (err) {
        res.send("Kayıt sırasında hata oluştu.");
    }
});



// --- GİRİŞ YAP (LOGIN) ---
app.post('/login', async (req, res) => {
    try {
        const { nickname, password } = req.body;
        // Önce kullanıcıyı sadece nickname ile bul
        const user = await User.findOne({ nickname });

        if (user) {
            // MongoDB'deki şifrelenmiş kod ile kullanıcının yazdığı şifreyi karşılaştır
            const isMatch = await bcrypt.compare(password, user.password);
            
            if (isMatch) {
                req.session.user = user;
                return res.redirect('/profil');
            }
        }
        
        // Eğer kullanıcı yoksa veya şifre eşleşmiyorsa
        res.send("Hatalı kullanıcı adı veya şifre!");
        
    } catch (err) {
        console.error("Login Hatası:", err);
        res.status(500).send("Sunucu hatası!");
    }
});

// --- ÇIKIŞ YAP (LOGOUT) ---
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

















// --- SOCKET LOGIC (TÜM SİSTEM) ---
const onlineUsers = new Map(); // Nickname -> SocketID

io.on('connection', (socket) => {
    console.log('Yeni Bağlantı:', socket.id);

    socket.on('update-online-status', (data) => {
        socket.nickname = data.nickname;
        onlineUsers.set(data.nickname, socket.id);
        io.emit('online-list', Array.from(onlineUsers.keys()));
    });

    // 1. Chat Mesajlaşma
    socket.on('chat-message', (data) => {
        io.emit('new-chat-message', data);
    });

    // 2. Hediye Sistemi (%30 Kesinti)
    socket.on('send-gift', async (data) => {
        const sender = await User.findOne({ nickname: socket.nickname });
        if (sender && sender.bpl >= 5500) {
            const netAmount = Math.floor(data.amount * 0.7);
            await User.findOneAndUpdate({ nickname: data.receiver }, { $inc: { bpl: netAmount } });
            await User.findOneAndUpdate({ nickname: socket.nickname }, { $inc: { bpl: -data.amount } });

            if (onlineUsers.has(data.receiver)) {
                io.to(onlineUsers.get(data.receiver)).emit('gift-received', { from: socket.nickname, amount: netAmount });
                const updatedTarget = await User.findOne({ nickname: data.receiver });
                io.to(onlineUsers.get(data.receiver)).emit('update-balance', updatedTarget.bpl);
            }
            socket.emit('update-balance', sender.bpl - data.amount);
        }
    });

    // 3. Meeting ve Arena Davet
    socket.on('create-meeting', async () => {
        const user = await User.findOne({ nickname: socket.nickname });
        if (user && user.bpl >= 50) {
            await User.findOneAndUpdate({ nickname: socket.nickname }, { $inc: { bpl: -50 } });
            socket.emit('meeting-created', { roomId: `room_${socket.nickname}` });
            socket.emit('update-balance', user.bpl - 50);
        }
    });

    socket.on('invite-to-arena', (target) => {
        if (onlineUsers.has(target)) {
            io.to(onlineUsers.get(target)).emit('arena-invitation', { 
                from: socket.nickname, 
                roomId: `arena_${socket.nickname}` 
            });
        }
    });

    socket.on('disconnect', () => {
        if (socket.nickname) {
            onlineUsers.delete(socket.nickname);
            io.emit('online-list', Array.from(onlineUsers.keys()));
        }
    });
});

// SERVER BAŞLATMA
server.listen(PORT, () => {
    console.log(`🚀 BPL Sistemi Aktif: http://localhost:${PORT}`);
});





