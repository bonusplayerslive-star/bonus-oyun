const mongoose = require('mongoose');

const WithdrawalSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    walletAddress: {
        type: String,
        required: true
    },
    // Çekim yapılan ağ (BEP20 varsayılan)
    network: {
        type: String,
        default: 'BEP20'
    },
    // Onaylandığında buraya TXID girilecek
    transactionHash: {
        type: String,
        default: null
    },
    status: {
        type: String,
        enum: ['PENDING', 'APPROVED', 'REJECTED'],
        default: 'PENDING'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Withdrawal', WithdrawalSchema);
