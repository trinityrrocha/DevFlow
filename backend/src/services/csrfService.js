const crypto = require('crypto');
const env = require('../config/env');

const CSRF_COOKIE = 'devflow_csrf';
const CSRF_HEADER = 'x-csrf-token';
const csrfKey = crypto.createHash('sha256').update(`${env.JWT_SECRET}:csrf:v1`).digest();

const sign = (value) => crypto.createHmac('sha256', csrfKey).update(value).digest('base64url');

function createToken() {
  const random = crypto.randomBytes(32).toString('base64url');
  return `${random}.${sign(random)}`;
}

function verifyToken(value) {
  const [random, signature, extra] = String(value || '').split('.');
  if (!random || !signature || extra) return false;
  const expected = Buffer.from(sign(random));
  const received = Buffer.from(signature);
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

const csrfCookieOptions = () => ({
  httpOnly: false,
  secure: env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/'
});

function issueCsrf(res) {
  const token = createToken();
  res.cookie(CSRF_COOKIE, token, csrfCookieOptions());
  return token;
}

module.exports = { CSRF_COOKIE, CSRF_HEADER, csrfCookieOptions, issueCsrf, verifyToken };
