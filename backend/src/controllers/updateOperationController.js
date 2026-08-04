const { getUpdateCapabilities } = require('../services/updateOperationService');

function getCapabilities(_req, res) {
  res.json(getUpdateCapabilities());
}

module.exports = { getCapabilities };
