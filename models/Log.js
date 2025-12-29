const mongoose = require('mongoose');

const logSchema = new mongoose.Schema({
    // İşlem Türü: 'MARKET', 'WALLET', 'CONTACT', 'FORGOT_PASSWORD', 'ARENA'
    type: { type: String, required: true }, 
    
    // Detay: "Kullanıcı marketten Tiger aldı" veya "İletişim Mesajı: Merhaba BPL ekibi..."
    content: { type: String, required: true }, 
    
    // İşlemi yapan veya mesaj atan kişi
    userEmail: { type: String }, 
    
    // Durum: 'PENDING' (Beklemede), 'RESOLVED' (Çözüldü) - Destek mesajları için
    status: { type: String, default: 'INFO' }, 
    
    date: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Log', logSchema);
