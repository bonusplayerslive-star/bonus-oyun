// Path: models/User.js
const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    // Temel Bilgiler
    nickname: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },

    // Ekonomi Sistemi
    bpl: { type: Number, default: 2500 }, // Yeni kayıtlara 2500 hediye
    inventory: { type: [String], default: [] }, // Sahip olunan hayvanlar

    // Gelişim ve Savaş İstatistikleri
    // Örnek yapı: { "Aslan": { hp: 120, atk: 15, def: 10 }, "Kaplan": { ... } }
    stats: { type: Object, default: {} },

    // Cüzdan Bilgileri
    bnb_address: { type: String, default: '' }, // Çekim yapılacak adres
    usdt_address: { type: String, default: '' }, // Yatırım yapılan adres

    // Ödeme ve Güvenlik
    usedHashes: { type: [String], default: [] } // Daha önce onaylanmış TX Hash kodları
}, { timestamps: true }); // Kayıt tarihlerini otomatik ekler

module.exports = mongoose.model('User', UserSchema);
