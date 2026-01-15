
const mongoose = require('mongoose');

const HelpSchema = new mongoose.Schema({
    email: { type: String, required: true },
    nickname: { type: String, required: false },
    subject: { type: String, required: true }, // "Talep İptali" veya "Genel Destek"
    message: { type: String, required: true },
    status: { type: String, default: 'Beklemede' }, // Beklemede, İncelendi, Tamamlandı
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Help', HelpSchema);
