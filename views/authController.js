const User = require('../models/User');
const bcrypt = require('bcryptjs');

// KAYIT İŞLEMİ (POST /register)
exports.register = async (req, res) => {
    try {
        const { nickname, email, password } = req.body;
        
        // Kullanıcı var mı kontrolü
        const existingUser = await User.findOne({ $or: [{ email }, { nickname }] });
        if (existingUser) return res.send('<script>alert("Email veya Nickname zaten kullanımda!"); window.location="/";</script>');

        // Şifre şifreleme
        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = new User({
            nickname,
            email,
            password: hashedPassword,
            bpl: 2500, // Başlangıç bonusu
            inventory: [{ // İlk hayvan: Tiger (Varsayılan)
                name: 'Tiger',
                img: '/caracter/profile/Tiger.jpg',
                stats: { hp: 100, atk: 20, def: 10 }
            }]
        });

        await newUser.save();
        res.send('<script>alert("Kayıt başarılı! Şimdi giriş yapabilirsiniz."); window.location="/";</script>');
    } catch (err) {
        res.status(500).send("Kayıt hatası: " + err.message);
    }
};

// GİRİŞ İŞLEMİ (POST /login)
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.send('<script>alert("Hatalı giriş bilgileri!"); window.location="/";</script>');
        }

        // Session kaydı
        req.session.userId = user._id;
        req.session.nickname = user.nickname;
        
        res.redirect('/profil');
    } catch (err) {
        res.status(500).send("Giriş hatası");
    }
};
