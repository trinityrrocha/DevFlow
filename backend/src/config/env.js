const path = require('path');
const { z } = require('zod');
require('dotenv').config();

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DEVFLOW_VERSION: z.string().min(1).default('0.1.0-alpha'),
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
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASSWORD: z.string().optional().default(''),
  SMTP_FROM: z.string().optional().default('')
});

const parsed = environmentSchema.safeParse(process.env);
if (!parsed.success) {
  const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
  throw new Error(`Configuração de ambiente inválida: ${fields}`);
}

module.exports = Object.freeze(parsed.data);
