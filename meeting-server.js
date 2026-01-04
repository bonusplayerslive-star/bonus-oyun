// Path: meeting-server.js
const mongoose = require('mongoose');
const User = require('./models/User'); 
require('dotenv').config();

const io = require('socket.io')(3002, {
    cors: {
        origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
        methods: ["GET", "POST"],
        credentials: true
    }
});

const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://bonusplayerslive_db_user:1nB1QyAsh3qVafpE@bonus.x39zlzq.mongodb.net/?appName=Bonus";

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Meeting Sunucusu Bağlı'))
    .catch(err => console.error('❌ MongoDB Hatası:', err));

const meetingRooms = {}; 

io.on('connection', (socket) => {
    const nickname = socket.handshake.query.nickname || "Anonim Komutan";
    socket.nickname = nickname;

    // --- TOPLANTIYA KATILMA (PEER_ID DESTEKLİ) ---
    socket.on('join-meeting', async (roomId, peerId) => {
        if (!roomId) roomId = "GENEL_KONSEY";
        
        const roomAdapter = io.sockets.adapter.rooms.get(roomId);
        const currentSize = roomAdapter ? roomAdapter.size : 0;

        if (currentSize < 5) {
            socket.join(roomId);
            if (!meetingRooms[roomId]) meetingRooms[roomId] = [];
            
            const isOwner = meetingRooms[roomId].length === 0;

            // Kullanıcıyı peerId bilgisiyle odaya ekle
            const userData = { 
                id: socket.id, 
                peerId: peerId, // Görüntü için kritik
                nick: socket.nickname, 
                isOwner: isOwner,
                micOpen: true 
            };
            meetingRooms[roomId].push(userData);

            // Odadaki diğerlerine "yeni bir Peer geldi, onu ara" sinyali gönder
            // Sadece Socket ID değil, Peer ID ve Nickname gönderiyoruz
            socket.to(roomId).emit('user-connected', peerId, socket.nickname);

            io.to(roomId).emit('meeting-update', {
                msg: `🤝 ${socket.nickname} masaya oturdu.`,
                users: meetingRooms[roomId]
            });
        } else {
            socket.emit('meeting-error', "🛑 Masa dolu!");
        }

// --- meeting-server.js içinde join-meeting bloğunu bununla değiştir ---
socket.on('join-meeting', async (roomId, peerId) => { // peerId parametresini ekledik
    if (!roomId) roomId = "GENEL_KONSEY";
    socket.join(roomId);
    
    if (!meetingRooms[roomId]) meetingRooms[roomId] = [];
    
    // Kullanıcıyı peerId ile odaya kaydet
    const userObj = { 
        id: socket.id, 
        peerId: peerId, // Görüntü bağlantısı için bu şart
        nick: socket.nickname, 
        isOwner: meetingRooms[roomId].length === 0 
    };
    meetingRooms[roomId].push(userObj);

    // Odadaki diğer herkese "Yeni bir Peer geldi, onu ara" bilgisini gönder
    socket.to(roomId).emit('user-connected', peerId, socket.nickname);

    io.to(roomId).emit('meeting-update', {
        msg: `🤝 ${socket.nickname} masaya oturdu.`,
        users: meetingRooms[roomId]
    });
});





    });

    // --- CHAT MESAJLARI ---
    socket.on('chat-message', (data) => {
        if (data.room && data.text) {
            io.to(data.room).emit('new-message', { sender: socket.nickname, text: data.text });
        }
    });

    // --- VIP HEDİYELEŞME (Tıklanan kullanıcıya 50 BPL) ---
    socket.on('send-gift-vip', async (data) => {
        try {
            const { targetNick, amount, tax, room } = data;
            const sender = await User.findOne({ nickname: socket.nickname });
            const receiver = await User.findOne({ nickname: targetNick });

            if (sender && receiver && sender.bpl >= amount) {
                sender.bpl -= parseInt(amount);
                const netAmount = parseInt(amount) - parseInt(tax);
                receiver.bpl += netAmount;

                await sender.save();
                await receiver.save();

                io.to(room).emit('new-message', { 
                    sender: "HEDİYE", 
                    text: `🎁 ${sender.nickname} ➔ ${receiver.nickname}: ${amount} BPL gönderdi!` 
                });

                // Bakiyeleri güncelle
                io.to(room).emit('balance-refresh', { for: receiver.nickname, newBpl: receiver.bpl });
                socket.emit('gift-result', { status: 'success', message: 'Hediye gönderildi!', newBpl: sender.bpl });
            } else {
                socket.emit('gift-result', { status: 'error', message: 'Yetersiz bakiye!' });
            }
        } catch (e) { 
            console.error("Hediye Hatası:", e); 
        }
    });

    // --- ARENA DAVET SİNYALİ ---
    socket.on('invite-to-arena', (data) => {
        // Hedef kullanıcıya ve odaya daveti bildir
        io.to(data.room).emit('new-message', {
            sender: "SİSTEM",
            text: `⚔️ ${socket.nickname}, ${data.targetNick} komutanı Arena'ya düelloya çağırdı!`
        });
        // İlgili tarafları yönlendirmek için client-side'da window.location.href kullanılacak
    });

    // --- AYRILMA DURUMU ---
    socket.on('disconnecting', () => {
        socket.rooms.forEach(room => {
            if (meetingRooms[room]) {
                const disconnectedUser = meetingRooms[room].find(u => u.id === socket.id);
                if (disconnectedUser) {
                    // Diğerlerine bu peerId'nin çıktığını bildir
                    socket.to(room).emit('user-disconnected', disconnectedUser.peerId);
                    
                    meetingRooms[room] = meetingRooms[room].filter(u => u.id !== socket.id);
                    io.to(room).emit('meeting-update', {
                        msg: `👋 ${socket.nickname} masadan kalktı.`,
                        users: meetingRooms[room]
                    });
                }
            }
        });
    });

    socket.on('disconnect', () => {
        console.log(`🔌 ${socket.nickname} bağlantısı kesildi.`);
    });
});

console.log("------------------------------------");
console.log("🏢 BPL-MEETING: 3002 PORTU HAZIR");
console.log("🛡️ KONSEY MASASI DİKEY SIRALAMA AKTİF");
console.log("------------------------------------");