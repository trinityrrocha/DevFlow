import { describe, expect, it, vi } from 'vitest';
import { errorMessage } from '../services/api';
import { attachmentFilename, triggerBackupDownload } from './backupDownload';

const filename = 'devflow-20260816T230000Z-deadbeef.dfbackup';
const backup = { id: '17c0879e93f727c2f36735d55a5e0df7', filename };

describe('download autenticado de backup', () => {
  it('usa o cliente HTTP com blob, preserva filename, dispara o download e revoga a Object URL', async () => {
    const payload = new Blob(['encrypted-backup'], { type: 'application/octet-stream' });
    const apiClient = { get: vi.fn().mockResolvedValue({
      data: payload,
      headers: { 'content-disposition': `attachment; filename="${filename}"; filename*=UTF-8''${filename}` }
    }) };
    const anchor = { style: {}, click: vi.fn(), remove: vi.fn() };
    const documentRef = { createElement: vi.fn(() => anchor), body: { appendChild: vi.fn() } };
    const urlApi = { createObjectURL: vi.fn(() => 'blob:devflow-backup'), revokeObjectURL: vi.fn() };
    const schedule = vi.fn((callback) => callback());

    await expect(triggerBackupDownload(apiClient, backup, { documentRef, urlApi, schedule })).resolves.toBe(filename);
    expect(apiClient.get).toHaveBeenCalledWith(`/operations/backups/${backup.id}/download`, { responseType: 'blob' });
    expect(anchor).toMatchObject({ href: 'blob:devflow-backup', download: filename });
    expect(documentRef.body.appendChild).toHaveBeenCalledWith(anchor);
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 0);
    expect(urlApi.revokeObjectURL).toHaveBeenCalledWith('blob:devflow-backup');
  });

  it('interpreta erro JSON recebido como blob para a mensagem centralizada', async () => {
    const error = { response: { status: 404, data: new Blob([JSON.stringify({ error: { code: 'BACKUP_NOT_FOUND', message: 'Backup nao encontrado.' } })], { type: 'application/json' }) } };
    const apiClient = { get: vi.fn().mockRejectedValue(error) };
    try {
      await triggerBackupDownload(apiClient, backup, { documentRef: {}, urlApi: {} });
      throw new Error('download deveria falhar');
    } catch (normalized) {
      expect(errorMessage(normalized)).toBe('Backup nao encontrado.');
    }
  });

  it('aceita somente nomes de backup allowlisted no Content-Disposition', () => {
    expect(attachmentFilename(`attachment; filename="${filename}"`, 'fallback.dfbackup')).toBe(filename);
    expect(attachmentFilename('attachment; filename="../../etc/passwd"', filename)).toBe(filename);
  });
});
