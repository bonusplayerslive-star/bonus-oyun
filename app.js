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

// Giriş Yap (POST)
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.send('<script>alert("Hatalı Bilgiler!"); window.location="/";</script>');
        }
        req.session.userId = user._id;
        res.redirect('/profil');
    } catch (err) {
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








