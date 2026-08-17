const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const env = require('../config/env');
const { AppError } = require('../utils/errors');

function resolveUploadPath(storageKey) {
  const root = path.resolve(env.UPLOAD_DIR);
  const target = path.resolve(root, String(storageKey || ''));
  if (!target.startsWith(`${root}${path.sep}`)) {
    throw new AppError('ATTACHMENT_PATH_INVALID', 'Caminho de anexo invalido para exclusao.', 500);
  }
  return { root, target };
}

async function quarantine(storageKeys) {
  const keys = [...new Set((storageKeys || []).filter(Boolean))];
  if (!keys.length) return { finalize: async () => {}, rollback: async () => {} };
  const root = path.resolve(env.UPLOAD_DIR);
  const quarantineRoot = path.join(root, '.task-purge', crypto.randomUUID());
  const moved = [];
  await fs.mkdir(quarantineRoot, { recursive: true, mode: 0o700 });
  try {
    for (const [index, storageKey] of keys.entries()) {
      const { target } = resolveUploadPath(storageKey);
      const destination = path.join(quarantineRoot, `${index}-${path.basename(target)}`);
      try {
        await fs.rename(target, destination);
        moved.push({ source: target, destination });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  } catch (error) {
    for (const item of moved.reverse()) {
      await fs.mkdir(path.dirname(item.source), { recursive: true, mode: 0o700 });
      await fs.rename(item.destination, item.source).catch(() => {});
    }
    await fs.rm(quarantineRoot, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  return {
    finalize: () => fs.rm(quarantineRoot, { recursive: true, force: true }),
    rollback: async () => {
      for (const item of moved.reverse()) {
        await fs.mkdir(path.dirname(item.source), { recursive: true, mode: 0o700 });
        await fs.rename(item.destination, item.source).catch(() => {});
      }
      await fs.rm(quarantineRoot, { recursive: true, force: true }).catch(() => {});
    }
  };
}

module.exports = { quarantine, resolveUploadPath };
