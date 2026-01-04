// Path: models\Payment.js
// Çekim Talepleri Şeması
const withdrawSchema = new mongoose.Schema({
    userId: String,
    email: String,
    amount: Number, // Brüt
    netAmount: Number, // %30 kesilmiş hali
    usdtAddress: String,
    status: { type: String, default: 'pending' }, // pending, completed, rejected
    createdAt: { type: Date, default: Date.now }
});
const Withdraw = mongoose.model('Withdraw', withdrawSchema);

// Ödeme Bildirimleri Şeması
const paymentSchema = new mongoose.Schema({
    userId: String,
    txid: String,
    usd: Number,
    bpl: Number,
    status: { type: String, default: 'pending' },
    createdAt: { type: Date, default: Date.now }
});
const Payment = mongoose.model('Payment', paymentSchema);