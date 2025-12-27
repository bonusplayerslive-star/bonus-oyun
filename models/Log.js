const mongoose = require('mongoose');

const logSchema = new mongoose.Schema({
    type: { type: String, required: true }, // MARKET, WALLET, ARENA, GIFT vb.
    content: { type: String, required: true }, // İşlem detayı
    date: { type: Date, default: Date.now } // İşlem zamanı
});

module.exports = mongoose.model('Log', logSchema);
