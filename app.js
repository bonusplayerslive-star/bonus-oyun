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
const activeRooms = {}; 

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
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) return res.send("Kullanıcı bulunamadı.");

        // Şifre kontrolü (bcrypt kullanıyorsan compare yapmalısın)
        if (user.password !== password) return res.send("Hatalı şifre.");

        req.session.userId = user._id; // Session kaydı
        res.redirect('/profil'); // Başarılıysa profile git
    } catch (err) {
        console.log(err);
        res.send("Bir hata oluştu.");
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
        
        // 1. Karakter Kontrolü
        const animal = user.inventory.find(a => a.name === animalName);
        if (!animal) return res.json({ success: false, error: "Karakter bulunamadı!" });

        // 2. Ücret Belirleme
        let cost = 0;
        if (statType === 'def') cost = 10;
        else if (statType === 'stamina') cost = 10;
        else cost = 15; // attack ve power için

        // 3. Bakiye Kontrolü
        if (user.bpl < cost) {
            return res.json({ success: false, error: "Yetersiz BPL!" });
        }

        // 4. Geliştirme İşlemi
        if (statType === 'stamina') {
            animal.stamina = 100; // Enerjiyi fulle
        } else {
            // attack, power veya def için +10 ekle
            animal[statType] = (animal[statType] || 0) + 10;
        }

        // 5. Kayıt ve Yanıt
        user.bpl -= cost;
        user.markModified('inventory'); // MongoDB'ye array içindeki değişikliği bildir
        await user.save();

        return res.json({ 
            success: true, 
            newBalance: user.bpl, 
            newValue: animal[statType],
            statType: statType 
        });

    } catch (err) {
        console.error("Geliştirme Hatası:", err);
        return res.status(500).json({ success: false, error: "Sunucu hatası oluştu!" });
    }
});
// --- 1. DEĞİŞKENLER ---
let arenaQueue = []; 
const botNames = ["Alpha_Commander", "Cyber_Ghost", "Shadow_Warrior", "Neon_Striker", "Elite_Guard"];
const botAnimalsList = ["Gorilla", "Eagle", "Lion", "Wolf", "Cobra"];

// --- 2. SOCKET BAĞLANTISI (ANA BLOK) ---
io.on('connection', async (socket) => {
    const session = socket.request.session;
    
    if (session && session.userId) {
        const user = await User.findById(session.userId);
        if (user) {
            socket.userId = user._id;
            socket.nickname = user.nickname;
            socket.join(user.nickname); 
            console.log(`✅ Bağlantı: ${socket.nickname}`);
        }
    }
// 1. ODA HAFIZASI (Dosyanın en üstünde, io.on dışında 1 kez kalsın)
const activeRooms = {}; 

io.on('connection', (socket) => {
    console.log(`[BAĞLANTI] Bir kullanıcı bağlandı: ${socket.nickname || socket.id}`);

    // --- 2. ODAYA KATILIM (Meeting & Arena) ---
    socket.on('join-meeting', (roomId, peerId, nickname) => {
        if (!roomId || !nickname) return;
        
        socket.join(roomId);
        socket.roomId = roomId;
        socket.nickname = nickname;
        socket.peerId = peerId;

        if (!activeRooms[roomId]) {
            activeRooms[roomId] = { members: [] };
        }
        
        // Üye listede yoksa ekle
        if (!activeRooms[roomId].members.find(m => m.nickname === nickname)) {
            activeRooms[roomId].members.push({ nickname, peerId });
        }

        // Güncel listeyi odadakilere ve global online listesini herkese gönder
        updateAllLists(roomId);
        
        // Diğer üyelere görüntülü arama sinyali
        socket.to(roomId).emit('user-connected', peerId, nickname);
        console.log(`[ODA] ${nickname} -> ${roomId} odasına girdi.`);
    });

socket.on('chat-message', (data) => {
    // Boş mesajları engelle
    if (!data.text || data.text.trim() === "") return;

    const msgObj = {
        sender: socket.nickname || "Misafir",
        text: data.text.trim(),
        time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
        room: data.room || 'GENEL'
    };

    if (data.room && data.room !== 'GENEL') {
        // Sadece özel odaya bir kez gönder
        io.to(data.room).emit('new-message', msgObj);
    } else {
        // Sadece genel chat'e bir kez gönder
        io.emit('new-message', msgObj);
    }
});

    // --- 4. DAVET SİSTEMİ ---
    socket.on('send-invite', (data) => {
        const { to, type } = data;
        const sharedRoomId = `KONSEY_${socket.nickname}_${Date.now().toString().slice(-4)}`;
        const link = `/${type}?room=${sharedRoomId}`;
        
        io.to(to).emit('receive-invite-request', { 
            from: socket.nickname, 
            roomId: sharedRoomId, 
            type: type 
        });
        socket.emit('redirect-to-room', link);
    });

    socket.on('accept-invite', (data) => {
        const link = `/${data.type}?room=${data.roomId}`;
        socket.emit('redirect-to-room', link);
    });

    // --- 5. BPL TRANSFER ---
    socket.on('transfer-bpl', async (data) => {
        try {
            if (!socket.userId) return;
            const sender = await User.findById(socket.userId);
            const receiver = await User.findOne({ nickname: data.to });
            const amount = parseInt(data.amount);

            if (receiver && sender.bpl >= (amount + 5500) && amount >= 50) {
                sender.bpl -= amount;
                const netAmount = Math.floor(amount * 0.75);
                receiver.bpl += netAmount;
                await sender.save();
                await receiver.save();

                socket.emit('update-bpl', sender.bpl);
                io.to(receiver.nickname).emit('update-bpl', receiver.bpl);
                socket.emit('gift-result', { success: true, message: `${netAmount} BPL gönderildi.` });
            }
        } catch (e) { console.error("Transfer Hatası:", e); }
    });

    // --- 6. AYRILMA VE TEMİZLİK ---
    socket.on('disconnect', () => {
        const rId = socket.roomId;
        if (rId && activeRooms[rId]) {
            activeRooms[rId].members = activeRooms[rId].members.filter(m => m.nickname !== socket.nickname);
            socket.to(rId).emit('user-disconnected', socket.peerId);
            updateAllLists(rId);
            if (activeRooms[rId].members.length === 0) delete activeRooms[rId];
        }
    });

    // Yardımcı Fonksiyon (io.on içinde olmalı)
    async function updateAllLists(roomId) {
        const allSockets = await io.fetchSockets();
        const globalOnline = allSockets.map(s => s.nickname).filter(n => n);
        const roomMembers = activeRooms[roomId] ? activeRooms[roomId].members.map(m => m.nickname) : [];
        
        if(roomId) {
            io.to(roomId).emit('update-lists', { globalOnline, roomMembers });
            // Eski tip liste bekleyen sayfalar için:
            io.to(roomId).emit('update-council-list', roomMembers);
        }
        io.emit('update-user-list', allSockets.map(s => ({ nickname: s.nickname })));
    }

}); // <--- İŞTE UNUTTUĞUN KAPATMA PARANTEZİ BU!

// 3. AYRILMA VE TEMİZLİK
socket.on('disconnect', () => {
    const rId = socket.roomId;
    if (rId && activeRooms[rId]) {
        // Üyeyi listeden çıkar
        activeRooms[rId].members = activeRooms[rId].members.filter(m => m.nickname !== socket.nickname);
        
        // Kalanlara yeni listeyi bildir
        const newList = activeRooms[rId].members.map(m => m.nickname);
        io.to(rId).emit('update-council-list', newList);
        
        // Görüntüsünü kaldır
        socket.to(rId).emit('user-disconnected', socket.peerId);

        // Kimse kalmadıysa RAM'den temizle
        if (activeRooms[rId].members.length === 0) delete activeRooms[rId];
    }
});
// DAVET GÖNDERME
socket.on('send-invite', async (data) => {
    const { to, type } = data; // type: 'meeting' veya 'arena'
    const sharedRoomId = `KONSEY_${socket.nickname}_${Date.now().toString().slice(-4)}`;
    
    // Davet edene link gönder
    const link = `/${type}?room=${sharedRoomId}`;
    
    // Karşı tarafa onay kutusu gönder
    io.to(to).emit('receive-invite-request', { 
        from: socket.nickname, 
        roomId: sharedRoomId, 
        type: type 
    });
    
    // Davet edeni de odaya yönlendirmek için emir ver
    socket.emit('redirect-to-room', link);
});

// DAVET KABUL
socket.on('accept-invite', (data) => {
    const link = `/${data.type}?room=${data.roomId}`;
    socket.emit('redirect-to-room', link);
});
    
// ======================================================
// --- 3. LOJİSTİK DESTEK (BPL TRANSFERİ) ---
// ======================================================

socket.on('transfer-bpl', async (data) => {
    try {
        if (!socket.userId) return;
        const sender = await User.findById(socket.userId);
        const receiver = await User.findOne({ nickname: data.to });
        const amount = parseInt(data.amount);

        if (receiver && sender.bpl >= (amount + 5500) && amount >= 50) {
            sender.bpl -= amount;
            const netAmount = Math.floor(amount * 0.75); // %25 Komisyon
            receiver.bpl += netAmount;
            
            await sender.save();
            await receiver.save();

            // Bakiyeleri güncelle
            socket.emit('update-bpl', sender.bpl);
            io.to(receiver.nickname).emit('update-bpl', receiver.bpl);
            
            socket.emit('gift-result', { success: true, message: `${netAmount} BPL iletildi.` });

            // Sadece odadaki konsey üyelerine duyur
            const currentRoom = Array.from(socket.rooms).find(r => r.includes('VIP_'));
            if (currentRoom) {
                io.to(currentRoom).emit('new-message', { 
                    sender: "SİSTEM", 
                    text: `📢 DESTEK: ${sender.nickname} -> ${receiver.nickname} (${netAmount} BPL)`,
                    time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
                });
            }
        } else {
            socket.emit('error-msg', 'İşlem reddedildi: Limit veya bakiye yetersiz.');
        }
    } catch (e) { console.error("Transfer Hatası:", e); }
});

// 4. AYRILMA VE ODA TEMİZLİĞİ
socket.on('disconnect', () => {
    for (const roomId in activeRooms) {
        if (activeRooms[roomId].members.includes(socket.nickname)) {
            activeRooms[roomId].members = activeRooms[roomId].members.filter(m => m !== socket.nickname);
            
            // Odada kimse kalmadıysa sil
            if (activeRooms[roomId].members.length === 0) {
                delete activeRooms[roomId];
            } else {
                // Kalanlara listeyi güncelle
                io.to(roomId).emit('update-council-list', activeRooms[roomId].members);
                // Lider çıktıysa bilgilendir
                if (activeRooms[roomId].leader === socket.nickname) {
                    io.to(roomId).emit('new-message', { sender: "SİSTEM", text: "Oda lideri ayrıldı." });
                }
            }
        }
    }
});
    // ARENA MOTORU
    socket.on('arena-ready', async (data) => {
        try {
            const { mult, room, nick, animal } = data;
            const multiplier = parseInt(mult) || 1;
            const entryFee = 25 * multiplier;
            const sender = await User.findById(socket.userId);

            if (!sender || sender.bpl < entryFee) return socket.emit('error-msg', 'Yetersiz BPL!');

            sender.bpl -= entryFee;
            await sender.save();
            socket.emit('update-bpl', sender.bpl);

            const playerData = {
                id: socket.id, userId: sender._id, nick, animal,
                stats: { power: sender.power || 10, attack: sender.attack || 10, defense: sender.defense || 10 },
                cost: entryFee
            };

            if (room) {
                socket.join(room);
                const clients = io.sockets.adapter.rooms.get(room);
                if (clients && clients.size === 2) startBattle(room, entryFee);
            } else {
                arenaQueue.push(playerData);
                if (arenaQueue.length >= 2) {
                    const p1 = arenaQueue.shift();
                    const p2 = arenaQueue.shift();
                    const aRoom = "arena_" + Date.now();
                    
                    const s1 = io.sockets.sockets.get(p1.id);
                    const s2 = io.sockets.sockets.get(p2.id);
                    if(s1) s1.join(aRoom);
                    if(s2) s2.join(aRoom);
                    
                    startBattle(aRoom, entryFee, [p1, p2]);
                } else {
                    // 13 saniye sonra bot rakip ata
                    setTimeout(() => {
                        const idx = arenaQueue.findIndex(p => p.id === socket.id);
                        if (idx > -1) createBotMatch(arenaQueue.splice(idx, 1)[0]);
                    }, 13000);
                }
            }
        } catch (e) { console.error("Arena Hatası:", e); }
    });

    socket.on('disconnect', () => {
        if (socket.nickname) console.log(`🔌 ${socket.nickname} ayrıldı.`);
        arenaQueue = arenaQueue.filter(p => p.id !== socket.id);
    });



// --- 3. SAVAŞ FONKSİYONLARI (DIŞARIDA OLMALI) ---

async function startBattle(roomId, cost, manualPlayers = null) {
    try {
        let players = manualPlayers;
        if (!players) {
            const sockets = await io.in(roomId).fetchSockets();
            players = [];
            for (const s of sockets) {
                const u = await User.findById(s.userId);
                if(u) {
                    players.push({ 
                        id: s.id, userId: u._id, nick: u.nickname, animal: u.selectedAnimal,
                        stats: { power: u.power || 10, attack: u.attack || 10, defense: u.defense || 10 } 
                    });
                }
            }
        }
        
        if (!players || players.length < 2) return;

        // GÜÇ HESABI
        const calc = (p) => (p.stats.power + p.stats.attack + p.stats.defense);
        const winnerIdx = calc(players[0]) >= calc(players[1]) ? 0 : 1;
        const winner = players[winnerIdx];
        const prize = Math.floor(cost * 1.8);

        if (winner.userId) { 
            const winnerUser = await User.findById(winner.userId);
            if (winnerUser) { 
                winnerUser.bpl += prize; 
                await winnerUser.save(); 
            }
        }

        // TAM VERİ GÖNDERİMİ
        io.to(roomId).emit('match-started', { 
            players: players, 
            winner: { nick: winner.nick, animal: winner.animal }, 
            prize: prize 
        });
    } catch (err) { console.log("Savaş Hatası:", err); }
}

async function createBotMatch(player) {
    const botData = {
        nick: botNames[Math.floor(Math.random() * botNames.length)],
        animal: botAnimalsList[Math.floor(Math.random() * botAnimalsList.length)],
        stats: { power: 12, attack: 12, defense: 12 },
        userId: null
    };
    startBattle(player.id, player.cost, [player, botData]);
}


// --- BAĞLANTI KESİLME YÖNETİMİ ---
    socket.on('disconnect', () => {
        console.log(`[BPL-SİSTEM] Kullanıcı ayrıldı: ${socket.nickname}`);

        // Tüm aktif odaları tara
        for (const roomId in activeRooms) {
            let room = activeRooms[roomId];
            
            // Eğer ayrılan kişi bu odanın üyesiyse
            if (room.members.includes(socket.nickname)) {
                // Üyeyi listeden temizle
                room.members = room.members.filter(m => m !== socket.nickname);
                
                // Odada kalanlara güncel listeyi gönder (Sağdaki panel güncellensin)
                io.to(roomId).emit('update-council-list', room.members);
                
                // Odadaki diğer üyelere görüntünün kapandığını bildir (PeerJS ID'si ile)
                // Not: socket.peerId'yi join-meeting'de socket'e bağladıysan kullanabilirsin
                io.to(roomId).emit('user-disconnected', socket.peerId);

                // EĞER ODA LİDERİ AYRILDIYSA (Racon Gereği)
                if (room.leader === socket.nickname) {
                    io.to(roomId).emit('new-message', { 
                        sender: "SİSTEM", 
                        text: "Oda lideri konseyden ayrıldı. Masa dağıtılıyor..." 
                    });
                    
                    // 5 saniye sonra odayı tamamen silmek istersen:
                    setTimeout(() => {
                        delete activeRooms[roomId];
                    }, 5000);
                }
            }
if (room && room.members.length === 0) {
                delete activeRooms[roomId];
            }
        } // for döngüsü sonu
    }); // socket.on('disconnect') sonu

}); // <--- BU ÇOK ÖNEMLİ! io.on('connection') ana bloğunu kapatır.

// --- 4. SERVER BAŞLAT ---
const PORT = process.env.PORT || 10000;
httpServer.listen(PORT, () => {
    console.log(`🌍 Sunucu Yayında: http://localhost:${PORT}`);
});










