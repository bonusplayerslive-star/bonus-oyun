require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const path = require('path');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');

// Uygulama Ayarları
const app = express();
const PORT = process.env.PORT || 3000;

// Veritabanı Bağlantısı
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('BPL Veritabanına Bağlanıldı'))
    .catch(err => console.error('DB Bağlantı Hatası:', err));

// View Engine Ayarı
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware (Ara Yazılımlar)
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(helmet({ contentSecurityPolicy: false })); // CDN bağlantıları için CSP kapalı
app.use(mongoSanitize());

// Oturum Yönetimi (Session)
app.use(session({
    secret: process.env.SESSION_SECRET || 'bpl_secret_key_2024',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 } // 24 Saat
}));

// --- AUTH MIDDLEWARE (Giriş Kontrolü) ---
const isAuth = (req, res, next) => {
    if (req.session.user) return next();
    res.redirect('/');
};

// --- ROUTES (Sayfalar) ---

// 1. İndex (Açılış / Login / Register)
app.get('/', (req, res) => {
    if (req.session.user) return res.redirect('/profil');
    res.render('index'); // index.ejs dosyanızda login/register formu olduğu varsayıldı
});

// 2. Profil (Ana Üs)
app.get('/profil', isAuth, (req, res) => {
    // req.session.user verisini DB'den güncel çekmek her zaman daha güvenlidir
    res.render('profil', { user: req.session.user });
});

// 3. Cüzdan (Wallet)
app.get('/wallet', isAuth, (req, res) => {
    res.render('wallet', { user: req.session.user });
});

// 4. Arena (Battle)
app.get('/arena', isAuth, (req, res) => {
    if (!req.session.user.selectedAnimal) {
        // Eğer karakter seçilmediyse profile yönlendir
        return res.redirect('/profil'); 
    }
    res.render('arena', { user: req.session.user });
});

// 5. Chat & Meeting
app.get('/chat', isAuth, (req, res) => {
    res.render('chat', { user: req.session.user });
});

app.get('/meeting', isAuth, (req, res) => {
    res.render('meeting', { user: req.session.user });
});

// 6. Market & Development
app.get('/market', isAuth, (req, res) => {
    res.render('market', { user: req.session.user });
});

app.get('/development', isAuth, (req, res) => {
    res.render('development', { user: req.session.user });
});

// --- API ROUTES (Örnek Giriş ve İşlemler) ---

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    // Burada DB kontrolü ve bcrypt.compare yapılacak
    // Başarılı ise:
    // req.session.user = user;
    // res.json({ success: true });
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});


// Tüm sayfalarda çalışan ortak script
const socket = io();
socket.emit('update-online-status', { 
    nickname: '<%= user.nickname %>', 
    avatar: '<%= user.profileImage %>' 
});





// Sunucuyu Başlat
app.listen(PORT, () => {
    console.log(`BPL Ana Sunucu aktif: http://localhost:${PORT}`);
});

