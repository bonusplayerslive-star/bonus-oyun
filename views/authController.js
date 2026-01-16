const User = require('../models/User'); // Model yolun doğru
const bcrypt = require('bcryptjs');

// KAYIT İŞLEMİ
exports.register = async (req, res) => {
    try {
        const { nickname, email, password } = req.body;

        // 1. Kullanıcı kontrolü
        const existingUser = await User.findOne({ $or: [{ email }, { nickname }] });
        if (existingUser) {
            return res.send('<script>alert("Email veya Nickname kullanımda!"); window.location="/";</script>');
        }

        // 2. ÖNCE Şifreyi şifrele (Hata buradaydı)
        const hashedPassword = await bcrypt.hash(password, 10);

        // 3. TEK BİR newUser oluştur (Çift tanımlama temizlendi)
        const newUser = new User({
            nickname,
            email,
            password: hashedPassword,
            bpl: 2500,
            selectedAnimal: 'Tiger',
            inventory: [{ 
                name: 'Tiger',
                img: '/caracter/profile/Tiger.jpg',
                level: 1,
                hp: 100, 
                maxHp: 100, 
                stamina: 100,
                atk: 25, 
                def: 15 
            }]
        });

        await newUser.save();
        res.send('<script>alert("Kayıt başarılı! Giriş yapabilirsiniz."); window.location="/";</script>');
    } catch (err) {
        res.status(500).send("Kayıt hatası: " + err.message);
    }
};

// GİRİŞ İŞLEMİ
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.send('<script>alert("Hatalı bilgiler!"); window.location="/";</script>');
        }

        req.session.userId = user._id;
        req.session.nickname = user.nickname;
        res.redirect('/profil');
    } catch (err) {
        res.status(500).send("Giriş hatası");
    }
};

exports.logout = (req, res) => {
    req.session.destroy();
    res.redirect('/');
};
