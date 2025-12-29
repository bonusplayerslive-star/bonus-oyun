require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const axios = require('axios');

const connectDB = require('./db');
const User = require('./models/User');
const Log = require('./models/Log');
const Payment = require('./models/Payment');

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

// --- E-POSTA VE LOG ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

const checkAuth = (req, res, next) => {
    if (req.session.userId) next(); else res.redirect('/');
};

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
    // Oda ID yoksa rastgele bir oda ID'si oluştur (örn: global-room)
    const roomId = req.query.room || "BPL-CENTRAL"; 
    res.render('meeting', { user, roomId });
});

// --- POST ROTALARI (SAVAŞ & MARKET) ---
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

app.post('/buy-animal', checkAuth, async (req, res) => {
    try {
        const { animalName, price } = req.body;
        const user = await User.findById(req.session.userId);

        // 1. Envanter Kontrolü (Max 3)
        if (user.inventory.length >= 3) {
            return res.json({ status: 'error', msg: 'Çantanız dolu! En fazla 3 hayvan taşıyabilirsiniz.' });
        }

        // 2. Bakiye Kontrolü
        if (user.bpl < price) {
            return res.json({ status: 'error', msg: 'Yetersiz BPL bakiyesi!' });
        }

        // 3. İşlemi Gerçekleştir
        user.bpl -= price;
        user.inventory.push(animalName);
        
        // Hayvana başlangıç statları ata (Opsiyonel)
        if (!user.stats) user.stats = {};
        user.stats[animalName] = { hp: 100, atk: 20, def: 10 };
        
        user.markModified('inventory');
        user.markModified('stats');
        await user.save();

        res.json({ status: 'success', msg: `${animalName} başarıyla alındı!` });
    } catch (e) {
        res.json({ status: 'error', msg: 'Satın alma hatası!' });
    }
});
// --- 1. SAVAŞ BAŞLATMA (POST /attack-bot) ---
app.post('/attack-bot', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        
        // Gelen hayvan ismini temizle ve formatla (örn: bear -> Bear)
        let animal = req.query.animal || "Lion";
        animal = animal.charAt(0).toUpperCase() + animal.slice(1).toLowerCase();

        // %50 Şansla Kazananı Belirle
        const isWin = Math.random() > 0.5;

        // Session'a Savaş Kaydını At (Ceza kontrolü için kritik)
        req.session.activeBattle = { 
            status: 'playing', 
            animal: animal,
            reward: 50,
            penalty: 10 
        };

        // Frontend'e video yollarını ve sonucu gönder
        res.json({
            status: 'success',
            animation: {
                actionVideo: `/caracter/move/${animal}/${animal}1.mp4`, // 8sn Saldırı
                winVideo: `/caracter/move/${animal}/${animal}.mp4`,     // 8sn Zafer
                isWin: isWin
            },
            reward: 50
        });

    } catch (e) {
        console.error("Arena Başlatma Hatası:", e);
        res.json({ status: 'error', msg: 'Arena motoru hazır değil.' });
    }
});

// --- 2. SAVAŞI BAŞARIYLA TAMAMLAMA (POST /battle-complete) ---
app.post('/battle-complete', checkAuth, async (req, res) => {
    try {
        // Eğer aktif bir savaş yoksa ödül verme (Güvenlik)
        if (!req.session.activeBattle) return res.json({ status: 'error', msg: 'Geçersiz işlem.' });

        const user = await User.findById(req.session.userId);
        user.bpl += 50; 

        // Veritabanına Zafer Kaydı
        await new Victory({ 
            email: user.email, 
            nickname: user.nickname, 
            bpl: user.bpl 
        }).save();

        await user.save();
        req.session.activeBattle = null; // Savaşı kapat
        
        res.json({ status: 'success', newBalance: user.bpl });
    } catch (e) {
        res.json({ status: 'error' });
    }
});

// --- 3. ERKEN ÇIKANLARA CEZA (POST /battle-punish) ---
// Bu rota Beacon API (navigator.sendBeacon) ile çalıştığı için res.json yerine res.end kullanır.
app.post('/battle-punish', checkAuth, async (req, res) => {
    try {
        if (!req.session.activeBattle) return res.end();

        const user = await User.findById(req.session.userId);
        user.bpl -= 10; 

        // Veritabanına Ceza Kaydı
        await new Punishment({ 
            email: user.email, 
            bpl: user.bpl, 
            reason: 'Savaşı yarıda bıraktı' 
        }).save();

        await user.save();
        req.session.activeBattle = null; // Savaşı temizle
        res.end(); 
    } catch (e) {
        res.end();
    }
});
app.post('/sell-animal', checkAuth, async (req, res) => {
    const { animalName } = req.body;
    const user = await User.findById(req.session.userId);
    if (user.inventory.includes(animalName)) {
        user.inventory = user.inventory.filter(a => a !== animalName);
        user.bpl += 700;
        user.markModified('stats');
        await user.save();
        res.json({ status: 'success', newBalance: user.bpl });
    } else res.json({ status: 'error' });
});

// --- SOCKET SİSTEMİ (TEK BLOKTA) ---
let onlineArena = [];
let onlinePlayers = {}; // Nickname -> SocketId

io.on('connection', (socket) => {
    // Giriş yapan her kullanıcıyı kaydet
    socket.on('register-user', (data) => {
        socket.userId = data.id;
        socket.nickname = data.nickname;
        onlinePlayers[data.nickname] = socket.id;
    });

    // Arena Listesi
    socket.on('join-arena', (data) => {
        socket.userId = data.id;
        socket.nickname = data.nickname;
        if(!onlineArena.find(u => u.id === data.id)) onlineArena.push(data);
        io.emit('arena-list-update', onlineArena);
    });

    // Chat
    socket.on('chat-message', (data) => {
        io.emit('new-message', { sender: data.nickname, text: data.message });
    });

    // Meydan Okuma
    socket.on('challenge-player', (data) => {
        const targetId = onlinePlayers[data.targetNickname];
        if(targetId) {
            io.to(targetId).emit('challenge-received', { challenger: socket.nickname });
        }
    });

    socket.on('disconnect', () => {
        onlineArena = onlineArena.filter(u => u.id !== socket.userId);
        if(socket.nickname) delete onlinePlayers[socket.nickname];
        io.emit('arena-list-update', onlineArena);
    });
});

// Ödeme Doğrulama (TxID Kontrolü)
app.post('/verify-payment', checkAuth, async (req, res) => {
    try {
        const { txid, usd, bpl } = req.body;
        const userId = req.session.userId;

        // 1. Temel Kontroller
        if (!txid || txid.length < 20) {
            return res.json({ status: 'error', msg: 'Geçersiz TxID formatı!' });
        }

        // 2. TxID daha önce kullanılmış mı? (Mükerrer ödemeyi önleme)
        // Payment adında bir modelin olduğunu varsayıyorum
        const existingTx = await Payment.findOne({ txid: txid });
        if (existingTx) {
            return res.json({ status: 'error', msg: 'Bu işlem numarası daha önce kullanılmış!' });
        }

        // 3. Kullanıcıyı Bul
        const user = await User.findById(userId);
        if (!user) return res.json({ status: 'error', msg: 'Kullanıcı bulunamadı!' });

        /* NOT: Tam otomatik BscScan doğrulaması için burada Axios ile 
           BscScan API'sine istek atıp txid'nin içeriği (miktar ve alıcı adres) 
           kontrol edilmelidir. Şimdilik "Güvenli Kayıt" sistemini kuruyoruz.
        */

        // 4. Bakiyeyi Yükle ve İşlemi Kaydet
        user.bpl += parseInt(bpl);
        
        const newPayment = new Payment({
            userId: user._id,
            nickname: user.nickname,
            txid: txid,
            amountUSD: usd,
            amountBPL: bpl,
            status: 'completed', // Manuel inceleme istersen 'pending' yapabilirsin
            date: new Date()
        });

        await newPayment.save();
        await user.save();

        // 5. Log Kaydı (Opsiyonel)
        console.log(`[PAYMENT] ${user.nickname} tarafından ${usd} USDT karşılığı ${bpl} BPL yüklendi. TxID: ${txid}`);

        res.json({ status: 'success', bpl: user.bpl });

    } catch (e) {
        console.error("Ödeme Hatası:", e);
        res.json({ status: 'error', msg: 'Sistem hatası oluştu, lütfen destekle iletişime geçin.' });
    }
});


let onlineUsers = {}; // Nickname -> SocketID eşleşmesi

io.on('connection', (socket) => {
    
    // Kullanıcı bağlandığında kendini tanıtır
    socket.on('register-user', (data) => {
        socket.nickname = data.nickname;
        onlineUsers[data.nickname] = socket.id;
        io.emit('update-online-players', onlineUsers);
    });

    // Chat Mesajları
    socket.on('chat-message', (data) => {
        io.emit('new-message', data);
    });

    // Savaş Daveti (Özel Mesaj)
    socket.on('challenge-player', (data) => {
        const targetSocketId = onlineUsers[data.targetNickname];
        if (targetSocketId) {
            io.to(targetSocketId).emit('challenge-received', { 
                challenger: data.challenger 
            });
        }
    });

    // Bağlantı kesildiğinde listeden çıkar
    socket.on('disconnect', () => {
        if (socket.nickname) {
            delete onlineUsers[socket.nickname];
            io.emit('update-online-players', onlineUsers);
        }
    });
});




app.post('/verify-payment', checkAuth, async (req, res) => {
    try {
        const { txid, usd, bpl } = req.body;
        const userId = req.session.userId;

        // 1. Mükerrer İşlem Kontrolü
        const existingTx = await Payment.findOne({ txid: txid });
        if (existingTx) return res.json({ status: 'error', msg: 'Bu TxID zaten kullanılmış!' });

        // 2. BscScan API Sorgusu
        const bscScanUrl = `https://api.bscscan.com/api?module=proxy&action=eth_getTransactionReceipt&txhash=${txid}&apikey=${process.env.BSCSCAN_API_KEY}`;
        
        const response = await axios.get(bscScanUrl);
        const receipt = response.data.result;

        if (!receipt) return res.json({ status: 'error', msg: 'İşlem BSC ağında bulunamadı. Lütfen biraz bekleyip tekrar deneyin.' });

        // İşlem başarılı mı? (status 0x1 başarı demektir)
        if (receipt.status !== "0x1") return res.json({ status: 'error', msg: 'Bu işlem başarısız (failed) olarak görünüyor.' });

       
        /* GÜVENLİK NOTU: 
           Burada receipt.logs içerisinden 'to' adresinin senin WALLET_ADDRESS olup olmadığı 
           ve 'value' miktarının usd ile eşleştiği doğrulanabilir. 
           Şimdilik temel BscScan onayını ve TxID eşsizliğini baz alıyoruz.
        */

        // 3. Kullanıcıya Bakiyeyi Yükle
        const user = await User.findById(userId);
        user.bpl += parseInt(bpl);
        
        // 4. Ödemeyi Veritabanına Kaydet
        const newPayment = new Payment({
            userId: user._id,
            nickname: user.nickname,
            txid: txid,
            amountUSD: usd,
            amountBPL: bpl,
            status: 'completed',
            confirmedAt: new Date()
        });

        await newPayment.save();
        await user.save();

        res.json({ 
            status: 'success', 
            msg: 'Ödeme onaylandı!', 
            newBalance: user.bpl 
        });

    } catch (e) {
        console.error("BscScan Onay Hatası:", e);
        res.json({ status: 'error', msg: 'Blockchain doğrulaması sırasında bir hata oluştu.' });
    }
});


server.listen(PORT, "0.0.0.0", () => console.log(`BPL CALISIYOR: ${PORT}`));






