
const mongoose = require('mongoose');

const victorySchema = new mongoose.Schema({
    email: { type: String, required: true },
    nickname: { type: String, required: true },
    bpl: { type: Number, required: true }, // Kazanılan ödül miktarı
    animalUsed: String, // Hangi hayvanla kazandı? (Analiz için ekledik)
    date: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Victory', victorySchema);
