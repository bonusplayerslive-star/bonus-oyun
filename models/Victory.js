
const mongoose = require('mongoose');
const VictorySchema = new mongoose.Schema({ email: String, nickname: String, bpl: Number, date: { type: Date, default: Date.now } });
module.exports = mongoose.model('Victory', VictorySchema);
