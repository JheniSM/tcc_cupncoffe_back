// utils/mailer.js
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
    host: "smtp.ethereal.email",
    port: 587,
    auth: {
        user: "kaycee.moore@ethereal.email",
        pass: "Keu53K1h34ex1dkbQb"
    }
});

async function sendEmail(to, subject, html) {
    const info = await transporter.sendMail({
        from: '"Coffee ON" <no-reply@coffeon.com>',
        to,
        subject,
        html,
    });

    console.log("📨 E-mail enviado:", info.messageId);
    console.log("🔗 Link para visualizar:", nodemailer.getTestMessageUrl(info));
}

module.exports = { sendEmail };
