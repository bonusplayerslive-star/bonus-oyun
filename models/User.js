const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    nickname: { type: String, required: true, unique: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    bpl: { type: Number, default: 2500 }, 
    
    // Default 'none' olması, kod taraflı kontrollerde (if user.selectedAnimal !== 'none') hayat kurtarır
    selectedAnimal: { type: String, default: 'none' },

    inventory: [{
        name: { type: String, required: true },
        img: String,       
        level: { type: Number, default: 1 },
        stamina: { type: Number, default: 100 }, 
        
        // Savaş ve Geliştirme için ana statlar
        hp: { type: Number, default: 100 },    
        maxHp: { type: Number, default: 100 }, 
        atk: { type: Number, default: 20 },    
        def: { type: Number, default: 10 },    
        
        // İstatistik takibi (Hayvan bazlı)
        wins: { type: Number, default: 0 },
        losses: { type: Number, default: 0 },
        
        purchasedAt: { type: Date, default: Date.now }
    }],

    // Genel oyuncu istatistikleri
    stats: {
        wins: { type: Number, default: 0 },
        losses: { type: Number, default: 0 }
    },

    bnb_address: { type: String, default: '' },
    usedHashes: { type: [String], default: [] },
    
    // Güvenlik için son giriş ve IP
    lastLogin: { type: Date, default: Date.now },
    resetPasswordToken: String,
    resetPasswordExpires: Date
}, { timestamps: true }); // createdAt ve updatedAt otomatik eklenir

module.exports = mongoose.model('User', UserSchema);
