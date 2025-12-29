
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Log = require('../models/Log');
const Payment = require('../models/Payment');

// --- GELİŞTİRME MERKEZİ (STAT UPGRADE) ---
router.post('/upgrade-stat', async (req, res) => {
    try {
        const { userId, animalName, statType, cost } = req.body;
        const user = await User.findById(userId);

        if (!user) return res.json({ status: 'error', msg: 'Kullanıcı bulunamadı.' });
        if (user.bpl < cost) return res.json({ status: 'error', msg: 'Yetersiz BPL bakiyesi.' });

        // Karakterin mevcut statlarını al veya varsayılan oluştur
        let animalStats = user.stats.get(animalName) || { hp: 100, atk: 15, def: 10 };

        // Geliştirme Mantığı
        if (statType === 'hp') animalStats.hp += 10;
        else if (statType === 'atk') animalStats.atk += 5;
        else if (statType === 'def') animalStats.def += 5;
        else if (statType === 'battleMode') animalStats.atk += 20; // Geçici mod mantığı

        // Güncelleme ve Kaydetme
        user.bpl -= cost;
        user.stats.set(animalName, animalStats);
        await user.save();

        // Log Kaydı
        await new Log({
            type: 'DEVELOPMENT',
            content: `${user.nickname}, ${animalName} için ${statType} yükseltmesi yaptı. Harcanan: ${cost} BPL`
        }).save();

        res.json({ status: 'success', newBalance: user.bpl });

    } catch (err) {
        res.status(500).json({ status: 'error', msg: 'Sunucu hatası.' });
    }
});

// --- PARA ÇEKME (WITHDRAWAL) SİSTEMİ ---
router.post('/withdraw-bpl', async (req, res) => {
    try {
        const { userId, amount } = req.body; // amount: çekilmek istenen ham miktar
        const user = await User.findById(userId);

        // Kural 1: Minimum 9750 BPL bakiye şartı
        if (user.bpl < 9750) {
            return res.json({ 
                status: 'error', 
                msg: 'Çekim talebi için hesabınızda minimum 9750 BPL olmalıdır.' 
            });
        }

        const requestedAmount = parseInt(amount);
        const fee = requestedAmount * 0.30; // %30 Kesinti
        const netAmount = requestedAmount - fee; // Kullanıcıya gidecek olan

        // Bakiyeden düşülecek toplam (çekilen miktar)
        if (user.bpl < requestedAmount) {
            return res.json({ status: 'error', msg: 'Yetersiz bakiye.' });
        }

        // 1. Kullanıcı Bakiyesini Güncelle
        user.bpl -= requestedAmount;
        await user.save();

        // 2. Payment Kaydı Oluştur
        const newPayment = new Payment({
            email: user.email,
            requestedBpl: requestedAmount,
            fee: fee,
            netAmount: netAmount
        });
        await newPayment.save();

        // 3. Log Kaydı
        await new Log({
            type: 'WALLET',
            content: `${user.email} adresi ${requestedAmount} BPL çekim talebi oluşturdu. Net: ${netAmount} BPL`
        }).save();

        res.json({ 
            status: 'success', 
            msg: 'Çekim talebiniz alındı. %30 kesinti uygulandı.',
            newBalance: user.bpl 
        });

    } catch (err) {
        res.status(500).json({ status: 'error', msg: 'Çekim işlemi başarısız.' });
    }
});

module.exports = router;
