const express = require('express');
const controller = require('../controllers/dashboardController');
const { requireAuth, requirePermission } = require('../middleware/authMiddleware');

const router = express.Router();
router.get('/', requireAuth, requirePermission('dashboard.view'), controller.getDashboard);
router.get('/details/:metric', requireAuth, requirePermission('dashboard.view'), controller.getDashboardDetails);
module.exports = router;
