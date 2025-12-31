// --- 1. MODÜLLER VE AYARLAR ---
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const path = require('path');

// --- 2. VERİTABANI VE MODELLER ---
const connectDB = require('./db');
const User = require('./models/User');
const Payment = require('./models/Payment');
const Withdrawal = require('./models/Withdrawal');
// Diğer modeller (Log, ArenaLogs vb.) gerekliyse buraya eklenebilir

connectDB();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 10000;

// --- 3. MIDDLEWARE (ARA KATMANLAR) ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.set('trust proxy', 1);

app.use(session({
    secret: 'bpl_ozel_anahtar',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// Giriş ve Yetki Kontrolleri
const checkAuth = (req, res, next) => {
    if (req.session.userId) next(); else res.redirect('/');
};

const checkAdmin = async (req, res, next) => {
    try {
        const user = await User.findById(req.session.userId);
        if (user && user.role === 'admin') next(); 
        else res.status(403).send("Erişim Reddedildi: Yetkisiz Giriş.");
    } catch (err) { res.status(500).send("Yetki hatası."); }
};

// --- 4. SAYFA ROTALARI (GET) ---

app.get('/', (req, res) => res.render('index', { user: req.session.userId || null }));

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
    res.render('arena', { user, selectedAnimal: user.inventory[0]?.name || "Eagle" });
});

app.get('/wallet', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('wallet', { user });
});

app.get('/payment', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('payment', { user });
});

app.get('/development', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('development', { user });
});

app.get('/admin-panel', checkAuth, checkAdmin, async (req, res) => {
    const pendingPayments = await Payment.find({ status: 'pending' }).populate('userId');
    const pendingWithdraws = await Withdrawal.find({ status: 'pending' }).populate('userId');
    res.render('admin-panel', { pendingPayments, pendingWithdraws });
});

// --- 5. İŞLEM ROTALARI (POST) ---

// Kayıt ve Giriş
app.post('/register', async (req, res) => {
    const { nickname, email, password } = req.body;
    try {
        const exists = await User.findOne({ email });
        if (exists) return res.send('<script>alert("E-posta kayıtlı!"); window.location.href="/";</script>');
        const newUser = new User({ nickname, email, password, bpl: 2500, inventory: [] });
        await newUser.save();
        res.send('<script>alert("Kayıt başarılı! 2500 BPL hediye edildi."); window.location.href="/";</script>');
    } catch (err) { res.status(500).send("Sunucu hatası!"); }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email, password });
        if (user) {
            req.session.userId = user._id;
            res.redirect('/profil');
        } else {
            res.send('<script>alert("Hatalı giriş!"); window.location.href="/";</script>');
        }
    } catch (err) { res.redirect('/'); }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// Market İşlemleri
app.post('/buy-animal', checkAuth, async (req, res) => {
    try {
        const { animalId } = req.body;
        const user = await User.findById(req.session.userId);
        const MARKET_DATA = {
            "1": { name: 'Bear', price: 1000 }, "2": { name: 'Crocodile', price: 1000 },
            "3": { name: 'Eagle', price: 1000 }, "4": { name: 'Gorilla', price: 5000 },
            "5": { name: 'Kurd', price: 1000 }, "6": { name: 'Lion', price: 5000 },
            "7": { name: 'Falcon', price: 1000 }, "8": { name: 'Rhino', price: 5000 },
            "9": { name: 'Snake', price: 1000 }, "10": { name: 'Tiger', price: 5000 }
        };
        const selected = MARKET_DATA[animalId];
        if (!selected || user.bpl < selected.price) return res.json({ status: 'error', msg: 'Yetersiz bakiye veya geçersiz ürün!' });
        
        user.bpl -= selected.price;
        user.inventory.push({
            name: selected.name, level: 1,
            img: `/caracter/profile/${selected.name.toLowerCase()}.jpg`,
            stats: { hp: 100, atk: 20, def: 15 }
        });
        await user.save();
        res.json({ status: 'success' });
    } catch (err) { res.status(500).json({ status: 'error' }); }
});

// Geliştirme İşlemleri
app.post('/upgrade-stat', checkAuth, async (req, res) => {
    try {
        const { animalName, statType, cost } = req.body;
        const user = await User.findById(req.session.userId);
        const animalIndex = user.inventory.findIndex(a => a.name === animalName);

        if (animalIndex === -1 || user.bpl < cost) return res.json({ status: 'error', msg: 'İşlem yapılamadı!' });

        user.bpl -= cost;
        if (statType === 'hp') user.inventory[animalIndex].stats.hp += 10;
        if (statType === 'atk') user.inventory[animalIndex].stats.atk += 5;
        if (statType === 'def') user.inventory[animalIndex].stats.def += 5;

        user.markModified('inventory');
        await user.save();
        res.json({ status: 'success', msg: 'Geliştirme tamamlandı!' });
    } catch (err) { res.status(500).json({ status: 'error' }); }
});

// Arena (Savaş) İşlemleri
app.post('/attack-bot', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        if (user.bpl < 200) return res.json({ status: 'error', msg: 'Savaş için en az 200 BPL gerekli!' });

        const animalName = (req.body.animal || "Eagle").trim();
        const isWin = Math.random() > 0.5;

        if (isWin) {
            user.bpl += 200;
            io.to('GlobalChat').emit('new-message', { sender: "ARENA", text: `🏆 ${user.nickname}, ${animalName} ile zafer kazandı!` });
        } else {
            user.bpl -= 200;
        }
        await user.save();
        res.json({ status: 'success', animation: { isWin, actionVideo: `/caracter/move/${animalName}/${animalName}1.mp4`, winVideo: `/caracter/move/${animalName}/${animalName}.mp4` } });
    } catch (err) { res.status(500).json({ status: 'error' }); }
});

// Finansal İşlemler (Wallet & Payment)
app.post('/save-wallet-address', checkAuth, async (req, res) => {
    const { usdtAddress } = req.body;
    if (!usdtAddress || usdtAddress.length < 40) return res.json({ status: 'error', msg: 'Geçersiz adres!' });
    const user = await User.findById(req.session.userId);
    user.usdt_address = usdtAddress;
    await user.save();
    res.json({ status: 'success', msg: 'Adres kaydedildi.' });
});

app.post('/verify-payment', checkAuth, async (req, res) => {
    const { txid, usd, bpl } = req.body;
    const exists = await Payment.findOne({ txid });
    if (exists) return res.json({ status: 'error', msg: 'Bu TxID zaten kullanılmış!' });

    const newPayment = new Payment({ userId: req.session.userId, txid, amount_usd: usd, amount_bpl: bpl, status: 'pending' });
    await newPayment.save();
    res.json({ status: 'success', msg: 'Ödeme bildirimi alındı, onay bekleniyor.' });
});

app.post('/withdraw', checkAuth, async (req, res) => {
    const amount = parseInt(req.body.amount);
    const user = await User.findById(req.session.userId);
    if (user.bpl < amount || amount < 7500) return res.json({ status: 'error', msg: 'Bakiye yetersiz veya limit altı!' });

    user.bpl -= amount;
    await user.save();
    const newW = new Withdrawal({ userId: user._id, amount, address: user.usdt_address, status: 'pending' });
    await newW.save();
    res.json({ status: 'success', msg: 'Tasfiye talebi iletildi.' });
});

app.post('/sell-character', checkAuth, async (req, res) => {
    const { animalIndex, fiyat } = req.body;
    const user = await User.findById(req.session.userId);
    if (user.inventory.length <= 1) return res.json({ status: 'error', msg: 'Son karakter satılamaz!' });

    const refund = parseInt(fiyat) * 0.70;
    user.bpl += refund;
    user.inventory.splice(animalIndex, 1);
    user.markModified('inventory');
    await user.save();
    res.json({ status: 'success', msg: 'Satış başarılı!' });
});

// Admin Aksiyonları
app.post('/admin/approve-payment', checkAuth, checkAdmin, async (req, res) => {
    const payment = await Payment.findById(req.body.paymentId);
    if (payment && payment.status === 'pending') {
        const user = await User.findById(payment.userId);
        user.bpl += payment.amount_bpl;
        payment.status = 'completed';
        await user.save(); await payment.save();
        res.json({ status: 'success', msg: 'Onaylandı.' });
    }
});

app.post('/admin/approve-withdraw', checkAuth, checkAdmin, async (req, res) => {
    const w = await Withdrawal.findById(req.body.withdrawId);
    if (w) { w.status = 'completed'; await w.save(); res.json({ status: 'success' }); }
});

// --- 6. SOCKET.IO SİSTEMİ ---
io.on('connection', (socket) => {
    socket.on('register-user', (data) => {
        if (data && data.nickname) {
            socket.nickname = data.nickname;
            socket.join('GlobalChat');
        }
    });
    socket.on('chat-message', (data) => {
        io.to('GlobalChat').emit('new-message', { sender: socket.nickname || "Misafir", text: data.text });
    });
});

// --- 7. BAŞLATMA ---
server.listen(PORT, "0.0.0.0", () => {
    console.log(`BPL SISTEMI AKTIF: ${PORT}`);
});
