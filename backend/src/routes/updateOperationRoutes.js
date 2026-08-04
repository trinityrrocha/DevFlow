const express = require('express');
const controller = require('../controllers/updateOperationController');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');

const router = express.Router();
router.use(requireAuth, requireAdmin);
router.get('/capabilities', controller.getCapabilities);

module.exports = router;
