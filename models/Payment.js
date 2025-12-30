const mongoose = require('mongoose');

const PaymentSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    nickname: { type: String, required: true },
    txid: {
        type: String,
        unique: true,
        required: true,
        trim: true
    },
    amountUSD: { type: Number, required: true },
    amountBPL: { type: Number, required: true },
    network: { type: String, default: 'BEP20' },
    status: {
        type: String,
        enum: ['pending', 'completed', 'failed'],
        default: 'pending'
    },
    date: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Payment', PaymentSchema);
