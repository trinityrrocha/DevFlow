const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');

const MAGIC = Buffer.from('DEVFLOW-BACKUP-V1\0', 'ascii');
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;

function deriveKey(passphrase, salt) {
  return crypto.scryptSync(passphrase, salt, 32, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024
  });
}

async function encryptFile(source, destination, passphrase) {
  if (!passphrase || passphrase.length < 16) throw new Error('A passphrase precisa ter pelo menos 16 caracteres.');
  const salt = crypto.randomBytes(SALT_BYTES);
  const iv = crypto.randomBytes(IV_BYTES);
  const header = Buffer.concat([MAGIC, salt, iv]);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
  cipher.setAAD(header);

  const fileHandle = await fs.promises.open(destination, 'wx', 0o600);
  try {
    await fileHandle.write(header, 0, header.length, 0);
    const output = fs.createWriteStream(destination, {
      fd: fileHandle.fd,
      start: header.length,
      autoClose: false
    });
    await pipeline(fs.createReadStream(source), cipher, output);
    const ciphertextEnd = (await fs.promises.stat(destination)).size;
    await fileHandle.write(cipher.getAuthTag(), 0, TAG_BYTES, ciphertextEnd);
  } catch (error) {
    await fs.promises.rm(destination, { force: true }).catch(() => {});
    throw error;
  } finally {
    await fileHandle.close().catch(() => {});
  }
}

async function decryptFile(source, destination, passphrase) {
  const stat = await fs.promises.stat(source);
  const headerBytes = MAGIC.length + SALT_BYTES + IV_BYTES;
  if (stat.size <= headerBytes + TAG_BYTES) throw new Error('Backup truncado.');
  const input = await fs.promises.open(source, 'r');
  let header;
  let tag;
  try {
    header = Buffer.alloc(headerBytes);
    tag = Buffer.alloc(TAG_BYTES);
    await input.read(header, 0, header.length, 0);
    await input.read(tag, 0, tag.length, stat.size - TAG_BYTES);
  } finally {
    await input.close();
  }
  if (!crypto.timingSafeEqual(header.subarray(0, MAGIC.length), MAGIC)) {
    throw new Error('Formato de backup DevFlow inválido.');
  }
  const salt = header.subarray(MAGIC.length, MAGIC.length + SALT_BYTES);
  const iv = header.subarray(MAGIC.length + SALT_BYTES);
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  try {
    await pipeline(
      fs.createReadStream(source, { start: headerBytes, end: stat.size - TAG_BYTES - 1 }),
      decipher,
      fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 })
    );
  } catch (error) {
    await fs.promises.rm(destination, { force: true }).catch(() => {});
    throw new Error('Passphrase incorreta ou backup adulterado.', { cause: error });
  }
}

function readPassphrase() {
  if (process.env.BACKUP_PASSPHRASE_FILE) {
    return fs.readFileSync(process.env.BACKUP_PASSPHRASE_FILE, 'utf8').trimEnd();
  }
  return String(process.env.BACKUP_PASSPHRASE || '');
}

async function main() {
  const [operation, sourceValue, destinationValue] = process.argv.slice(2);
  if (!['encrypt', 'decrypt'].includes(operation) || !sourceValue || !destinationValue) {
    throw new Error('Uso: cryptoEnvelope.js encrypt|decrypt <origem> <destino>');
  }
  const source = path.resolve(sourceValue);
  const destination = path.resolve(destinationValue);
  if (operation === 'encrypt') await encryptFile(source, destination, readPassphrase());
  else await decryptFile(source, destination, readPassphrase());
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { MAGIC, encryptFile, decryptFile };
