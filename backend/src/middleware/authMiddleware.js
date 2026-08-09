const { SESSION_COOKIE, validateSession } = require('../services/sessionService');
const { AppError } = require('../utils/errors');
const { hasPermission } = require('../services/tenantService');
const { requiresMfaSetup } = require('../services/mfaPolicyService');

async function requireAuth(req, _res, next) {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) throw new AppError('AUTH_REQUIRED', 'Faça login para continuar.', 401);
    const session = await validateSession(token);
    if (!session) throw new AppError('SESSION_INVALID', 'Sessão encerrada ou expirada.', 401);
    req.user = {
      id: session.user_id,
      session_id: session.session_id,
      name: session.name,
      email: session.email,
      phone: session.phone || null,
      is_super_admin: session.is_super_admin,
      must_change_password: session.must_change_password,
      mfa_enabled: session.mfa_enabled === true,
      mfa_enforcement_mode: session.mfa_enforcement_mode || 'optional',
      token_version: session.token_version,
      company_id: session.company_id,
      company_name: session.company_name,
      company_slug: session.company_slug,
      membership_id: session.membership_id,
      roles: session.roles || [],
      profiles: session.profiles || [],
      permissions: session.permissions || [],
      access_level: session.is_super_admin || session.roles?.includes('ADMIN') ? 'ADMIN' : 'USER'
    };
    req.user.mfa_setup_required = requiresMfaSetup(req.user, req.user.mfa_enforcement_mode);
    const passwordChangeAllowed = new Set([
      '/api/auth/me',
      '/api/auth/csrf',
      '/api/auth/logout',
      '/api/users/profile/password'
    ]);
    if (req.user.must_change_password && !passwordChangeAllowed.has(req.originalUrl.split('?')[0])) {
      throw new AppError(
        'PASSWORD_CHANGE_REQUIRED',
        'Troque a senha temporária antes de continuar.',
        403
      );
    }
    const mfaSetupAllowed = new Set([
      '/api/auth/me',
      '/api/auth/csrf',
      '/api/auth/logout',
      '/api/auth/mfa/status',
      '/api/auth/mfa/setup/start',
      '/api/auth/mfa/setup/confirm',
      '/api/users/profile/password'
    ]);
    if (req.user.mfa_setup_required && !req.user.must_change_password
      && !mfaSetupAllowed.has(req.originalUrl.split('?')[0])) {
      throw new AppError(
        'MFA_SETUP_REQUIRED',
        'Configure a autenticação em dois fatores antes de continuar.',
        403
      );
    }
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return next(new AppError('SESSION_INVALID', 'Sessão encerrada ou expirada.', 401));
    }
    return next(error);
  }
}

function requireAdmin(req, _res, next) {
  if (!hasPermission(req.user, 'users.manage')) {
    return next(new AppError('ADMIN_REQUIRED', 'Ação permitida apenas para administradores.', 403));
  }
  next();
}

function requireSuperAdmin(req, _res, next) {
  if (req.user?.is_super_admin !== true) {
    return next(new AppError('SUPER_ADMIN_REQUIRED', 'Acao permitida apenas para o Super Admin.', 403));
  }
  next();
}

function requireMfa(req, _res, next) {
  if (req.user?.mfa_enabled !== true) {
    return next(new AppError('MFA_REQUIRED', 'Configure e valide o MFA antes desta operacao sensivel.', 403));
  }
  next();
}

function requirePermission(code) {
  return (req, _res, next) => {
    if (!hasPermission(req.user, code)) {
      return next(new AppError('PERMISSION_DENIED', 'Você não possui permissão para esta operação.', 403));
    }
    next();
  };
}

module.exports = { requireAuth, requireAdmin, requireSuperAdmin, requireMfa, requirePermission };
