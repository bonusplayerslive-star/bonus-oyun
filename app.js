const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
require('dotenv').config();

// Modeller ve Controllerlar
const User = require('./models/User'); // Paylaştığın User.js
const authController = require('./controllers/authController'); // Paylaştığın controller

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Veritabanı Bağlantısı (Render'daki MONGO_URI'yi kullanır)
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("BPL Veritabanı Bağlandı"))
    .catch(err => console.error("DB Hatası:", err));

// Middleware Ayarları
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session Ayarları (Hatayı gideren güncel versiyon)
app.use(session({
    secret: process.env.SESSION_SECRET || 'bpl_secret_2025',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: process.env.MONGO_URI,
        ttl: 14 * 24 * 60 * 60 // 14 gün boyunca oturum açık kalır
    })
}));
// --- YOLLAR (ROUTES) ---

// Giriş ve Kayıt (authController üzerinden)
app.get('/', (req, res) => res.render('index'));
app.post('/register', authController.register);
app.post('/login', authController.login);

// Profil Sayfası (Giriş zorunlu)
app.get('/profil', async (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    const user = await User.findById(req.session.userId);
    res.render('profil', { user }); // Paylaştığın profil.ejs yapısı
});

// Market Sayfası
app.get('/market', async (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    const user = await User.findById(req.session.userId);
    res.render('market', { user });
});

// Market Satın Alma API (Seninle az önce paylaştığım rota)
app.post('/api/buy-item', async (req, res) => {
    if (!req.session.userId) return res.json({ success: false });
    const { itemName, price, hp, atk, def, img } = req.body;
    const user = await User.findById(req.session.userId);
    
    if (user.bpl >= price && user.inventory.length < 5) {
        user.bpl -= price;
        user.inventory.push({ name: itemName, hp, maxHp: hp, atk, def, img, stamina: 100 });
        if (user.selectedAnimal === 'none') user.selectedAnimal = itemName;
        await user.save();
        return res.json({ success: true });
    }
    res.json({ success: false, error: "Bakiye veya yer yetersiz" });
});

// Arena Sayfası
app.get('/arena', async (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    const user = await User.findById(req.session.userId);
    res.render('arena', { user });
});

// Meeting (Toplantı) Odası
app.get('/meeting', async (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    const user = await User.findById(req.session.userId);
    res.render('meeting', { user });
});

// --- SOCKET.IO (Video ve Chat için) ---
io.on('connection', (socket) => {
    socket.on('join-meeting', ({ roomId, peerId, nickname }) => {
        socket.join(roomId);
        socket.to(roomId).emit('user-connected', { peerId, nickname });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`BPL Sistemi ${PORT} portunda aktif.`));

