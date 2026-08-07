const express = require('express');
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
router.post('/email/test', requireSuperAdmin, controller.testEmail);
module.exports = router;
