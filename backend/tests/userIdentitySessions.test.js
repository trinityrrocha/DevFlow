const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { phoneSchema, assertCanManage } = require('../src/controllers/userController');

describe('identidade, administracao e sessoes', () => {
  const controller = readFileSync(resolve(__dirname, '../src/controllers/userController.js'), 'utf8');
  const sessions = readFileSync(resolve(__dirname, '../src/services/sessionService.js'), 'utf8');
  const migration = readFileSync(resolve(__dirname, '../../database/migrations/004_user_identity_sessions.sql'), 'utf8');

  it('normaliza o contrato de telefone para E.164 internacional', () => {
    expect(phoneSchema.safeParse('+5511999999999').success).toBe(true);
    expect(phoneSchema.safeParse('+442071838750').success).toBe(true);
    expect(phoneSchema.safeParse('(11) 99999-9999').success).toBe(false);
    expect(phoneSchema.safeParse('javascript:alert(1)').success).toBe(false);
  });

  it('impede Admin de administrar Super Admin', () => {
    expect(() => assertCanManage({ is_super_admin: false }, { is_super_admin: true })).toThrow(/Super Admin/);
    expect(() => assertCanManage({ is_super_admin: true }, { is_super_admin: true })).not.toThrow();
  });

  it('mantem e-mail atual ate confirmar token armazenado por hash', () => {
    expect(controller).toContain("crypto.randomBytes(32).toString('base64url')");
    expect(controller).toContain("crypto.createHash('sha256').update(token).digest('hex')");
    expect(controller).toContain('SET email=pending_email');
    expect(controller).not.toContain('email_verification_token=$');
  });

  it('revoga sessoes em redefinicao de senha e mudanca de identidade', () => {
    expect(controller).toContain("'password_changed'");
    expect(controller).toContain("'email_changed'");
    expect(sessions).toContain('revokeSessionById');
    expect(sessions).toContain('revokeUserSessions');
  });

  it('registra eventos sem armazenar token ou cookie', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS session_events');
    expect(migration).not.toMatch(/session_events[\s\S]*token_hash/);
    expect(sessions).toContain("'LOGIN'");
    expect(sessions).toContain("'EXPIRED'");
    expect(sessions).toContain("'REVOKED'");
  });
});
