const db = require('../config/database');
const { AppError } = require('../utils/errors');
const { recordAudit } = require('./auditService');

const MFA_ENFORCEMENT_MODES = Object.freeze(['optional', 'admins', 'all']);

function validateMfaEnforcementMode(value) {
  if (!MFA_ENFORCEMENT_MODES.includes(value)) {
    throw new AppError('MFA_POLICY_INVALID', 'Politica de MFA invalida.', 400);
  }
  return value;
}

function isAdministrativeUser(user) {
  return user?.is_super_admin === true || user?.roles?.includes('ADMIN') === true;
}

function isMfaRequiredForUser(user, mode = 'optional') {
  validateMfaEnforcementMode(mode);
  if (mode === 'optional') return false;
  return mode === 'all' || (mode === 'admins' && isAdministrativeUser(user));
}

function requiresMfaSetup(user, mode = 'optional') {
  return user?.mfa_enabled !== true && isMfaRequiredForUser(user, mode);
}

async function getMfaPolicy(queryable = db) {
  const result = await queryable.query(
    'SELECT enforcement_mode,updated_at FROM mfa_policy_settings WHERE singleton=TRUE'
  );
  if (!result.rows[0]) return { enforcement_mode: 'optional', updated_at: null };
  return {
    enforcement_mode: validateMfaEnforcementMode(result.rows[0].enforcement_mode),
    updated_at: result.rows[0].updated_at
  };
}

async function updateMfaPolicy(req, enforcementMode) {
  const nextMode = validateMfaEnforcementMode(enforcementMode);
  return db.transaction(async (client) => {
    const current = await getMfaPolicy(client);
    const updated = (await client.query(
      `INSERT INTO mfa_policy_settings (singleton,enforcement_mode,updated_by)
       VALUES (TRUE,$1,$2)
       ON CONFLICT (singleton) DO UPDATE
       SET enforcement_mode=EXCLUDED.enforcement_mode,
           updated_by=EXCLUDED.updated_by,
           updated_at=CURRENT_TIMESTAMP
       RETURNING enforcement_mode,updated_at`,
      [nextMode, req.user.id]
    )).rows[0];
    await recordAudit({
      req,
      operation: 'MFA_POLICY_UPDATED',
      entityType: 'SECURITY_POLICY',
      previousValues: { enforcement_mode: current.enforcement_mode },
      newValues: { enforcement_mode: updated.enforcement_mode },
      queryable: client,
      strict: true
    });
    return updated;
  });
}

module.exports = {
  MFA_ENFORCEMENT_MODES,
  validateMfaEnforcementMode,
  isAdministrativeUser,
  isMfaRequiredForUser,
  requiresMfaSetup,
  getMfaPolicy,
  updateMfaPolicy
};
