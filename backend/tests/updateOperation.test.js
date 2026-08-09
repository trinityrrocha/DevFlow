const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createSignedRequest } = require('../src/services/updateOperationService');
const { csrfProtection } = require('../src/middleware/csrfMiddleware');
const { isMfaSetupAllowed } = require('../src/middleware/authMiddleware');

describe('fila privada de atualizacao', () => {
  it('permite solicitacao do Super Admin sem MFA e preserva CSRF global', () => {
    const routes = fs.readFileSync(path.resolve(__dirname, '../src/routes/updateOperationRoutes.js'), 'utf8');
    const app = fs.readFileSync(path.resolve(__dirname, '../src/app.js'), 'utf8');
    expect(routes).toContain('router.use(requireAuth, requireSuperAdmin)');
    expect(routes).toContain("router.post('/requests', controller.createRequest)");
    expect(routes).not.toContain('requireMfa');
    const updateRequest = { method: 'POST', originalUrl: '/api/operations/update/requests' };
    expect(isMfaSetupAllowed(updateRequest, { is_super_admin: true })).toBe(true);
    expect(isMfaSetupAllowed(updateRequest, { is_super_admin: false })).toBe(false);
    expect(isMfaSetupAllowed({ ...updateRequest, method: 'GET' }, { is_super_admin: true })).toBe(false);
    expect(app.indexOf('app.use(csrfProtection)')).toBeLessThan(app.indexOf("app.use('/api/operations/update'"));

    let csrfError;
    csrfProtection({
      method: 'POST',
      path: '/api/operations/update/requests',
      cookies: { devflow_session: 'valid-session-shape' },
      get: () => undefined
    }, {}, (error) => { csrfError = error; });
    expect(csrfError).toMatchObject({ code: 'CSRF_INVALID', status: 403 });
  });

  it('gera o contrato operacional solicitado e preserva a assinatura HMAC', () => {
    const request = createSignedRequest('Admin@Example.com');
    const { signature, ...unsigned } = request;
    const expected = crypto.createHmac('sha256', process.env.UPDATE_REQUEST_SECRET)
      .update(JSON.stringify(unsigned)).digest('hex');
    expect(request).toMatchObject({
      schemaVersion: 2,
      action: 'update',
      requester: 'admin@example.com',
      requestedBy: 'admin@example.com',
      operation: 'install-update'
    });
    expect(request.timestamp).toBe(request.requestedAt);
    expect(signature).toBe(expected);
  });

  it('mantem a gravacao atomica do arquivo fisico no controller', () => {
    const controller = fs.readFileSync(path.resolve(__dirname, '../src/controllers/updateOperationController.js'), 'utf8');
    expect(controller).toContain('fs.writeFileSync(temporary');
    expect(controller).toContain('fs.renameSync(temporary, destination)');
    expect(controller.indexOf('writeStatus(')).toBeLessThan(controller.indexOf('fs.renameSync'));
  });
});
