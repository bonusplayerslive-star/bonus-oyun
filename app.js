// --- 1. MODÜLLER VE AYARLAR ---
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const path = require('path');
const axios = require('axios');



// --- 2. VERİTABANI VE MODELLER ---
const connectDB = require('./db');
const User = require('./models/User');
const Log = require('./models/Log');
const Payment = require('./models/Payment');
const Income = require('./models/Income');
const Victory = require('./models/Victory');
const Punishment = require('./models/Punishment');
const Withdrawal = require('./models/Withdrawal');

connectDB(); // MongoDB bağlantısını başlatır

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 10000;

// --- 3. MIDDLEWARE (ARA YAZILIMLAR) ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views')); //
app.use(express.static(path.join(__dirname, 'public'))); //
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.set('trust proxy', 1);

app.use(session({
    secret: 'bpl_ozel_anahtar',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 saat
}));

// --- 4. YARDIMCI FONKSİYONLAR & GLOBAL DEĞİŞKENLER ---
const checkAuth = (req, res, next) => {
    if (req.session.userId) next(); else res.redirect('/');
};

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.MAIL_USER, // Render'daki karşılığı
        pass: process.env.MAIL_APP_PASS // Render'daki karşılığı
    }
});

// --- KULLANICI KAYIT (REGISTER) ---
app.post('/register', async (req, res) => {
    const { nickname, email, password } = req.body;
    try {
        // 1. E-posta zaten kullanılıyor mu kontrol et
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.send('<script>alert("Bu e-posta zaten kayıtlı!"); window.location.href="/";</script>');
        }

        // 2. Yeni kullanıcıyı oluştur (Başlangıç parası: 2500 BPL)
        const newUser = new User({
            nickname,
            email,
            password,
            bpl: 2500, // Yeni gelen kumandana hoş geldin hediyesi
            inventory: []
        });

        // 3. Veritabanına kaydet
        await newUser.save();

        // 4. Log kaydı oluştur
        await new Log({ 
            type: 'REGISTER', 
            content: `Yeni kullanıcı katıldı: ${nickname}`, 
            userEmail: email 
        }).save();

        res.send('<script>alert("Kayıt başarılı! Şimdi giriş yapabilirsin."); window.location.href="/";</script>');
    } catch (err) {
        console.error("Kayıt Hatası:", err);
        res.status(500).send("Kayıt sırasında bir sunucu hatası oluştu.");
    }
});


// --- HAYVAN GELİŞTİRME (UPGRADE) ---
app.post('/upgrade-animal', checkAuth, async (req, res) => {
    const { animalIndex } = req.body;
    const upgradeCost = 50; // Her geliştirme 500 BPL olsun

    try {
        const user = await User.findById(req.session.userId);
        const animal = user.inventory[animalIndex];

        if (user.bpl < upgradeCost) {
            return res.json({ status: 'error', msg: 'Yetersiz BPL bakiyesi!' });
        }

        // İstatistikleri Ateşliyoruz
        animal.level += 1;
        animal.stats.hp += 20;  // Her seviyede +20 Can
        animal.stats.atk += 10; // Her seviyede +10 Saldırı

        user.bpl -= upgradeCost;
        user.markModified('inventory'); // MongoDB'ye envanterin değiştiğini haber ver
        await user.save();

        res.json({ 
            status: 'success', 
            msg: `${animal.name} seviye atladı! Yeni Seviye: ${animal.level}`,
            newBpl: user.bpl 
        });

    } catch (err) {
        res.status(500).json({ status: 'error', msg: 'Geliştirme başarısız.' });
    }
});








const MARKET_ANIMALS = [
    { id: 1, name: 'Bear', price: 1000, img: '/caracter/profile/bear.jpg' },
    { id: 2, name: 'Crocodile', price: 1000, img: '/caracter/profile/crocodile.jpg' },
    { id: 3, name: 'Eagle', price: 1000, img: '/caracter/profile/eagle.jpg' },
    { id: 4, name: 'Gorilla', price: 5000, img: '/caracter/profile/gorilla.jpg' },
    { id: 5, name: 'Kurd', price: 1000, img: '/caracter/profile/kurd.jpg' },
    { id: 6, name: 'Lion', price: 5000, img: '/caracter/profile/lion.jpg' },
    { id: 7, name: 'Falcon', price: 1000, img: '/caracter/profile/peregrinefalcon.jpg' },
    { id: 8, name: 'Rhino', price: 5000, img: '/caracter/profile/rhino.jpg' },
    { id: 9, name: 'Snake', price: 1000, img: '/caracter/profile/snake.jpg' },
    { id: 10, name: 'Tiger', price: 5000, img: '/caracter/profile/tiger.jpg' }
];

// --- 5. ANA ROTALAR ---

// FIX: Cannot GET / hatasını önleyen ana sayfa rotası
app.get('/', (req, res) => {
    res.render('index', { user: req.session.userId || null });
});

app.get('/profil', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('profil', { user }); //
});

app.get('/market', checkAuth, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('market', { user, animals: MARKET_ANIMALS }); //
});

// --- 6. İŞLEM ROTALARI (AUTH, MARKET, CONTACT) ---

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email, password });
    if (user) { 
        req.session.userId = user._id; 
        await new Log({ type: 'LOGIN', content: 'Giriş yapıldı', userEmail: email }).save();
        res.redirect('/profil'); 
    } else {
        res.send('<script>alert("Hatalı giriş!"); window.location.href="/";</script>');
    }
});

// --- STAT GELİŞTİRME MERKEZİ ---
app.post('/upgrade-stat', checkAuth, async (req, res) => {
    const { animalName, statType, cost } = req.body;

    try {
        const user = await User.findById(req.session.userId);
        
        // Envanterde doğru hayvanı bul
        const animalIndex = user.inventory.findIndex(a => a.name === animalName);
        
        if (animalIndex === -1) return res.json({ status: 'error', msg: 'Hayvan bulunamadı!' });
        if (user.bpl < cost) return res.json({ status: 'error', msg: 'Bakiye yetersiz!' });

        const animal = user.inventory[animalIndex];

        // Geliştirme Mantığı
        switch(statType) {
            case 'hp': animal.stats.hp += 10; break;
            case 'atk': animal.stats.atk += 5; break;
            case 'def': animal.stats.def = (animal.stats.def || 0) + 5; break;
            case 'crit': animal.stats.crit = (animal.stats.crit || 0) + 5; break; // Yeni Özellik!
            case 'battleMode': 
                // Geçici güçlendirme mantığı buraya
                animal.stats.atk += 20; 
                break;
        }

        user.bpl -= cost;
        user.markModified('inventory'); // MongoDB'ye dizinin değiştiğini fısılda
        await user.save();

        res.json({ 
            status: 'success', 
            newBalance: user.bpl.toLocaleString(),
            msg: 'Gelişim tamamlandı!' 
        });

    } catch (err) {
        res.status(500).json({ status: 'error', msg: 'Sunucu hatası!' });
    }
});




app.post('/buy-animal', checkAuth, async (req, res) => {
    try {
        const { animalId } = req.body;
        const user = await User.findById(req.session.userId);
        const animal = MARKET_ANIMALS.find(a => a.id == animalId);

        if (!animal) return res.json({ status: 'error', msg: 'Karakter bulunamadı!' });
        if (user.inventory.length >= 3) return res.json({ status: 'error', msg: 'Çanta dolu! (Max 3)' });
        if (user.bpl < animal.price) return res.json({ status: 'error', msg: 'Bakiye yetersiz!' });

        user.bpl -= animal.price;
        user.inventory.push({
            name: animal.name,
            img: animal.img,
            level: 1,
            stats: { hp: 100, atk: 20 }
        });

        await user.save();
        await new Log({ type: 'MARKET', content: `${user.nickname} satın aldı: ${animal.name}`, userEmail: user.email }).save();

        res.json({ status: 'success', msg: `${animal.name} orduna katıldı!`, newBalance: user.bpl });
    } catch (err) {
        res.json({ status: 'error', msg: 'Sistem hatası!' });
    }
});

app.post('/contact', async (req, res) => {
    const { email, note } = req.body;
    try {
        await new Log({ type: 'CONTACT', content: note, userEmail: email, status: 'PENDING' }).save();
        await transporter.sendMail({
            from: process.env.MAIL_USER,
            to: process.env.MAIL_USER,
            subject: 'BPL Yeni Destek Mesajı',
            text: `Mesaj: ${note} \n Gönderen: ${email}`
        });
        res.send('<script>alert("Mesajın kumandana iletildi!"); window.location.href="/";</script>');
    } catch (err) { res.send('Hata oluştu!'); }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});


// Hediye ve Vergi Mantığı
socket.on('transfer-bpl', async (data) => {
    const sender = await User.findById(socket.userId);
    const receiver = await User.findOne({ nickname: data.to });
    
    const amount = Math.min(data.amount, 1000);
    const tax = Math.floor(amount * 0.25); // %25 Vergi
    const netAmount = amount - tax;

    if(sender.bpl >= 6000 && sender.bpl >= amount) {
        sender.bpl -= amount;
        receiver.bpl += netAmount;

        await sender.save();
        await receiver.save();

        // YAKIM KAYDI (Mongo'ya Log)
        await new Log({
            type: 'BPL_BURN',
            content: `Transfer Vergisi Yakıldı: ${tax} BPL`,
            userEmail: sender.email
        }).save();

        io.to(receiver.socketId).emit('gift-result', { message: `${sender.nickname} size ${netAmount} BPL yolladı!` });
    }
});

// --- SOCKET.IO MANTIĞI (CHAT, TRANSFER, CHALLENGE) ---
io.on('connection', (socket) => {
    console.log('Bir kumandan bağlandı:', socket.id);

    // Kullanıcıyı Socket'e kaydet (ID eşleştirmesi için)
    socket.on('register-user', ({ id, nickname }) => {
        socket.userId = id;
        socket.nickname = nickname;
        socket.join('Global'); // Herkesi Global odaya sok
    });

    // Mesajlaşma
    socket.on('chat-message', (data) => {
        io.to('Global').emit('new-message', {
            sender: socket.nickname,
            text: data.text
        });
    });

    // --- BPL TRANSFER VE YAKIM SİSTEMİ ---
    socket.on('transfer-bpl', async (data) => {
        try {
            const sender = await User.findById(socket.userId);
            const receiver = await User.findOne({ nickname: data.to });

            if (!receiver) return;

            const amount = Math.min(Math.abs(data.amount), 1000); // Max 1000, Negatif sayı koruması
            const tax = Math.floor(amount * 0.25); // %25 Vergi
            const netAmount = amount - tax;

            if (sender.bpl >= 6000 && sender.bpl >= amount) {
                sender.bpl -= amount;
                receiver.bpl += netAmount;

                await sender.save();
                await receiver.save();

                // MongoDB'ye Yakım Kaydı (Log Modeline Uygun)
                await new Log({
                    type: 'BPL_BURN',
                    content: `${sender.nickname} -> ${receiver.nickname} transferinden ${tax} BPL yakıldı.`,
                    userEmail: sender.email
                }).save();

                // Taraflara bilgi uçur
                socket.emit('gift-result', { 
                    newBalance: sender.bpl.toLocaleString(), 
                    message: `Başarılı! ${tax} BPL vergi yakıldı.` 
                });
                
                // Alıcıya anlık mesaj gönder
                socket.to('Global').emit('new-message', {
                    sender: 'SİSTEM',
                    text: `🎁 ${sender.nickname}, ${receiver.nickname} kumandana hediye gönderdi!`
                });
            }
        } catch (err) {
            console.error("Transfer Hatası:", err);
        }
    });

    // --- KAVGAYA DAVET (CHALLENGE) ---
    socket.on('send-challenge', (data) => {
        // Hedef kullanıcıya (Global odasındakilere) meydan okuma sinyali gönder
        socket.to('Global').emit('challenge-received', {
            from: socket.nickname,
            target: data.target
        });
    });
// --- KARAKTER SATIŞ & YAKIM ROTASI ---
app.post('/sell-character', checkAuth, async (req, res) => {
    try {
        const { userId, animalIndex, fiyat } = req.body;
        const user = await User.findById(userId);

        if (user.inventory.length <= 1) {
            return res.json({ status: 'error', msg: 'Son karakterini satamazsın!' });
        }

        const originalPrice = parseInt(fiyat);
        const burnTax = Math.floor(originalPrice * 0.30); // %30 Yakım
        const refundAmount = originalPrice - burnTax;

        // Karakteri envanterden çıkar
        const removedItem = user.inventory.splice(animalIndex, 1);
        user.bpl += refundAmount;

        user.markModified('inventory');
        await user.save();

        // YAKIM KAYDI (Log)
        await new Log({
            type: 'BPL_BURN',
            content: `Karakter Satışı (%30 Yakım): ${removedItem[0].name || removedItem[0]} tasfiye edildi. ${burnTax} BPL yakıldı.`,
            userEmail: user.email
        }).save();

        res.json({ 
            status: 'success', 
            msg: `Varlık satıldı! ${refundAmount} BPL hesabına eklendi, ${burnTax} BPL sistemden yakıldı.`,
            newBpl: user.bpl 
        });

    } catch (err) {
        console.error("Satış Hatası:", err);
        res.status(500).json({ status: 'error', msg: 'İşlem başarısız oldu.' });
    }
});



    

    socket.on('disconnect', () => {
        console.log('Bir kumandan ayrıldı.');
    });
});




    
    // Render Environment'dan gelen veriler
    const apiKey = process.env.BSCSCAN_API_KEY;
    const companyWallet = process.env.WALLET_ADDRESS.toLowerCase();
    const usdtContract = process.env.CONTRACT_ADDRESS.toLowerCase();

    try {
        // 1. TxID daha önce kullanılmış mı? (Mükerrer ödeme kontrolü)
        const checkDuplicate = await Payment.findOne({ txid: txid });
        if (checkDuplicate) return res.json({ status: 'error', msg: 'Bu işlem daha önce onaylanmış!' });

        // 2. BSCScan API sorgusu
        const url = `https://api.bscscan.com/api?module=proxy&action=eth_getTransactionReceipt&txhash=${txid}&apikey=${apiKey}`;
        const response = await axios.get(url);
        const receipt = response.data.result;

        if (!receipt || receipt.status !== "0x1") {
            return res.json({ status: 'error', msg: 'İşlem henüz onaylanmamış veya geçersiz.' });
        }

        // 3. Log analizi (Doğru adrese, doğru tutarda USDT gitti mi?)
        let validTransfer = false;
        receipt.logs.forEach(log => {
            const isUSDT = log.address.toLowerCase() === usdtContract;
            const toCompany = log.topics[2] && log.topics[2].toLowerCase().includes(companyWallet.replace('0x', ''));
            
            if (isUSDT && toCompany) {
                const amountHex = log.data;
                const actualAmount = parseInt(amountHex, 16) / Math.pow(10, 18); // 18 decimal kontrolü
                
                if (actualAmount >= parseFloat(usd)) {
                    validTransfer = true;
                }
            }
        });

        if (validTransfer) {
            // 4. Kullanıcıya BPL ekle
            const user = await User.findById(userId);
            user.bpl += parseInt(bpl);
            await user.save();

            // 5. MongoDB'ye Kalıcı Kayıt At (Nirvana Kaydı)
            await new Payment({
                userId: userId,
                txid: txid,
                amountUSD: usd,
                amountBPL: bpl,
                walletUsed: companyWallet,
                date: new Date(),
                status: 'COMPLETED'
            }).save();

            return res.json({ status: 'success', msg: 'Ödeme doğrulandı, BPL yüklendi!' });
        } else {
            return res.json({ status: 'error', msg: 'Transfer verileri paketle uyuşmuyor!' });
        }

    } catch (err) {
        console.error("Doğrulama Hatası:", err);
        res.json({ status: 'error', msg: 'Sistem şu an doğrulamayı yapamıyor.' });
    }
});



// Oda ve Savaş Limitleri
const MEETING_FEE = 50;
const MIN_GIFT_BALANCE = 3500;
const REQ_GIFT_LIMIT = 5000;

// Meeting Odası Açma ve Davet
app.post('/open-special-room', checkAuth, async (req, res) => {
    const user = await User.findById(req.body.userId);
    if (user.bpl < MEETING_FEE) return res.json({ status: 'error', msg: 'Yetersiz BPL!' });

    user.bpl -= MEETING_FEE;
    const roomId = "VIP-" + Math.random().toString(36).substring(7).toUpperCase();
    await user.save();

    // Global Chat'e Şehvetli Bildiri
    io.emit('new-message', {
        sender: "SYSTEM",
        text: `🔥 <b style="color:#ff003c">${user.nickname}</b> karanlık odayı açtı! Davetliler yola çıktı...`,
        isSystem: true
    });

    res.json({ status: 'success', roomId });
});

// Socket.io Hediye ve Savaş Dinamiği
io.on('connection', (socket) => {
   // Hediye Gönderim Kontrolü
socket.on('send-gift-vip', async (data) => {
    const { senderId, targetNick, amount, tax } = data;
    const sender = await User.findById(senderId);

    // 5000 BPL Altı Kontrolü (Fakirler davetle girer ama hediye gönderemez)
    if (!sender || sender.bpl < 5000) {
        return socket.emit('gift-result', { 
            status: 'error', 
            message: 'Konseyde hediye dağıtmak için en az 5000 BPL bakiye gerekir!' 
        });
    }

    // Gönderim sonrası 3500 BPL altına düşme kontrolü
    if (sender.bpl - amount < 3500) {
        return socket.emit('gift-result', { 
            status: 'error', 
            message: 'Hediye sonrası minimum 3500 BPL bakiyen kalmalıdır!' 
        });
    }

    const target = await User.findOne({ nickname: targetNick });
    if (!target) return socket.emit('gift-result', { status: 'error', message: 'Alıcı bulunamadı!' });

    // Matematiksel hesaplama: Net Tutar = Brüt - (Brüt * Vergi/100)
    const netAmount = amount * (1 - (tax / 100));
    sender.bpl -= amount;
    target.bpl += netAmount;

    await sender.save();
    await target.save();

    io.to(data.room).emit('new-message', {
        sender: "SİSTEM",
        text: `💎 ${sender.nickname}, ${targetNick} kullanıcısına cömert davrandı!`,
        isSystem: true
    });

    socket.emit('gift-result', { status: 'success', newBalance: sender.bpl, message: 'Hediye başarıyla iletildi.' });
});

    // VIP Arena (8 Saniyelik Video Sınıfı)
    socket.on('start-vip-battle', async ({ room, p1, p2 }) => {
        // 5 sn geri sayım başlat
        let count = 5;
        const timer = setInterval(() => {
            io.to(room).emit('battle-countdown', count);
            if (count <= 0) {
                clearInterval(timer);
                determineWinner(p1, p2, room);
            }
            count--;
        }, 1000);
    });
});

async function determineWinner(p1, p2, room) {
    // Burada p1 ve p2'nin HP/ATK değerlerine göre kazananı belirle
    const winner = Math.random() > 0.5 ? p1 : p2; 
    const loser = winner === p1 ? p2 : p1;

    const winUser = await User.findOne({nickname: winner});
    winUser.bpl += 75; // Kazanan bonusu
    await winUser.save();

    io.to(room).emit('battle-video-play', {
        winner,
        loser,
        video: `/caracter/move/${winUser.inventory[0].name.toLowerCase()}/${winUser.inventory[0].name.toLowerCase()}.mp4`,
        moveVideo: `/caracter/move/${winUser.inventory[0].name.toLowerCase()}/${winUser.inventory[0].name.toLowerCase()}1.mp4`
    });
}

// Arena Veri Modeli (Hızlı erişim için)
const arenaQueue = []; 
const last20Victories = []; // Bellekte tutulan son 20 zafer

// Bot Karakterleri
const eliteBots = [
    { nickname: "X-Terminator", animal: "Tiger", level: 15 },
    { nickname: "Shadow-Ghost", animal: "Wolf", level: 22 },
    { nickname: "Cyber-Predator", animal: "Eagle", level: 18 },
    { nickname: "Night-Stalker", animal: "Lion", level: 25 }
];

// Arena Lobby'ye Giriş
app.get('/arena', checkAuth, async (req, res) => {
    res.render('arena', { 
        user: req.user, 
        selectedAnimal: req.user.inventory[0]?.name || "Karakter Yok",
        lastVictories: last20Victories 
    });
});

// --- ARENA SAVAŞI: BOTU YENEN ÜCRET ÖDEMEZ ---
app.post('/attack-bot', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const bot = eliteBots[Math.floor(Math.random() * eliteBots.length)];
        const animalName = req.query.animal.toLowerCase();

        // Kazanma Şansı %50 (Geliştirilebilir)
        const isWin = Math.random() > 0.4; 

        if (isWin) {
            // Galibiyette giriş ücreti yok, NET 200 BPL kar eklenir!
            user.bpl += 100; 
            
            // Zafer Kaydı
            last20Victories.unshift({
                winner: user.nickname,
                opponent: bot.nickname,
                reward: 100,
                time: new Date().toLocaleTimeString('tr-TR')
            });
            if(last20Victories.length > 20) last20Victories.pop();

            // Global Chat Duyurusu ve Tebrik Butonu Tetikleyici
            io.emit('new-message', {
                sender: "ARENA_SISTEM",
                text: `🏆 ${user.nickname}, ${bot.nickname} karşısında ZAFER kazandı!`,
                winnerNick: user.nickname, 
                isBattleWin: true 
            });
        } else {
            // Kaybederse giriş bedeli (200 BPL) hesaptan düşülür
            if (user.bpl >= 150) {
                user.bpl -= 150;
            }
        }

        await user.save();

        res.json({
            status: 'success',
            opponent: bot.nickname,
            animation: {
                actionVideo: `/caracter/move/${animalName}/${animalName}1.mp4`,
                winVideo: `/caracter/move/${animalName}/${animalName}.mp4`,
                isWin: isWin
            },
            newBalance: user.bpl
        });

    } catch (err) {
        res.status(500).json({ status: 'error', msg: 'Arena hatası!' });
    }
});

// --- ELİT TEBRİK SİSTEMİ (SOCKET.IO) ---
socket.on('tebrik-et', async (data) => {
    const sender = await User.findById(socket.userId);
    const receiver = await User.findOne({ nickname: data.winnerNick });

    // En az 5.000 BPL bakiye kontrolü
    if (sender.bpl < 5000) {
        return socket.emit('error-msg', 'Tebrik için en az 5.000 BPL bakiyen olmalı!');
    }

    const brutHediye = 500; // Gönderilen sabit miktar
    const kesintiOrani = 0.18; // %18 kesinti
    const kesintiMiktari = brutHediye * kesintiOrani; // 90 BPL yakılır
    const netHediye = brutHediye - kesintiMiktari; // 410 BPL alıcıya geçer

    if (sender.bpl >= brutHediye) {
        sender.bpl -= brutHediye;
        receiver.bpl += netHediye;

        await sender.save();
        await receiver.save();

        // Yakım Kaydı (Log)
        await new Log({
            type: 'BPL_BURN',
            content: `Tebrik Hediyesi Yakımı (%18): ${kesintiMiktari} BPL`,
            userEmail: sender.email
        }).save();

        io.to('Global').emit('new-message', {
            sender: "SİSTEM",
            text: `💎 ${sender.nickname}, şampiyon ${receiver.nickname}'ı tebrik etti! (410 BPL iletildi)`
        });
    }
});

    if (isWin) {
        user.bpl += 75; // Zafer ödülü
        await user.save();
        
        // Zafer Kaydı
        last20Victories.unshift({
            winner: user.nickname,
            opponent: bot.nickname,
            reward: 75,
            time: new Date().toLocaleTimeString()
        });
        if(last20Victories.length > 20) last20Victories.pop();
    }

    res.json(result);
});

// --- ARENA SAVAŞ VE ÖDÜL SİSTEMİ ---
app.post('/attack-bot', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        if (!user) return res.json({ status: 'error', msg: 'Kullanıcı bulunamadı!' });

        const bot = eliteBots[Math.floor(Math.random() * eliteBots.length)];
        const isWin = Math.random() > 0.5; // %50 Şans
        const animalName = req.query.animal ? req.query.animal.toLowerCase() : "eagle";

        if (isWin) {
            // Kazanan masrafsız +200 alır
            user.bpl += 200;
            
            last20Victories.unshift({
                winner: user.nickname,
                opponent: bot.nickname,
                reward: 200,
                time: new Date().toLocaleTimeString('tr-TR')
            });
            if(last20Victories.length > 20) last20Victories.pop();

            io.emit('new-message', {
                sender: "ARENA_SISTEM",
                text: `🏆 ${user.nickname}, ${bot.nickname} karşısında zafer kazandı!`,
                winnerNick: user.nickname,
                isBattleWin: true 
            });
        } else {
            // Kaybeden 200 öder
            if (user.bpl >= 200) user.bpl -= 200;
        }

        await user.save(); // Hata buradaydı, artık async fonksiyonun içinde.

        res.json({
            status: 'success',
            opponent: bot.nickname,
            animation: {
                actionVideo: `/caracter/move/${animalName}/${animalName}1.mp4`,
                winVideo: `/caracter/move/${animalName}/${animalName}.mp4`,
                isWin: isWin
            },
            newBalance: user.bpl
        });

    } catch (err) {
        console.error("Arena Hatası:", err);
        res.status(500).json({ status: 'error', msg: 'Sunucu hatası oluştu!' });
    }
});



// --- ARENA SAVAŞI: BOTU YENEN ÜCRET ÖDEMEZ ---
app.post('/attack-bot', checkAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const bot = eliteBots[Math.floor(Math.random() * eliteBots.length)];
        const animalName = req.query.animal.toLowerCase();

        // Kazanma Şansı %40
        const isWin = Math.random() > 0.5; 

        if (isWin) {
            // Galibiyette giriş ücreti yok, NET 200 BPL kar!
            user.bpl += 200; 
            
            // Zafer Kaydı (Son 20 listesi için)
            last20Victories.unshift({
                winner: user.nickname,
                opponent: bot.nickname,
                reward: 200,
                time: new Date().toLocaleTimeString('tr-TR')
            });
            if(last20Victories.length > 20) last20Victories.pop();

            // Chat Duyurusu: Tebrik butonu tetikleyici
            io.emit('new-message', {
                sender: "ARENA_SISTEM",
                text: `🏆 ${user.nickname}, ${bot.nickname} karşısında ZAFER kazandı!`,
                winnerNick: user.nickname, // Buton için gerekli
                isBattleWin: true 
            });
        } else {
            // Kaybederse ceza olarak 200 BPL gider
            if (user.bpl >= 200) user.bpl -= 200;
        }

        await user.save();

        res.json({
            status: 'success',
            opponent: bot.nickname,
            animation: {
                actionVideo: `/caracter/move/${animalName}/${animalName}1.mp4`,
                winVideo: `/caracter/move/${animalName}/${animalName}.mp4`,
                isWin: isWin
            },
            newBalance: user.bpl
        });

    } catch (err) {
        res.status(500).json({ status: 'error', msg: 'Arena hatası!' });
    }
});

// --- TEBRİK SİSTEMİ (SOCKET.IO) ---
io.on('connection', (socket) => {
    socket.on('tebrik-et', async (data) => {
        try {
            const sender = await User.findById(socket.userId);
            const receiver = await User.findOne({ nickname: data.winnerNick });

            if (!sender || !receiver) return;
            if (sender.bpl < 5000) return socket.emit('error-msg', 'En az 5.000 BPL gerekli!');

            const brutHediye = 500;
            const kesinti = brutHediye * 0.18; // 90 BPL yakım
            const netHediye = brutHediye - kesinti;

            if (sender.bpl >= brutHediye) {
                sender.bpl -= brutHediye;
                receiver.bpl += netHediye;

                await sender.save();
                await receiver.save();

                await new Log({
                    type: 'BPL_BURN',
                    content: `Tebrik yakımı: ${kesinti} BPL`,
                    userEmail: sender.email
                }).save();

                io.to('Global').emit('new-message', {
                    sender: "SİSTEM",
                    text: `💎 ${sender.nickname}, ${receiver.nickname} kumandana 410 BPL ateşledi!`
                });
            }
        } catch (e) { console.error("Tebrik hatası:", e); }
    });
});
        // Yakım Kaydı
        await new Log({
            type: 'BPL_BURN',
            content: `Tebrik Kesintisi Yakıldı: ${kesintiMiktari} BPL`,
            userEmail: sender.email
        }).save();

        io.to('Global').emit('new-message', {
            sender: "SİSTEM",
            text: `💎 ${sender.nickname}, şampiyon ${receiver.nickname}'ı tebrik etti! (410 BPL iletildi)`
        });
    }
});









// --- 7. SUNUCU BAŞLATMA ---
server.listen(PORT, "0.0.0.0", () => {
    console.log(`
    =========================================
    BPL ECOSYSTEM OPERATIONAL ON PORT ${PORT}
    VERITABANI: BAGLANDI
    MAIL SISTEMI: AKTIF
    =========================================
    `);
});



















