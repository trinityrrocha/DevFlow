const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { decryptFile, encryptFile } = require('../scripts/cryptoEnvelope');

describe('cryptoEnvelope', () => {
  it('restaura o conteúdo autenticado com AES-256-GCM', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-crypto-'));
    const source = path.join(directory, 'source.bin');
    const encrypted = path.join(directory, 'backup.dfbackup');
    const restored = path.join(directory, 'restored.bin');
    try {
      await fs.writeFile(source, Buffer.from('conteúdo de backup do DevFlow'));
      await encryptFile(source, encrypted, 'passphrase-forte-de-teste');
      await decryptFile(encrypted, restored, 'passphrase-forte-de-teste');
      expect(await fs.readFile(restored, 'utf8')).toBe('conteúdo de backup do DevFlow');
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('rejeita passphrase incorreta e remove saída parcial', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-crypto-'));
    const source = path.join(directory, 'source.bin');
    const encrypted = path.join(directory, 'backup.dfbackup');
    const restored = path.join(directory, 'restored.bin');
    try {
      await fs.writeFile(source, 'segredo');
      await encryptFile(source, encrypted, 'passphrase-forte-de-teste');
      await expect(decryptFile(encrypted, restored, 'outra-passphrase-segura')).rejects.toThrow();
      await expect(fs.stat(restored)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
