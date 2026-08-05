const crypto = require('crypto');
const { CSRF_COOKIE, CSRF_HEADER, verifyToken } = require('../services/csrfService');
const { AppError } = require('../utils/errors');

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
const exemptPaths = new Set(['/api/auth/login', '/api/auth/bootstrap', '/api/auth/mfa']);

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function csrfProtection(req, _res, next) {
  const sessionToken = req.cookies?.devflow_session;
  if (safeMethods.has(req.method) || exemptPaths.has(req.path) || !sessionToken) return next();
  const cookie = req.cookies?.[CSRF_COOKIE];
  const header = req.get(CSRF_HEADER);
  if (cookie && header && safeEqual(cookie, header) && verifyToken(cookie, sessionToken)) return next();
  return next(new AppError('CSRF_INVALID', 'Token CSRF inválido. Recarregue a página.', 403));
}

module.exports = { exemptPaths, safeMethods, csrfProtection };
