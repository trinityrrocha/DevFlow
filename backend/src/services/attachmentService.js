const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const multer = require('multer');
const db = require('../config/database');
const env = require('../config/env');
const { AppError, assert } = require('../utils/errors');
const taskService = require('./taskService');

const allowedExtensions = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.mp4', '.webm',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.md',
  '.zip', '.7z', '.rar', '.tar', '.gz'
]);

fs.mkdirSync(env.UPLOAD_DIR, { recursive: true, mode: 0o700 });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, env.UPLOAD_DIR),
    filename: (_req, _file, callback) => callback(null, crypto.randomUUID())
  }),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const valid = allowedExtensions.has(path.extname(file.originalname).toLowerCase());
    callback(valid ? null : new AppError('FILE_TYPE_INVALID', 'Tipo de arquivo não permitido.'), valid);
  }
});

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

function resolveStorageKey(storageKey) {
  const uploadRoot = path.resolve(env.UPLOAD_DIR);
  const filePath = path.resolve(uploadRoot, storageKey);
  if (!filePath.startsWith(`${uploadRoot}${path.sep}`)) {
    throw new AppError('ATTACHMENT_PATH_INVALID', 'Anexo inválido.', 500);
  }
  return filePath;
}

async function createAttachment(req, taskId, file, description) {
  assert(file?.path, 'FILE_REQUIRED', 'Selecione um arquivo.');
  const companyId = req.user.company_id;
  const storageKey = `${companyId}/${path.basename(file.filename)}`;
  const finalPath = resolveStorageKey(storageKey);
  await fsp.mkdir(path.dirname(finalPath), { recursive: true, mode: 0o700 });
  await fsp.rename(file.path, finalPath);
  const stat = await fsp.stat(finalPath);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await taskService.getTask(taskId, companyId, client, req.user);
    const attachment = (await client.query(
      `INSERT INTO task_attachments (
         company_id,task_id,original_name,storage_key,mime_type,size_bytes,sha256,description,created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id,original_name,mime_type,size_bytes,description,created_at`,
      [
        companyId, taskId, path.basename(file.originalname).slice(0, 255), storageKey,
        String(file.mimetype || 'application/octet-stream').slice(0, 160), stat.size,
        await sha256File(finalPath), String(description || '').trim().slice(0, 1000) || null,
        req.user.id
      ]
    )).rows[0];
    await taskService.addEvent(client, req, taskId, 'ATTACHMENT_ADDED', `Anexo ${file.originalname} incluído.`, {}, {
      attachment_id: attachment.id,
      original_name: attachment.original_name
    });
    await client.query('COMMIT');
    return attachment;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    await fsp.rm(finalPath, { force: true }).catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function getAttachment(user, taskId, id) {
  const companyId = user.company_id;
  await taskService.getTask(taskId, companyId, db, user);
  const attachment = (await db.query(
    `SELECT * FROM task_attachments
     WHERE id=$1 AND task_id=$2 AND company_id=$3 AND deleted_at IS NULL`,
    [id, taskId, companyId]
  )).rows[0];
  if (!attachment) throw new AppError('ATTACHMENT_NOT_FOUND', 'Anexo não encontrado.', 404);
  return { attachment, filePath: resolveStorageKey(attachment.storage_key) };
}

async function softDeleteAttachment(req, taskId, id) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await taskService.getTask(taskId, req.user.company_id, client, req.user);
    const result = await client.query(
      `UPDATE task_attachments SET deleted_at=CURRENT_TIMESTAMP,deleted_by=$3
       WHERE id=$1 AND task_id=$2 AND company_id=$4 AND deleted_at IS NULL
       RETURNING task_id,original_name`,
      [id, taskId, req.user.id, req.user.company_id]
    );
    assert(result.rowCount, 'ATTACHMENT_NOT_FOUND', 'Anexo não encontrado.', 404);
    await taskService.addEvent(client, req, taskId, 'ATTACHMENT_REMOVED', `Anexo ${result.rows[0].original_name} removido logicamente.`);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { upload, createAttachment, getAttachment, softDeleteAttachment };
