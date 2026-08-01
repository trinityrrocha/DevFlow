#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[[ "${CONFIRM_RESTORE:-}" == "RESTAURAR BACKUP" ]] || {
  echo 'Defina CONFIRM_RESTORE="RESTAURAR BACKUP" para autorizar a restauração.' >&2
  exit 1
}
[[ $# -eq 1 ]] || { echo "Uso: $0 <arquivo.dfbackup>" >&2; exit 1; }

PROJECT_DIR="${DEVFLOW_PROJECT_DIR:-/opt/devflow/app}"
ENV_FILE="${DEVFLOW_ENV_FILE:-/opt/devflow/config/devflow.env}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"
DEVFLOW_ENV_FILE="$ENV_FILE"
load_devflow_env
PASSPHRASE_FILE="${BACKUP_PASSPHRASE_FILE:-/opt/devflow/config/backup.passphrase}"
BACKUP_FILE="$(realpath "$1")"
MAX_RESTORE_MB="${BACKUP_MAX_RESTORE_MB:-4096}"
UPLOAD_SOURCE="${DEVFLOW_UPLOADS_PATH:-devflow_devflow_uploads}"
COMPOSE=(docker compose --env-file "$ENV_FILE" -p devflow --project-directory "$PROJECT_DIR" -f "$PROJECT_DIR/docker-compose.yml")
[[ "${DEVFLOW_PROXY_MODE:-}" != shared ]] || COMPOSE+=(-f "$PROJECT_DIR/docker-compose.shared.yml")

[[ -f "$BACKUP_FILE" && "$BACKUP_FILE" == *.dfbackup ]] || { echo "Backup inválido." >&2; exit 1; }
[[ -r "$PASSPHRASE_FILE" ]] || { echo "Passphrase de backup ausente." >&2; exit 1; }
[[ "$MAX_RESTORE_MB" =~ ^[0-9]+$ ]] || { echo "Limite de restauração inválido." >&2; exit 1; }
if [[ "$UPLOAD_SOURCE" == /* ]]; then
  resolved_uploads="$(realpath -m "$UPLOAD_SOURCE")"
  [[ "$resolved_uploads" == /opt/devflow/storage || "$resolved_uploads" == /opt/devflow/storage/* ]] \
    || { echo 'Storage fora do namespace DevFlow.' >&2; exit 1; }
else
  [[ "$UPLOAD_SOURCE" =~ ^devflow_[A-Za-z0-9_.-]+$ ]] \
    || { echo 'Volume de storage não pertence ao namespace DevFlow.' >&2; exit 1; }
fi
[[ "$(stat -c '%s' "$BACKUP_FILE")" -le $((MAX_RESTORE_MB * 1024 * 1024)) ]] || {
  echo "Backup excede o limite de restauração." >&2
  exit 1
}

BACKUP_ARCHIVE_DIR="${BACKUP_ARCHIVE_DIR:-/opt/devflow/backups}" \
BACKUP_PASSPHRASE_FILE="$PASSPHRASE_FILE" \
DEVFLOW_ENV_FILE="$ENV_FILE" \
DEVFLOW_PROJECT_DIR="$PROJECT_DIR" \
"$PROJECT_DIR/scripts/backup.sh"

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/devflow-restore.XXXXXX")"
BACKEND_STOPPED=0
cleanup() {
  if [[ "$BACKEND_STOPPED" -eq 1 ]]; then
    "${COMPOSE[@]}" start backend >/dev/null 2>&1 || true
  fi
  rm -rf -- "$TEMP_DIR"
}
trap cleanup EXIT

"${COMPOSE[@]}" run --rm --no-deps --user 0:0 \
  -v "$(dirname "$BACKUP_FILE"):/backup:ro" \
  -v "$TEMP_DIR:/work" \
  -v "$PASSPHRASE_FILE:/run/secrets/devflow_backup_passphrase:ro" \
  -e BACKUP_PASSPHRASE_FILE=/run/secrets/devflow_backup_passphrase \
  backend node scripts/cryptoEnvelope.js decrypt "/backup/$(basename "$BACKUP_FILE")" /work/payload.tar.gz

while IFS= read -r entry; do
  [[ "$entry" != /* && "$entry" != *"../"* && "$entry" != ".." ]] || {
    echo "Entrada insegura no backup: $entry" >&2
    exit 1
  }
done < <(tar -tzf "$TEMP_DIR/payload.tar.gz")
while IFS= read -r listing; do
  entry_type="${listing:0:1}"
  [[ "$entry_type" == "-" || "$entry_type" == "d" ]] || {
    echo "Link ou tipo especial rejeitado no pacote de backup." >&2
    exit 1
  }
done < <(tar -tvzf "$TEMP_DIR/payload.tar.gz")
payload_expanded_bytes="$(tar --numeric-owner -tvzf "$TEMP_DIR/payload.tar.gz" | awk '{total += $3} END {printf "%.0f", total}')"
[[ "$payload_expanded_bytes" -le $((MAX_RESTORE_MB * 1024 * 1024)) ]] || {
  echo "Conteúdo expandido excede o limite de restauração." >&2
  exit 1
}

tar -xzf "$TEMP_DIR/payload.tar.gz" -C "$TEMP_DIR"
(
  cd "$TEMP_DIR"
  sha256sum -c checksums.sha256
)

while IFS= read -r entry; do
  [[ "$entry" != /* && "$entry" != *"../"* && "$entry" != ".." ]] || {
    echo "Entrada insegura no arquivo de anexos: $entry" >&2
    exit 1
  }
done < <(tar -tzf "$TEMP_DIR/uploads.tar.gz")
while IFS= read -r listing; do
  entry_type="${listing:0:1}"
  [[ "$entry_type" == "-" || "$entry_type" == "d" ]] || {
    echo "Link ou tipo especial rejeitado no arquivo de anexos." >&2
    exit 1
  }
done < <(tar -tvzf "$TEMP_DIR/uploads.tar.gz")
uploads_expanded_bytes="$(tar --numeric-owner -tvzf "$TEMP_DIR/uploads.tar.gz" | awk '{total += $3} END {printf "%.0f", total}')"
[[ "$uploads_expanded_bytes" -le $((MAX_RESTORE_MB * 1024 * 1024)) ]] || {
  echo "Anexos expandidos excedem o limite de restauração." >&2
  exit 1
}

"${COMPOSE[@]}" stop backend
BACKEND_STOPPED=1

"${COMPOSE[@]}" exec -T db sh -c \
  'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges' \
  < "$TEMP_DIR/database.dump"

docker run --rm \
  -v "$UPLOAD_SOURCE:/target" \
  -v "$TEMP_DIR:/work:ro" \
  alpine:3.22 sh -c \
  'find /target -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar -xzf /work/uploads.tar.gz -C /target'

"${COMPOSE[@]}" exec -T db sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "UPDATE user_sessions SET revoked_at=CURRENT_TIMESTAMP,revoke_reason='\''backup_restored'\'' WHERE revoked_at IS NULL"'
"${COMPOSE[@]}" start backend
BACKEND_STOPPED=0
"${COMPOSE[@]}" up -d --wait
printf 'Restauração concluída e sessões anteriores revogadas.\n'
