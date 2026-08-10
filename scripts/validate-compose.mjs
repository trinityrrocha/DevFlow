import fs from 'node:fs';
import process from 'node:process';
import YAML from 'yaml';

const load = (file) => YAML.parse(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
const compose = load('docker-compose.yml');
const maintenance = load('docker-compose.maintenance.yml');
const requiredServices = ['db', 'backend', 'frontend', 'edge', 'updater'];

for (const service of requiredServices) {
  if (!compose.services?.[service]) throw new Error(`Servico Compose ausente: ${service}`);
}
for (const service of ['db', 'backend', 'frontend', 'updater']) {
  if (compose.services[service].ports) throw new Error(`${service} nao pode publicar porta no host.`);
}
const edgePorts = compose.services.edge.ports || [];
if (!edgePorts.includes('80:80') || !edgePorts.includes('443:443')) {
  throw new Error('Somente o Nginx isolado deve publicar 80/443.');
}
for (const [service, expected] of Object.entries({ db: 'devflow-db', backend: 'devflow-backend', worker: 'devflow-worker', frontend: 'devflow-frontend', edge: 'devflow-nginx', updater: 'devflow-updater' })) {
  if (compose.services[service].container_name !== expected) throw new Error(`Nome estavel ausente: ${expected}`);
}
if (!compose.networks?.devflow_internal?.internal || compose.networks.devflow_internal.name !== 'devflow_internal') {
  throw new Error('Rede interna isolada invalida.');
}
if (compose.networks?.devflow_edge?.external || compose.networks.devflow_edge.name !== 'devflow_edge') {
  throw new Error('Rede de borda deve pertencer ao Compose DevFlow.');
}
if (compose.services.db.networks.includes('devflow_edge') || !compose.services.db.networks.includes('devflow_internal')) {
  throw new Error('PostgreSQL deve permanecer somente na rede interna.');
}
if (!compose.services.backend.networks.includes('devflow_internal') || !compose.services.backend.networks.includes('devflow_edge')) {
  throw new Error('Backend deve intermediar as redes interna e de borda.');
}
if (!compose.services.frontend.networks.includes('devflow_edge') || !compose.services.edge.networks.includes('devflow_edge')) {
  throw new Error('Frontend e Nginx devem usar a borda DevFlow.');
}
for (const service of ['db', 'backend', 'frontend', 'edge', 'updater']) {
  if (!compose.services[service].healthcheck) throw new Error(`Healthcheck ausente: ${service}`);
}
if (!compose.services.edge.volumes.includes('/etc/letsencrypt:/etc/letsencrypt:ro')) throw new Error('Certificado do host deve ser somente leitura.');
if (!compose.services.updater.volumes.includes('/var/run/docker.sock:/var/run/docker.sock')) throw new Error('Updater deve possuir o socket Docker explicitamente.');
const updaterQueueMount = '${DEVFLOW_UPDATER_ROOT:-/opt/devflow/updater}:/var/lib/devflow-updater';
if (!compose.services.backend.volumes.includes(updaterQueueMount)
  || !compose.services.updater.volumes.includes(updaterQueueMount)) {
  throw new Error('Backend e updater devem compartilhar o mesmo bind persistente da fila.');
}
if (compose.volumes?.devflow_updater_requests) throw new Error('Fila do updater nao pode depender de volume Docker opaco.');
if (!maintenance.services?.maintenance || maintenance.services.maintenance.restart !== 'no') {
  throw new Error('Compose de manutencao invalido.');
}
process.stdout.write('Compose isolado e manutencao validados.\n');
