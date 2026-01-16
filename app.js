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



// Arena İçin Gerekli Değişkenler
let arenaQueue = []; // Rastgele eşleşme bekleyenler
const botNames = ["Alpha_Commander", "Cyber_Ghost", "Shadow_Warrior", "Neon_Striker", "Elite_Guard", "Dark_Sector"];
const animals = ["Gorilla", "Eagle", "Lion", "Wolf", "Cobra"];



io.on('connection', async (socket) => {
    const session = socket.request.session;
    
    // 1. KULLANICI KİMLİK DOĞRULAMA
    if (session && session.userId) {
        const user = await User.findById(session.userId);
        if (user) {
            socket.userId = user._id;
            socket.nickname = user.nickname;
            // Kullanıcıyı kendi adına sahip bir odaya al (Özel bildirimler için)
            socket.join(user.nickname); 
            console.log(`✅ ${socket.nickname} bağlandı.`);
        }
    }

    // 2. DAVET SİSTEMİ (Arena & Meeting)
    socket.on('send-invite', async (data) => {
        try {
            const { to, type, cost } = data;
            const sender = await User.findById(socket.userId);

            // Bakiye kontrolü (5500 limitini koruyarak)
            if (!sender || sender.bpl < (cost + 5500)) {
                return socket.emit('gift-result', { success: false, message: "Yetersiz bakiye veya limit (Min: 5500)!" });
            }

            sender.bpl -= cost;
            await sender.save();

            // Davet edene yeni bakiyesini yolla
            socket.emit('update-bpl', sender.bpl);

            const targetRoomId = `${sender.nickname}_Room`;

            // HEDEFE DAVET GÖNDER (Sadece hedefe gider)
            io.to(to).emit('receive-invite', {
                from: sender.nickname,
                type: type,
                roomId: targetRoomId
            });

            // GÖNDERENİ ODAYA YÖNLENDİR
            const redirectUrl = type === 'arena' ? `/arena?room=${targetRoomId}` : `/meeting?room=${targetRoomId}`;
            socket.emit('redirect-to-room', redirectUrl);

        } catch (e) { console.error("Davet Hatası:", e); }
    });

    // 3. LOJİSTİK DESTEK (Hediye/Transfer)
    socket.on('gift-bpl', async (data) => {
        try {
            const sender = await User.findById(socket.userId);
            const receiver = await User.findOne({ nickname: data.to });
            const amount = parseInt(data.amount);

            if (!receiver || isNaN(amount) || amount <= 0) return;

            // 5500 BPL Limit Kontrolü
            if (sender.bpl - amount < 5500) {
                return socket.emit('gift-result', { success: false, message: "Bakiyeniz 5500 altına düşemez!" });
            }

            // %25 Vergi Hesabı
            const tax = amount * 0.25;
            const netAmount = amount - tax;

            sender.bpl -= amount;
            receiver.bpl += netAmount;

            await sender.save();
            await receiver.save();

            // Güncel bakiyeleri taraflara bildir
            socket.emit('update-bpl', sender.bpl);
            socket.emit('gift-result', { success: true, message: `Transfer başarılı! Kesinti: ${tax} BPL` });
            
            io.to(receiver.nickname).emit('update-bpl', receiver.bpl);
            io.to(receiver.nickname).emit('new-message', { 
                sender: "[SİSTEM]", 
                text: `${sender.nickname} size ${netAmount} BPL lojistik destek gönderdi!` 
            });

        } catch (e) { console.error("Transfer Hatası:", e); }
    });

    // 4. CHAT MESAJLARI
    socket.on('chat-message', (data) => {
        if (!data.text || data.text.trim() === "") return;
        io.emit('new-message', {
            sender: socket.nickname || "Anonim",
            text: data.text
        });
    });

// --- ARENA SİSTEMİ ---

    socket.on('arena-ready', async (data) => {
        const { mult, cost, room, nick, animal } = data;
        const sender = await User.findById(socket.userId);

        if (!sender || sender.bpl < cost) return socket.emit('error-msg', 'Yetersiz BPL!');

        // Bakiyeyi baştan düş (Senaryo gereği)
        sender.bpl -= cost;
        await sender.save();
        socket.emit('update-bpl', sender.bpl);

        const playerData = {
            id: socket.id,
            userId: sender._id,
            nick: nick,
            animal: animal,
            stats: {
                power: sender.power || 10,
                attack: sender.attack || 10,
                defense: sender.defense || 10
            },
            mult: mult,
            cost: cost
        };

        // 1. ÖZEL ODA KONTROLÜ (Chat/Meeting'den gelenler)
        if (room) {
            socket.join(room);
            const clients = io.sockets.adapter.rooms.get(room);
            if (clients.size === 2) {
                // İki kişi odaya girdi, savaşı başlat
                startBattle(room, cost);
            }
        } 
        // 2. GENEL HAVUZ KONTROLÜ
        else {
            arenaQueue.push(playerData);
            
            // Eğer havuzda 2 kişi olduysa hemen eşleştir
            if (arenaQueue.length >= 2) {
                const p1 = arenaQueue.shift();
                const p2 = arenaQueue.shift();
                const randomRoom = "arena_" + Math.random().toString(36).substring(7);
                
                io.to(p1.id).socketsJoin(randomRoom);
                io.to(p2.id).socketsJoin(randomRoom);
                
                startBattle(randomRoom, cost, [p1, p2]);
            } else {
                // 13 Saniye sonra hala yalnızsa bot ata
                setTimeout(async () => {
                    const stillInQueue = arenaQueue.findIndex(p => p.id === socket.id);
                    if (stillInQueue > -1) {
                        const player = arenaQueue.splice(stillInQueue, 1)[0];
                        createBotMatch(player);
                    }
                }, 13000);
            }
        }
    });

    // SAVAŞ HESAPLAMA VE BAŞLATMA FONKSİYONU
    async function startBattle(roomId, cost, manualPlayers = null) {
        const sockets = await io.in(roomId).fetchSockets();
        let players = [];

        if (manualPlayers) {
            players = manualPlayers;
        } else {
            // Odadaki gerçek kullanıcı verilerini topla (Özel odalar için)
            for (const s of sockets) {
                const u = await User.findById(s.userId);
                players.push({
                    id: s.id,
                    userId: u._id,
                    nick: u.nickname,
                    animal: u.selectedAnimal,
                    stats: { power: u.power, attack: u.attack, defense: u.defense }
                });
            }
        }

        // KAZANAN HESAPLAMA FORMÜLÜ: (Güç + Saldırı + Savunma) - (Savunma / 8)
        const calculateScore = (p) => (p.stats.power + p.stats.attack + p.stats.defense) - (p.stats.defense / 8);
        
        const p1Score = calculateScore(players[0]);
        const p2Score = calculateScore(players[1]);

        const winnerIndex = p1Score >= p2Score ? 0 : 1;
        const winner = players[winnerIndex];
        const loser = players[winnerIndex === 0 ? 1 : 0];

        // Kazananın Ödülü (Örn: Giriş ücretinin 1.8 katı)
        const prize = cost * 1.8;
        const winnerUser = await User.findById(winner.userId);
        winnerUser.bpl += prize;
        await winnerUser.save();

        // Her iki tarafa sonuçları ve animasyon komutunu gönder
        io.to(roomId).emit('match-started', {
            players: players,
            winner: { nick: winner.nick, animal: winner.animal },
            prize: prize
        });
    }

    // BOT EŞLEŞTİRME
    async function createBotMatch(player) {
        const botAnimal = animals[Math.floor(Math.random() * animals.length)];
        const botNick = botNames[Math.floor(Math.random() * botNames.length)];
        
        const botData = {
            nick: botNick,
            animal: botAnimal,
            stats: { power: 15, attack: 15, defense: 15 } // Standart bot gücü
        };

        // Botla olan savaşta da aynı formül geçerli
        const pScore = (player.stats.power + player.stats.attack + player.stats.defense) - (player.stats.defense / 8);
        const bScore = (botData.stats.power + botData.stats.attack + botData.stats.defense) - (botData.stats.defense / 8);

        const isWin = pScore >= bScore;
        const prize = player.cost * 1.8;

        if(isWin) {
            const u = await User.findById(player.userId);
            u.bpl += prize;
            await u.save();
        }

        io.to(player.id).emit('match-started', {
            players: [player, botData],
            winner: isWin ? player : botData,
            prize: isWin ? prize : 0
        });
    }




    

    socket.on('disconnect', () => {
        if (socket.nickname) console.log(`🔌 ${socket.nickname} ayrıldı.`);
    });
});

// --- 6. BAŞLAT ---
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`🌍 Sunucu Yayında: http://localhost:${PORT}`);
});







