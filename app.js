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
    try {
        const { animalIndex, statName, cost } = req.body;
        const user = await User.findById(req.session.userId);

        if (!user || !user.inventory[animalIndex]) {
            return res.status(404).json({ success: false, error: 'Hayvan envanterde bulunamadı!' });
        }

        if ((user.bpl - cost) < 25) {
            return res.status(400).json({ success: false, error: 'Bakiye 25 BPL altına düşemez!' });
        }

        // Değişikliği uygula
        const animal = user.inventory[animalIndex];
        if (statName === 'hp') {
            animal.maxHp += 10;
            animal.hp = animal.maxHp;
        } else if (statName === 'atk') {
            animal.atk += 5;
        } else if (statName === 'def') {
            animal.def += 5;
        }

        user.bpl -= cost;
        user.markModified('inventory'); // MongoDB'ye dizinin değiştiğini söyle
        await user.save();

        res.json({ success: true, newBpl: user.bpl });
    } catch (err) {
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










// --- 6. SOCKET.IO (CHAT, MEETING, HEDIYE & ARENA) ---
const onlineUsers = new Map(); // Global olarak tanımlı kalmalı
// Global online listesini herkese periyodik gönder
setInterval(() => {
    const onlineUsers = Array.from(io.sockets.sockets.values()).map(s => ({
        nickname: s.nickname,
        id: s.id
    }));
    io.emit('update-global-online', onlineUsers);
}, 5000);

socket.on('mute-user', (data) => {
    // data.targetPeerId'ye sahip kullanıcıya susturma sinyali gönder
    io.to(data.roomId).emit('command-mute', { peerId: data.targetPeerId });
});
io.on('connection', async (socket) => {
    const uId = socket.request.session?.userId;
    if (!uId) return;
    const user = await User.findById(uId);
    if (!user) return;

    // Kullanıcıyı kaydet ve genel odaya al
    onlineUsers.set(user.nickname, socket.id);
    socket.join("general-chat");
    console.log(`✅ ${user.nickname} bağlandı.`);

    // 1. GLOBAL CHAT SİSTEMİ
    socket.on('chat-message', (data) => {
        io.to("general-chat").emit('new-message', { 
            sender: user.nickname, 
            text: data.text 
        });
    });
let chatHistory = [];

// Mesajı hafızaya ekle ve 1 saat (3600000 ms) sonra sil
function addToHistory(sender, text) {
    const msg = { sender, text, time: Date.now() };
    chatHistory.push(msg);
    setTimeout(() => {
        chatHistory = chatHistory.filter(m => m !== msg);
    }, 3600000); 
}

io.on('connection', (socket) => {
    // Giriş yapan kullanıcıya geçmişi gönder
    socket.emit('load-history', chatHistory);

    socket.on('chat-message', (data) => {
        addToHistory(socket.nickname, data.text);
        io.emit('new-message', { sender: socket.nickname, text: data.text });
    });
});
    // 2. MEETING (ÖZEL MASA) MANTIĞI
    socket.on('join-meeting', (roomId) => {
        const roomSize = io.sockets.adapter.rooms.get(roomId)?.size || 0;
        if (roomSize < 5) { 
            socket.join(roomId);
            console.log(`🛋️ ${user.nickname} masaya katıldı: ${roomId}`);
        } else {
            socket.emit('error-message', 'Bu masa dolu! (Max 5 Kişi)');
        }
    });

    socket.on('meeting-message', (data) => {
        io.to(data.room).emit('new-meeting-message', {
            sender: user.nickname,
            text: data.text,
            time: new Date().toLocaleTimeString()
        });
    });
socket.on('send-gift-vip', async (data) => {
    const { targetNick, amount, room } = data;
    const sender = await User.findById(socket.request.session.userId);
    const receiver = await User.findOne({ nickname: targetNick });

    if (!sender || !receiver) return;

    // Şart: Bakiye 5500 ve üzeri olmalı
    if (sender.bpl < 5500) {
        return socket.emit('error-msg', 'Hediye göndermek için en az 5500 BPL gerekir!');
    }

    const totalCost = amount; // Gönderilen miktar
    const tax = amount * 0.25; // %25 kesinti
    const netAmount = amount - tax; // Karşıya giden

    if (sender.bpl - totalCost < 25) return; // Limit kontrolü

    sender.bpl -= totalCost;
    receiver.bpl += netAmount;

    await sender.save();
    await receiver.save();

    io.to(room).emit('new-meeting-message', {
        sender: 'SİSTEM',
        text: `${sender.nickname}, ${targetNick} kullanıcısına ${amount} BPL hediye gönderdi! (%25 kesinti uygulandı)`
    });
    
    // Bakiyeleri güncellemek için refresh sinyali
    socket.emit('update-bpl', sender.bpl);
});
    // 3. ARENA DAVET SİSTEMİ
    socket.on('arena-invite-request', (data) => {
        const targetSocketId = onlineUsers.get(data.to);
        if (targetSocketId) {
            io.to(targetSocketId).emit('arena-invite-received', {
                from: user.nickname, // Gönderen kişi
                roomId: data.roomId // Eğer masadan geliyorsa oda id
            });
        }
    });

    // 4. BPL HEDİYE SİSTEMİ (GÜVENLİ)
    socket.on('send-gift-bpl', async (data) => {
        try {
            const amount = parseInt(data.amount);
            const sender = await User.findById(uId);
            const receiver = await User.findOne({ nickname: data.toNickname });

            // Bakiye kontrolü (25 BPL sınırı dahil)
            if (receiver && sender.bpl >= (amount + 25) && amount > 0) {
                sender.bpl -= amount;
                receiver.bpl += amount;
                
                await sender.save();
                await receiver.save();

                const targetSid = onlineUsers.get(data.toNickname);
                if (targetSid) {
                    io.to(targetSid).emit('gift-received', {
                        from: sender.nickname,
                        amount: amount
                    });
                }
                socket.emit('gift-success', { newBalance: sender.bpl });
            } else {
                socket.emit('error-message', 'Yetersiz bakiye veya 25 BPL sınırı!');
            }
        } catch (err) {
            console.error("Hediye Hatası:", err);
            socket.emit('error-message', 'Hediye gönderilemedi.');
        }
    });

    // 5. BAĞLANTI KESİLDİĞİNDE
    socket.on('disconnect', () => {
        onlineUsers.delete(user.nickname);
        console.log(`❌ ${user.nickname} ayrıldı.`);
    });
});



// --- ARENA MATCHMAKING & BOT SİSTEMİ ---
let arenaQueue = []; // Bekleyen oyuncular havuzu

const BOTS = [
    { name: "Aslan", hp: 120, atk: 25, def: 15, img: "/caracter/profile/Lion.jpg" },
    { name: "Kurt", hp: 100, atk: 30, def: 10, img: "/caracter/profile/Wolf.jpg" },
    { name: "Goril", hp: 80, atk: 35, def: 5, img: "/caracter/profile/Gorilla.jpg" },
    { name: "Gergedan", hp: 150, atk: 20, def: 20, img: "/caracter/profile/Rhino.jpg" }
];

app.post('/api/enter-arena', authRequired, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        if (!user.selectedAnimal || user.selectedAnimal === "none") {
            return res.status(400).json({ success: false, error: 'Önce profilinden bir hayvan seçmelisiniz!' });
        }

        const playerAnimal = user.inventory.find(i => i.name === user.selectedAnimal);
        
        // Oyuncuyu sıraya ekle
        const ticket = {
            id: user._id,
            nickname: user.nickname,
            animal: playerAnimal,
            socketId: onlineUsers.get(user.nickname)
        };

        // Eğer sırada bekleyen varsa eşleştir
        if (arenaQueue.length > 0 && arenaQueue[0].id.toString() !== user._id.toString()) {
            const opponent = arenaQueue.shift();
            return res.json({ 
                success: true, 
                type: 'pvp', 
                opponent: { nickname: opponent.nickname, animal: opponent.animal } 
            });
        }

        // Kimse yoksa sıraya gir
        arenaQueue.push(ticket);

        // 13 Saniye bekle, hala sıradaysa bot ata
        setTimeout(async () => {
            const index = arenaQueue.findIndex(t => t.id.toString() === user._id.toString());
            if (index !== -1) {
                arenaQueue.splice(index, 1);
                const randomBot = BOTS[Math.floor(Math.random() * BOTS.length)];
                
                // Bot atamasını socket üzerinden veya response ile bildir
                const sid = onlineUsers.get(user.nickname);
                if (sid) {
                    io.to(sid).emit('arena-match-found', { type: 'bot', opponent: randomBot });
                }
            }
        }, 13000);

        res.json({ success: true, type: 'waiting' });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});
let arenaQueue = [];

socket.on('join-arena', (data) => {
    const userId = socket.request.session.userId;
    arenaQueue.push({ userId, socketId: socket.id });

    // 13 Saniye sonra kontrol et
    setTimeout(async () => {
        const stillInQueue = arenaQueue.find(q => q.socketId === socket.id);
        if (stillInQueue) {
            // Hala kuyruktaysa rakip gelmemiştir, BOT ata
            arenaQueue = arenaQueue.filter(q => q.socketId !== socket.id);
            socket.emit('match-found', { 
                opponent: { nickname: "BOT_KOMUTAN", hp: 120, atk: 25, def: 15, isBot: true },
                role: 'player1'
            });
        }
    }, 13000); // 13 saniye
});

io.on('connection', (socket) => {
    // Arena Giriş ve Eşleşme
    socket.on('arena-join-queue', async (data) => {
        const user = await User.findById(socket.request.session.userId);
        if (!user || user.bpl < 25) return socket.emit('error-msg', 'Yetersiz BPL!');

        // Bahis Tahsilatı (Kıyak: Yetmiyorsa sıfırla)
        const finalBet = user.bpl >= data.bet ? data.bet : user.bpl;
        user.bpl -= finalBet;
        await user.save();

        const player = {
            nickname: user.nickname,
            socketId: socket.id,
            animal: user.selectedAnimal,
            bet: finalBet,
            prize: data.prize,
            // Güç hesaplama: Level + Envanterdeki rastgele statlar 
            power: (user.inventory.find(i => i.name === user.selectedAnimal)?.level || 1) * 10 + Math.random() * 50
        };

        // Eşleşme Kontrolü
        if (arenaQueue.length > 0) {
            const opponent = arenaQueue.shift();
            startBattle(player, opponent, io);
        } else {
            arenaQueue.push(player);
            // 13 Saniye sonra BOT atama
            setTimeout(() => {
                const idx = arenaQueue.findIndex(p => p.nickname === player.nickname);
                if (idx !== -1) {
                    const botPlayer = { 
                        nickname: "System_Bot", 
                        animal: ["Lion", "Tiger", "Wolf", "Gorilla"][Math.floor(Math.random()*4)],
                        power: Math.random() * 70 // Botlar orta seviye güçte
                    };
                    startBattle(arenaQueue.splice(idx, 1)[0], botPlayer, io);
                }
            }, 13000);
        }
    });
});

async function startBattle(p1, p2, io) {
    // Gücü yüksek olan kazanır
    const winner = p1.power >= p2.power ? p1 : p2;
    const loser = p1.power >= p2.power ? p2 : p1;

    // Ödülü ver (Sadece oyuncuysa)
    if (winner.nickname !== "System_Bot") {
        const winUser = await User.findOne({ nickname: winner.nickname });
        winUser.bpl += p1.prize; // Kazanan ödülü alır
        await winUser.save();

        // GLOBAL CHAT DUYURUSU (Otomatik)
        io.to("general-chat").emit('new-message', {
            sender: "SİSTEM",
            text: `📢 ARENA HABERİ: ${winner.nickname}, ${loser.nickname}'i devirerek ${p1.prize} BPL kazandı!`
        });
    }

    // İki tarafa da sonuçları gönder
    [p1, p2].forEach(p => {
        if(p.socketId) {
            io.to(p.socketId).emit('arena-match-found', {
                opponentAnimal: p === p1 ? p2.animal : p1.animal,
                winnerAnimal: winner.animal,
                winner: winner.nickname,
                prize: p1.prize
            });
        }
    });
}
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 SİSTEM AKTİF: ${PORT}`));













