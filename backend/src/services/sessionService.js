const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const env = require('../config/env');
const { loadMembershipContext } = require('./tenantService');

const SESSION_COOKIE = 'devflow_session';
const absoluteMs = env.SESSION_ABSOLUTE_HOURS * 60 * 60 * 1000;
const idleMs = env.SESSION_IDLE_MINUTES * 60 * 1000;

const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');

const cookieOptions = () => ({
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/',
  maxAge: absoluteMs
});

async function createSession(req, user) {
  const sessionId = crypto.randomUUID();
  const now = Date.now();
  const token = jwt.sign(
    {
      sub: user.id,
      sid: sessionId,
      cid: user.company_id,
      mid: user.membership_id,
      ver: user.token_version
    },
    env.JWT_SECRET,
    { expiresIn: Math.floor(absoluteMs / 1000), audience: 'devflow-web' }
  );
  await db.query(
    `INSERT INTO user_sessions (
       id,user_id,company_id,membership_id,token_version,token_hash,
       ip_address,user_agent,expires_at,idle_expires_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      sessionId,
      user.id,
      user.company_id,
      user.membership_id,
      user.token_version,
      tokenHash(token),
      req.ip || null,
      String(req.get?.('user-agent') || '').slice(0, 1000) || null,
      new Date(now + absoluteMs),
      new Date(now + idleMs)
    ]
  );
  return token;
}

async function validateSession(token) {
  const decoded = jwt.verify(token, env.JWT_SECRET, { audience: 'devflow-web' });
  const result = await db.query(
    `SELECT s.id AS session_id,s.user_id,s.company_id,s.membership_id,
            s.token_version AS session_version,
            s.expires_at, s.idle_expires_at, s.last_seen_at,
            u.name,u.email,u.is_super_admin,u.is_active,
            u.must_change_password,u.token_version,
            COALESCE(mfa.enabled,FALSE) AS mfa_enabled,
            COALESCE(policy.enforcement_mode,'optional') AS mfa_enforcement_mode
     FROM user_sessions s
     JOIN users u ON u.id = s.user_id AND u.deleted_at IS NULL
     JOIN company_memberships m ON m.id=s.membership_id AND m.company_id=s.company_id
       AND m.user_id=s.user_id AND m.is_active=TRUE
     JOIN companies c ON c.id=s.company_id AND c.is_active=TRUE AND c.deleted_at IS NULL
     LEFT JOIN user_mfa_settings mfa ON mfa.user_id=u.id
     LEFT JOIN mfa_policy_settings policy ON policy.singleton=TRUE
     WHERE s.id = $1 AND s.user_id = $2 AND s.token_hash = $3 AND s.revoked_at IS NULL
       AND s.company_id=$4 AND s.membership_id=$5`,
    [decoded.sid, decoded.sub, tokenHash(token), decoded.cid, decoded.mid]
  );
  const session = result.rows[0];
  const now = new Date();
  if (
    !session
    || !session.is_active
    || session.token_version !== decoded.ver
    || session.session_version !== decoded.ver
    || new Date(session.expires_at) <= now
    || new Date(session.idle_expires_at) <= now
  ) return null;

  if (now.getTime() - new Date(session.last_seen_at).getTime() > 5 * 60 * 1000) {
    await db.query(
      `UPDATE user_sessions
       SET last_seen_at = CURRENT_TIMESTAMP,
           idle_expires_at = CURRENT_TIMESTAMP + ($1 * INTERVAL '1 millisecond')
       WHERE id = $2`,
      [idleMs, session.session_id]
    );
  }
  const membership = await loadMembershipContext(session.user_id, session.company_id);
  if (!membership || membership.membership_id !== session.membership_id) return null;
  return { ...session, ...membership };
}

async function revokeSession(token, reason = 'logout') {
  if (!token) return;
  const decoded = jwt.decode(token);
  if (!decoded?.sid) return;
  await db.query(
    `UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP, revoke_reason = $1
     WHERE id = $2 AND token_hash = $3 AND revoked_at IS NULL`,
    [reason, decoded.sid, tokenHash(token)]
  );
}

module.exports = {
  SESSION_COOKIE,
  cookieOptions,
  createSession,
  validateSession,
  revokeSession
};
