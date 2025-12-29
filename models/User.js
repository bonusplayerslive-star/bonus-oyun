const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    nickname: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    bpl: { type: Number, default: 2500 }, // Başlangıç bonusu
    
    // Envanter artık sadece isim değil, bir obje dizisidir
    inventory: [{
        name: String,        // Örn: "Tiger"
        level: { type: Number, default: 1 },
        img: String,         // Örn: "/caracter/profile/tiger.jpg"
        stats: {
            hp: { type: Number, default: 100 },
            atk: { type: Number, default: 10 }
        },
        purchaseDate: { type: Date, default: Date.now }
    }],

    // Genel oyuncu istatistikleri (Kazanma/Kaybetme vb.)
    stats: { 
        wins: { type: Number, default: 0 },
        losses: { type: Number, default: 0 },
        totalBattles: { type: Number, default: 0 }
    },

    bnb_address: { type: String, default: '' },
    usdt_address: { type: String, default: '' },
    usedHashes: { type: [String], default: [] } // Ödeme kontrolü için
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);
