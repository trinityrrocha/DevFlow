const nodemailer = require('nodemailer');
const env = require('../config/env');
const { AppError } = require('../utils/errors');

function createTransport() {
  if (!env.SMTP_HOST || !env.SMTP_FROM) return null;
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    connectionTimeout: 10000,
    socketTimeout: 15000
  });
}

async function sendEmailVerification({ name, email, token }) {
  const mailer = createTransport();
  if (!mailer) throw new AppError('SMTP_NOT_CONFIGURED', 'O envio de e-mail nao esta configurado. O endereco atual foi preservado.', 503);
  const url = `${env.APP_ORIGIN}/profile?verify_email=${encodeURIComponent(token)}`;
  await mailer.sendMail({
    from: env.SMTP_FROM,
    to: email,
    subject: '[DevFlow] Confirme seu novo e-mail',
    text: `${name},\n\nConfirme seu novo e-mail acessando o link abaixo. Ele expira em ${env.EMAIL_VERIFICATION_TTL_MINUTES} minutos.\n\n${url}\n\nSe voce nao solicitou esta alteracao, ignore esta mensagem.`
  });
}

module.exports = { createTransport, sendEmailVerification };
