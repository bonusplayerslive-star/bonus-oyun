const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service 'gmail',
    auth {
        user process.env.MAIL_USER,
        pass process.env.MAIL_APP_PASS
    }
});

const sendResetEmail = (to, resetLink) = {
    const mailOptions = {
        from `BPL ECOSYSTEM ${process.env.MAIL_USER}`,
        to to,
        subject 'BPL CORE - Şifre Sıfırlama Talebi',
        html `
            div style=background#050505; color#fff; padding20px; font-familysans-serif; border1px solid #39FF14;
                h2 style=color#39FF14;OPERASYON GÜNCELLEMESİh2
                pSisteme erişim şifrenizi sıfırlamak için aşağıdaki butona tıklayınp
                a href=${resetLink} style=displayinline-block; padding10px 20px; background#39FF14; color#000; text-decorationnone; font-weightbold; border-radius5px;ŞİFREYİ SIFIRLAa
                p style=margin-top20px; font-size12px; color#888;Eğer bu talebi siz yapmadıysanız, lütfen bu maili dikkate almayın.p
            div
        `
    };
    return transporter.sendMail(mailOptions);
};

module.exports = { sendResetEmail };