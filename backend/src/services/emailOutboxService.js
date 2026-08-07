const crypto = require('crypto');
const nodemailer = require('nodemailer');
const db = require('../config/database');
const env = require('../config/env');
const { renderTemplate } = require('./emailTemplateService');

const key = Buffer.from(env.CONFIG_ENCRYPTION_KEY, 'base64');

function encryptPayload(payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
}

function decryptPayload(value) {
  const [iv, tag, encrypted] = String(value).split('.').map((part) => Buffer.from(part, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8'));
}

function smtpConfigured() {
  return env.SMTP_ENABLED && Boolean(env.SMTP_HOST && env.SMTP_FROM);
}

function createTransport() {
  if (!smtpConfigured()) return null;
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    requireTLS: !env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    connectionTimeout: env.SMTP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: env.SMTP_CONNECTION_TIMEOUT_MS,
    socketTimeout: env.SMTP_SOCKET_TIMEOUT_MS
  });
}

async function enqueueEmail(queryable, job) {
  const result = await queryable.query(
    `INSERT INTO email_outbox (
       company_id,user_id,notification_id,recipient_email,template_code,encrypted_payload,idempotency_key
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
    [job.companyId || null, job.userId || null, job.notificationId || null, job.email,
      job.template, encryptPayload(job.data || {}), job.idempotencyKey]
  );
  return result.rows[0]?.id || null;
}

const safeErrorCode = (error) => {
  const value = String(error?.code || error?.responseCode || 'DELIVERY_ERROR').toUpperCase();
  return /^[A-Z0-9_-]{1,100}$/.test(value) ? value : 'DELIVERY_ERROR';
};
const backoffSeconds = (attempts) => Math.min(3600, 30 * (2 ** Math.max(0, attempts - 1)));

async function claimBatch(limit = env.EMAIL_WORKER_BATCH_SIZE) {
  return db.transaction(async (client) => {
    const result = await client.query(
      `SELECT * FROM email_outbox
       WHERE ((status='PENDING' AND available_at<=CURRENT_TIMESTAMP)
         OR (status='PROCESSING' AND locked_at<CURRENT_TIMESTAMP-INTERVAL '10 minutes'))
       ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $1`, [limit]
    );
    if (result.rowCount) await client.query(
      `UPDATE email_outbox SET status='PROCESSING',locked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
       WHERE id=ANY($1::uuid[])`, [result.rows.map((row) => row.id)]
    );
    return result.rows;
  });
}

async function processJob(job, mailer = createTransport()) {
  if (!mailer) {
    await db.query(
      `UPDATE email_outbox SET status='PENDING',locked_at=NULL,available_at=CURRENT_TIMESTAMP+INTERVAL '5 minutes',
       last_error_code='SMTP_NOT_CONFIGURED',updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [job.id]
    );
    return { id: job.id, status: 'deferred' };
  }
  try {
    const rendered = renderTemplate(job.template_code, decryptPayload(job.encrypted_payload));
    await mailer.sendMail({
      from: env.SMTP_FROM,
      replyTo: env.SMTP_REPLY_TO || undefined,
      to: job.recipient_email,
      subject: rendered.subject,
      text: rendered.body
    });
    await db.transaction(async (client) => {
      await client.query(
        `UPDATE email_outbox SET status='SENT',attempts=attempts+1,sent_at=CURRENT_TIMESTAMP,locked_at=NULL,
         encrypted_payload='',last_error_code=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [job.id]
      );
      if (job.notification_id) await client.query("UPDATE notifications SET email_status='SENT' WHERE id=$1", [job.notification_id]);
      await client.query(
        `INSERT INTO audit_events (company_id,operation,entity_type,entity_id,status,new_values)
         VALUES ($1,'EMAIL_SENT','EMAIL_OUTBOX',$2,'SUCCESS',jsonb_build_object('template',$3,'attempt',$4))`,
        [job.company_id, job.id, job.template_code, Number(job.attempts || 0) + 1]
      );
    });
    return { id: job.id, status: 'sent' };
  } catch (error) {
    const attempts = Number(job.attempts || 0) + 1;
    const failed = attempts >= env.EMAIL_MAX_ATTEMPTS;
    const errorCode = safeErrorCode(error);
    await db.transaction(async (client) => {
      await client.query(
        `UPDATE email_outbox SET status=$2,attempts=$3,locked_at=NULL,
         available_at=CURRENT_TIMESTAMP+($4*INTERVAL '1 second'),last_error_code=$5,updated_at=CURRENT_TIMESTAMP
         WHERE id=$1`, [job.id, failed ? 'FAILED' : 'PENDING', attempts, backoffSeconds(attempts), errorCode]
      );
      if (failed && job.notification_id) await client.query("UPDATE notifications SET email_status='FAILED' WHERE id=$1", [job.notification_id]);
      await client.query(
        `INSERT INTO audit_events (company_id,operation,entity_type,entity_id,status,new_values)
         VALUES ($1,$2,'EMAIL_OUTBOX',$3,$4,jsonb_build_object('template',$5,'attempt',$6,'error_code',$7))`,
        [job.company_id, failed ? 'EMAIL_FAILED' : 'EMAIL_RETRY_SCHEDULED', job.id,
          failed ? 'FAILED' : 'SUCCESS', job.template_code, attempts, errorCode]
      );
    });
    return { id: job.id, status: failed ? 'failed' : 'retry' };
  }
}

async function processBatch() {
  const jobs = await claimBatch();
  const mailer = createTransport();
  const results = [];
  for (const job of jobs) results.push(await processJob(job, mailer));
  return results;
}

module.exports = {
  encryptPayload, decryptPayload, smtpConfigured, createTransport, enqueueEmail,
  safeErrorCode, backoffSeconds, claimBatch, processJob, processBatch
};
