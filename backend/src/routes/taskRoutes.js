const express = require('express');
const controller = require('../controllers/taskController');
const attachmentService = require('../services/attachmentService');
const { requireAuth, requirePermission } = require('../middleware/authMiddleware');

const router = express.Router();
router.use(requireAuth);
router.get('/', requirePermission('tasks.view'), controller.listTasks);
router.post('/', requirePermission('tasks.create'), controller.createTask);
router.get('/:id', requirePermission('tasks.view'), controller.detail);
router.post('/:id/transition', requirePermission('tasks.operate'), controller.transition);
router.post('/:id/state', requirePermission('tasks.manage'), controller.stateAction);
router.patch('/:id/administration', requirePermission('tasks.manage'), controller.updateAdministration);
router.put('/:id/submission', requirePermission('tasks.operate'), controller.saveSubmission);
router.post('/:id/tests', requirePermission('tasks.operate'), controller.addTest);
router.post('/:id/approvals', requirePermission('tasks.operate'), controller.addApproval);
router.put('/:id/github', requirePermission('tasks.operate'), controller.saveGithub);
router.post('/:id/comments', requirePermission('tasks.operate'), controller.addComment);
router.post('/:id/attachments', requirePermission('tasks.operate'), attachmentService.upload.single('file'), controller.uploadAttachment);
router.get('/:id/attachments/:attachmentId', requirePermission('tasks.view'), controller.downloadAttachment);
router.delete('/:id/attachments/:attachmentId', requirePermission('tasks.manage'), controller.deleteAttachment);

module.exports = router;
