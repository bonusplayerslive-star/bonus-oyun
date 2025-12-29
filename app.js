require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');

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

// BOT SAVAŞI (VİDEO DESTEKLİ)
app.post('/attack-bot', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const animal = req.query.animal || user.inventory[0];
        if(!animal) return res.json({status:'error', msg:'Hayvan yok!'});

        const pStats = user.stats[animal] || { hp: 120, atk: 20, def: 15 };
        const win = (pStats.hp + pStats.atk) > 130; // Basit mantık
        const reward = win ? 150 : 0;

        if(win) {
            user.bpl += reward;
            await user.save();
        }

        res.json({
            status: 'success',
            winner: win ? user.nickname : 'Elite_Bot',
            reward,
            animation: {
                actionVideo: `/caracter/move/${animal}/${animal}1.mp4`,
                winVideo: `/caracter/move/${animal}/${animal}.mp4`,
                isWin: win
            }
        });
    } catch (e) { res.json({status:'error'}); }
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

server.listen(PORT, "0.0.0.0", () => console.log(`BPL CALISIYOR: ${PORT}`));

