require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const mongoose = require('mongoose');
const axios = require('axios');

const connectDB = require('./db');
const User = require('./models/User');
const Log = require('./models/Log');
const Payment = require('./models/Payment');
const Victory = require('./models/Victory'); 
const Punishment = require('./models/Punishment');
const Income = require('./models/Income'); 

connectDB();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 10000;
app.set('trust proxy', 1);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
    secret: 'bpl_ozel_anahtar',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));
app.set('view engine', 'ejs');

// --- AUTH MIDDLEWARE ---
const checkAuth = (req, res, next) => {
    if (req.session.userId) next(); else res.redirect('/');
};

// 1. Bunlar dosyanın en üstünde, require'ların altında olsun
const onlineUsers = {}; 
const busyUsers = new Set();

// 2. Socket.io ana bloğu
io.on('connection', (socket) => {
    console.log('Yeni bağlantı:', socket.id);

    // Kullanıcı Kaydı
    socket.on('register-user', (data) => {
        socket.nickname = data.nickname;
        socket.userId = data.id;
        onlineUsers[data.nickname] = socket.id;
        io.emit('update-online-players', Object.keys(onlineUsers).length);
    });

    // ARENA EŞLEŞME (Burası rakip bulmanı sağlar)
    socket.on('join-arena', () => {
        // Meşgul olmayan başka birini ara
        const opponentNickname = Object.keys(onlineUsers).find(nick => 
            nick !== socket.nickname && !busyUsers.has(nick)
        );

        if (opponentNickname) {
            const opponentSocketId = onlineUsers[opponentNickname];
            const roomId = `arena_${socket.nickname}_${opponentNickname}`;

            socket.join(roomId);
            const opponentSocket = io.sockets.sockets.get(opponentSocketId);
            if (opponentSocket) opponentSocket.join(roomId);

            busyUsers.add(socket.nickname);
            busyUsers.add(opponentNickname);

            io.to(roomId).emit('match-found', { 
                player1: socket.nickname, 
                player2: opponentNickname,
                roomId: roomId 
            });
        } else {
            socket.emit('waiting-for-opponent');
        }
    });

    // Bağlantı kopunca temizlik
    socket.on('disconnect', () => {
        if (socket.nickname) {
            delete onlineUsers[socket.nickname];
            busyUsers.delete(socket.nickname);
            io.emit('update-online-players', Object.keys(onlineUsers).length);
        }
    });
}); // <--- Ana blok burada bitiyor







// --- GET ROTALARI ---
app.get('/', (req, res) => res.render('index', { userIp: req.ip }));

app.get('/profil', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('profil', { user });
});

app.get('/market', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('market', { user });
});

app.get('/arena', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('arena', { user, selectedAnimal: req.query.animal });
});

app.get('/chat', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('chat', { user });
});

app.get('/wallet', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('wallet', { user });
});

app.get('/payment', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('payment', { user });
});

app.get('/meeting', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    const roomId = req.query.roomId || "BPL-CENTRAL"; 
    res.render('meeting', { user, roomId });
});


// --- GELİŞTİRME MERKEZİ ROTALARI ---
app.get('/development', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('development', { user }); // views/development.ejs dosyasını açar
});
app.post('/upgrade-stat', checkAuth, async (req, res) => {
    try {
        const { animalName, statType, cost } = req.body;
        const user = await User.findById(req.session.userId);

        if (user.bpl < cost) {
            return res.json({ status: 'error', msg: 'Yetersiz BPL!' });
        }

        // BPL Düşür
        user.bpl -= cost;

        // Stats alanı boşsa başlat (Senin eklediğin stats objesi burada devreye giriyor)
        if (!user.stats[animalName]) {
            user.stats[animalName] = { hp: 100, atk: 20, def: 10 };
        }

        // İstatistiği artır
        if (statType === 'hp') user.stats[animalName].hp += 10;
        else if (statType === 'atk') user.stats[animalName].atk += 5;
        else if (statType === 'def') user.stats[animalName].def += 5;

        // Mongoose'a objenin değiştiğini haber ver (Object tipi için şarttır)
        user.markModified('stats'); 
        
        await user.save();
        res.json({ status: 'success', newBalance: user.bpl });
    } catch (e) {
        res.json({ status: 'error', msg: 'Sunucu hatası!' });
    }
});
// --- POST ROTALARI (GİRİŞ & KAYIT) ---
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email, password });
    if (user) { req.session.userId = user._id; res.redirect('/profil'); }
    else res.send('<script>alert("Hatalı Giriş!"); window.location.href="/";</script>');
});

app.post('/register', async (req, res) => {
    try {
        const newUser = new User({ ...req.body, bpl: 2500 });
        await newUser.save();
        res.send('<script>alert("Kayıt Başarılı!"); window.location.href="/";</script>');
    } catch (e) { res.send("Kayıt Hatası!"); }
});

// --- MARKET İŞLEMLERİ ---
app.post('/buy-animal', checkAuth, async (req, res) => {
    try {
        const { animalName, price } = req.body;
        const user = await User.findById(req.session.userId);
        if (user.inventory.length >= 3) return res.json({ status: 'error', msg: 'Çantanız dolu!' });
        if (user.bpl < price) return res.json({ status: 'error', msg: 'Yetersiz BPL!' });

        user.bpl -= price;
        user.inventory.push(animalName);
        user.markModified('inventory');
        await user.save();
        res.json({ status: 'success', msg: `${animalName} alındı!` });
    } catch (e) { res.json({ status: 'error' }); }
});

app.post('/sell-animal', checkAuth, async (req, res) => {
    const { animalName } = req.body;
    const user = await User.findById(req.session.userId);
    if (user.inventory.includes(animalName)) {
        user.inventory = user.inventory.filter(a => a !== animalName);
        user.bpl += 700;
        await user.save();
        res.json({ status: 'success', newBalance: user.bpl });
    } else res.json({ status: 'error' });
});

// --- BEŞGEN MASA OLUŞTURMA ---
app.post('/create-meeting', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        if (user.bpl < 50) return res.send("<script>alert('Yetersiz BPL (50 Gerekiyor)'); window.history.back();</script>");

        user.bpl -= 50;
        await user.save();

        const roomId = "Masa_" + Math.random().toString(36).substr(2, 9);
        await new Income({ userId: user._id, nickname: user.nickname, amount: 50, roomId }).save();

        io.emit('receive-meeting-invite', { from: user.nickname, room: roomId, toNick: "Herkes" });
        res.redirect(`/meeting?roomId=${roomId}`);
    } catch (e) { res.redirect('/chat'); }
});

// --- ARENA SAVAŞ MOTORU ---
app.post('/attack-bot', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        let animal = req.query.animal || "Lion";
        animal = animal.charAt(0).toUpperCase() + animal.slice(1).toLowerCase();
        const isWin = Math.random() > 0.5;

        req.session.activeBattle = { status: 'playing', reward: 50 };
        res.json({ status: 'success', animation: {
            actionVideo: `/caracter/move/${animal}/${animal}1.mp4`,
            winVideo: `/caracter/move/${animal}/${animal}.mp4`,
            isWin: isWin
        }});
    } catch (e) { res.json({ status: 'error' }); }
});

app.post('/battle-complete', checkAuth, async (req, res) => {
    if (!req.session.activeBattle) return res.json({ status: 'error' });
    const user = await User.findById(req.session.userId);
    user.bpl += 50;
    await new Victory({ email: user.email, nickname: user.nickname, bpl: user.bpl }).save();
    await user.save();
    req.session.activeBattle = null;
    res.json({ status: 'success', newBalance: user.bpl });
});

app.post('/battle-punish', checkAuth, async (req, res) => {
    if (!req.session.activeBattle) return res.end();
    const user = await User.findById(req.session.userId);
    user.bpl -= 10;
    await new Punishment({ email: user.email, bpl: user.bpl, reason: 'Yarıda Bırakma' }).save();
    await user.save();
    req.session.activeBattle = null;
    res.end();
});

// --- BSC SCAN ÖDEME DOĞRULAMA ---
app.post('/verify-payment', checkAuth, async (req, res) => {
    try {
        const { txid, usd, bpl } = req.body;
        const existingTx = await Payment.findOne({ txid });
        if (existingTx) return res.json({ status: 'error', msg: 'TxID kullanılmış!' });

        const bscScanUrl = `https://api.bscscan.com/api?module=proxy&action=eth_getTransactionReceipt&txhash=${txid}&apikey=${process.env.BSCSCAN_API_KEY}`;
        const response = await axios.get(bscScanUrl);
        if (response.data.result && response.data.result.status === "0x1") {
            const user = await User.findById(req.session.userId);
            user.bpl += parseInt(bpl);
            await new Payment({ userId: user._id, txid, amountUSD: usd, amountBPL: bpl, status: 'completed' }).save();
            await user.save();
            return res.json({ status: 'success', newBalance: user.bpl });
        }
        res.json({ status: 'error', msg: 'Blockchain onayı alınamadı.' });
    } catch (e) { res.json({ status: 'error' }); }
});

// --- SOCKET SİSTEMİ (ARENA, CHAT, MEETING & GIFT) ---


// 2. Arena Eşleşme (Burası Online Rakip Bulmanı Sağlar)
    socket.on('join-arena', async (data) => {
        // Boşta bekleyen bir rakip var mı kontrol et
        const opponentNickname = Object.keys(onlineUsers).find(nick => 
            nick !== socket.nickname && !busyUsers.has(nick)
        );

        if (opponentNickname) {
            const opponentSocketId = onlineUsers[opponentNickname];
            const roomId = `arena_${socket.nickname}_${opponentNickname}`;

            // İki oyuncuyu da aynı odaya (room) sok
            socket.join(roomId);
            io.to(opponentSocketId).emit('invite-to-room', { roomId, opponent: socket.nickname });

            // Kullanıcıları meşgul olarak işaretle (Başka maça girmesinler)
            busyUsers.add(socket.nickname);
            busyUsers.add(opponentNickname);

            io.to(roomId).emit('match-found', { 
                player1: socket.nickname, 
                player2: opponentNickname,
                roomId: roomId 
            });
        } else {
            // Rakip yoksa bekleme moduna al (Elite Bot uyarısı burada devreye girer)
            socket.emit('waiting-for-opponent');
        }
    });

    // 2. Global Chat Olayları
    socket.on('join-chat', (data) => { socket.join('Global'); });

    socket.on('chat-message', (data) => {
        io.emit('new-message', { 
            sender: data.nickname, 
            text: data.message 
        });
    });

    // 3. HEDİYE SİSTEMİ
    socket.on('send-gift', async (data) => {
        try {
            const sender = await User.findById(data.userId || socket.userId);
            const receiver = await User.findOne({ nickname: data.to });

            if (!sender || !receiver) return;

            if (data.room === 'Global' && sender.bpl < 6000) {
                return socket.emit('gift-result', { message: "Hediye için en az 6000 BPL bakiye gerekir!" });
            }

            const giftAmount = parseInt(data.amount);
            if (giftAmount > 0 && sender.bpl >= giftAmount) {
                sender.bpl -= giftAmount;
                receiver.bpl += giftAmount;
                await sender.save();
                await receiver.save();

                socket.emit('gift-result', { 
                    newBalance: sender.bpl, 
                    message: `${data.to} kişisine ${giftAmount} BPL gönderildi!` 
                });

                const announceMsg = `🎁 ${sender.nickname} -> ${receiver.nickname} kullanıcısına ${giftAmount} BPL hediye etti!`;
                if(data.room) {
                    io.to(data.room).emit('new-message', { sender: "SİSTEM", text: announceMsg });
                } else {
                    io.emit('new-message', { sender: "SİSTEM", text: announceMsg });
                }
            }
        } catch (e) { console.log("Hediye hatası:", e); }
    });

    // 4. BEŞGEN MASA & MEYDAN OKUMA
    socket.on('join-room', (data) => {
        socket.join(data.roomId);
        io.to(data.roomId).emit('new-message', { 
            sender: 'Sistem', 
            text: `🚀 ${data.nickname} masaya oturdu. Hoş geldin!` 
        });
    });

    socket.on('challenge-player', (data) => {
        const targetSocketId = onlineUsers[data.targetNickname];
        if (targetSocketId) {
            io.to(targetSocketId).emit('challenge-received', { challenger: socket.nickname });
        }
    });

    socket.on('disconnect', () => {
        if (socket.nickname) delete onlineUsers[socket.nickname];
        io.emit('update-online-players', Object.keys(onlineUsers).length);
    });


// --- SERVER START ---
server.listen(PORT, "0.0.0.0", () => {
    console.log(`BPL SERVER RUNNING ON PORT ${PORT}`);
});






