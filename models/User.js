// Path: models\User.js
const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    nickname: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    
    bpl: { type: Number, default: 2500 },
    
    // ENVARTER: Her hayvanın kendi seviyesi ve gücü (stamina) olacak
    inventory: [{
        name: String,
        level: { type: Number, default: 1 },
        stamina: { type: Number, default: 100 }, // Güç barı buraya eklendi
        stats: {
            hp: { type: Number, default: 100 },
            atk: { type: Number, default: 10 },
            def: { type: Number, default: 10 }
        }
    }],
    
    stats: { type: Object, default: {} }, 
    bnb_address: { type: String, default: '' },
    usdt_address: { type: String, default: '' },
    usedHashes: { type: [String], default: [] },
    isBanned: { type: Boolean, default: false },
    banUntil: { type: Date, default: null },
    reference: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
});

UserSchema.set('minimize', false);
module.exports = mongoose.model('User', UserSchema);