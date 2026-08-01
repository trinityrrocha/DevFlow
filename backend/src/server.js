const app = require('./app');
const env = require('./config/env');
const { safeLogError } = require('./utils/safeLogger');
const { refreshPending } = require('./services/dashboardService');

const server = app.listen(env.PORT, () => {
  console.log(`DevFlow backend ativo na porta ${env.PORT}.`);
  refreshPending().catch((error) => safeLogError('Falha ao atualizar métricas.', error));
});

const metricsTimer = global.setInterval(
  () => refreshPending().catch((error) => safeLogError('Falha ao atualizar métricas.', error)),
  60 * 1000
);
metricsTimer.unref();

server.requestTimeout = 30 * 60 * 1000;
server.headersTimeout = 65000;

process.on('unhandledRejection', (error) => safeLogError('Promise rejeitada sem tratamento.', error));
process.on('uncaughtException', (error) => {
  safeLogError('Exceção não capturada.', error);
  process.exit(1);
});
