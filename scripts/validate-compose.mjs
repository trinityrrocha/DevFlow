import fs from 'node:fs';
import process from 'node:process';
import YAML from 'yaml';

const load = (file) => YAML.parse(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
const base = load('docker-compose.yml');
const shared = load('docker-compose.shared.yml');

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

process.stdout.write('Compose base e override compartilhado validados.\n');
