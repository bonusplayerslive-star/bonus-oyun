
const mongoose = require('mongoose');

const WithdrawSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    nickname: String,
    email: String,
    requestedAmount: Number, // Çekmek istediği miktar
    commission: Number,      // %25 Kesinti
    finalAmount: Number,     // Ele geçecek net miktar
    walletAddress: String,   // Gönderilecek Metamask adresi
    status: { type: String, default: 'Beklemede' },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Withdraw', WithdrawSchema);
