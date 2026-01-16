/**
 * BPL ULTIMATE - RECOVERY VERSION (STABLE)
 */
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo'); 
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');
const axios = require('axios');

const User = require('./models/User');
const Withdraw = require('./models/Withdraw'); // Model eksikse hata vermemesi için buraya dikkat

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// --- GLOBAL DEĞİŞKENLER ---
const onlineUsers = new Map();
let arenaQueue = [];

// --- 1. VERİTABANI VE SESSION ---
const MONGO_URI = process.env.MONGO_URI;
const SESSION_SECRET = process.env.SESSION_SECRET || 'bpl_ultimate_megasecret_2024';

mongoose.connect(MONGO_URI).then(() => console.log('✅ Veritabanı Bağlandı'));

const sessionMiddleware = session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: MONGO_URI }),
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
});
app.use(sessionMiddleware);
io.use((socket, next) => { sessionMiddleware(socket.request, {}, next); });

app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- 2. SAVAŞ MANTIĞI (ARENA REPAIRED) ---
function calculateWinChance(user, target) {
    if (!user || !target) return 0;
    let modifier = 0;
    if (user.atk > target.def) modifier += 10;
    if (user.hp > target.hp) modifier += 5;
    return modifier;
}

async function startBattle(p1, p2, io) {
    try {
        const p1Mod = calculateWinChance(p1.dbData, p2.dbData);
        const p2Mod = calculateWinChance(p2.dbData, p1.dbData);
        let p1WinChance = 50 + p1Mod - p2Mod;

        const roll = Math.random() * 100;
        const winner = roll <= p1WinChance ? p1 : p2;
        const prizeAmount = 100; // Ödül sabitlendi (NaN hatası çözüldü)

        // Veritabanı Güncelleme (Sadece Gerçek Oyuncu Kazanırsa)
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
        
        console.log(`⚔️ Savaş Bitti: Kazanan ${winner.nickname}`);
    } catch (err) { console.error("Savaş hatası:", err); }
}

// --- 3. SOKET SİSTEMİ (STABLE HANDSHAKE) ---
io.on('connection', async (socket) => {
    const uId = socket.request.session?.userId;
    if (!uId) return;
    const user = await User.findById(uId);
    if (!user) return;

    socket.nickname = user.nickname;
    onlineUsers.set(user.nickname, socket.id);
    socket.join("general-chat");

    // ARENA KUYRUK
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
                    const bot = { nickname: "BOT_Kurt", socketId: 'bot', dbData: { atk: 10, def: 10, hp: 100 } };
                    startBattle(p, bot, io);
                }
            }, 5000);
        }
    });

    // MEETING GİRİŞ (PEER FIX)
    socket.on('join-meeting', (data) => {
        const { roomId, peerId } = data;
        socket.join(roomId);
        socket.peerId = peerId;
        socket.currentRoom = roomId;

        // Diğerlerine haber ver
        socket.to(roomId).emit('user-connected', { peerId, nickname: socket.nickname });

        // Kendine içerdekileri tanıt
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

    // DAVET SİSTEMİ
    socket.on('send-bpl-invite', (data) => {
        const tSid = onlineUsers.get(data.target);
        if (tSid) io.to(tSid).emit('receive-bpl-invite', { from: socket.nickname, type: data.type });
    });

    socket.on('accept-bpl-invite', (data) => {
        const hostSid = onlineUsers.get(data.from);
        if (hostSid) {
            const rid = `room_${Date.now()}`;
            io.to(hostSid).emit('redirect-to-room', { roomId: rid, role: 'host' });
            socket.emit('redirect-to-room', { roomId: rid, role: 'guest' });
        }
    });

    socket.on('disconnect', () =>
