require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const path = require('path');
const http = require('http'); // 1. Önce kütüphaneleri çağır
const socketIo = require('socket.io');
const User = require('./models/User'); 

const app = express(); // 2. App'i oluştur
const server = http.createServer(app); // 3. Server'ı oluştur
const io = socketIo(server); // 4. IO'yu tanımla (Hatanın çözümü burası)

const PORT = process.env.PORT || 10000;

// --- Veritabanı ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Veritabanı Hazır'))
    .catch(err => console.error('❌ DB Hatası:', err));

// --- VERİTABANI ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ BPL Veritabanına Bağlanıldı'))
    .catch(err => console.error('❌ DB Hatası:', err));

// --- SETTINGS & MIDDLEWARE ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(helmet({ contentSecurityPolicy: false })); 
app.use(mongoSanitize());

app.use(session({
    secret: process.env.SESSION_SECRET || 'bpl_secret_2025',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
    cookie: { 
        maxAge: 1000 * 60 * 60 * 24,
        secure: false // HTTPS kullanmıyorsanız false kalmalı
    }
}));

const isAuth = (req, res, next) => {
    if (req.session.user) return next();
    res.redirect('/');
};

// --- ROUTES ---
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

// --- SOCKET LOGIC (Online/Hediye/Meeting/Arena) ---
const onlineUsers = new Map(); // Nickname -> SocketId

io.on('connection', (socket) => {
    
    socket.on('update-online-status', (data) => {
        socket.nickname = data.nickname;
        onlineUsers.set(data.nickname, socket.id);
        io.emit('online-list', Array.from(onlineUsers.keys()));
    });

    // 1. Hediye Sistemi (%30 Kesinti)
    socket.on('send-gift', async (data) => {
        const sender = await User.findOne({ nickname: socket.nickname });
        const receiver = await User.findOne({ nickname: data.receiver });

        if (sender && sender.bpl >= 5500 && data.amount > 0) {
            const netAmount = Math.floor(data.amount * 0.7); 
            
            await User.findOneAndUpdate({ nickname: socket.nickname }, { $inc: { bpl: -data.amount } });
            await User.findOneAndUpdate({ nickname: data.receiver }, { $inc: { bpl: netAmount } });

            // Alıcıya bildirim
            if (onlineUsers.has(data.receiver)) {
                io.to(onlineUsers.get(data.receiver)).emit('gift-received', { 
                    from: socket.nickname, 
                    amount: netAmount 
                });
                // Bakiyeyi anlık güncellemesi için tetik gönder
                const updatedReceiver = await User.findOne({ nickname: data.receiver });
                io.to(onlineUsers.get(data.receiver)).emit('update-balance', updatedReceiver.bpl);
            }
            // Gönderene yeni bakiyesini yolla
            socket.emit('update-balance', sender.bpl - data.amount);
        }
    });

    // 2. Meeting Sistemi (Oda Açma 50 BPL)
    socket.on('create-meeting', async () => {
        const user = await User.findOne({ nickname: socket.nickname });
        if (user && user.bpl >= 50) {
            await User.findOneAndUpdate({ nickname: socket.nickname }, { $inc: { bpl: -50 } });
            const roomId = `room_${socket.nickname}`;
            socket.emit('meeting-created', { roomId });
            socket.emit('update-balance', user.bpl - 50);
        } else {
            socket.emit('error-msg', 'Yetersiz bakiye (50 BPL gerekli)');
        }
    });

    // 3. Arena Davet Sistemi
    socket.on('invite-to-arena', (targetNickname) => {
        if (onlineUsers.has(targetNickname)) {
            io.to(onlineUsers.get(targetNickname)).emit('arena-invitation', { 
                from: socket.nickname,
                roomId: `arena_${socket.nickname}` 
            });
        }
    });

    // 4. Meeting Mikrofon Kontrolü (Host yetkisi)
    socket.on('mute-all-mics', (data) => {
        // Sadece oda sahibi (host) ise odaya 'mute' komutu gönderir
        io.to(data.roomId).emit('silence-mics');
    });

    socket.on('disconnect', () => {
        if (socket.nickname) {
            onlineUsers.delete(socket.nickname);
            io.emit('online-list', Array.from(onlineUsers.keys()));
        }
    });
});

// Sunucuyu server üzerinden başlat
server.listen(PORT, () => {
    console.log(`🚀 BPL Ekosistemi ${PORT} portunda yayında...`);
});

