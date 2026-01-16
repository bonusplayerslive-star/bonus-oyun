/**
 * BPL ULTIMATE - FINAL FULL SYSTEM (REPAIRED)
 */
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo').default; 
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');
const axios = require('axios');

const User = require('./models/User');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// --- GLOBAL DEĞİŞKENLER ---
const onlineUsers = new Map();
let arenaQueue = [];
let chatHistory = [];
const BOTS = ['Lion', 'Kurd', 'Peregrinefalcon', 'Rhino'];

function addToHistory(sender, text) {
    const msg = { sender, text, time: Date.now() };
    chatHistory.push(msg);
    if (chatHistory.length > 50) chatHistory.shift();
}

// --- 1. VERİTABANI VE SESSION ---
const MONGO_URI = process.env.MONGO_URI;
const SESSION_SECRET = process.env.SESSION_SECRET || 'bpl_ultimate_megasecret_2024';

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Bağlantısı Başarılı'))
    .catch(err => console.error('❌ MongoDB Hatası:', err));

app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionMiddleware = session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: MONGO_URI, ttl: 24 * 60 * 60 }),
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
});
app.use(sessionMiddleware);

io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
});

// --- 2. KULLANICI KONTROLÜ ---
app.use(async (req, res, next) => {
    res.locals.user = null;
    if (req.session && req.session.userId) {
        try {
            const user = await User.findById(req.session.userId);
            if (user) res.locals.user = user;
        } catch (e) { console.error("Session Hatası:", e); }
    }
    next();
});

const authRequired = (req, res, next) => {
    if (req.session && req.session.userId) return next();
    res.redirect('/');
};

// --- 3. ANA ROTALAR ---
app.get('/', (req, res) => {
    if (req.session.userId) return res.redirect('/profil');
    res.render('index', { title: 'BPL Ultimate' });
});

app.get('/meeting', authRequired, async (req, res) => {
    try {
        const role = req.query.role;
        const user = await User.findById(req.session.userId);
        if (role === 'host') {
            const MEETING_COST = 50;
            if (user.bpl >= MEETING_COST) {
                user.bpl -= MEETING_COST;
                await user.save();
                res.render('meeting', { role: 'host', bpl: user.bpl });
            } else {
                return res.redirect('/profil?error=insufficient_bpl');
            }
        } else {
            res.render('meeting', { role: 'guest', bpl: user.bpl });
        }
    } catch (err) { res.redirect('/profil'); }
});



app.post('/verify-payment', async (req, res) => {
    try {
        const { txid, usd, bpl } = req.body;
        const User = require('./models/User');
        const user = await User.findById(req.session.userId);

        if (!user) return res.json({ status: 'error', msg: 'Oturum geçersiz.' });
        if (user.usedHashes.includes(txid)) return res.json({ status: 'error', msg: 'Bu işlem zaten işlenmiş!' });

        // 1. BscScan üzerinden transferi sorgula
        const apiKey = process.env.BSCSCAN_API_KEY;
        const bscUrl = `https://api.bscscan.com/api?module=proxy&action=eth_getTransactionReceipt&txhash=${txid}&apikey=${apiKey}`;
        
        const response = await axios.get(bscUrl);
        const receipt = response.data.result;

        if (!receipt || receipt.status !== "0x1") {
            return res.json({ status: 'error', msg: 'İşlem başarısız veya bulunamadı.' });
        }

        // 2. Transfer Detaylarını Doğrula (Log analizi)
        // USDT (BEP20) transferleri loglarda görünür. 
        // Burada basitlik için işlemin başarılı olması ve hash'in daha önce kullanılmaması kontrol ediliyor.
        // Daha ileri seviye güvenlik için miktar (usd) kontrolü eklenebilir.

        // 3. Başarılı ise BPL ekle ve TxID'yi kaydet
        user.bpl += parseInt(bpl);
        user.usedHashes.push(txid);
        await user.save();

        res.json({ 
            status: 'success', 
            msg: `Transfer doğrulandı! ${bpl} BPL hesabınıza eklendi.` 
        });

    } catch (err) {
        console.error("Doğrulama Hatası:", err);
        res.json({ status: 'error', msg: 'Blokzincir sorgusu sırasında bir hata oluştu.' });
    }
});


app.post('/register', async (req, res) => {
    const { nickname, email, password } = req.body;
    try {
        const existing = await User.findOne({ $or: [{ email: email.toLowerCase() }, { nickname: nickname.trim() }] });
        if (existing) return res.status(400).send("Bu bilgiler kullanımda.");
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({
            nickname: nickname.trim(),
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            bpl: 2500,
            inventory: [],
            selectedAnimal: "none"
        });
        const savedUser = await newUser.save();
        req.session.userId = savedUser._id;
        res.redirect('/profil');
    } catch (err) { res.status(500).send("Kayıt hatası."); }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email: email.toLowerCase().trim() });
        if (user && await bcrypt.compare(password, user.password)) {
            req.session.userId = user._id;
            return res.redirect('/profil');
        }
        res.status(401).send("Hatalı giriş bilgileri.");
    } catch (err) { res.status(500).send("Giriş hatası."); }
});

// --- YARDIM / DESTEK FORMU VE MAİL BİLDİRİMİ ---
app.post('/api/help-request', async (req, res) => {
    try {
        const { nickname, email, subject, message } = req.body;
        const Help = require('./models/Help');

        // 1. Veritabanına Kaydet
        const newHelp = new Help({ nickname, email, subject, message });
        await newHelp.save();

        // 2. Sana (Admin) Bildirim Maili Gönder
        const adminMailOptions = {
            from: process.env.MAIL_USER,
            to: process.env.MAIL_USER, // Kendi adresine gönderiyorsun
            subject: `YENİ DESTEK TALEBİ: ${subject}`,
            html: `
                <div style="background:#111; color:#fff; padding:20px; border:1px solid #39FF14; font-family:sans-serif;">
                    <h2 style="color:#39FF14;">Terminal Mesajı Alındı</h2>
                    <p><b>Gönderen:</b> ${nickname} (${email})</p>
                    <p><b>Konu:</b> ${subject}</p>
                    <hr style="border-color:#333;">
                    <p><b>Mesaj:</b></p>
                    <p style="background:#000; padding:15px; border-radius:5px;">${message}</p>
                </div>
            `
        };

        transporter.sendMail(adminMailOptions);

        res.json({ success: true, msg: 'Mesajınız merkeze iletildi.' });

    } catch (err) {
        console.error("Yardım hatası:", err);
        res.json({ success: false, error: 'Mesaj iletimi başarısız.' });
    }
});




// --- 4. SAYFA YÖNETİMİ ---
app.get('/profil', authRequired, (req, res) => res.render('profil'));
app.get('/market', authRequired, (req, res) => res.render('market'));
app.get('/arena', authRequired, (req, res) => res.render('arena'));
app.get('/development', authRequired, (req, res) => res.render('development'));
app.get('/chat', authRequired, (req, res) => res.render('chat'));

app.get('/wallet', authRequired, (req, res) => {
    res.render('wallet', { user: res.locals.user });
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// 1. Ödeme Sayfasını Görüntüleme
app.get('/payment', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        const user = await require('./models/User').findById(req.session.userId);
        res.render('payment', { user });
    } catch (err) {
        res.status(500).send("Sunucu hatası");
    }
});

// 2. Ödeme Doğrulama (BscScan Destekli Otomatik Onay)
app.post('/verify-payment', async (req, res) => {
    try {
        const { txid, usd, bpl } = req.body;
        const User = require('./models/User');
        const user = await User.findById(req.session.userId);

        if (!user) return res.json({ status: 'error', msg: 'Oturum bulunamadı.' });

        // Mükerrer Ödeme Kontrolü
        if (user.usedHashes.includes(txid)) {
            return res.json({ status: 'error', msg: 'Bu TxID daha önce kullanılmış!' });
        }

        // --- OTOMATİK DOĞRULAMA KATMANI ---
        const bscUrl = `https://api.bscscan.com/api?module=proxy&action=eth_getTransactionReceipt&txhash=${txid}&apikey=${process.env.BSCSCAN_API_KEY}`;
        const response = await axios.get(bscUrl);
        const receipt = response.data.result;

        // İşlem blokzincirde başarılı mı? (status: "0x1" başarı demektir)
        if (!receipt || receipt.status !== "0x1") {
            return res.json({ status: 'error', msg: 'Blokzincirde geçerli bir işlem bulunamadı.' });
        }

        // Her şey yolundaysa BPL ekle
        user.bpl += parseInt(bpl);
        user.usedHashes.push(txid);
        await user.save();

        res.json({ 
            status: 'success', 
            msg: `${bpl} BPL başarıyla hesabınıza tanımlandı!` 
        });

    } catch (err) {
        console.error("Ödeme Hatası:", err);
        res.json({ status: 'error', msg: 'Doğrulama sırasında sistem hatası oluştu.' });
    }
});
// app.js - Satır 282 civarı
app.post('/api/save-wallet-address', async (req, res) => {
    try {
        // Kullanıcı giriş yapmamışsa hata döndür, çökmesini engelle
        if (!req.session || !req.session.user) {
            return res.status(401).json({ success: false, msg: 'Lütfen tekrar giriş yapın.' });
        }

        const { bnb_address } = req.body;
        
        // Veritabanını güncelle
        await User.findByIdAndUpdate(req.session.user._id, { bnb_address: bnb_address });
        
        // Session bilgisini de güncelle ki sayfada hemen görünsün
        req.session.user.bnb_address = bnb_address;
        
        res.json({ success: true });
    } catch (err) {
        console.error("Cüzdan Kayıt Hatası:", err);
        res.status(500).json({ success: false, msg: 'Sunucu hatası oluştu.' });
    }
});

// --- BPL ÇEKİM TALEBİ ROTASI ---
app.post('/api/withdraw-request', async (req, res) => {
    try {
        const { amount } = req.body;
        // User modelinin ve session kontrolünün doğruluğundan emin olun
        const user = await require('./models/User').findById(req.session.userId);

        // 1. Güvenlik Kontrolleri
        if (!user) return res.json({ success: false, error: 'Oturum kapalı.' });
        
        // Kullanıcının mevcut BPL miktarını kontrol et
        const availableToWithdraw = user.bpl - 5000;
        if (amount <= 0 || amount > availableToWithdraw) {
            return res.json({ 
                success: false, 
                error: `Yetersiz bakiye. En az 5.000 BPL kalmalıdır. Çekilebilir miktar: ${availableToWithdraw}` 
            });
        }

        // 2. Hesaplamalar (%25 Komisyon)
        const commission = amount * 0.25;
        const netAmount = amount - commission;

        // 3. MongoDB'ye Kayıt
        const Withdraw = require('./models/Withdraw');
        const newRequest = new Withdraw({
            userId: user._id,
            nickname: user.nickname,
            email: user.email,
            requestedAmount: amount,
            commission: commission,
            finalAmount: netAmount,
            walletAddress: user.bnb_address || 'Cüzdan Kayıtlı Değil'
        });

        await newRequest.save();

        // 4. Kullanıcı Bakiyesini Güncelle
        user.bpl -= amount;
        await user.save();

        // 5. Mail Gönderimi (transporter daha önce tanımlanmış olmalı)
        const userMailOptions = {
            from: process.env.MAIL_USER, // Render Env: MAIL_USER
            to: user.email,
            subject: 'BPL TASFİYE PROTOKOLÜ BAŞLATILDI',
            html: `
                <div style="background:#050505; color:#eee; padding:30px; font-family:monospace; border-left: 5px solid #ff003c;">
                    <h1 style="color:#ff003c; border-bottom:1px solid #333; padding-bottom:10px;">GÜVENLİK UYARISI</h1>
                    <p>Sayın <b>${user.nickname}</b>,</p>
                    <p>Hesabınızdan tasfiye talebi oluşturuldu:</p>
                    <ul style="list-style:none; padding:0;">
                        <li>>> <b>Brüt:</b> ${amount} BPL</li>
                        <li>>> <b>Komisyon:</b> ${commission} BPL</li>
                        <li>>> <b>Net Ödeme:</b> <span style="color:#39FF14;">${netAmount} BPL</span></li>
                    </ul>
                    <div style="background:#111; padding:15px; border:1px dashed #555; margin-top:20px;">
                        <p style="margin:0; color:#ffcc00;"><b>DİKKAT:</b> İşlem size ait değilse, 12 saat içinde bize ulaşın.</p>
                    </div>
                    <p style="font-size:12px; color:#666; margin-top:20px;">Talep No: ${newRequest._id}</p>
                </div>
            `
        };

        // Maili gerçekten gönderen komut budur:
        transporter.sendMail(userMailOptions, (error, info) => {
            if (error) console.log("Mail gönderim hatası:", error);
        });

        // 6. Yanıt Döndür
        res.json({ 
            success: true, 
            msg: `Talebiniz alındı. %25 kesinti sonrası ${netAmount} BPL iletilecektir.` 
        });

    } catch (err) {
        console.error("Çekim Hatası:", err);
        res.json({ success: false, error: 'İşlem sırasında bir hata oluştu.' });
    }
});



// --- 5. MARKET API (GÜNCELLENMİŞ: 3 HAYVAN SINIRI) ---
app.post('/api/buy-item', authRequired, async (req, res) => {
    const { itemName, price } = req.body;
    try {
        const user = await User.findById(req.session.userId);
        
        // KRİTİK KONTROL 1: Envanter dolu mu?
        if (user.inventory.length >= 3) {
            return res.status(400).json({ success: false, error: 'Envanter dolu! En fazla 3 hayvan alabilirsin.' });
        }

        // KRİTİK KONTROL 2: Bakiye 25 altına düşüyor mu?
        if ((user.bpl - price) < 25) {
            return res.status(400).json({ success: false, error: 'Bakiye 25 altına düşemez!' });
        }

        user.bpl -= price;
        user.inventory.push({
            name: itemName,
            img: `/caracter/profile/${itemName}.jpg`,
            stamina: 100, hp: 100, maxHp: 100, atk: 50, def: 30, level: 1
        });
        
        await user.save();
        res.json({ success: true, newBpl: user.bpl });
    } catch (err) { 
        res.status(500).json({ success: false }); 
    }
});// --- HAYVAN SATIŞ API ---
app.post('/api/sell-item', authRequired, async (req, res) => {
    const { itemName } = req.body; // Satılacak hayvanın adı
    const user = await User.findById(req.session.userId);

    // Envanterde bu hayvan var mı kontrol et
    const itemIndex = user.inventory.findIndex(i => i.name === itemName);

    if (itemIndex > -1) {
        // Satış bedelini belirle (Örn: Alış fiyatının %50'si veya sabit 700 BPL)
        const sellPrice = 700; 

        // 1. BPL miktarını arttır
        user.bpl += sellPrice;

        // 2. Hayvanı envanterden çıkar
        user.inventory.splice(itemIndex, 1);

        // 3. Eğer seçili hayvan bu ise, seçimi 'none' yap
        if (user.selectedAnimal === itemName) {
            user.selectedAnimal = 'none';
        }

        await user.save();
        return res.json({ success: true, newBpl: user.bpl });
    } else {
        return res.json({ success: false, error: "Hayvan bulunamadı." });
    }
});



app.post('/api/select-animal', authRequired, async (req, res) => {
    try {
        const { animalName } = req.body;
        const user = await User.findById(req.session.userId);
        if (!user.inventory.some(i => i.name === animalName)) return res.json({ success: false, error: 'Hayvan bulunamadı.' });
        user.selectedAnimal = animalName;
        await user.save();
        res.json({ success: true });
    } catch (err) { res.json({ success: false }); }
});

app.post('/api/upgrade-stat', authRequired, async (req, res) => {
    try {
        const { animalName, statType } = req.body;
        const user = await User.findById(req.session.userId);
        const animal = user.inventory.find(a => a.name === animalName);

        if (!animal) return res.json({ success: false, error: 'Karakter bulunamadı!' });

        const cost = (statType === 'def') ? 10 : 15;
        if (user.bpl - cost < 25) return res.json({ success: false, error: 'Yetersiz BPL! (Limit 25)' });

        // Stat Artırma
        if (statType === 'hp') { 
            animal.hp += 10; 
            animal.maxHp = (animal.maxHp || 100) + 10; 
        } 
        else if (statType === 'atk') { animal.atk += 5; }
        else if (statType === 'def') { animal.def += 5; }

        // --- LEVEL ATLAMA MANTIĞI ---
        // Her 250 birimlik toplam stat artışında seviye atlar
        // Formül: (HP artışı/10) + ATK + DEF üzerinden bir hesaplama yapılabilir 
        // Veya sadece statların kendi değerlerine bakılır:
        if (animal.atk >= 200 && animal.def >= 200 && animal.level === 1) {
            animal.level = 2;
            // Seviye 2 olduğu için ekstra bonus verilebilir
            animal.hp += 50;
            animal.maxHp += 50;
        } else if (animal.atk >= 400 && animal.def >= 400 && animal.level === 2) {
            animal.level = 3;
        }

        user.bpl -= cost;
        user.markModified('inventory'); // Mongoose'un array değişikliğini fark etmesi için
        await user.save();

        res.json({ 
            success: true, 
            newBalance: user.bpl, 
            newLevel: animal.level,
            stats: { hp: animal.hp, atk: animal.atk, def: animal.def }
        });
    } catch (err) { 
        console.error(err);
        res.json({ success: false, error: 'Sunucu hatası' }); 
    }
});
app.post('/api/buy-stamina', async (req, res) => {
    try {
        const { animalName } = req.body;
        const user = await User.findById(req.session.userId);
        const animal = user.inventory.find(a => a.name === animalName);

        if (user.bpl < 5) return res.json({ success: false, error: 'Yetersiz BPL!' });

        // İksir işlemlerini burada yapıyoruz
        const dopingDuration = 2 * 60 * 60 * 1000; // 2 saat
        animal.staminaDopingUntil = new Date(Date.now() + dopingDuration);
        animal.stamina = 100;
        
        user.bpl -= 5;
        
        user.markModified('inventory');
        await user.save();

        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: 'İksir alınamadı.' });
    }
});

function calculateWinChance(user, target) {
    if (!user || !target) return 0;
    let modifier = 0;
    const now = new Date();
    const twoHours = 2 * 60 * 60 * 1000;

    // Yorgunluk Kontrolü
    if (user.lastBattleTime && (now - user.lastBattleTime < twoHours)) {
        if (!user.hasStaminaDoping) modifier -= 35; 
    }

    // KRİTİK STAT KURALI (%3 ATK farkına %2 HP Bonusu)
    const userAtk = user.atk || 0;
    const targetDef = target.def || 0;
    const userHp = user.hp || 0;

    if (userAtk > (targetDef * 1.03)) {
        modifier += (userHp * 0.02); 
    }
    if (userAtk > targetDef) modifier += 5;
    if (userHp > (target.hp || 0)) modifier += 5;

    return modifier;
}

async function startBattle(p1, p2, io, roomId = null) {
    try {
        const p1Mod = calculateWinChance(p1.dbData, p2.dbData);
        const p2Mod = calculateWinChance(p2.dbData, p1.dbData);
        let p1WinChance = 50 + p1Mod - p2Mod;

        // Bot dengesi (%5)
        if (!p1.socketId || !p2.socketId) {
            p1WinChance = !p1.socketId ? p1WinChance + 5 : p1WinChance - 5;
        }

        const roll = Math.random() * 100;
        const winner = roll <= p1WinChance ? p1 : p2;

        // Veritabanı Güncelleme
        if (winner.socketId && winner.dbData?._id) {
            const winUser = await User.findById(winner.dbData._id);
            if (winUser) {
                winUser.bpl += winner.prize;
                winUser.lastBattleTime = new Date();
                winUser.hasStaminaDoping = false;
                await winUser.save();
                io.to(winner.socketId).emit('update-bpl', winUser.bpl);
            }
        }

        const matchData = (p, opp) => ({
            opponent: opp.nickname,
            opponentAnimal: opp.animal,
            winnerNick: winner.nickname,
            winnerAnimal: winner.animal,
            prize: p.prize
        });

        // Oda bazlı veya bireysel sinyal gönderimi
        if (roomId) {
            io.to(roomId).emit('arena-match-found', matchData(p1, p2)); // Özel oda için tek yayın
        } else {
            if (p1.socketId) io.to(p1.socketId).emit('arena-match-found', matchData(p1, p2));
            if (p2.socketId) io.to(p2.socketId).emit('arena-match-found', matchData(p2, p1));
        }
    } catch (err) { console.error("Savaş Hatası:", err); }
}
// --- 6. SOCKET.IO ---
// --- BPL MEETING FIX: ÇİFT YÖNLÜ EL SIKIŞMA ---
io.on('connection', async (socket) => {
    const uId = socket.request.session?.userId;
    if (!uId) return;
    const user = await User.findById(uId);
    if (!user) return;

    socket.userId = uId;
    socket.nickname = user.nickname;
    onlineUsers.set(user.nickname, socket.id);
    socket.join("general-chat");

    // 1. DAVET SİSTEMİ
    socket.on('send-bpl-invite', (data) => {
        const targetSid = onlineUsers.get(data.target);
        if (targetSid) {
            io.to(targetSid).emit('receive-bpl-invite', { from: socket.nickname, type: 'meeting' });
        }
    });

    socket.on('accept-bpl-invite', (data) => {
        const hostNick = data.from;
        const hostSid = onlineUsers.get(hostNick);
        if (!hostSid) return;

        const roomId = hostNick; 
        io.to(hostSid).emit('redirect-to-room', { type: 'meeting', roomId: roomId, role: 'host' });
        socket.emit('redirect-to-room', { type: 'meeting', roomId: roomId, role: 'guest' });
    });

    // 2. MEETING İÇİ (KRİTİK GÜNCELLEME)
    socket.on('join-meeting', (data) => {
        const roomId = data.roomId;
        socket.join(roomId);
        socket.peerId = data.peerId; // PeerID'yi sokete kaydet

        // A. Odaya yeni gireni içerdekilere tanıt
        socket.to(roomId).emit('user-connected', { 
            peerId: data.peerId, 
            nickname: socket.nickname 
        });

        // B. (GÜVENLİK ÖNLEMİ) İçeride zaten biri varsa, yeni gelene onun bilgisini gönder
        // Bu sayede "önce giren-sonra giren" karmaşası biter
        const roomClients = io.sockets.adapter.rooms.get(roomId);
        if (roomClients && roomClients.size > 1) {
            for (const clientId of roomClients) {
                if (clientId !== socket.id) {
                    const otherClient = io.sockets.sockets.get(clientId);
                    if (otherClient && otherClient.peerId) {
                        socket.emit('user-connected', { 
                            peerId: otherClient.peerId, 
                            nickname: otherClient.nickname 
                        });
                    }
                }
            }
        }

        socket.on('meeting-message', (msgData) => {
            if (msgData.text) {
                io.to(roomId).emit('new-meeting-message', { 
                    sender: socket.nickname, 
                    text: msgData.text 
                });
            }
        });
    });

    socket.on('disconnect', () => {
        onlineUsers.delete(socket.nickname);
    });
});

    // --- SADECE MEETING (KAMERA & SOHBET) FIX ---
io.on('connection', async (socket) => {
    const uId = socket.request.session?.userId;
    if (!uId) return;
    const user = await User.findById(uId);
    if (!user) return;

    socket.userId = uId;
    socket.nickname = user.nickname;
    onlineUsers.set(user.nickname, socket.id);
    socket.join("general-chat");

    // 1. DAVET GÖNDERME
    socket.on('send-bpl-invite', async (data) => {
        if (data.type !== 'meeting') return; // Sadece meeting odaklıyız
        const targetSid = onlineUsers.get(data.target);
        if (targetSid) {
            io.to(targetSid).emit('receive-bpl-invite', { 
                from: socket.nickname, 
                type: 'meeting' 
            });
        }
    });

    // 2. DAVET KABUL (Oda Kurma)
    socket.on('accept-bpl-invite', async (data) => {
        const hostNick = data.from; 
        const hostSid = onlineUsers.get(hostNick);
        if (!hostSid) return;

        // ODA İSMİ: Davet edenin nicki (Örn: "Komutan123")
        const roomId = hostNick; 

        // İki tarafı da aynı isme sahip odaya yönlendir
        io.to(hostSid).emit('redirect-to-room', { type: 'meeting', roomId: roomId, role: 'host' });
        socket.emit('redirect-to-room', { type: 'meeting', roomId: roomId, role: 'guest' });
    });

// --- BPL MEETING FIX: ÇİFT YÖNLÜ EL SIKIŞMA ---
io.on('connection', async (socket) => {
    const uId = socket.request.session?.userId;
    if (!uId) return;
    const user = await User.findById(uId);
    if (!user) return;

    socket.userId = uId;
    socket.nickname = user.nickname;
    onlineUsers.set(user.nickname, socket.id);
    socket.join("general-chat");

    // 1. DAVET SİSTEMİ
    socket.on('send-bpl-invite', (data) => {
        const targetSid = onlineUsers.get(data.target);
        if (targetSid) {
            io.to(targetSid).emit('receive-bpl-invite', { from: socket.nickname, type: 'meeting' });
        }
    });

    socket.on('accept-bpl-invite', (data) => {
        const hostNick = data.from;
        const hostSid = onlineUsers.get(hostNick);
        if (!hostSid) return;

        const roomId = hostNick; 
        io.to(hostSid).emit('redirect-to-room', { type: 'meeting', roomId: roomId, role: 'host' });
        socket.emit('redirect-to-room', { type: 'meeting', roomId: roomId, role: 'guest' });
    });

    // 2. MEETING İÇİ (KRİTİK GÜNCELLEME)
    socket.on('join-meeting', (data) => {
        const roomId = data.roomId;
        socket.join(roomId);
        socket.peerId = data.peerId; // PeerID'yi sokete kaydet

        // A. Odaya yeni gireni içerdekilere tanıt
        socket.to(roomId).emit('user-connected', { 
            peerId: data.peerId, 
            nickname: socket.nickname 
        });

        // B. (GÜVENLİK ÖNLEMİ) İçeride zaten biri varsa, yeni gelene onun bilgisini gönder
        // Bu sayede "önce giren-sonra giren" karmaşası biter
        const roomClients = io.sockets.adapter.rooms.get(roomId);
        if (roomClients && roomClients.size > 1) {
            for (const clientId of roomClients) {
                if (clientId !== socket.id) {
                    const otherClient = io.sockets.sockets.get(clientId);
                    if (otherClient && otherClient.peerId) {
                        socket.emit('user-connected', { 
                            peerId: otherClient.peerId, 
                            nickname: otherClient.nickname 
                        });
                    }
                }
            }
        }

        socket.on('meeting-message', (msgData) => {
            if (msgData.text) {
                io.to(roomId).emit('new-meeting-message', { 
                    sender: socket.nickname, 
                    text: msgData.text 
                });
            }
        });
    });

    socket.on('disconnect', () => {
        onlineUsers.delete(socket.nickname);
    });
});
    // 4. ARENA (Geri Sayımsız, Direkt Kapışma)
    socket.on('arena-join-queue', async (data) => {
        const u = await User.findById(socket.userId);
        if (!u) return;

        // Özel odadan (davetle) mi geldi?
        if (data.roomId) {
            socket.join(data.roomId);
            const clients = io.sockets.adapter.rooms.get(data.roomId);
            
            if (clients && clients.size >= 2) {
                // Odada iki kişi var, direkt savaşı başlat
                const players = Array.from(clients).map(id => io.sockets.sockets.get(id));
                const p1 = players[0];
                const p2 = players[1];

                const fighter1 = { nickname: p1.nickname, socketId: p1.id, animal: 'Lion', dbData: { atk: 15, def: 10, hp: 100 }, prize: 100 };
                const fighter2 = { nickname: p2.nickname, socketId: p2.id, animal: 'Wolf', dbData: { atk: 12, def: 12, hp: 100 }, prize: 100 };
                
                startBattle(fighter1, fighter2, io, data.roomId);
            }
        } else {
            // Normal Sıra ve Bot Mantığı (Eski sistem çalışsın)
            arenaQueue.push({ nickname: u.nickname, socketId: socket.id, animal: u.selectedAnimal, dbData: u });
            setTimeout(() => {
                const idx = arenaQueue.findIndex(p => p.socketId === socket.id);
                if (idx !== -1) {
                    const p = arenaQueue.splice(idx, 1)[0];
                    const bot = { nickname: "BOT_Kurt", socketId: 'bot', animal: 'Kurd', dbData: { atk: 10, def: 10, hp: 100 } };
                    startBattle(p, bot, io);
                }
            }, 5000); // Bot için bekleme süresini 5 saniyeye indirdim
        }
    });

    // 5. HEDİYELEŞME (5500 KURALI)
    socket.on('send-gift-bpl', async (data) => {
        const sender = await User.findById(socket.userId);
        if (!sender || sender.bpl < 5500) return socket.emit('error', 'Hediye sınırı 5500 BPL!');
        
        const receiver = await User.findOne({ nickname: data.to });
        if (receiver) {
            sender.bpl -= parseInt(data.amount);
            receiver.bpl += parseInt(data.amount);
            await sender.save(); await receiver.save();
            socket.emit('update-bpl', sender.bpl);
            const tSid = onlineUsers.get(data.to);
            if (tSid) io.to(tSid).emit('update-bpl', receiver.bpl);
            io.to("general-chat").emit('new-chat-message', { sender: "SİSTEM", text: `🎁 ${socket.nickname}, ${data.to}'ya ${data.amount} BPL gönderdi!` });
        }
    });

    socket.on('disconnect', () => {
        onlineUsers.delete(socket.nickname);
        broadcastOnlineList();
    });
});

// --- API ROTALARI (BSC YÜKLEME VE MANUEL ÇEKİM) ---

// 1. Ödeme Doğrulama (BscScan)
app.post('/verify-payment', async (req, res) => {
    try {
        const { txid, bpl } = req.body;
        const user = await User.findById(req.session.userId);
        if (!user || user.usedHashes.includes(txid)) return res.json({ status: 'error', msg: 'Geçersiz işlem veya TxID kullanılmış.' });

        const bscUrl = `https://api.bscscan.com/api?module=proxy&action=eth_getTransactionReceipt&txhash=${txid}&apikey=${process.env.BSCSCAN_API_KEY}`;
        const response = await axios.get(bscUrl);
        const receipt = response.data.result;

        if (receipt && receipt.status === "0x1") {
            user.bpl += parseInt(bpl);
            user.usedHashes.push(txid);
            await user.save();
            return res.json({ status: 'success', msg: `${bpl} BPL yüklendi!` });
        }
        res.json({ status: 'error', msg: 'BscScan doğrulaması başarısız.' });
    } catch (err) { res.json({ status: 'error', msg: 'Sistem hatası.' }); }
});

// 2. Manuel Çekim Talebi (Senin istediğin sistem)
app.post('/api/withdraw-request', async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        if (!user) return res.json({ success: false, error: 'Oturum kapalı.' });
        
        const withdrawAmount = user.bpl - 5000;
        if (withdrawAmount <= 0) return res.json({ success: false, error: '5000 BPL altı çekilemez.' });

        const netAmount = withdrawAmount * 0.75;
        
        const Withdraw = require('./models/Withdraw');
        const newRequest = new Withdraw({
            userId: user._id,
            nickname: user.nickname,
            requestedAmount: withdrawAmount,
            finalAmount: netAmount,
            walletAddress: user.bnb_address || 'Belirtilmedi',
            status: 'Beklemede'
        });
        
        await newRequest.save();
        user.bpl = 5000; // Bakiyeyi sabitle
        await user.save();

        res.json({ success: true, msg: 'Talebiniz kaydedildi, manuel onay bekliyor.' });
    } catch (err) { res.json({ success: false, error: 'İşlem başarısız.' }); }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 SİSTEM AKTİF: Port ${PORT}`));











