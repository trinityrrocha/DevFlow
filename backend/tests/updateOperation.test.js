const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSignedRequest, getRequestStatus } = require('../src/services/updateOperationService');
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

  it('rastreia o request nos quatro diretorios do ciclo de vida', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-update-lifecycle-'));
    const id = 'c10aacfb-81ba-40da-93aa-9d2ff1b629a0';
    const statusDirectory = path.join(root, 'status');
    const directories = [
      { name: 'requests', directory: path.join(root, 'requests'), status: 'pending' },
      { name: 'processing', directory: path.join(root, 'processing'), status: 'processing' },
      { name: 'processed', directory: path.join(root, 'processed'), status: 'completed' },
      { name: 'failed', directory: path.join(root, 'failed'), status: 'failed' }
    ];
    for (const entry of directories) fs.mkdirSync(entry.directory, { recursive: true });
    fs.mkdirSync(statusDirectory, { recursive: true });
    const options = { directories, statusDirectory };
    const request = { schemaVersion: 2, id, requestedAt: '2026-08-09T22:00:00.000Z' };

    try {
      fs.writeFileSync(path.join(directories[0].directory, `${id}.json`), JSON.stringify(request));
      expect(getRequestStatus(id, options)).toMatchObject({ status: 'pending', state: 'pending' });

      fs.renameSync(
        path.join(directories[0].directory, `${id}.json`),
        path.join(directories[1].directory, `${id}.json`)
      );
      fs.writeFileSync(path.join(statusDirectory, `${id}.json`), JSON.stringify({
        schemaVersion: 1,
        id,
        state: 'migrations',
        message: 'Migrations em processamento.',
        requestedAt: request.requestedAt,
        updatedAt: '2026-08-09T22:01:00.000Z'
      }));
      expect(getRequestStatus(id, options)).toMatchObject({
        status: 'processing',
        state: 'migrations',
        message: 'Migrations em processamento.'
      });

      fs.renameSync(
        path.join(directories[1].directory, `${id}.json`),
        path.join(directories[2].directory, `${id}.json`)
      );
      expect(getRequestStatus(id, options)).toMatchObject({ status: 'completed', state: 'completed' });

      fs.rmSync(path.join(directories[2].directory, `${id}.json`));
      fs.writeFileSync(path.join(directories[3].directory, `${id}.json`), JSON.stringify({
        ...request,
        error: 'Rollback automatico concluido apos falha no health.'
      }));
      expect(getRequestStatus(id, options)).toMatchObject({
        status: 'failed',
        state: 'failed',
        error: 'Rollback automatico concluido apos falha no health.'
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('retorna 404 somente quando o id nao existe em nenhum diretorio', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-update-missing-'));
    const directories = ['requests', 'processing', 'processed', 'failed'].map((name) => ({
      name,
      directory: path.join(root, name),
      status: name === 'requests' ? 'pending' : name === 'processing' ? 'processing' : name === 'processed' ? 'completed' : 'failed'
    }));
    for (const entry of directories) fs.mkdirSync(entry.directory, { recursive: true });
    try {
      expect(() => getRequestStatus('c10aacfb-81ba-40da-93aa-9d2ff1b629a0', {
        directories,
        statusDirectory: path.join(root, 'status')
      })).toThrow(expect.objectContaining({ code: 'UPDATE_REQUEST_NOT_FOUND', status: 404 }));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
