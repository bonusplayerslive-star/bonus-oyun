require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const path = require('path');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcryptjs');
const nodemailer = require("nodemailer");
// Modeller (Paylaştığın dosya isimlerine göre)
const User = require('./models/User');
const Log = require('./models/Log');
const Payment = require('./models/Payment');
const Victory = require('./models/Victory');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// --- VERİTABANI BAĞLANTISI ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('MongoDB Atlas Bağlantısı Başarılı.'))
    .catch(err => console.error('Bağlantı Hatası:', err));

// --- GÜVENLİK VE YAPILANDIRMA ---
// Helmet: HTTP başlıklarını güvenli hale getirir (CSP esnetildi çünkü videoların oynaması lazım)
app.use(helmet({ contentSecurityPolicy: false })); 
app.use(mongoSanitize()); // NoSQL Injection koruması
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));

// --- SESSION SİSTEMİ ---
app.use(session({
    secret: process.env.SESSION_SECRET || 'bpl_gizli_anahtar_2025',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 } // 1 Günlük oturum
}));

// EJS Sayfalarına 'user' değişkenini global olarak gönder
app.use(async (req, res, next) => {
    if (req.session.userId) {
        const user = await User.findById(req.session.userId);
        res.locals.user = user;
    } else {
        res.locals.user = null;
    }
    next();
});

// --- ROUTER - TEMEL YÖNLENDİRMELER ---

// Ana Sayfa
app.get('/', (req, res) => {
    res.render('index');
});

// Kayıt Ol (POST)
app.post('/register', async (req, res) => {
    try {
        const { nickname, email, password } = req.body;
        const exists = await User.findOne({ $or: [{ email }, { nickname }] });
        if (exists) return res.send('<script>alert("Kullanıcı adı veya Email zaten var!"); window.location="/";</script>');

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({
            nickname,
            email,
            password: hashedPassword,
            bpl: 2500 // Başlangıç Hediyesi
        });
        await newUser.save();
        res.send('<script>alert("Kayıt Başarılı! Giriş Yapın."); window.location="/";</script>');
    } catch (err) {
        res.status(500).send("Kayıt hatası oluştu.");
    }
});
// Giriş Yap (POST) - HATASIZ VERSİYON
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.send('<script>alert("Hatalı Bilgiler!"); window.location="/";</script>');
        }

        if (user.role === 'banned') {
            return res.send(`SÜRGÜN EDİLDİNİZ! Neden: ${user.banReason}`);
        }

        // --- BURADA PARANTEZLERİ YANLIŞ KAPATMIŞTIN, DÜZELTTİM ---
        req.session.userId = user._id;
        res.redirect('/profil');

    } catch (err) {
        console.error(err);
        res.status(500).send("Giriş hatası.");
    }
});

// --- PROFİL VE ENVANTER İŞLEMLERİ ---

// Profil Sayfasını Görüntüle
app.get('/profil', async (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    try {
        const user = await User.findById(req.session.userId);
        res.render('profil', { user });
    } catch (err) {
        res.status(500).send("Sunucu hatası.");
    }
});

// Arena İçin Hayvan Seçimi (POST)
app.post('/select-animal', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ status: 'error' });
    
    const { animalName } = req.body;
    try {
        await User.findByIdAndUpdate(req.session.userId, {
            selectedAnimal: animalName
        });
        
        // Log Kaydı
        await Log.create({
            type: 'ARENA',
            content: `Kullanıcı savaş için ${animalName} seçti.`,
            userEmail: req.session.nickname // session'da sakladığımız nick
        });

        res.json({ status: 'success', message: `${animalName} seçildi.` });
    } catch (err) {
        res.status(500).json({ status: 'error' });
    }
});

// Enerji Yenileme (Stamina Refill - 10 BPL)
app.post('/refill-stamina', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ status: 'error' });

    const { animalName } = req.body;
    try {
        const user = await User.findById(req.session.userId);
        
        if (user.bpl < 10) {
            return res.json({ status: 'low_balance', message: 'Yetersiz BPL!' });
        }

        // Envanterdeki ilgili hayvanın enerjisini %100 yap
        const itemIndex = user.inventory.findIndex(item => item.name === animalName);
        if (itemIndex > -1) {
            user.inventory[itemIndex].stamina = 100;
            user.bpl -= 10; // Ücreti kes
            await user.save();
            
            res.json({ status: 'success', newBpl: user.bpl });
        } else {
            res.json({ status: 'not_found' });
        }
    } catch (err) {
        res.status(500).json({ status: 'error' });
    }
});
// --- ADMIN MIDDLEWARE ---
// --- 1. ÖDEME ONAYLAMA (BPL YÜKLEME) ---
app.post('/admin/approve-payment', isAdmin, async (req, res) => {
    const { paymentId } = req.body;
    try {
        const payment = await Payment.findById(paymentId);
        if (!payment || payment.status !== 'pending') {
            return res.json({ msg: 'İşlem geçersiz veya zaten onaylanmış.' });
        } // if burada bitti

        const user = await User.findById(payment.userId);
        if (user) {
            user.bpl += payment.amount_bpl;
            payment.status = 'approved';
            await user.save();
            await payment.save();
            return res.json({ msg: 'Ödeme başarıyla onaylandı.' });
        }
    } // <--- TRY BLOĞUNU KAPATAN KRİTİK PARANTEZ BU!
    catch (err) {
        console.error(err);
        res.status(500).send("Hata!");
    }
});
// --- 1. ÖDEME ONAYLAMA (BPL YÜKLEME) ---
app.post('/admin/approve-payment', isAdmin, async (req, res) => {
    const { paymentId } = req.body;
    try {
        const payment = await Payment.findById(paymentId);
        
        if (!payment || payment.status !== 'pending') {
            return res.json({ msg: 'İşlem geçersiz veya zaten onaylanmış.' });
        }

        const user = await User.findById(payment.userId);
        if (user) {
            user.bpl += payment.amount_bpl;
            payment.status = 'approved';
            await user.save();
            await payment.save();
            res.json({ msg: `${user.nickname} kullanıcısına BPL yüklendi.` });
        } else {
            res.json({ msg: 'Kullanıcı bulunamadı.' });
        }

    } // <--- EKSİK OLAN VE HATAYA SEBEP OLAN PARANTEZ BUYDU!
    catch (err) {
        console.error(err);
        res.status(500).send("Onaylama işlemi sırasında hata oluştu!");
    }
});// --- 1. ÖDEME ONAYLAMA (BPL YÜKLEME) ---
// BURADAKİ "async" KELİMESİ KRİTİK!
app.post('/admin/approve-payment', isAdmin, async (req, res) => {
    const { paymentId } = req.body;
    try {
        const payment = await Payment.findById(paymentId).populate('userId');
        
        if (!payment || payment.status !== 'pending') {
            return res.json({ msg: 'İşlem geçersiz veya zaten onaylanmış.' });
        }

        // Bakiyeyi Güncelle
        payment.userId.bpl += payment.amount_bpl;
        payment.status = 'approved';

        // Veritabanına kaydet
        await payment.userId.save();
        await payment.save();

        // Socket üzerinden kullanıcıya anlık haber ver
        if (payment.userId.socketId) {
            io.to(payment.userId.socketId).emit('update-bpl', payment.userId.bpl);
            io.to(payment.userId.socketId).emit('new-message', { 
                sender: 'SİSTEM', 
                text: `🛡️ Lojistik destek onaylandı: +${payment.amount_bpl} BPL hesabınıza eklendi.` 
            });
        }

        res.json({ msg: 'Ödeme başarıyla onaylandı.' });
        
    } catch (err) { 
        console.error(err);
        res.status(500).json({ msg: 'Onay hatası oluştu.' }); 
    }
});

// --- 2. TALEP SİLME / REDDETME ---
app.post(['/admin/reject-payment', '/admin/reject-withdraw'], isAdmin, async (req, res) => {
    const { id } = req.body;
    try {
        // Talebi tamamen siler (İsteğe bağlı olarak status='rejected' da yapabilirsin)
        await Payment.findByIdAndDelete(id);
        await Withdraw.findByIdAndDelete(id); 
        res.json({ msg: 'Talep sistemden temizlendi.' });
    } catch (err) { res.json({ msg: 'Hata.' }); }
});

// --- 3. BAN SİSTEMİ (YASAKLAMA) ---
app.post('/admin/ban-user', isAdmin, async (req, res) => {
    const { userId, reason } = req.body;
    try {
        const user = await User.findById(userId);
        if (!user) return res.json({ msg: 'Kullanıcı bulunamadı.' });

        user.role = 'banned'; // Rolü banlı olarak değiştir
        user.banReason = reason;
        await user.save();

        // Eğer kullanıcı o an online ise bağlantısını kopar
        const sockets = await io.fetchSockets();
        for (const s of sockets) {
            if (s.request.session.user._id == userId) {
                s.emit('force-logout', { reason: reason });
                s.disconnect();
            }
        }
        res.json({ msg: 'Kullanıcı sürgün edildi.' });
    } catch (err) { res.json({ msg: 'Ban hatası.' }); }
});

// --- 4. TOPLU EMAIL DUYURU (BOMBA ÖZELLİK) ---
const nodemailer = require('nodemailer'); // npm install nodemailer
app.post('/admin/send-announcement', isAdmin, async (req, res) => {
    const { subject, body } = req.body;
    try {
        const users = await User.find({}, 'email');
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: 'seninmail@gmail.com', pass: 'uygulama-sifresi' }
        });

        // Tüm kullanıcılara gönderim
        const emails = users.map(u => u.email).join(',');
        await transporter.sendMail({
            from: '"BPL MERKEZ" <seninmail@gmail.com>',
            to: emails,
            subject: `🚨 BPL DUYURU: ${subject}`,
            text: body,
            html: `<div style="background:#000; color:#eee; padding:20px; border:2px solid #39FF14;">${body}</div>`
        });

        res.json({ msg: 'Tüm komutanlara email iletildi.' });
    } catch (err) { res.json({ msg: 'Email gönderilemedi.' }); }
});



// app.js içine eklenecek satın alma API'si
app.post('/api/buy-item', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ success: false, error: 'Oturum açılmadı.' });

    const { itemName, price } = req.body;
    const SAFETY_LIMIT = 5500; // Senin belirlediğin stratejik alt limit

    // Sunucu tarafı fiyat doğrulaması (Güvenlik için şart!)
    const highTier = ['Lion', 'Tiger', 'Rhino', 'Gorilla'];
    const expectedPrice = highTier.includes(itemName) ? 5000 : 1000;

    if (price !== expectedPrice) {
        return res.status(400).json({ success: false, error: 'Geçersiz fiyat verisi!' });
    }

    try {
        const user = await User.findById(req.session.userId);

        // Bakiye ve Limit Kontrolü
        if (user.bpl - price < SAFETY_LIMIT) {
            return res.status(400).json({ success: false, error: `Limit engeli! Minimum ${SAFETY_LIMIT} BPL kalmalı.` });
        }

        // Zaten sahip mi?
        const isOwned = user.inventory.some(item => item.name === itemName);
        if (isOwned) {
            return res.status(400).json({ success: false, error: 'Bu karaktere zaten sahipsiniz.' });
        }

        // Satın Alma İşlemi
        user.bpl -= price;
        user.inventory.push({
            name: itemName,
            img: `/caracter/profile/${itemName.toLowerCase()}.jpg`,
            stamina: 100,
            level: 1,
            stats: { 
                hp: 100, 
                atk: itemName === 'Tiger' ? 95 : 70, // İsteğe göre özelleştirilebilir
                def: 50 
            }
        });

        await user.save();

        // Log Kaydı
        await Log.create({
            type: 'MARKET',
            content: `${itemName} satın alındı. Harcanan: ${price} BPL`,
            userEmail: user.email
        });

        res.json({ success: true, newBpl: user.bpl });
    } catch (err) {
        res.status(500).json({ success: false, error: 'İşlem sırasında hata oluştu.' });
    }
});



// 1. Cüzdan Adresi Kaydı
app.post('/save-wallet-address', async (req, res) => {
    const { userId, usdtAddress } = req.body;
    try {
        if (!usdtAddress.startsWith('0x') || usdtAddress.length < 40) {
            return res.status(400).json({ msg: "Geçersiz BEP20 adresi!" });
        }
        await User.findByIdAndUpdate(userId, { usdt_address: usdtAddress });
        res.json({ status: 'success', msg: "Adres başarıyla protokolüne işlendi." });
    } catch (err) {
        res.status(500).json({ msg: "Sunucu hatası." });
    }
});

// 2. Karakter Satışı (%30 Yakım ile)
app.post('/sell-character', async (req, res) => {
    const { userId, animalIndex, fiyat } = req.body;
    try {
        const user = await User.findById(userId);
        
        if (user.inventory.length <= 1) {
            return res.json({ status: 'error', msg: "Son kalan ana varlığınızı satamazsınız!" });
        }

        // Gelen fiyatı doğrula (Güvenlik)
        const highTier = ['LION', 'RHINO', 'GORILLA', 'TIGER'];
        const animal = user.inventory[animalIndex];
        const originalPrice = highTier.includes(animal.name.toUpperCase()) ? 5000 : 1000;
        
        const refund = originalPrice * 0.70; // %30 yakım, %70 iade
        
        // Envanterden kaldır ve bakiyeyi ekle
        user.inventory.splice(animalIndex, 1);
        user.bpl += refund;
        
        user.markModified('inventory');
        await user.save();

        res.json({ status: 'success', msg: `${refund} BPL bakiyenize eklendi.` });
    } catch (err) {
        res.status(500).json({ msg: "İşlem sırasında bir hata oluştu." });
    }
});

// 3. Tasfiye (Withdraw) Talebi
app.post('/withdraw-request', async (req, res) => {
    const { amount } = req.body; // Miktar frontend'den alınır
    const user = await User.findById(req.session.userId);

    if (amount < 7500) return res.json({ msg: "Minimum eşik 7.500 BPL!" });
    if (user.bpl < amount) return res.json({ msg: "Yetersiz bakiye!" });
    if (!user.usdt_address) return res.json({ msg: "Lütfen önce BEP20 adresinizi kaydedin!" });

    // Talebi bir 'Withdrawals' koleksiyonuna kaydet (Admin onayı için)
    // await Withdrawal.create({ userId: user._id, amount, netAmount: amount * 0.70 });
    
    user.bpl -= amount;
    await user.save();
    
    res.json({ status: 'success', msg: "Talebiniz alındı. 24 saat içinde incelenecektir." });
});

// Ödeme Bildirimi Alımı
app.post('/verify-payment', async (req, res) => {
    const { txid, usd, bpl } = req.body;
    const userId = req.session.userId;

    if (!userId) return res.status(401).json({ status: 'error', msg: 'Oturum geçersiz.' });
    if (!txid || txid.length < 20) return res.status(400).json({ status: 'error', msg: 'Geçersiz TxID formatı.' });

    try {
        // Burada gerçek projelerde TxID'nin daha önce kullanılıp kullanılmadığı kontrol edilir
        // Örnek: const existing = await Payment.findOne({ txid });
        
        console.log(`[ÖDEME TALEBİ] Kullanıcı: ${userId}, Miktar: ${usd} USDT, TxID: ${txid}`);

        // Admin onayına düşecek bir yapı kurana kadar talebi loglayabilir 
        // veya kullanıcıya "İncelemeye alındı" mesajı dönebilirsin.
        
        res.json({ 
            status: 'success', 
            msg: 'Transfer bildiriminiz sisteme ulaştı. Blokzincir onayından sonra (yaklaşık 5-30 dk) bakiyeniz güncellenecektir.' 
        });
    } catch (err) {
        res.status(500).json({ status: 'error', msg: 'Protokol hatası oluştu.' });
    }
});

io.on('connection', (socket) => {
    const user = socket.request.session.user; // Session'dan kullanıcıyı al

    // 1. Genel Mesajlaşma
    socket.on('chat-message', (data) => {
        io.emit('new-message', { sender: user.nickname, text: data.text });
    });

    // 2. Arena Daveti Gönderimi (Challenge)
    socket.on('send-challenge', (data) => {
        const battleRoom = `battle_${user.nickname}_${data.target}`;
        // Rakibe daveti gönder
        io.emit('challenge-received', {
            from: user.nickname,
            target: data.target,
            room: battleRoom,
            type: 'ARENA'
        });
    });

    // 3. Konsey (Özel Oda) Daveti
    socket.on('send-meeting-invite', (data) => {
        const privateRoom = `meeting_${user.nickname}_${data.target}`;
        io.emit('meeting-request', {
            from: user.nickname,
            target: data.target,
            room: privateRoom
        });
    });

    // 4. Lojistik Destek (VIP BPL Transferi)
    socket.on('send-gift-vip', async (data) => {
        try {
            const sender = await User.findOne({ nickname: user.nickname });
            const target = await User.findOne({ nickname: data.targetNick });

            if (sender.bpl - data.amount >= 5500) {
                sender.bpl -= data.amount;
                target.bpl += data.amount;
                await sender.save();
                await target.save();

                // Her iki tarafa da bakiye güncellemesi gönder
                socket.emit('update-bpl', sender.bpl);
                io.emit('new-message', { 
                    sender: 'SİSTEM', 
                    text: `${sender.nickname}, ${target.nickname} kullanıcısına ${data.amount} BPL lojistik destek gönderdi!` 
                });
            }
        } catch (err) { console.log(err); }
    });
});


io.on('connection', (socket) => {
    // ... user session kontrolleri ...

    socket.on('join-meeting', ({ roomId, peerId }) => {
        // Oda isimlerinin karışmaması için bir ön ek ekliyoruz (GÜVENLİK ÖNLEMİ)
        const secureRoomId = `MEET_ROOM_${roomId}`;
        
        socket.join(secureRoomId);
        socket.currentRoom = secureRoomId; // Socket üzerinde odayı sakla
        socket.peerId = peerId;

        // Odadaki diğer kişilere yeni birinin geldiğini ve PeerID'sini bildir
        socket.to(secureRoomId).emit('user-connected', {
            id: socket.id,
            peerId: peerId,
            nickname: socket.request.session.user.nickname
        });

        console.log(`[KONSEY] ${socket.request.session.user.nickname} odaya katıldı: ${secureRoomId}`);
    });

    // Sadece bulunulan odaya mesaj gönder (Çakışmayı önleyen asıl kısım)
    socket.on('send-meeting-message', (data) => {
        if (socket.currentRoom) {
            io.to(socket.currentRoom).emit('new-meeting-message', {
                sender: socket.request.session.user.nickname,
                text: data.text
            });
        }
    });

    socket.on('disconnect', () => {
        if (socket.currentRoom) {
            socket.to(socket.currentRoom).emit('user-disconnected', socket.peerId);
        }
    });
});
socket.on('gift-success', (data) => {
    appendMsg("BİLGİ", `🛡️ ${data.amount} BPL değerinde lojistik destek başarıyla aktarıldı.`);
});

// --- ARENA AYARLARI ---
const BPL_BETS = { 1: 25, 2: 55, 4: 75, 6: 85 }; // Multiplier -> Giriş Ücreti
const WIN_PRIZES = { 1: 50, 2: 100, 4: 140, 6: 160 }; // Multiplier -> Kazanılacak Toplam BPL
let waitingLobby = []; // Eşleşme bekleyen havuzu

io.on('connection', (socket) => {
    
    // 1. EŞLEŞME BULMA (FIND MATCH)
    socket.on('find-match', async (data) => {
        const { myNick, myAnimal, multiplier } = data;
        const userId = socket.request.session.user._id;
        const betAmount = BPL_BETS[multiplier];

        // Kullanıcı bakiyesi kontrolü
        const user = await User.findById(userId);
        if (user.bpl < betAmount) {
            return socket.emit('error', { msg: 'Yetersiz BPL!' });
        }

        // Havuza ekle
        const playerInfo = { 
            socketId: socket.id, 
            userId, 
            nick: myNick, 
            animal: myAnimal, 
            multiplier 
        };
        
        // Aynı çarpanda bekleyen biri var mı?
        const opponentIndex = waitingLobby.findIndex(p => p.multiplier === multiplier && p.userId !== userId);

        if (opponentIndex !== -1) {
            // RAKİP BULUNDU!
            const opponent = waitingLobby.splice(opponentIndex, 1)[0];
            startPvP(playerInfo, opponent);
        } else {
            // Bekleme listesine al
            waitingLobby.push(playerInfo);
        }
    });

    // 2. PvP SAVAŞINI BAŞLAT
    async function startPvP(p1, p2) {
        const prize = WIN_PRIZES[p1.multiplier];
        const bet = BPL_BETS[p1.multiplier];

        // Şans Faktörü (Zar Atma): %50-50 veya karakter gücüne göre
        const p1Win = Math.random() > 0.5;

        try {
            const user1 = await User.findById(p1.userId);
            const user2 = await User.findById(p2.userId);

            if (p1Win) {
                user1.bpl += (prize - bet); // Kazandı
                user2.bpl -= bet; // Kaybetti
            } else {
                user2.bpl += (prize - bet);
                user1.bpl -= bet;
            }

            await user1.save();
            await user2.save();

            // Her iki tarafa sonuçları gönder
            io.to(p1.socketId).emit('battle-result', {
                isWin: p1Win,
                prize: prize,
                opponentName: p2.nick,
                opponentAnimal: p2.animal
            });

            io.to(p2.socketId).emit('battle-result', {
                isWin: !p1Win,
                prize: prize,
                opponentName: p1.nick,
                opponentAnimal: p1.animal
            });

        } catch (err) { console.log("PvP Hata:", err); }
    }

    // 3. BOT SAVAŞI (KİMSE BULUNAMAZSA)
    socket.on('start-bot-battle', async (data) => {
        const { multiplier, userId } = data;
        const bet = BPL_BETS[multiplier];
        const prize = WIN_PRIZES[multiplier];

        try {
            const user = await User.findById(userId);
            if (user.bpl < bet) return;

            // BOT AYARLARI
            const botAnimals = ["Wolf", "Tiger", "Lion", "Bear"];
            const botAnimal = botAnimals[Math.floor(Math.random() * botAnimals.length)];
            const isWin = Math.random() > 0.4; // %60 şansla kullanıcı kazanır (Bot biraz daha kolay)

            if (isWin) {
                user.bpl += (prize - bet);
            } else {
                user.bpl -= bet;
            }
            await user.save();

            socket.emit('battle-result', {
                isWin,
                prize,
                opponentName: "SİBER_BOT_" + Math.floor(Math.random() * 999),
                opponentAnimal: botAnimal
            });
        } catch (err) { console.log("Bot Hata:", err); }
    });

    // Bağlantı koparsa lobiden temizle
    socket.on('disconnect', () => {
        waitingLobby = waitingLobby.filter(p => p.socketId !== socket.id);
    });
});
















































// app.js içine eklenecek geliştirme API'si
app.post('/api/upgrade-stat', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ success: false, error: 'Oturum kapalı.' });

    const { animalName, statType } = req.body;
    const SAFETY_LIMIT = 300; // development.ejs'deki limitinle uyumlu

    // Stat bazlı ücretler ve artış miktarları
    const costs = { hp: 15, atk: 15, def: 10 };
    const gains = { hp: 10, atk: 5, def: 5 };
    const limits = { hp: 1000, atk: 200, def: 200 }; // Maksimum geliştirme sınırları

    try {
        const user = await User.findById(req.session.userId);
        const animalIndex = user.inventory.findIndex(a => a.name === animalName);

        if (animalIndex === -1) return res.status(404).json({ success: false, error: 'Hayvan bulunamadı.' });
        if (user.bpl - costs[statType] < SAFETY_LIMIT) {
            return res.status(400).json({ success: false, error: 'Stratejik bakiye sınırı!' });
        }

        let animal = user.inventory[animalIndex];

        // Sınır Kontrolü (Zaten max seviyedeyse geliştirme yapma)
        if (animal[statType] >= limits[statType]) {
            return res.status(400).json({ success: false, error: 'Maksimum seviyeye ulaşıldı!' });
        }

        // Güncelleme İşlemi
        user.bpl -= costs[statType];
        animal[statType] += gains[statType];
        
        // Opsiyonel: Her 5 geliştirmede bir LVL artışı yapabilirsin
        const totalStats = animal.hp + animal.atk + animal.def;
        animal.level = Math.floor(totalStats / 50); // Örnek level hesabı

        // MongoDB'ye "bu dizi değişti" haberi veriyoruz
        user.markModified('inventory');
        await user.save();

        res.json({ 
            success: true, 
            newBalance: user.bpl, 
            newStat: animal[statType],
            newLevel: animal.level 
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Sunucu hatası.' });
    }
});





// Çıkış Yap
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- SOCKET.IO (ARENA & CHAT MANTIĞI BAŞLANGICI) ---
io.on('connection', (socket) => {
    // Burada Arena eşleşmeleri, Chat ve Meeting odaları yönetilecek
    console.log('Aktif Bağlantı:', socket.id);
});

// Sunucuyu Başlat
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});


















