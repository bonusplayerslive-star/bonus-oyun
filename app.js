const express = require('express');
const mongoose = require('mongoose'); // EKSİKTİ: Eklendi
const session = require('express-session');
const MongoStore = require('connect-mongo');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
require('dotenv').config();

// Modeller
const User = require('./models/User');
const Payment = require('./models/Payment');
const Victory = require('./models/Victory');
const Log = require('./models/Log');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// --- KRİTİK: SESSION STORE YAPILANDIRMASI ---
const sessionStore = MongoStore.create({
    mongoUrl: process.env.MONGO_URI,
    collectionName: 'sessions',
    autoRemove: 'native'
});

// MongoDB Bağlantısı
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ MongoDB Bağlantısı Başarılı'))
    .catch(err => console.error('❌ Bağlantı Hatası:', err));

// Middleware & View Engine
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session Ayarları ( sessionStore kullanılarak düzeltildi )
app.use(session({
    secret: process.env.SESSION_SECRET || 'bpl_gizli_anahtar_2025',
    resave: false,
    saveUninitialized: false,
    store: sessionStore, // HATA BURADAYDI: Doğrudan değişkeni veriyoruz
    cookie: { 
        secure: process.env.NODE_ENV === 'production', 
        maxAge: 24 * 60 * 60 * 1000 
    }
}));

// Kullanıcıyı Tüm View'lara Aktar
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

// --- ROTALAR (GET) ---
app.get('/', (req, res) => res.render('index'));
app.get('/profil', async (req, res) => {
    if(!req.session.user) return res.redirect('/');
    try {
        const user = await User.findById(req.session.user._id);
        res.render('profil', { user });
    } catch (err) {
        res.redirect('/');
    }
});
app.get('/market', (req, res) => res.render('market'));
app.get('/arena', (req, res) => res.render('arena'));
app.get('/development', (req, res) => res.render('development'));
app.get('/chat', (req, res) => res.render('chat'));
app.get('/meeting', (req, res) => res.render('meeting'));
app.get('/wallet', (req, res) => res.render('wallet'));
app.get('/payment', (req, res) => res.render('payment'));

// --- MARKET SATIN ALMA (POST) ---
app.post('/buy-animal', async (req, res) => {
    const { animalName, price } = req.body;
    if(!req.session.user) return res.status(401).json({msg: "Giriş yapmalısın"});
    
    const user = await User.findById(req.session.user._id);
    if (user.bpl < price) return res.status(400).json({ msg: 'Bakiye Yetersiz!' });

    user.bpl -= price;
    user.inventory.push({
        name: animalName,
        level: 1,
        stats: { hp: 150, atk: 30, def: 20 }
    });

    await user.save();
    req.session.user = user;
    res.json({ msg: 'Başarıyla satın alındı!', newBpl: user.bpl });
});

// --- SOCKET.IO (CHAT & HEDİYE SİSTEMİ) ---
io.on('connection', (socket) => {
    socket.on('send-gift', async (data) => {
        try {
            const sender = await User.findById(data.fromId);
            const receiver = await User.findById(data.toId);

            if (sender.bpl >= 6000 && data.amount <= 250) {
                const tax = Math.floor(data.amount * 0.18);
                const netAmount = data.amount - tax;

                sender.bpl -= data.amount;
                receiver.bpl += netAmount;

                await sender.save();
                await receiver.save();

                await Payment.create({
                    sender: sender.nickname,
                    receiver: receiver.nickname,
                    amount: data.amount,
                    tax: tax,
                    status: 'Completed'
                });

                // Yakılan miktar için Log kaydı
                await Log.create({ type: 'BURN', amount: tax, detail: 'Gift Tax Burned' });

                io.emit('notification', { msg: `${sender.nickname} kişisinden ${netAmount} BPL hediye geldi! (${tax} BPL yakıldı)` });
            }
        } catch (err) {
            socket.emit('error', { msg: 'İşlem başarısız!' });
        }
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Sistem Port ${PORT} üzerinde aktif!`));
