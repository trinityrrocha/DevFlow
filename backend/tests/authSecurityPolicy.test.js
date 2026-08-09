const {
  MFA_ENFORCEMENT_MODES,
  validateMfaEnforcementMode,
  isMfaRequiredForUser,
  requiresMfaSetup
} = require('../src/services/mfaPolicyService');
const {
  CSRF_COOKIE,
  CSRF_HEADER,
  createToken,
  csrfCookieOptions,
  verifyToken
} = require('../src/services/csrfService');
const { csrfProtection } = require('../src/middleware/csrfMiddleware');
const { requireMfa } = require('../src/middleware/authMiddleware');

describe('politica persistente de MFA', () => {
  it('aceita somente optional, admins e all', () => {
    expect(MFA_ENFORCEMENT_MODES).toEqual(['optional', 'admins', 'all']);
    expect(() => validateMfaEnforcementMode('unknown')).toThrow('Politica de MFA invalida.');
  });

  it('optional nao bloqueia usuario sem MFA', () => {
    expect(requiresMfaSetup({ mfa_enabled: false, roles: [] }, 'optional')).toBe(false);
  });

  it('MFA ja habilitado nunca exige novo setup', () => {
    expect(requiresMfaSetup({ mfa_enabled: true, is_super_admin: true }, 'all')).toBe(false);
  });

  it('admins exige Super Admin e papel ADMIN', () => {
    expect(requiresMfaSetup({ mfa_enabled: false, is_super_admin: true }, 'admins')).toBe(true);
    expect(requiresMfaSetup({ mfa_enabled: false, roles: ['ADMIN'] }, 'admins')).toBe(true);
    expect(requiresMfaSetup({ mfa_enabled: false, roles: ['USER'] }, 'admins')).toBe(false);
  });

  it('all exige todos os usuarios sem MFA', () => {
    expect(requiresMfaSetup({ mfa_enabled: false, roles: ['USER'] }, 'all')).toBe(true);
    expect(isMfaRequiredForUser({ mfa_enabled: true, roles: ['USER'] }, 'all')).toBe(true);
  });

  it('protege operacoes sensiveis mesmo quando a politica global e opcional', () => {
    let denied;
    requireMfa({ user: { mfa_enabled: false } }, {}, (error) => { denied = error; });
    expect(denied).toMatchObject({ code: 'MFA_REQUIRED', status: 403 });
    let allowed = false;
    requireMfa({ user: { mfa_enabled: true } }, {}, () => { allowed = true; });
    expect(allowed).toBe(true);
  });
});

describe('contrato CSRF vinculado a sessao', () => {
  const session = 'session-token-current';

  it('gera token aleatorio valido somente para a sessao atual', () => {
    const first = createToken(session);
    const second = createToken(session);
    expect(first).not.toBe(second);
    expect(verifyToken(first, session)).toBe(true);
    expect(verifyToken(first, 'different-session')).toBe(false);
  });

  it('usa cookie legivel, SameSite Lax e path raiz', () => {
    expect(CSRF_COOKIE).toBe('devflow_csrf');
    expect(CSRF_HEADER).toBe('x-csrf-token');
    expect(csrfCookieOptions()).toMatchObject({ httpOnly: false, sameSite: 'lax', path: '/' });
  });

  it('rejeita POST sem token com CSRF_INVALID', () => {
    let result;
    csrfProtection({
      method: 'POST', path: '/api/auth/mfa/setup/start', cookies: { devflow_session: session },
      get: () => undefined
    }, {}, (error) => { result = error; });
    expect(result).toMatchObject({ code: 'CSRF_INVALID', status: 403 });
  });

  it('rejeita token invalido e aceita cookie/header validos', () => {
    const valid = createToken(session);
    const invoke = (cookie, header) => {
      let result = 'not-called';
      csrfProtection({
        method: 'POST', path: '/api/auth/mfa/setup/start',
        cookies: { devflow_session: session, devflow_csrf: cookie },
        get: () => header
      }, {}, (error) => { result = error; });
      return result;
    };
    expect(invoke('invalid.invalid', 'invalid.invalid')).toMatchObject({ code: 'CSRF_INVALID' });
    expect(invoke(valid, valid)).toBeUndefined();
  });

  it('GET e endpoint exato do segundo fator nao exigem CSRF', () => {
    for (const request of [
      { method: 'GET', path: '/api/auth/mfa/setup/start' },
      { method: 'POST', path: '/api/auth/mfa' }
    ]) {
      let result = 'not-called';
      csrfProtection({ ...request, cookies: { devflow_session: session }, get: () => undefined }, {}, (error) => { result = error; });
      expect(result).toBeUndefined();
    }
  });
});
