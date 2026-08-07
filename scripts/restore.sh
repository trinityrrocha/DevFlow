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
DEVFLOW_IDENTITY_RELEASE_ROOT="$PROJECT_DIR"
TRANSACTION_MODE=false
TRANSACTION_FILE="${DEVFLOW_RESTORE_TRANSACTION_FILE:-}"
if [[ -z "$TRANSACTION_FILE" ]]; then
  resolve_installed_release_identity "$DEVFLOW_INSTALL_ROOT/source" main >/dev/null \
    || { echo 'Identidade instalada não comprovada; restauração bloqueada.' >&2; exit 1; }
  DEVFLOW_VERSION="$INSTALLED_VERSION"
  DEVFLOW_RELEASE_COMMIT="$INSTALLED_COMMIT"
else
  TRANSACTION_MODE=true
fi
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

if [[ "$TRANSACTION_MODE" == true ]]; then
  [[ "$TRANSACTION_FILE" == "$DEVFLOW_STATE_ROOT/update-transaction.json" \
    && -f "$TRANSACTION_FILE" && ! -L "$TRANSACTION_FILE" ]] \
    || die 'Arquivo de transacao do rollback invalido.'
  python3 "$SCRIPT_DIR/validate-update-transaction.py" validate "$TRANSACTION_FILE" >/dev/null \
    || die 'Transacao do rollback nao foi comprovada.'
  transaction_backup="$(installation_state_value backupPath "$TRANSACTION_FILE")"
  transaction_backup_hash="$(installation_state_value backupHash "$TRANSACTION_FILE")"
  transaction_previous_version="$(installation_state_value previousVersion "$TRANSACTION_FILE")"
  transaction_previous_commit="$(installation_state_value previousCommit "$TRANSACTION_FILE")"
  transaction_previous_release="$(installation_state_value previousRelease "$TRANSACTION_FILE")"
  transaction_previous_migration="$(installation_state_value previousMigration "$TRANSACTION_FILE")"
  transaction_id="$(installation_state_value transactionId "$TRANSACTION_FILE")"
  transaction_timestamp="$(installation_state_value timestamp "$TRANSACTION_FILE")"
  transaction_state_snapshot="$(installation_state_value previousInstallationStateBackup "$TRANSACTION_FILE")"
  transaction_state_hash="$(installation_state_value previousInstallationStateHash "$TRANSACTION_FILE")"
  [[ "$(installation_state_value rollbackStarted "$TRANSACTION_FILE")" == true \
    && "$transaction_backup" == "$BACKUP_FILE" \
    && "$(sha256sum "$BACKUP_FILE" | awk '{print $1}')" == "$transaction_backup_hash" \
    && "$transaction_previous_release" == "$(readlink -f "$PROJECT_DIR")" \
    && "$(tr -d '\r\n' < "$PROJECT_DIR/.devflow-release")" == "$transaction_previous_commit" \
    && -f "$transaction_state_snapshot" && ! -L "$transaction_state_snapshot" \
    && "$(sha256sum "$transaction_state_snapshot" | awk '{print $1}')" == "$transaction_state_hash" ]] \
    || die 'Backup ou identidade anterior nao pertencem a transacao de rollback.'
  DEVFLOW_VERSION="$transaction_previous_version"
  DEVFLOW_RELEASE_COMMIT="$transaction_previous_commit"
  DEVFLOW_EXPLICIT_RELEASE_IDENTITY=true
  export DEVFLOW_VERSION DEVFLOW_RELEASE_COMMIT DEVFLOW_EXPLICIT_RELEASE_IDENTITY
  validate_explicit_release_identity || die 'Release anterior da transacao nao foi comprovada.'
  DEVFLOW_BACKUP_EXPECTED_TRANSACTION_ID="$transaction_id" \
    DEVFLOW_BACKUP_EXPECTED_TRANSACTION_TIMESTAMP="$transaction_timestamp" \
    DEVFLOW_BACKUP_EXPECTED_VERSION="$transaction_previous_version" \
    DEVFLOW_BACKUP_EXPECTED_COMMIT="$transaction_previous_commit" \
    DEVFLOW_BACKUP_EXPECTED_MIGRATION="$transaction_previous_migration" \
    DEVFLOW_BACKUP_EXPECTED_STATE_SHA256="$transaction_state_hash" \
    DEVFLOW_PROJECT_DIR="$PROJECT_DIR" DEVFLOW_ENV_FILE="$ENV_FILE" \
    "$SCRIPT_DIR/verify-backup.sh" "$BACKUP_FILE" >/dev/null \
    || die 'Backup transacional recusado antes da restauracao.'
  DEVFLOW_APP_ROOT="$PROJECT_DIR"
  compose_files
fi

if [[ "$SKIP_PREBACKUP" == false ]]; then
  BACKUP_ARCHIVE_DIR="${BACKUP_ARCHIVE_DIR:-/opt/devflow/backups}" \
  BACKUP_PASSPHRASE_FILE="$PASSPHRASE_FILE" \
  DEVFLOW_ENV_FILE="$ENV_FILE" \
  DEVFLOW_PROJECT_DIR="$PROJECT_DIR" \
  "$PROJECT_DIR/scripts/backup.sh"
fi

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/devflow-restore.XXXXXX")"
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

if [[ "$TRANSACTION_MODE" == true ]]; then
  docker stop devflow-worker >/dev/null 2>&1 || true
fi
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
if [[ "$TRANSACTION_MODE" == true ]]; then
  restored_migration="$("${DEVFLOW_COMPOSE[@]}" exec -T db sh -c \
    'psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT version FROM schema_migrations ORDER BY applied_at DESC LIMIT 1"')"
  [[ "$restored_migration" == "$transaction_previous_migration" ]] \
    || die 'Banco restaurado nao retornou a migration anterior registrada.'
  printf '%s\n' 'database_restore_completed=true' "restored_migration=$restored_migration"
fi
if [[ "$NO_START" == false ]]; then
  "${DEVFLOW_COMPOSE[@]}" start backend
  BACKEND_STOPPED=0
  "${DEVFLOW_COMPOSE[@]}" up -d --wait
  printf 'Restauração concluída e sessões anteriores revogadas.\n'
else
  printf 'Restauração concluída; backend mantido parado para coordenação externa.\n'
fi
