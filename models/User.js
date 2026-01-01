const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    nickname: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true }, // Email eklendi
    password: { type: String, required: true },
    bpl: { type: Number, default: 2500 }, // Başlangıç bonusu 2500
    usdt_address: { type: String, default: '' },
    inventory: [{
        name: String,
        level: { type: Number, default: 1 },
        stats: {
            hp: { type: Number, default: 150 },
            atk: { type: Number, default: 30 },
            def: { type: Number, default: 10 }
        }
    }],
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);
