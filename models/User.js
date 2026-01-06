const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    nickname: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    bpl: { type: Number, default: 2500 },
    selectedAnimal: { type: String, default: 'Tiger' },
    
    // Geliştirme Merkezi için gerekli alanlar
    stats: {
        hp: { type: Number, default: 100 },
        atk: { type: Number, default: 10 },
        def: { type: Number, default: 10 }
    },

    // Market sistemi için envanter
    inventory: [{
        name: String,
        purchasedAt: { type: Date, default: Date.now }
    }],

    // Cüzdan için kripto adresleri
    bnb_address: { type: String, default: '' },
    usedHashes: { type: [String], default: [] }
});

module.exports = mongoose.model('User', UserSchema);
