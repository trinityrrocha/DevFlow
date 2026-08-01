const express = require('express');
const controller = require('../controllers/auditController');
const { requireAuth, requirePermission } = require('../middleware/authMiddleware');

const router = express.Router();
router.use(requireAuth, requirePermission('audit.view'));
router.get('/', controller.listAuditEvents);

module.exports = router;
