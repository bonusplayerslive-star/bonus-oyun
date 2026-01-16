const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();

const app = express();

// Modelleri Bağla
const User = require('./models/User'); 
// app.js içinde 12. satır civarı
const authController = require('./views/authController'); // Yol ./views/ olmalı

// Veritabanı Bağlantısı
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("🚀 Veritabanı Bağlantısı Başarılı!"))
    .catch(err => console.error("❌ DB Hatası:", err));

// Ayarlar
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- YOLLAR (ROUTES) ---

// Sadece Ana Sayfa
app.get('/', (req, res) => {
    res.render('index'); 
});

// Kayıt ve Giriş İşlemleri (Mevcut controller'ını kullanır)
app.post('/register', authController.register);
app.post('/login', authController.login);

// Sunucuyu Başlat
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Sunucu ${PORT} portunda hazır.`);
});

