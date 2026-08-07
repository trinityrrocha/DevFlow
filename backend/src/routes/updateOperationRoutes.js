const express = require('express');
const controller = require('../controllers/updateOperationController');
const { requireAuth, requireSuperAdmin } = require('../middleware/authMiddleware');

const router = express.Router();
router.use(requireAuth, requireSuperAdmin);
router.get('/capabilities', controller.getCapabilities);
router.post('/requests', controller.createRequest);
router.get('/requests/:id', controller.getStatus);

module.exports = router;
