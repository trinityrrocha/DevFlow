const express = require('express');
const controller = require('../controllers/auditController');
const { requireAuth, requirePermission } = require('../middleware/authMiddleware');

const router = express.Router();
router.use(requireAuth, requirePermission('audit.view'));
router.get('/', controller.listAuditEvents);
router.get('/sessions', controller.listSessions);
router.post('/sessions/:id/revoke', controller.revokeSession);
router.post('/users/:userId/sessions/revoke', controller.revokeAllUserSessions);

module.exports = router;
