// Path: models\User.js
const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    // Temel Bilgiler
    nickname: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    
    // Ekonomi Sistemi
    bpl: { type: Number, default: 2500 }, // Yeni kayıtlara 2500 hediye
    inventory: { type: [String], default: [] }, // Sahip olunan hayvanlar


user.markModified('stats'); // Mongoose'a "stats değişti, bunu kaydet" mesajı verir.
await user.save();
    
    // Gelişim ve Savaş İstatistikleri
    // Örnek yapı: { "Aslan": { hp: 120, atk: 15, def: 10 }, "Kaplan": { ... } }
    stats: { type: Object, default: {} }, 
    
    // Cüzdan Bilgileri
    bnb_address: { type: String, default: '' }, // Çekim yapılacak adres
    usdt_address: { type: String, default: '' }, // Yatırım yapılan (BscScan kontrolü için) adres
    
    // Ödeme ve Güvenlik
    usedHashes: { type: [String], default: [] }, // Daha önce onaylanmış TX Hash kodları
    
    // Ceza ve Ban Sistemi
    isBanned: { type: Boolean, default: false }, // Kullanıcı yasaklı mı?
    banUntil: { type: Date, default: null }, // Yasak bitiş tarihi
    
    // Ekstra Bilgiler
    reference: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
});

// Veri tabanında "stats" gibi objeler üzerinde güncelleme yaparken 
// değişikliğin algılanması için gerekli ayar (opsiyonel ama önerilir)
UserSchema.set('minimize', false);
// models/User.js (Güncellenecek Kısım)
stats: { 
    type: Map, 
    of: new mongoose.Schema({
        hp: { type: Number, default: 100 },
        atk: { type: Number, default: 15 },
        def: { type: Number, default: 10 }
    }, { _id: false }),
    default: {} 
},

module.exports = mongoose.model('User', UserSchema);

