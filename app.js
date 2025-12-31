// --- 1. MODÜLLER VE AYARLAR ---
require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const path = require('path');
const bcrypt = require('bcryptjs');

// --- 2. VERİTABANI VE MODELLER ---
const connectDB = require('./db');
const User = require('./models/User');
const Log = require('./models/Log');
const Payment = require('./models/Payment');
const Withdrawal = require('./models/Withdrawal');
const ArenaLog = require('./models/ArenaLogs'); 

connectDB(); // MongoDB Atlas bağlantısı

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 10000;

// --- 3. MIDDLEWARE ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// OTURUM YÖNETİMİ (Kritik: Hatalar burada düzeltildi)
app.use(session({
    secret: process.env.SESSION_SECRET || 'bpl_super_secret_2026',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ 
        mongoUrl: process.env.MONGO_URI,
        collectionName: 'sessions'
    }),
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// Global Kullanıcı Verisi (Tüm EJS dosyaları için)
app.use(async (req, res, next) => {
    if (req.session.userId) {
        res.locals.user = await User.findById(req.session.userId);
    } else {
        res.locals.user = null;
    }
    next();
});

const checkAuth = (req, res, next) => req.session.userId ? next() : res.redirect('/');

// --- 4. ROTALAR (GET - Tüm Menüler) ---
app.get('/', (req, res) => res.render('index'));
app.get('/profil', checkAuth, (req, res) => res.render('profil'));
app.get('/market', checkAuth, (req, res) => res.render('market'));
app.get('/development', checkAuth, (req, res) => res.render('development'));
app.get('/arena', checkAuth, (req, res) => res.render('arena'));
app.get('/wallet', checkAuth, (req, res) => res.render('wallet'));
app.get('/chat', checkAuth, (req, res) => res.render('chat'));

// --- 5. ROTALAR (POST - İşlemler) ---

// Giriş ve Kayıt
app.post('/register', async (req, res) => {
    try {
        const { nickname, email, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ 
            nickname, email, password: hashedPassword, bpl: 2500,
            inventory: [{ name: 'Eagle', level: 1, stats: { hp: 150, atk: 30 } }] 
        });
        await newUser.save();
        res.send('<script>alert("Kayıt Başarılı! 2500 BPL Hediye."); window.location.href="/";</script>');
    } catch (e) { res.status(500).send("Hata!"); }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (user && await bcrypt.compare(password, user.password)) {
        req.session.userId = user._id;
        return req.session.save(() => res.redirect('/profil'));
    }
    res.send('<script>alert("Hatalı Giriş!"); window.location.href="/";</script>');
});

// Arena Savaş Mekanizması (%60 Kayıp Oranı ve Botlar)
app.post('/arena/battle', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    const bots = ['Lion', 'Goril', 'Tiger', 'Eagle'];
    const botOpponent = bots[Math.floor(Math.random() * bots.length)];
    
    // Şans Faktörü: %60 Kayıp
    const userWins = Math.random() > 0.6; 
    let prize = userWins ? 150 : -50;
    
    user.bpl += prize;
    if(user.bpl < 0) user.bpl = 0;
    await user.save();

    // Log Kaydı (ArenaLogs Modeli Kullanıldı)
    const battleLog = new ArenaLog({
        challenger: user.nickname,
        opponent: botOpponent + " (BOT)",
        winner: userWins ? user.nickname : botOpponent,
        totalPrize: prize
    });
    await battleLog.save();

    res.json({ success: true, win: userWins, opponent: botOpponent, newBpl: user.bpl });
});

// İletişim Formu (Email + Max 180 Karakter Not)
app.post('/contact', async (req, res) => {
    const { email, note } = req.body;
    if (note.length > 180) return res.send("Not çok uzun!");
    
    await new Log({ 
        type: 'CONTACT_MESSAGE', 
        content: note, 
        userEmail: email 
    }).save();
    
    res.send('<script>alert("Mesajınız iletildi."); window.location.href="/";</script>');
});

// --- 6. SOCKET.IO (Hediye ve Global Chat) ---
io.on('connection', (socket) => {
    socket.on('send-gift', async (data) => {
        const sender = await User.findById(data.senderId);
        const receiver = await User.findOne({ nickname: data.receiverNick });
        
        if (sender && receiver && sender.bpl >= data.amount) {
            sender.bpl -= data.amount;
            receiver.bpl += data.amount;
            await sender.save(); await receiver.save();
            
            io.emit('new-message', {
                sender: "SİSTEM",
                text: `💎 ${sender.nickname}, ${receiver.nickname} kumandana ${data.amount} BPL gönderdi!`
            });
        }
    });
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- 6. SOCKET.IO SİSTEMİ (Chat, Hediye ve Meeting) ---
io.on('connection', (socket) => {
    console.log('Bir kullanıcı bağlandı:', socket.id);

    // Kanala Katılma (Global Sohbet)
    socket.on('join-room', (roomName) => {
        socket.join(roomName);
    });

    // Mesajlaşma Sistemi
    socket.on('chat-message', async (data) => {
        const { sender, text, room } = data;
        
        // Sohbet kaydını MongoDB'ye ekle
        await new Log({
            type: 'CHAT_MESSAGE',
            content: text,
            userEmail: sender // Kullanıcı e-postası veya takma adı
        }).save();

        io.to(room).emit('new-message', { sender, text });
    });

    // TEBRİK / HEDİYE SİSTEMİ (Gönderdiğin .txt dosyasındaki mantık)
    socket.on('send-tebrik', async (data) => {
        try {
            const { senderNick, receiverNick } = data;
            const sender = await User.findOne({ nickname: senderNick });
            const receiver = await User.findOne({ nickname: receiverNick });

            const brutHediye = 450;
            const netHediye = 410;
            const kesinti = 40; // Yakılacak miktar

            if (sender && receiver && sender.bpl >= brutHediye) {
                sender.bpl -= brutHediye;
                receiver.bpl += netHediye;

                await sender.save();
                await receiver.save();

                // Yakım (Burn) Kaydı
                await new Log({
                    type: 'BPL_BURN',
                    content: `Tebrik yakımı: ${kesinti} BPL`,
                    userEmail: sender.email
                }).save();

                // Global Duyuru
                io.emit('new-message', {
                    sender: "SİSTEM",
                    text: `💎 ${sender.nickname}, şampiyon ${receiver.nickname}'ı tebrik etti! (410 BPL iletildi)`
                });
            }
        } catch (e) {
            console.error("Hediye gönderim hatası:", e);
        }
    });

    socket.on('disconnect', () => {
        console.log('Kullanıcı ayrıldı.');
    });
});

// --- 7. MEETING (BEŞGEN MASA) ROTALARI ---
app.get('/meeting', checkAuth, (req, res) => {
    res.render('meeting', { roomId: 'Global' });
});

app.get('/meeting/:roomId', checkAuth, (req, res) => {
    res.render('meeting', { roomId: req.params.roomId });
});

server.listen(PORT, () => console.log(`BPL ECOSYSTEM AKTİF: ${PORT}`));

