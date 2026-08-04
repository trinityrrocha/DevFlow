#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/compose-images.sh
. "$SCRIPT_DIR/lib/compose-images.sh"
# shellcheck source=providers/provider-contract.sh
. "$SCRIPT_DIR/providers/provider-contract.sh"

MODE=check
RETAIN_FAILED_CANDIDATES=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) MODE=check; shift ;;
    --reconcile) MODE=reconcile; shift ;;
    --retain-failed-candidates) RETAIN_FAILED_CANDIDATES=true; shift ;;
    --help|-h)
      printf '%s\n' \
        'Uso: sudo scripts/reconcile-installed-release.sh --check|--reconcile [--retain-failed-candidates]' \
        '' \
        '--check       valida checkout, banco, migrations, imagens, API e estado' \
        '--reconcile   reconstrói somente backend/frontend e promove o estado validado' \
        '--retain-failed-candidates  preserva tags diagnósticas somente se --reconcile falhar'
      exit 0
      ;;
    *) die "Opção desconhecida: $1" ;;
  esac
done
[[ "$RETAIN_FAILED_CANDIDATES" == false || "$MODE" == reconcile ]] \
  || die '--retain-failed-candidates exige --reconcile.'

require_linux
require_root
for required_command in flock git docker python3 curl stat find sha256sum; do
  command -v "$required_command" >/dev/null 2>&1 || die "Comando obrigatório ausente: $required_command"
done
docker compose version >/dev/null 2>&1 || die 'Docker Compose v2 não está disponível.'

exec 9>/run/lock/devflow-release-reconcile.lock
flock -n 9 || die 'Outra reconciliação ou publicação DevFlow está em andamento.'
exec 8>/run/lock/devflow-update.lock
flock -n 8 || die 'Uma atualização DevFlow está em andamento.'
exec 7>/run/lock/devflow-state-repair.lock
flock -n 7 || die 'Um reparo de estado DevFlow está em andamento.'

STATE_FILE="$DEVFLOW_STATE_ROOT/installation.json"
SOURCE_DIR="$DEVFLOW_INSTALL_ROOT/source"
INSTALLED_RELEASE_DIR="$(readlink -f "$DEVFLOW_INSTALL_ROOT/app" 2>/dev/null || true)"
[[ -f "$STATE_FILE" && ! -L "$STATE_FILE" ]] || die 'Estado instalado ausente ou inseguro.'
[[ "$INSTALLED_RELEASE_DIR" == "$DEVFLOW_INSTALL_ROOT/releases/"* ]] \
  || die 'A release instalada não pertence ao diretório imutável esperado.'

load_devflow_env
validate_runtime_paths
provider_resolve_installed
provider_load "$DEVFLOW_INFRASTRUCTURE_PROVIDER" || die 'Provider instalado não pode ser carregado.'

[[ -d "$SOURCE_DIR/.git" && ! -L "$SOURCE_DIR/.git" ]] || die 'Checkout canônico instalado ausente.'
[[ "$(stat -c '%u' "$SOURCE_DIR")" == 0 && "$(stat -c '%u' "$SOURCE_DIR/.git")" == 0 ]] \
  || die 'Checkout canônico e metadados Git devem pertencer a root.'
source_mode="$(stat -c '%a' "$SOURCE_DIR")"
(( (8#$source_mode & 0022) == 0 )) || die 'Checkout canônico gravável por grupo ou terceiros.'
[[ -z "$(find "$SOURCE_DIR" -xdev -perm /022 -print -quit)" ]] \
  || die 'Checkout canônico contém arquivos graváveis por grupo ou terceiros.'
[[ "$(git -C "$SOURCE_DIR" config --local --get core.hooksPath 2>/dev/null || true)" == /dev/null ]] \
  || die 'Hooks Git do checkout canônico devem permanecer desabilitados.'

DEVFLOW_INSTALLED_SOURCE_DIR="$SOURCE_DIR"
DEVFLOW_IDENTITY_RELEASE_ROOT="$INSTALLED_RELEASE_DIR"
resolve_installed_release_identity "$SOURCE_DIR" main >/dev/null \
  || die 'Identidade da release instalada não pôde ser comprovada.'
INSTALLED_VERSION_CANONICAL="$INSTALLED_VERSION"
INSTALLED_COMMIT_CANONICAL="$INSTALLED_COMMIT"
CONFIGURED_IMAGE_TAG="${DEVFLOW_IMAGE_TAG:-latest}"
CONFIGURED_COMMIT="${DEVFLOW_RELEASE_COMMIT:-unknown}"
[[ "$CONFIGURED_IMAGE_TAG" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] \
  || die 'DEVFLOW_IMAGE_TAG instalado é inválido.'

DEVFLOW_VERSION="$INSTALLED_VERSION_CANONICAL"
DEVFLOW_RELEASE_COMMIT="$INSTALLED_COMMIT_CANONICAL"
DEVFLOW_SOURCE_DIR="$SOURCE_DIR"
DEVFLOW_IMAGE_TAG="$CONFIGURED_IMAGE_TAG"
DEVFLOW_APP_ROOT="$SOURCE_DIR"
export DEVFLOW_VERSION DEVFLOW_RELEASE_COMMIT DEVFLOW_SOURCE_DIR DEVFLOW_IMAGE_TAG \
  DEVFLOW_APP_ROOT DEVFLOW_INSTALLED_SOURCE_DIR DEVFLOW_IDENTITY_RELEASE_ROOT
compose_files
"${DEVFLOW_COMPOSE[@]}" config --quiet || die 'Compose da release instalada é inválido.'

update_transaction_state="$(installation_state_value state "$DEVFLOW_STATE_ROOT/update-transaction.json" 2>/dev/null || true)"
[[ "$update_transaction_state" != prepared ]] || die 'Transação de update pendente; reconciliação bloqueada.'
maintenance_container="$(docker ps -q --filter label=com.docker.compose.project=devflow-maintenance | head -n1)"
[[ -z "$maintenance_container" ]] || die 'Modo de manutenção ativo; reconciliação bloqueada.'

DB_CONTAINER_ID="$("${DEVFLOW_COMPOSE[@]}" ps -q db 2>/dev/null || true)"
BACKEND_CONTAINER_ID="$("${DEVFLOW_COMPOSE[@]}" ps -q backend 2>/dev/null || true)"
FRONTEND_CONTAINER_ID="$("${DEVFLOW_COMPOSE[@]}" ps -q frontend 2>/dev/null || true)"
[[ -n "$DB_CONTAINER_ID" && -n "$BACKEND_CONTAINER_ID" && -n "$FRONTEND_CONTAINER_ID" ]] \
  || die 'Containers internos obrigatórios estão ausentes.'

container_health() {
  docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null || true
}

DATABASE_HEALTHY=false
BACKEND_HEALTHY=false
FRONTEND_HEALTHY=false
FRONTEND_HTTP_HEALTHY=false
[[ "$(container_health "$DB_CONTAINER_ID")" == healthy ]] && DATABASE_HEALTHY=true
[[ "$(container_health "$BACKEND_CONTAINER_ID")" == healthy ]] && BACKEND_HEALTHY=true
[[ "$(container_health "$FRONTEND_CONTAINER_ID")" == healthy ]] && FRONTEND_HEALTHY=true
curl --fail --silent --show-error --max-time 10 \
  "http://127.0.0.1:${DEVFLOW_HTTP_PORT:-18080}/healthz" >/dev/null 2>&1 \
  && FRONTEND_HTTP_HEALTHY=true

MIGRATION_EXPECTED="$(find "$SOURCE_DIR/database/migrations" -maxdepth 1 -type f -name '*.sql' -printf '%f\n' \
  | LC_ALL=C sort | tail -n1)"
[[ "$MIGRATION_EXPECTED" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,254}\.sql$ ]] \
  || die 'Migration esperada da fonte canônica é ausente ou inválida.'
MIGRATION_EXPECTED_SHA256="$(sha256sum "$SOURCE_DIR/database/migrations/$MIGRATION_EXPECTED" | awk '{print $1}')"
[[ "$MIGRATION_EXPECTED_SHA256" =~ ^[0-9a-f]{64}$ ]] \
  || die 'Checksum da migration esperada não pôde ser calculado.'
MIGRATION_ACTUAL="$("${DEVFLOW_COMPOSE[@]}" exec -T db sh -c \
  'psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT version FROM schema_migrations ORDER BY applied_at DESC LIMIT 1"' \
  2>/dev/null || true)"
MIGRATIONS_CURRENT=false
[[ -n "$MIGRATION_EXPECTED" && "$MIGRATION_ACTUAL" == "$MIGRATION_EXPECTED" ]] && MIGRATIONS_CURRENT=true
DB_MOUNT_IDENTITY="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Type}}:{{.Name}}:{{.Source}}{{end}}{{end}}' "$DB_CONTAINER_ID" 2>/dev/null || true)"
[[ -n "$DB_MOUNT_IDENTITY" ]] || die 'Persistência do PostgreSQL não pôde ser comprovada.'

STATE_SCHEMA_VALID=false
STATE_IDENTITY_CONSISTENT=false
installation_state_schema_valid "$STATE_FILE" && STATE_SCHEMA_VALID=true
validate_installed_state_consistency "$STATE_FILE" >/dev/null 2>&1 && STATE_IDENTITY_CONSISTENT=true

reconcile_installed_release_runtime >/dev/null 2>&1 || true
APPLICATION_HEALTHY=false
if [[ "$DATABASE_HEALTHY" == true && "$BACKEND_HEALTHY" == true && "$FRONTEND_HEALTHY" == true \
  && "$FRONTEND_HTTP_HEALTHY" == true \
  && "$MIGRATIONS_CURRENT" == true && "$API_VERSION_MATCH" == true ]]; then
  APPLICATION_HEALTHY=true
fi

CONFIGURATION_COMMIT_MATCH=false
[[ "$CONFIGURED_COMMIT" == "$INSTALLED_COMMIT_CANONICAL" ]] && CONFIGURATION_COMMIT_MATCH=true
RECONCILIATION_REQUIRED=false
if [[ "$BACKEND_IMAGE_VERSION_MATCH" != true || "$BACKEND_IMAGE_COMMIT_MATCH" != true \
  || "$FRONTEND_IMAGE_VERSION_MATCH" != true || "$FRONTEND_IMAGE_COMMIT_MATCH" != true \
  || "$CONFIGURATION_COMMIT_MATCH" != true ]]; then
  RECONCILIATION_REQUIRED=true
fi
STATE_REPAIR_REQUIRED=false
[[ "$STATE_IDENTITY_CONSISTENT" == true ]] || STATE_REPAIR_REQUIRED=true
STATE_CONSISTENT=false
if [[ "$STATE_IDENTITY_CONSISTENT" == true && "$RECONCILIATION_REQUIRED" == false \
  && ( "$API_COMMIT_MATCH" == true || "$API_COMMIT_MATCH" == unsupported-by-installed-release ) ]]; then
  STATE_CONSISTENT=true
fi
RECONCILIATION_AVAILABLE=false
if [[ "$APPLICATION_HEALTHY" == true && "$DATABASE_HEALTHY" == true \
  && "$MIGRATIONS_CURRENT" == true && -z "$maintenance_container" \
  && "$update_transaction_state" != prepared ]]; then
  RECONCILIATION_AVAILABLE=true
fi

print_status() {
  printf '%s\n' \
    "installed_version=$INSTALLED_VERSION_CANONICAL" \
    "installed_commit=$INSTALLED_COMMIT_CANONICAL" \
    "installed_ref=$INSTALLED_REF" \
    "installed_repository=$INSTALLED_REPOSITORY" \
    "installed_state_schema_valid=$STATE_SCHEMA_VALID" \
    "backend_image_version_match=$BACKEND_IMAGE_VERSION_MATCH" \
    "backend_image_commit_match=$BACKEND_IMAGE_COMMIT_MATCH" \
    "frontend_image_version_match=$FRONTEND_IMAGE_VERSION_MATCH" \
    "frontend_image_commit_match=$FRONTEND_IMAGE_COMMIT_MATCH" \
    "configuration_commit_match=$CONFIGURATION_COMMIT_MATCH" \
    "api_version_match=$API_VERSION_MATCH" \
    "api_commit_match=$API_COMMIT_MATCH" \
    "database_healthy=$DATABASE_HEALTHY" \
    "backend_healthy=$BACKEND_HEALTHY" \
    "frontend_healthy=$FRONTEND_HEALTHY" \
    "frontend_http_healthy=$FRONTEND_HTTP_HEALTHY" \
    "migrations_current=$MIGRATIONS_CURRENT" \
    "application_healthy=$APPLICATION_HEALTHY" \
    "reconciliation_required=$RECONCILIATION_REQUIRED" \
    "state_repair_required=$STATE_REPAIR_REQUIRED" \
    "reconciliation_available=$RECONCILIATION_AVAILABLE" \
    "state_consistent=$STATE_CONSISTENT" \
    'fullpassword_modified=false' \
    'public_proxy_modified=false'
}

print_status
if [[ "$MODE" == check ]]; then
  printf 'changes_applied=false\n'
  exit 0
fi
if [[ "$STATE_CONSISTENT" == true ]]; then
  printf '%s\n' 'reconciliation_status=not-required' 'changes_applied=false'
  exit 0
fi
[[ "$RECONCILIATION_AVAILABLE" == true ]] \
  || die 'Reconciliação indisponível porque os gates operacionais não foram comprovados.'
require_numeric_confirmation installed-release-reconciliation \
  'Reconciliação da release instalada necessária.' \
  'RECONCILIAR RELEASE DO DEVFLOW'

TRANSACTION_ID="$(date -u +%Y%m%dT%H%M%SZ)-${INSTALLED_COMMIT_CANONICAL:0:12}"
CANDIDATE_TAG="reconcile-${INSTALLED_COMMIT_CANONICAL:0:12}-$(date -u +%Y%m%d%H%M%S)"
BACKUP_BACKEND_REF=none
BACKUP_FRONTEND_REF=none
STATE_BACKUP_ROOT="$DEVFLOW_INSTALL_ROOT/backups/state"
STATE_BACKUP="$STATE_BACKUP_ROOT/installation-$TRANSACTION_ID.json"
ENV_BACKUP="$(mktemp "$DEVFLOW_CONFIG_ROOT/.reconcile-env.XXXXXX")"
RECONCILIATION_STATE_FILE="$DEVFLOW_STATE_ROOT/reconciliation.json"
RECONCILIATION_LOG="$DEVFLOW_LOG_ROOT/reconciliation-$TRANSACTION_ID.log"
RECONCILE_COMPOSE_OVERRIDE="$(mktemp "$DEVFLOW_STATE_ROOT/.reconcile-compose.XXXXXX.yml")"
IMAGE_VALIDATION_RESULT_FILE="$(mktemp "$DEVFLOW_STATE_ROOT/.reconcile-image-validation.XXXXXX")"
CANDIDATE_BACKEND_IMAGE=
CANDIDATE_FRONTEND_IMAGE=
CANDIDATE_BACKEND_IMAGE_ID=
CANDIDATE_FRONTEND_IMAGE_ID=
TARGET_BACKEND_IMAGE=
TARGET_FRONTEND_IMAGE=
FAILED_CANDIDATE_RETAINED=false
FAILED_BACKEND_DIAGNOSTIC_REF=none
FAILED_FRONTEND_DIAGNOSTIC_REF=none
IMAGE_VALIDATION_STATUS=not-started
IMAGE_VALIDATION_ROOT_CAUSE=none
ROLLBACK_RESULT=not-required
OLD_BACKEND_IMAGE_ID="$(docker inspect --format '{{.Image}}' "$BACKEND_CONTAINER_ID")"
OLD_FRONTEND_IMAGE_ID="$(docker inspect --format '{{.Image}}' "$FRONTEND_CONTAINER_ID")"
MUTATION_STARTED=false
STATE_MUTATED=false
RECONCILIATION_COMPLETE=false

install -d -m 0750 "$DEVFLOW_LOG_ROOT" "$DEVFLOW_STATE_ROOT"
install -d -m 0700 "$STATE_BACKUP_ROOT"
[[ ! -e "$STATE_BACKUP" ]] || die 'Backup de estado da reconciliação já existe; repita após o próximo timestamp.'
install -m 0600 "$STATE_FILE" "$STATE_BACKUP"
chown root:root "$STATE_BACKUP"
sync -f "$STATE_BACKUP" 2>/dev/null || true
install -m 0600 "$DEVFLOW_ENV_FILE" "$ENV_BACKUP"
touch "$RECONCILIATION_LOG"
chmod 0640 "$RECONCILIATION_LOG"
{
  printf '%s\n' \
    'services:' \
    '  backend:' \
    '    command: ["node", "src/server.js"]'
} > "$RECONCILE_COMPOSE_OVERRIDE"
chmod 0600 "$RECONCILE_COMPOSE_OVERRIDE"
chmod 0600 "$IMAGE_VALIDATION_RESULT_FILE"
exec > >(redact_stream | tee -a "$RECONCILIATION_LOG") 2>&1

compose_files_for_reconciliation() {
  compose_files
  DEVFLOW_COMPOSE+=(-f "$RECONCILE_COMPOSE_OVERRIDE")
}

write_reconciliation_state() {
  local phase="$1" result="$2" temporary
  temporary="$(mktemp "$DEVFLOW_STATE_ROOT/.reconciliation.XXXXXX")"
  {
    printf '{\n'
    printf '  "schemaVersion": 2,\n'
    printf '  "timestamp": "%s",\n' "$(timestamp)"
    printf '  "phase": "%s",\n' "$phase"
    printf '  "result": "%s",\n' "$result"
    printf '  "installedVersion": "%s",\n' "$INSTALLED_VERSION_CANONICAL"
    printf '  "installedCommit": "%s",\n' "$INSTALLED_COMMIT_CANONICAL"
    printf '  "databaseContainer": "%s",\n' "$DB_CONTAINER_ID"
    printf '  "stateBackup": "%s",\n' "$STATE_BACKUP"
    printf '  "candidateBackendReference": "%s",\n' "${CANDIDATE_BACKEND_IMAGE:-none}"
    printf '  "candidateBackendId": "%s",\n' "${CANDIDATE_BACKEND_IMAGE_ID:-none}"
    printf '  "candidateFrontendReference": "%s",\n' "${CANDIDATE_FRONTEND_IMAGE:-none}"
    printf '  "candidateFrontendId": "%s",\n' "${CANDIDATE_FRONTEND_IMAGE_ID:-none}"
    printf '  "expectedMigration": "%s",\n' "$MIGRATION_EXPECTED"
    printf '  "imageValidationStatus": "%s",\n' "$IMAGE_VALIDATION_STATUS"
    printf '  "imageValidationRootCause": "%s",\n' "$IMAGE_VALIDATION_ROOT_CAUSE"
    printf '  "failedCandidateRetained": %s,\n' "$FAILED_CANDIDATE_RETAINED"
    printf '  "failedBackendCandidate": "%s",\n' "$FAILED_BACKEND_DIAGNOSTIC_REF"
    printf '  "failedFrontendCandidate": "%s",\n' "$FAILED_FRONTEND_DIAGNOSTIC_REF"
    printf '  "rollbackResult": "%s",\n' "$ROLLBACK_RESULT"
    printf '  "fullpasswordModified": false,\n'
    printf '  "publicProxyModified": false\n'
    printf '}\n'
  } > "$temporary"
  chmod 0600 "$temporary"
  python3 -m json.tool "$temporary" >/dev/null || { rm -f -- "$temporary"; return 1; }
  sync -f "$temporary" 2>/dev/null || true
  mv -f -- "$temporary" "$RECONCILIATION_STATE_FILE"
}

restore_protected_file() {
  local source_file="$1" destination="$2" temporary
  temporary="$(mktemp "$(dirname "$destination")/.restore.XXXXXX")"
  install -m 0600 "$source_file" "$temporary"
  sync -f "$temporary" 2>/dev/null || true
  mv -f -- "$temporary" "$destination"
}

rollback_reconciliation() {
  local rollback_failures=0
  set +e
  log ERROR 'Falha durante a reconciliação; restaurando imagens e metadados anteriores.'
  if [[ "$MUTATION_STARTED" == true ]]; then
    docker image tag "$OLD_BACKEND_IMAGE_ID" "$TARGET_BACKEND_IMAGE" || rollback_failures=$((rollback_failures + 1))
    docker image tag "$OLD_FRONTEND_IMAGE_ID" "$TARGET_FRONTEND_IMAGE" || rollback_failures=$((rollback_failures + 1))
    restore_protected_file "$ENV_BACKUP" "$DEVFLOW_ENV_FILE" || rollback_failures=$((rollback_failures + 1))
    DEVFLOW_RELEASE_COMMIT="$CONFIGURED_COMMIT"
    DEVFLOW_IMAGE_TAG="$CONFIGURED_IMAGE_TAG"
    DEVFLOW_APP_ROOT="$SOURCE_DIR"
    export DEVFLOW_RELEASE_COMMIT DEVFLOW_IMAGE_TAG DEVFLOW_APP_ROOT
    compose_files_for_reconciliation
    "${DEVFLOW_COMPOSE[@]}" up -d --no-deps --force-recreate --wait backend frontend \
      || rollback_failures=$((rollback_failures + 1))
  fi
  if [[ "$STATE_MUTATED" == true ]]; then
    restore_protected_file "$STATE_BACKUP" "$STATE_FILE" || rollback_failures=$((rollback_failures + 1))
  fi
  [[ "$("${DEVFLOW_COMPOSE[@]}" ps -q db 2>/dev/null || true)" == "$DB_CONTAINER_ID" ]] \
    || rollback_failures=$((rollback_failures + 1))
  ROLLBACK_RESULT="$([[ "$rollback_failures" -eq 0 ]] && printf rolled-back || printf rollback-failed)"
  write_reconciliation_state rollback "$ROLLBACK_RESULT" || true
  set -e
  [[ "$rollback_failures" -eq 0 ]]
}

retain_failed_candidates() {
  local retention_failures=0
  [[ "$RETAIN_FAILED_CANDIDATES" == true ]] || return 1
  [[ "$CANDIDATE_BACKEND_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ \
    && "$CANDIDATE_FRONTEND_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
  FAILED_BACKEND_DIAGNOSTIC_REF="devflow-backend:diagnostic-$TRANSACTION_ID"
  FAILED_FRONTEND_DIAGNOSTIC_REF="devflow-frontend:diagnostic-$TRANSACTION_ID"
  docker image tag "$CANDIDATE_BACKEND_IMAGE_ID" "$FAILED_BACKEND_DIAGNOSTIC_REF" \
    || retention_failures=$((retention_failures + 1))
  docker image tag "$CANDIDATE_FRONTEND_IMAGE_ID" "$FAILED_FRONTEND_DIAGNOSTIC_REF" \
    || retention_failures=$((retention_failures + 1))
  if [[ "$retention_failures" -eq 0 ]]; then
    FAILED_CANDIDATE_RETAINED=true
    printf '%s\n' \
      'failed_candidate_retained=true' \
      "failed_backend_candidate=$FAILED_BACKEND_DIAGNOSTIC_REF" \
      "failed_backend_candidate_id=$CANDIDATE_BACKEND_IMAGE_ID" \
      "failed_frontend_candidate=$FAILED_FRONTEND_DIAGNOSTIC_REF" \
      "failed_frontend_candidate_id=$CANDIDATE_FRONTEND_IMAGE_ID" \
      "inspect_failed_backend_command=docker image inspect $FAILED_BACKEND_DIAGNOSTIC_REF" \
      "inspect_failed_frontend_command=docker image inspect $FAILED_FRONTEND_DIAGNOSTIC_REF" \
      "inspect_failed_migration_command=docker run --rm --network none --entrypoint node $FAILED_BACKEND_DIAGNOSTIC_REF -e 'const fs=require(\"node:fs\");console.log(fs.readdirSync(\"/database/migrations\").sort().join(\"\\n\"))'" \
      "remove_failed_candidates_command=docker image rm $FAILED_BACKEND_DIAGNOSTIC_REF $FAILED_FRONTEND_DIAGNOSTIC_REF"
    return 0
  fi
  FAILED_BACKEND_DIAGNOSTIC_REF=none
  FAILED_FRONTEND_DIAGNOSTIC_REF=none
  return 1
}

cleanup_reconciliation() {
  local exit_code=$?
  trap - EXIT ERR INT TERM
  if [[ "$exit_code" -ne 0 && "$RECONCILIATION_COMPLETE" != true ]]; then
    rollback_reconciliation || true
    retain_failed_candidates || true
    [[ -z "$CANDIDATE_BACKEND_IMAGE" ]] || docker image rm "$CANDIDATE_BACKEND_IMAGE" >/dev/null 2>&1 || true
    [[ -z "$CANDIDATE_FRONTEND_IMAGE" ]] || docker image rm "$CANDIDATE_FRONTEND_IMAGE" >/dev/null 2>&1 || true
    write_reconciliation_state rollback "$ROLLBACK_RESULT" || true
  fi
  rm -f -- "$ENV_BACKUP"
  rm -f -- "$RECONCILE_COMPOSE_OVERRIDE"
  rm -f -- "$IMAGE_VALIDATION_RESULT_FILE"
  exit "$exit_code"
}
trap cleanup_reconciliation EXIT
trap 'exit 130' INT TERM

if [[ "$RECONCILIATION_REQUIRED" == true ]]; then
BACKUP_BACKEND_REF="devflow-reconcile-backup-backend:$TRANSACTION_ID"
BACKUP_FRONTEND_REF="devflow-reconcile-backup-frontend:$TRANSACTION_ID"
write_reconciliation_state build running || die 'Estado transacional da reconciliação não pôde ser criado.'
DEVFLOW_IMAGE_TAG="$CANDIDATE_TAG"
DEVFLOW_VERSION="$INSTALLED_VERSION_CANONICAL"
DEVFLOW_RELEASE_COMMIT="$INSTALLED_COMMIT_CANONICAL"
DEVFLOW_SOURCE_DIR="$SOURCE_DIR"
DEVFLOW_APP_ROOT="$SOURCE_DIR"
export DEVFLOW_IMAGE_TAG DEVFLOW_VERSION DEVFLOW_RELEASE_COMMIT DEVFLOW_SOURCE_DIR DEVFLOW_APP_ROOT
compose_files_for_reconciliation
"${DEVFLOW_COMPOSE[@]}" build backend frontend
CANDIDATE_BACKEND_IMAGE="$(resolve_compose_service_image backend)"
CANDIDATE_FRONTEND_IMAGE="$(resolve_compose_service_image frontend)"
CANDIDATE_BACKEND_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$CANDIDATE_BACKEND_IMAGE")"
CANDIDATE_FRONTEND_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$CANDIDATE_FRONTEND_IMAGE")"
[[ "$CANDIDATE_BACKEND_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ \
  && "$CANDIDATE_FRONTEND_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]] \
  || die 'IDs imutáveis das imagens candidatas não puderam ser comprovados.'
printf '%s\n' \
  "candidate_backend_reference=$CANDIDATE_BACKEND_IMAGE" \
  "candidate_backend_id=$CANDIDATE_BACKEND_IMAGE_ID" \
  "candidate_frontend_reference=$CANDIDATE_FRONTEND_IMAGE" \
  "candidate_frontend_id=$CANDIDATE_FRONTEND_IMAGE_ID" \
  "expected_migration=$MIGRATION_EXPECTED" \
  "expected_migration_sha256=$MIGRATION_EXPECTED_SHA256"
compose_image_matches_release "$CANDIDATE_BACKEND_IMAGE" "$INSTALLED_COMMIT_CANONICAL" "$INSTALLED_VERSION_CANONICAL" \
  || die 'Labels OCI da imagem candidata backend divergem da release instalada.'
compose_image_matches_release "$CANDIDATE_FRONTEND_IMAGE" "$INSTALLED_COMMIT_CANONICAL" "$INSTALLED_VERSION_CANONICAL" \
  || die 'Labels OCI da imagem candidata frontend divergem da release instalada.'
IMAGE_VALIDATION_STATUS=running
write_reconciliation_state validation running \
  || die 'Fase de validação da imagem não pôde ser registrada.'
candidate_validation_exit=0
validate_backend_migration_image "$CANDIDATE_BACKEND_IMAGE" "$MIGRATION_EXPECTED" \
  "$CANDIDATE_BACKEND_IMAGE_ID" "$MIGRATION_EXPECTED_SHA256" \
  | tee "$IMAGE_VALIDATION_RESULT_FILE" || candidate_validation_exit=$?
reported_validation_root_cause="$(sed -nE 's/^root_cause=([a-z0-9-]+)$/\1/p' \
  "$IMAGE_VALIDATION_RESULT_FILE" | tail -n1)"
case "$reported_validation_root_cause" in
  none|migration-directory-missing|expected-migration-missing|expected-migration-not-regular|expected-migration-content-mismatch|candidate-image-inspect-failed|candidate-image-identity-mismatch|candidate-image-reference-changed|invalid-expected-migration|invalid-expected-migration-checksum|image-validation-runtime-error) ;;
  '') reported_validation_root_cause=image-validation-result-missing ;;
  *) reported_validation_root_cause=image-validation-result-invalid ;;
esac
case "$candidate_validation_exit" in
  0)
    IMAGE_VALIDATION_STATUS=passed
    IMAGE_VALIDATION_ROOT_CAUSE=none
    ;;
  40|41|43|44) IMAGE_VALIDATION_STATUS=failed; IMAGE_VALIDATION_ROOT_CAUSE="$reported_validation_root_cause" ;;
  *) IMAGE_VALIDATION_STATUS=runtime-error; IMAGE_VALIDATION_ROOT_CAUSE="$reported_validation_root_cause" ;;
esac
write_reconciliation_state validation "$IMAGE_VALIDATION_STATUS" \
  || die 'Resultado da validação da imagem não pôde ser registrado.'
[[ "$candidate_validation_exit" -eq 0 ]] \
  || die "Conteúdo da imagem candidata backend não passou na validação isolada ($IMAGE_VALIDATION_ROOT_CAUSE)."

DEVFLOW_IMAGE_TAG="$CONFIGURED_IMAGE_TAG"
export DEVFLOW_IMAGE_TAG
compose_files
TARGET_BACKEND_IMAGE="$(compose_service_image_expected backend)"
TARGET_FRONTEND_IMAGE="$(compose_service_image_expected frontend)"
validate_image_reference "$TARGET_BACKEND_IMAGE" && validate_image_reference "$TARGET_FRONTEND_IMAGE" \
  || die 'Referências de promoção das imagens são inválidas.'
docker image tag "$OLD_BACKEND_IMAGE_ID" "$BACKUP_BACKEND_REF"
docker image tag "$OLD_FRONTEND_IMAGE_ID" "$BACKUP_FRONTEND_REF"

write_reconciliation_state promotion running || die 'Fase de promoção não pôde ser registrada.'
MUTATION_STARTED=true
docker image tag "$CANDIDATE_BACKEND_IMAGE" "$TARGET_BACKEND_IMAGE"
docker image tag "$CANDIDATE_FRONTEND_IMAGE" "$TARGET_FRONTEND_IMAGE"
set_managed_env_value DEVFLOW_RELEASE_COMMIT "$INSTALLED_COMMIT_CANONICAL"
[[ "$(devflow_env_metadata_value DEVFLOW_RELEASE_COMMIT "$DEVFLOW_ENV_FILE" 2>/dev/null || true)" == "$INSTALLED_COMMIT_CANONICAL" ]] \
  || die 'Configuração privada não confirmou o commit canônico.'
"${DEVFLOW_COMPOSE[@]}" up -d --no-deps --force-recreate --wait backend frontend

[[ "$("${DEVFLOW_COMPOSE[@]}" ps -q db 2>/dev/null || true)" == "$DB_CONTAINER_ID" ]] \
  || die 'Container PostgreSQL foi alterado durante a reconciliação.'
[[ "$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Type}}:{{.Name}}:{{.Source}}{{end}}{{end}}' "$DB_CONTAINER_ID")" == "$DB_MOUNT_IDENTITY" ]] \
  || die 'Persistência PostgreSQL divergiu durante a reconciliação.'
[[ "$(container_health "$DB_CONTAINER_ID")" == healthy ]] || die 'PostgreSQL deixou de estar saudável.'
current_migration="$("${DEVFLOW_COMPOSE[@]}" exec -T db sh -c \
  'psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT version FROM schema_migrations ORDER BY applied_at DESC LIMIT 1"' \
  2>/dev/null || true)"
[[ "$current_migration" == "$MIGRATION_ACTUAL" ]] || die 'Migration mudou durante a reconciliação.'

reconcile_installed_release_runtime \
  || die 'Imagens, configuração ou API não correspondem à release canônica após promoção.'
[[ "$API_COMMIT_MATCH" == true || "$API_COMMIT_MATCH" == unsupported-by-installed-release ]] \
  || die 'Commit da API não pôde ser reconciliado.'
else
  log INFO 'Imagens e configuração já correspondem à release; promovendo somente o estado schema v2.'
fi
DEVFLOW_APP_ROOT="$INSTALLED_RELEASE_DIR" DEVFLOW_IDENTITY_RELEASE_ROOT="$INSTALLED_RELEASE_DIR" \
  "$SCRIPT_DIR/health.sh" --internal --quiet \
  || die 'Health interno falhou antes da promoção do estado.'

write_reconciliation_state state running || die 'Fase de estado não pôde ser registrada.'
prepare_installation_state_operational_values "$STATE_FILE"
DEVFLOW_APPLICATION_HEALTHY=true
DEVFLOW_MIGRATION_VERSION="$MIGRATION_ACTUAL"
export DEVFLOW_APPLICATION_HEALTHY DEVFLOW_MIGRATION_VERSION
STATE_MUTATED=true
write_installation_state || die 'Estado schema v2 não pôde ser promovido atomicamente.'

DEVFLOW_APP_ROOT="$INSTALLED_RELEASE_DIR" DEVFLOW_IDENTITY_RELEASE_ROOT="$INSTALLED_RELEASE_DIR" \
  "$SCRIPT_DIR/health.sh" --internal --quiet \
  || die 'Health interno final da reconciliação falhou.'
validate_installed_state_consistency "$STATE_FILE" >/dev/null \
  || die 'Estado final diverge da identidade canônica.'
reconcile_installed_release_runtime || die 'Identidade operacional final diverge da release instalada.'

write_reconciliation_state completed success || die 'Conclusão transacional não pôde ser registrada.'
RECONCILIATION_COMPLETE=true
rm -f -- "$ENV_BACKUP"
rm -f -- "$RECONCILE_COMPOSE_OVERRIDE"
rm -f -- "$IMAGE_VALIDATION_RESULT_FILE"
trap - EXIT ERR INT TERM
printf '%s\n' \
  "state_backup=$STATE_BACKUP" \
  "backend_previous_image=$BACKUP_BACKEND_REF" \
  "frontend_previous_image=$BACKUP_FRONTEND_REF" \
  'installed_state_schema_valid=true' \
  'installed_state_version_match=true' \
  'installed_state_commit_match=true' \
  'source_commit_match=true' \
  'backend_image_version_match=true' \
  'backend_image_commit_match=true' \
  'frontend_image_version_match=true' \
  'frontend_image_commit_match=true' \
  'application_healthy=true' \
  'state_consistent=true' \
  'installation_state_health=healthy' \
  'fullpassword_modified=false' \
  'public_proxy_modified=false' \
  'changes_applied=true'
