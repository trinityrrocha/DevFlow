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
if [[ "${DEVFLOW_OPERATION_LOCK_HELD:-false}" != true ]]; then
  install -d -m 0750 /run/lock/devflow
  exec 8>/run/lock/devflow/operations.lock
  flock -n 8 || die 'Outra operacao DevFlow esta em andamento.'
  export DEVFLOW_OPERATION_LOCK_HELD=true
fi
DEVFLOW_IDENTITY_RELEASE_ROOT="$PROJECT_DIR"
resolve_installed_release_identity "$DEVFLOW_INSTALL_ROOT/source" main >/dev/null \
  || { echo 'Identidade instalada não comprovada; restauração bloqueada.' >&2; exit 1; }
DEVFLOW_VERSION="$INSTALLED_VERSION"
DEVFLOW_RELEASE_COMMIT="$INSTALLED_COMMIT"
export DEVFLOW_VERSION DEVFLOW_RELEASE_COMMIT DEVFLOW_IDENTITY_RELEASE_ROOT
PASSPHRASE_FILE="${BACKUP_PASSPHRASE_FILE:-/opt/devflow/config/backup.passphrase}"
BACKUP_FILE="$(realpath "$1")"
MAX_RESTORE_MB="${BACKUP_MAX_RESTORE_MB:-4096}"
UPLOAD_SOURCE="${DEVFLOW_UPLOADS_PATH:-devflow_devflow_uploads}"
DEVFLOW_APP_ROOT="$PROJECT_DIR"
compose_files
SKIP_PREBACKUP="${DEVFLOW_RESTORE_SKIP_PREBACKUP:-false}"
NO_START="${DEVFLOW_RESTORE_NO_START:-false}"
[[ "$SKIP_PREBACKUP" == true || "$SKIP_PREBACKUP" == false ]] || { echo 'DEVFLOW_RESTORE_SKIP_PREBACKUP inválido.' >&2; exit 1; }
[[ "$NO_START" == true || "$NO_START" == false ]] || { echo 'DEVFLOW_RESTORE_NO_START inválido.' >&2; exit 1; }

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

if [[ "$SKIP_PREBACKUP" == false ]]; then
  BACKUP_ARCHIVE_DIR="${BACKUP_ARCHIVE_DIR:-/opt/devflow/backups}" \
  BACKUP_PASSPHRASE_FILE="$PASSPHRASE_FILE" \
  DEVFLOW_ENV_FILE="$ENV_FILE" \
  DEVFLOW_PROJECT_DIR="$PROJECT_DIR" \
  "$PROJECT_DIR/scripts/backup.sh"
fi

TEMP_ROOT=/opt/devflow/tmp
[[ "$TEMP_ROOT" = /* && "$TEMP_ROOT" == /opt/devflow/* ]] || die 'Namespace temporario de restore invalido.'
if [[ -e "$TEMP_ROOT" || -L "$TEMP_ROOT" ]]; then
  [[ -d "$TEMP_ROOT" && ! -L "$TEMP_ROOT" ]] || die 'Namespace temporario de restore invalido.'
else
  install -d -m 0700 -o root -g root "$TEMP_ROOT"
fi
[[ -d "$TEMP_ROOT" && ! -L "$TEMP_ROOT" ]] \
  || die 'Namespace temporario de restore invalido.'
[[ "$(stat -c '%u:%a' "$TEMP_ROOT")" == 0:700 ]] || die 'Namespace temporario deve pertencer a root e usar modo 0700.'
TEMP_DIR="$(mktemp -d "$TEMP_ROOT/restore-backup.XXXXXX")"
chmod 0700 "$TEMP_DIR"
BACKEND_STOPPED=0
cleanup() {
  if [[ "$BACKEND_STOPPED" -eq 1 && "$NO_START" == false ]]; then
    "${DEVFLOW_COMPOSE[@]}" start backend >/dev/null 2>&1 || true
  fi
  rm -rf -- "$TEMP_DIR"
}
trap cleanup EXIT

"${DEVFLOW_COMPOSE[@]}" run --rm --no-deps --user 0:0 \
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

docker stop devflow-worker >/dev/null 2>&1 || true
"${DEVFLOW_COMPOSE[@]}" stop backend
BACKEND_STOPPED=1

"${DEVFLOW_COMPOSE[@]}" exec -T db sh -c \
  'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges' \
  < "$TEMP_DIR/database.dump"

docker run --rm \
  -v "$UPLOAD_SOURCE:/target" \
  -v "$TEMP_DIR:/work:ro" \
  alpine:3.22 sh -c \
  'find /target -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar -xzf /work/uploads.tar.gz -C /target'

"${DEVFLOW_COMPOSE[@]}" exec -T db sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "UPDATE user_sessions SET revoked_at=CURRENT_TIMESTAMP,revoke_reason='\''backup_restored'\'' WHERE revoked_at IS NULL"'
restored_migration="$("${DEVFLOW_COMPOSE[@]}" exec -T db sh -c \
  'psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT version FROM schema_migrations ORDER BY applied_at DESC LIMIT 1"')"
printf '%s\n' 'database_restore_completed=true' "restored_migration=$restored_migration"
if [[ "$NO_START" == false ]]; then
  "${DEVFLOW_COMPOSE[@]}" start backend
  BACKEND_STOPPED=0
  "${DEVFLOW_COMPOSE[@]}" up -d --wait
  printf 'Restauração concluída e sessões anteriores revogadas.\n'
else
  printf 'Restauração concluída; backend mantido parado para coordenação externa.\n'
fi
