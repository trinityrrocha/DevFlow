const crypto = require('crypto');
const env = require('../config/env');

const CSRF_COOKIE = 'devflow_csrf';
const CSRF_HEADER = 'x-csrf-token';
const csrfKey = crypto.createHash('sha256').update(`${env.JWT_SECRET}:csrf:v1`).digest();

const sessionBinding = (sessionToken) => crypto.createHash('sha256')
  .update(String(sessionToken || ''))
  .digest('base64url');
const sign = (random, sessionToken) => crypto.createHmac('sha256', csrfKey)
  .update(`${sessionBinding(sessionToken)}.${random}`)
  .digest('base64url');

function createToken(sessionToken) {
  if (!sessionToken) throw new Error('Sessao obrigatoria para emitir token CSRF.');
  const random = crypto.randomBytes(32).toString('base64url');
  return `${random}.${sign(random, sessionToken)}`;
}

function verifyToken(value, sessionToken) {
  if (!sessionToken) return false;
  const [random, signature, extra] = String(value || '').split('.');
  if (!random || !signature || extra) return false;
  const expected = Buffer.from(sign(random, sessionToken));
  const received = Buffer.from(signature);
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

const csrfCookieOptions = () => ({
  httpOnly: false,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/'
});

function issueCsrf(res, sessionToken) {
  const token = createToken(sessionToken);
  res.cookie(CSRF_COOKIE, token, csrfCookieOptions());
  return token;
}

module.exports = {
  CSRF_COOKIE,
  CSRF_HEADER,
  csrfCookieOptions,
  createToken,
  issueCsrf,
  verifyToken
};
