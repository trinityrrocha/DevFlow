const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const { readCatalog, assertBackupExists, listBackups, resolveBackupDownload } = require('../src/services/backupOperationService');
const {
  createSignedRequest, backupIsInActiveOperation, getRequestStatus, operationMessage
} = require('../src/services/operationalRequestService');
const { createDownloadHandler, reconcileTerminalAudits } = require('../src/controllers/backupOperationController');
const { requireAuth, requireSuperAdmin } = require('../src/middleware/authMiddleware');
const { errorHandler } = require('../src/middleware/errorMiddleware');
const { AppError } = require('../src/utils/errors');

const binaryParser = (response, callback) => {
  const chunks = [];
  response.on('data', (chunk) => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
};

const downloadApp = (handler) => {
  const app = express();
  app.get('/api/operations/backups/:id/download', handler);
  app.use(errorHandler);
  return app;
};

describe('gestao administrativa de backups', () => {
  const filename = 'devflow-20260811T220000Z-deadbeef.dfbackup';
  const id = crypto.createHash('sha256').update(filename).digest('hex').slice(0, 32);
  const makeCatalog = (root, values = {}) => {
    const catalogFile = path.join(root, 'backup-catalog.json');
    fs.writeFileSync(catalogFile, JSON.stringify({ schemaVersion: 1, backups: [{
      id, filename, createdAt: '2026-08-11T22:00:00.000Z', sizeBytes: 1024,
      status: 'verified', applicationVersion: '0.6.27-alpha', applicationCommit: 'a'.repeat(40),
      databaseMigration: '014_frontend_approval_stage.sql', format: 'devflow-backup-v1',
      verifiedAt: '2026-08-11T22:01:00.000Z',
      ...values
    }] }));
    return catalogFile;
  };

  it('lista somente o catalogo sanitizado e expoe retencao', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-backup-list-'));
    try {
      const catalogFile = makeCatalog(root, { internalOnly: 'nao-expor' });
      const sanitized = readCatalog({ catalogFile });
      expect(sanitized).toHaveLength(1);
      expect(sanitized[0]).not.toHaveProperty('internalOnly');
      expect(listBackups({ catalogFile })).toMatchObject({ retentionDays: 30, backups: [{ id, filename }] });
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('aceita explicitamente o estado de dominio available no catalogo', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-backup-available-'));
    try {
      const catalogFile = makeCatalog(root, {
        status: 'available', applicationVersion: null, applicationCommit: null,
        databaseMigration: null, format: null, verifiedAt: null
      });
      expect(readCatalog({ catalogFile })).toMatchObject([{ id, status: 'available' }]);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('recusa id invalido, traversal e item ausente', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-backup-invalid-'));
    try {
      const catalogFile = makeCatalog(root);
      expect(() => assertBackupExists('../etc/passwd', { catalogFile })).toThrow(expect.objectContaining({ code: 'BACKUP_ID_INVALID' }));
      expect(() => assertBackupExists('0'.repeat(32), { catalogFile })).toThrow(expect.objectContaining({ code: 'BACKUP_NOT_FOUND' }));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('recusa catalogo symlink e contrato adulterado', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-backup-symlink-'));
    try {
      const target = makeCatalog(root);
      const link = path.join(root, 'link.json');
      try { fs.symlinkSync(target, link); expect(() => readCatalog({ catalogFile: link })).toThrow(expect.objectContaining({ code: 'BACKUP_CATALOG_INVALID' })); }
      catch (error) { if (error.code !== 'EPERM') throw error; }
      fs.writeFileSync(target, JSON.stringify({ schemaVersion: 1, backups: [{ id, filename: '../../secret', sizeBytes: 1, createdAt: 'now', status: 'available' }] }));
      expect(() => readCatalog({ catalogFile: target })).toThrow(expect.objectContaining({ code: 'BACKUP_CATALOG_INVALID' }));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('resolve download somente dentro da raiz canonica e preserva o arquivo correto', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-backup-download-'));
    try {
      const catalogFile = makeCatalog(root);
      const backupRoot = path.join(root, 'backups');
      fs.mkdirSync(backupRoot);
      const backupFile = path.join(backupRoot, filename);
      fs.writeFileSync(backupFile, Buffer.alloc(1024, 7));
      expect(resolveBackupDownload(id, { catalogFile, backupRoot })).toMatchObject({
        backup: { id, filename }, file: fs.realpathSync(backupFile), size: 1024
      });
      expect(() => resolveBackupDownload('../etc/passwd', { catalogFile, backupRoot }))
        .toThrow(expect.objectContaining({ code: 'BACKUP_ID_INVALID', status: 400 }));
      expect(() => resolveBackupDownload('0'.repeat(32), { catalogFile, backupRoot }))
        .toThrow(expect.objectContaining({ code: 'BACKUP_NOT_FOUND', status: 404 }));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('transmite os bytes corretos com headers de attachment e auditoria UUID-safe', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-backup-stream-'));
    const bytes = Buffer.from('devflow-backup-encrypted-fixture');
    const backupFile = path.join(root, filename);
    fs.writeFileSync(backupFile, bytes);
    const audits = [];
    try {
      const handler = createDownloadHandler({
        resolver: () => ({ backup: { id, filename }, file: backupFile, size: bytes.length }),
        auditRecorder: async (entry) => audits.push(entry)
      });
      const response = await request(downloadApp(handler))
        .get(`/api/operations/backups/${id}/download`)
        .buffer(true)
        .parse(binaryParser)
        .expect(200);
      expect(response.headers['content-type']).toMatch(/^application\/octet-stream/);
      expect(response.headers['content-length']).toBe(String(bytes.length));
      expect(response.headers['content-disposition']).toContain(`attachment; filename="${filename}"`);
      expect(response.body).toEqual(bytes);
      expect(audits).toMatchObject([{ operation: 'BACKUP_DOWNLOADED', entityId: null, newValues: { backupId: id, filename }, strict: true }]);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it.each([
    ['backup ausente', new AppError('BACKUP_NOT_FOUND', 'Backup nao encontrado.', 404), 404],
    ['path traversal', new AppError('BACKUP_ID_INVALID', 'Identificador de backup invalido.', 400), 400],
    ['erro interno real', new Error('disk-failure'), 500]
  ])('padroniza resposta para %s', async (_scenario, failure, expectedStatus) => {
    const handler = createDownloadHandler({ resolver: () => { throw failure; } });
    const response = await request(downloadApp(handler)).get(`/api/operations/backups/${id}/download`).expect(expectedStatus);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(response.body).toHaveProperty('error');
  });

  it('nega download administrativo para usuario sem privilegio de Super Admin', () => {
    let denied;
    requireSuperAdmin({ user: { is_super_admin: false } }, {}, (error) => { denied = error; });
    expect(denied).toMatchObject({ code: 'SUPER_ADMIN_REQUIRED', status: 403 });
  });

  it('permite o middleware somente para Super Admin e exige sessao na rota real', async () => {
    let allowed = false;
    requireSuperAdmin({ user: { is_super_admin: true } }, {}, (error) => { expect(error).toBeUndefined(); allowed = true; });
    expect(allowed).toBe(true);
    const protectedApp = express();
    protectedApp.get('/api/operations/backups/:id/download', requireAuth, requireSuperAdmin, (_req, res) => res.sendStatus(204));
    protectedApp.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: { code: error.code, message: error.message } }));
    const response = await request(protectedApp).get(`/api/operations/backups/${id}/download`).expect(401);
    expect(response.body).toMatchObject({ error: { code: 'AUTH_REQUIRED' } });
  });

  it('recusa symlink e arquivo cujo tamanho diverge do catalogo', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-backup-download-unsafe-'));
    try {
      const catalogFile = makeCatalog(root);
      const backupRoot = path.join(root, 'backups');
      fs.mkdirSync(backupRoot);
      const backupFile = path.join(backupRoot, filename);
      fs.writeFileSync(backupFile, 'adulterado');
      expect(() => resolveBackupDownload(id, { catalogFile, backupRoot }))
        .toThrow(expect.objectContaining({ code: 'BACKUP_FILE_UNAVAILABLE', status: 404 }));
      fs.rmSync(backupFile);
      const outside = path.join(root, 'outside.dfbackup');
      fs.writeFileSync(outside, Buffer.alloc(1024));
      try {
        fs.symlinkSync(outside, backupFile);
        expect(() => resolveBackupDownload(id, { catalogFile, backupRoot }))
          .toThrow(expect.objectContaining({ code: 'BACKUP_FILE_UNAVAILABLE' }));
      } catch (error) { if (error.code !== 'EPERM') throw error; }
      fs.rmSync(backupFile, { force: true });
      const inside = path.join(backupRoot, 'other.dfbackup');
      fs.writeFileSync(inside, Buffer.alloc(1024));
      try {
        fs.symlinkSync(inside, backupFile);
        expect(() => resolveBackupDownload(id, { catalogFile, backupRoot }))
          .toThrow(expect.objectContaining({ code: 'BACKUP_FILE_UNAVAILABLE' }));
      } catch (error) { if (error.code !== 'EPERM') throw error; }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('retorna 404 quando o arquivo catalogado nao existe fisicamente', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-backup-missing-file-'));
    try {
      const catalogFile = makeCatalog(root);
      const backupRoot = path.join(root, 'backups');
      fs.mkdirSync(backupRoot);
      expect(() => resolveBackupDownload(id, { catalogFile, backupRoot }))
        .toThrow(expect.objectContaining({ code: 'BACKUP_FILE_UNAVAILABLE', status: 404 }));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('rejeita estado de backup fora do contrato sem confundir com estado operacional', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-backup-state-'));
    try {
      const catalogFile = makeCatalog(root, { status: 'completed' });
      expect(() => readCatalog({ catalogFile })).toThrow(expect.objectContaining({ code: 'BACKUP_CATALOG_INVALID' }));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it.each(['create-backup', 'verify-backup', 'restore-backup', 'delete-backup'])('assina operacao allowlisted %s sem comando livre', (operation) => {
    const backupId = operation === 'create-backup' ? null : id;
    const request = createSignedRequest({ actorEmail: 'admin@example.com', operation, backupId });
    const { signature, ...unsigned } = request;
    expect(signature).toBe(crypto.createHmac('sha256', process.env.UPDATE_REQUEST_SECRET).update(JSON.stringify(unsigned)).digest('hex'));
    expect(request).not.toHaveProperty('command');
    expect(request).not.toHaveProperty('args');
  });

  it('detecta backup em operacao ativa para serializacao', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-backup-active-'));
    try {
      const requests = path.join(root, 'requests');
      fs.mkdirSync(requests);
      fs.writeFileSync(path.join(requests, 'c10aacfb-81ba-40da-93aa-9d2ff1b629a0.json'), JSON.stringify({ id: 'c10aacfb-81ba-40da-93aa-9d2ff1b629a0', operation: 'verify-backup', backupId: id }));
      expect(backupIsInActiveOperation(id, { queueDirectory: requests })).toBe(true);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it.each([
    ['create-backup', 'Backup criado com sucesso.'],
    ['delete-backup', 'Backup excluido com sucesso.'],
    ['restore-backup', 'Backup restaurado com sucesso.'],
    ['install-update', 'Atualizacao concluida com sucesso.']
  ])('retorna mensagem terminal especifica para %s', (operation, message) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-operation-message-'));
    const requestId = crypto.randomUUID();
    const directories = ['requests', 'processing', 'processed', 'failed'].map((name) => ({
      directory: path.join(root, name),
      status: name === 'requests' ? 'pending' : name === 'processing' ? 'processing' : name === 'processed' ? 'completed' : 'failed'
    }));
    for (const entry of directories) fs.mkdirSync(entry.directory, { recursive: true });
    try {
      fs.writeFileSync(path.join(directories[2].directory, `${requestId}.json`), JSON.stringify({
        schemaVersion: 3, id: requestId, action: 'operation', operation,
        backupId: ['install-update', 'create-backup'].includes(operation) ? null : id,
        requestedAt: '2026-08-11T22:00:00.000Z'
      }));
      expect(getRequestStatus(requestId, { directories, statusDirectory: path.join(root, 'status') }))
        .toMatchObject({ operation, status: 'completed', state: 'completed', message });
      expect(operationMessage(operation, 'completed')).toBe(message);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('nao deixa pedido historico invalido derrubar a listagem de catalogo valido', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-backup-reconcile-'));
    const directories = ['requests', 'processing', 'processed', 'failed'].map((name) => ({
      directory: path.join(root, name),
      status: name === 'requests' ? 'pending' : name === 'processing' ? 'processing' : name === 'processed' ? 'completed' : 'failed'
    }));
    for (const entry of directories) fs.mkdirSync(entry.directory, { recursive: true });
    const legacyId = crypto.randomUUID();
    const deleteId = crypto.randomUUID();
    const audits = [];
    const logged = [];
    try {
      fs.writeFileSync(path.join(directories[3].directory, `${legacyId}.json`), JSON.stringify({ schemaVersion: 1, id: legacyId, action: 'legacy' }));
      fs.writeFileSync(path.join(directories[2].directory, `${deleteId}.json`), JSON.stringify({
        schemaVersion: 3, id: deleteId, action: 'operation', operation: 'delete-backup',
        backupId: id, requestedAt: '2026-08-11T22:00:00.000Z'
      }));
      await reconcileTerminalAudits({}, {
        directories, statusDirectory: path.join(root, 'status'),
        auditRecorder: async (_req, state) => audits.push(state),
        errorLogger: (_context, error) => logged.push(error.code)
      });
      const catalogFile = makeCatalog(root, {
        status: 'available', applicationVersion: null, applicationCommit: null,
        databaseMigration: null, format: null, verifiedAt: null
      });
      expect(listBackups({ catalogFile })).toMatchObject({ backups: [{ status: 'available' }] });
      expect(audits).toMatchObject([{ id: deleteId, operation: 'delete-backup', status: 'completed' }]);
      expect(logged).toEqual(['OPERATION_STATUS_INVALID']);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('simula exclusao concluida, regeneracao do catalogo e polling coerente', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-delete-lifecycle-'));
    const backupRoot = path.join(root, 'backups');
    const directories = ['requests', 'processing', 'processed', 'failed'].map((name) => ({
      directory: path.join(root, name),
      status: name === 'requests' ? 'pending' : name === 'processing' ? 'processing' : name === 'processed' ? 'completed' : 'failed'
    }));
    const requestId = crypto.randomUUID();
    const backupFile = path.join(backupRoot, filename);
    for (const entry of directories) fs.mkdirSync(entry.directory, { recursive: true });
    fs.mkdirSync(backupRoot);
    fs.writeFileSync(backupFile, 'fixture');
    const request = { schemaVersion: 3, id: requestId, action: 'operation', operation: 'delete-backup', backupId: id, requestedAt: '2026-08-11T22:00:00.000Z' };
    try {
      fs.writeFileSync(path.join(directories[0].directory, `${requestId}.json`), JSON.stringify(request));
      fs.renameSync(path.join(directories[0].directory, `${requestId}.json`), path.join(directories[1].directory, `${requestId}.json`));
      fs.rmSync(backupFile);
      const catalogFile = path.join(root, 'backup-catalog.json');
      fs.writeFileSync(catalogFile, JSON.stringify({ schemaVersion: 1, backups: [] }));
      fs.renameSync(path.join(directories[1].directory, `${requestId}.json`), path.join(directories[2].directory, `${requestId}.json`));
      expect(fs.existsSync(backupFile)).toBe(false);
      expect(listBackups({ catalogFile })).toEqual({ retentionDays: 30, backups: [] });
      expect(getRequestStatus(requestId, { directories, statusDirectory: path.join(root, 'status') }))
        .toMatchObject({ status: 'completed', message: 'Backup excluido com sucesso.' });
      const daemon = fs.readFileSync(path.resolve(__dirname, '../../scripts/updater-daemon.sh'), 'utf8');
      expect(daemon.indexOf('write-backup-catalog.mjs')).toBeLessThan(daemon.indexOf('if [[ "$operation_status" -eq 0 ]]'));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('mantem auth, Super Admin, CSRF, rate limit e confirmacoes fortes', () => {
    const routes = fs.readFileSync(path.resolve(__dirname, '../src/routes/backupOperationRoutes.js'), 'utf8');
    const controller = fs.readFileSync(path.resolve(__dirname, '../src/controllers/backupOperationController.js'), 'utf8');
    const daemon = fs.readFileSync(path.resolve(__dirname, '../../scripts/updater-daemon.sh'), 'utf8');
    const app = fs.readFileSync(path.resolve(__dirname, '../src/app.js'), 'utf8');
    expect(routes).toContain('requireAuth, requireSuperAdmin');
    expect(routes).toContain("router.get('/:id/download', controller.download)");
    expect(controller).toContain("res.setHeader('Content-Disposition'");
    expect(controller).toContain('streamPipeline(createReadStream(resolved.file), res');
    expect(controller).not.toContain('readFileSync(resolved.file');
    expect(routes).toContain('sensitiveLimiter');
    expect(controller).toContain("confirmation !== 'RESTAURAR'");
    expect(controller).toContain("confirmation !== 'EXCLUIR'");
    expect(controller).toContain('BACKUP_CREATED');
    expect(controller).toContain('RESTORE_FAILED');
    expect(daemon).toContain('/run/lock/devflow/operations.lock');
    expect(app.indexOf('app.use(csrfProtection)')).toBeLessThan(app.indexOf("app.use('/api/operations/backups'"));
  });
});
