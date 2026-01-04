// Path: db.js
const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB Bağlantısı Başarılı!');
    } catch (err) {
        console.error('MongoDB Hatası:', err);
        process.exit(1);
    }
};

module.exports = connectDB;