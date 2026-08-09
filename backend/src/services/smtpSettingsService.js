const nodemailer = require('nodemailer');
const db = require('../config/database');
const env = require('../config/env');
const { AppError } = require('../utils/errors');
const { encryptSecret, decryptSecret } = require('./configSecretService');

function fromEnvironment() {
  const match = String(env.SMTP_FROM || '').match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return {
    id: 1, enabled: env.SMTP_ENABLED, host: env.SMTP_HOST, port: env.SMTP_PORT,
    security: env.SMTP_SECURE ? 'ssl_tls' : 'starttls', username: env.SMTP_USER,
    password: env.SMTP_PASSWORD, encrypted_password: null,
    from_name: match?.[1] || 'DevFlow', from_email: match?.[2] || env.SMTP_FROM,
    reply_to: env.SMTP_REPLY_TO, timeout_seconds: Math.ceil(env.SMTP_CONNECTION_TIMEOUT_MS / 1000),
    source: 'environment'
  };
}

const clean = (value, max, field) => {
  const result = String(value ?? '').trim();
  if (result.length > max || /[\r\n\0]/.test(result)) throw new AppError('SMTP_SETTINGS_INVALID', `${field} invalido.`, 400);
  return result;
};
const email = (value, field, required = false) => {
  const result = clean(value, 320, field).toLowerCase();
  if ((required && !result) || (result && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result))) throw new AppError('SMTP_SETTINGS_INVALID', `${field} invalido.`, 400);
  return result;
};

function sanitized(settings) {
  return {
    enabled: settings.enabled === true, host: settings.host || '', port: Number(settings.port || 587),
    security: settings.security || 'starttls', username: settings.username || '',
    has_password: Boolean(settings.encrypted_password || settings.password), from_name: settings.from_name || 'DevFlow',
    from_email: settings.from_email || '', reply_to: settings.reply_to || '',
    timeout_seconds: Number(settings.timeout_seconds || 15), source: settings.source || 'database'
  };
}

async function rawSettings(queryable = db, lock = false) {
  const row = (await queryable.query(`SELECT * FROM smtp_settings WHERE id=1${lock ? ' FOR UPDATE' : ''}`)).rows[0];
  const databaseConfigured = row && (row.host || row.from_email || row.encrypted_password || row.enabled);
  return databaseConfigured ? { ...row, source: 'database' } : fromEnvironment();
}

async function getSettings() {
  return sanitized(await rawSettings());
}

async function saveSettings(payload, actorId) {
  return db.transaction(async (client) => {
    const current = await rawSettings(client, true);
    const port = Number(payload.port ?? current.port);
    const timeout = Number(payload.timeout_seconds ?? current.timeout_seconds);
    const security = clean(payload.security ?? current.security, 20, 'Seguranca SMTP');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new AppError('SMTP_SETTINGS_INVALID', 'Porta SMTP invalida.', 400);
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 120) throw new AppError('SMTP_SETTINGS_INVALID', 'Timeout SMTP invalido.', 400);
    if (!['ssl_tls', 'starttls'].includes(security)) throw new AppError('SMTP_SETTINGS_INVALID', 'Seguranca SMTP invalida.', 400);
    if (payload.password && (typeof payload.password !== 'string' || payload.password.length > 4096 || /[\r\n\0]/.test(payload.password))) throw new AppError('SMTP_SETTINGS_INVALID', 'Senha SMTP invalida.', 400);
    const password = payload.password || current.password || null;
    const encryptedPassword = payload.password ? encryptSecret(payload.password)
      : current.encrypted_password || (password ? encryptSecret(password) : null);
    const settings = {
      enabled: payload.enabled ?? current.enabled ?? false,
      host: clean(payload.host ?? current.host, 255, 'Host SMTP'), port, security,
      username: clean(payload.username ?? current.username, 320, 'Usuario SMTP'),
      encrypted_password: encryptedPassword,
      from_name: clean(payload.from_name ?? current.from_name, 160, 'Nome do remetente'),
      from_email: email(payload.from_email ?? current.from_email, 'E-mail do remetente'),
      reply_to: email(payload.reply_to ?? current.reply_to, 'Reply-To'), timeout_seconds: timeout
    };
    if (settings.host && (/\s/.test(settings.host) || settings.host.includes('://'))) throw new AppError('SMTP_SETTINGS_INVALID', 'Host SMTP invalido.', 400);
    if (settings.enabled && (!settings.host || !settings.from_email)) throw new AppError('SMTP_SETTINGS_INVALID', 'Host e remetente sao obrigatorios.', 400);
    if (Boolean(settings.username) !== Boolean(settings.encrypted_password)) throw new AppError('SMTP_SETTINGS_INVALID', 'Usuario e senha SMTP devem ser configurados juntos.', 400);
    const result = await client.query(
      `INSERT INTO smtp_settings (id,enabled,host,port,security,username,encrypted_password,from_name,from_email,reply_to,timeout_seconds,updated_by)
       VALUES (1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO UPDATE SET enabled=EXCLUDED.enabled,host=EXCLUDED.host,port=EXCLUDED.port,
       security=EXCLUDED.security,username=EXCLUDED.username,encrypted_password=EXCLUDED.encrypted_password,
       from_name=EXCLUDED.from_name,from_email=EXCLUDED.from_email,reply_to=EXCLUDED.reply_to,
       timeout_seconds=EXCLUDED.timeout_seconds,updated_by=EXCLUDED.updated_by,updated_at=CURRENT_TIMESTAMP RETURNING *`,
      [settings.enabled, settings.host, port, security, settings.username, encryptedPassword,
        settings.from_name, settings.from_email, settings.reply_to || null, timeout, actorId]
    );
    return sanitized(result.rows[0]);
  });
}

async function deliverySettings({ allowDisabled = false } = {}) {
  const settings = await rawSettings();
  if (!allowDisabled && !settings.enabled) return null;
  if (!settings.host || !settings.from_email) throw new AppError('SMTP_NOT_CONFIGURED', 'Host e remetente SMTP nao configurados.', 409);
  const password = settings.encrypted_password ? decryptSecret(settings.encrypted_password) : settings.password || '';
  if (Boolean(settings.username) !== Boolean(password)) throw new AppError('SMTP_NOT_CONFIGURED', 'Credenciais SMTP incompletas.', 409);
  return { ...settings, password };
}

function transportOptions(settings) {
  const timeout = Number(settings.timeout_seconds) * 1000;
  return {
    host: settings.host, port: Number(settings.port), secure: settings.security === 'ssl_tls',
    requireTLS: settings.security === 'starttls',
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    auth: settings.username ? { user: settings.username, pass: settings.password } : undefined,
    connectionTimeout: timeout, greetingTimeout: timeout, socketTimeout: timeout
  };
}

function safeFailure(error, phase) {
  return {
    phase, code: String(error?.code || 'SMTP_CONNECTION_FAILED').slice(0, 100),
    command: String(error?.command || '').slice(0, 60) || null,
    response_code: Number(error?.responseCode) || null,
    response: String(error?.response || error?.message || 'Falha SMTP').replace(/password=[^\s]+/gi, 'password=[REDACTED]').slice(0, 500)
  };
}

async function testConnection(to) {
  const settings = await deliverySettings({ allowDisabled: true });
  const transporter = nodemailer.createTransport(transportOptions(settings));
  try {
    try {
      await transporter.verify();
    } catch (error) {
      throw new AppError('SMTP_TEST_FAILED', 'Falha ao validar a conexao SMTP.', 502, safeFailure(error, 'verify'));
    }
    try {
      await transporter.sendMail({ from: { name: settings.from_name || 'DevFlow', address: settings.from_email }, to, replyTo: settings.reply_to || undefined, subject: 'Teste SMTP do DevFlow', text: 'Conexao SMTP do DevFlow validada com sucesso.' });
    } catch (error) {
      throw new AppError('SMTP_TEST_FAILED', 'A conexao foi validada, mas o e-mail de teste falhou.', 502, safeFailure(error, 'send'));
    }
    return { message: 'Conexao SMTP e envio de teste validados com sucesso.' };
  } finally {
    transporter.close?.();
    if (settings.password) settings.password = '';
  }
}

module.exports = { getSettings, saveSettings, deliverySettings, transportOptions, testConnection, sanitized };
