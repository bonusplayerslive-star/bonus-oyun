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
// --- ARENA SAVAŞ MOTORU (GÜNCEL & TEMİZ) ---
async function startBattle(p1, p2, io) {
    let winner;
    const isP1Bot = !p1.socketId;
    const isP2Bot = !p2.socketId;

    // NOT: Bahisler (bet) arena-join-queue aşamasında peşin kesildiği için 
    // burada sadece kazananı belirleyip ödülü veriyoruz.

    // 1. ADIM: Kazananı Belirle (Bot varsa %55 bot kazanır)
    if (isP1Bot || isP2Bot) {
        // Eğer bir taraf botsa, botun kazanma ihtimali %55
        const botWon = Math.random() < 0.55; 
        winner = isP2Bot ? (botWon ? p2 : p1) : (botWon ? p1 : p2);
    } else {
        // İki gerçek oyuncuysa güç (power) değerine bakılır
        winner = p1.power >= p2.power ? p1 : p2;
    }

    // 2. ADIM: Ödülü Kazananın Hesabına Yatır
    if (winner.socketId) { // Kazanan bot değilse ödülü ver
        try {
            const winUser = await User.findOne({ nickname: winner.nickname });
            if (winUser) {
                // Seçilen çarpanın ödülünü ekle (Örn: 10X ise 1000 BPL)
                winUser.bpl += winner.prize; 
                await winUser.save();
                
                // Canlı bakiyeyi frontend'e gönder
                io.to(winner.socketId).emit('update-bpl', winUser.bpl);
            }
        } catch (err) { 
            console.error("Arena Ödül Yatırma Hatası:", err); 
        }
    }

    // 3. ADIM: Savaş Sonucunu Her İki Tarafa Da Gönder
    const matchData = (p, opp) => ({
        opponent: opp.nickname,
        opponentAnimal: opp.animal, 
        winnerNick: winner.nickname,
        winnerAnimal: winner.animal, 
        prize: p.prize
    });

    if (p1.socketId) io.to(p1.socketId).emit('arena-match-found', matchData(p1, p2));
    if (p2.socketId) io.to(p2.socketId).emit('arena-match-found', matchData(p2, p1));
}
// --- 6. SOCKET.IO ---
io.on('connection', async (socket) => {
    const uId = socket.request.session?.userId;
    if (!uId) return;
    const user = await User.findById(uId);
    if (!user) return;

    socket.userId = uId;
    socket.nickname = user.nickname;
    onlineUsers.set(user.nickname, socket.id);
    socket.join("general-chat");

    const broadcastOnlineList = () => {
        const usersArray = Array.from(onlineUsers.keys()).map(nick => ({ nickname: nick }));
        io.to("general-chat").emit('update-online-users', usersArray);
    };
    broadcastOnlineList();
    socket.emit('load-history', chatHistory);

    socket.on('chat-message', (data) => {
        if (!data.text) return;
        addToHistory(socket.nickname, data.text);
        io.to("general-chat").emit('new-message', { sender: socket.nickname, text: data.text });
    });

    socket.on('meeting-invite-request', (data) => {
        const targetSid = onlineUsers.get(data.to);
        if (targetSid) {
            io.to(targetSid).emit('meeting-invite-received', { from: socket.nickname, roomId: data.roomId });
        } else {
            socket.emit('error', 'Kullanıcı online değil.');
        }
    });

    socket.on('send-meeting-invite', (data) => {
        const targetSId = onlineUsers.get(data.target);
        if (targetSId) {
            socket.join(socket.nickname); 
            io.to(targetSId).emit('meeting-invite-received', { from: socket.nickname, room: socket.nickname, role: 'guest' });
            socket.emit('force-join-meeting', { room: socket.nickname, role: 'host' });
        } else {
            socket.emit('error', 'Kullanıcı online değil.');
        }
    });

    socket.on('join-meeting', (data) => {
        socket.join(data.roomId);
        socket.to(data.roomId).emit('user-connected', { peerId: data.peerId, nickname: data.nickname });
    });

    socket.on('meeting-message', (data) => {
        if (data.room && data.text) io.to(data.room).emit('new-meeting-message', { sender: socket.nickname, text: data.text });
    });

    socket.on('host-action', (data) => {
        if (socket.nickname === data.room) {
            const tId = onlineUsers.get(data.targetNick);
            if (tId && data.action === 'kick') io.to(tId).emit('command-kick');
        }
    });

// Savaş başlangıcında kontrol edilecek fonksiyon taslağı
function calculateWinChance(user) {
    let chanceModifier = 0;
    const twoHoursInMs = 2 * 60 * 60 * 1000;
    const now = new Date();

    // Eğer son savaştan üzerinden 2 saat geçmemişse
    if (user.lastBattleTime && (now - user.lastBattleTime < twoHoursInMs)) {
        // Ve 5 BPL ödeyerek "Doping" almamışsa
        if (!user.hasStaminaDoping) {
            chanceModifier = -35; // %35 kazanma şansı düşer (Yorgunluk cezası)
            console.log(`${user.nickname} yorgun savaşıyor!`);
        }
    }
    return chanceModifier;
}



    
   socket.on('arena-join-queue', async (data) => {
    try {
        const u = await User.findById(socket.userId);
        
        // Güvenlik Kontrolü: Kullanıcı yoksa veya bakiyesi yetersizse işlemi durdur
        if (!u || u.bpl < data.bet) {
            return socket.emit('error', 'Yetersiz bakiye!');
        }

        // 1. ADIM: Bahis miktarını hemen düş (Savaşa giriş ücreti)
        u.bpl -= data.bet; 
        await u.save();
        
        // Frontend'deki BPL miktarını güncelle
        socket.emit('update-bpl', u.bpl);

        // 2. ADIM: Oyuncu nesnesini oluştur (bet ve prize değerlerini ekledik)
        const player = { 
            nickname: u.nickname, 
            socketId: socket.id, 
            animal: u.selectedAnimal || 'Lion', 
            power: Math.random() * 100, 
            bet: data.bet,     // Yatırılan
            prize: data.prize  // Hedeflenen ödül
        };

        // 3. ADIM: Eşleşme Kontrolü
        if (arenaQueue.length > 0) {
            // Sırada bekleyen gerçek bir oyuncu varsa onunla savaştır
            const opponent = arenaQueue.shift();
            startBattle(player, opponent, io);
        } else {
            // Kimse yoksa sıraya ekle
            arenaQueue.push(player);

            // 5 Saniye sonra hala kimse gelmemişse BOT ile eşleştir
            setTimeout(async () => {
                const idx = arenaQueue.findIndex(p => p.socketId === socket.id);
                if (idx !== -1) {
                    const p = arenaQueue.splice(idx, 1)[0];
                    const bName = BOTS[Math.floor(Math.random() * BOTS.length)];
                    
                    const botPlayer = { 
                        nickname: bName + "_Bot", 
                        socketId: null, 
                        animal: bName, 
                        power: Math.random() * 100,
                        bet: p.bet,    // Botun "hayali" bahsi (denge için)
                        prize: p.prize 
                    };

                    startBattle(p, botPlayer, io);
                }
            }, 5000); // Bekleme süresi 5 saniye
        }
    } catch (err) {
        console.error("Arena Join Queue Hatası:", err);
        socket.emit('error', 'Sistemsel bir hata oluştu.');
    }
});
    socket.on('send-gift-bpl', async (data) => {
        try {
            const amount = parseInt(data.amount);
            const fromUser = await User.findById(socket.userId);
            const toUser = await User.findOne({ nickname: data.to });
            if (!toUser || fromUser.bpl - amount < 25) return socket.emit('error', 'İşlem başarısız.');
            fromUser.bpl -= amount; toUser.bpl += amount;
            await fromUser.save(); await toUser.save();
            socket.emit('update-bpl', fromUser.bpl);
            const tSid = onlineUsers.get(data.to);
            if (tSid) io.to(tSid).emit('update-bpl', toUser.bpl);
            io.to("general-chat").emit('new-message', { sender: "SİSTEM", text: `🎁 ${socket.nickname}, ${data.to}'ya ${amount} BPL gönderdi!` });
        } catch (e) {}
    });

    socket.on('disconnect', () => {
        onlineUsers.delete(socket.nickname);
        arenaQueue = arenaQueue.filter(p => p.socketId !== socket.id);
        broadcastOnlineList();
    });
});

const nodemailer = require('nodemailer'); // Mail için
const Withdraw = require('./models/Withdraw');
const Help = require('./models/Help');

// Nodemailer Yapılandırması (Render Env Değişkenlerini Kullanır)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_APP_PASS
    }
});

// --- BPL ÇEKİM TALEBİ ROTASI ---
app.post('/api/withdraw-request', async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        if (!user) return res.json({ success: false, error: 'Oturum kapalı.' });

        const withdrawAmount = user.bpl - 5000; // 5000 üstü çekilebilir
        if (withdrawAmount <= 0) {
            return res.json({ success: false, error: 'Çekim için 5.000 BPL üzeri bakiyeniz olmalı.' });
        }

        const commission = withdrawAmount * 0.25;
        const netAmount = withdrawAmount - commission;

        // Talebi Kaydet
        const newRequest = new Withdraw({
            userId: user._id,
            nickname: user.nickname,
            email: user.email,
            requestedAmount: withdrawAmount,
            commission: commission,
            finalAmount: netAmount,
            walletAddress: user.bnb_address || 'Belirtilmedi',
            status: 'Beklemede'
        });
        await newRequest.save();

        // Kullanıcının BPL'ini sıfırla (Sadece 5000 kalsın)
        user.bpl = 5000;
        await user.save();

        // --- OTOMATİK MAİL GÖNDERİMİ ---
        const mailOptions = {
            from: process.env.MAIL_USER,
            to: user.email,
            subject: 'BPL Çekim Talebi Alındı - Güvenlik Bildirimi',
            html: `
                <div style="background:#000; color:#fff; padding:20px; font-family:sans-serif; border:2px solid #39FF14;">
                    <h2 style="color:#39FF14;">Talep Onayı</h2>
                    <p>Sayın <b>${user.nickname}</b>,</p>
                    <p>Hesabınızdan <b>${withdrawAmount} BPL</b> tutarında çekim talebi oluşturulmuştur.</p>
                    <p><b>Net Ödeme:</b> ${netAmount} BPL (%25 Komisyon Kesilmiştir)</p>
                    <hr style="border-color:#333;">
                    <p style="color:#ff0000;"><b>ÖNEMLİ:</b> Bu işlem size ait değilse, lütfen 12 saat içinde "Terminal Destek" kısmından <b>Talep İptali</b> başlığı ile bize ulaşın.</p>
                    <p>İşlem 24-48 saat içinde manuel inceleme sonrası onaylanacaktır.</p>
                </div>
            `
        };
        
        transporter.sendMail(mailOptions);

        res.json({ success: true, msg: 'Talebiniz alındı, onay maili gönderildi.' });

    } catch (err) {
        console.error(err);
        res.json({ success: false, error: 'Sistem hatası.' });
    }
});

// --- YARDIM / DESTEK FORMU ROTASI ---
app.post('/api/help-request', async (req, res) => {
    try {
        // 1. Verileri al ve DB'ye kaydet
        const { email, subject, message } = req.body; 
        const Help = require('./models/Help');

        const newHelp = new Help({ email, subject, message }); 
        await newHelp.save();

        // 2. SANA (ADMIN) GİDECEK BİLDİRİM MAİLİ
        const adminMailOptions = {
            from: process.env.MAIL_USER, // Render Env: MAIL_USER
            to: process.env.MAIL_USER,
            subject: `DESTEK TALEBİ: ${subject}`,
            html: `
                <div style="background:#111; color:#fff; padding:20px; border:1px solid #39FF14; font-family:sans-serif;">
                    <h3 style="color:#39FF14;">Yeni Destek Mesajı</h3>
                    <p><b>E-posta:</b> ${email}</p>
                    <p><b>Konu:</b> ${subject}</p>
                    <hr style="border-color:#333;">
                    <p><b>Mesaj:</b></p>
                    <p style="background:#000; padding:10px;">${message}</p>
                </div>
            `
        };
        transporter.sendMail(adminMailOptions);

        // 3. KULLANICIYA GİDECEK OTOMATİK MAİL (Sadece Şifre İşlemleri İçin)
        if (subject === "Sifre Islemleri") {
            const userMailOptions = {
                from: process.env.MAIL_USER,
                to: email,
                subject: 'BPL CORE - Şifre Yenileme Talebi Alındı',
                html: `
                    <div style="background:#000; color:#fff; padding:20px; border:2px solid #00d4ff; font-family:monospace;">
                        <h2 style="color:#00d4ff;">PROTOKOL: ŞİFRE YENİLEME</h2>
                        <p>Sistemimize e-posta adresiniz üzerinden bir şifre yenileme talebi iletilmiştir.</p>
                        <p>Güvenlik nedeniyle işlemler manuel kontrol edilmektedir. Lütfen <b>24 saat</b> içerisinde size gönderilecek olan geçici şifreyi bekleyin.</p>
                        <hr style="border-color:#333;">
                        <p style="color:#888; font-size:12px;">Bu işlem size ait değilse, lütfen bu maili dikkate almayın.</p>
                    </div>
                `
            };
            transporter.sendMail(userMailOptions);
        }

        // 4. BAŞARILI YANITI (Sadece bir kez gönderilir)
        res.json({ success: true, msg: 'Talebiniz merkeze iletildi.' });

    } catch (err) {
        console.error("Yardım Rotası Hatası:", err);
        res.json({ success: false, error: 'İşlem sırasında bir hata oluştu.' });
    }
});


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 SİSTEM AKTİF: Port ${PORT}`));















