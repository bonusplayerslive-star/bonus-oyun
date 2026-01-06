// Path: app.js

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo').default;
const path = require('path');
require('dotenv').config();

const User = require('./models/User');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { 
    cors: { origin: "*" },
    allowEIO3: true 
});

// --- 1. VERİTABANI BAĞLANTISI ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ MongoDB Bağlantısı Başarılı'))
    .catch(err => console.error('❌ MongoDB Hatası:', err));

// --- 2. MIDDLEWARE & SESSION ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'bpl_cyber_2026',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
    cookie: { 
        secure: false, 
        maxAge: 1000 * 60 * 60 * 24 
    }
});

app.use(sessionMiddleware);
io.engine.use(sessionMiddleware); 

// Güvenlik Kapısı (isLoggedIn)
async function isLoggedIn(req, res, next) {
    if (req.session && req.session.userId) {
        try {
            const user = await User.findById(req.session.userId);
            if (user) {
                req.user = user;
                res.locals.user = user;
                return next();
            }
        } catch (err) { console.error("Session hatası:", err); }
    }
    res.redirect('/login');
}

// --- 3. ROTALAR (EJS GÖRÜNÜMLERİ) ---

app.get('/', (req, res) => {
    if (req.session.userId) return res.redirect('/profil');
    res.render('index'); 
});

app.get('/login', (req, res) => res.render('index'));

app.get('/profil', isLoggedIn, (req, res) => {
    res.render('profil', { user: req.user });
});

app.get('/arena', isLoggedIn, (req, res) => {
    let char = req.user.selectedAnimal || "Tiger";
    const formattedChar = char.charAt(0).toUpperCase() + char.slice(1);
    res.render('arena', { user: req.user, formattedChar });
});

app.get('/market', isLoggedIn, (req, res) => {
    const shopItems = [
        { id: "p1", name: "Süper Enerji", price: 500, type: "powerup" },
        { id: "p2", name: "Hız Artırıcı", price: 1000, type: "boost" },
        { id: "p3", name: "Altın Pençe", price: 2500, type: "weapon" }
    ];
    res.render('market', { user: req.user, items: shopItems });
});

app.get('/development', isLoggedIn, (req, res) => {
    res.render('development', { user: req.user });
});

app.get('/chat', isLoggedIn, (req, res) => {
    res.render('chat', { user: req.user });
});

app.get('/wallet', isLoggedIn, (req, res) => {
    res.render('wallet', { 
        user: req.user,
        contract: process.env.CONTRACT_ADDRESS,
        wallet: process.env.WALLET_ADDRESS 
    });
});

app.get('/meeting', isLoggedIn, (req, res) => res.render('meeting', { user: req.user }));

// --- 4. API & VERİ İŞLEMLERİ ---

// Market Satın Alma
app.post('/api/market/buy', isLoggedIn, async (req, res) => {
    try {
        const { itemName, price } = req.body;
        const user = await User.findById(req.user._id);
        if (user.bpl >= price) {
            user.bpl -= price;
            user.inventory.push({ name: itemName, purchasedAt: new Date() });
            await user.save();
            return res.json({ success: true, newBpl: user.bpl });
        }
        res.status(400).json({ success: false, message: "Yetersiz Bakiye!" });
    } catch (err) { res.status(500).json({ success: false }); }
});

// Geliştirme (Stat Yükseltme)
app.post('/api/upgrade', isLoggedIn, async (req, res) => {
    try {
        const { statType, cost } = req.body; 
        const user = await User.findById(req.user._id);
        if (user.bpl >= cost) {
            user.bpl -= cost;
            // Stat güncelleme (hp, atk, def)
            if (!user.stats) user.stats = { hp: 100, atk: 10, def: 10 };
            user.stats[statType] += 5;
            user.markModified('stats'); 
            await user.save();
            return res.json({ success: true, newBpl: user.bpl, newStats: user.stats });
        }
        res.status(400).json({ success: false, message: "Bakiye Yetersiz!" });
    } catch (err) { res.status(500).json({ success: false }); }
});

// --- 5. SOCKET.IO (GERÇEK ZAMANLI İŞLEMLER) ---

io.on('connection', async (socket) => {
    const session = socket.request.session;
    if (session && session.userId) {
        const user = await User.findById(session.userId);
        if (user) {
            socket.userId = user._id;
            socket.nickname = user.nickname;
            socket.join("global_chat");
        }
    }

    // Global Chat Mesajlaşma
    socket.on('send-global-msg', (data) => {
        io.to("global_chat").emit('receive-global-msg', {
            sender: socket.nickname,
            text: data.text,
            time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
        });
    });

    // Chat içi Hediyeleşme (BPL Transfer)
    socket.on('gift-bpl', async (data) => {
        try {
            const { targetNick, amount } = data;
            const sender = await User.findById(socket.userId);
            const receiver = await User.findOne({ nickname: targetNick });

            if (receiver && sender.bpl >= amount && amount > 0) {
                sender.bpl -= Number(amount);
                receiver.bpl += Number(amount);
                await sender.save();
                await receiver.save();

                socket.emit('update-bpl', sender.bpl);
                io.emit('system-msg', { text: `${sender.nickname}, ${receiver.nickname} adlı oyuncuya ${amount} BPL gönderdi!` });
            }
        } catch (e) { console.log("Hediye hatası:", e); }
    });

    // Arena Bot Savaşı
    socket.on('start-bot-battle', async () => {
        try {
            const user = await User.findById(socket.userId);
            const isWin = Math.random() > 0.5;
            const prize = isWin ? 100 : -50;
            
            user.bpl += prize;
            if (user.bpl < 0) user.bpl = 0;
            await user.save();

            let char = user.selectedAnimal || "Tiger";
            const formattedChar = char.charAt(0).toUpperCase() + char.slice(1);

            socket.emit('update-bpl', user.bpl);
            socket.emit('battle-result', { 
                isWin, 
                prize, 
                newBpl: user.bpl,
                charName: formattedChar,
                attackVid: `/caracter/move/${formattedChar}/${formattedChar}1.mp4`,
                winVid: `/caracter/move/${formattedChar}/${formattedChar}.mp4`
            });
        } catch (e) { console.error(e); }
    });
});

// Auth İşlemleri (Register/Login)
app.post('/register', async (req, res) => {
    try {
        const { nickname, email, password } = req.body;
        const newUser = new User({ 
            nickname, email, password, 
            bpl: 2500, selectedAnimal: 'Tiger',
            stats: { hp: 100, atk: 10, def: 10 }
        });
        await newUser.save();
        req.session.userId = newUser._id;
        res.redirect('/profil');
    } catch (err) { res.status(500).send("Kayıt hatası."); }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email, password });
    if (user) {
        req.session.userId = user._id;
        res.redirect('/profil');
    } else {
        res.send("<script>alert('Hatalı giriş!'); window.location='/';</script>");
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- 6. SUNUCU BAŞLAT ---
const PORT = process.env.PORT || 10000;
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`
    ==========================================
    🚀 BPL Cyber System v2026 Aktif!
    🌐 Port: ${PORT}
    📡 Socket.io: Bağlantı hazır
    💾 MongoDB: Bağlı
    ==========================================
    `);
});
