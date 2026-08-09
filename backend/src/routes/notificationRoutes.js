const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('../controllers/notificationController');
const { requireAuth, requireSuperAdmin } = require('../middleware/authMiddleware');

const router = express.Router();
router.use(requireAuth);
router.get('/', controller.listNotifications);
router.post('/read', controller.markRead);
router.post('/read-all', controller.markAllRead);
router.get('/preferences', controller.getPreferences);
router.patch('/preferences', controller.updatePreferences);
router.get('/email/status', requireSuperAdmin, controller.emailStatus);
router.put('/email/settings', requireSuperAdmin, controller.saveEmailSettings);
router.post('/email/test', requireSuperAdmin, rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false, message: { code: 'SMTP_TEST_RATE_LIMITED', error: 'Limite de testes SMTP atingido. Aguarde alguns minutos.' } }), controller.testEmail);
module.exports = router;
