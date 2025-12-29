
const mongoose = require('mongoose');

const arenaLogSchema = new mongoose.Schema({
    challenger: { type: String, required: true }, // Meydan okuyan
    opponent: { type: String, required: true },   // Rakip
    winner: String,
    rounds: [{
        roundNumber: Number,
        attacker: String,
        damage: Number,
        remainingHP: Number
    }],
    totalPrize: Number,
    date: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ArenaLog', arenaLogSchema);
