#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=providers/provider-contract.sh
. "$SCRIPT_DIR/providers/provider-contract.sh"
# shellcheck source=lib/compose-images.sh
. "$SCRIPT_DIR/lib/compose-images.sh"

MODE=check
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) MODE=check; shift ;;
    --repair) MODE=repair; shift ;;
    --help|-h)
      printf '%s\n' \
        'Uso: sudo scripts/repair-installation-state.sh --check|--repair' \
        '' \
        '--check   reconcilia checkout, estado, imagens e API sem alterações' \
        '--repair  cria backup e corrige somente os metadados do estado'
      exit 0
      ;;
    *) die "Opção desconhecida: $1" ;;
  esac
done

require_linux
require_root
command -v flock >/dev/null 2>&1 || die 'flock é obrigatório para serializar o reparo.'
command -v python3 >/dev/null 2>&1 || die 'python3 é obrigatório para validar o schema do estado.'
exec 9>/run/lock/devflow-state-repair.lock
flock -n 9 || die 'Outro reparo do estado DevFlow está em andamento.'

STATE_FILE="$DEVFLOW_STATE_ROOT/installation.json"
STATE_BACKUP_ROOT="$DEVFLOW_INSTALL_ROOT/backups/state"
DEVFLOW_APP_ROOT="$DEVFLOW_INSTALL_ROOT/app"
DEVFLOW_INSTALLED_SOURCE_DIR="$DEVFLOW_INSTALL_ROOT/source"
[[ -f "$STATE_FILE" && ! -L "$STATE_FILE" ]] || die 'Estado instalado ausente ou inseguro.'
load_devflow_env
validate_runtime_paths
resolve_installed_release_identity "$DEVFLOW_INSTALLED_SOURCE_DIR" main >/dev/null \
  || die 'O checkout canônico instalado não possui identidade comprovável.'
DEVFLOW_VERSION="$INSTALLED_VERSION"
DEVFLOW_RELEASE_COMMIT="$INSTALLED_COMMIT"
export DEVFLOW_VERSION DEVFLOW_RELEASE_COMMIT DEVFLOW_APP_ROOT DEVFLOW_INSTALLED_SOURCE_DIR
compose_files

legacy_value() {
  local fallback="$1" key value
  shift
  for key in "$@"; do
    value="$(installation_state_value "$key" "$STATE_FILE" 2>/dev/null || true)"
    if [[ -n "$value" ]]; then
      printf '%s\n' "$value"
      return 0
    fi
  done
  printf '%s\n' "$fallback"
}

recorded_version="$(legacy_value unknown version)"
recorded_commit="$(legacy_value unknown commit)"
state_schema_valid=false
state_identity_consistent=false
installation_state_schema_valid "$STATE_FILE" && state_schema_valid=true
validate_installed_state_consistency "$STATE_FILE" >/dev/null 2>&1 && state_identity_consistent=true

application_healthy=false
if "$DEVFLOW_APP_ROOT/scripts/health.sh" --internal --quiet >/dev/null 2>&1; then
  application_healthy=true
fi
runtime_identity_valid=false
if reconcile_installed_release_runtime; then
  runtime_identity_valid=true
fi
state_consistent=false
if [[ "$state_identity_consistent" == true && "$runtime_identity_valid" == true ]]; then
  state_consistent=true
fi
repair_available=false
if [[ "$state_consistent" == false && "$application_healthy" == true \
  && "$runtime_identity_valid" == true ]]; then
  repair_available=true
fi

print_reconciliation() {
  printf '%s\n' \
    'state_file_present=true' \
    "application_healthy=$application_healthy" \
    "recorded_version=$recorded_version" \
    "recorded_commit=$recorded_commit" \
    "actual_version=$INSTALLED_VERSION" \
    "actual_commit=$INSTALLED_COMMIT" \
    "installed_ref=$INSTALLED_REF" \
    "installed_repository=$INSTALLED_REPOSITORY" \
    "installed_state_schema_valid=$state_schema_valid" \
    "backend_image_version_match=$BACKEND_IMAGE_VERSION_MATCH" \
    "backend_image_commit_match=$BACKEND_IMAGE_COMMIT_MATCH" \
    "frontend_image_version_match=$FRONTEND_IMAGE_VERSION_MATCH" \
    "frontend_image_commit_match=$FRONTEND_IMAGE_COMMIT_MATCH" \
    "api_version_match=$API_VERSION_MATCH" \
    "api_commit_match=$API_COMMIT_MATCH" \
    "state_consistent=$state_consistent" \
    "repair_available=$repair_available"
}

print_reconciliation
if [[ "$MODE" == check ]]; then
  printf 'changes_applied=false\n'
  exit 0
fi
if [[ "$state_consistent" == true ]]; then
  printf 'changes_applied=false\nrepair_status=not-required\n'
  exit 0
fi
[[ "$repair_available" == true ]] \
  || die 'O estado não pode ser reparado porque a identidade operacional não foi comprovada.'
require_numeric_confirmation installation-state-repair \
  'Estado operacional inconsistente detectado.' \
  'CORRIGIR ESTADO DO DEVFLOW'

install -d -m 0700 "$STATE_BACKUP_ROOT"
backup_file="$STATE_BACKUP_ROOT/installation-$(date -u +%Y%m%dT%H%M%SZ).json"
[[ ! -e "$backup_file" ]] || die 'Backup de estado com timestamp duplicado; repita a operação depois.'
install -m 0600 "$STATE_FILE" "$backup_file"
chown root:root "$backup_file"
sync -f "$backup_file" 2>/dev/null || true

DEVFLOW_INSTALLATION_SCOPE="$(legacy_value internal installationScope)"
DEVFLOW_APPLICATION_INSTALLED="$(legacy_value true applicationInstalled)"
DEVFLOW_EXTERNAL_PUBLICATION_ENABLED="$(legacy_value false externalPublicationEnabled)"
DEVFLOW_INFRASTRUCTURE_PROVIDER="$(legacy_value "${DEVFLOW_INFRASTRUCTURE_PROVIDER:-host-nginx}" provider infrastructure_provider)"
DEVFLOW_FRONTEND_URL="$(legacy_value "http://127.0.0.1:${DEVFLOW_HTTP_PORT:-18080}" frontendUrl)"
DEVFLOW_BACKEND_URL="$(legacy_value "http://127.0.0.1:${DEVFLOW_API_PORT:-13000}" backendUrl)"
DEVFLOW_PROXY_MIGRATION_REQUIRED="$(legacy_value true proxyMigrationRequired)"
DEVFLOW_FULLPASSWORD_MODIFIED="$(legacy_value false fullpasswordModified)"
DEVFLOW_PUBLIC_PROXY_MODIFIED="$(legacy_value false publicProxyModified)"
DEVFLOW_PROXY_MIGRATION_EXECUTED="$(legacy_value false proxyMigrationExecuted)"
DEVFLOW_CERTIFICATE_ISSUED="$(legacy_value false certificateIssued)"
DEVFLOW_PROXY_MODE="$(legacy_value "${DEVFLOW_PROXY_MODE:-shared}" proxyMode proxy_mode)"
DEVFLOW_SHARED_PROXY_ADAPTER="$(legacy_value "${DEVFLOW_SHARED_PROXY_ADAPTER:-host-nginx}" sharedProxyAdapter shared_proxy_adapter)"
DEVFLOW_DOMAIN="$(legacy_value "${DEVFLOW_DOMAIN:-internal.local}" domain)"
DEVFLOW_MIGRATION_VERSION="$(legacy_value 001_initial_schema.sql migration)"
DEVFLOW_UPDATE_CHANNEL=main
export DEVFLOW_INSTALLATION_SCOPE DEVFLOW_APPLICATION_INSTALLED \
  DEVFLOW_EXTERNAL_PUBLICATION_ENABLED DEVFLOW_INFRASTRUCTURE_PROVIDER \
  DEVFLOW_FRONTEND_URL DEVFLOW_BACKEND_URL DEVFLOW_PROXY_MIGRATION_REQUIRED \
  DEVFLOW_FULLPASSWORD_MODIFIED DEVFLOW_PUBLIC_PROXY_MODIFIED \
  DEVFLOW_PROXY_MIGRATION_EXECUTED DEVFLOW_CERTIFICATE_ISSUED DEVFLOW_PROXY_MODE \
  DEVFLOW_SHARED_PROXY_ADAPTER DEVFLOW_DOMAIN DEVFLOW_MIGRATION_VERSION \
  DEVFLOW_UPDATE_CHANNEL

write_install_report success || die 'A gravação atômica do estado corrigido falhou.'
validate_installed_state_consistency "$STATE_FILE" >/dev/null \
  || die 'O estado corrigido não corresponde ao checkout canônico.'
[[ "$(stat -c '%a:%u:%g' "$STATE_FILE")" == 600:0:0 ]] \
  || die 'O estado corrigido não possui permissões root:root 600.'
printf '%s\n' \
  "state_backup=$backup_file" \
  "final_state_version=$INSTALLED_VERSION" \
  "final_state_commit=$INSTALLED_COMMIT" \
  'final_state_identity_valid=true' \
  'state_consistent=true' \
  'repair_available=false' \
  'changes_applied=true'
