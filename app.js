/**
 * BPL ULTIMATE - FINAL FULL SYSTEM (FIXED LIMITS & EJS ERRORS)
 */
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo').default ; // .default kaldırıldı, yeni sürümle uyumlu
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');

const User = require('./models/User');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// --- GLOBAL DEĞİŞKENLER ---
const onlineUsers = new Map();
let arenaQueue = [];
let chatHistory = [];

const BOTS = [
    { nickname: "Aslan_Bot", animal: "Lion", power: 45 },
    { nickname: "Kurt_Bot", animal: "Wolf", power: 35 },
    { nickname: "Goril_Bot", animal: "Gorilla", power: 55 },
    { nickname: "Rhino_Bot", animal: "Rhino", power: 57 }
];

function addToHistory(sender, text) {
    const msg = { sender, text, time: Date.now() };
    chatHistory.push(msg);
    if (chatHistory.length > 50) chatHistory.shift();
}

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

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email: email.toLowerCase().trim() });
        if (user && await bcrypt.compare(password, user.password)) {
            req.session.userId = user._id;
            req.session.user = user;
            return res.redirect('/profil');
        }
        res.status(401).send("Hatalı giriş bilgileri.");
    } catch (err) { res.status(500).send("Giriş hatası."); }
});

// --- 4. SAYFA YÖNETİMİ ---
app.get('/profil', authRequired, (req, res) => res.render('profil'));
app.get('/market', authRequired, (req, res) => res.render('market'));
app.get('/arena', authRequired, (req, res) => res.render('arena'));
app.get('/development', authRequired, (req, res) => res.render('development'));
app.get('/meeting', authRequired, (req, res) => res.render('meeting'));
app.get('/chat', authRequired, (req, res) => res.render('chat'));
app.get('/wallet', authRequired, (req, res) => res.render('wallet', { bpl: res.locals.user.bpl || 0 }));

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- 5. MARKET VE GELİŞTİRME API ---
app.post('/api/buy-item', authRequired, async (req, res) => {
    const { itemName, price } = req.body;
    try {
        const user = await User.findById(req.session.userId);
        if ((user.bpl - price) < 25) { 
            return res.status(400).json({ success: false, error: 'Limit Engeli: Bakiyeniz 25 BPL altına düşemez!' });
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

app.post('/api/upgrade-stat', authRequired, async (req, res) => {
    try {
        const { animalName, statType } = req.body;
        const user = await User.findById(req.session.userId);
        const animal = user.inventory.find(a => a.name === animalName);

        if (!animal) return res.status(404).json({ success: false, error: 'Hayvan bulunamadı!' });

        const cost = (statType === 'def') ? 10 : 15;
        if (user.bpl < cost + 25) return res.status(400).json({ success: false, error: 'Yetersiz bakiye (Alt limit 25 BPL)!' });

        if (statType === 'hp') {
            animal.maxHp = (animal.maxHp || 100) + 10;
            animal.hp = animal.maxHp;
        } else if (statType === 'atk') {
            animal.atk += 5;
        } else if (statType === 'def') {
            animal.def += 5;
        }

        user.bpl -= cost;
        user.markModified('inventory');
        await user.save();
        res.json({ success: true, newBalance: user.bpl });
    } catch (err) { res.status(500).json({ success: false }); }
});

// Profil sayfasındaki seçimi veritabanına kaydeder
// Profil sayfasındaki seçimi veritabanına kaydeder
app.post('/api/select-animal', authRequired, async (req, res) => {
    try {
        const { animalName } = req.body;
        // userId üzerinden kullanıcıyı bul (Garanti yöntem)
        const user = await User.findById(req.session.userId);

        if (!user) return res.json({ success: false, error: 'Kullanıcı bulunamadı.' });

        // Envanterde bu hayvan var mı kontrol et
        const hasAnimal = user.inventory.some(i => i.name === animalName);
        if (!hasAnimal) return res.json({ success: false, error: 'Bu hayvana sahip değilsiniz.' });

        user.selectedAnimal = animalName;
        await user.save();

        res.json({ success: true });
    } catch (err) {
        console.error("Seçim Hatası:", err);
        res.json({ success: false, error: 'Sunucu hatası.' });
    }
});

// --- 6. SOCKET.IO SİSTEMİ ---
io.on('connection', async (socket) => {
    const uId = socket.request.session?.userId;
    if (!uId) return;

    const user = await User.findById(uId);
    if (!user) return;

    socket.nickname = user.nickname;
    onlineUsers.set(user.nickname, socket.id);
    socket.join("general-chat");
    socket.emit('load-history', chatHistory);

    socket.on('chat-message', (data) => {
        addToHistory(socket.nickname, data.text);
        io.to("general-chat").emit('new-message', { sender: socket.nickname, text: data.text });
    });

    socket.on('join-meeting', (roomId) => { socket.join(roomId); });

    socket.on('meeting-message', (data) => {
        io.to(data.room).emit('new-meeting-message', { sender: socket.nickname, text: data.text });
    });

    socket.on('send-gift-vip', async (data) => {
        const { targetNick, amount, room } = data;
        const sender = await User.findById(uId);
        const receiver = await User.findOne({ nickname: targetNick });

        if (sender && receiver && sender.bpl >= 5500 && (sender.bpl - amount) >= 25) {
            sender.bpl -= amount;
            receiver.bpl += (amount * 0.75);
            await sender.save();
            await receiver.save();
            io.to(room).emit('new-meeting-message', { sender: 'SİSTEM', text: `${sender.nickname}, ${targetNick}'e ${amount} BPL gönderdi!` });
            socket.emit('update-bpl', sender.bpl);
        }
    });

   socket.on('arena-join-queue', async (data) => {
    try {
        // Kullanıcıyı güncel haliyle veritabanından çek (BPL kontrolü için)
        const user = await User.findOne({ nickname: socket.nickname });
        if (!user) return;
        
        // 1. AYAR: Zaten sıradaysa tekrar ekleme
        if (arenaQueue.find(p => p.nickname === user.nickname)) return;

        // 2. AYAR: Bahis miktarını düş (Veritabanı güvenliği için burada yapılır)
        const betAmount = data.bet || 25;
        const prizeAmount = data.prize || 50;
        
        if (user.bpl < betAmount) {
            return socket.emit('error', 'Yetersiz BPL bakiyesi!');
        }
        
        user.bpl -= betAmount;
        await user.save(); // Bakiyeyi hemen düş

        // 3. AYAR: Player nesnesini tam dolu gönder (Video hatasını önler)
    // 3. AYAR: Player nesnesini tam dolu gönder
        const player = {
            nickname: user.nickname,
            socketId: socket.id,
            // Seçili hayvan yoksa envanterdeki ilk hayvanı, o da yoksa Lion'u ata
            animal: (user.selectedAnimal && user.selectedAnimal !== 'none') ? user.selectedAnimal : (user.inventory[0] ? user.inventory[0].name : 'Lion'), 
            power: (user.inventory.find(i => i.name === user.selectedAnimal)?.level || 1) * 10 + Math.random() * 50,
            prize: prizeAmount
        };

        if (arenaQueue.length > 0) {
            const opponent = arenaQueue.shift();
            startBattle(player, opponent, io);
        } else {
            arenaQueue.push(player);
            // 10 Saniye bekleme ve Bot eşleşmesi
            setTimeout(async () => {
                const idx = arenaQueue.findIndex(p => p.nickname === player.nickname);
                if (idx !== -1) {
                    const randomBotName = BOTS[Math.floor(Math.random() * BOTS.length)];
                    // Bot nesnesini oyuncu nesnesiyle aynı yapıda kur (Hata vermemesi için)
                    const botObject = {
                        nickname: randomBotName + "_Bot",
                        socketId: null,
                        animal: randomBotName, // Botun hayvanı klasör adıyla aynı olmalı
                        power: Math.random() * 100,
                        prize: prizeAmount
                    };
                    startBattle(arenaQueue.splice(idx, 1)[0], botObject, io);
                }
            }, 10000);
        }
    } catch (err) {
        console.error("Sıra hatası:", err);
    }
});

async function startBattle(p1, p2, io) {
    // Güç dengesine göre kazananı belirle
    const winner = p1.power >= p2.power ? p1 : p2;
    const loser = p1.power >= p2.power ? p2 : p1;

    // 4. AYAR: Kazanan gerçek kullanıcı ise ödülü ver
    if (!winner.nickname.includes('_Bot')) {
        try {
            const winUser = await User.findOne({ nickname: winner.nickname });
            if (winUser) {
                winUser.bpl += winner.prize; // Belirlenen ödülü ekle
                winUser.markModified('inventory'); // Envanter değişikliği varsa bildir
                await winUser.save();
            }
        } catch (err) {
            console.error("Ödül verme hatası:", err);
        }
    }

    // 5. AYAR: Oyunculara sonucu bildir (Video parametrelerini düzelt)
    [p1, p2].forEach(p => {
        if (p && p.socketId) {
            io.to(p.socketId).emit('arena-match-found', {
                opponent: p === p1 ? p2 : p1,
                opponentAnimal: p === p1 ? p2.animal : p1.animal,
                winnerNick: winner.nickname,
                winnerAnimal: winner.animal,
                prize: winner.prize
            });
        }
    });

    // Genel sohbete duyuru geç
    io.emit('new-message', { 
        sender: "SİSTEM", 
        text: `📢 Arena: ${winner.nickname}, ${loser.nickname}'i mağlup etti! +${winner.prize} BPL!` 
    });
} // startBattle fonksiyonunun kapanışı

// --- SOKET BAĞLANTISI KAPANIŞI ---
socket.on('disconnect', () => {
        onlineUsers.delete(socket.nickname);
        arenaQueue = arenaQueue.filter(p => p.socketId !== socket.id);
    });
}); // <--- BU PARANTEZ EKSİK OLABİLİR (io.on kapanışı)
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 SİSTEM AKTİF: ${PORT}`));


