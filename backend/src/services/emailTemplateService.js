const env = require('../config/env');

const text = (value) => String(value || '').replace(/[\r\n]+/g, ' ').trim();

function renderTemplate(code, data = {}) {
  const name = text(data.name) || 'Usuario';
  const taskUrl = data.task_id ? `${env.APP_ORIGIN}/task/${encodeURIComponent(data.task_id)}` : env.APP_ORIGIN;
  const templates = {
    EMAIL_VERIFICATION: {
      subject: '[DevFlow] Confirme seu novo e-mail',
      body: `${name},\n\nConfirme seu novo e-mail pelo link abaixo. Ele expira em ${env.EMAIL_VERIFICATION_TTL_MINUTES} minutos.\n\n${env.APP_ORIGIN}/profile?verify_email=${encodeURIComponent(data.token || '')}\n\nSe voce nao solicitou esta alteracao, ignore esta mensagem.`
    },
    PASSWORD_RESET: {
      subject: '[DevFlow] Recuperacao de senha',
      body: `${name},\n\nRecebemos uma solicitacao de recuperacao de senha. Use o link abaixo em ate ${env.PASSWORD_RESET_TTL_MINUTES} minutos.\n\n${env.APP_ORIGIN}/login?reset_token=${encodeURIComponent(data.token || '')}\n\nSe voce nao fez esta solicitacao, ignore esta mensagem.`
    },
    SECURITY_ALERT: {
      subject: `[DevFlow] ${text(data.title) || 'Aviso de seguranca'}`,
      body: `${name},\n\n${text(data.body)}\n\nAcesse ${env.APP_ORIGIN}`
    },
    TASK_EVENT: {
      subject: `[DevFlow] ${text(data.title)}`,
      body: `${name},\n\n${text(data.body)}\n\nAcesse ${taskUrl}`
    },
    SMTP_TEST: {
      subject: '[DevFlow] Teste de configuracao SMTP',
      body: `${name},\n\nO worker de e-mail do DevFlow processou esta mensagem de teste.\n\nAmbiente: ${env.NODE_ENV}\nVersao: ${env.DEVFLOW_VERSION}`
    }
  };
  if (!templates[code]) throw new Error('EMAIL_TEMPLATE_INVALID');
  return templates[code];
}

module.exports = { renderTemplate };
