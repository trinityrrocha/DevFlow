const crypto = require('crypto');
const argon2 = require('argon2');
const { z } = require('zod');
const db = require('../config/database');
const env = require('../config/env');
const { passwordSchema } = require('./authController');
const { AppError, assert } = require('../utils/errors');
const { recordAudit } = require('../services/auditService');
const { SESSION_COOKIE, cookieOptions, revokeUserSessions } = require('../services/sessionService');
const { CSRF_COOKIE, csrfCookieOptions } = require('../services/csrfService');
const { enqueueEmail, smtpConfigured } = require('../services/emailOutboxService');
const mfaService = require('../services/mfaService');

const phoneSchema = z.string().trim().max(32).regex(/^\+[1-9]\d{7,14}$/, 'Use o formato internacional E.164, por exemplo +5511999999999.').nullable().optional();
const emailSchema = z.string().trim().toLowerCase().email().max(320);
const createUserSchema = z.object({
  name: z.string().trim().min(2).max(160),
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
  access_level: z.enum(['ADMIN', 'USER']).default('USER'),
  profiles: z.array(z.string().min(1)).min(1)
});

const membershipSelect = `
  SELECT u.id,u.name,u.email,u.phone,u.pending_email,u.is_super_admin,u.is_active AS identity_active,
         u.must_change_password,u.created_at,u.updated_at,
         m.id AS membership_id,m.is_active,m.joined_at,
         COALESCE((SELECT MAX(s.created_at) FROM user_sessions s WHERE s.user_id=u.id),NULL) AS last_login_at,
         COALESCE((SELECT MAX(s.last_seen_at) FROM user_sessions s WHERE s.user_id=u.id),NULL) AS last_access_at,
         COALESCE((SELECT enabled FROM user_mfa_settings WHERE user_id=u.id),FALSE) AS mfa_enabled,
         COALESCE((
           SELECT array_agg(DISTINCT r.code ORDER BY r.code)
           FROM membership_roles mr JOIN company_roles r ON r.id=mr.role_id
           WHERE mr.membership_id=m.id AND r.is_active=TRUE
         ),'{}') AS roles,
         COALESCE((
           SELECT array_agg(DISTINCT p.code ORDER BY p.code)
           FROM membership_technical_profiles mp JOIN technical_profiles p ON p.id=mp.profile_id
           WHERE mp.membership_id=m.id AND p.is_active=TRUE
         ),'{}') AS profiles
  FROM company_memberships m JOIN users u ON u.id=m.user_id
`;

const withAccessLevel = (row) => ({ ...row, access_level: row.is_super_admin || row.roles?.includes('ADMIN') ? 'ADMIN' : 'USER' });

function assertCanManage(actor, target) {
  if (target.is_super_admin && !actor.is_super_admin) throw new AppError('SUPER_ADMIN_PROTECTED', 'Somente outro Super Admin pode administrar esta conta.', 403);
}

async function loadManagedUser(client, companyId, userId, lock = false) {
  return (await client.query(
    `${membershipSelect} WHERE m.company_id=$1 AND m.user_id=$2 AND u.deleted_at IS NULL${lock ? ' FOR UPDATE OF m,u' : ''}`,
    [companyId, userId]
  )).rows[0];
}

async function listUsers(req, res) {
  const result = await db.query(`${membershipSelect} WHERE m.company_id=$1 AND u.deleted_at IS NULL ORDER BY u.name`, [req.user.company_id]);
  res.json({ users: result.rows.map(withAccessLevel) });
}

async function getUser(req, res) {
  const user = await loadManagedUser(db, req.user.company_id, req.params.id);
  assert(user, 'USER_NOT_FOUND', 'Usuario nao encontrado.', 404);
  assertCanManage(req.user, user);
  const history = await db.query(
    `SELECT operation,new_values,created_at FROM audit_events
     WHERE company_id=$1 AND entity_type='USER' AND entity_id=$2
     ORDER BY created_at DESC LIMIT 20`,
    [req.user.company_id, req.params.id]
  );
  res.json({ user: withAccessLevel(user), history: history.rows });
}

async function listProfiles(req, res) {
  const result = await db.query('SELECT id,code,name,is_system,is_active FROM technical_profiles WHERE company_id=$1 AND is_active=TRUE ORDER BY name', [req.user.company_id]);
  res.json({ profiles: result.rows });
}

async function createUser(req, res) {
  const payload = createUserSchema.parse(req.body);
  const client = await db.pool.connect();
  let responseUser;
  try {
    await client.query('BEGIN');
    const profileRows = await client.query('SELECT id,code FROM technical_profiles WHERE company_id=$1 AND code=ANY($2::text[]) AND is_active=TRUE', [req.user.company_id, payload.profiles]);
    assert(profileRows.rowCount === new Set(payload.profiles).size, 'PROFILE_INVALID', 'Um ou mais perfis sao invalidos.');
    const role = (await client.query('SELECT id FROM company_roles WHERE company_id=$1 AND code=$2 AND is_active=TRUE', [req.user.company_id, payload.access_level])).rows[0];
    assert(role, 'ROLE_INVALID', 'Papel invalido.');
    let user = (await client.query('SELECT * FROM users WHERE LOWER(email)=$1 AND deleted_at IS NULL FOR UPDATE', [payload.email])).rows[0];
    const existingIdentity = Boolean(user);
    if (!user) user = (await client.query(
      `INSERT INTO users (name,email,phone,password_hash,must_change_password)
       VALUES ($1,$2,$3,$4,TRUE) RETURNING *`,
      [payload.name, payload.email, payload.phone || null, await argon2.hash(payload.password, { type: argon2.argon2id })]
    )).rows[0];
    else {
      assert(user.is_active, 'USER_INACTIVE', 'A identidade existente esta inativa.', 409);
      assert(!(await client.query('SELECT 1 FROM company_memberships WHERE company_id=$1 AND user_id=$2', [req.user.company_id, user.id])).rowCount, 'EMAIL_IN_USE', 'Este e-mail ja pertence a empresa.', 409);
    }
    const companyCount = await client.query('SELECT COUNT(*)::integer AS total FROM company_memberships WHERE user_id=$1 AND is_active=TRUE', [user.id]);
    const membership = (await client.query('INSERT INTO company_memberships (company_id,user_id,is_default) VALUES ($1,$2,$3) RETURNING *', [req.user.company_id, user.id, companyCount.rows[0].total === 0])).rows[0];
    await client.query('INSERT INTO membership_roles (company_id,membership_id,role_id) VALUES ($1,$2,$3)', [req.user.company_id, membership.id, role.id]);
    for (const profile of profileRows.rows) await client.query('INSERT INTO membership_technical_profiles (company_id,membership_id,profile_id) VALUES ($1,$2,$3)', [req.user.company_id, membership.id, profile.id]);
    await client.query('COMMIT');
    responseUser = { id: user.id, name: user.name, email: user.email, phone: user.phone, access_level: payload.access_level, profiles: payload.profiles, is_active: true, existing_identity: existingIdentity };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') throw new AppError('EMAIL_IN_USE', 'Este e-mail ja esta em uso.', 409);
    throw error;
  } finally { client.release(); }
  await recordAudit({ req, operation: 'USER_MEMBERSHIP_CREATED', entityType: 'USER', entityId: responseUser.id, newValues: responseUser });
  res.status(201).json({ user: responseUser });
}

async function updateUser(req, res) {
  const payload = z.object({ name: z.string().trim().min(2).max(160).optional(), email: emailSchema.optional(), phone: phoneSchema, access_level: z.enum(['ADMIN', 'USER']).optional(), is_active: z.boolean().optional(), profiles: z.array(z.string()).min(1).optional() }).parse(req.body);
  const client = await db.pool.connect();
  let existing; let updated;
  try {
    await client.query('BEGIN');
    existing = await loadManagedUser(client, req.user.company_id, req.params.id, true);
    assert(existing, 'USER_NOT_FOUND', 'Usuario nao encontrado.', 404);
    assertCanManage(req.user, existing);
    if (existing.is_super_admin && payload.is_active === false) {
      const count = await client.query('SELECT COUNT(*)::integer AS total FROM users WHERE is_super_admin=TRUE AND is_active=TRUE AND deleted_at IS NULL');
      assert(count.rows[0].total > 1, 'LAST_SUPER_ADMIN_PROTECTED', 'O ultimo Super Admin ativo nao pode ser desativado.', 409);
    }
    if (existing.roles?.includes('ADMIN') && (payload.access_level === 'USER' || payload.is_active === false)) {
      const admins = await client.query(`SELECT COUNT(DISTINCT m.id)::integer AS total FROM company_memberships m JOIN membership_roles mr ON mr.membership_id=m.id JOIN company_roles r ON r.id=mr.role_id WHERE m.company_id=$1 AND m.is_active=TRUE AND r.code='ADMIN'`, [req.user.company_id]);
      assert(admins.rows[0].total > 1 || existing.is_super_admin, 'LAST_ADMIN_PROTECTED', 'O ultimo administrador ativo nao pode ser removido.', 409);
    }
    if (payload.email && payload.email !== existing.email) {
      const memberships = await client.query('SELECT COUNT(*)::integer AS total FROM company_memberships WHERE user_id=$1 AND is_active=TRUE', [existing.id]);
      assert(req.user.is_super_admin || memberships.rows[0].total === 1, 'SHARED_IDENTITY_PROTECTED', 'Somente o Super Admin pode alterar e-mail de identidade vinculada a varias empresas.', 403);
      await client.query('UPDATE users SET email=$2,pending_email=NULL,email_verification_token_hash=NULL,email_verification_expires_at=NULL WHERE id=$1', [existing.id, payload.email]);
    }
    if (payload.name !== undefined || payload.phone !== undefined) await client.query('UPDATE users SET name=COALESCE($2,name),phone=$3,updated_at=CURRENT_TIMESTAMP WHERE id=$1', [existing.id, payload.name, payload.phone === undefined ? existing.phone : payload.phone]);
    if (payload.is_active !== undefined) await client.query('UPDATE company_memberships SET is_active=$3,updated_at=CURRENT_TIMESTAMP WHERE company_id=$1 AND user_id=$2', [req.user.company_id, existing.id, payload.is_active]);
    if (payload.access_level) {
      const role = (await client.query('SELECT id FROM company_roles WHERE company_id=$1 AND code=$2 AND is_active=TRUE', [req.user.company_id, payload.access_level])).rows[0];
      assert(role, 'ROLE_INVALID', 'Papel invalido.');
      await client.query('DELETE FROM membership_roles WHERE membership_id=$1', [existing.membership_id]);
      await client.query('INSERT INTO membership_roles (company_id,membership_id,role_id) VALUES ($1,$2,$3)', [req.user.company_id, existing.membership_id, role.id]);
    }
    if (payload.profiles) {
      const profiles = await client.query('SELECT id,code FROM technical_profiles WHERE company_id=$1 AND code=ANY($2::text[]) AND is_active=TRUE', [req.user.company_id, payload.profiles]);
      assert(profiles.rowCount === new Set(payload.profiles).size, 'PROFILE_INVALID', 'Um ou mais perfis sao invalidos.');
      await client.query('DELETE FROM membership_technical_profiles WHERE membership_id=$1', [existing.membership_id]);
      for (const profile of profiles.rows) await client.query('INSERT INTO membership_technical_profiles (company_id,membership_id,profile_id) VALUES ($1,$2,$3)', [req.user.company_id, existing.membership_id, profile.id]);
    }
    updated = await loadManagedUser(client, req.user.company_id, req.params.id);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') throw new AppError('EMAIL_IN_USE', 'Este e-mail ja esta em uso.', 409);
    throw error;
  } finally { client.release(); }
  if (payload.email || payload.access_level || payload.is_active !== undefined) await revokeUserSessions(req.user.company_id, req.params.id, req.user.id, payload.is_active === false ? 'user_disabled' : 'membership_changed', req.user.id === req.params.id ? req.user.session_id : null);
  await recordAudit({ req, operation: 'USER_MEMBERSHIP_UPDATED', entityType: 'USER', entityId: req.params.id, previousValues: { name: existing.name, email: existing.email, phone: existing.phone, access_level: withAccessLevel(existing).access_level, is_active: existing.is_active, profiles: existing.profiles }, newValues: payload });
  res.json({ user: withAccessLevel(updated) });
}

async function updateOwnProfile(req, res) {
  const payload = z.object({ name: z.string().trim().min(2).max(160).optional(), phone: phoneSchema }).parse(req.body);
  assert(Object.keys(payload).length, 'NO_CHANGES', 'Nenhuma alteracao informada.');
  const result = await db.query('UPDATE users SET name=COALESCE($2,name),phone=$3,updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING id,name,email,phone,pending_email', [req.user.id, payload.name, payload.phone === undefined ? req.user.phone : payload.phone]);
  await recordAudit({ req, operation: 'OWN_PROFILE_UPDATED', entityType: 'USER', entityId: req.user.id, newValues: payload });
  res.json({ user: result.rows[0] });
}

async function requestOwnEmailChange(req, res) {
  const payload = z.object({ new_email: emailSchema, current_password: z.string().min(1).max(1024) }).parse(req.body);
  const user = (await db.query('SELECT * FROM users WHERE id=$1 AND is_active=TRUE AND deleted_at IS NULL', [req.user.id])).rows[0];
  assert(user && await argon2.verify(user.password_hash, payload.current_password).catch(() => false), 'CURRENT_PASSWORD_INVALID', 'A senha atual esta incorreta.', 400);
  assert(payload.new_email !== user.email.toLowerCase(), 'EMAIL_UNCHANGED', 'Informe um e-mail diferente do atual.', 400);
  assert(await smtpConfigured(), 'SMTP_NOT_CONFIGURED', 'O envio de e-mail nao esta configurado. O endereco atual foi preservado.', 503);
  const duplicate = await db.query('SELECT 1 FROM users WHERE (LOWER(email)=$1 OR LOWER(pending_email)=$1) AND id<>$2 AND deleted_at IS NULL', [payload.new_email, user.id]);
  assert(!duplicate.rowCount, 'EMAIL_IN_USE', 'Este e-mail ja esta em uso.', 409);
  const token = crypto.randomBytes(32).toString('base64url');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE users SET pending_email=$2,email_verification_token_hash=$3,email_verification_expires_at=CURRENT_TIMESTAMP+($4*INTERVAL '1 minute'),email_verification_requested_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [user.id, payload.new_email, hash, env.EMAIL_VERIFICATION_TTL_MINUTES]);
    await enqueueEmail(client, {
      companyId: req.user.company_id, userId: user.id, email: payload.new_email,
      template: 'EMAIL_VERIFICATION', data: { name: user.name, token },
      idempotencyKey: `email-verification:${user.id}:${hash}`
    });
    await recordAudit({ req, operation: 'EMAIL_CHANGE_REQUESTED', entityType: 'USER', entityId: user.id, newValues: { pending_email: payload.new_email }, queryable: client, strict: true });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
  res.status(202).json({ message: 'Enviamos uma confirmacao para o novo e-mail. O endereco atual permanece ativo ate a confirmacao.' });
}

async function confirmOwnEmailChange(req, res) {
  const { token } = z.object({ token: z.string().min(32).max(256) }).parse(req.body);
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const client = await db.pool.connect();
  let updated;
  try {
    await client.query('BEGIN');
    const user = (await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [req.user.id])).rows[0];
    assert(user?.pending_email && user.email_verification_token_hash === hash && new Date(user.email_verification_expires_at) > new Date(), 'EMAIL_VERIFICATION_INVALID', 'Confirmacao invalida ou expirada.', 400);
    updated = (await client.query(`UPDATE users SET email=pending_email,pending_email=NULL,email_verification_token_hash=NULL,email_verification_expires_at=NULL,email_verification_requested_at=NULL,token_version=token_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING id,name,email,phone`, [user.id])).rows[0];
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
  await revokeUserSessions(req.user.company_id, req.user.id, req.user.id, 'email_changed');
  await recordAudit({ req, operation: 'EMAIL_CHANGED', entityType: 'USER', entityId: req.user.id, newValues: { email: updated.email } });
  res.clearCookie(SESSION_COOKIE, cookieOptions()); res.clearCookie(CSRF_COOKIE, csrfCookieOptions());
  res.json({ message: 'E-mail confirmado. Entre novamente com o novo endereco.', reauthenticate: true });
}

async function resetUserPassword(req, res) {
  const target = await loadManagedUser(db, req.user.company_id, req.params.id);
  assert(target, 'USER_NOT_FOUND', 'Usuario nao encontrado.', 404); assertCanManage(req.user, target);
  const temporaryPassword = `${crypto.randomBytes(18).toString('base64url')}Aa1!`;
  await db.query('UPDATE users SET password_hash=$2,must_change_password=TRUE,token_version=token_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$1', [target.id, await argon2.hash(temporaryPassword, { type: argon2.argon2id })]);
  await revokeUserSessions(req.user.company_id, target.id, req.user.id, 'password_changed');
  await recordAudit({ req, operation: 'ADMIN_PASSWORD_RESET', entityType: 'USER', entityId: target.id });
  res.json({ temporary_password: temporaryPassword, must_change_password: true });
}

async function resetUserMfa(req, res) {
  const target = await loadManagedUser(db, req.user.company_id, req.params.id);
  assert(target, 'USER_NOT_FOUND', 'Usuario nao encontrado.', 404); assertCanManage(req.user, target);
  await mfaService.disable(target.id); await revokeUserSessions(req.user.company_id, target.id, req.user.id, 'mfa_reset');
  await recordAudit({ req, operation: 'ADMIN_MFA_RESET', entityType: 'USER', entityId: target.id });
  res.json({ enabled: false });
}

async function updateOwnPassword(req, res) {
  const payload = z.object({ current_password: z.string().min(1).max(1024), new_password: passwordSchema }).refine((value) => value.current_password !== value.new_password, { path: ['new_password'], message: 'A nova senha deve ser diferente da senha atual.' }).parse(req.body);
  const user = (await db.query('SELECT id,password_hash FROM users WHERE id=$1 AND is_active=TRUE AND deleted_at IS NULL', [req.user.id])).rows[0];
  assert(user && await argon2.verify(user.password_hash, payload.current_password).catch(() => false), 'CURRENT_PASSWORD_INVALID', 'A senha atual esta incorreta.', 400);
  await db.query('UPDATE users SET password_hash=$2,must_change_password=FALSE,token_version=token_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$1', [req.user.id, await argon2.hash(payload.new_password, { type: argon2.argon2id })]);
  await revokeUserSessions(req.user.company_id, req.user.id, req.user.id, 'password_changed');
  await recordAudit({ req, operation: 'PASSWORD_CHANGED', entityType: 'USER', entityId: req.user.id });
  res.clearCookie(SESSION_COOKIE, cookieOptions()); res.clearCookie(CSRF_COOKIE, csrfCookieOptions());
  res.json({ message: 'Senha alterada. Entre novamente com a nova senha.', reauthenticate: true });
}

module.exports = { listUsers, getUser, listProfiles, createUser, updateUser, updateOwnProfile, requestOwnEmailChange, confirmOwnEmailChange, resetUserPassword, resetUserMfa, updateOwnPassword, phoneSchema, assertCanManage };
