
const mongoose = require('mongoose');
const PunishmentSchema = new mongoose.Schema({ email: String, bpl: Number, reason: String, date: { type: Date, default: Date.now } });
module.exports = mongoose.model('Punishment', PunishmentSchema);
