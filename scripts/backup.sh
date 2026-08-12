#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

PROJECT_DIR="${DEVFLOW_PROJECT_DIR:-/opt/devflow/app}"
ENV_FILE="${DEVFLOW_ENV_FILE:-/opt/devflow/config/devflow.env}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"
DEVFLOW_ENV_FILE="$ENV_FILE"
load_devflow_env
DEVFLOW_IDENTITY_RELEASE_ROOT="$PROJECT_DIR"
if [[ -n "${DEVFLOW_BACKUP_TRANSACTION_ID:-}" ]]; then
  [[ "$DEVFLOW_BACKUP_TRANSACTION_ID" =~ ^[0-9a-f]{32}$ \
    && "${DEVFLOW_BACKUP_TRANSACTION_TIMESTAMP:-}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ \
    && "${DEVFLOW_BACKUP_PREVIOUS_VERSION:-}" =~ ^[0-9]+\.[0-9]+\.[0-9]+ \
    && "${DEVFLOW_BACKUP_PREVIOUS_COMMIT:-}" =~ ^[0-9a-f]{40}$ \
    && "${DEVFLOW_BACKUP_PREVIOUS_MIGRATION:-}" =~ ^[0-9]{3}_[A-Za-z0-9_]+\.sql$ \
    && "${DEVFLOW_BACKUP_INSTALLATION_STATE_SHA256:-}" =~ ^[0-9a-f]{64}$ ]] \
    || die 'Identidade transacional do backup invalida.'
  DEVFLOW_VERSION="$DEVFLOW_BACKUP_PREVIOUS_VERSION"
  DEVFLOW_RELEASE_COMMIT="$DEVFLOW_BACKUP_PREVIOUS_COMMIT"
  DEVFLOW_EXPLICIT_RELEASE_IDENTITY=true
  INSTALLED_VERSION="$DEVFLOW_VERSION"
  INSTALLED_COMMIT="$DEVFLOW_RELEASE_COMMIT"
  export DEVFLOW_VERSION DEVFLOW_RELEASE_COMMIT DEVFLOW_IDENTITY_RELEASE_ROOT \
    DEVFLOW_EXPLICIT_RELEASE_IDENTITY INSTALLED_VERSION INSTALLED_COMMIT
  validate_explicit_release_identity \
    || die 'Release anterior da transacao nao foi comprovada para backup.'
else
resolve_installed_release_identity "$DEVFLOW_INSTALL_ROOT/source" main >/dev/null \
  || { echo 'Identidade instalada não comprovada; backup operacional bloqueado.' >&2; exit 1; }
DEVFLOW_VERSION="$INSTALLED_VERSION"
DEVFLOW_RELEASE_COMMIT="$INSTALLED_COMMIT"
export DEVFLOW_VERSION DEVFLOW_RELEASE_COMMIT DEVFLOW_IDENTITY_RELEASE_ROOT
fi
command -v flock >/dev/null 2>&1 || { echo 'flock é obrigatório para serializar backups.' >&2; exit 1; }
if [[ "${DEVFLOW_OPERATION_LOCK_HELD:-false}" != true ]]; then
  install -d -m 0750 /run/lock/devflow
  exec 8>/run/lock/devflow/operations.lock
  flock -n 8 || { echo 'Outra operacao DevFlow esta em andamento.' >&2; exit 1; }
fi
ARCHIVE_DIR="${BACKUP_ARCHIVE_DIR:-/opt/devflow/backups}"
PASSPHRASE_FILE="${BACKUP_PASSPHRASE_FILE:-/opt/devflow/config/backup.passphrase}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
UPLOAD_SOURCE="${DEVFLOW_UPLOADS_PATH:-devflow_devflow_uploads}"
DEVFLOW_APP_ROOT="$PROJECT_DIR"
compose_files

[[ -r "$PASSPHRASE_FILE" ]] || { echo "Passphrase de backup não encontrada em $PASSPHRASE_FILE." >&2; exit 1; }
[[ "$ARCHIVE_DIR" = /* && "$ARCHIVE_DIR" != "/" ]] || { echo "Diretório de backup inválido." >&2; exit 1; }
[[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || { echo "Retenção inválida." >&2; exit 1; }
if [[ "$UPLOAD_SOURCE" == /* ]]; then
  resolved_uploads="$(realpath -m "$UPLOAD_SOURCE")"
  [[ "$resolved_uploads" == /opt/devflow/storage || "$resolved_uploads" == /opt/devflow/storage/* ]] \
    || { echo 'Storage fora do namespace DevFlow.' >&2; exit 1; }
else
  [[ "$UPLOAD_SOURCE" =~ ^devflow_[A-Za-z0-9_.-]+$ ]] \
    || { echo 'Volume de storage não pertence ao namespace DevFlow.' >&2; exit 1; }
fi

mkdir -p -- "$ARCHIVE_DIR"
TEMP_DIR="$(mktemp -d "$ARCHIVE_DIR/.devflow-backup.XXXXXX")"
cleanup() { rm -rf -- "$TEMP_DIR"; }
trap cleanup EXIT

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive_suffix="$(openssl rand -hex 4)"
archive_name="devflow-${timestamp}-${archive_suffix}.dfbackup"

"${DEVFLOW_COMPOSE[@]}" exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$TEMP_DIR/database.dump"
current_migration="$("${DEVFLOW_COMPOSE[@]}" exec -T db sh -c \
  'psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT version FROM schema_migrations ORDER BY applied_at DESC LIMIT 1"')"
[[ "$current_migration" =~ ^[0-9]{3}_[A-Za-z0-9_]+\.sql$ ]] || die 'Migration atual nao pode ser identificada para o backup.'
docker run --rm \
  -v "$UPLOAD_SOURCE:/source:ro" \
  -v "$TEMP_DIR:/work" \
  alpine:3.22 tar -C /source -czf /work/uploads.tar.gz .

db_sha="$(sha256sum "$TEMP_DIR/database.dump" | awk '{print $1}')"
uploads_sha="$(sha256sum "$TEMP_DIR/uploads.tar.gz" | awk '{print $1}')"
app_sha="$INSTALLED_COMMIT"
if [[ -n "${DEVFLOW_BACKUP_TRANSACTION_ID:-}" ]]; then
  [[ "$DEVFLOW_BACKUP_TRANSACTION_ID" =~ ^[0-9a-f]{32}$ \
    && "${DEVFLOW_BACKUP_PREVIOUS_VERSION:-}" == "$INSTALLED_VERSION" \
    && "${DEVFLOW_BACKUP_PREVIOUS_COMMIT:-}" == "$INSTALLED_COMMIT" \
    && "${DEVFLOW_BACKUP_PREVIOUS_MIGRATION:-}" =~ ^[0-9]{3}_[A-Za-z0-9_]+\.sql$ \
    && "${DEVFLOW_BACKUP_INSTALLATION_STATE_SHA256:-}" =~ ^[0-9a-f]{64}$ ]] \
    || die 'Identidade transacional do backup invalida.'
  printf '%s\n' \
    "{\"format\":\"devflow-backup-v2\",\"created_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"transaction_id\":\"$DEVFLOW_BACKUP_TRANSACTION_ID\",\"transaction_timestamp\":\"$DEVFLOW_BACKUP_TRANSACTION_TIMESTAMP\",\"application_version\":\"$INSTALLED_VERSION\",\"application_sha\":\"$app_sha\",\"database_migration\":\"$DEVFLOW_BACKUP_PREVIOUS_MIGRATION\",\"installation_state_sha256\":\"$DEVFLOW_BACKUP_INSTALLATION_STATE_SHA256\",\"database_sha256\":\"$db_sha\",\"uploads_sha256\":\"$uploads_sha\"}" \
    > "$TEMP_DIR/manifest.json"
else
  printf '%s\n' \
    "{\"format\":\"devflow-backup-v1\",\"created_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"application_version\":\"$INSTALLED_VERSION\",\"application_sha\":\"$app_sha\",\"database_migration\":\"$current_migration\",\"database_sha256\":\"$db_sha\",\"uploads_sha256\":\"$uploads_sha\"}" \
    > "$TEMP_DIR/manifest.json"
fi
(
  cd "$TEMP_DIR"
  sha256sum database.dump uploads.tar.gz manifest.json > checksums.sha256
  tar -czf payload.tar.gz manifest.json checksums.sha256 database.dump uploads.tar.gz
)

"${DEVFLOW_COMPOSE[@]}" run --rm --no-deps --user 0:0 \
  -v "$TEMP_DIR:/work" \
  -v "$PASSPHRASE_FILE:/run/secrets/devflow_backup_passphrase:ro" \
  -e BACKUP_PASSPHRASE_FILE=/run/secrets/devflow_backup_passphrase \
  backend node scripts/cryptoEnvelope.js encrypt /work/payload.tar.gz "/work/$archive_name"

mv -- "$TEMP_DIR/$archive_name" "$ARCHIVE_DIR/$archive_name"
chmod 600 "$ARCHIVE_DIR/$archive_name"
find "$ARCHIVE_DIR" -maxdepth 1 -type f -name 'devflow-*.dfbackup' -mtime "+$RETENTION_DAYS" -delete
if [[ -d "$ARCHIVE_DIR/.metadata" && ! -L "$ARCHIVE_DIR/.metadata" ]]; then
  find "$ARCHIVE_DIR/.metadata" -maxdepth 1 -type f -name '*.json' -mtime "+$RETENTION_DAYS" -delete
fi
printf 'Backup criado: %s\n' "$ARCHIVE_DIR/$archive_name"
