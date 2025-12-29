require('dotenv').config();

const express = require('express');

const bodyParser = require('body-parser');

const http = require('http');

const socketIo = require('socket.io');

const session = require('express-session');

const connectDB = require('./db');

const User = require('./models/User');

const Log = require('./models/Log');



connectDB();

const app = express();

const server = http.createServer(app);

const io = socketIo(server);



app.use(bodyParser.json());

app.use(bodyParser.urlencoded({ extended: true }));

app.use(express.static('public'));

app.use(session({ secret: 'bpl_ozel_anahtar', resave: false, saveUninitialized: false }));

app.set('view engine', 'ejs');



const checkAuth = (req, res, next) => { if (req.session.userId) next(); else res.redirect('/'); };



// ROTALAR

app.get('/', (req, res) => { res.render('index', { userIp: req.ip }); });

app.get('/profil', checkAuth, async (req, res) => { const user = await User.findById(req.session.userId); res.render('profil', { user }); });

app.get('/arena', checkAuth, async (req, res) => { const user = await User.findById(req.session.userId); res.render('arena', { user, selectedAnimal: req.query.animal }); });

app.get('/chat', checkAuth, async (req, res) => { const user = await User.findById(req.session.userId); res.render('chat', { user }); });

app.get('/meeting', checkAuth, async (req, res) => { const user = await User.findById(req.session.userId); res.render('meeting', { user, roomId: req.query.roomId || 'GlobalMasa' }); });



// LOGIN - REGISTER

app.post('/login', async (req, res) => {

    const { email, password } = req.body;

    const user = await User.findOne({ email, password });

    if (user) { req.session.userId = user._id; res.redirect('/profil'); } 

    else { res.send('<script>alert("Hatalı Giriş!"); window.location.href="/";</script>'); }

});



app.post('/register', async (req, res) => {

    try {

        const newUser = new User({ ...req.body, bpl: 2500 });

        await newUser.save();

        res.send('<script>alert("2500 BPL Hediye ile Kayıt Başarılı!"); window.location.href="/";</script>');

    } catch (e) { res.send("Kayıt Hatası: Email veya Nickname kullanımda."); }

});



// BOT SAVAŞI (%55 ŞANS)

app.post('/attack-bot', checkAuth, async (req, res) => {

    const user = await User.findById(req.session.userId);

    const win = Math.random() < 0.55;

    let reward = win ? 150 : 0;

    if(win) { user.bpl += reward; await user.save(); }

    res.json({ status: 'success', winner: win ? user.nickname : 'Elite_Bot', reward, newBalance: user.bpl });

});



// SOCKET SİSTEMİ

let arenaPlayers = [];

io.on('connection', (socket) => {

    socket.on('join-arena', (data) => {

        socket.userData = data;

        if(!arenaPlayers.find(p => p.id === data.id)) arenaPlayers.push(data);

        io.emit('arena-list-update', arenaPlayers);

    });



    socket.on('chat-message', (data) => { io.emit('new-message', data); });

    

    socket.on('send-private-invite', (data) => { io.emit('invite-alert', data); });



    socket.on('disconnect', () => {

        arenaPlayers = arenaPlayers.filter(p => p.id !== (socket.userData?.id));

        io.emit('arena-list-update', arenaPlayers);

    });

});



server.listen(10000, "0.0.0.0", () => console.log("BPL AKTİF"));



