const argon2 = require('argon2');
const { z } = require('zod');
const db = require('../config/database');
const { passwordSchema } = require('./authController');
const { AppError, assert } = require('../utils/errors');
const { recordAudit } = require('../services/auditService');
const { SESSION_COOKIE, cookieOptions } = require('../services/sessionService');
const { CSRF_COOKIE, csrfCookieOptions } = require('../services/csrfService');

const createUserSchema = z.object({
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().toLowerCase().email(),
  password: passwordSchema,
  access_level: z.enum(['ADMIN', 'USER']).default('USER'),
  profiles: z.array(z.string().min(1)).min(1)
});

const membershipSelect = `
  SELECT u.id,u.name,u.email,u.is_super_admin,u.created_at,
         m.id AS membership_id,m.is_active,m.joined_at,
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

const withAccessLevel = (row) => ({
  ...row,
  access_level: row.is_super_admin || row.roles?.includes('ADMIN') ? 'ADMIN' : 'USER'
});

async function listUsers(req, res) {
  const result = await db.query(
    `${membershipSelect}
     WHERE m.company_id=$1 AND u.deleted_at IS NULL
     ORDER BY u.name`,
    [req.user.company_id]
  );
  res.json({ users: result.rows.map(withAccessLevel) });
}

async function listProfiles(req, res) {
  const result = await db.query(
    `SELECT id,code,name,is_system,is_active
     FROM technical_profiles
     WHERE company_id=$1 AND is_active=TRUE ORDER BY name`,
    [req.user.company_id]
  );
  res.json({ profiles: result.rows });
}

async function createUser(req, res) {
  const payload = createUserSchema.parse(req.body);
  const client = await db.pool.connect();
  let responseUser;
  try {
    await client.query('BEGIN');
    const profileRows = await client.query(
      `SELECT id,code FROM technical_profiles
       WHERE company_id=$1 AND code=ANY($2::text[]) AND is_active=TRUE`,
      [req.user.company_id, payload.profiles]
    );
    assert(profileRows.rowCount === new Set(payload.profiles).size, 'PROFILE_INVALID', 'Um ou mais perfis são inválidos.');
    const role = (await client.query(
      `SELECT id FROM company_roles
       WHERE company_id=$1 AND code=$2 AND is_active=TRUE`,
      [req.user.company_id, payload.access_level]
    )).rows[0];
    assert(role, 'ROLE_INVALID', 'Papel inválido.');

    let user = (await client.query(
      'SELECT * FROM users WHERE LOWER(email)=$1 AND deleted_at IS NULL FOR UPDATE',
      [payload.email]
    )).rows[0];
    let existingIdentity = true;
    if (!user) {
      existingIdentity = false;
      user = (await client.query(
        `INSERT INTO users (name,email,password_hash,must_change_password)
         VALUES ($1,$2,$3,TRUE) RETURNING *`,
        [payload.name, payload.email, await argon2.hash(payload.password, { type: argon2.argon2id })]
      )).rows[0];
    } else {
      assert(user.is_active, 'USER_INACTIVE', 'A identidade existente está inativa.', 409);
      const duplicate = await client.query(
        'SELECT 1 FROM company_memberships WHERE company_id=$1 AND user_id=$2',
        [req.user.company_id, user.id]
      );
      assert(!duplicate.rowCount, 'EMAIL_IN_USE', 'Este e-mail já pertence à empresa.', 409);
    }
    const companyCount = await client.query(
      'SELECT COUNT(*)::integer AS total FROM company_memberships WHERE user_id=$1 AND is_active=TRUE',
      [user.id]
    );
    const membership = (await client.query(
      `INSERT INTO company_memberships (company_id,user_id,is_default)
       VALUES ($1,$2,$3) RETURNING *`,
      [req.user.company_id, user.id, companyCount.rows[0].total === 0]
    )).rows[0];
    await client.query(
      'INSERT INTO membership_roles (company_id,membership_id,role_id) VALUES ($1,$2,$3)',
      [req.user.company_id, membership.id, role.id]
    );
    for (const profile of profileRows.rows) {
      await client.query(
        `INSERT INTO membership_technical_profiles (company_id,membership_id,profile_id)
         VALUES ($1,$2,$3)`,
        [req.user.company_id, membership.id, profile.id]
      );
    }
    await client.query('COMMIT');
    responseUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      access_level: payload.access_level,
      profiles: payload.profiles,
      is_active: true,
      existing_identity: existingIdentity
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') throw new AppError('EMAIL_IN_USE', 'Este e-mail já está em uso.', 409);
    throw error;
  } finally {
    client.release();
  }
  await recordAudit({
    req,
    operation: 'USER_MEMBERSHIP_CREATED',
    entityType: 'USER',
    entityId: responseUser.id,
    newValues: responseUser
  });
  res.status(201).json({ user: responseUser });
}

async function updateUser(req, res) {
  const payload = z.object({
    name: z.string().trim().min(2).max(160).optional(),
    access_level: z.enum(['ADMIN', 'USER']).optional(),
    is_active: z.boolean().optional(),
    profiles: z.array(z.string()).min(1).optional()
  }).parse(req.body);
  const client = await db.pool.connect();
  let updated;
  try {
    await client.query('BEGIN');
    const existing = (await client.query(
      `${membershipSelect}
       WHERE m.company_id=$1 AND m.user_id=$2 AND u.deleted_at IS NULL FOR UPDATE OF m`,
      [req.user.company_id, req.params.id]
    )).rows[0];
    assert(existing, 'USER_NOT_FOUND', 'Usuário não encontrado.', 404);
    assert(!existing.is_super_admin || payload.is_active !== false, 'SUPER_ADMIN_PROTECTED', 'O Super Admin é protegido.', 409);

    if (existing.roles?.includes('ADMIN') && (payload.access_level === 'USER' || payload.is_active === false)) {
      const admins = await client.query(
        `SELECT COUNT(DISTINCT m.id)::integer AS total
         FROM company_memberships m
         JOIN membership_roles mr ON mr.membership_id=m.id
         JOIN company_roles r ON r.id=mr.role_id
         WHERE m.company_id=$1 AND m.is_active=TRUE AND r.code='ADMIN'`,
        [req.user.company_id]
      );
      assert(admins.rows[0].total > 1, 'LAST_ADMIN_PROTECTED', 'O último administrador ativo não pode ser removido.', 409);
    }
    if (payload.name) {
      await client.query('UPDATE users SET name=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$1', [req.params.id, payload.name]);
    }
    if (payload.is_active !== undefined) {
      await client.query(
        'UPDATE company_memberships SET is_active=$3,updated_at=CURRENT_TIMESTAMP WHERE company_id=$1 AND user_id=$2',
        [req.user.company_id, req.params.id, payload.is_active]
      );
    }
    if (payload.access_level) {
      const role = (await client.query(
        `SELECT id FROM company_roles WHERE company_id=$1 AND code=$2 AND is_active=TRUE`,
        [req.user.company_id, payload.access_level]
      )).rows[0];
      assert(role, 'ROLE_INVALID', 'Papel inválido.');
      await client.query('DELETE FROM membership_roles WHERE membership_id=$1', [existing.membership_id]);
      await client.query(
        'INSERT INTO membership_roles (company_id,membership_id,role_id) VALUES ($1,$2,$3)',
        [req.user.company_id, existing.membership_id, role.id]
      );
    }
    if (payload.profiles) {
      const profiles = await client.query(
        `SELECT id,code FROM technical_profiles
         WHERE company_id=$1 AND code=ANY($2::text[]) AND is_active=TRUE`,
        [req.user.company_id, payload.profiles]
      );
      assert(profiles.rowCount === new Set(payload.profiles).size, 'PROFILE_INVALID', 'Um ou mais perfis são inválidos.');
      await client.query('DELETE FROM membership_technical_profiles WHERE membership_id=$1', [existing.membership_id]);
      for (const profile of profiles.rows) {
        await client.query(
          `INSERT INTO membership_technical_profiles (company_id,membership_id,profile_id)
           VALUES ($1,$2,$3)`,
          [req.user.company_id, existing.membership_id, profile.id]
        );
      }
    }
    if (payload.access_level || payload.is_active !== undefined) {
      await client.query(
        `UPDATE user_sessions SET revoked_at=CURRENT_TIMESTAMP,revoke_reason='membership_changed'
         WHERE company_id=$1 AND user_id=$2 AND revoked_at IS NULL`,
        [req.user.company_id, req.params.id]
      );
    }
    updated = (await client.query(
      `${membershipSelect}
       WHERE m.company_id=$1 AND m.user_id=$2`,
      [req.user.company_id, req.params.id]
    )).rows[0];
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  await recordAudit({
    req,
    operation: 'USER_MEMBERSHIP_UPDATED',
    entityType: 'USER',
    entityId: req.params.id,
    newValues: payload
  });
  res.json({ user: withAccessLevel(updated) });
}

async function updateOwnPassword(req, res) {
  const payload = z.object({
    current_password: z.string().min(1).max(1024),
    new_password: passwordSchema
  }).refine(
    (value) => value.current_password !== value.new_password,
    { path: ['new_password'], message: 'A nova senha deve ser diferente da senha atual.' }
  ).parse(req.body);
  const user = (await db.query(
    'SELECT id,password_hash FROM users WHERE id=$1 AND is_active=TRUE AND deleted_at IS NULL',
    [req.user.id]
  )).rows[0];
  assert(
    user && await argon2.verify(user.password_hash, payload.current_password).catch(() => false),
    'CURRENT_PASSWORD_INVALID',
    'A senha atual está incorreta.',
    400
  );
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE users SET password_hash=$2,must_change_password=FALSE,
       token_version=token_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
      [req.user.id, await argon2.hash(payload.new_password, { type: argon2.argon2id })]
    );
    await client.query(
      `UPDATE user_sessions SET revoked_at=CURRENT_TIMESTAMP,revoke_reason='password_changed'
       WHERE user_id=$1 AND revoked_at IS NULL`,
      [req.user.id]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  await recordAudit({ req, operation: 'PASSWORD_CHANGED', entityType: 'USER', entityId: req.user.id });
  res.clearCookie(SESSION_COOKIE, cookieOptions());
  res.clearCookie(CSRF_COOKIE, csrfCookieOptions());
  res.json({ message: 'Senha alterada. Entre novamente com a nova senha.', reauthenticate: true });
}

module.exports = { listUsers, listProfiles, createUser, updateUser, updateOwnPassword };
