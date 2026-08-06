const express = require('express');
const controller = require('../controllers/userController');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');

const router = express.Router();
router.use(requireAuth);
router.get('/', controller.listUsers);
router.get('/profiles', controller.listProfiles);
router.post('/profile/password', controller.updateOwnPassword);
router.patch('/profile', controller.updateOwnProfile);
router.post('/profile/email-change', controller.requestOwnEmailChange);
router.post('/profile/email-confirm', controller.confirmOwnEmailChange);
router.post('/', requireAdmin, controller.createUser);
router.get('/:id', requireAdmin, controller.getUser);
router.patch('/:id', requireAdmin, controller.updateUser);
router.post('/:id/password-reset', requireAdmin, controller.resetUserPassword);
router.post('/:id/mfa-reset', requireAdmin, controller.resetUserMfa);

module.exports = router;
