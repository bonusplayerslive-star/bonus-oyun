/**
 * BPL ULTIMATE - CORE APPLICATION FILE
 * -----------------------------------------
 * Sürüm: 2.0.1 (Production Ready)
 * Özellikler: Market, Arena v2, Meeting, Wallet, Admin Panel, 
 * Gelişmiş Loglama, Gerçek Zamanlı Socket Odaları.
 */

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo').default;
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer'); // Mail onayı ve şifre işlemleri için

// Modellerin yüklenmesi
const User = require('./models/User');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// --- 1. VERİTABANI VE ÇEVRESEL AYARLAR ---
const MONGO_URI = process.env.MONGO_URI;
const SESSION_SECRET = process.env.SESSION_SECRET || 'bpl_ultimate_megasecret_2024';

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ [DATABASE] MongoDB bağlantısı başarıyla kuruldu.'))
    .catch(err => console.error('❌ [DATABASE] MongoDB hatası:', err));

// --- 2. MIDDLEWARE YAPILANDIRMASI ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionMiddleware = session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ 
        mongoUrl: MONGO_URI,
        ttl: 24 * 60 * 60 // Oturum 1 gün sürer
    }),
    cookie: { 
        secure: false, // Render/Heroku'da SSL yoksa false, varsa true
        maxAge: 1000 * 60 * 60 * 24 
    }
});

app.use(sessionMiddleware);
io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
});

// --- 3. GÜVENLİK VE YETKİLENDİRME ---
const authRequired = (req, res, next) => {
    if (req.session.userId) return next();
    res.redirect('/');
};

const adminRequired = async (req, res, next) => {
    if (!req.session.userId) return res.status(401).send('Yetkisiz erişim.');
    const user = await User.findById(req.session.userId);
    if (user && user.role === 'admin') return next();
    res.status(403).render('error', { message: 'Bu alan için Admin yetkisi gerekiyor.' });
};

// Global User Değişkeni (Tüm EJS dosyalarında kullanıcı verisine erişmek için)
app.use(async (req, res, next) => {
    if (req.session.userId) {
        try {
            const user = await User.findById(req.session.userId);
            res.locals.user = user;
        } catch (e) { res.locals.user = null; }
    } else {
        res.locals.user = null;
    }
    next();
});

// --- 4. ANA SAYFA VE AUTH ROTALARI ---

app.get('/', (req, res) => {
    if (req.session.userId) return res.redirect('/profil');
    res.render('index', { title: 'BPL Ultimate - Giriş' });
});

app.post('/auth/register', async (req, res) => {
    const { nickname, email, password } = req.body;
    try {
        const existing = await User.findOne({ $or: [{ email }, { nickname }] });
        if (existing) return res.status(400).send("Nickname veya Email zaten kullanımda.");

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = new User({
            nickname,
            email,
            password: hashedPassword,
            bpl: 7500, // Hoşgeldin bonusu
            inventory: [],
            stats: { wins: 0, losses: 0 }
        });

        await newUser.save();
        res.redirect('/');
    } catch (err) {
        res.status(500).send("Sunucu hatası oluştu.");
    }
});

app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) return res.status(400).send("Kullanıcı bulunamadı.");

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).send("Hatalı şifre.");

        req.session.userId = user._id;
        res.redirect('/profil');
    } catch (err) {
        res.status(500).send("Giriş işlemi başarısız.");
    }
});

app.get('/auth/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- 5. OYUN İÇİ SAYFALAR (GET) ---

app.get('/profil', authRequired, async (req, res) => {
    res.render('profil', { user: res.locals.user });
});

app.get('/market', authRequired, async (req, res) => {
    res.render('market', { user: res.locals.user });
});

app.get('/arena', authRequired, async (req, res) => {
    // Online kullanıcıları çekmek için logic buraya eklenebilir
    res.render('arena', { user: res.locals.user });
});

app.get('/meeting', authRequired, async (req, res) => {
    res.render('meeting', { user: res.locals.user });
});

app.get('/wallet', authRequired, async (req, res) => {
    res.render('wallet', { user: res.locals.user });
});

// --- 5. OYUN İÇİ SAYFALAR (GET) ---

// Geliştirme sayfası rotası
app.get('/development', authRequired, async (req, res) => {
    res.render('development', { user: res.locals.user });
});

// --- 6. MARKET VE EKONOMİ API'LERİ ---

app.post('/api/buy-item', authRequired, async (req, res) => {
    const { itemName, price } = req.body;
    try {
        const user = await User.findById(req.session.userId);
        
        // 1. KONTROL: En fazla 3 karakter sınırı
        if (user.inventory && user.inventory.length >= 3) {
            return res.status(400).json({ success: false, error: 'Maksimum karakter sınırına (3) ulaştınız!' });
        }

        // 2. KONTROL: Bakiye kontrolü (Market için stratejik limit yok demiştin)
        if (user.bpl < price) {
            return res.status(400).json({ success: false, error: 'Yetersiz bakiye!' });
        }

        const alreadyOwned = user.inventory.some(i => i.name === itemName);
        if (alreadyOwned) return res.status(400).json({ success: false, error: 'Bu karaktere zaten sahipsiniz.' });

        user.bpl -= price;
        user.inventory.push({
            name: itemName,
            img: `/caracter/profile/${itemName}.jpg`,
            stamina: 100, // Savaş için gereken enerji
            level: 1,
            hp: 100,      // Mevcut Can
            maxHp: 100,   // Kalıcı Geliştirilebilir Maks Can
            atk: 50,      // Kalıcı Saldırı
            def: 30,      // Kalıcı Savunma
            experience: 0,
            lastBattle: null // 2 saatlik kontrol için tarih tutabiliriz
        });

        await user.save();
        res.json({ success: true, newBpl: user.bpl });
    } catch (err) {
        res.status(500).json({ success: false, error: 'İşlem sırasında bir hata oluştu.' });
    }
});

// GELİŞTİRME API: Stat yükseltme ve Kalıcı Kayıt
app.post('/api/upgrade-stat', authRequired, async (req, res) => {
    const { animalName, statType } = req.body;
    // Senin EJS'ndeki fiyatlandırma: DEF=10, Diğerleri=15
    const cost = (statType === 'def') ? 10 : 15;

    try {
        const user = await User.findById(req.session.userId);
        
        if (user.bpl < cost) return res.status(400).json({ success: false, error: 'Yetersiz BPL.' });

        const animalIndex = user.inventory.findIndex(a => a.name === animalName);
        if (animalIndex === -1) return res.status(404).json({ success: false, error: 'Karakter bulunamadı.' });

        // Stat artış oranları
        let increase = (statType === 'hp') ? 10 : 5;

        user.bpl -= cost;
        
        // Kalıcı geliştirme (Mongo'ya kayıt)
        if (statType === 'hp') {
            user.inventory[animalIndex].maxHp += increase;
            user.inventory[animalIndex].hp += increase; // Canı da doldur
        } else {
            user.inventory[animalIndex][statType] += increase;
        }
        
        // Seviye atlama mantığı (Her 5 geliştirmede 1 seviye gibi basit bir kural)
        const totalStats = user.inventory[animalIndex].maxHp + user.inventory[animalIndex].atk + user.inventory[animalIndex].def;
        user.inventory[animalIndex].level = Math.floor(totalStats / 50);

        await user.save();
        res.json({ success: true, newBalance: user.bpl });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Sunucu hatası.' });
    }
});
// --- 7. ADMIN PANELİ VE GÜVENLİK ---

app.get('/admin', adminRequired, async (req, res) => {
    const allUsers = await User.find().select('-password');
    res.render('admin_panel', { users: allUsers });
});

app.post('/admin/add-bpl', adminRequired, async (req, res) => {
    const { targetUserId, amount } = req.body;
    await User.findByIdAndUpdate(targetUserId, { $inc: { bpl: amount } });
    res.json({ success: true });
});

// --- 8. REAL-TIME ENGINE (SOCKET.IO) ---

const onlineUsers = new Map(); // Nickname -> SocketID

io.on('connection', (socket) => {
    const session = socket.request.session;
    if (!session.userId) return;

    User.findById(session.userId).then(user => {
        if (!user) return;
        
        onlineUsers.set(user.nickname, socket.id);
        socket.join("general-chat");
        console.log(`📡 [SOCKET] ${user.nickname} bağlandı.`);

        // Chat Sistemi
        socket.on('chat-message', (data) => {
            io.to("general-chat").emit('new-message', {
                sender: user.nickname,
                text: data.text,
                time: new Date().toLocaleTimeString()
            });
        });

        // Arena Davet Mekanizması
        socket.on('send-challenge', (data) => {
            const targetSocketId = onlineUsers.get(data.targetNick);
            if (targetSocketId) {
                io.to(targetSocketId).emit('receive-arena-invitation', {
                    senderNick: user.nickname,
                    roomId: `room_${user.nickname}_${data.targetNick}`,
                    bet: data.betAmount
                });
            }
        });

        // Arena Dövüş Mantığı (Gelişmiş)
        socket.on('join-fight', (data) => {
            socket.join(data.roomId);
            console.log(`⚔️ [ARENA] ${user.nickname} odaya katıldı: ${data.roomId}`);
        });

        socket.on('attack', (data) => {
            // Zar atma ve hasar hesaplama logic'i
            const damage = Math.floor(Math.random() * 20) + 5;
            io.to(data.roomId).emit('attack-result', {
                attacker: user.nickname,
                damage: damage,
                targetHp: data.currentHp - damage
            });
        });

        socket.on('disconnect', () => {
            onlineUsers.delete(user.nickname);
            console.log(`🔌 [SOCKET] ${user.nickname} ayrıldı.`);
        });
    });
});

// --- 9. ERROR HANDLING VE 404 ---

// 404 Handler - Eğer 404.ejs dosyan yoksa bu blok seni kurtarır.
app.use((req, res, next) => {
    res.status(404).render('error', { 
        message: 'Aradığınız sayfa BPL sisteminde bulunamadı!',
        user: res.locals.user 
    });
});

// Global Hata Yakalayıcı
app.use((err, req, res, next) => {
    console.error("⛔ [FATAL ERROR]:", err.stack);
    res.status(500).send("Sunucuda kritik bir hata oluştu. Lütfen logları kontrol edin.");
});

// --- 10. SERVER START ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`
    ===========================================
    🚀 BPL ULTIMATE SUNUCUSU AKTİF!
    📡 Port: ${PORT}
    🌐 Mod: Production
    🔐 Session: Aktif (MongoDB Store)
    ===========================================
    `);
});



