
const Victory = mongoose.model('Victory', new mongoose.Schema({
    email: String, nickname: String, bpl: Number, date: { type: Date, default: Date.now }
}));

const Punishment = mongoose.model('Punishment', new mongoose.Schema({
    email: String, bpl: Number, reason: String, date: { type: Date, default: Date.now }
}));
