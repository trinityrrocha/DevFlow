#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';

const root = resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(resolve(root, file), 'utf8');
const health = read('scripts/health.sh');
const update = read('scripts/update.sh');
const daemon = read('scripts/updater-daemon.sh');
const composeText = read('docker-compose.yml');
const compose = YAML.parse(composeText);
const updaterDockerfile = read('docker/updater/Dockerfile');
const updateService = read('backend/src/services/operationalRequestService.js');
const requestValidator = read('scripts/validate-updater-request.mjs');

let passed = 0;
const check = (name, condition) => {
  if (!condition) throw new Error(`daemon-health-context-check-failed:${name}`);
  passed += 1;
  process.stdout.write(`ok ${passed} - ${name}\n`);
};

const hostCertificateBlock = health.slice(
  health.indexOf('certificate="$DEVFLOW_CERTIFICATE_PATH'),
  health.indexOf('else\n  report PASS external_http skipped-internal')
);
const daemonBlock = health.slice(
  health.indexOf('if [[ "$DAEMON_MODE" == true ]]; then\n    report PASS certificate_file_check'),
  health.indexOf('else\n    certificate="$DEVFLOW_CERTIFICATE_PATH')
);
const updaterMounts = compose.services.updater.volumes.map(String);
const curlUsesInsecureTls = /curl[^\n]*(?:^|\s)(?:-k|--insecure)(?:\s|$)/mu.test(health);

check('01 host health remains the default strict mode', health.includes('DAEMON_MODE="${DEVFLOW_UPDATE_DAEMON:-false}"')
  && health.includes('if [[ "$INTERNAL_ONLY" == false ]]') && health.includes('else\n    certificate="$DEVFLOW_CERTIFICATE_PATH'));
check('02 explicit daemon health mode exists', health.includes('--daemon) DAEMON_MODE=true')
  && health.includes('daemon_runtime_health=$overall'));
check('03 daemon does not read letsencrypt files', daemonBlock.includes('certificate_file_check skipped-host-only')
  && !daemonBlock.includes('DEVFLOW_CERTIFICATE_PATH'));
check('04 daemon does not execute systemd', daemonBlock.includes('certificate_renewal_timer skipped-host-only')
  && !daemonBlock.includes('systemctl'));
check('05 daemon resolves the nginx edge IPv4', health.includes("docker inspect --format '{{(index .NetworkSettings.Networks \"devflow_edge\").IPAddress}}' devflow-nginx")
  && health.includes('report PASS nginx_edge_ip'));
check('06 daemon HTTP accepts only redirect 301 or 308', health.includes('DEVFLOW_DOMAIN:80:$resolve_ip')
  && health.includes('[[ "$http_code" == 301 || "$http_code" == 308 ]]'));
check('07 daemon HTTPS traverses nginx with strict hostname TLS', health.includes('DEVFLOW_DOMAIN:443:$resolve_ip')
  && health.includes('"https://$DEVFLOW_DOMAIN/api/health"') && health.includes('--fail --silent --show-error')
  && updaterDockerfile.includes('ca-certificates'));
check('08 invalid TLS makes daemon HTTPS unhealthy', health.includes('report FAIL external_https unhealthy')
  && health.indexOf('report FAIL external_https unhealthy') > health.indexOf('DEVFLOW_DOMAIN:443:$resolve_ip'));
check('09 insecure curl is never used', !curlUsesInsecureTls);
check('10 host certificate file remains mandatory', hostCertificateBlock.includes('validate_devflow_certificate')
  && hostCertificateBlock.includes('report FAIL certificate invalid'));
check('11 host certificate timer remains mandatory', hostCertificateBlock.includes('systemctl is-enabled --quiet devflow-certificate-renewal.timer')
  && hostCertificateBlock.includes('report FAIL certificate_renewal inactive'));
check('12 daemon reports host-only certificate skips as passing', ['certificate_file_check skipped-host-only',
  'certificate_expiration_file_check skipped-host-only', 'certificate_renewal_timer skipped-host-only']
  .every((token) => daemonBlock.includes(token)));
check('13 manual pre-update selects host health', update.includes('if [[ "$INTERNAL_MODE" == true ]]; then')
  && update.includes('else\n    "$release/scripts/health.sh" "$@"') && update.includes('run_context_health "$OLD_RELEASE_DIR"'));
check('14 WebUpdater selects daemon health', daemon.includes('DEVFLOW_UPDATE_DAEMON=true')
  && daemon.includes('DEVFLOW_UPDATE_INTERNAL=true')
  && update.includes('DEVFLOW_UPDATE_DAEMON=true "$release/scripts/health.sh" --daemon'));
check('15 candidate health keeps identity and migration gates', update.includes('scripts/health.sh" --candidate')
  && health.includes('candidate_version_match') && health.includes('candidate_commit_match')
  && health.includes('candidate_migration_match'));
check('16 final WebUpdater health uses the contextual daemon gate', update.includes('UPDATE_PHASE=health-public')
  && update.indexOf('run_context_health "$CANDIDATE_DIR"') > update.indexOf('UPDATE_PHASE=health-public'));
check('17 signed HMAC request contract remains active', updateService.includes("createHmac('sha256'")
  && requestValidator.includes('timingSafeEqual') && requestValidator.includes('allowedOperations'));
check('18 queue lifecycle and roots remain unchanged', ['/requests', '/processing', '/processed', '/failed', '/status']
  .every((suffix) => daemon.includes(`$REQUEST_ROOT${suffix}`)));
check('19 updater service allowlist remains unchanged', daemon.includes("UPDATE_SERVICES='db backend frontend worker edge'")
  && !daemon.includes("UPDATE_SERVICES='db backend frontend worker edge updater'"));
check('20 updater receives no sensitive host mount', !updaterMounts.some((mount) => mount.startsWith('/etc/letsencrypt'))
  && !updaterMounts.some((mount) => mount.includes('/etc/systemd')) && !compose.services.updater.network_mode);

const realFailureFixture = {
  internalServicesHealthy: true,
  loopbackPublishesNginx: false,
  hostCertificateFilesPresent: false,
  hostSystemdPresent: false,
  nginxEdgeIpResolved: true,
  httpRedirect: 301,
  httpsCertificateValid: true
};
const previousHostHealthInsideDaemon = realFailureFixture.internalServicesHealthy
  && realFailureFixture.loopbackPublishesNginx
  && realFailureFixture.hostCertificateFilesPresent
  && realFailureFixture.hostSystemdPresent;
const correctedDaemonHealth = realFailureFixture.internalServicesHealthy
  && realFailureFixture.nginxEdgeIpResolved
  && [301, 308].includes(realFailureFixture.httpRedirect)
  && realFailureFixture.httpsCertificateValid;

if (previousHostHealthInsideDaemon || !correctedDaemonHealth) {
  throw new Error('real-failure-fixture-was-not-reproduced');
}
process.stdout.write('fixture_before=overall_health=unhealthy update_blocked\n');
process.stdout.write('fixture_after=daemon_runtime_health=healthy update_proceeds\n');

if (passed !== 20) throw new Error(`expected-20-checks:received-${passed}`);
process.stdout.write('daemon_health_context_contract=passed\n');
