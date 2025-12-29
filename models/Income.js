
const mongoose = require('mongoose');
const IncomeSchema = new mongoose.Schema({ userId: String, nickname: String, amount: Number, roomId: String, date: { type: Date, default: Date.now } });
module.exports = mongoose.model('Income', IncomeSchema);
