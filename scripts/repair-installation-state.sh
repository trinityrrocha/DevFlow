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

recorded_version="$(installation_state_legacy_value "$STATE_FILE" unknown installedVersion version)"
recorded_commit="$(installation_state_legacy_value "$STATE_FILE" unknown installedCommit commit)"
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

prepare_installation_state_operational_values "$STATE_FILE"
DEVFLOW_APPLICATION_HEALTHY=true
export DEVFLOW_APPLICATION_HEALTHY

write_installation_state || die 'A gravação atômica do estado corrigido falhou.'
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
