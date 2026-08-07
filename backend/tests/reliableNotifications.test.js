/* global afterEach, vi */
const fs = require('fs');
const path = require('path');
const {
  encryptPayload, decryptPayload, safeErrorCode, backoffSeconds, smtpConfigured, processJob
} = require('../src/services/emailOutboxService');
const db = require('../src/config/database');
const { renderTemplate } = require('../src/services/emailTemplateService');
const { exemptPaths } = require('../src/middleware/csrfMiddleware');

describe('outbox de e-mail confiavel', () => {
  afterEach(() => vi.restoreAllMocks());
  it('cifra o payload sensivel com autenticacao e o recupera somente no worker', () => {
    const source = { name: 'Trinity', token: 'token-super-secreto' };
    const encrypted = encryptPayload(source);
    expect(encrypted).not.toContain(source.token);
    expect(decryptPayload(encrypted)).toEqual(source);
  });

  it('limita retry exponencial e sanitiza erros sem mensagem sensivel', () => {
    expect(backoffSeconds(1)).toBe(30);
    expect(backoffSeconds(20)).toBe(3600);
    expect(safeErrorCode({ code: 'EAUTH' })).toBe('EAUTH');
    expect(safeErrorCode({ code: 'EAUTH:password=secret' })).toBe('DELIVERY_ERROR');
  });

  it('nao considera SMTP habilitado somente pela presenca de host', () => {
    expect(smtpConfigured()).toBe(false);
  });

  it('renderiza links controlados para recuperacao e tarefas', () => {
    expect(renderTemplate('PASSWORD_RESET', { name: 'Pessoa', token: 'abc/123' }).body).toContain('reset_token=abc%2F123');
    expect(renderTemplate('TASK_EVENT', { name: 'Pessoa', title: 'Movimento', body: 'Etapa', task_id: 'task-id' }).body).toContain('/task/task-id');
    expect(() => renderTemplate('UNKNOWN', {})).toThrow('EMAIL_TEMPLATE_INVALID');
  });

  it('agenda retry sanitizado quando o SMTP simulado fica indisponivel', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    vi.spyOn(db, 'transaction').mockImplementation(async (callback) => callback({ query }));
    const mailer = { sendMail: vi.fn().mockRejectedValue(Object.assign(new Error('segredo nao deve persistir'), { code: 'ETIMEDOUT' })) };
    const result = await processJob({
      id: '11111111-1111-4111-8111-111111111111', company_id: null, notification_id: null,
      template_code: 'SMTP_TEST', recipient_email: 'test@example.com', attempts: 0,
      encrypted_payload: encryptPayload({ name: 'Teste' })
    }, mailer);
    expect(result.status).toBe('retry');
    expect(JSON.stringify(query.mock.calls)).not.toContain('segredo nao deve persistir');
    expect(JSON.stringify(query.mock.calls)).toContain('ETIMEDOUT');
  });

  it('marca entrega simulada e elimina o payload cifrado', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    vi.spyOn(db, 'transaction').mockImplementation(async (callback) => callback({ query }));
    const mailer = { sendMail: vi.fn().mockResolvedValue({ messageId: 'simulated' }) };
    const result = await processJob({
      id: '22222222-2222-4222-8222-222222222222', company_id: null, notification_id: null,
      template_code: 'SMTP_TEST', recipient_email: 'test@example.com', attempts: 0,
      encrypted_payload: encryptPayload({ name: 'Teste' })
    }, mailer);
    expect(result.status).toBe('sent');
    expect(mailer.sendMail).toHaveBeenCalledOnce();
    expect(query.mock.calls[0][0]).toContain("encrypted_payload=''");
  });
});

describe('recuperacao e persistencia', () => {
  it('isenta do CSRF somente endpoints publicos de recuperacao', () => {
    expect(exemptPaths.has('/api/auth/password/forgot')).toBe(true);
    expect(exemptPaths.has('/api/auth/password/reset')).toBe(true);
    expect(exemptPaths.has('/api/users/profile/password')).toBe(false);
  });

  it('define hash, uso unico, preferencias e claim concorrente na migration', () => {
    const sql = fs.readFileSync(path.resolve(__dirname, '../../database/migrations/006_reliable_notifications.sql'), 'utf8');
    expect(sql).toContain('token_hash CHAR(64) NOT NULL UNIQUE');
    expect(sql).toContain("CHECK (security = TRUE)");
    expect(sql).toContain('idempotency_key VARCHAR(240) NOT NULL UNIQUE');
    const service = fs.readFileSync(path.resolve(__dirname, '../src/services/emailOutboxService.js'), 'utf8');
    expect(service).toContain('FOR UPDATE SKIP LOCKED');
    expect(service).toContain("encrypted_payload=''");
    expect(service).toContain("'EMAIL_FAILED'");
  });
});
