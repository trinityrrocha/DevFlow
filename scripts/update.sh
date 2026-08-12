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
EXPECTED_UPDATE_VERSION=
INTERNAL_MODE="${DEVFLOW_UPDATE_INTERNAL:-false}"
DAEMON_MODE="${DEVFLOW_UPDATE_DAEMON:-false}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) CHECK_ONLY=true; shift ;;
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

--check apenas consulta VERSION e commit em origin/main.
Sem argumentos, executa o motor nao interativo. Use update-cli.sh para confirmacao manual.
O changelog e somente informativo e nunca participa da decisao de atualizar.
EOF
      exit 0
      ;;
    --rollback) die 'Rollback manual legado foi removido; o motor executa rollback operacional automatico em falhas.' ;;
    *) die "Opcao desconhecida: $1" ;;
  esac
done

[[ -z "$EXPECTED_UPDATE_VERSION" ]] || devflow_semver_is_valid "$EXPECTED_UPDATE_VERSION" \
  || die 'Versao explicitamente esperada nao atende ao contrato SemVer.'
[[ "$INTERNAL_MODE" == true || "$INTERNAL_MODE" == false ]] \
  || die 'DEVFLOW_UPDATE_INTERNAL deve ser true ou false.'
[[ "$DAEMON_MODE" == true || "$DAEMON_MODE" == false ]] \
  || die 'DEVFLOW_UPDATE_DAEMON deve ser true ou false.'
[[ "$DAEMON_MODE" == false || "$INTERNAL_MODE" == true ]] \
  || die 'DEVFLOW_UPDATE_DAEMON exige DEVFLOW_UPDATE_INTERNAL=true.'

require_linux
require_root
for command_name in flock git tar docker python3; do
  command -v "$command_name" >/dev/null 2>&1 || die "$command_name e obrigatorio para atualizar."
done
docker compose version >/dev/null 2>&1 || die 'Docker Compose v2 nao esta disponivel.'

install -d -m 0750 /run/lock/devflow
if [[ "${DEVFLOW_OPERATION_LOCK_HELD:-false}" != true ]]; then
  exec 9>/run/lock/devflow/operations.lock
  flock -n 9 || die 'Outra operacao DevFlow esta em andamento.'
fi

load_devflow_env
validate_runtime_paths
[[ "$DEVFLOW_INSTALL_ROOT" == /opt/devflow ]] || die 'Diretorio instalado inesperado.'
check_capacity "$DEVFLOW_INSTALL_ROOT"

SOURCE_DIR="${DEVFLOW_SOURCE_DIR:-$CHECKOUT_DIR}"
validate_safe_absolute_path "$SOURCE_DIR" 'Checkout operacional'
[[ -d "$SOURCE_DIR/.git" && ! -L "$SOURCE_DIR/.git" ]] || die 'Checkout Git operacional ausente.'
[[ "$(stat -c '%u' "$SOURCE_DIR")" == 0 && "$(stat -c '%u' "$SOURCE_DIR/.git")" == 0 ]] \
  || die 'O checkout operacional e seus metadados devem pertencer a root.'
source_mode="$(stat -c '%a' "$SOURCE_DIR")"
(( (8#$source_mode & 0022) == 0 )) || die 'O checkout operacional nao pode ser gravavel por grupo ou terceiros.'
[[ "$(git -C "$SOURCE_DIR" config --local --get core.hooksPath 2>/dev/null || true)" == /dev/null ]] \
  || die 'Hooks Git devem permanecer desabilitados no checkout operacional.'
[[ -z "$(git -C "$SOURCE_DIR" status --porcelain --untracked-files=no)" ]] \
  || die 'O checkout operacional possui arquivos rastreados alterados.'
[[ "$(git -C "$SOURCE_DIR" branch --show-current)" == main ]] \
  || die 'O checkout operacional deve permanecer na branch main.'
remote_url="$(git -C "$SOURCE_DIR" remote get-url origin 2>/dev/null || true)"
case "$remote_url" in
  'https://github.com/trinityrrocha/DevFlow'|'https://github.com/trinityrrocha/DevFlow.git'|'git@github.com:trinityrrocha/DevFlow.git') ;;
  *) die 'Remote origin nao autorizado para o atualizador.' ;;
esac

OLD_RELEASE_DIR="$(readlink -f "$DEVFLOW_INSTALL_ROOT/app" 2>/dev/null || true)"
valid_devflow_release_target "$OLD_RELEASE_DIR" || die 'Release ativa invalida.'
load_installation_state "$DEVFLOW_STATE_ROOT/installation.json" \
  || die 'Estado instalado schema v3 inconsistente; atualizacao bloqueada.'
OLD_SHA="$DEVFLOW_INSTALLATION_STATE_COMMIT"
OLD_VERSION="$DEVFLOW_INSTALLATION_STATE_VERSION"
[[ "$(tr -d '\r\n' < "$OLD_RELEASE_DIR/.devflow-release")" == "$OLD_SHA" ]] \
  || die 'Release ativa diverge do commit instalado.'
[[ "$(devflow_read_version_file "$OLD_RELEASE_DIR/VERSION")" == "$OLD_VERSION" ]] \
  || die 'Release ativa diverge da versao instalada.'
git -C "$SOURCE_DIR" cat-file -e "$OLD_SHA^{commit}" 2>/dev/null \
  || die 'Commit instalado nao existe no checkout operacional.'

DEVFLOW_APP_ROOT="$OLD_RELEASE_DIR"
DEVFLOW_INSTALLED_SOURCE_DIR="$SOURCE_DIR"
DEVFLOW_IDENTITY_RELEASE_ROOT="$OLD_RELEASE_DIR"
INSTALLED_COMMIT="$OLD_SHA"
INSTALLED_VERSION="$OLD_VERSION"
INSTALLED_REF=main
INSTALLED_REPOSITORY="$DEVFLOW_CANONICAL_REPOSITORY_URL"
export DEVFLOW_APP_ROOT DEVFLOW_INSTALLED_SOURCE_DIR DEVFLOW_IDENTITY_RELEASE_ROOT \
  INSTALLED_COMMIT INSTALLED_VERSION INSTALLED_REF INSTALLED_REPOSITORY
compose_files

run_context_health() {
  local release="$1"
  if [[ "$INTERNAL_MODE" == true ]]; then
    DEVFLOW_UPDATE_DAEMON=true "$release/scripts/health.sh" --daemon
  else
    "$release/scripts/health.sh"
  fi
}

set_compose_for() {
  DEVFLOW_APP_ROOT="$1"
  compose_files
}

write_status() {
  local state="$1"
  [[ -z "${DEVFLOW_UPDATE_STATUS_FILE:-}" ]] \
    || node "$SCRIPT_DIR/write-update-status.mjs" "$DEVFLOW_UPDATE_STATUS_FILE" "$state" install-update
}

run_context_health "$OLD_RELEASE_DIR" \
  || die 'Pre-update health da release instalada falhou; atualizacao bloqueada.'
"${DEVFLOW_COMPOSE[@]}" exec -T db sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null \
  || die 'Banco instalado nao esta saudavel.'

install -d -m 0750 "$DEVFLOW_LOG_ROOT" "$DEVFLOW_STATE_ROOT" "$DEVFLOW_INSTALL_ROOT/releases"
STAGING_ROOT="$(mktemp -d "$DEVFLOW_STATE_ROOT/.update-worktree.XXXXXX")"
chmod 0700 "$STAGING_ROOT"
cleanup_staging() { [[ -z "${STAGING_ROOT:-}" ]] || rm -rf -- "$STAGING_ROOT" || true; }
trap cleanup_staging EXIT INT TERM

# O pull ocorre em checkout isolado. Assim uma falha nao deixa source novo com runtime antigo.
GIT_TERMINAL_PROMPT=0 git clone --quiet --no-hardlinks "$SOURCE_DIR" "$STAGING_ROOT/source"
git -C "$STAGING_ROOT/source" remote set-url origin "$remote_url"
GIT_TERMINAL_PROMPT=0 git -C "$STAGING_ROOT/source" fetch origin main
GIT_TERMINAL_PROMPT=0 git -C "$STAGING_ROOT/source" checkout main
GIT_TERMINAL_PROMPT=0 git -C "$STAGING_ROOT/source" pull --ff-only origin main
NEW_SHA="$(git -C "$STAGING_ROOT/source" rev-parse HEAD)"
[[ "$NEW_SHA" =~ ^[0-9a-f]{40}$ ]] || die 'Commit remoto invalido.'
git -C "$STAGING_ROOT/source" merge-base --is-ancestor "$OLD_SHA" "$NEW_SHA" \
  || die 'origin/main nao e uma continuacao fast-forward da release instalada.'
NEW_VERSION="$(devflow_validate_git_tree_version_consistency "$STAGING_ROOT/source" "$NEW_SHA" 2>/dev/null || true)"
devflow_semver_is_valid "$NEW_VERSION" || die 'VERSION remoto ausente ou inconsistente.'
[[ -z "$EXPECTED_UPDATE_VERSION" || "$EXPECTED_UPDATE_VERSION" == "$NEW_VERSION" ]] \
  || die 'A versao disponivel diverge da versao esperada.'

printf '%s\n' \
  "installed_version=$OLD_VERSION" \
  "installed_commit=$OLD_SHA" \
  "available_version=$NEW_VERSION" \
  "available_commit=$NEW_SHA" \
  "update_available=$([[ "$NEW_SHA" == "$OLD_SHA" ]] && echo false || echo true)"

if [[ "$NEW_SHA" == "$OLD_SHA" ]]; then
  log INFO 'A instalacao ja corresponde a versao disponivel.'
  exit 0
fi
devflow_version_is_greater "$NEW_VERSION" "$OLD_VERSION" \
  || die 'A versao remota nao e superior a instalada.'
if [[ "$CHECK_ONLY" == true ]]; then
  log INFO 'Verificacao concluida sem alteracoes.'
  exit 0
fi

# Importa o objeto aprovado sem mover a branch instalada. A branch main avanca somente apos o health final.
GIT_TERMINAL_PROMPT=0 git -C "$SOURCE_DIR" fetch origin main
[[ "$(git -C "$SOURCE_DIR" rev-parse origin/main)" == "$NEW_SHA" ]] \
  || die 'origin/main mudou durante a preparacao; execute uma nova verificacao.'

UPDATE_LOG="$DEVFLOW_LOG_ROOT/update-$(date -u +%Y%m%dT%H%M%SZ).log"
touch "$UPDATE_LOG"
chmod 0640 "$UPDATE_LOG"
exec > >(redact_stream | tee -a "$UPDATE_LOG") 2>&1

CURRENT_STEP=prepare
MUTATION_STARTED=false
MIGRATIONS_STARTED=false
ROLLBACK_RESULT=not-required
MANUAL_RECOVERY_REQUIRED=false
NEW_RELEASE_DIR="$DEVFLOW_INSTALL_ROOT/releases/$NEW_SHA"
NEW_IMAGE_TAG="release-$NEW_SHA"
OLD_IMAGE_TAG="release-$OLD_SHA"
STATE_SNAPSHOT="$DEVFLOW_STATE_ROOT/.installation-before-update.json"
RELEASE_TEMP=
OLD_BACKEND_IMAGE_ID=
OLD_FRONTEND_IMAGE_ID=

write_report() {
  local result="$1" exit_code="${2:-0}"
  {
    printf 'result=%s\n' "$result"
    printf 'failed_step=%s\n' "$CURRENT_STEP"
    printf 'exit_code=%s\n' "$exit_code"
    printf 'installed_version=%s\n' "$OLD_VERSION"
    printf 'installed_commit=%s\n' "$OLD_SHA"
    printf 'target_version=%s\n' "$NEW_VERSION"
    printf 'target_commit=%s\n' "$NEW_SHA"
    printf 'rollback=%s\n' "$ROLLBACK_RESULT"
    printf 'manualRecoveryRequired=%s\n' "$MANUAL_RECOVERY_REQUIRED"
  } > "$DEVFLOW_STATE_ROOT/update-report.txt"
  chmod 0640 "$DEVFLOW_STATE_ROOT/update-report.txt"
}

remove_temporary_images() {
  docker image rm "devflow-backend:candidate-$NEW_SHA" "devflow-frontend:candidate-$NEW_SHA" \
    "devflow-backend:rollback-$OLD_SHA" "devflow-frontend:rollback-$OLD_SHA" >/dev/null 2>&1 || true
}

restore_source_checkout() {
  local current_source_commit rollback_source backup_source
  current_source_commit="$(git -C "$SOURCE_DIR" rev-parse HEAD 2>/dev/null || true)"
  [[ "$current_source_commit" != "$OLD_SHA" ]] || return 0
  [[ "$SOURCE_DIR" == "$DEVFLOW_INSTALL_ROOT/source" \
    && "$current_source_commit" =~ ^[0-9a-f]{40}$ \
    && -z "$(git -C "$SOURCE_DIR" status --porcelain --untracked-files=no)" ]] || return 1
  git -C "$SOURCE_DIR" merge-base --is-ancestor "$OLD_SHA" "$current_source_commit" || return 1
  rollback_source="$(mktemp -d "$DEVFLOW_INSTALL_ROOT/.source-rollback.XXXXXX")"
  backup_source="$DEVFLOW_STATE_ROOT/source-ahead-$current_source_commit"
  [[ ! -e "$backup_source" ]] || { rm -rf -- "$rollback_source"; return 1; }
  if ! git clone --quiet --no-hardlinks "$SOURCE_DIR" "$rollback_source" \
    || ! git -C "$rollback_source" remote set-url origin "$remote_url" \
    || ! git -C "$rollback_source" branch -m main source-ahead \
    || ! git -C "$rollback_source" checkout --quiet -b main "$OLD_SHA" \
    || ! git -C "$rollback_source" branch -D source-ahead >/dev/null \
    || ! git -C "$rollback_source" config core.hooksPath /dev/null; then
    rm -rf -- "$rollback_source"
    return 1
  fi
  chmod 0750 "$rollback_source"
  mv -- "$SOURCE_DIR" "$backup_source" || { rm -rf -- "$rollback_source"; return 1; }
  if ! mv -- "$rollback_source" "$SOURCE_DIR"; then
    mv -- "$backup_source" "$SOURCE_DIR" || true
    return 1
  fi
  if [[ "$(git -C "$SOURCE_DIR" rev-parse HEAD)" != "$OLD_SHA" \
    || "$(git -C "$SOURCE_DIR" branch --show-current)" != main ]]; then
    rm -rf -- "$SOURCE_DIR"
    mv -- "$backup_source" "$SOURCE_DIR" || true
    return 1
  fi
  rm -rf -- "$backup_source"
}

rollback_runtime() {
  local failures=0
  ROLLBACK_RESULT=in-progress
  write_status rolling-back || true
  log WARN "Rollback operacional iniciado apos falha em $CURRENT_STEP."
  set +e
  replace_devflow_app_symlink_atomically "$OLD_RELEASE_DIR" || failures=$((failures + 1))
  set_managed_env_value DEVFLOW_VERSION "$OLD_VERSION" || failures=$((failures + 1))
  set_managed_env_value DEVFLOW_RELEASE_COMMIT "$OLD_SHA" || failures=$((failures + 1))
  set_managed_env_value DEVFLOW_IMAGE_TAG "$OLD_IMAGE_TAG" || failures=$((failures + 1))
  install -m 0600 "$STATE_SNAPSHOT" "$DEVFLOW_STATE_ROOT/installation.json" || failures=$((failures + 1))
  DEVFLOW_VERSION="$OLD_VERSION"
  DEVFLOW_RELEASE_COMMIT="$OLD_SHA"
  DEVFLOW_IMAGE_TAG="$OLD_IMAGE_TAG"
  DEVFLOW_IDENTITY_RELEASE_ROOT="$OLD_RELEASE_DIR"
  DEVFLOW_EXPLICIT_RELEASE_IDENTITY=true
  export DEVFLOW_VERSION DEVFLOW_RELEASE_COMMIT DEVFLOW_IMAGE_TAG \
    DEVFLOW_IDENTITY_RELEASE_ROOT DEVFLOW_EXPLICIT_RELEASE_IDENTITY
  set_compose_for "$OLD_RELEASE_DIR"
  "${DEVFLOW_COMPOSE[@]}" up -d --wait --remove-orphans db backend worker frontend edge \
    || failures=$((failures + 1))
  restore_source_checkout || failures=$((failures + 1))
  run_context_health "$OLD_RELEASE_DIR" || failures=$((failures + 1))
  write_version_state "$OLD_SHA" || failures=$((failures + 1))
  if [[ "$MIGRATIONS_STARTED" == true ]]; then
    MANUAL_RECOVERY_REQUIRED=true
    log WARN 'Migrations foram iniciadas; nenhum down migration foi executado. Avaliacao manual de dados pode ser necessaria.'
  fi
  if [[ "$failures" -eq 0 ]]; then
    ROLLBACK_RESULT=successful
    rm -rf -- "$NEW_RELEASE_DIR"
    docker image rm "devflow-backend:$NEW_IMAGE_TAG" "devflow-frontend:$NEW_IMAGE_TAG" \
      "devflow-updater:$NEW_IMAGE_TAG" >/dev/null 2>&1 || true
    remove_temporary_images
    log WARN 'Rollback operacional concluido com identidade normal da release anterior.'
  else
    ROLLBACK_RESULT=failed
    MANUAL_RECOVERY_REQUIRED=true
    log ERROR "Rollback operacional terminou com $failures falha(s)."
  fi
  set -e
  [[ "$failures" -eq 0 ]]
}

update_failed() {
  local exit_code=$?
  [[ "$exit_code" -ne 0 ]] || return 0
  trap - EXIT ERR INT TERM
  if [[ "$MUTATION_STARTED" == true ]]; then
    rollback_runtime || true
  else
    [[ -z "${RELEASE_TEMP:-}" ]] || rm -rf -- "$RELEASE_TEMP"
    [[ ! -d "$NEW_RELEASE_DIR" ]] || rm -rf -- "$NEW_RELEASE_DIR"
    docker image rm "devflow-backend:$NEW_IMAGE_TAG" "devflow-frontend:$NEW_IMAGE_TAG" \
      "devflow-updater:$NEW_IMAGE_TAG" >/dev/null 2>&1 || true
  fi
  rm -f -- "$STATE_SNAPSHOT"
  write_report failed "$exit_code" || true
  write_status failed || true
  cleanup_staging
  STAGING_ROOT=
  log ERROR "Atualizacao interrompida em $CURRENT_STEP (codigo $exit_code). rollback=$ROLLBACK_RESULT"
  exit "$exit_code"
}
trap update_failed EXIT
trap 'exit 130' INT TERM

write_status processing
install -m 0600 "$DEVFLOW_STATE_ROOT/installation.json" "$STATE_SNAPSHOT"

CURRENT_STEP=preserve-images
OLD_BACKEND_IMAGE_ID="$(docker inspect --format '{{.Image}}' devflow-backend)"
OLD_FRONTEND_IMAGE_ID="$(docker inspect --format '{{.Image}}' devflow-frontend)"
docker tag "$OLD_BACKEND_IMAGE_ID" "devflow-backend:$OLD_IMAGE_TAG"
docker tag "$OLD_FRONTEND_IMAGE_ID" "devflow-frontend:$OLD_IMAGE_TAG"

CURRENT_STEP=prepare-release
[[ ! -e "$NEW_RELEASE_DIR" ]] || die 'A release de destino ja existe; investigue a tentativa anterior.'
RELEASE_TEMP="$(mktemp -d "$DEVFLOW_INSTALL_ROOT/releases/.release.$NEW_SHA.XXXXXX")"
chmod 0750 "$RELEASE_TEMP"
git -C "$STAGING_ROOT/source" archive "$NEW_SHA" | tar -x -C "$RELEASE_TEMP"
printf '%s\n' "$NEW_SHA" > "$RELEASE_TEMP/.devflow-release"
chmod 0644 "$RELEASE_TEMP/.devflow-release"
mv -- "$RELEASE_TEMP" "$NEW_RELEASE_DIR"
RELEASE_TEMP=
[[ "$(devflow_validate_directory_version_consistency "$NEW_RELEASE_DIR")" == "$NEW_VERSION" ]] \
  || die 'Release de destino possui versao inconsistente.'

CURRENT_STEP=build
DEVFLOW_VERSION="$NEW_VERSION"
DEVFLOW_RELEASE_COMMIT="$NEW_SHA"
DEVFLOW_IMAGE_TAG="$NEW_IMAGE_TAG"
export DEVFLOW_VERSION DEVFLOW_RELEASE_COMMIT DEVFLOW_IMAGE_TAG
set_compose_for "$NEW_RELEASE_DIR"
"${DEVFLOW_COMPOSE[@]}" config --quiet
"${DEVFLOW_COMPOSE[@]}" build backend frontend updater
compose_image_matches_release "devflow-backend:$NEW_IMAGE_TAG" "$NEW_SHA" "$NEW_VERSION" \
  || die 'Imagem final do backend possui identidade invalida.'
compose_image_matches_release "devflow-frontend:$NEW_IMAGE_TAG" "$NEW_SHA" "$NEW_VERSION" \
  || die 'Imagem final do frontend possui identidade invalida.'

EXPECTED_MIGRATION="$(find "$NEW_RELEASE_DIR/database/migrations" -maxdepth 1 -type f -name '*.sql' -print \
  | sed 's#.*/##' | LC_ALL=C sort | tail -n1)"
[[ "$EXPECTED_MIGRATION" =~ ^[0-9]{3}_[A-Za-z0-9_]+\.sql$ ]] || die 'Migration de destino invalida.'
EXPECTED_MIGRATION_SHA256="$(sha256sum "$NEW_RELEASE_DIR/database/migrations/$EXPECTED_MIGRATION" | awk '{print $1}')"
NEW_BACKEND_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "devflow-backend:$NEW_IMAGE_TAG")"
validate_backend_migration_image "devflow-backend:$NEW_IMAGE_TAG" "$EXPECTED_MIGRATION" \
  "$NEW_BACKEND_IMAGE_ID" "$EXPECTED_MIGRATION_SHA256" \
  || die 'Imagem final do backend nao atende ao contrato de migrations.'

CURRENT_STEP=stop-writers
MUTATION_STARTED=true
"${DEVFLOW_COMPOSE[@]}" stop backend worker frontend edge

CURRENT_STEP=migrations
"${DEVFLOW_COMPOSE[@]}" up -d db --wait
MIGRATIONS_STARTED=true
run_devflow_migrations
DEVFLOW_MIGRATION_VERSION="$("${DEVFLOW_COMPOSE[@]}" exec -T db sh -c \
  'psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT version FROM schema_migrations ORDER BY applied_at DESC LIMIT 1"')"
[[ "$DEVFLOW_MIGRATION_VERSION" == "$EXPECTED_MIGRATION" ]] || die 'PostgreSQL nao confirmou a migration esperada.'

CURRENT_STEP=activate
set_managed_env_value DEVFLOW_VERSION "$NEW_VERSION"
set_managed_env_value DEVFLOW_RELEASE_COMMIT "$NEW_SHA"
set_managed_env_value DEVFLOW_IMAGE_TAG "$NEW_IMAGE_TAG"
replace_devflow_app_symlink_atomically "$NEW_RELEASE_DIR"
DEVFLOW_IDENTITY_RELEASE_ROOT="$NEW_RELEASE_DIR"
DEVFLOW_EXPLICIT_RELEASE_IDENTITY=true
DEVFLOW_APPLICATION_INSTALLED=true
DEVFLOW_APPLICATION_HEALTHY=true
export DEVFLOW_IDENTITY_RELEASE_ROOT DEVFLOW_EXPLICIT_RELEASE_IDENTITY \
  DEVFLOW_APPLICATION_INSTALLED DEVFLOW_APPLICATION_HEALTHY DEVFLOW_MIGRATION_VERSION
prepare_installation_state_operational_values "$STATE_SNAPSHOT"
DEVFLOW_MIGRATION_VERSION="$EXPECTED_MIGRATION"
DEVFLOW_APPLICATION_INSTALLED=true
DEVFLOW_APPLICATION_HEALTHY=true
export DEVFLOW_MIGRATION_VERSION DEVFLOW_APPLICATION_INSTALLED DEVFLOW_APPLICATION_HEALTHY
write_installation_state

CURRENT_STEP=compose-up
set_compose_for "$NEW_RELEASE_DIR"
"${DEVFLOW_COMPOSE[@]}" up -d --wait --remove-orphans db backend worker frontend edge

CURRENT_STEP=final-health
run_context_health "$NEW_RELEASE_DIR"
docker exec devflow-updater test -f /var/lib/devflow/updater/daemon.ready

CURRENT_STEP=source-fast-forward
GIT_TERMINAL_PROMPT=0 git -C "$SOURCE_DIR" fetch origin main
[[ "$(git -C "$SOURCE_DIR" rev-parse origin/main)" == "$NEW_SHA" ]] \
  || die 'origin/main mudou durante a operacao; atualizacao recusada.'
git -C "$SOURCE_DIR" merge-base --is-ancestor "$(git -C "$SOURCE_DIR" rev-parse HEAD)" "$NEW_SHA" \
  || die 'Checkout operacional nao pode avancar por fast-forward.'
GIT_TERMINAL_PROMPT=0 git -C "$SOURCE_DIR" checkout main
GIT_TERMINAL_PROMPT=0 git -C "$SOURCE_DIR" merge --ff-only "$NEW_SHA"

CURRENT_STEP=completed
ROLLBACK_RESULT=not-required
trap - EXIT ERR INT TERM
write_report success 0 || log WARN 'Nao foi possivel atualizar o relatorio final; runtime e source ja foram confirmados.'
write_status completed || log WARN 'O daemon registrara o estado completed ao finalizar o request.'
remove_temporary_images
rm -f -- "$STATE_SNAPSHOT" || true
cleanup_staging
STAGING_ROOT=
log INFO "Atualizacao concluida: $OLD_VERSION ($OLD_SHA) -> $NEW_VERSION ($NEW_SHA)."
