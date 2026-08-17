const express = require('express');
const controller = require('../controllers/catalogController');
const { requireAuth, requirePermission } = require('../middleware/authMiddleware');

const router = express.Router();
router.use(requireAuth);
router.get('/bootstrap', requirePermission('tasks.view'), controller.bootstrap);
router.get('/stages', requirePermission('tasks.view'), controller.listStages);
router.get('/clients', requirePermission('clients.view'), controller.listClients);
router.get('/clients/:id', requirePermission('clients.view'), controller.getClient);
router.post('/clients', requirePermission('clients.manage'), controller.createClient);
router.patch('/clients/:id', requirePermission('clients.manage'), controller.updateClient);
router.delete('/clients/:id', requirePermission('clients.manage'), controller.deleteClient);
router.get('/projects', requirePermission('projects.view'), controller.listProjects);
router.get('/projects/:id', requirePermission('projects.view'), controller.getProject);
router.post('/projects', requirePermission('projects.manage'), controller.createProject);
router.patch('/projects/:id', requirePermission('projects.manage'), controller.updateProject);
router.delete('/projects/:id', requirePermission('projects.manage'), controller.deleteProject);
router.post('/workflows', requirePermission('catalogs.manage'), controller.createWorkflow);
router.get('/:catalog', requirePermission('tasks.view'), controller.listCatalog);
router.post('/:catalog', requirePermission('catalogs.manage'), controller.createCatalogItem);
router.patch('/:catalog/:id', requirePermission('catalogs.manage'), controller.updateCatalogItem);

module.exports = router;
