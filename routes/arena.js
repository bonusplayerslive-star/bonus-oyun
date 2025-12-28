
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Log = require('../models/Log');

// Arena Sayfası - Rakipleri Listele veya Rastgele Getir
router.get('/arena', async (req, res) => {
    try {
        // Oturumdaki kullanıcıyı al (Örn: req.session.user)
        const currentUser = await User.findById(req.session.userId); 
        
        // Rastgele 3 rakip bul (Kendisi hariç ve banlı olmayan)
        const opponents = await User.aggregate([
            { $match: { _id: { $ne: currentUser._id }, isBanned: false } },
            { $sample: { size: 3 } }
        ]);

        res.render('arena', { user: currentUser, opponents });
    } catch (err) {
        res.redirect('/profil');
    }
});

// Savaş Mekaniği
router.post('/attack', async (req, res) => {
    try {
        const { attackerId, defenderId, animalName } = req.body;

        const attacker = await User.findById(attackerId);
        const defender = await User.findById(defenderId);

        if (!attacker || !defender) return res.json({ status: 'error', msg: 'Oyuncu bulunamadı.' });

        // Statları Çek (Varsayılan değerlerle beraber)
        const aStats = attacker.stats.get(animalName) || { hp: 100, atk: 15, def: 10 };
        // Savunmacının ilk hayvanını alalım (Basitleştirme için)
        const dAnimal = defender.inventory[0] || "Bilinmeyen";
        const dStats = defender.stats.get(dAnimal) || { hp: 100, atk: 10, def: 5 };

        // --- SAVAŞ SİMÜLASYONU ---
        let battleLog = [];
        let aHP = aStats.hp;
        let dHP = dStats.hp;

        // Tur bazlı savaş (Basit mantık)
        const damageToDefender = Math.max(5, aStats.atk - dStats.def);
        const damageToAttacker = Math.max(5, dStats.atk - aStats.def);

        dHP -= damageToDefender;
        aHP -= damageToAttacker;

        let winner = dHP <= 0 ? attacker.nickname : (aHP <= 0 ? defender.nickname : "Berabere");
        let reward = 0;

        if (dHP <= 0) {
            reward = 100; // Galibiyet ödülü
            attacker.bpl += reward;
            await attacker.save();
        }

        // Kayıt
        const logMsg = `${attacker.nickname} (${animalName}), ${defender.nickname} (${dAnimal}) kişisine saldırdı. Sonuç: ${winner}`;
        await new Log({ type: 'ARENA', content: logMsg }).save();

        res.json({
            status: 'success',
            winner,
            reward,
            battleMsg: logMsg,
            newBalance: attacker.bpl
        });

    } catch (err) {
        res.status(500).json({ status: 'error', msg: 'Savaş yarıda kesildi.' });
    }
});

module.exports = router;
