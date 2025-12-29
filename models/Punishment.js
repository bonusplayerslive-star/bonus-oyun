
const mongoose = require('mongoose');

const punishmentSchema = new mongoose.Schema({
    email: { type: String, required: true },
    bpl: { type: Number, required: true }, // Kaybedilen miktar
    reason: { type: String, default: 'Arena Defeat' }, // Ceza sebebi
    date: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Punishment', punishmentSchema);
