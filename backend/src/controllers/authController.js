const crypto = require('crypto');
const argon2 = require('argon2');
const { z } = require('zod');
const db = require('../config/database');
const env = require('../config/env');
const { AppError, assert } = require('../utils/errors');
const { createSession, revokeSession, SESSION_COOKIE, cookieOptions } = require('../services/sessionService');
const { issueCsrf, csrfCookieOptions, CSRF_COOKIE } = require('../services/csrfService');
const mfaService = require('../services/mfaService');
const { recordAudit } = require('../services/auditService');
const {
  bootstrapCompany,
  listUserCompanies,
  loadMembershipContext,
  requireMembership
} = require('../services/tenantService');

const passwordSchema = z.string()
  .min(12, 'A senha deve ter pelo menos 12 caracteres.')
  .max(1024)
  .regex(/[A-Z]/, 'Inclua uma letra maiúscula.')
  .regex(/[a-z]/, 'Inclua uma letra minúscula.')
  .regex(/[0-9]/, 'Inclua um número.')
  .regex(/[^A-Za-z0-9]/, 'Inclua um caractere especial.');

const bootstrapSchema = z.object({
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().toLowerCase().email(),
  password: passwordSchema,
  company_name: z.string().trim().min(2).max(180),
  bootstrap_token: z.string().min(1)
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(1024)
});

const serializeUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  is_super_admin: user.is_super_admin === true,
  must_change_password: user.must_change_password === true,
  must_configure_mfa: user.must_configure_mfa === true,
  company_id: user.company_id,
  company_name: user.company_name,
  company_slug: user.company_slug,
  membership_id: user.membership_id,
  roles: user.roles || [],
  profiles: user.profiles || [],
  permissions: user.permissions || [],
  access_level: user.is_super_admin || user.roles?.includes('ADMIN') ? 'ADMIN' : 'USER'
});

async function loadLoginUser(email) {
  return (await db.query(
    `SELECT u.* FROM users u
     WHERE LOWER(u.email) = $1 AND u.deleted_at IS NULL`,
    [email]
  )).rows[0];
}

async function completeLogin(req, res, user) {
  const token = await createSession(req, user);
  res.cookie(SESSION_COOKIE, token, cookieOptions());
  issueCsrf(res);
  req.user = serializeUser(user);
  await recordAudit({ req, operation: 'LOGIN', entityType: 'USER', entityId: user.id });
  return res.status(200).json({
    user: serializeUser(user),
    companies: await listUserCompanies(user.id)
  });
}

async function bootstrapStatus(_req, res) {
  const result = await db.query('SELECT EXISTS(SELECT 1 FROM users WHERE is_super_admin = TRUE AND deleted_at IS NULL) AS configured');
  res.json({ required: !result.rows[0].configured });
}

async function bootstrap(req, res) {
  const payload = bootstrapSchema.parse(req.body);
  const expected = Buffer.from(env.ADMIN_BOOTSTRAP_TOKEN);
  const received = Buffer.from(payload.bootstrap_token);
  assert(
    expected.length === received.length && crypto.timingSafeEqual(expected, received),
    'BOOTSTRAP_TOKEN_INVALID',
    'Token de configuração inicial inválido.',
    403
  );
  assert(payload.email === env.SUPER_ADMIN_EMAIL.toLowerCase(), 'BOOTSTRAP_EMAIL_INVALID', 'Use o e-mail de Super Admin configurado.');

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE users IN EXCLUSIVE MODE');
    const existing = await client.query('SELECT 1 FROM users WHERE is_super_admin = TRUE AND deleted_at IS NULL');
    assert(!existing.rowCount, 'BOOTSTRAP_COMPLETED', 'A configuração inicial já foi concluída.', 409);
    const inserted = await client.query(
      `INSERT INTO users (name,email,password_hash,is_super_admin,must_change_password)
       VALUES ($1,$2,$3,TRUE,TRUE)
       RETURNING *`,
      [payload.name, payload.email, await argon2.hash(payload.password, { type: argon2.argon2id })]
    );
    await bootstrapCompany(client, payload.company_name, inserted.rows[0].id);
    await client.query('COMMIT');
    return res.status(201).json({ message: 'Super Admin criado.' });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function login(req, res) {
  const payload = loginSchema.parse(req.body);
  const user = await loadLoginUser(payload.email);
  const valid = user?.is_active && await argon2.verify(user.password_hash, payload.password).catch(() => false);
  if (!valid) {
    await recordAudit({
      req,
      operation: 'LOGIN',
      entityType: 'USER',
      status: 'DENIED',
      newValues: { email: payload.email }
    });
    throw new AppError('INVALID_CREDENTIALS', 'Credenciais inválidas.', 401);
  }
  const mfa = await mfaService.getSettings(user.id);
  if (mfa?.enabled) {
    return res.json({ mfa_required: true, challenge_token: mfaService.createChallenge(user) });
  }
  const membership = await loadMembershipContext(user.id);
  assert(membership, 'COMPANY_ACCESS_DENIED', 'Usuário sem empresa ativa.', 403);
  return completeLogin(req, res, { ...user, ...membership });
}

async function verifyMfa(req, res) {
  const payload = z.object({
    challenge_token: z.string().min(1),
    code: z.string().optional(),
    recovery_code: z.string().optional()
  }).parse(req.body);
  const challenge = mfaService.verifyChallenge(payload.challenge_token);
  const user = await loadLoginUser((await db.query('SELECT email FROM users WHERE id = $1', [challenge.sub])).rows[0]?.email);
  assert(user?.is_active && user.token_version === challenge.ver, 'MFA_CHALLENGE_INVALID', 'Desafio MFA inválido.', 401);
  const valid = await mfaService.verifyFactor(user.id, payload.code, payload.recovery_code);
  assert(valid, 'MFA_CODE_INVALID', 'Código MFA inválido.', 401);
  const membership = await loadMembershipContext(user.id);
  assert(membership, 'COMPANY_ACCESS_DENIED', 'Usuário sem empresa ativa.', 403);
  return completeLogin(req, res, { ...user, ...membership });
}

async function me(req, res) {
  res.json({
    user: serializeUser(req.user),
    companies: await listUserCompanies(req.user.id)
  });
}

async function switchCompany(req, res) {
  const { company_id: companyId } = z.object({ company_id: z.string().uuid() }).parse(req.body);
  const membership = await requireMembership(req.user.id, companyId);
  const user = (await db.query(
    'SELECT * FROM users WHERE id=$1 AND is_active=TRUE AND deleted_at IS NULL',
    [req.user.id]
  )).rows[0];
  assert(user, 'USER_NOT_FOUND', 'Usuário não encontrado.', 404);
  await revokeSession(req.cookies?.[SESSION_COOKIE], 'company_switched');
  const context = { ...user, ...membership };
  const token = await createSession(req, context);
  res.cookie(SESSION_COOKIE, token, cookieOptions());
  issueCsrf(res);
  req.user = serializeUser(context);
  await recordAudit({
    req,
    operation: 'COMPANY_SWITCHED',
    entityType: 'COMPANY',
    entityId: companyId
  });
  res.json({
    user: serializeUser(context),
    companies: await listUserCompanies(user.id)
  });
}

async function csrf(_req, res) {
  issueCsrf(res);
  res.json({ message: 'Token CSRF renovado.' });
}

async function logout(req, res) {
  await revokeSession(req.cookies?.[SESSION_COOKIE]);
  res.clearCookie(SESSION_COOKIE, cookieOptions());
  res.clearCookie(CSRF_COOKIE, csrfCookieOptions());
  await recordAudit({ req, operation: 'LOGOUT', entityType: 'USER', entityId: req.user?.id });
  res.json({ message: 'Sessão encerrada.' });
}

async function mfaStatus(req, res) {
  const settings = await mfaService.getSettings(req.user.id);
  const count = await db.query(
    'SELECT COUNT(*)::integer AS total FROM user_mfa_recovery_codes WHERE user_id = $1 AND used_at IS NULL',
    [req.user.id]
  );
  res.json({ enabled: settings?.enabled === true, recovery_codes_remaining: count.rows[0].total });
}

async function startMfa(req, res) {
  const setup = await mfaService.startSetup(req.user);
  await recordAudit({ req, operation: 'MFA_SETUP_STARTED', entityType: 'USER', entityId: req.user.id });
  res.json(setup);
}

async function confirmMfa(req, res) {
  const { code } = z.object({ code: z.string().min(6).max(12) }).parse(req.body);
  const recoveryCodes = await mfaService.confirmSetup(req.user.id, code);
  await recordAudit({ req, operation: 'MFA_ENABLED', entityType: 'USER', entityId: req.user.id });
  res.json({ enabled: true, recovery_codes: recoveryCodes });
}

module.exports = {
  passwordSchema,
  bootstrapStatus,
  bootstrap,
  login,
  verifyMfa,
  me,
  switchCompany,
  csrf,
  logout,
  mfaStatus,
  startMfa,
  confirmMfa
};
