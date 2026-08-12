const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('../controllers/backupOperationController');
const { requireAuth, requireSuperAdmin } = require('../middleware/authMiddleware');

const router = express.Router();
const sensitiveLimiter = rateLimit({ windowMs: 60 * 1000, limit: 12, standardHeaders: 'draft-8', legacyHeaders: false, message: { code: 'RATE_LIMIT', error: 'Muitas operacoes de backup em pouco tempo.' } });
router.use(requireAuth, requireSuperAdmin);
router.get('/', controller.getBackups);
router.post('/', sensitiveLimiter, controller.create);
router.post('/:id/verify', sensitiveLimiter, controller.verify);
router.post('/:id/restore', sensitiveLimiter, controller.restore);
router.delete('/:id', sensitiveLimiter, controller.remove);
router.get('/requests/:id', controller.status);

module.exports = router;
