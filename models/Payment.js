const mongoose = require('mongoose');

const PaymentSchema = new mongoose.Schema({
    userId: mongoose.Schema.Types.ObjectId,
    nickname: String,
    txid: { type: String, unique: true, required: true },
    amountUSD: Number,
    amountBPL: Number,
    status: { type: String, default: 'pending' },
    date: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Payment', PaymentSchema);
