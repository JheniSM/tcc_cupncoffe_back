const { sendEmail } = require("./mailer");

(async () => {
    await sendEmail(
        "seuemail@exemplo.com",
        "Teste de envio",
        "<h2>Olá!</h2><p>Esse é um teste de e-mail via Ethereal.</p>"
    );
})();