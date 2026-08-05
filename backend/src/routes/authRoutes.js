const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('../controllers/authController');
const { requireAuth, requireSuperAdmin } = require('../middleware/authMiddleware');

const router = express.Router();
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { code: 'RATE_LIMIT', error: 'Muitas tentativas. Aguarde e tente novamente.' }
});

router.get('/bootstrap/status', controller.bootstrapStatus);
router.post('/bootstrap', authLimiter, controller.bootstrap);
router.post('/login', authLimiter, controller.login);
router.post('/mfa', authLimiter, controller.verifyMfa);
router.get('/me', requireAuth, controller.me);
router.post('/company/switch', requireAuth, controller.switchCompany);
router.get('/csrf', requireAuth, controller.csrf);
router.post('/logout', requireAuth, controller.logout);
router.get('/mfa/status', requireAuth, controller.mfaStatus);
router.post('/mfa/setup/start', requireAuth, controller.startMfa);
router.post('/mfa/setup/confirm', requireAuth, controller.confirmMfa);
router.post('/mfa/disable', requireAuth, controller.disableMfa);
router.get('/mfa/policy', requireAuth, requireSuperAdmin, controller.mfaPolicy);
router.patch('/mfa/policy', requireAuth, requireSuperAdmin, controller.setMfaPolicy);

module.exports = router;
