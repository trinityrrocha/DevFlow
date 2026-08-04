const env = require('../config/env');

const UPDATE_ENGINE = 'scripts/update.sh';
const UPDATE_OPERATIONS = Object.freeze([
  'check-update',
  'download-update',
  'validate-update',
  'install-update',
  'rollback-update'
]);

function getUpdateCapabilities() {
  return Object.freeze({
    enabled: env.UPDATE_API_ENABLED,
    executionAvailable: false,
    engine: UPDATE_ENGINE,
    version: env.DEVFLOW_VERSION,
    operations: UPDATE_OPERATIONS,
    message: env.UPDATE_API_ENABLED
      ? 'Contrato habilitado; a execucao remota permanece indisponivel nesta fase.'
      : 'Contrato desabilitado por padrao. Atualizacoes devem ser executadas no terminal.'
  });
}

module.exports = { getUpdateCapabilities, UPDATE_ENGINE, UPDATE_OPERATIONS };
