const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readCatalog, assertBackupExists, listBackups } = require('../src/services/backupOperationService');
const { createSignedRequest, backupIsInActiveOperation } = require('../src/services/operationalRequestService');

describe('gestao administrativa de backups', () => {
  const filename = 'devflow-20260811T220000Z-deadbeef.dfbackup';
  const id = crypto.createHash('sha256').update(filename).digest('hex').slice(0, 32);
  const makeCatalog = (root, values = {}) => {
    const catalogFile = path.join(root, 'backup-catalog.json');
    fs.writeFileSync(catalogFile, JSON.stringify({ schemaVersion: 1, backups: [{
      id, filename, createdAt: '2026-08-11T22:00:00.000Z', sizeBytes: 1024,
      status: 'verified', applicationVersion: '0.6.26-alpha', databaseMigration: '014_frontend_approval_stage.sql',
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
      fs.writeFileSync(target, JSON.stringify({ schemaVersion: 1, backups: [{ id, filename: '../../secret', sizeBytes: 1, createdAt: 'now' }] }));
      expect(readCatalog({ catalogFile: target })).toEqual([]);
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

  it('mantem auth, Super Admin, CSRF, rate limit e confirmacoes fortes', () => {
    const routes = fs.readFileSync(path.resolve(__dirname, '../src/routes/backupOperationRoutes.js'), 'utf8');
    const controller = fs.readFileSync(path.resolve(__dirname, '../src/controllers/backupOperationController.js'), 'utf8');
    const daemon = fs.readFileSync(path.resolve(__dirname, '../../scripts/updater-daemon.sh'), 'utf8');
    const app = fs.readFileSync(path.resolve(__dirname, '../src/app.js'), 'utf8');
    expect(routes).toContain('requireAuth, requireSuperAdmin');
    expect(routes).toContain('sensitiveLimiter');
    expect(controller).toContain("confirmation !== 'RESTAURAR'");
    expect(controller).toContain("confirmation !== 'EXCLUIR'");
    expect(controller).toContain('BACKUP_CREATED');
    expect(controller).toContain('RESTORE_FAILED');
    expect(daemon).toContain('/run/lock/devflow/operations.lock');
    expect(app.indexOf('app.use(csrfProtection)')).toBeLessThan(app.indexOf("app.use('/api/operations/backups'"));
  });
});
