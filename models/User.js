const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    nickname: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    bpl: { type: Number, default: 2500 }, // Başlangıç bakiyesi
    
    selectedAnimal: { type: String, default: '' },

    inventory: [{
        name: String,      // Örn: 'Tiger'
        img: String,       
        level: { type: Number, default: 1 },
        stamina: { type: Number, default: 100 }, // Savaş gücü/enerjisi
        
        // Geliştirme sayfasıyla doğrudan uyumlu stat yapısı
        hp: { type: Number, default: 100 },    // Mevcut Can
        maxHp: { type: Number, default: 100 }, // Geliştirilebilir Maksimum Can
        atk: { type: Number, default: 20 },    // Kalıcı Saldırı Gücü
        def: { type: Number, default: 10 },    // Kalıcı Savunma Gücü
        
        purchasedAt: { type: Date, default: Date.now }
    }],

    bnb_address: { type: String, default: '' },
    usedHashes: { type: [String], default: [] },
    resetPasswordToken: String,
    resetPasswordExpires: Date
});

module.exports = mongoose.model('User', UserSchema);
