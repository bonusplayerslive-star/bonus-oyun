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

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });

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

// --- E-POSTA YAPILANDIRMASI ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

const dbLog = async (type, content) => {
    try {
        const newLog = new Log({ type, content });
        await newLog.save();
    } catch (err) { console.error("Log hatası:", err.message); }
};

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
app.get('/development', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('development', { user, selectedAnimal: req.query.animal });
});
app.get('/wallet', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('wallet', { user });
});
app.get('/arena', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('arena', { user, selectedAnimal: req.query.animal });
});
app.get('/chat', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('chat', { user });
});
app.get('/meeting', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('meeting', { user, roomId: req.query.roomId || 'GlobalMasa' });
});

// --- POST ROTALARI ---
app.post('/login', authLimiter, async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email, password });
    if (user) { req.session.userId = user._id; res.redirect('/profil'); }
    else res.send('<script>alert("Hatalı Giriş!"); window.location.href="/";</script>');
});

app.post('/register', authLimiter, async (req, res) => {
    try {
        const newUser = new User({ ...req.body, bpl: 2500 });
        await newUser.save();
        res.send('<script>alert("Kayıt Başarılı! 2500 BPL Hediye Edildi."); window.location.href="/";</script>');
    } catch (e) { res.send("Kayıt Hatası: Veriler kullanımda."); }
});

app.post('/contact', async (req, res) => {
    const { email, note } = req.body;
    if (note.length > 180) return res.send("Not çok uzun!");
    await dbLog('CONTACT_FORM', `Kimden: ${email} | Mesaj: ${note}`);
    res.send('<script>alert("Mesajınız iletildi."); window.location.href="/";</script>');
});

app.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.send('<script>alert("E-posta bulunamadı!"); window.location.href="/";</script>');
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'BPL Şifre Hatırlatma',
        text: `Merhaba ${user.nickname}, şifreniz: ${user.password}`
    };
    transporter.sendMail(mailOptions);
    res.send('<script>alert("Şifreniz mail adresinize gönderildi."); window.location.href="/";</script>');
});

app.post('/update-password', checkAuth, async (req, res) => {
    const { newPassword } = req.body;
    await User.findByIdAndUpdate(req.session.userId, { password: newPassword });
    res.send('<script>alert("Şifre güncellendi!"); window.location.href="/profil";</script>');
});

// --- MARKET & GELİŞTİRME ---
app.post('/buy-animal', checkAuth, async (req, res) => {
    const { animalName, price } = req.body;
    const user = await User.findById(req.session.userId);
    if (user.bpl >= price) {
        user.bpl -= price;
        if (!user.inventory.includes(animalName)) user.inventory.push(animalName);
        user.stats[animalName] = { hp: 120, atk: 20, def: 15 };
        user.markModified('stats');
        await user.save();
        res.json({ status: 'success', newBalance: user.bpl });
    } else res.json({ status: 'error', msg: 'Yetersiz Bakiye!' });
});

app.post('/upgrade-stat', checkAuth, async (req, res) => {
    const { animalName, statType, cost } = req.body;
    const user = await User.findById(req.session.userId);
    if (user.bpl >= cost) {
        user.bpl -= cost;
        user.stats[animalName][statType] += (statType === 'hp' ? 20 : 5);
        user.markModified('stats');
        await user.save();
        res.json({ status: 'success', newBalance: user.bpl });
    } else res.json({ status: 'error' });
});

app.post('/sell-animal', checkAuth, async (req, res) => {
    const { animalName } = req.body;
    try {
        const user = await User.findById(req.session.userId);
        if (user.inventory.includes(animalName)) {
            const refundAmount = 1875;
            user.inventory = user.inventory.filter(a => a !== animalName);
            if (user.stats[animalName]) delete user.stats[animalName];
            user.bpl += refundAmount;
            user.markModified('stats');
            await user.save();
            await dbLog('MARKET', `${user.nickname}, ${animalName} sattı. +${refundAmount} BPL`);
            res.json({ status: 'success', newBalance: user.bpl });
        } else {
            res.json({ status: 'error', msg: 'Hayvan bulunamadı!' });
        }
    } catch (e) { res.json({ status: 'error' }); }
});

// --- SAVAŞ VE ANİMASYON MANTIĞI (DÜZELTİLMİŞ) ---
app.post('/attack-bot', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        // Kullanıcının envanterindeki ilk hayvanı veya seçili olanı alıyoruz
        const animalName = req.query.animal || user.inventory[0]; 

        if(!animalName) {
            return res.json({ status: 'error', msg: 'Savaşacak bir hayvanınız yok!' });
        }

        const pStats = user.stats[animalName] || { hp: 100, atk: 15, def: 10 };
        const botStats = { hp: 130, atk: 18, def: 12 };

        let pHP = pStats.hp;
        let bHP = botStats.hp;

        // Simülasyon
        while (pHP > 0 && bHP > 0) {
            bHP -= Math.max(5, pStats.atk - botStats.def);
            if (bHP <= 0) break;
            pHP -= Math.max(5, botStats.atk - pStats.def);
        }

        const win = pHP > 0;
        const reward = win ? 150 : 0;

        if (win) {
            user.bpl += reward;
            await user.save();
        }

        // Klasör yapına göre video yollarını gönderiyoruz
        res.json({
            status: 'success',
            winner: win ? user.nickname : 'Elite_Bot',
            reward: reward,
            newBalance: user.bpl,
            animation: {
                actionVideo: `/caracter/move/${animalName}/${animalName}1.mp4`, // Hamle/Saldırı
                winVideo: `/caracter/move/${animalName}/${animalName}.mp4`,    // Kazandı/Kükreme
                isWin: win
            }
        });
    } catch (e) {
        console.error("Savaş Hatası:", e);
        res.status(500).json({ status: 'error', msg: 'Sunucu hatası' });
    }
});

// ... (Geri kalan socket ve server.listen kodların aynı kalabilir)

app.post('/attack-player', checkAuth, async (req, res) => {
    try {
        const { defenderNickname } = req.body;
        const attacker = await User.findById(req.session.userId);
        const defender = await User.findOne({ nickname: defenderNickname });
        if (!attacker || !defender) return res.json({ status: 'error', msg: 'Rakip bulunamadı' });

        const aAnimal = attacker.inventory[0];
        const dAnimal = defender.inventory[0];
        const aStats = attacker.stats[aAnimal] || { hp: 100, atk: 15, def: 10 };
        const dStats = defender.stats[dAnimal] || { hp: 100, atk: 15, def: 10 };

        const aWin = (aStats.atk + aStats.hp) > (dStats.atk + dStats.hp);
        let reward = 250;
        if(aWin) {
            attacker.bpl += reward;
            await attacker.save();
        }
        res.json({ status: 'success', winner: aWin ? attacker.nickname : defender.nickname, reward: aWin ? reward : 0, newBalance: attacker.bpl });
    } catch (e) { res.json({ status: 'error' }); }
});

app.post('/create-meeting', checkAuth, (req, res) => {
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    res.redirect(`/meeting?roomId=${roomId}`);
});

app.post('/withdraw', checkAuth, async (req, res) => {
    const { amount } = req.body;
    const user = await User.findById(req.session.userId);
    if (user.bpl >= amount && amount >= 7500) {
        user.bpl -= amount;
        await user.save();
        const p = new Payment({ email: user.email, requestedBpl: amount, netAmount: amount*0.7, status: 'Beklemede' });
        await p.save();
        res.json({ status: 'success' });
    } else res.json({ status: 'error' });
});

// --- SOCKET & ARENA SİSTEMİ ---
let onlineArena = [];
let onlinePlayers = {};

io.on('connection', (socket) => {
    socket.on('register-user', (data) => {
        socket.userId = data.id;
        socket.nickname = data.nickname;
        onlinePlayers[data.nickname] = socket.id;
    });

    socket.on('join-arena', (data) => {
        socket.userId = data.id;
        socket.nickname = data.nickname;
        if(!onlineArena.find(u => u.id === data.id)) onlineArena.push(data);
        io.emit('arena-list-update', onlineArena);
    });

    socket.on('challenge-player', (data) => {
        const targetSocketId = onlinePlayers[data.targetNickname];
        if (targetSocketId) {
            io.to(targetSocketId).emit('challenge-received', { challenger: socket.nickname });
        }
    });

    socket.on('accept-challenge', (data) => {
        const challengerSocketId = onlinePlayers[data.challengerNickname];
        if (challengerSocketId) {
            const battleId = Math.random().toString(36).substring(7);
            io.to(challengerSocketId).emit('start-battle', { opponent: socket.nickname, battleId });
            socket.emit('start-battle', { opponent: data.challengerNickname, battleId });
        }
    });

    socket.on('chat-message', (data) => {
        io.emit('new-message', { sender: data.nickname, text: data.message });
    });

    socket.on('disconnect', () => {
        onlineArena = onlineArena.filter(u => u.id !== socket.userId);
        if (socket.nickname) delete onlinePlayers[socket.nickname];
        io.emit('arena-list-update', onlineArena);
    });
});

server.listen(PORT, "0.0.0.0", () => console.log(`BPL ONLINE | PORT: ${PORT}`));

