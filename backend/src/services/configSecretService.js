const crypto = require('node:crypto');
const env = require('../config/env');

const VERSION = 'v1';

function key() {
  return Buffer.from(env.CONFIG_ENCRYPTION_KEY, 'base64');
}

function encryptSecret(value) {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\r\n\0]/.test(value)) {
    const error = new Error('Segredo de configuracao invalido.');
    error.code = 'CONFIG_SECRET_INVALID';
    throw error;
  }
  const encryptionKey = key();
  const iv = crypto.randomBytes(12);
  const plain = Buffer.from(value, 'utf8');
  try {
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
    return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
  } finally {
    encryptionKey.fill(0);
    plain.fill(0);
  }
}

function decryptSecret(envelope) {
  const [version, ivValue, tagValue, encryptedValue] = String(envelope || '').split('.');
  if (version !== VERSION || !ivValue || !tagValue || !encryptedValue) {
    const error = new Error('Segredo de configuracao cifrado invalido.');
    error.code = 'CONFIG_SECRET_INVALID';
    throw error;
  }
  const encryptionKey = key();
  const iv = Buffer.from(ivValue, 'base64url');
  const tag = Buffer.from(tagValue, 'base64url');
  const encrypted = Buffer.from(encryptedValue, 'base64url');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } finally {
    encryptionKey.fill(0);
    iv.fill(0);
    tag.fill(0);
    encrypted.fill(0);
  }
}

module.exports = { encryptSecret, decryptSecret };
