require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const axios = require('axios');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');

const connectDB = require('./db');
const User = require('./models/User');
const Log = require('./models/Log'); // MongoDB Log Modeli

connectDB();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 10000; 
app.set('trust proxy', 1);

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 15, message: "Çok fazla deneme yaptınız." });

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

// --- YENİ MONGODB LOG FONKSİYONU ---
const dbLog = async (type, content) => {
    try {
        const newLog = new Log({ type, content });
        await newLog.save();
        console.log(`[DB LOG SAVED] ${type}: ${content}`);
    } catch (err) {
        console.error("Log kaydı başarısız:", err.message);
    }
};

const checkAuth = (req, res, next) => {
    if (req.session.userId) next(); else res.redirect('/');
};

// --- ROTALAR ---
app.get('/', (req, res) => {
    const userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    res.render('index', { articles: ["Arena Yayında!", "Market Güncellendi"], userIp, forceHelp: false });
});

app.get('/profil', checkAuth, async (req, res) => {
    try { const user = await User.findById(req.session.userId); res.render('profil', { user }); } catch (e) { res.redirect('/'); }
});

app.get('/market', checkAuth, async (req, res) => {
    try { const user = await User.findById(req.session.userId); res.render('market', { user }); } catch (e) { res.redirect('/profil'); }
});

app.get('/development', checkAuth, async (req, res) => {
    try { 
        const user = await User.findById(req.session.userId); 
        const selectedAnimal = req.query.animal;
        res.render('development', { user, selectedAnimal }); 
    } catch (e) { res.redirect('/profil'); }
});

app.get('/wallet', checkAuth, async (req, res) => {
    try { const user = await User.findById(req.session.userId); res.render('wallet', { user }); } catch (e) { res.redirect('/profil'); }
});

app.get('/payment', checkAuth, async (req, res) => {
    try { 
        const user = await User.findById(req.session.userId); 
        const packages = [{ usd: 10, bpl: 1000 }, { usd: 50, bpl: 5500 }, { usd: 100, bpl: 12000 }];
        res.render('payment', { user, packages, paymentText: process.env.WALLET_ADDRESS }); 
    } catch (e) { res.redirect('/profil'); }
});

app.get('/arena', checkAuth, async (req, res) => {
    try { 
        const user = await User.findById(req.session.userId); 
        const selectedAnimal = req.query.animal;
        res.render('arena', { user, selectedAnimal }); 
    } catch (e) { res.redirect('/profil'); }
});

app.get('/chat', checkAuth, async (req, res) => {
    try { const user = await User.findById(req.session.userId); res.render('chat', { user, room: 'Global' }); } catch (e) { res.redirect('/profil'); }
});

app.get('/meeting', checkAuth, async (req, res) => {
    try { 
        const user = await User.findById(req.session.userId); 
        const roomId = req.query.roomId || 'GlobalMasa';
        res.render('meeting', { user, roomId }); 
    } catch (e) { res.redirect('/profil'); }
});

app.post('/create-meeting', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        if (user && user.bpl >= 50) {
            user.bpl -= 50;
            await user.save();
            const roomId = "Masa_" + Math.random().toString(36).substr(2, 5);
            await dbLog('MEETING', `${user.nickname} elit masa kurdu: ${roomId}`); //
            res.redirect(`/meeting?roomId=${roomId}&userId=${user._id}`);
        } else {
            res.send('<script>alert("Yetersiz Bakiye!"); window.location.href="/chat";</script>');
        }
    } catch (e) { res.redirect('/chat'); }
});

// --- AUTH VE OYUN İŞLEMLERİ ---
app.post('/login', authLimiter, async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email, password });
    if (user) {
        req.session.userId = user._id;
        res.redirect('/profil');
    } else {
        res.send(`<script>alert("Hatalı Giriş!"); window.location.href="/";</script>`);
    }
});

app.post('/register', authLimiter, async (req, res) => {
    try {
        const newUser = new User({ ...req.body, bpl: 2500, inventory: [], stats: {} });
        await newUser.save();
        res.send('<script>alert("Kayıt Başarılı!"); window.location.href="/";</script>');
    } catch (e) { res.send("Kayıt Hatası."); }
});

app.post('/buy-animal', checkAuth, async (req, res) => {
    const { animalName, price } = req.body;
    try {
        const user = await User.findById(req.session.userId);
        if (user && user.bpl >= price) {
            user.bpl -= price;
            if (!user.inventory.includes(animalName)) user.inventory.push(animalName);
            if(!user.stats) user.stats = {};
            user.stats[animalName] = { hp: 100, atk: 15, def: 10 };
            user.markModified('stats'); 
            await user.save();
            await dbLog('MARKET', `${user.nickname} ${animalName} satın aldı.`); //
            res.json({ status: 'success', newBalance: user.bpl });
        } else res.json({ status: 'error', msg: 'Yetersiz Bakiye!' });
    } catch (e) { res.json({ status: 'error' }); }
});

app.post('/withdraw', checkAuth, async (req, res) => {
    const { amount } = req.body;
    try {
        const user = await User.findById(req.session.userId);
        if (amount >= 7500 && user.bpl >= amount) {
            user.bpl -= amount;
            await user.save();
            await dbLog('WALLET', `${user.nickname} ${amount} BPL çekim talebi oluşturdu.`); //
            res.json({ status: 'success', msg: 'Talebiniz alındı.' });
        } else res.json({ status: 'error', msg: 'Yetersiz bakiye veya limit altı.' });
    } catch (e) { res.json({ status: 'error' }); }
});

// --- SOCKET.IO ---
io.on('connection', (socket) => {
    
    socket.on('join-chat', (data) => {
        socket.join(data.room);
        socket.nickname = data.nickname;
        socket.roomId = data.room;
        socket.to(data.room).emit('user-joined', { nickname: data.nickname, socketId: socket.id });
        socket.emit('sync-meeting', { remaining: 90 * 60 * 1000 });
    });

// Aktif kullanıcıları sayan fonksiyon
const broadcastActiveCount = () => {
    const count = io.engine.clientsCount; // Bağlı toplam cihaz sayısı
    io.emit('update-active-count', count);
    console.log(`[SOCKET] Canlı Aktif Sayısı: ${count}`);
};

io.on('connection', (socket) => {
    // Yeni birisi girdiğinde herkese güncel sayıyı gönder
    broadcastActiveCount();

    socket.on('disconnect', () => {
        // Birisi çıktığında herkese güncel sayıyı gönder
        broadcastActiveCount();
        if (socket.roomId) socket.to(socket.roomId).emit('user-left', socket.id);
    });
    
    // Diğer mevcut kodların (join-chat vb.) burada kalmaya devam etsin...
});




    

    socket.on('chat-message', (data) => {
        io.to(data.room).emit('new-message', { sender: data.nickname, text: data.message });
    });

    socket.on('meeting-msg', (data) => {
        io.to(data.room).emit('new-meeting-msg', { sender: data.sender, text: data.text });
    });

    socket.on('send-private-invite', (data) => {
        io.emit('receive-meeting-invite', data);
    });

    socket.on('send-gift', async (data) => {
        try {
            const sender = await User.findById(data.userId);
            const receiver = await User.findOne({ nickname: data.to });
            if (sender && receiver && sender.bpl >= 6000 && data.amount <= 500) {
                sender.bpl -= data.amount;
                receiver.bpl += data.amount;
                await sender.save();
                await receiver.save();
                await dbLog('GIFT', `${sender.nickname} -> ${receiver.nickname} (${data.amount} BPL)`); //
                socket.emit('gift-result', { success: true, message: "Hediye gönderildi!", newBalance: sender.bpl });
                io.to(data.room).emit('new-message', { sender: "SİSTEM", text: `🎁 ${sender.nickname}, ${receiver.nickname}'e ${data.amount} BPL gönderdi!` });
            }
        } catch (err) {}
    });

    // --- ARENA / BOT SİSTEMİ (15 SANİYE GECİKMELİ) ---
    socket.on('join-arena', async (data) => {
        socket.join("arena_lobby");
        const user = await User.findById(data.userId);
        if (user) socket.userData = { userId: user._id.toString(), nickname: user.nickname, animal: data.selectedAnimal };
    });

    socket.on('start-search', () => {
        // Botun gelme süresi buradaki 15000 ms (15 saniye) ile ayarlanır
        setTimeout(() => {
            const botData = { nickname: "Savaşçı_Bot", animal: "Snake", userId: "BOT123" };
            const winnerId = Math.random() > 0.4 ? (socket.userData ? socket.userData.userId : "BOT123") : "BOT123";
            socket.emit('match-found', { matchId: `match_${Date.now()}`, winnerId, opponent: botData });
        }, 15000); 
    });

    socket.on('claim-victory', async (data) => {
        const user = await User.findById(data.userId);
        if (user) { 
            user.bpl += 50; 
            await user.save(); 
            await dbLog('ARENA', `${user.nickname} arena kazandı (+50 BPL)`); //
        }
    });


// --- DESTEK FORMU (BİZE ULAŞIN) ---
app.post('/contact-submit', async (req, res) => {
    try {
        const { email, message } = req.body;

        if (!email || !message) {
            return res.json({ status: 'error', msg: 'Lütfen tüm alanları doldurun.' });
        }

        // MongoDB'ye "SUPPORT" etiketiyle kaydediyoruz
        await dbLog('SUPPORT', `E-posta: ${email} | Mesaj: ${message}`);

        res.json({ 
            status: 'success', 
            msg: 'Mesajınız başarıyla MongoDB sistemine kaydedildi. En kısa sürede incelenecektir.' 
        });
    } catch (e) {
        console.error("Destek formu hatası:", e.message);
        res.status(500).json({ status: 'error', msg: 'Sistem hatası: Mesaj iletilemedi.' });
    }
});

// --- ŞİFREMİ UNUTTUM (BAŞLANGIÇ) ---
app.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) {
            return res.json({ status: 'error', msg: 'Bu e-posta adresiyle kayıtlı bir kullanıcı bulunamadı.' });
        }

        // Şimdilik sadece MongoDB'ye log atıyoruz (Mail sistemin hazır olduğunda buraya kod eklenebilir)
        await dbLog('FORGOT_PASS', `Şifre sıfırlama isteği: ${email}`);

        res.json({ 
            status: 'success', 
            msg: 'Şifre sıfırlama talebiniz alındı. (Yönetici onayı bekleniyor)' 
        });
    } catch (e) {
        res.json({ status: 'error', msg: 'İşlem sırasında bir hata oluştu.' });
    }
});


    

    // --- WebRTC ---
    socket.on('webrtc-offer', (data) => {
        socket.to(data.toSocket).emit('webrtc-offer', { offer: data.offer, fromSocket: socket.id, senderNick: data.senderNick });
    });
    socket.on('webrtc-answer', (data) => {
        socket.to(data.toSocket).emit('webrtc-answer', { answer: data.answer, fromSocket: socket.id });
    });
    socket.on('webrtc-ice-candidate', (data) => {
        socket.to(data.toSocket).emit('webrtc-ice-candidate', { candidate: data.candidate, fromSocket: socket.id });
    });

    socket.on('disconnect', () => {
        if (socket.roomId) socket.to(socket.roomId).emit('user-left', socket.id);
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`BPL SİSTEMİ AKTİF | PORT: ${PORT}`);
});




