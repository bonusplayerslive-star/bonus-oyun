const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    nickname: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    bpl: { type: Number, default: 2500 },
    selectedAnimal: { type: String, default: 'Tiger' },
    
    // Her hayvanın kendi gelişimi
    stats: {
        hp: { type: Number, default: 100 },
        atk: { type: Number, default: 10 },
        def: { type: Number, default: 10 },
        level: { type: Number, default: 1 }
    },

    // Marketten alınan eşyalar
    inventory: [{
        itemName: String,
        itemType: String, // 'powerup', 'skin', 'boost'
        purchasedAt: { type: Date, default: Date.now }
    }],

    // Cüzdan ve Güvenlik
    bnb_address: { type: String, default: '' },
    usdt_address: { type: String, default: '' },
    usedHashes: { type: [String], default: [] },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);
