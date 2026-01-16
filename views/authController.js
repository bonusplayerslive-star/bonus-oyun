const User = require('../models/User');
const bcrypt = require('bcryptjs');

// KAYIT İŞLEMİ (POST /register)
exports.register = async (req, res) => {
    try {
        const { nickname, email, password } = req.body;
        
        // 1. Kullanıcı var mı kontrolü
        const existingUser = await User.findOne({ $or: [{ email }, { nickname }] });
        if (existingUser) {
            return res.send('<script>alert("Email veya Nickname zaten kullanımda!"); window.location="/";</script>');
        }

        // 2. Şifre şifreleme
        const hashedPassword = await bcrypt.hash(password, 10);

        // 3. Yeni Kullanıcı Oluşturma (EJS dosyalarınla %100 uyumlu statlar)
        const newUser = new User({
            nickname,
            email,
            password: hashedPassword,
            bpl: 2500, // Başlangıç parası
            selectedAnimal: 'Tiger', // Varsayılan seçili hayvan
            inventory: [{ 
                name: 'Tiger',
                level: 1,
                hp: 100, 
                maxHp: 100, 
                stamina: 100,
                atk: 20, 
                def: 10 
            }]
        });

        await newUser.save();
        res.send('<script>alert("BPL Sistemine Hoş Geldin! Kayıt başarılı."); window.location="/";</script>');
    } catch (err) {
        res.status(500).send("Kayıt sırasında teknik bir arıza oluştu: " + err.message);
    }
};

// GİRİŞ İŞLEMİ (POST /login)
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });

        // Şifre ve kullanıcı kontrolü
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.send('<script>alert("E-posta veya şifre hatalı!"); window.location="/";</script>');
        }

        // Session kaydı (Tüm sistemin tanıması için)
        req.session.userId = user._id;
        req.session.nickname = user.nickname;
        
        res.redirect('/profil');
    } catch (err) {
        res.status(500).send("Giriş işlemi başarısız oldu.");
    }
};

// ÇIKIŞ İŞLEMİ (Opsiyonel ama gerekli)
exports.logout = (req, res) => {
    req.session.destroy();
    res.redirect('/');
};
