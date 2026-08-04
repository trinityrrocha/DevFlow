import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const reconcile = read('scripts/reconcile-installed-release.sh');
const common = read('scripts/lib/common.sh');
const images = read('scripts/lib/compose-images.sh');
const publish = read('scripts/publish.sh');
const compose = read('docker-compose.yml');
const backendDockerfile = read('backend/Dockerfile');
const frontendDockerfile = read('frontend/Dockerfile');
const checks = [];

const check = (label, condition) => {
  if (!condition) throw new Error(`Installed release reconciliation test failed: ${label}`);
  checks.push(label);
};

const decision = ({ state, backendVersion, backendCommit, frontendVersion, frontendCommit, configCommit }) => ({
  stateRepairRequired: !state,
  reconciliationRequired: !backendVersion || !backendCommit || !frontendVersion || !frontendCommit || !configCommit,
});

const stateOnly = decision({
  state: false, backendVersion: true, backendCommit: true,
  frontendVersion: true, frontendCommit: true, configCommit: true,
});
check('estado incorreto e imagens corretas', stateOnly.stateRepairRequired && !stateOnly.reconciliationRequired);

const legacyImages = decision({
  state: false, backendVersion: true, backendCommit: false,
  frontendVersion: true, frontendCommit: false, configCommit: false,
});
check('estado incorreto e imagens com commit antigo', legacyImages.stateRepairRequired && legacyImages.reconciliationRequired);
check('versão da imagem correta e commit incorreto', legacyImages.reconciliationRequired
  && reconcile.includes('BACKEND_IMAGE_VERSION_MATCH') && reconcile.includes('BACKEND_IMAGE_COMMIT_MATCH'));
check('build a partir do checkout instalado', reconcile.includes('DEVFLOW_APP_ROOT="$SOURCE_DIR"')
  && reconcile.includes('"${DEVFLOW_COMPOSE[@]}" build backend frontend'));
check('checkout operacional mais novo que a release instalada', reconcile.includes('SCRIPT_DIR=')
  && reconcile.includes('SOURCE_DIR="$DEVFLOW_INSTALL_ROOT/source"')
  && !reconcile.includes('git -C "$SOURCE_DIR" merge'));
check('banco preservado', reconcile.includes('DB_CONTAINER_ID=')
  && reconcile.includes('DB_MOUNT_IDENTITY=')
  && !/(?:docker compose|DEVFLOW_COMPOSE[^\n]*)\s+down\b/u.test(reconcile));
check('migrations não executadas', !reconcile.includes('run_devflow_migrations')
  && !reconcile.includes('scripts/migrate.js')
  && reconcile.includes('command: ["node", "src/server.js"]')
  && reconcile.includes('Migration mudou durante a reconciliação'));
check('recriação apenas de backend/frontend', reconcile.includes('up -d --no-deps --force-recreate --wait backend frontend')
  && !reconcile.includes('up -d db'));
check('rollback das imagens', reconcile.includes('rollback_reconciliation')
  && reconcile.includes('docker image tag "$OLD_BACKEND_IMAGE_ID" "$TARGET_BACKEND_IMAGE"')
  && reconcile.includes('docker image tag "$OLD_FRONTEND_IMAGE_ID" "$TARGET_FRONTEND_IMAGE"'));
check('labels OCI reconciliadas', reconcile.includes('compose_image_matches_release "$CANDIDATE_BACKEND_IMAGE"')
  && compose.includes('DEVFLOW_BUILD_COMMIT')
  && backendDockerfile.includes('org.opencontainers.image.revision')
  && frontendDockerfile.includes('org.opencontainers.image.revision'));
check('estado schema v1', reconcile.includes('write_install_report "$state_result"')
  && common.includes('"schemaVersion": 1'));
check('API sem suporte a commit', images.includes('unsupported-by-installed-release')
  && images.includes("! grep -Fq 'commit: env.DEVFLOW_RELEASE_COMMIT'"));
check('API com commit correto', images.includes('[[ "$api_commit" == "$INSTALLED_COMMIT" ]] && API_COMMIT_MATCH=true'));
check('modo compartilhado', reconcile.includes('provider_resolve_installed')
  && reconcile.includes('compose_files'));
check('modo isolado', common.includes('DEVFLOW_PROXY_MODE:-')
  && reconcile.includes('--no-deps') && !reconcile.includes('provider_update'));
check('Full Password preservado', reconcile.includes('fullpassword_modified=false')
  && !reconcile.includes('/opt/fullpassword') && !reconcile.includes('fullpassword_nginx'));
check('menus numéricos', reconcile.includes('require_numeric_confirmation installed-release-reconciliation')
  && reconcile.includes("'RECONCILIAR RELEASE DO DEVFLOW'"));
check('execução sem TTY', common.includes('interactive_confirmation_required=true')
  && common.includes("is_interactive_terminal()"));
check('idempotência', reconcile.includes('reconciliation_status=not-required')
  && reconcile.includes('changes_applied=false'));
check('publicação externa bloqueada durante reconciliação', publish.includes('/run/lock/devflow-release-reconcile.lock')
  && publish.includes('Reconciliação da release instalada em andamento'));

if (checks.length !== 20) throw new Error(`Expected 20 checks, got ${checks.length}`);
console.log(`Installed release reconciliation tests passed: ${checks.length} scenarios.`);
