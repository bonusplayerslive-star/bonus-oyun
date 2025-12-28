// Path: models/Payment.js
const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
    email: { type: String, required: true },
    requestedBpl: { type: Number, required: true }, // Kullanıcının çekmek istediği miktar
    fee: { type: Number, required: true },          // %30 Kesinti miktarı
    netAmount: { type: Number, required: true },    // Kesintiden sonra yatan miktar
    status: { type: String, default: 'Beklemede' }, // Beklemede, Onaylandı, Reddedildi
    date: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Payment', paymentSchema);
