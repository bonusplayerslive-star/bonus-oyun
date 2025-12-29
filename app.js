require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const mongoose = require('mongoose');
const axios = require('axios');
const nodemailer = require('nodemailer');

// --- VERİTABANI BAĞLANTISI VE MODELLER ---
const connectDB = require('./db');
const User = require('./models/User');
const Log = require('./models/Log');
const Payment = require('./models/Payment');
const Victory = require('./models/Victory');
const Punishment = require('./models/Punishment');
const Income = require('./models/Income');
const Withdrawal = require('./models/Withdrawal');

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

// --- GLOBAL DEĞİŞKENLER ---
const onlineUsers = {}; 
const busyUsers = new Set();

const checkAuth = (req, res, next) => {
    if (req.session.userId) next(); else res.redirect('/');
};

// --- NODEMAILER AYARI ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});
// ==========================================
// 1. MARKET VE ENVANTER SİSTEMİ (Inventory & Market Logic)
// ==========================================

// Marketimizde satılan tüm karakterlerin listesi ve özellikleri
const MARKET_ANIMALS = [
    { id: 1, name: 'Bear', price: 1000, img: '/caracter/profile/Bear.jpg' },
    { id: 2, name: 'Crocodile', price: 1000, img: '/caracter/profile/Crocodile.jpg' },
    { id: 3, name: 'Eagle', price: 1000, img: '/caracter/profile/Eagle.jpg' },
    { id: 4, name: 'Gorilla', price: 5000, img: '/caracter/profile/Gorilla.jpg' },
    { id: 5, name: 'Kurd', price: 1000, img: '/caracter/profile/Kurd.jpg' },
    { id: 6, name: 'Lion', price: 5000, img: '/caracter/profile/Lion.jpg' },
    { id: 7, name: 'Peregrinefalcon', price: 1000, img: '/caracter/profile/Peregrinefalcon.jpg' },
    { id: 8, name: 'Rhino', price: 5000, img: '/caracter/profile/Rhino.jpg' },
    { id: 9, name: 'Snake', price: 1000, img: '/caracter/profile/Snake.jpg' },
    { id: 10, name: 'Tiger', price: 5000, img: '/caracter/profile/Tiger.jpg' }
];

/**
 * @route   POST /buy-animal
 * @desc    Kullanıcının marketten yeni bir karakter satın almasını sağlar.
 * @access  Private (Sadece giriş yapmış kullanıcılar)
 */
app.post('/buy-animal', checkAuth, async (req, res) => {
    try {
        // 1. ADIM: İstemciden gelen verileri al (Market.ejs'den gelen animalId)
        const { animalId } = req.body;

        // 2. ADIM: Veritabanından güncel kullanıcı verisini çek
        const user = await User.findById(req.session.userId);

        // 3. ADIM: Satın alınmak istenen hayvan market listesinde var mı kontrol et
        const animal = MARKET_ANIMALS.find(a => a.id == animalId);
        if (!animal) {
            return res.json({ status: 'error', msg: 'Hata: Seçilen karakter market kataloğunda bulunamadı!' });
        }

        // 4. ADIM: Envanter kapasite kontrolü (Maksimum 3 karakter kuralı)
        // Kullanıcının envanter dizisi yoksa veya uzunluğu 3'e eşit/büyükse işlemi durdur.
        if (user.inventory && user.inventory.length >= 3) {
            return res.json({ status: 'error', msg: 'Envanter dolu! Daha fazla karakter almak için birini bırakmalısın.' });
        }

        // 5. ADIM: Bakiye (BPL) kontrolü
        // Kullanıcının parası hayvanın fiyatından az ise reddet.
        if (user.bpl < animal.price) {
            return res.json({ status: 'error', msg: `Yetersiz bakiye! ${animal.name} için ${animal.price} BPL gerekiyor.` });
        }

        // 6. ADIM: Ödeme işlemini gerçekleştir
        // Kullanıcının bakiyesinden fiyatı düş.
        user.bpl -= animal.price;

        // 7. ADIM: Yeni karakteri kullanıcının envanterine ekle
        // Karakterin başlangıç istatistiklerini (Level 1, HP 100 vb.) burada tanımlıyoruz.
        user.inventory.push({ 
            name: animal.name, 
            level: 1, 
            xp: 0, 
            img: animal.img,
            stats: { 
                hp: 100,  // Sağlık Puanı
                atk: 20,  // Saldırı Gücü
                def: 10   // Savunma Gücü
            } 
        });
        
        // 8. ADIM: Değişiklikleri Veritabanına Kaydet
        await user.save();

        // 9. ADIM: Finansal kayıt (Log) oluştur
        // Harcama geçmişine bu işlemi kaydet ki kullanıcı parasının nereye gittiğini görsün.
        await new Income({ 
            userId: user._id, 
            type: 'SPEND', 
            amount: animal.price, 
            details: `Market Alışverişi: ${animal.name} karakteri satın alındı.` 
        }).save();
        
        // 10. ADIM: Başarılı yanıtını gönder
        return res.json({ 
            status: 'success', 
            msg: `Tebrikler Kumandan! ${animal.name} artık orduna dahil oldu.` 
        });

    } catch (error) { 
        // Herhangi bir beklenmedik hata oluşursa (Veritabanı bağlantısı kesilmesi vb.) burası çalışır.
        console.error("SATIN ALMA HATASI:", error);
        return res.status(500).json({ 
            status: 'error', 
            msg: 'Sunucu tarafında bir hata oluştu. Lütfen teknik ekiple iletişime geçin.' 
        }); 
    }
});
// ==========================================
// 2. GELİŞTİRME MERKEZİ
// ==========================================
app.post('/upgrade-stat', checkAuth, async (req, res) => {
    try {
        const { animalName, statType, cost } = req.body;
        const user = await User.findById(req.session.userId);
        if (user.bpl < cost) return res.json({ status: 'error', msg: 'Yetersiz bakiye!' });

        const animal = user.inventory.find(a => a.name === animalName);
        if (!animal) return res.json({ status: 'error', msg: 'Hayvan bulunamadı!' });

        user.bpl -= cost;
        if (statType === 'hp') animal.stats.hp += 10;
        else if (statType === 'atk') animal.stats.atk += 5;
        else if (statType === 'def') animal.stats.def += 5;

        user.markModified('inventory');
        await user.save();
        res.json({ status: 'success', newBalance: user.bpl });
    } catch (e) { res.json({ status: 'error', msg: 'Sunucu hatası!' }); }
});

// ==========================================
// 3. ÖDEME VE CÜZDAN SİSTEMİ
// ==========================================
app.post('/verify-payment', checkAuth, async (req, res) => {
    const { txHash, packageId } = req.body;
    try {
        const response = await axios.get(`https://api.bscscan.com/api?module=transaction&action=gettxreceiptstatus&txhash=${txHash}&apikey=${process.env.BSCSCAN_KEY}`);
        if (response.data.status === "1") {
            const user = await User.findById(req.session.userId);
            const packages = { '1': 5000, '2': 12000, '3': 30000 };
            const amount = packages[packageId];
            user.bpl += amount;
            await user.save();
            await new Payment({ userId: user._id, txHash, amount, status: 'COMPLETED' }).save();
            res.json({ status: 'success', msg: 'BPL Hesaba Eklendi!' });
        } else { res.json({ status: 'error', msg: 'İşlem Başarısız!' }); }
    } catch (e) { res.status(500).send("Doğrulama Hatası"); }
});

app.post('/request-withdrawal', checkAuth, async (req, res) => {
    const { amount, walletAddress } = req.body;
    const user = await User.findById(req.session.userId);
    if (user.bpl < amount) return res.send('Yetersiz bakiye');
    user.bpl -= amount;
    await user.save();
    await new Withdrawal({ userId: user._id, amount, walletAddress, status: 'PENDING' }).save();
    res.send('<script>alert("Talep Gönderildi!"); window.location.href="/wallet";</script>');
});

// ==========================================
// 4. ARENA VE SAVAŞ
// ==========================================
app.post('/attack-bot', checkAuth, async (req, res) => {
    const { animal } = req.query;
    const isWin = Math.random() > 0.4;
    res.json({
        status: 'success',
        animation: {
            actionVideo: `/caracter/move/${animal}/${animal}1.mp4`,
            winVideo: `/caracter/move/${animal}/${animal}.mp4`,
            isWin: isWin
        }
    });
});

app.post('/battle-complete', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    const prize = 50;
    user.bpl += prize;
    await user.save();
    await new Victory({ winner: user.nickname, prize: prize, details: 'Bot Savaşı' }).save();
    res.json({ status: 'success' });
});

app.post('/battle-punish', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    user.bpl -= 10;
    await user.save();
    await new Punishment({ userId: user._id, reason: 'Arenadan Erken Ayrılma', penalty: 10 }).save();
    res.json({ status: 'punished' });
});

// ==========================================
// 5. ANA SAYFA VE AUTH ROTALARI
// ==========================================
app.get('/', (req, res) => res.render('index', { userIp: req.ip }));

app.get('/profil', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('profil', { user });
});

app.get('/market', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('market', { user, animals: MARKET_ANIMALS });
});

app.get('/arena', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('arena', { user, selectedAnimal: req.query.animal || 'None' });
});

app.get('/wallet', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('wallet', { user });
});

app.get('/development', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('development', { user });
});

app.get('/meeting', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('meeting', { user, roomId: "BPL-5GEN-ROOM" });
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email, password });
    if (user) { req.session.userId = user._id; res.redirect('/profil'); }
    else res.send('<script>alert("Hatalı Giriş!"); window.location.href="/";</script>');
});

app.post('/register', async (req, res) => {
    try {
        const newUser = new User({ ...req.body, bpl: 2500, inventory: [] });
        await newUser.save();
        res.send('<script>alert("Hoşgeldin Kumandan!"); window.location.href="/";</script>');
    } catch (e) { res.send("Kayıt Hatası!"); }
});

// EKRAN GÖRÜNTÜSÜNDEKİ HATALARI DÜZELTEN ROTALAR
app.post('/contact', async (req, res) => {
    const { email, note } = req.body;
    await new Log({ action: 'CONTACT', details: `Kimden: ${email} | Not: ${note}` }).save();
    res.send('<script>alert("Mesajınız İletildi!"); window.location.href="/";</script>');
});

app.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (user) {
        try {
            await transporter.sendMail({
                from: process.env.EMAIL_USER,
                to: email,
                subject: 'BPL Recovery',
                text: `Kumandan, şifreniz: ${user.password}`
            });
            res.send('<script>alert("Şifre e-postanıza gönderildi!"); window.location.href="/";</script>');
        } catch (mailErr) { res.send('E-posta gönderilemedi.'); }
    } else res.send('Kullanıcı bulunamadı.');
});

// ==========================================
// 6. SOCKET SİSTEMİ
// ==========================================
io.on('connection', (socket) => {
    socket.on('register-user', (data) => {
        socket.nickname = data.nickname;
        socket.userId = data.id;
        onlineUsers[data.nickname] = socket.id;
        io.emit('update-online-players', Object.keys(onlineUsers).length);
    });

    socket.on('chat-message', (data) => {
        io.emit('new-message', { sender: data.nickname, text: data.message });
    });

    socket.on('join-arena', async (data) => {
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

    socket.on('disconnect', () => {
        if (socket.nickname) {
            delete onlineUsers[socket.nickname];
            busyUsers.delete(socket.nickname);
            io.emit('update-online-players', Object.keys(onlineUsers).length);
        }
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`BPL ECOSYSTEM OPERATIONAL ON ${PORT}`);
});

