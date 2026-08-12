const path = require('path');
const { z } = require('zod');
require('dotenv').config();

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DEVFLOW_VERSION: z.string().min(1).default('0.6.26-alpha'),
  DEVFLOW_RELEASE_COMMIT: z.string().regex(/^(unknown|[0-9a-f]{40})$/).default('unknown'),
  UPDATE_API_ENABLED: z.string().default('false').transform((value) => value === 'true'),
  DEVFLOW_UPDATER_QUEUE_DIR: z.string().refine(path.isAbsolute, 'deve ser um caminho absoluto').default('/var/lib/devflow/updater/requests'),
  DEVFLOW_UPDATER_STATUS_DIR: z.string().refine(path.isAbsolute, 'deve ser um caminho absoluto').default('/var/lib/devflow/updater/status'),
  DEVFLOW_BACKUP_CATALOG_FILE: z.string().refine(path.isAbsolute, 'deve ser um caminho absoluto').default('/var/lib/devflow/updater/backup-catalog.json'),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  UPDATE_REQUEST_SECRET: z.string().min(64),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_ORIGIN: z.string().url().default('http://localhost:5173'),
  DB_HOST: z.string().min(1).default('localhost'),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
  DB_USER: z.string().min(1).default('devflow_user'),
  DB_PASSWORD: z.string().min(1),
  DB_NAME: z.string().min(1).default('devflow_db'),
  JWT_SECRET: z.string().min(64),
  ADMIN_BOOTSTRAP_TOKEN: z.string().min(48),
  CONFIG_ENCRYPTION_KEY: z.string().refine((value) => {
    const decoded = Buffer.from(value, 'base64');
    return decoded.length === 32 && decoded.toString('base64') === value;
  }, 'deve ser base64 canônico de 32 bytes'),
  SUPER_ADMIN_EMAIL: z.string().email(),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().min(1).max(168).default(12),
  SESSION_IDLE_MINUTES: z.coerce.number().min(5).max(1440).default(60),
  UPLOAD_DIR: z.string().default(path.resolve(process.cwd(), 'tmp', 'uploads')),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(100).default(25),
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z.string().default('false').transform((value) => value === 'true'),
  SMTP_ENABLED: z.string().default('false').transform((value) => value === 'true'),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASSWORD: z.string().optional().default(''),
  SMTP_FROM: z.string().optional().default(''),
  SMTP_REPLY_TO: z.string().optional().default(''),
  SMTP_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(10000),
  SMTP_SOCKET_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(15000),
  EMAIL_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  EMAIL_WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  EMAIL_VERIFICATION_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(120).default(30)
}).superRefine((value, context) => {
  if (path.dirname(value.DEVFLOW_UPDATER_QUEUE_DIR) !== path.dirname(value.DEVFLOW_UPDATER_STATUS_DIR)) {
    context.addIssue({ code: 'custom', path: ['DEVFLOW_UPDATER_STATUS_DIR'], message: 'deve compartilhar a raiz persistente da fila' });
  }
  if (value.SMTP_ENABLED && !value.SMTP_HOST) context.addIssue({ code: 'custom', path: ['SMTP_HOST'], message: 'obrigatorio quando SMTP_ENABLED=true' });
  if (value.SMTP_ENABLED && !value.SMTP_FROM) context.addIssue({ code: 'custom', path: ['SMTP_FROM'], message: 'obrigatorio quando SMTP_ENABLED=true' });
  if (Boolean(value.SMTP_USER) !== Boolean(value.SMTP_PASSWORD)) context.addIssue({ code: 'custom', path: ['SMTP_USER'], message: 'usuario e senha SMTP devem ser configurados juntos' });
});

const parsed = environmentSchema.safeParse(process.env);
if (!parsed.success) {
  const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
  throw new Error(`Configuração de ambiente inválida: ${fields}`);
}

module.exports = Object.freeze(parsed.data);
