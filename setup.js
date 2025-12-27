const fs = require('fs');
const path = require('path');

const folders = [
    'public/caracter/page',
    'public/caracter/mail',
    'public/caracter/explanation',
    'public/caracter/burning',
    'public/caracter/move',
    'data/gift',
    'data/attention/withdrawal request to wallet',
    'data/attention/bscscan',
    'data/attention/transfer',
    'data/game/payment',
    'views'
];

folders.forEach(dir => {
    const fullPath = path.join(__dirname, dir);
    if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
        console.log(`Oluşturuldu: ${fullPath}`);
    }
});

// Test için boş dosyaları oluştur (Hata almamak için)
fs.writeFileSync('public/caracter/explanation/explanation1.txt', 'BonusPlayersLive, oyun dünyasını blockchain ile birleştiriyor. (Örnek Makale 1)');
fs.writeFileSync('public/caracter/explanation/explanation2.txt', 'Gerçek hayatta kazanmanın yolu buradan geçer. (Örnek Makale 2)');
fs.writeFileSync('public/caracter/explanation/explanation3.txt', 'Güvenli ve hızlı işlem altyapısı. (Örnek Makale 3)');
fs.writeFileSync('public/caracter/mail/mail.txt', 'smtp.server.com|587'); // Örnek mail config

console.log("Tüm klasör yapısı hazır!");