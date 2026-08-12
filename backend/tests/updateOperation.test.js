const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSignedRequest, getRequestStatus, getUpdateCapabilities, updaterQueueReady } = require('../src/services/updateOperationService');
const { persistUpdateRequest } = require('../src/controllers/updateOperationController');
const { csrfProtection } = require('../src/middleware/csrfMiddleware');
const { isMfaSetupAllowed } = require('../src/middleware/authMiddleware');

describe('fila privada de atualizacao', () => {
  it.each([
    ['ausente', { ok: false, status: 404, text: async () => '' }],
    ['malformado', { ok: true, status: 200, text: async () => '# sem secao da versao' }]
  ])('mantem update disponivel quando o changelog esta %s', async (_label, changelogResponse) => {
    const responses = [
      { ok: true, status: 200, text: async () => '0.6.29-alpha\n' },
      { ok: true, status: 200, text: async () => JSON.stringify({ sha: 'f'.repeat(40) }) },
      changelogResponse
    ];
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => responses.shift();
      const capabilities = await getUpdateCapabilities();
      expect(capabilities).toMatchObject({
        availableVersion: '0.6.29-alpha',
        availableCommit: 'f'.repeat(40),
        updateAvailable: true,
        changelog: ''
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

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
      schemaVersion: 3,
      action: 'operation',
      requester: 'admin@example.com',
      requestedBy: 'admin@example.com',
      operation: 'install-update'
    });
    expect(request.timestamp).toBe(request.requestedAt);
    expect(signature).toBe(expected);
  });

  it('mantem a gravacao atomica do arquivo fisico no controller', () => {
    const controller = fs.readFileSync(path.resolve(__dirname, '../src/controllers/updateOperationController.js'), 'utf8');
    const queueService = fs.readFileSync(path.resolve(__dirname, '../src/services/operationalRequestService.js'), 'utf8');
    const environment = fs.readFileSync(path.resolve(__dirname, '../src/config/env.js'), 'utf8');
    const compose = fs.readFileSync(path.resolve(__dirname, '../../docker-compose.yml'), 'utf8');
    expect(queueService).toContain('queueDirectory = env.DEVFLOW_UPDATER_QUEUE_DIR');
    expect(controller.indexOf('assertUpdaterQueueReady()')).toBeLessThan(controller.indexOf('createSignedRequest('));
    expect(queueService).toContain('filesystem.writeFileSync(temporary');
    expect(queueService).toContain('filesystem.renameSync(temporary, destination)');
    expect(controller).toContain("console.log('[UPDATER_QUEUE] Arquivo de solicitação gravado em:', destination)");
    expect(queueService).toContain('mode: 0o640');
    expect(queueService).not.toContain('statusWriter(request.id');
    expect(environment).toContain("DEVFLOW_UPDATER_QUEUE_DIR: z.string().refine(path.isAbsolute");
    expect(environment).toContain("DEVFLOW_UPDATER_STATUS_DIR: z.string().refine(path.isAbsolute");
    expect(environment).toContain("default('/var/lib/devflow/updater/requests')");
    expect(environment).not.toContain("default('./requests')");
    expect(environment).not.toContain("default('../requests')");
    expect(environment).toContain('path.dirname(value.DEVFLOW_UPDATER_QUEUE_DIR) !== path.dirname(value.DEVFLOW_UPDATER_STATUS_DIR)');
    expect(compose.match(/\$\{DEVFLOW_UPDATER_ROOT:-\/opt\/devflow\/updater\}:\/var\/lib\/devflow\/updater/g)).toHaveLength(2);
    expect(compose).toContain('DEVFLOW_UPDATER_QUEUE_DIR: /var/lib/devflow/updater/requests');
    expect(compose).toContain('DEVFLOW_UPDATER_ROOT: /var/lib/devflow/updater');
    expect(compose).not.toContain('devflow_updater_requests:');
  });

  it('grava e promove o JSON no diretorio absoluto compartilhado', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-updater-mounted-root-'));
    const queueDirectory = path.join(root, 'requests');
    const request = createSignedRequest('admin@example.com');
    try {
      fs.mkdirSync(queueDirectory, { recursive: true });
      const destination = persistUpdateRequest(request, {
        queueDirectory
      });
      expect(destination).toBe(path.join(queueDirectory, `${request.id}.json`));
      expect(JSON.parse(fs.readFileSync(destination, 'utf8'))).toMatchObject({ id: request.id, signature: request.signature });
      expect(fs.readdirSync(queueDirectory)).toEqual([`${request.id}.json`]);
      if (process.platform !== 'win32') expect(fs.statSync(destination).mode & 0o777).toBe(0o640);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('somente aceita a fila quando o heartbeat compartilhado esta recente', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-updater-heartbeat-'));
    const requestDirectory = path.join(root, 'requests');
    const marker = path.join(root, 'daemon.ready');
    fs.mkdirSync(requestDirectory, { recursive: true });
    try {
      expect(updaterQueueReady({ requestDirectory })).toBe(false);
      fs.writeFileSync(marker, '');
      const now = fs.statSync(marker).mtimeMs;
      expect(updaterQueueReady({ requestDirectory, now })).toBe(true);
      expect(updaterQueueReady({ requestDirectory, now: now + 16000 })).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
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
    const request = { schemaVersion: 3, id, action: 'operation', operation: 'install-update', requestedAt: '2026-08-09T22:00:00.000Z' };

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
      expect(getRequestStatus(id, options)).toMatchObject({ status: 'failed', state: 'failed' });
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
      })).toThrow(expect.objectContaining({ code: 'OPERATION_REQUEST_NOT_FOUND', status: 404 }));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
