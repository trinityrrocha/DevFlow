import { describe, expect, it } from 'vitest';
import api, { isCsrfExempt, normalizeApiPath, responseErrorCode } from './api';

describe('cliente HTTP centralizado', () => {
  it('envia cookies em todas as requisicoes', () => {
    expect(api.defaults.withCredentials).toBe(true);
  });

  it('isenta somente autenticacao publica e recuperacao de senha exatas', () => {
    expect(isCsrfExempt('/auth/login')).toBe(true);
    expect(isCsrfExempt('/auth/bootstrap')).toBe(true);
    expect(isCsrfExempt('/auth/mfa')).toBe(true);
    expect(isCsrfExempt('/auth/password/forgot')).toBe(true);
    expect(isCsrfExempt('/auth/password/reset')).toBe(true);
    expect(isCsrfExempt('/auth/mfa/setup/start')).toBe(false);
  });

  it('normaliza prefixo API e remove query string', () => {
    expect(normalizeApiPath('/api/auth/mfa?step=1')).toBe('/auth/mfa');
  });

  it('distingue CSRF_INVALID de FORBIDDEN', () => {
    expect(responseErrorCode({ response: { data: { error: { code: 'CSRF_INVALID' } } } })).toBe('CSRF_INVALID');
    expect(responseErrorCode({ response: { data: { error: { code: 'FORBIDDEN' } } } })).toBe('FORBIDDEN');
  });
});
