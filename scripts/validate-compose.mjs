import fs from 'node:fs';
import process from 'node:process';
import YAML from 'yaml';

const load = (file) => YAML.parse(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
const base = load('docker-compose.yml');
const shared = load('docker-compose.shared.yml');
const fullpassword = load('docker-compose.fullpassword.yml');
const maintenance = load('docker-compose.maintenance.yml');

const requiredServices = ['db', 'backend', 'frontend', 'edge'];
for (const service of requiredServices) {
  if (!base.services?.[service]) throw new Error(`Serviço Compose ausente: ${service}`);
}
if (base.services.db.ports) throw new Error('O banco não pode publicar portas no host.');
if (base.services.backend.ports || base.services.frontend.ports) {
  throw new Error('O Compose base não deve publicar portas de aplicação.');
}
if (!base.services.edge.profiles?.includes('standalone')) {
  throw new Error('O ingress próprio precisa permanecer no profile standalone.');
}
for (const service of ['backend', 'frontend']) {
  const ports = shared.services?.[service]?.ports;
  if (!Array.isArray(ports) || !ports.every((value) => String(value).includes('127.0.0.1'))) {
    throw new Error(`O modo compartilhado deve publicar ${service} somente em loopback por padrão.`);
  }
}
for (const volume of ['devflow_db_data', 'devflow_uploads']) {
  if (!Object.hasOwn(base.volumes || {}, volume)) throw new Error(`Volume isolado ausente: ${volume}`);
}
if (!base.networks?.devflow_internal?.internal) {
  throw new Error('A rede interna do banco deve bloquear exposição externa direta.');
}
if (!base.networks?.devflow_edge?.external || base.networks.devflow_edge.name !== 'devflow_edge'
  || base.services.db.networks?.includes('devflow_edge')) {
  throw new Error('A rede de borda deve existir e permanecer inacessível ao PostgreSQL.');
}
for (const service of ['backend', 'frontend']) {
  if (fullpassword.services?.[service]?.ports) {
    throw new Error(`O adaptador Full Password não deve publicar portas de ${service} no host.`);
  }
  if (!Object.hasOwn(fullpassword.services?.[service]?.networks || {}, 'devflow_edge')) {
    throw new Error(`Alias de borda ausente para ${service} no adaptador Full Password.`);
  }
}
if (!Object.hasOwn(fullpassword.services.backend.networks, 'devflow_internal')) {
  throw new Error('O overlay Full Password deve preservar explicitamente a rede interna do backend.');
}
for (const service of ['backend', 'frontend', 'edge']) {
  if (!base.services[service].networks?.includes('devflow_edge')) {
    throw new Error(`${service} precisa usar a rede de borda DevFlow.`);
  }
}
if (!base.services.backend.networks?.includes('devflow_internal')) {
  throw new Error('Somente o backend deve intermediar acesso ao PostgreSQL.');
}
if (!maintenance.services?.maintenance) throw new Error('Serviço de manutenção ausente.');
const maintenancePorts = maintenance.services.maintenance.ports || [];
if (!maintenancePorts.includes('80:80') || !maintenancePorts.includes('443:443')) {
  throw new Error('O modo de manutenção isolado deve assumir explicitamente 80/443.');
}
if (maintenance.services.maintenance.restart !== 'no') {
  throw new Error('O container de manutenção não pode reiniciar indefinidamente.');
}

process.stdout.write('Compose base, compartilhado e manutenção validados.\n');
