
const mongoose = require('mongoose');

const IncomeSchema = new mongoose.Schema({
    // UserId'yi doğrudan User modeline bağlıyoruz (Populate yapabilmek için)
    userId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true 
    },
    nickname: { type: String, required: true },
    amount: { type: Number, required: true },
    
    // Gelirin kaynağı (Örn: "Arena Win", "Meeting Fee", "Daily Bonus")
    source: { type: String, default: 'Arena Win' }, 
    
    roomId: { type: String }, // Eğer bir savaştan veya masadan geliyorsa
    date: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Income', IncomeSchema);
