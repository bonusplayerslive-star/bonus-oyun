/**
 * BPL ULTIMATE - FINAL STABLE VERSION
 */
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo'); 
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');

const User = require('./models/User');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// --- GLOBAL DEĞİŞKENLER ---
const onlineUsers = new Map();
let arenaQueue = [];

// --- 1. VERİTABANI VE SESSION ---
const MONGO_URI = process.env.MONGO_URI;
const SESSION_SECRET = process.env.SESSION_SECRET || 'bpl_ultimate_megasecret_2024';

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Veritabanı Bağlantısı Başarılı'))
    .catch(err => console.error('❌ MongoDB Hatası:', err));

const sessionMiddleware = session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: MONGO_URI }),
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
});

app.use(sessionMiddleware);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');

io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
});

// --- 2. SAVAŞ MANTIĞI (ARENA) ---
function calculateWinChance(user, target) {
    if (!user || !target) return 0;
    let modifier = 0;
    if ((user.atk || 0) > (target.def || 0)) modifier += 10;
    if ((user.hp || 0) > (target.hp || 0)) modifier += 5;
    return modifier;
}

async function startBattle(p1, p2, io) {
    try {
        const p1Mod = calculateWinChance(p1.dbData, p2.dbData);
        const p2Mod = calculateWinChance(p2.dbData, p1.dbData);
        let p1WinChance = 50 + p1Mod - p2Mod;

        const roll = Math.random() * 100;
        const winner = roll <= p1WinChance ? p1 : p2;
        const prizeAmount = 100;

        if (winner.socketId !== 'bot') {
            const winUser = await User.findById(winner.dbData._id);
            if (winUser) {
                winUser.bpl += prizeAmount;
                await winUser.save();
                io.to(winner.socketId).emit('update-bpl', winUser.bpl);
            }
        }

        const matchData = {
            winnerNick: winner.nickname,
            prize: prizeAmount,
            p1Nick: p1.nickname,
            p2Nick: p2.nickname
        };

        if (p1.socketId !== 'bot') io.to(p1.socketId).emit('arena-match-found', matchData);
        if (p2.socketId !== 'bot') io.to(p2.socketId).emit('arena-match-found', matchData);
        
        console.log(`⚔️ Savaş Bitti: ${p1.nickname} vs ${p2.nickname} | Kazanan: ${winner.nickname}`);
    } catch (err) { console.error("Arena Hatası:", err); }
}

// --- 3. SOKET SİSTEMİ (CHAT, ARENA, MEETING) ---
io.on('connection', async (socket) => {
    const uId = socket.request.session?.userId;
    if (!uId) return;
    const user = await User.findById(uId);
    if (!user) return;

    socket.userId = uId;
    socket.nickname = user.nickname;
    onlineUsers.set(user.nickname, socket.id);
    socket.join("general-chat");

    // Chat Mesajlaşma
    socket.on('send-global-message', (data) => {
        io.to("general-chat").emit('receive-global-message', {
            sender: socket.nickname,
            text: data.text,
            time: new Date().toLocaleTimeString()
        });
    });

    // Arena Sırasına Girme
    socket.on('arena-join-queue', () => {
        if (arenaQueue.find(p => p.socketId === socket.id)) return;
        arenaQueue.push({ nickname: socket.nickname, socketId: socket.id, dbData: user });

        if (arenaQueue.length >= 2) {
            startBattle(arenaQueue.shift(), arenaQueue.shift(), io);
        } else {
            setTimeout(() => {
                const idx = arenaQueue.findIndex(p => p.socketId === socket.id);
                if (idx !== -1) {
                    const p = arenaQueue.splice(idx, 1)[0];
                    const bot = { nickname: "BOT_Kurt", socketId: 'bot', dbData: { atk: 15, def: 10, hp: 100 } };
                    startBattle(p, bot, io);
                }
            }, 5000);
        }
    });

    // Meeting Giriş & Handshake
    socket.on('join-meeting', (data) => {
        const { roomId, peerId } = data;
        if (!roomId || !peerId) return;

        socket.join(roomId);
        socket.peerId = peerId;
        socket.currentRoom = roomId;

        socket.to(roomId).emit('user-connected', { peerId, nickname: socket.nickname });

        const clients = io.sockets.adapter.rooms.get(roomId);
        clients?.forEach(cId => {
            if (cId !== socket.id) {
                const other = io.sockets.sockets.get(cId);
                if (other?.peerId) {
                    socket.emit('user-connected', { peerId: other.peerId, nickname: other.nickname });
                }
            }
        });
    });

    socket.on('meeting-message', (data) => {
        io.to(data.roomId).emit('new-meeting-message', { sender: socket.nickname, text: data.text });
    });

    socket.on('disconnect', () => {
        onlineUsers.delete(socket.nickname);
        if (socket.currentRoom) socket.to(socket.currentRoom).emit('user-disconnected', socket.peerId);
        arenaQueue = arenaQueue.filter(p => p.socketId !== socket.id);
    });
});

// --- 4. ROTALAR ---
app.get('/profil', async (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    const user = await User.findById(req.session.userId);
    res.render('profil', { user });
});

app.get('/arena', (req, res) => res.render('arena'));
app.get('/chat', (req, res) => res.render('chat'));
app.get('/meeting', (req, res) => res.render('meeting', { role: req.query.role || 'guest' }));

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 SİSTEM 7/24 AKTİF: ${PORT}`));
