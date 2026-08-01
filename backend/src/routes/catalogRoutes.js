const express = require('express');
const controller = require('../controllers/catalogController');
const { requireAuth, requirePermission } = require('../middleware/authMiddleware');

const router = express.Router();
router.use(requireAuth);
router.get('/bootstrap', requirePermission('tasks.view'), controller.bootstrap);
router.get('/clients', requirePermission('tasks.view'), controller.listClients);
router.post('/clients', requirePermission('projects.manage'), controller.createClient);
router.patch('/clients/:id', requirePermission('projects.manage'), controller.updateClient);
router.get('/projects', requirePermission('tasks.view'), controller.listProjects);
router.post('/projects', requirePermission('projects.manage'), controller.createProject);
router.patch('/projects/:id', requirePermission('projects.manage'), controller.updateProject);
router.post('/workflows', requirePermission('catalogs.manage'), controller.createWorkflow);
router.get('/:catalog', requirePermission('tasks.view'), controller.listCatalog);
router.post('/:catalog', requirePermission('catalogs.manage'), controller.createCatalogItem);
router.patch('/:catalog/:id', requirePermission('catalogs.manage'), controller.updateCatalogItem);

module.exports = router;
