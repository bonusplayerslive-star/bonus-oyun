const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    nickname: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    bpl: { type: Number, default: 2500 }, 
    inventory: { type: [String], default: [] },
    stats: { type: Object, default: {} },
    bnb_address: { type: String, default: '' },
    usdt_address: { type: String, default: '' },
    usedHashes: { type: [String], default: [] }
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);
