const mongoose = require('mongoose');
const UserSchema = new mongoose.Schema({
    nickname: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    bpl: { type: Number, default: 1000 },
    usdt_address: { type: String },
    inventory: [{
        name: String,
        level: { type: Number, default: 1 },
        stats: {
            hp: { type: Number, default: 100 },
            atk: { type: Number, default: 20 },
            def: { type: Number, default: 10 }
        }
    }],
    date: { type: Date, default: Date.now }
});
module.exports = mongoose.model('User', UserSchema);
