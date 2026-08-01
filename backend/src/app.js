const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const env = require('./config/env');
const db = require('./config/database');
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const taskRoutes = require('./routes/taskRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const auditRoutes = require('./routes/auditRoutes');
const catalogRoutes = require('./routes/catalogRoutes');
const { requestContext } = require('./middleware/requestContext');
const { csrfProtection } = require('./middleware/csrfMiddleware');
const { notFound, errorHandler } = require('./middleware/errorMiddleware');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(requestContext);
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'none'"]
    }
  },
  hsts: env.NODE_ENV === 'production'
    ? { maxAge: 31536000, includeSubDomains: true }
    : false
}));
app.use(cors({ origin: env.APP_ORIGIN, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use(csrfProtection);

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  skip: (req) => ['GET', 'HEAD', 'OPTIONS'].includes(req.method),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { code: 'RATE_LIMIT', error: 'Muitas operações em pouco tempo.' }
});
app.use('/api', writeLimiter);

app.get('/api/health', async (_req, res, next) => {
  try {
    await db.query('SELECT 1');
    const migration = await db.query(
      'SELECT version FROM schema_migrations ORDER BY applied_at DESC LIMIT 1'
    );
    res.json({
      status: 'ok',
      version: env.DEVFLOW_VERSION,
      environment: env.NODE_ENV,
      migration: migration.rows[0]?.version || null
    });
  } catch (error) {
    next(error);
  }
});
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/catalogs', catalogRoutes);
app.use(notFound);
app.use(errorHandler);

module.exports = app;
