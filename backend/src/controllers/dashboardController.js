const dashboardService = require('../services/dashboardService');

async function getDashboard(req, res) {
  res.json(await dashboardService.dashboard(req.user.company_id));
}

module.exports = { getDashboard };
