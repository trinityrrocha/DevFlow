const crypto = require('crypto');
const argon2 = require('argon2');
const jwt = require('jsonwebtoken');
const { authenticator } = require('otplib');
const db = require('../config/database');
const env = require('../config/env');
const { AppError } = require('../utils/errors');

function encryptionKey() {
  const value = String(env.CONFIG_ENCRYPTION_KEY).trim();
  return Buffer.from(value, 'base64');
}

function encryptSecret(secret) {
  const key = encryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}:${encrypted.toString('base64')}:${cipher.getAuthTag().toString('base64')}`;
}

function decryptSecret(envelope) {
  const [version, ivValue, dataValue, tagValue] = String(envelope || '').split(':');
  if (version !== 'v1') throw new AppError('MFA_SECRET_INVALID', 'Configuração MFA inválida.', 500);
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivValue, 'base64'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataValue, 'base64')),
    decipher.final()
  ]).toString('utf8');
}

function createChallenge(user) {
  return jwt.sign(
    { sub: user.id, ver: user.token_version, purpose: 'mfa-login' },
    env.JWT_SECRET,
    { expiresIn: '5m', audience: 'devflow-mfa' }
  );
}

function verifyChallenge(token) {
  const decoded = jwt.verify(String(token || ''), env.JWT_SECRET, { audience: 'devflow-mfa' });
  if (decoded.purpose !== 'mfa-login') throw new AppError('MFA_CHALLENGE_INVALID', 'Desafio MFA inválido.', 401);
  return decoded;
}

async function getSettings(userId) {
  return (await db.query('SELECT * FROM user_mfa_settings WHERE user_id = $1', [userId])).rows[0] || null;
}

async function startSetup(user) {
  const secret = authenticator.generateSecret();
  await db.query(
    `INSERT INTO user_mfa_settings (user_id, encrypted_secret, pending_encrypted_secret, enabled)
     VALUES ($1,NULL,$2,FALSE)
     ON CONFLICT (user_id) DO UPDATE
     SET pending_encrypted_secret = EXCLUDED.pending_encrypted_secret, updated_at = CURRENT_TIMESTAMP`,
    [user.id, encryptSecret(secret)]
  );
  return {
    secret,
    otpauth_url: authenticator.keyuri(user.email, 'DevFlow', secret)
  };
}

const createRecoveryCodes = () => Array.from({ length: 10 }, () => {
  const value = crypto.randomBytes(8).toString('hex').toUpperCase();
  return `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}`;
});

async function confirmSetup(userId, code) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const settings = (await client.query(
      'SELECT * FROM user_mfa_settings WHERE user_id = $1 FOR UPDATE',
      [userId]
    )).rows[0];
    if (!settings?.pending_encrypted_secret || !authenticator.check(
      String(code || '').replace(/\s/g, ''),
      decryptSecret(settings.pending_encrypted_secret)
    )) {
      throw new AppError('MFA_CODE_INVALID', 'Código MFA inválido.', 400);
    }
    const recoveryCodes = createRecoveryCodes();
    await client.query('DELETE FROM user_mfa_recovery_codes WHERE user_id = $1', [userId]);
    for (const recoveryCode of recoveryCodes) {
      await client.query(
        'INSERT INTO user_mfa_recovery_codes (user_id, code_hash) VALUES ($1,$2)',
        [userId, await argon2.hash(recoveryCode, { type: argon2.argon2id })]
      );
    }
    await client.query(
      `UPDATE user_mfa_settings
       SET encrypted_secret = pending_encrypted_secret,
           pending_encrypted_secret = NULL,
           enabled = TRUE,
           confirmed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1`,
      [userId]
    );
    await client.query('COMMIT');
    return recoveryCodes;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function disable(userId) {
  await db.transaction(async (client) => {
    await client.query('DELETE FROM user_mfa_recovery_codes WHERE user_id=$1', [userId]);
    await client.query(
      `UPDATE user_mfa_settings
       SET encrypted_secret=NULL,pending_encrypted_secret=NULL,enabled=FALSE,
           confirmed_at=NULL,updated_at=CURRENT_TIMESTAMP
       WHERE user_id=$1`,
      [userId]
    );
  });
}

async function verifyFactor(userId, code, recoveryCode) {
  const settings = await getSettings(userId);
  if (!settings?.enabled) return false;
  if (/^\d{6}$/.test(String(code || '').replace(/\s/g, ''))) {
    return authenticator.check(String(code).replace(/\s/g, ''), decryptSecret(settings.encrypted_secret));
  }
  const candidate = String(recoveryCode || '').trim().toUpperCase();
  if (!candidate) return false;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const rows = (await client.query(
      'SELECT id, code_hash FROM user_mfa_recovery_codes WHERE user_id = $1 AND used_at IS NULL FOR UPDATE',
      [userId]
    )).rows;
    for (const row of rows) {
      if (await argon2.verify(row.code_hash, candidate).catch(() => false)) {
        await client.query(
          'UPDATE user_mfa_recovery_codes SET used_at = CURRENT_TIMESTAMP WHERE id = $1',
          [row.id]
        );
        await client.query('COMMIT');
        return true;
      }
    }
    await client.query('ROLLBACK');
    return false;
  } finally {
    client.release();
  }
}

module.exports = {
  createChallenge,
  verifyChallenge,
  getSettings,
  startSetup,
  confirmSetup,
  verifyFactor,
  disable
};
