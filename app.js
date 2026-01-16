// Path: app.js

// --- 1. MODÜLLER ---
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo').default; // Modern sürüm uyumu
const path = require('path');
require('dotenv').config();

const User = require('./models/User');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { 
    cors: { origin: "*" },
    allowEIO3: true 
});

// --- 2. VERİTABANI BAĞLANTISI ---
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://bonusplayerslive_db_user:1nB1QyAsh3qVafpE@bonus.x39zlzq.mongodb.net/?appName=Bonus";

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Bağlantısı Başarılı'))
    .catch(err => console.error('❌ MongoDB Hatası:', err));

// --- 3. MIDDLEWARE & SESSION ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'bpl_cyber_secret_2025',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ 
        mongoUrl: MONGO_URI,
        collectionName: 'sessions'
    }),
    cookie: { 
        secure: false, 
        maxAge: 1000 * 60 * 60 * 24 
    }
});

app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);

// Güvenlik Kapısı
async function isLoggedIn(req, res, next) {
    if (req.session && req.session.userId) {
        const user = await User.findById(req.session.userId);
        if (user) {
            req.user = user;
            res.locals.user = user; // Global erişim için eklendi
            return next();
        }
    }
    res.redirect('/login');
}

// Global Değişkenler
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

// --- 4. ROTALAR (ROUTES) ---

app.get('/', (req, res) => {
    if (req.session.userId) return res.redirect('/profil');
    res.render('index'); 
});

app.get('/login', (req, res) => { 
    res.render('index'); 
});

// Kayıt İşlemi
app.post('/register', async (req, res) => {
    try {
        const { nickname, email, password } = req.body;
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.send("<script>alert('E-posta kayıtlı!'); window.location='/';</script>");

        const newUser = new User({ 
            nickname, email, password, 
            bpl: 2500, inventory: [] 
        });
        await newUser.save();
        
        req.session.userId = newUser._id;
        req.session.user = newUser;
        res.redirect('/profil');
    } catch (err) {
        res.status(500).send("Hata: " + err.message);
    }
});

// Giriş İşlemi
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email, password });
        if (user) {
            req.session.userId = user._id;
            req.session.user = user;
            res.redirect('/profil');
        } else {
            res.send("<script>alert('Hatalı giriş!'); window.location='/';</script>");
        }
    } catch (err) {
        res.status(500).send("Giriş başarısız.");
    }
});

// Sayfalar (Hepsini tek blokta topladım, karışıklık olmasın)
app.get('/profil', isLoggedIn, async (req, res) => {
    const user = await User.findById(req.user._id); // Hayvanın görünmesi için DB'den taze veri çekiyoruz
    res.render('profil', { user });
});

app.get('/market', isLoggedIn, (req, res) => res.render('market', { user: req.user }));
app.get('/chat', isLoggedIn, (req, res) => res.render('chat', { user: req.user }));
app.get('/arena', isLoggedIn, (req, res) => res.render('arena', { user: req.user, opponentNick: req.query.opponent || null }));
app.get('/meeting', isLoggedIn, (req, res) => res.render('meeting', { user: req.user, roomId: "GENEL_KONSEY" }));
app.get('/development', isLoggedIn, async (req, res) => {
    const user = await User.findById(req.user._id); // Geliştirme için taze veri
    res.render('development', { user });
});
app.get('/wallet', isLoggedIn, (req, res) => res.render('wallet', { user: req.user }));
app.get('/payment', isLoggedIn, (req, res) => res.render('payment', { user: req.user }));

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- API İŞLEMLERİ (Market & Geliştirme) ---

// isLoggedIn olarak değiştirdik, çünkü senin app.js'de bu isimle tanımlı
app.post('/buy-animal', isLoggedIn, async (req, res) => {
    try {
        const { animalName } = req.body;
        const user = await User.findById(req.session.userId);

        if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı!" });

        const animalStats = {
            'Bear': { price: 1300, atk: 25, def: 15 },
            'Crocodile': { price: 1500, atk: 30, def: 20 },
            'Eagle': { price: 1200, atk: 35, def: 10 },
            'Falcon': { price: 1100, atk: 32, def: 8 },
            'Gorilla': { price: 3500, atk: 45, def: 35 },
            'Lion': { price: 3500, atk: 50, def: 30 },
            'Rhino': { price: 3600, atk: 40, def: 50 },
            'Snake': { price: 1300, atk: 28, def: 12 },
            'Tiger': { price: 3500, atk: 52, def: 28 },
            'Wolf': { price: 1500, atk: 30, def: 18 }
        };

        const selected = animalStats[animalName];
        if (!selected) return res.status(400).json({ error: "Geçersiz hayvan!" });

        if (user.inventory.length >= 3) {
            return res.status(400).json({ error: "Çantan dolu! En fazla 3 hayvan taşıyabilirsin." });
        }

        if (user.bpl < selected.price) {
            return res.status(400).json({ error: "Yetersiz BPL bakiyesi!" });
        }

        user.bpl -= selected.price;
        user.inventory.push({
            name: animalName,
            img: `/caracter/profile/${animalName}.jpg`,
            hp: 100,
            maxHp: 100,
            atk: selected.atk,
            def: selected.def,
            level: 1,
            stamina: 100
        });

        await user.save();
        res.json({ success: true, message: `${animalName} başarıyla satın alındı!` });
    } catch (error) {
        console.error("Satın alma hatası:", error);
        res.status(500).json({ error: "Sunucu hatası oluştu!" });
    }
});
app.post('/api/upgrade-stat', isLoggedIn, async (req, res) => {
    try {
        const { animalName, statType } = req.body;
        const user = await User.findById(req.user._id);
        const cost = (statType === 'def') ? 10 : 15;

        if (user.bpl < cost) return res.json({ success: false, error: "Yetersiz BPL!" });

        const animal = user.inventory.find(a => a.name === animalName);
        if (!animal) return res.json({ success: false, error: "Karakter bulunamadı!" });

        animal[statType] = (animal[statType] || 0) + 10;
        user.bpl -= cost;

        user.markModified('inventory');
        await user.save();
        res.json({ success: true, newBalance: user.bpl, newValue: animal[statType] });
    } catch (err) { res.status(500).json({ success: false, error: "Geliştirme hatası!" }); }

// app.js içindeki örnek mantık
if (statType === 'stamina') {
    if (user.bpl < 10) return res.status(400).json({ error: "Yetersiz BPL!" });
    animal.stamina = 100; // Enerjiyi fulle
    user.bpl -= 10;
}


    
});

// --- 5. SOCKET.IO İŞLEMLERİ (Chat Bozmadan) ---
io.on('connection', async (socket) => {
    const session = socket.request.session;
    
    if (session && session.userId) {
        const user = await User.findById(session.userId);
        if (user) {
            socket.userId = user._id;
            socket.nickname = user.nickname;
            console.log(`✅ Bağlantı onaylandı: ${socket.nickname}`);
        }

// app.js içindeki io.on('connection') bloğunun içine ekle
socket.on('join-meeting', (data) => {
    const roomId = data.roomId || "GENEL_KONSEY";
    socket.join(roomId); // Kullanıcıyı odaya sokar
    socket.currentRoom = roomId;
    
    console.log(`👥 ${socket.nickname} şu odaya katıldı: ${roomId}`);
    
    // Odadaki diğerlerine haber ver
    socket.to(roomId).emit('user-connected', {
        nickname: socket.nickname,
        id: socket.id
    });
});

// Mesaj gönderirken sadece o odadakilere gitsin
socket.on('send-meeting-message', (data) => {
    if (socket.currentRoom) {
        io.to(socket.currentRoom).emit('new-meeting-message', {
            sender: socket.nickname,
            text: data.text
        });

// Oda daveti kabul edildiğinde çalışan socket bloğu
socket.on('accept-private-invitation', (data) => {
    const roomId = data.roomId; // Örneğin: "ROOM_12345"
    const senderId = data.senderId; // Daveti atan kişinin socket ID'si
    const receiverId = socket.id;   // Daveti kabul eden (şu anki kullanıcı)

    // 1. Daveti kabul edeni (kendini) odaya gönder
    socket.emit('redirect-to-meeting', { roomId: roomId });

    // 2. Daveti gönderen oda sahibini de odaya gönder
    io.to(senderId).emit('redirect-to-meeting', { roomId: roomId });
});

    }
});




    }

    socket.on('chat-message', (data) => {
        const sender = socket.nickname || "Bilinmeyen";
        io.emit('new-message', {
            sender: sender,
            text: data.text,
            time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
        });
    });

    socket.on('transfer-bpl', async (data) => {
        try {
            if (!socket.userId) return;
            const sender = await User.findById(socket.userId);
            const receiver = await User.findOne({ nickname: data.to });
            const amount = parseInt(data.amount);

            if (receiver && sender.bpl >= amount + 500 && amount >= 50) {
                sender.bpl -= amount;
                receiver.bpl += (amount * 0.8);
                await sender.save();
                await receiver.save();
                socket.emit('gift-result', { message: "Başarılı!", newBalance: sender.bpl });
            } else {
                socket.emit('gift-result', { message: "Limit yetersiz veya alıcı yok!" });
            }
        } catch (e) { console.log(e); }
    });

    socket.on('disconnect', () => {
        if (socket.nickname) console.log(`🔌 ${socket.nickname} ayrıldı.`);
    });

// --- app.js içine eklenecek Socket Dinleyicileri ---

socket.on('send-challenge', async (data) => {
    try {
        const sender = await User.findById(socket.userId);
        if (sender && sender.bpl >= 5505) {
            sender.bpl -= 5; // Davet bilet ücreti
            await sender.save();

            // Gönderene yeni bakiyesini bildir ve paneli kapatması için onay ver
            socket.emit('gift-result', { 
                success: true, 
                message: "Düello bileti kesildi (-5 BPL). Davet iletiliyor...", 
                newBalance: sender.bpl 
            });

            // Herkese duyur (veya sadece hedefe io.to(targetSocketId) ile gönderilebilir)
            // Şimdilik basitlik adına tüm globale yayınlıyoruz, client kendi kontrol edecek
            io.emit('challenge-received', { 
                from: socket.nickname, 
                target: data.target,
                ticket: Math.random().toString(36).substring(7) 
            });
        }
    } catch (e) { console.log(e); }
});

socket.on('invite-meeting', async (data) => {
    try {
        const sender = await User.findById(socket.userId);
        if (sender && sender.bpl >= 10) { // Toplantı daveti 10 BPL olsun
            sender.bpl -= 10;
            await sender.save();

            socket.emit('gift-result', { 
                success: true, 
                message: "Toplantı daveti gönderildi (-10 BPL).", 
                newBalance: sender.bpl 
            });

            io.emit('meeting-request', { 
                from: socket.nickname, 
                target: data.target, 
                roomId: "GENEL_KONSEY" 
            });
        }
    } catch (e) { console.log(e); }
});




});

// --- 6. BAŞLAT ---
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`🌍 Sunucu Yayında: http://localhost:${PORT}`);
});



