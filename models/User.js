const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    nickname: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    bpl: { type: Number, default: 2500 },
    
    // Arena'da o an hangi hayvanla savaşıyor?
    selectedAnimal: { type: String, default: 'Tiger' },

    // Market sistemi için detaylandırılmış envanter
    inventory: [{
        name: String,      // Örn: 'Lion'
        img: String,       // Örn: '/caracter/profile/Lion.jpg'
        level: { type: Number, default: 1 },
        stats: {
            hp: { type: Number, default: 100 },
            atk: { type: Number, default: 20 },
            def: { type: Number, default: 10 }
        },
        purchasedAt: { type: Date, default: Date.now }
    }],

    // Cüzdan ve Güvenlik işlemleri
    bnb_address: { type: String, default: '' },
    usedHashes: { type: [String], default: [] } // Tekrar eden ödemeleri engellemek için
});

module.exports = mongoose.model('User', UserSchema);
