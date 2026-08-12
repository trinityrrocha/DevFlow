#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECKOUT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/compose-images.sh
. "$SCRIPT_DIR/lib/compose-images.sh"

CHECK_ONLY=false
ROLLBACK_REQUESTED=false
EXPECTED_UPDATE_VERSION=
INTERNAL_MODE="${DEVFLOW_UPDATE_INTERNAL:-false}"
DAEMON_MODE="${DEVFLOW_UPDATE_DAEMON:-false}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) CHECK_ONLY=true; shift ;;
    --rollback) ROLLBACK_REQUESTED=true; shift ;;
    --expected-version)
      [[ -n "${2:-}" ]] || die '--expected-version exige um valor.'
      EXPECTED_UPDATE_VERSION="$2"
      shift 2
      ;;
    --help|-h)
      cat <<'EOF'
Uso:
  sudo scripts/update.sh --check [--expected-version SEMVER]
  sudo scripts/update.sh [--expected-version SEMVER]

--check  consulta versão e changelog, sem backup ou alterações

Sem argumentos, executa o motor nao interativo. Use update-cli.sh para confirmacao manual.
EOF
      exit 0
      ;;
    *) die "Opção desconhecida: $1" ;;
  esac
done

[[ "$ROLLBACK_REQUESTED" == false || "$CHECK_ONLY" == false ]] \
  || die '--rollback e --check sao mutuamente exclusivos.'
[[ "$ROLLBACK_REQUESTED" == false || -z "$EXPECTED_UPDATE_VERSION" ]] \
  || die '--expected-version nao se aplica ao rollback.'
[[ -z "$EXPECTED_UPDATE_VERSION" ]] || devflow_semver_is_valid "$EXPECTED_UPDATE_VERSION" \
  || die 'Versão explicitamente esperada não atende ao contrato SemVer.'
[[ "$INTERNAL_MODE" == true || "$INTERNAL_MODE" == false ]] \
  || die 'DEVFLOW_UPDATE_INTERNAL deve ser true ou false.'
[[ "$DAEMON_MODE" == true || "$DAEMON_MODE" == false ]] \
  || die 'DEVFLOW_UPDATE_DAEMON deve ser true ou false.'
[[ "$DAEMON_MODE" == false || "$INTERNAL_MODE" == true ]] \
  || die 'DEVFLOW_UPDATE_DAEMON exige DEVFLOW_UPDATE_INTERNAL=true.'

require_linux
require_root
command -v flock >/dev/null 2>&1 || die 'flock é obrigatório para impedir atualizações concorrentes.'
command -v git >/dev/null 2>&1 || die 'Git é obrigatório para consultar o repositório de atualização.'
command -v tar >/dev/null 2>&1 || die 'tar é obrigatório para validar a consistência da release.'
command -v docker >/dev/null 2>&1 || die 'Docker não está disponível.'
docker compose version >/dev/null 2>&1 || die 'Docker Compose v2 não está disponível.'

install -d -m 0750 /run/lock/devflow
if [[ "${DEVFLOW_OPERATION_LOCK_HELD:-false}" != true ]]; then
  exec 9>/run/lock/devflow/operations.lock
  flock -n 9 || die 'Outra operacao DevFlow esta em andamento.'
fi

load_devflow_env
validate_runtime_paths
[[ "$DEVFLOW_INSTALL_ROOT" == /opt/devflow ]] || die 'Diretório instalado inesperado.'
validate_domain "$DEVFLOW_DOMAIN"
check_capacity "$DEVFLOW_INSTALL_ROOT"

SOURCE_DIR="${DEVFLOW_SOURCE_DIR:-$CHECKOUT_DIR}"
validate_safe_absolute_path "$SOURCE_DIR" 'Checkout operacional'
[[ -d "$SOURCE_DIR/.git" ]] || die "Checkout Git ausente: $SOURCE_DIR"
[[ "$(stat -c '%u' "$SOURCE_DIR")" == 0 && "$(stat -c '%u' "$SOURCE_DIR/.git")" == 0 ]] \
  || die 'O checkout operacional e seus metadados devem pertencer a root.'
source_mode="$(stat -c '%a' "$SOURCE_DIR")"
(( (8#$source_mode & 0022) == 0 )) || die 'O checkout operacional não pode ser gravável por grupo ou terceiros.'
[[ -z "$(find "$SOURCE_DIR" -xdev -perm /022 -print -quit)" ]] \
  || die 'O checkout operacional contém arquivos graváveis por grupo ou terceiros.'
[[ "$(git -C "$SOURCE_DIR" config --local --get core.hooksPath 2>/dev/null || true)" == /dev/null ]] \
  || die 'Hooks Git devem permanecer desabilitados no checkout operacional.'
[[ "$(git -C "$SOURCE_DIR" branch --show-current)" == main ]] || die 'O checkout operacional deve estar na branch main.'
if [[ -n "$(git -C "$SOURCE_DIR" status --porcelain --untracked-files=no)" ]]; then
  printf '%s\n' 'update_blocked=dirty-worktree'
  die 'O checkout operacional possui arquivos rastreados alterados.'
fi
remote_url="$(git -C "$SOURCE_DIR" remote get-url origin 2>/dev/null || true)"
case "$remote_url" in
  'https://github.com/trinityrrocha/DevFlow'|'https://github.com/trinityrrocha/DevFlow.git'|'git@github.com:trinityrrocha/DevFlow.git') ;;
  *) die 'Remote origin nao autorizado para o atualizador.' ;;
esac

OLD_RELEASE_DIR="$(readlink -f "$DEVFLOW_INSTALL_ROOT/app" 2>/dev/null || true)"
validate_safe_absolute_path "$OLD_RELEASE_DIR" 'Release instalada'
[[ "$OLD_RELEASE_DIR" == "$DEVFLOW_INSTALL_ROOT/releases/"* ]] || die 'A release instalada está fora de /opt/devflow/releases.'
DEVFLOW_INSTALLED_SOURCE_DIR="$SOURCE_DIR"
DEVFLOW_IDENTITY_RELEASE_ROOT="$OLD_RELEASE_DIR"
load_installation_state "$DEVFLOW_STATE_ROOT/installation.json" \
  || die 'Estado instalado schema v3 inconsistente; atualizacao bloqueada.'
[[ "$DEVFLOW_INSTALLATION_STATE_MODE" == isolated ]] || die 'A atualização aceita somente instalações isoladas.'
OLD_SHA="$DEVFLOW_INSTALLATION_STATE_COMMIT"
OLD_VERSION="$DEVFLOW_INSTALLATION_STATE_VERSION"
SOURCE_OLD_SHA="$(git -C "$SOURCE_DIR" rev-parse HEAD 2>/dev/null || true)"
git -C "$SOURCE_DIR" cat-file -e "$OLD_SHA^{commit}" 2>/dev/null \
  || die 'O commit instalado nao existe no checkout operacional.'
[[ "$(tr -d '\r\n' < "$OLD_RELEASE_DIR/.devflow-release" 2>/dev/null || true)" == "$OLD_SHA" ]] \
  || die 'A release ativa diverge do commit registrado.'
[[ "$(devflow_read_version_file "$OLD_RELEASE_DIR/VERSION" 2>/dev/null || true)" == "$OLD_VERSION" ]] \
  || die 'A release ativa diverge da versao registrada.'
git -C "$SOURCE_DIR" merge-base --is-ancestor "$OLD_SHA" "$SOURCE_OLD_SHA" \
  || die 'O checkout operacional nao descende da release instalada.'
INSTALLED_COMMIT="$OLD_SHA"; INSTALLED_VERSION="$OLD_VERSION"; INSTALLED_REF=main
INSTALLED_REPOSITORY="$DEVFLOW_CANONICAL_REPOSITORY_URL"
export INSTALLED_COMMIT INSTALLED_VERSION INSTALLED_REF INSTALLED_REPOSITORY
devflow_semver_is_valid "$OLD_VERSION" || die 'Versão instalada inválida.'
[[ "${DEVFLOW_VERSION:-}" == "$OLD_VERSION" ]] \
  || die 'DEVFLOW_VERSION diverge da release instalada; corrija a configuração antes de atualizar.'
if [[ "$INTERNAL_MODE" == false ]]; then
for unit_file in /etc/systemd/system/devflow-backup.service /etc/systemd/system/devflow-backup.timer; do
  [[ -f "$unit_file" ]] || die "Unidade obrigatória ausente: $unit_file"
  managed_file "$unit_file" '# Managed by DevFlow installer.' || die "$unit_file pertence a outro sistema."
done
else
  [[ -f "$DEVFLOW_STATE_ROOT/host-units.installed" ]] \
    || die 'O host nao confirmou a instalacao das unidades operacionais.'
fi
DEVFLOW_APP_ROOT="$OLD_RELEASE_DIR"
DEVFLOW_VERSION="$OLD_VERSION"
DEVFLOW_RELEASE_COMMIT="$OLD_SHA"
export DEVFLOW_APP_ROOT DEVFLOW_VERSION DEVFLOW_RELEASE_COMMIT DEVFLOW_INSTALLED_SOURCE_DIR \
  DEVFLOW_IDENTITY_RELEASE_ROOT
compose_files

run_context_health() {
  local release="$1"
  shift
  if [[ "$INTERNAL_MODE" == true ]]; then
    DEVFLOW_UPDATE_DAEMON=true "$release/scripts/health.sh" --daemon "$@"
  else
    "$release/scripts/health.sh" "$@"
  fi
}

UPDATE_SERVICES="${UPDATE_SERVICES:-db backend frontend worker edge}"
declare -a UPDATE_SERVICE_LIST=()
for service in $UPDATE_SERVICES; do
  case "$service" in
    db|backend|frontend|worker|edge) ;;
    updater) die 'O updater em execucao nao pode atualizar a si proprio.' ;;
    *) die "Servico de update nao autorizado: $service" ;;
  esac
  [[ " ${UPDATE_SERVICE_LIST[*]} " != *" $service "* ]] && UPDATE_SERVICE_LIST+=("$service")
done
[[ ${#UPDATE_SERVICE_LIST[@]} -gt 0 ]] || die 'A allowlist interna de servicos esta vazia.'
for required_service in db backend frontend worker edge; do
  [[ " ${UPDATE_SERVICE_LIST[*]} " == *" $required_service "* ]] \
    || die "Servico obrigatorio ausente da allowlist interna: $required_service"
done

compose_has_worker() {
  "${DEVFLOW_COMPOSE[@]}" config --services 2>/dev/null | grep -Fxq worker
}

stop_runtime_services() {
  local services=(backend frontend)
  compose_has_worker && services=(backend worker frontend)
  "${DEVFLOW_COMPOSE[@]}" stop "${services[@]}"
}

up_runtime_services() {
  local services=(db backend frontend)
  compose_has_worker && services=(db backend worker frontend)
  "${DEVFLOW_COMPOSE[@]}" up -d --wait "$@" "${services[@]}"
}

refresh_updater_runtime_external() {
  [[ "$INTERNAL_MODE" == false ]] || return 0
  set_compose_for "$CANDIDATE_DIR"
  "${DEVFLOW_COMPOSE[@]}" up -d --wait --no-deps --force-recreate updater
  docker exec devflow-updater test -f /var/lib/devflow/updater/daemon.ready
}
validate_installed_release_runtime \
  || die 'Identidade da release instalada diverge das imagens ou da API; atualização bloqueada.'
run_context_health "$OLD_RELEASE_DIR" \
  || die 'Pre-update health da release instalada falhou; atualizacao bloqueada.'
"${DEVFLOW_COMPOSE[@]}" exec -T db sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null \
  || die 'Banco instalado nao esta saudavel.'

TEMP_REMOTE_REPO=
if [[ "$ROLLBACK_REQUESTED" == false && "$CHECK_ONLY" == true ]]; then
  TEMP_REMOTE_REPO="$(mktemp -d "${TMPDIR:-/tmp}/devflow-update-check.XXXXXX")"
  cleanup_remote_check() { rm -rf -- "$TEMP_REMOTE_REPO"; }
  trap cleanup_remote_check EXIT INT TERM
  git -C "$TEMP_REMOTE_REPO" init --bare --quiet
  git -C "$TEMP_REMOTE_REPO" remote add origin "$remote_url"
  GIT_TERMINAL_PROMPT=0 git -C "$TEMP_REMOTE_REPO" fetch --quiet origin main
  REMOTE_REPO="$TEMP_REMOTE_REPO"
  REMOTE_REF=FETCH_HEAD
  UPDATE_LOG=not-created-check-only
elif [[ "$ROLLBACK_REQUESTED" == false ]]; then
  install -d -m 0750 "$DEVFLOW_LOG_ROOT" "$DEVFLOW_STATE_ROOT" "$DEVFLOW_INSTALL_ROOT/releases"
  UPDATE_LOG="$DEVFLOW_LOG_ROOT/update-$(date -u +%Y%m%dT%H%M%SZ).log"
  touch "$UPDATE_LOG"
  chmod 0640 "$UPDATE_LOG"
  exec > >(redact_stream | tee -a "$UPDATE_LOG") 2>&1
  GIT_TERMINAL_PROMPT=0 git -C "$SOURCE_DIR" checkout main
  GIT_TERMINAL_PROMPT=0 git -C "$SOURCE_DIR" fetch origin main
  REMOTE_REPO="$SOURCE_DIR"
  REMOTE_REF=origin/main
fi

log INFO "Iniciando verificação de atualização a partir de $OLD_VERSION ($OLD_SHA)."
if [[ "$ROLLBACK_REQUESTED" == false ]]; then
NEW_SHA="$(git -C "$REMOTE_REPO" rev-parse "$REMOTE_REF")"
[[ "$NEW_SHA" =~ ^[0-9a-f]{40}$ ]] || die 'Commit remoto inválido.'
git -C "$REMOTE_REPO" merge-base --is-ancestor "$OLD_SHA" "$NEW_SHA" \
  || die 'origin/main não é uma continuação fast-forward da release instalada.'
NEW_VERSION="$(devflow_validate_git_tree_version_consistency "$REMOTE_REPO" "$NEW_SHA" 2>/dev/null || true)"
devflow_semver_is_valid "$NEW_VERSION" || die 'version_consistency=false; release remota ausente, inválida ou divergente.'
if [[ -n "$EXPECTED_UPDATE_VERSION" && "$NEW_VERSION" != "$EXPECTED_UPDATE_VERSION" ]]; then
  devflow_version_mismatch_message main "$EXPECTED_UPDATE_VERSION" "$NEW_VERSION" "$NEW_SHA" >&2
  exit 1
fi

printf '%s\n' \
  "installed_version=$OLD_VERSION" \
  "installed_commit=$OLD_SHA" \
  "available_version=$NEW_VERSION" \
  "available_commit=$NEW_SHA" \
  "update_available=$([[ "$NEW_SHA" == "$OLD_SHA" ]] && echo false || echo true)"

if [[ "$NEW_SHA" == "$OLD_SHA" ]]; then
  log INFO 'A instalação já corresponde à versão disponível.'
  exit 0
fi
version_is_greater "$NEW_VERSION" "$OLD_VERSION" \
  || die "A versão remota $NEW_VERSION não é superior à instalada $OLD_VERSION."

CHANGELOG_CONTENT="$(git -C "$REMOTE_REPO" show "$NEW_SHA:CHANGELOG.md")"
CHANGELOG_SECTION="$(printf '%s\n' "$CHANGELOG_CONTENT" | awk -v version="$NEW_VERSION" '
  index($0, "## [" version "]") == 1 { printing=1 }
  printing && index($0, "## [") == 1 && index($0, "## [" version "]") != 1 { exit }
  printing { print }
')"
[[ -n "$CHANGELOG_SECTION" ]] || die "Changelog da versão $NEW_VERSION não encontrado."
printf '%s\n%s\n%s\n' 'changelog_begin' "$CHANGELOG_SECTION" 'changelog_end'

if [[ "$CHECK_ONLY" == true ]]; then
  log INFO 'Verificação concluída sem alterações.'
  exit 0
fi

log INFO "Motor nao interativo autorizado para atualizar $OLD_VERSION para $NEW_VERSION."

else
  install -d -m 0750 "$DEVFLOW_LOG_ROOT" "$DEVFLOW_STATE_ROOT" "$DEVFLOW_INSTALL_ROOT/releases"
  UPDATE_LOG="$DEVFLOW_LOG_ROOT/update-rollback-$(date -u +%Y%m%dT%H%M%SZ).log"
  touch "$UPDATE_LOG"
  chmod 0640 "$UPDATE_LOG"
  exec > >(redact_stream | tee -a "$UPDATE_LOG") 2>&1
fi

UPDATE_TRANSACTION_FILE="$DEVFLOW_STATE_ROOT/update-transaction.json"
if [[ "$ROLLBACK_REQUESTED" == true ]]; then
  python3 "$SCRIPT_DIR/validate-update-transaction.py" validate "$UPDATE_TRANSACTION_FILE" >/dev/null \
    || die 'A ultima atualizacao nao possui transacao schema v3 valida.'
  [[ "$(installation_state_value result "$UPDATE_TRANSACTION_FILE" 2>/dev/null || true)" == success ]] \
    || die 'A ultima atualizacao nao possui transacao concluida apta a rollback.'
  CURRENT_VERSION="$OLD_VERSION"
  CURRENT_SHA="$OLD_SHA"
  CURRENT_RELEASE_DIR="$OLD_RELEASE_DIR"
  NEW_VERSION="$(installation_state_value candidateVersion "$UPDATE_TRANSACTION_FILE")"
  NEW_SHA="$(installation_state_value candidateCommit "$UPDATE_TRANSACTION_FILE")"
  [[ "$NEW_VERSION" == "$CURRENT_VERSION" && "$NEW_SHA" == "$CURRENT_SHA" ]] \
    || die 'A transacao nao corresponde a release atualmente instalada.'
  OLD_VERSION="$(installation_state_value previousVersion "$UPDATE_TRANSACTION_FILE")"
  OLD_SHA="$(installation_state_value previousCommit "$UPDATE_TRANSACTION_FILE")"
  OLD_RELEASE_DIR="$(installation_state_value previousRelease "$UPDATE_TRANSACTION_FILE")"
  validate_safe_absolute_path "$OLD_RELEASE_DIR" 'Release anterior'
  [[ "$OLD_RELEASE_DIR" == "$DEVFLOW_INSTALL_ROOT/releases/"* && -d "$OLD_RELEASE_DIR" ]] \
    || die 'Release anterior registrada esta ausente.'
  CANDIDATE_DIR="$CURRENT_RELEASE_DIR"
else
  CANDIDATE_DIR="$DEVFLOW_INSTALL_ROOT/releases/$NEW_SHA"
fi
CANDIDATE_TEMP=
CANDIDATE_CREATED="$ROLLBACK_REQUESTED"
ROLLBACK_ARMED="$ROLLBACK_REQUESTED"
MAINTENANCE_ACTIVE=false
SOURCE_ADVANCED="$ROLLBACK_REQUESTED"
BACKUP_TIMER_PAUSED=false
UPDATE_PHASE=prepared
[[ "$ROLLBACK_REQUESTED" == false ]] || UPDATE_PHASE=manual-rollback
ROLLBACK_RESULT=not-required
if [[ "$ROLLBACK_REQUESTED" == false ]]; then
  TRANSACTION_ID="$(openssl rand -hex 16)"
  TRANSACTION_TIMESTAMP="$(timestamp)"
  TRANSACTION_RESULT=in-progress
  ROOT_CAUSE=none
  MANUAL_RECOVERY_REQUIRED=false
  PREVIOUS_MIGRATION="$DEVFLOW_INSTALLATION_STATE_MIGRATION"
  PREVIOUS_APP_TARGET="$OLD_RELEASE_DIR"
  PREVIOUS_STATE_SNAPSHOT="$DEVFLOW_STATE_ROOT/update-previous-installation-$TRANSACTION_ID.json"
  PREVIOUS_STATE_HASH=pending
  OLD_IMAGE_TAG="${DEVFLOW_IMAGE_TAG:-latest}"
  PREVIOUS_BACKEND_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$(resolve_compose_service_image backend)" 2>/dev/null || true)"
  PREVIOUS_FRONTEND_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$(resolve_compose_service_image frontend)" 2>/dev/null || true)"
  [[ "$PREVIOUS_BACKEND_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ \
    && "$PREVIOUS_FRONTEND_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]] \
    || die 'As imagens instaladas anteriores nao puderam ser identificadas.'
  CANDIDATE_MIGRATION=pending
  CANDIDATE_IMAGE_TAG="candidate-$NEW_SHA"
  FINAL_IMAGE_TAG="release-$NEW_SHA"
  CHANGES_APPLIED=false
  DATABASE_MUTATED=false
  MANUAL_DATA_RESTORE_MAY_BE_REQUIRED=false
  CANDIDATE_HEALTH_PASSED=false
  RELEASE_PROMOTED=false
  STATE_PROMOTED=false
else
  TRANSACTION_ID="$(installation_state_value transactionId "$UPDATE_TRANSACTION_FILE")"
  TRANSACTION_TIMESTAMP="$(installation_state_value timestamp "$UPDATE_TRANSACTION_FILE")"
  PREVIOUS_MIGRATION="$(installation_state_value previousMigration "$UPDATE_TRANSACTION_FILE")"
  PREVIOUS_APP_TARGET="$(installation_state_value previousAppTarget "$UPDATE_TRANSACTION_FILE")"
  PREVIOUS_STATE_SNAPSHOT="$(installation_state_value previousInstallationStateBackup "$UPDATE_TRANSACTION_FILE")"
  PREVIOUS_STATE_HASH="$(installation_state_value previousInstallationStateHash "$UPDATE_TRANSACTION_FILE")"
  OLD_IMAGE_TAG="$(installation_state_value previousImageTag "$UPDATE_TRANSACTION_FILE")"
  PREVIOUS_BACKEND_IMAGE_ID="$(installation_state_value previousBackendImageId "$UPDATE_TRANSACTION_FILE")"
  PREVIOUS_FRONTEND_IMAGE_ID="$(installation_state_value previousFrontendImageId "$UPDATE_TRANSACTION_FILE")"
  CANDIDATE_MIGRATION="$(installation_state_value candidateMigration "$UPDATE_TRANSACTION_FILE")"
  CANDIDATE_IMAGE_TAG="$(installation_state_value candidateImageTag "$UPDATE_TRANSACTION_FILE")"
  FINAL_IMAGE_TAG="$(installation_state_value finalImageTag "$UPDATE_TRANSACTION_FILE")"
  CHANGES_APPLIED="$(installation_state_value changesApplied "$UPDATE_TRANSACTION_FILE")"
  DATABASE_MUTATED="$(installation_state_value databaseMutated "$UPDATE_TRANSACTION_FILE")"
  MANUAL_DATA_RESTORE_MAY_BE_REQUIRED="$(installation_state_value manualDataRestoreMayBeRequired "$UPDATE_TRANSACTION_FILE")"
  CANDIDATE_HEALTH_PASSED=true
  RELEASE_PROMOTED=true
  STATE_PROMOTED=true
  TRANSACTION_RESULT=in-progress
  ROOT_CAUSE=manual-rollback
  MANUAL_RECOVERY_REQUIRED=false
fi
ROLLBACK_STARTED=false
DATABASE_RESTORED=false
RELEASE_RESTORED=false
STATE_RESTORED=false
ROLLBACK_HEALTH_PASSED=false

UPDATE_STATUS_FILE="${DEVFLOW_UPDATE_STATUS_FILE:-}"
if [[ -n "$UPDATE_STATUS_FILE" ]]; then
  [[ "$INTERNAL_MODE" == true && "$UPDATE_STATUS_FILE" == /var/lib/devflow/updater/status/*.json ]] \
    || die 'Arquivo de status do update invalido.'
  [[ -r "$SCRIPT_DIR/write-update-status.mjs" ]] || die 'Gravador de status do update ausente.'
fi

set_update_status() {
  local state="$1"
  [[ -z "$UPDATE_STATUS_FILE" ]] || node "$SCRIPT_DIR/write-update-status.mjs" "$UPDATE_STATUS_FILE" "$state"
}
set_update_status processing

pause_backup_schedule() {
  [[ "$INTERNAL_MODE" == true ]] && return 0
  systemctl stop devflow-backup.timer
  BACKUP_TIMER_PAUSED=true
  if systemctl is-active --quiet devflow-backup.service; then
    systemctl start devflow-backup.timer || true
    BACKUP_TIMER_PAUSED=false
    return 1
  fi
}

refresh_host_units() {
  local release="$1" unit_name
  [[ "$INTERNAL_MODE" == true ]] && return 0
  for unit_name in devflow-backup.service devflow-backup.timer \
    devflow-certificate-renewal.service devflow-certificate-renewal.timer; do
    install -m 0644 "$release/scripts/systemd/$unit_name" "/etc/systemd/system/$unit_name" || return 1
  done
  systemctl daemon-reload
  systemctl enable --now devflow-backup.timer devflow-certificate-renewal.timer
  BACKUP_TIMER_PAUSED=false
}

write_update_transaction() {
  local phase="$1" validator
  UPDATE_PHASE="$phase"
  validator="$SCRIPT_DIR/validate-update-transaction.py"
  [[ -r "$validator" ]] || return 1
  {
    printf '{\n'
    printf '  "schemaVersion": 3,\n'
    printf '  "transactionId": "%s",\n' "$TRANSACTION_ID"
    printf '  "timestamp": "%s",\n' "$TRANSACTION_TIMESTAMP"
    printf '  "phase": "%s",\n' "$UPDATE_PHASE"
    printf '  "result": "%s",\n' "$TRANSACTION_RESULT"
    printf '  "previousVersion": "%s",\n' "$OLD_VERSION"
    printf '  "previousCommit": "%s",\n' "$OLD_SHA"
    printf '  "previousRelease": "%s",\n' "$OLD_RELEASE_DIR"
    printf '  "previousAppTarget": "%s",\n' "$PREVIOUS_APP_TARGET"
    printf '  "previousMigration": "%s",\n' "$PREVIOUS_MIGRATION"
    printf '  "previousInstallationStateBackup": "%s",\n' "$PREVIOUS_STATE_SNAPSHOT"
    printf '  "previousInstallationStateHash": "%s",\n' "$PREVIOUS_STATE_HASH"
    printf '  "previousImageTag": "%s",\n' "$OLD_IMAGE_TAG"
    printf '  "previousBackendImageId": "%s",\n' "$PREVIOUS_BACKEND_IMAGE_ID"
    printf '  "previousFrontendImageId": "%s",\n' "$PREVIOUS_FRONTEND_IMAGE_ID"
    printf '  "candidateVersion": "%s",\n' "$NEW_VERSION"
    printf '  "candidateCommit": "%s",\n' "$NEW_SHA"
    printf '  "candidateRelease": "%s",\n' "$CANDIDATE_DIR"
    printf '  "candidateMigration": "%s",\n' "$CANDIDATE_MIGRATION"
    printf '  "candidateImageTag": "%s",\n' "$CANDIDATE_IMAGE_TAG"
    printf '  "finalImageTag": "%s",\n' "$FINAL_IMAGE_TAG"
    printf '  "changesApplied": %s,\n' "$CHANGES_APPLIED"
    printf '  "databaseMutated": %s,\n' "$DATABASE_MUTATED"
    printf '  "manualDataRestoreMayBeRequired": %s,\n' "$MANUAL_DATA_RESTORE_MAY_BE_REQUIRED"
    printf '  "candidateHealthPassed": %s,\n' "$CANDIDATE_HEALTH_PASSED"
    printf '  "releasePromoted": %s,\n' "$RELEASE_PROMOTED"
    printf '  "statePromoted": %s,\n' "$STATE_PROMOTED"
    printf '  "rollbackStarted": %s,\n' "$ROLLBACK_STARTED"
    printf '  "databaseRestored": %s,\n' "$DATABASE_RESTORED"
    printf '  "releaseRestored": %s,\n' "$RELEASE_RESTORED"
    printf '  "stateRestored": %s,\n' "$STATE_RESTORED"
    printf '  "rollbackHealthPassed": %s,\n' "$ROLLBACK_HEALTH_PASSED"
    printf '  "rollbackStatus": "%s",\n' "$ROLLBACK_RESULT"
    printf '  "rootCause": "%s",\n' "$ROOT_CAUSE"
    printf '  "manualRecoveryRequired": %s\n' "$MANUAL_RECOVERY_REQUIRED"
    printf '}\n'
  } | python3 "$validator" write "$UPDATE_TRANSACTION_FILE"
  python3 "$validator" validate "$UPDATE_TRANSACTION_FILE" >/dev/null
}

persist_operational_installation_state() {
  DEVFLOW_APPLICATION_INSTALLED=true
  DEVFLOW_APPLICATION_HEALTHY=true
  DEVFLOW_CERTIFICATE_ISSUED="$DEVFLOW_INSTALLATION_STATE_CERTIFICATE_ISSUED"
  ADMIN_EMAIL="$DEVFLOW_INSTALLATION_STATE_ADMIN_EMAIL"
  DEVFLOW_MIGRATION_VERSION="${DEVFLOW_MIGRATION_VERSION:-$DEVFLOW_INSTALLATION_STATE_MIGRATION}"
  export DEVFLOW_APPLICATION_INSTALLED DEVFLOW_APPLICATION_HEALTHY \
    DEVFLOW_CERTIFICATE_ISSUED ADMIN_EMAIL DEVFLOW_MIGRATION_VERSION
  write_installation_state
}

write_update_report() {
  local result="$1" rollback_status="$ROLLBACK_RESULT"
  [[ "$rollback_status" != success ]] || rollback_status=successful
  {
    printf 'DevFlow update report\n'
    printf 'timestamp=%s\n' "$(timestamp)"
    printf 'result=%s\n' "$result"
    printf 'phase=%s\n' "$UPDATE_PHASE"
    printf 'from_version=%s\n' "$OLD_VERSION"
    printf 'to_version=%s\n' "$NEW_VERSION"
    printf 'from_commit=%s\n' "$OLD_SHA"
    printf 'to_commit=%s\n' "$NEW_SHA"
    printf 'automatic_backup=disabled\n'
    printf 'database_mutated=%s\n' "$DATABASE_MUTATED"
    printf 'manual_data_restore_may_be_required=%s\n' "$MANUAL_DATA_RESTORE_MAY_BE_REQUIRED"
    printf 'rollback_status=%s\n' "$rollback_status"
    printf 'log=%s\n' "$UPDATE_LOG"
  } > "$DEVFLOW_STATE_ROOT/update-report.txt"
  chmod 0640 "$DEVFLOW_STATE_ROOT/update-report.txt"
}

set_compose_for() {
  DEVFLOW_APP_ROOT="$1"
  compose_files
}

maintenance_compose_for() {
  local root="$1"
  build_devflow_compose_command "$root" "$DEVFLOW_ENV_FILE" DEVFLOW_MAINTENANCE_COMPOSE \
    devflow-maintenance maintenance \
    || die 'Não foi possível montar o Compose de manutenção com a configuração privada.'
}

maintenance_http_ok() {
  local status resolve_ip=127.0.0.1
  if [[ "$INTERNAL_MODE" == true ]]; then
    resolve_ip="$(docker inspect --format '{{(index .NetworkSettings.Networks "devflow_edge").IPAddress}}' devflow-maintenance 2>/dev/null || true)"
  fi
  validate_ipv4 "$resolve_ip" || return 1
  status="$(curl --resolve "$DEVFLOW_DOMAIN:443:$resolve_ip" --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --max-time 20 "https://$DEVFLOW_DOMAIN/" || true)"
  [[ "$status" == 503 ]]
}

enter_maintenance() {
  local root="$1"
  log INFO 'Ativando modo de manutenção.'
  set_compose_for "$OLD_RELEASE_DIR"
  "${DEVFLOW_COMPOSE[@]}" stop edge >/dev/null 2>&1 || true
  if [[ -r "$CANDIDATE_DIR/docker-compose.yml" ]]; then
    set_compose_for "$CANDIDATE_DIR"
    "${DEVFLOW_COMPOSE[@]}" stop edge >/dev/null 2>&1 || true
  fi
  maintenance_compose_for "$root"
  "${DEVFLOW_MAINTENANCE_COMPOSE[@]}" up -d --wait
  MAINTENANCE_ACTIVE=true
  maintenance_http_ok || return 1
  log INFO 'Modo de manutenção confirmado com HTTP 503.'
}

restore_proxy_for() {
  local root="$1"
  maintenance_compose_for "$CANDIDATE_DIR"
  "${DEVFLOW_MAINTENANCE_COMPOSE[@]}" down --remove-orphans
  set_compose_for "$root"
  "${DEVFLOW_COMPOSE[@]}" up -d edge --wait
}

rollback_update() {
  local rollback_failures=0 restored_migration state_temporary
  set +e
  set_update_status rollback || true
  ROLLBACK_STARTED=true
  ROLLBACK_RESULT=in-progress
  TRANSACTION_RESULT=in-progress
  MANUAL_RECOVERY_REQUIRED=false
  [[ "$ROOT_CAUSE" != none ]] || ROOT_CAUSE="${UPDATE_PHASE}-failed"
  write_update_transaction rollback-started || rollback_failures=$((rollback_failures + 1))
  log ERROR "Falha na fase $UPDATE_PHASE. Iniciando rollback automático."
  if ! python3 "$SCRIPT_DIR/validate-update-transaction.py" validate "$UPDATE_TRANSACTION_FILE" >/dev/null \
    || [[ "$(installation_state_value previousCommit "$UPDATE_TRANSACTION_FILE" 2>/dev/null || true)" != "$OLD_SHA" ]] \
    || ! git -C "$SOURCE_DIR" cat-file -e "$OLD_SHA^{commit}" 2>/dev/null; then
    ROLLBACK_RESULT=failed
    TRANSACTION_RESULT=failed
    ROOT_CAUSE=transaction-identity-invalid
    MANUAL_RECOVERY_REQUIRED=true
    write_update_transaction rollback-failed || true
    log ERROR 'A identidade transacional do rollback nao foi comprovada.'
    return 1
  fi

  enter_maintenance "$CANDIDATE_DIR"
  if [[ $? -ne 0 ]]; then
    ROLLBACK_RESULT=failed; TRANSACTION_RESULT=failed; ROOT_CAUSE=maintenance-unavailable
    MANUAL_RECOVERY_REQUIRED=true
    write_update_transaction rollback-failed || true
    return 1
  fi

  UPDATE_PHASE=rollback-stop-writers
  set_compose_for "$CANDIDATE_DIR"
  "${DEVFLOW_COMPOSE[@]}" stop backend worker frontend >/dev/null 2>&1
  if [[ $? -ne 0 ]]; then
    ROLLBACK_RESULT=failed; TRANSACTION_RESULT=failed; ROOT_CAUSE=writers-not-stopped
    MANUAL_RECOVERY_REQUIRED=true
    write_update_transaction rollback-failed || true
    return 1
  fi

  set_managed_env_value DEVFLOW_VERSION "$OLD_VERSION" || rollback_failures=$((rollback_failures + 1))
  set_managed_env_value DEVFLOW_RELEASE_COMMIT "$OLD_SHA" || rollback_failures=$((rollback_failures + 1))
  set_managed_env_value DEVFLOW_IMAGE_TAG "rollback-$OLD_SHA" || rollback_failures=$((rollback_failures + 1))
  DEVFLOW_VERSION="$OLD_VERSION"
  DEVFLOW_RELEASE_COMMIT="$OLD_SHA"
  DEVFLOW_IMAGE_TAG="rollback-$OLD_SHA"
  DEVFLOW_IDENTITY_RELEASE_ROOT="$OLD_RELEASE_DIR"
  DEVFLOW_EXPLICIT_RELEASE_IDENTITY=true
  export DEVFLOW_VERSION DEVFLOW_RELEASE_COMMIT DEVFLOW_IMAGE_TAG \
    DEVFLOW_IDENTITY_RELEASE_ROOT DEVFLOW_EXPLICIT_RELEASE_IDENTITY
  docker tag "$PREVIOUS_BACKEND_IMAGE_ID" "devflow-backend:rollback-$OLD_SHA" \
    || rollback_failures=$((rollback_failures + 1))
  docker tag "$PREVIOUS_FRONTEND_IMAGE_ID" "devflow-frontend:rollback-$OLD_SHA" \
    || rollback_failures=$((rollback_failures + 1))
  if [[ "$rollback_failures" -ne 0 ]]; then
    ROLLBACK_RESULT=failed; TRANSACTION_RESULT=failed; ROOT_CAUSE=previous-images-unavailable
    MANUAL_RECOVERY_REQUIRED=true
    write_update_transaction rollback-failed || true
    return 1
  fi

  UPDATE_PHASE=rollback-data-boundary
  write_update_transaction rollback-data-boundary || true
  if [[ "$DATABASE_MUTATED" == true ]]; then
    MANUAL_DATA_RESTORE_MAY_BE_REQUIRED=true
    printf '%s\n' 'database_mutated=true' 'manual_data_restore_may_be_required=true'
    log WARN 'Migrations podem ter alterado dados; nenhum restore automatico foi executado.'
  else
    printf '%s\n' 'database_mutated=false' 'manual_data_restore_may_be_required=false'
  fi

  UPDATE_PHASE=rollback-release-state
  if replace_devflow_app_symlink_atomically "$OLD_RELEASE_DIR"; then
    RELEASE_RESTORED=true
  else
    rollback_failures=$((rollback_failures + 1))
  fi
  if ! installation_state_schema_valid "$PREVIOUS_STATE_SNAPSHOT" \
    || [[ "$(sha256sum "$PREVIOUS_STATE_SNAPSHOT" | awk '{print $1}')" != "$PREVIOUS_STATE_HASH" ]]; then
    rollback_failures=$((rollback_failures + 1))
  else
    state_temporary="$(mktemp "$DEVFLOW_STATE_ROOT/.installation-rollback.XXXXXX")"
    if install -m 0600 "$PREVIOUS_STATE_SNAPSHOT" "$state_temporary" \
      && mv -f -- "$state_temporary" "$DEVFLOW_STATE_ROOT/installation.json"; then
      STATE_RESTORED=true
    else
      rm -f -- "$state_temporary"
      rollback_failures=$((rollback_failures + 1))
    fi
  fi
  rm -f -- "$DEVFLOW_INSTALL_ROOT/app.candidate"
  write_version_state "$OLD_SHA" || rollback_failures=$((rollback_failures + 1))
  write_update_transaction release-state-restored \
    || rollback_failures=$((rollback_failures + 1))
  if [[ "$rollback_failures" -ne 0 ]]; then
    ROLLBACK_RESULT=failed; TRANSACTION_RESULT=failed; ROOT_CAUSE=release-state-not-restored
    MANUAL_RECOVERY_REQUIRED=true
    write_update_transaction rollback-failed || true
    return 1
  fi

  UPDATE_PHASE=rollback-containers
  set_compose_for "$OLD_RELEASE_DIR"
  if ! compose_has_worker; then
    docker rm -f devflow-worker >/dev/null 2>&1 || true
  fi
  up_runtime_services --remove-orphans
  [[ $? -eq 0 ]] || { log ERROR 'Containers anteriores não ficaram saudáveis.'; rollback_failures=$((rollback_failures + 1)); }
  DEVFLOW_APP_ROOT="$OLD_RELEASE_DIR" DEVFLOW_UPDATE_DAEMON=false \
    "$OLD_RELEASE_DIR/scripts/health.sh" --internal
  [[ $? -eq 0 ]] || { log ERROR 'Health check interno da release anterior falhou.'; rollback_failures=$((rollback_failures + 1)); }
  if [[ "$rollback_failures" -ne 0 ]]; then
    ROLLBACK_RESULT=failed; TRANSACTION_RESULT=failed; ROOT_CAUSE=rollback-internal-health-failed
    MANUAL_RECOVERY_REQUIRED=true
    write_update_transaction rollback-failed || true
    enter_maintenance "$OLD_RELEASE_DIR" || true
    MAINTENANCE_ACTIVE=true
    return 1
  fi

  UPDATE_PHASE=rollback-proxy
  render_runtime_nginx_config "$OLD_RELEASE_DIR" "$DEVFLOW_NGINX_CONFIG_PATH"
  restore_proxy_for "$OLD_RELEASE_DIR"
  [[ $? -eq 0 ]] || { log ERROR 'Não foi possível restaurar o proxy anterior.'; rollback_failures=$((rollback_failures + 1)); }
  MAINTENANCE_ACTIVE=false
  DEVFLOW_APP_ROOT="$OLD_RELEASE_DIR" \
    run_context_health "$OLD_RELEASE_DIR"
  [[ $? -eq 0 ]] || { log ERROR 'Health check público após rollback falhou.'; rollback_failures=$((rollback_failures + 1)); }

  if ! refresh_host_units "$OLD_RELEASE_DIR"; then
    log ERROR 'Nao foi possivel restaurar as unidades operacionais do host.'
    rollback_failures=$((rollback_failures + 1))
  fi

  if [[ "$rollback_failures" -eq 0 && "$CANDIDATE_CREATED" == true && "$CANDIDATE_DIR" == "$DEVFLOW_INSTALL_ROOT/releases/"* ]]; then
    rm -rf -- "$CANDIDATE_DIR"
    [[ $? -eq 0 ]] || { log ERROR 'Não foi possível remover a release candidata rejeitada.'; rollback_failures=$((rollback_failures + 1)); }
  fi

  if [[ "$rollback_failures" -eq 0 ]]; then
    ROLLBACK_HEALTH_PASSED=true
    ROLLBACK_RESULT=successful
    TRANSACTION_RESULT=rolled-back
    ROOT_CAUSE=none
    MANUAL_RECOVERY_REQUIRED=false
    write_update_transaction rollback-completed || rollback_failures=$((rollback_failures + 1))
    log WARN 'rollback_status=successful'
    log WARN "Rollback concluído. DevFlow retornou a $OLD_VERSION ($OLD_SHA)."
  else
    ROLLBACK_RESULT=failed
    TRANSACTION_RESULT=failed
    MANUAL_RECOVERY_REQUIRED=true
    [[ "$ROOT_CAUSE" != none ]] || ROOT_CAUSE=rollback-health-failed
    write_update_transaction rollback-failed || true
    enter_maintenance "$OLD_RELEASE_DIR" || true
    MAINTENANCE_ACTIVE=true
    log ERROR 'rollback_status=failed'
    log ERROR "Rollback terminou com $rollback_failures falha(s); mantenha o ambiente isolado e use $UPDATE_LOG."
  fi
  set -e
  [[ "$rollback_failures" -eq 0 ]]
}

update_failed() {
  local exit_code=$?
  local failed_phase="$UPDATE_PHASE"
  local report_result=failed
  [[ "$exit_code" -ne 0 ]] || return 0
  trap - EXIT ERR INT TERM
  rm -f -- "$DEVFLOW_INSTALL_ROOT/app.candidate"
  if [[ -n "$CANDIDATE_TEMP" && "$CANDIDATE_TEMP" == "$DEVFLOW_INSTALL_ROOT/releases/.candidate."* ]]; then
    rm -rf -- "$CANDIDATE_TEMP"
  fi
  if [[ "$ROLLBACK_ARMED" == false && "$CANDIDATE_CREATED" == true && "$CANDIDATE_DIR" == "$DEVFLOW_INSTALL_ROOT/releases/"* ]]; then
    rm -rf -- "$CANDIDATE_DIR"
  fi
  if [[ "$INTERNAL_MODE" == false && "$ROLLBACK_ARMED" == false && "$BACKUP_TIMER_PAUSED" == true ]]; then
    systemctl start devflow-backup.timer || true
  fi
  if [[ "$ROLLBACK_ARMED" == true ]]; then
    rollback_update || true
    [[ "$ROLLBACK_RESULT" != successful ]] || report_result=rolled-back
  else
    TRANSACTION_RESULT=failed
    ROOT_CAUSE="${failed_phase}-failed"
    MANUAL_RECOVERY_REQUIRED=false
    if [[ -n "${PREVIOUS_STATE_SNAPSHOT:-}" && -f "${PREVIOUS_STATE_SNAPSHOT:-}" ]]; then
      write_update_transaction failed-before-mutation || true
    fi
    printf '%s\n' 'changes_applied=false'
  fi
  set_update_status failed || true
  UPDATE_PHASE="$failed_phase"
  write_update_report "$report_result" || true
  log ERROR "Atualização interrompida (código $exit_code). rollback=$ROLLBACK_RESULT"
  exit "$exit_code"
}
trap update_failed EXIT
trap 'exit 130' INT TERM

if [[ "$ROLLBACK_REQUESTED" == true ]]; then
  manual_rollback_status=0
  rollback_update || manual_rollback_status=$?
  ROLLBACK_ARMED=false
  [[ "$manual_rollback_status" -eq 0 ]] || die 'Rollback manual da atualizacao nao foi concluido.'
  write_update_report manual-rollback
  trap - EXIT ERR INT TERM
  exit 0
fi

installation_state_schema_valid "$DEVFLOW_STATE_ROOT/installation.json" \
  || die 'Estado instalado nao pode ser usado como snapshot transacional.'
install -m 0600 "$DEVFLOW_STATE_ROOT/installation.json" "$PREVIOUS_STATE_SNAPSHOT"
PREVIOUS_STATE_HASH="$(sha256sum "$PREVIOUS_STATE_SNAPSHOT" | awk '{print $1}')"
[[ "$PREVIOUS_STATE_HASH" =~ ^[0-9a-f]{64}$ ]] \
  || die 'Hash do snapshot do estado instalado invalido.'
write_update_transaction prepared \
  || die 'Não foi possível registrar a identidade transacional da atualização.'
log WARN 'O update nao cria backup automaticamente; a responsabilidade pelo ponto de restauracao e do Super Admin.'

docker tag "$PREVIOUS_BACKEND_IMAGE_ID" "devflow-backend:rollback-$OLD_SHA"
docker tag "$PREVIOUS_FRONTEND_IMAGE_ID" "devflow-frontend:rollback-$OLD_SHA"
write_update_transaction images-preserved \
  || die 'Referencias imutaveis das imagens anteriores nao foram registradas.'

UPDATE_PHASE=release
[[ ! -e "$CANDIDATE_DIR" ]] \
  || die 'A release candidata já existe; preserve o ambiente e investigue a tentativa anterior antes de removê-la.'
CANDIDATE_TEMP="$(mktemp -d "$DEVFLOW_INSTALL_ROOT/releases/.candidate.$NEW_SHA.XXXXXX")"
chmod 0750 "$CANDIDATE_TEMP"
git -C "$SOURCE_DIR" archive "$NEW_SHA" | tar -x -C "$CANDIDATE_TEMP"
printf '%s\n' "$NEW_SHA" > "$CANDIDATE_TEMP/.devflow-release"
chmod 0644 "$CANDIDATE_TEMP/.devflow-release"
mv -- "$CANDIDATE_TEMP" "$CANDIDATE_DIR"
CANDIDATE_TEMP=
CANDIDATE_CREATED=true
candidate_version="$(devflow_validate_directory_version_consistency "$CANDIDATE_DIR")" \
  || die 'version_consistency=false; release candidata possui versões divergentes.'
[[ "$candidate_version" == "$NEW_VERSION" ]] || die 'Release candidata possui versão divergente.'
[[ -x "$CANDIDATE_DIR/scripts/health.sh" && -r "$CANDIDATE_DIR/docker-compose.maintenance.yml" ]] \
  || die 'Release candidata não contém os componentes transacionais obrigatórios.'
if ! pause_backup_schedule; then
  die 'Um backup agendado ainda está ativo; a atualização foi cancelada antes de qualquer mutação.'
fi
ln -sfn "$CANDIDATE_DIR" "$DEVFLOW_INSTALL_ROOT/app.candidate"
ROLLBACK_ARMED=true
CHANGES_APPLIED=true
write_update_transaction release-prepared \
  || die 'A preparacao mutavel da release candidata nao foi registrada.'

UPDATE_PHASE=source
SOURCE_ADVANCED=true
GIT_TERMINAL_PROMPT=0 git -C "$SOURCE_DIR" pull --ff-only origin main
[[ -z "$(git -C "$SOURCE_DIR" status --porcelain --untracked-files=no)" ]] || die 'Checkout ficou inconsistente após fast-forward.'
[[ "$(git -C "$SOURCE_DIR" rev-parse HEAD)" == "$NEW_SHA" ]] || die 'Checkout não atingiu o commit esperado.'

export DEVFLOW_VERSION="$NEW_VERSION"
export DEVFLOW_RELEASE_COMMIT="$NEW_SHA"
DEVFLOW_IMAGE_TAG="$CANDIDATE_IMAGE_TAG"
export DEVFLOW_IMAGE_TAG
set_compose_for "$CANDIDATE_DIR"
"${DEVFLOW_COMPOSE[@]}" config --quiet
render_runtime_nginx_config "$CANDIDATE_DIR" "$DEVFLOW_NGINX_CONFIG_PATH"
declare -a CANDIDATE_BUILD_SERVICES=(backend frontend)
[[ "$INTERNAL_MODE" == true ]] || CANDIDATE_BUILD_SERVICES+=(updater)
"${DEVFLOW_COMPOSE[@]}" build "${CANDIDATE_BUILD_SERVICES[@]}"
candidate_backend_image="$(resolve_compose_service_image backend)" \
  || die 'A imagem candidata do backend não pôde ser resolvida após a build.'
candidate_backend_image_id="$(docker image inspect --format '{{.Id}}' "$candidate_backend_image")"
candidate_expected_migration="$(find "$CANDIDATE_DIR/database/migrations" -maxdepth 1 -type f -name '*.sql' -print \
  | sed 's#.*/##' | LC_ALL=C sort | tail -n1)"
CANDIDATE_MIGRATION="$candidate_expected_migration"
write_update_transaction candidate-prepared \
  || die 'Identidade da release candidata nao foi registrada.'
candidate_expected_migration_sha256="$(sha256sum "$CANDIDATE_DIR/database/migrations/$candidate_expected_migration" | awk '{print $1}')"
candidate_image_validation_status=0
validate_backend_migration_image "$candidate_backend_image" "$candidate_expected_migration" \
  "$candidate_backend_image_id" "$candidate_expected_migration_sha256" \
  || candidate_image_validation_status=$?
case "$candidate_image_validation_status" in
  0) ;;
  40|41|43|44|45|46|47|48) die 'A imagem candidata do backend não atende ao contrato de conteúdo e permissões das migrations.' ;;
  *) die 'O runtime Docker não conseguiu validar a imagem candidata do backend.' ;;
esac

UPDATE_PHASE=maintenance
set_update_status maintenance
enter_maintenance "$CANDIDATE_DIR"

UPDATE_PHASE=migrations
set_update_status migrations
set_compose_for "$CANDIDATE_DIR"
stop_runtime_services
"${DEVFLOW_COMPOSE[@]}" up -d db --wait
"${DEVFLOW_COMPOSE[@]}" exec -T db sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
if [[ "$CANDIDATE_MIGRATION" != "$PREVIOUS_MIGRATION" ]]; then
  DATABASE_MUTATED=true
  MANUAL_DATA_RESTORE_MAY_BE_REQUIRED=true
fi
write_update_transaction migrations-starting \
  || die 'Inicio transacional das migrations nao foi registrado.'
run_devflow_migrations
DEVFLOW_MIGRATION_VERSION="$("${DEVFLOW_COMPOSE[@]}" exec -T db sh -c \
  'psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT version FROM schema_migrations ORDER BY applied_at DESC LIMIT 1"')"
[[ -n "$DEVFLOW_MIGRATION_VERSION" ]] || die 'PostgreSQL não confirmou a migration após atualização.'
[[ "$DEVFLOW_MIGRATION_VERSION" == "$CANDIDATE_MIGRATION" ]] \
  || die 'PostgreSQL nao atingiu a migration candidata esperada.'
write_update_transaction migrations-applied \
  || die 'Estado transacional das migrations nao foi registrado.'

UPDATE_PHASE=containers
set_update_status containers
up_runtime_services --force-recreate --remove-orphans

UPDATE_PHASE=health-internal
set_update_status health
DEVFLOW_APP_ROOT="$CANDIDATE_DIR" DEVFLOW_IMAGE_TAG="$CANDIDATE_IMAGE_TAG" \
  DEVFLOW_UPDATE_DAEMON="$DAEMON_MODE" \
  "$CANDIDATE_DIR/scripts/health.sh" --candidate \
    --expected-version "$NEW_VERSION" \
    --expected-commit "$NEW_SHA" \
    --expected-migration "$CANDIDATE_MIGRATION"
CANDIDATE_HEALTH_PASSED=true
write_update_transaction candidate-healthy \
  || die 'Aprovacao do health candidato nao foi registrada.'

UPDATE_PHASE=promotion
docker tag "devflow-backend:$CANDIDATE_IMAGE_TAG" "devflow-backend:$FINAL_IMAGE_TAG"
docker tag "devflow-frontend:$CANDIDATE_IMAGE_TAG" "devflow-frontend:$FINAL_IMAGE_TAG"
if [[ "$INTERNAL_MODE" == false ]]; then
  docker tag "devflow-updater:$CANDIDATE_IMAGE_TAG" "devflow-updater:$FINAL_IMAGE_TAG"
fi
set_managed_env_value DEVFLOW_VERSION "$NEW_VERSION"
set_managed_env_value DEVFLOW_RELEASE_COMMIT "$NEW_SHA"
set_managed_env_value DEVFLOW_IMAGE_TAG "$FINAL_IMAGE_TAG"
DEVFLOW_IMAGE_TAG="$FINAL_IMAGE_TAG"
export DEVFLOW_IMAGE_TAG
replace_devflow_app_symlink_atomically "$CANDIDATE_DIR" \
  || die 'Promocao atomica do symlink da release candidata falhou.'
RELEASE_PROMOTED=true

DEVFLOW_VERSION="$NEW_VERSION"
DEVFLOW_RELEASE_COMMIT="$NEW_SHA"
DEVFLOW_IDENTITY_RELEASE_ROOT="$CANDIDATE_DIR"
DEVFLOW_EXPLICIT_RELEASE_IDENTITY=true
export DEVFLOW_VERSION DEVFLOW_RELEASE_COMMIT DEVFLOW_IDENTITY_RELEASE_ROOT \
  DEVFLOW_EXPLICIT_RELEASE_IDENTITY
persist_operational_installation_state \
  || die 'Estado instalado nao pode ser promovido para a candidata.'
installation_state_schema_valid "$DEVFLOW_STATE_ROOT/installation.json" \
  || die 'Estado instalado promovido falhou na validacao schema v3.'
STATE_PROMOTED=true
write_update_transaction state-promoted \
  || die 'Promocao da release e do estado nao foi registrada.'

UPDATE_PHASE=health-installed-internal
DEVFLOW_APP_ROOT="$CANDIDATE_DIR" DEVFLOW_IMAGE_TAG="$FINAL_IMAGE_TAG" DEVFLOW_UPDATE_DAEMON=false \
  "$CANDIDATE_DIR/scripts/health.sh" --internal

UPDATE_PHASE=proxy
render_runtime_nginx_config "$CANDIDATE_DIR" "$DEVFLOW_NGINX_CONFIG_PATH"
restore_proxy_for "$CANDIDATE_DIR"
MAINTENANCE_ACTIVE=false

UPDATE_PHASE=health-public
DEVFLOW_APP_ROOT="$CANDIDATE_DIR" DEVFLOW_IMAGE_TAG="$FINAL_IMAGE_TAG" \
  run_context_health "$CANDIDATE_DIR"

UPDATE_PHASE=updater-runtime
refresh_updater_runtime_external

UPDATE_PHASE=finalize
rm -f -- "$DEVFLOW_INSTALL_ROOT/app.candidate"
refresh_host_units "$CANDIDATE_DIR"
validate_explicit_release_identity \
  || die 'Release candidata promovida nao confirmou sua identidade.'
validate_installed_release_runtime \
  || die 'Imagens ou API divergem da identidade candidata após o health.'
ROLLBACK_RESULT=not-required
TRANSACTION_RESULT=success
ROOT_CAUSE=none
write_update_transaction completed
write_update_report success
set_update_status completed
ROLLBACK_ARMED=false
trap - EXIT ERR INT TERM
log INFO "Atualização concluída: $OLD_VERSION ($OLD_SHA) -> $NEW_VERSION ($NEW_SHA)."
