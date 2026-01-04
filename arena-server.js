// Path: arena-server.js
const mongoose = require('mongoose');
const User = require('./models/User'); 
require('dotenv').config();

// --- 1. SOCKET.IO KURULUMU ---
const io = require('socket.io')(3001, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

// --- 2. VERİTABANI BAĞLANTISI ---
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://bonusplayerslive_db_user:1nB1QyAsh3qVafpE@bonus.x39zlzq.mongodb.net/?appName=Bonus";

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Arena Sunucusu MongoDB Bağlantısı Başarılı'))
    .catch(err => console.error('❌ Arena MongoDB Hatası:', err));

// --- 3. SABİT VERİLER (BOTLAR VE HAYVANLAR) ---
const botNames = ["Alpha_Strike", "CyberShadow", "NightMare_01", "Gorgon_SIM", "Ronin_X", "Steel_Fang", "Nova_Commander", "Ghost_Unit", "Slayer_X"];
const animals = ["Lion", "Tiger", "Bear", "Wolf", "Eagle"];

// --- 4. EŞLEŞME HAVUZU ---
let waitingPlayers = []; // Gerçek oyuncuların beklediği havuz

io.on('connection', (socket) => {
    console.log('📡 Yeni Savaşçı Bağlandı:', socket.id);

    // --- PVP EŞLEŞME ARAMA ---
    socket.on('find-match', (data) => {
        // Eğer havuzda bekleyen biri varsa eşleştir
        if (waitingPlayers.length > 0) {
            const opponent = waitingPlayers.shift(); // Havuzun başındaki oyuncuyu al
            const roomId = `match_${opponent.id}_${socket.id}`;

            socket.join(roomId);
            opponent.join(roomId);

            // Her iki tarafa da "Rakip Bulundu" bilgisini gönder
            io.to(roomId).emit('pvp-found', {
                roomId: roomId,
                players: [
                    { id: socket.id, nick: data.myNick, animal: data.myAnimal },
                    { id: opponent.id, nick: opponent.nickname, animal: opponent.animal }
                ]
            });
            console.log(`⚔️ PVP EŞLEŞTİ: ${data.myNick} VS ${opponent.nickname}`);
        } else {
            // Kimse yoksa havuza ekle ve beklet
            socket.nickname = data.myNick;
            socket.animal = data.myAnimal;
            waitingPlayers.push(socket);
            console.log(`⏳ ${data.myNick} lobiye girdi, rakip bekleniyor...`);
        }
    });
// arena-server.js içine eklenecek
socket.on('join-private-match', (data) => {
    socket.join(data.roomId);
    
    // Odada 2 kişi olduğunda savaşı başlat
    const roomSize = io.sockets.adapter.rooms.get(data.roomId).size;
    if (roomSize === 2) {
        io.to(data.roomId).emit('pvp-found', {
            roomId: data.roomId,
            // Oyuncu bilgilerini odaya bağlı socketlerden çekebilirsin
        });
    }
});
    // --- BOT SAVAŞI BAŞLATMA (13 saniye sonunda tetiklenir) ---
    socket.on('start-bot-battle', async (data) => {
        // Bot savaşına geçtiği için bekleme havuzundan çıkart
        waitingPlayers = waitingPlayers.filter(p => p.id !== socket.id);

        const { multiplier, userId } = data;
        
        try {
            const user = await User.findById(userId);
            if (!user) return socket.emit('error-msg', 'Kullanıcı bulunamadı.');

            // --- BPL HESAPLAMA ---
            let cost = 25; 
            let prize = 40;

            if (multiplier === 2) { cost = 55; prize = 80; }
            else if (multiplier === 4) { cost = 75; prize = 100; }
            else if (multiplier === 6) { cost = 85; prize = 150; }

            // --- BAKİYE KONTROLÜ ---
            if (user.bpl < cost) {
                return socket.emit('error-msg', 'Yetersiz BPL! Gereken: ' + cost);
            }

            // --- KAZANMA İHTİMALİ ---
            const isWin = Math.random() > 0.6; 
            
            // --- VERİTABANI İŞLEMLERİ ---
            user.bpl -= cost; 
            if (isWin) {
                user.bpl += prize;
                if(user.stats) user.stats.wins += 1;
            } else {
                if(user.stats) user.stats.losses += 1;
            }
            
            await user.save();

            // Rastgele bot oluştur
            const randomBot = botNames[Math.floor(Math.random() * botNames.length)];
            const randomBotAnimal = animals[Math.floor(Math.random() * animals.length)];

            // Sonucu gönder
            socket.emit('battle-result', {
                isWin,
                opponentName: randomBot,
                opponentAnimal: randomBotAnimal,
                prize: isWin ? prize : 0,
                newBalance: user.bpl,
                type: 'BOT'
            });

            console.log(`🤖 BOT SAVAŞI: ${user.nickname} VS ${randomBot} | Sonuç: ${isWin ? 'ZAFER' : 'BOZGUN'}`);

        } catch (err) {
            console.error('❌ Arena Sunucu Hatası:', err);
            socket.emit('error-msg', 'Sistem hatası oluştu.');
        }
    });

    // --- BAĞLANTI KOPMASI ---
    socket.on('disconnect', () => {
        // Oyuncu koptuğunda bekleme listesinden temizle
        waitingPlayers = waitingPlayers.filter(p => p.id !== socket.id);
        console.log('🔌 Savaşçı ayrıldı.');
    });
});

console.log("------------------------------------");
console.log("🚀 BPL ARENA SERVER: 3001 AKTİF");
console.log("⚔️ MOD: PVP (ÖNCELİKLİ) + BOT (YEDEK)");
console.log("------------------------------------");