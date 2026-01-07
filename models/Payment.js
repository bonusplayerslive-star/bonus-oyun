const mongoose = require('mongoose'); // Bu satırı en üste EKLEYİN

const withdrawSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    txid: { type: String, unique: true },
    amountUSD: Number,
    status: { type: String, default: 'PENDING' },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Payment', withdrawSchema);
