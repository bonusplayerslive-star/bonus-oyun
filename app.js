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

// --- SESSION AYARLARI (DÜZELTİLDİ) ---
const sessionMiddleware = session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ 
        mongoUrl: MONGO_URI,
        ttl: 24 * 60 * 60 // 1 gün
    }),
    cookie: { 
        secure: false, // Render/Heroku'da SSL yoksa false kalmalı
        maxAge :24 * 60 * 60 * 1000
    }
}); // <--- BURADAKİ PARANTEZ VE NOKTALI VİRGÜL EKSİKTİ

// Session middleware'ini uygulamaya tanıtıyoruz
app.use(sessionMiddleware);

// --- TEK VE GÜÇLÜ USER MIDDLEWARE ---
app.use(async (req, res, next) => {
    res.locals.user = null; 
    if (req.session && req.session.userId) {
        try {
            const user = await User.findById(req.session.userId);
            if (user) {
                res.locals.user = user;
            } else {
                req.session.userId = null; 
            }
        } catch (e) {
            console.error("User Middleware Hatası:", e);
        }
    }
    next();
});

// --- YETKİ KONTROLLERİ ---
const authRequired = (req, res, next) => {
    if (req.session && req.session.userId) return next();
    res.redirect('/');
};

const adminRequired = async (req, res, next) => {
    if (!req.session || !req.session.userId) return res.status(401).send('Yetkisiz erişim.');
    try {
        const user = await User.findById(req.session.userId);
        if (user && user.role === 'admin') return next();
        res.status(403).render('error', { message: 'Bu alan için Admin yetkisi gerekiyor.' });
    } catch (e) {
        res.status(500).send("Admin yetki kontrolü sırasında hata oluştu.");
    }
};
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

      // app.js içindeki register kısmını bu şekilde zırhlandır:
const newUser = new User({
    nickname: nickname.trim(), // Boşlukları temizle
    email: email.toLowerCase().trim(),
    password: hashedPassword,
    bpl: 2500, 
    inventory: [],
    selectedAnimal: "none", // null yerine "none" stringi sorgularda daha güvenlidir
    stats: { wins: 0, losses: 0 },
    lastLogin: new Date(), // Kullanıcının ne zaman geldiğini takip et
    ipAddress: req.ip // Güvenlik için IP kaydı
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

        // --- GÜVENLİ VERİ ONARIM BLOĞU ---
        if (user.inventory && user.inventory.length > 0) {
            user.inventory.forEach(animal => {
                // Eğer stats objesi varsa ama ana seviyede hp yoksa onar
                if (animal.stats && typeof animal.hp === 'undefined') {
                    animal.hp = animal.stats.hp || 100;
                    animal.maxHp = animal.stats.hp || 100;
                    animal.atk = animal.stats.atk || 20;
                    animal.def = animal.stats.def || 10;
                }
                // Stamina eksikse %100 yap
                if (typeof animal.stamina === 'undefined') {
                    animal.stamina = 100;
                }
            });
            user.markModified('inventory'); // MongoDB'ye dizinin değiştiğini söyle
            await user.save();
        }
        // ---------------------------------------

        req.session.userId = user._id;
        res.redirect('/profil');
    } catch (err) {
        console.error("Login Hatası:", err);
        res.status(500).send("Giriş işlemi başarısız.");
    }
});

app.get('/auth/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- 5. OYUN İÇİ SAYFALAR (GET) ---
// Bu middleware her sayfa geçişinde çalışır
const authGuard = async (req, res, next) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }
    
    const user = await User.findById(req.session.userId);
    
    // Kullanıcı DB'den silindiyse veya session bozulduysa
    if (!user) {
        req.session.destroy();
        return res.redirect('/login');
    }

    // Her istekte kullanıcı verisini güncel tut
    res.locals.user = user;
    next();
};

// Kullanımı:
app.get('/profil', authGuard, (req, res) => {
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
            stamina: 100, 
            level: 1,
            hp: 100,      // Doğrudan erişim için dışarıda
            maxHp: 100,   // Geliştirme sayfası için gerekli
            atk: 50,      
            def: 30,      
            experience: 0,
            lastBattle: null 
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

// --- BOT TANIMLAMALARI ---
const ARENA_BOTS = [
    { nick: "Black", animal: "Tiger", winRate: 0.50, stats: { atk: 60, def: 50, hp: 120 } },
    { nick: "Deccal", animal: "Rhino", winRate: 0.60, stats: { atk: 70, def: 80, hp: 150 } },
    { nick: "Kara Melek", animal: "Lion", winRate: 0.40, stats: { atk: 55, def: 45, hp: 110 } },
    { nick: "Rass", animal: "Tiger", winRate: 0.55, stats: { atk: 65, def: 55, hp: 130 } }
];

const pvpQueue = [];

// --- 8. TÜM SİSTEMLER ENTEGRE (CHAT, ARENA, BOT, BPL, STAMINA) ---
io.on('connection', async (socket) => {
    const userId = socket.request.session?.userId;
    if (!userId) return;

    try {
        const user = await User.findById(userId);
        if (!user) return;
        
        onlineUsers.set(user.nickname, socket.id);
        socket.join("general-chat");

        // --- GLOBAL CHAT ---
        socket.on('chat-message', (data) => {
            if (!data.text || data.text.trim() === "") return;
            io.to("general-chat").emit('new-message', {
                sender: user.nickname,
                text: data.text,
                time: new Date().toLocaleTimeString()
            });
        });

        // --- ARENA DAVETİ ---
        socket.on('send-challenge', async (data) => {
            try {
                const currentUser = await User.findById(userId);
                const myAnimal = currentUser.inventory.find(a => a.name === currentUser.selectedAnimal);

                if (!myAnimal || myAnimal.stamina < 40) {
                    return socket.emit('error', { msg: "Karakterin çok yorgun! (Min. 40 Stamina)" });
                }
                if (currentUser.bpl < data.betAmount) {
                    return socket.emit('error', { msg: "Bakiyen yetersiz!" });
                }

                const targetSocketId = onlineUsers.get(data.targetNick);
                if (targetSocketId) {
                    io.to(targetSocketId).emit('receive-arena-invitation', {
                        senderNick: currentUser.nickname,
                        roomId: `room_${currentUser.nickname}_${data.targetNick}`,
                        bet: data.betAmount,
                        senderAnimal: myAnimal.name
                    });
                }
            } catch (err) { console.error("Davet Hatası:", err); }
        });

        // --- PVP EŞLEŞME ---
        socket.on('find-match', async (data) => {
            try {
                const currentUser = await User.findById(userId);
                const myAnimal = currentUser.inventory.find(a => a.name === currentUser.selectedAnimal);
                
                if (!myAnimal || myAnimal.stamina < 10) {
                    return socket.emit('error', { msg: "Karakterin çok yorgun!" });
                }

                const opponentIndex = pvpQueue.findIndex(p => p.userId !== userId);

                if (opponentIndex > -1) {
                    const opponent = pvpQueue.splice(opponentIndex, 1)[0];
                    const isWin = Math.random() > 0.5; // Basit kazanan belirleme
                    const prize = 150 * data.multiplier;

                    const battleData = {
                        prize,
                        players: [
                            { nick: currentUser.nickname, animal: myAnimal.name, img: `/caracter/profile/${myAnimal.name}.jpg` },
                            { nick: opponent.nick, animal: opponent.animalName, img: `/caracter/profile/${opponent.animalName}.jpg` }
                        ]
                    };

                    socket.emit('pvp-found', { ...battleData, isWin });
                    io.to(opponent.socketId).emit('pvp-found', { ...battleData, isWin: !isWin });

                    await updateArenaResults(userId, isWin, prize, data.multiplier);
                    await updateArenaResults(opponent.userId, !isWin, prize, opponent.multiplier);
                } else {
                    pvpQueue.push({
                        socketId: socket.id, userId, nick: currentUser.nickname,
                        animalName: myAnimal.name, animalStats: myAnimal, multiplier: data.multiplier
                    });
                }
            } catch (err) { console.error("PVP Hatası:", err); }
        });

        // --- BOT SAVAŞI ---
        socket.on('start-bot-battle', async (data) => {
            try {
                const idx = pvpQueue.findIndex(p => p.userId === userId);
                if(idx > -1) pvpQueue.splice(idx, 1);

                const currentUser = await User.findById(userId);
                const myAnimal = currentUser.inventory.find(a => a.name === currentUser.selectedAnimal);
                
                if (!myAnimal || myAnimal.stamina < 10) return socket.emit('error', { msg: "Yetersiz stamina!" });

                const isWin = Math.random() > 0.4;
                const prize = isWin ? (120 * data.multiplier) : 0;

                socket.emit('battle-result', {
                    isWin, prize, opponentName: "Arena Botu", opponentAnimal: "Wolf",
                    players: [
                        { nick: currentUser.nickname, animal: myAnimal.name, img: `/caracter/profile/${myAnimal.name}.jpg` },
                        { nick: "Arena Botu", animal: "Wolf", img: `/caracter/profile/Wolf.jpg` }
                    ]
                });

                await updateArenaResults(userId, isWin, prize, data.multiplier);
            } catch (err) { console.error("Bot Hatası:", err); }
        });

        socket.on('disconnect', () => {
            onlineUsers.delete(user.nickname);
            const idx = pvpQueue.findIndex(p => p.socketId === socket.id);
            if(idx > -1) pvpQueue.splice(idx, 1);
        });

    } catch (err) {
        console.error("Socket Bağlantı Hatası:", err);
    }
}); // <--- SOCKET BLOĞU BURADA BİTİYOR

// --- 9. YARDIMCI FONKSİYONLAR ---
async function updateArenaResults(uid, isWin, prize, mult) {
    try {
        const user = await User.findById(uid);
        if (!user) return;

        const cost = 25 * mult;
        const staminaDrain = 10 * mult; 

        let newBpl = Math.max(0, user.bpl - cost + (isWin ? prize : 0));
        const animalIndex = user.inventory.findIndex(a => a.name === user.selectedAnimal);
        
        const updateObj = { 
            $set: { bpl: newBpl }, 
            $inc: { "stats.wins": isWin ? 1 : 0, "stats.losses": isWin ? 0 : 1 } 
        };

        if (animalIndex !== -1) {
            let currentStam = user.inventory[animalIndex].stamina || 100;
            updateObj.$set[`inventory.${animalIndex}.stamina`] = Math.max(0, currentStam - staminaDrain);
        }

        await User.findByIdAndUpdate(uid, updateObj);
    } catch (e) { console.error("DB Güncelleme Hatası:", e); }
}

// --- 10. ERROR HANDLING VE 404 ---
app.use((req, res, next) => {
    res.status(404).render('error', { 
        message: 'Aradığınız sayfa BPL sisteminde bulunamadı!',
        user: res.locals.user || null
    });
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).render('error', { 
        message: 'Sunucuda kritik bir hata oluştu!',
    console.error("⛔ [FATAL ERROR]:", err.stack);
        user: res.locals.user || null
    });
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
















