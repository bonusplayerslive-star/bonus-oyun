// --- 1. MODÜLLER VE GÜVENLİK AYARLARI ---
require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const MongoStore = require('connect-mongo'); // Oturumları DB'de tutmak için
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

// --- 2. VERİTABANI VE MODELLER ---
const connectDB = require('./db');
const User = require('./models/User');
const Payment = require('./models/Payment');
const Withdrawal = require('./models/Withdrawal');
const ArenaLog = require('./models/ArenaLogs');

connectDB();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 10000;

// --- 3. MIDDLEWARE YAPILANDIRMASI ---
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Güvenli Oturum Yönetimi
app.use(session({
    secret: process.env.SESSION_SECRET || ,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
    cookie: { 
        secure: process.env.NODE_ENV === 'production', 
        maxAge: 24 * 60 * 60 * 1000 
    }
}));

// Global Değişken Aktarımı (EJS için)
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

// Yetki Kontrolü
const checkAuth = (req, res, next) => {
    if (req.session.userId) next(); else res.redirect('/');
};

// --- 4. MAİL SERVİSİ (Şifre Yenileme) ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS }
});

// --- 5. ANA SAYFA VE PROFİL ROTALARI ---

app.get('/', (req, res) => res.render('index'));

app.get('/profil', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        res.render('profil', { user });
    } catch (err) { res.redirect('/logout'); }
});

// --- 6. COMMAND CENTER (MENÜ) FONKSİYONLARI ---

// MARKET: Yeni Karakter Satın Alma
app.get('/market', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('market', { user });
});

// GELİŞTİRME: HP, ATK, DEF Yükseltme
app.get('/development', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('development', { user });
});

// ARENA: Bot Savaşları ve Kazanç
app.get('/arena', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    // Görseldeki gibi varsayılan karakter seçimi
    const selectedAnimal = user.inventory[0] || { name: "Eagle", stats: { hp: 100, atk: 20 } };
    res.render('arena', { user, selectedAnimal });
});

// BEŞGEN MASA: Video Konferans Odası
app.get('/meeting/:roomId', checkAuth, (req, res) => {
    res.render('meeting', { roomId: req.params.roomId });
});

// WALLET: Bakiye, TxID Kontrolü ve Tasfiye
app.get('/wallet', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('wallet', { user });
});

// --- 7. İŞLEM (POST) ROTALARI ---

// Kayıt: 2500 BPL Hediye ve Şifreleme
app.post('/register', async (req, res) => {
    const { nickname, email, password } = req.body;
    try {
        const exists = await User.findOne({ email });
        if (exists) return res.send('<script>alert("E-posta kayıtlı!"); window.location.href="/";</script>');
        
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ 
            nickname, 
            email, 
            password: hashedPassword, 
            bpl: 2500,
            inventory: [{ // İlk karakter hediye
                name: 'Eagle', level: 1, 
                img: '/caracter/profile/eagle.jpg', 
                stats: { hp: 150, atk: 30, def: 20 } 
            }] 
        });
        await newUser.save();
        res.send('<script>alert("Kayıt başarılı! 2500 BPL hediye edildi."); window.location.href="/";</script>');
    } catch (err) { res.status(500).send("Sunucu hatası!"); }
});

// Giriş: Bcrypt Doğrulaması
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email });
        
        if (user) {
            // bcrypt.compare kullanımı şarttır
            const isMatch = await bcrypt.compare(password, user.password);
            
            if (isMatch) {
                req.session.userId = user._id; // ID ataması
                req.session.user = user;      // Kullanıcı objesi ataması
                
                // Session'ın veritabanına yazıldığından emin olup sonra yönlendir
                return req.session.save(() => {
                    res.redirect('/profil');
                });
            }
        }
        res.send('<script>alert("Hatalı giriş!"); window.location.href="/";</script>');
    } catch (err) {
        console.error("Login Hatası:", err);
        res.redirect('/');
    }
});
// Arena Saldırı Mekaniği
app.post('/attack-bot', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        if (user.bpl < 200) return res.json({ status: 'error', msg: 'Yetersiz BPL!' });

        const isWin = Math.random() > 0.45; // %55 kazanma şansı
        const prize = 200;
        
        if (isWin) {
            user.bpl += prize;
            // Arena Log Kaydı
            const log = new ArenaLog({ challenger: user.nickname, opponent: "BOT-X", winner: user.nickname, totalPrize: prize });
            await log.save();
        } else {
            user.bpl -= prize;
        }
        
        await user.save();
        res.json({ status: 'success', isWin, newBalance: user.bpl });
    } catch (err) { res.status(500).json({ status: 'error' }); }
});

// --- 8. SOCKET.IO (Global Chat & Arena Duyuruları) ---
io.on('connection', (socket) => {
    socket.on('register-user', (data) => {
        if (data?.nickname) {
            socket.nickname = data.nickname;
            socket.join('GlobalChat');
        }
    });

    socket.on('chat-message', (data) => {
        io.to('GlobalChat').emit('new-message', { 
            sender: socket.nickname || "Operatör", 
            text: data.text,
            time: new Date().toLocaleTimeString()
        });
    });
});

// --- 9. SUNUCU ATEŞLEME ---
server.listen(PORT, "0.0.0.0", () => {
    console.log(`
    ===========================================
    BPL NIRVANA ENGINE ONLINE
    PORT: ${PORT}
    ENV: ${process.env.NODE_ENV || 'development'}
    ===========================================
    `);
});

