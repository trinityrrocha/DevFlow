const dashboardService = require('../services/dashboardService');
const { z } = require('zod');
const { AppError } = require('../utils/errors');

async function getDashboard(req, res) {
  res.json(await dashboardService.dashboard(req.user));
}

async function getDashboardDetails(req, res) {
  const query = z.object({ page: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().positive().max(50).optional() }).parse(req.query);
  const details = await dashboardService.dashboardDetails(req.user, req.params.metric, query);
  if (!details) throw new AppError('DASHBOARD_METRIC_INVALID', 'Indicador de dashboard invalido.', 404);
  res.json(details);
}

module.exports = { getDashboard, getDashboardDetails };
