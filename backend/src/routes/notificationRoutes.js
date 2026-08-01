const express = require('express');
const controller = require('../controllers/notificationController');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();
router.use(requireAuth);
router.get('/', controller.listNotifications);
router.post('/read', controller.markRead);
module.exports = router;
