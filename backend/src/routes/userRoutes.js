const express = require('express');
const controller = require('../controllers/userController');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');

const router = express.Router();
router.use(requireAuth);
router.get('/', controller.listUsers);
router.get('/profiles', controller.listProfiles);
router.post('/profile/password', controller.updateOwnPassword);
router.post('/', requireAdmin, controller.createUser);
router.patch('/:id', requireAdmin, controller.updateUser);

module.exports = router;
