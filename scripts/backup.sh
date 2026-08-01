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
ARCHIVE_DIR="${BACKUP_ARCHIVE_DIR:-/opt/devflow/backups}"
PASSPHRASE_FILE="${BACKUP_PASSPHRASE_FILE:-/opt/devflow/config/backup.passphrase}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
UPLOAD_SOURCE="${DEVFLOW_UPLOADS_PATH:-devflow_devflow_uploads}"
COMPOSE=(docker compose --env-file "$ENV_FILE" -p devflow --project-directory "$PROJECT_DIR" -f "$PROJECT_DIR/docker-compose.yml")
[[ "${DEVFLOW_PROXY_MODE:-}" != shared ]] || COMPOSE+=(-f "$PROJECT_DIR/docker-compose.shared.yml")

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
archive_name="devflow-${timestamp}.dfbackup"

"${COMPOSE[@]}" exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$TEMP_DIR/database.dump"
docker run --rm \
  -v "$UPLOAD_SOURCE:/source:ro" \
  -v "$TEMP_DIR:/work" \
  alpine:3.22 tar -C /source -czf /work/uploads.tar.gz .

db_sha="$(sha256sum "$TEMP_DIR/database.dump" | awk '{print $1}')"
uploads_sha="$(sha256sum "$TEMP_DIR/uploads.tar.gz" | awk '{print $1}')"
app_sha="$(cat "$PROJECT_DIR/.devflow-release" 2>/dev/null || git -C "$PROJECT_DIR" rev-parse HEAD 2>/dev/null || printf 'uncommitted')"
cat > "$TEMP_DIR/manifest.json" <<EOF
{"format":"devflow-backup-v1","created_at":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","application_sha":"$app_sha","database_sha256":"$db_sha","uploads_sha256":"$uploads_sha"}
EOF
(
  cd "$TEMP_DIR"
  sha256sum database.dump uploads.tar.gz manifest.json > checksums.sha256
  tar -czf payload.tar.gz manifest.json checksums.sha256 database.dump uploads.tar.gz
)

"${COMPOSE[@]}" run --rm --no-deps --user 0:0 \
  -v "$TEMP_DIR:/work" \
  -v "$PASSPHRASE_FILE:/run/secrets/devflow_backup_passphrase:ro" \
  -e BACKUP_PASSPHRASE_FILE=/run/secrets/devflow_backup_passphrase \
  backend node scripts/cryptoEnvelope.js encrypt /work/payload.tar.gz "/work/$archive_name"

mv -- "$TEMP_DIR/$archive_name" "$ARCHIVE_DIR/$archive_name"
chmod 600 "$ARCHIVE_DIR/$archive_name"
find "$ARCHIVE_DIR" -maxdepth 1 -type f -name 'devflow-*.dfbackup' -mtime "+$RETENTION_DAYS" -delete
printf 'Backup criado: %s\n' "$ARCHIVE_DIR/$archive_name"
