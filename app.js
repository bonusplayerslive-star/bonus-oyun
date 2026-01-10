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

// --- 4. SAYFA YÖNETİMİ (WALLET HATASI BURADA ÇÖZÜLDÜ) ---
app.get('/profil', authRequired, (req, res) => res.render('profil'));
app.get('/market', authRequired, (req, res) => res.render('market'));
app.get('/arena', authRequired, (req, res) => res.render('arena'));
app.get('/development', authRequired, (req, res) => res.render('development'));
app.get('/meeting', authRequired, (req, res) => res.render('meeting'));
app.get('/chat', authRequired, (req, res) => res.render('chat'));

app.get('/wallet', authRequired, (req, res) => {
    // Veriyi doğrudan nesne içinde göndererek EJS'deki 'undefined' hatalarını önlüyoruz
    res.render('wallet', { bpl: res.locals.user.bpl || 0 });
});

// --- 5. MARKET VE GELİŞTİRME API ---

// Satın Alma API (Limit 25 BPL olarak güncellendi)
app.post('/api/buy-item', authRequired, async (req, res) => {
    const { itemName, price } = req.body;
    try {
        const user = await User.findById(req.session.userId);
        
        // Stratejik limit kontrolü: 25 BPL altına düşemez
        if ((user.bpl - price) < 25) { 
            return res.status(400).json({ success: false, error: 'Limit Engelli: Bakiyeniz 25 BPL altına düşemez!' });
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

// Geliştirme API (Geliştirme sayfasındaki 404 hatasını çözer)
app.post('/api/upgrade-stat', authRequired, async (req, res) => {
    const { animalIndex, statName, cost } = req.body;
    try {
        const user = await User.findById(req.session.userId);
        
        // Geliştirme yaparken de bakiye 25 BPL altına düşmemeli
        if ((user.bpl - cost) < 25) {
            return res.status(400).json({ success: false, error: 'Bakiye 25 BPL altına düşemez!' });
        }

        const animal = user.inventory[animalIndex];
        if (!animal) return res.status(404).json({ success: false, error: 'Hayvan bulunamadı!' });

        // İlgili özelliği artır
        if (statName === 'hp') {
            animal.maxHp += 10;
            animal.hp = animal.maxHp;
        } else if (statName === 'atk') {
            animal.atk += 5;
        } else if (statName === 'def') {
            animal.def += 5;
        }

        user.bpl -= cost;
        // Mongoose'un dizideki değişikliği fark etmesi için:
        user.markModified('inventory'); 
        await user.save();

        res.json({ success: true, newBpl: user.bpl, newValue: animal[statName === 'hp' ? 'maxHp' : statName] });
    } catch (err) {
        console.error("Geliştirme Hatası:", err);
        res.status(500).json({ success: false });
    }
});

// Arena için hayvan seçme rotası
app.post('/api/select-animal', authRequired, async (req, res) => {
    const { animalIndex } = req.body;
    try {
        const user = await User.findById(req.session.userId);
        if (!user.inventory[animalIndex]) {
            return res.status(404).json({ success: false, error: 'Hayvan bulunamadı!' });
        }
        
        // Kullanıcının seçili hayvanını güncelle
        user.selectedAnimal = user.inventory[animalIndex].name;
        await user.save();
        
        res.json({ success: true, message: 'Hayvan başarıyla seçildi!' });
    } catch (err) {
        console.error("Arena Seçim Hatası:", err);
        res.status(500).json({ success: false });
    }
});












// --- 6. SOCKET.IO (CHAT & MEETING ODA MANTIĞI) ---
io.on('connection', async (socket) => {
    const uId = socket.request.session?.userId;
    if (!uId) return;
    const user = await User.findById(uId);
    if (!user) return;

    // Chat Odası
    socket.join("general-chat");
    socket.on('chat-message', (data) => {
        io.to("general-chat").emit('new-message', { sender: user.nickname, text: data.text });
    });

    // Meeting & Video Odası
    socket.on('join-meeting', (roomId) => {
        socket.join(roomId);
        socket.to(roomId).emit('user-connected', socket.id);
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 SİSTEM AKTİF: ${PORT}`));


