#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[[ $# -eq 1 ]] || { echo "Uso: $0 <arquivo.dfbackup>" >&2; exit 2; }

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
COMPOSE=(docker compose --env-file "$ENV_FILE" -p devflow --project-directory "$PROJECT_DIR" -f "$PROJECT_DIR/docker-compose.yml")
[[ "${DEVFLOW_PROXY_MODE:-}" != shared ]] || COMPOSE+=(-f "$PROJECT_DIR/docker-compose.shared.yml")

[[ -f "$BACKUP_FILE" && "$BACKUP_FILE" == *.dfbackup ]] || die 'Backup inválido.'
[[ -r "$PASSPHRASE_FILE" ]] || die 'Passphrase de backup ausente.'
[[ "$MAX_RESTORE_MB" =~ ^[0-9]+$ ]] || die 'Limite de verificação inválido.'
[[ "$(stat -c '%s' "$BACKUP_FILE")" -le $((MAX_RESTORE_MB * 1024 * 1024)) ]] || die 'Backup excede o limite de verificação.'

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/devflow-verify.XXXXXX")"
trap 'rm -rf -- "$TEMP_DIR"' EXIT

"${COMPOSE[@]}" run --rm --no-deps --user 0:0 \
  -v "$(dirname "$BACKUP_FILE"):/backup:ro" \
  -v "$TEMP_DIR:/work" \
  -v "$PASSPHRASE_FILE:/run/secrets/devflow_backup_passphrase:ro" \
  -e BACKUP_PASSPHRASE_FILE=/run/secrets/devflow_backup_passphrase \
  backend node scripts/cryptoEnvelope.js decrypt "/backup/$(basename "$BACKUP_FILE")" /work/payload.tar.gz

while IFS= read -r entry; do
  [[ "$entry" != /* && "$entry" != *"../"* && "$entry" != ".." ]] || die "Entrada insegura no backup: $entry"
done < <(tar -tzf "$TEMP_DIR/payload.tar.gz")
while IFS= read -r listing; do
  entry_type="${listing:0:1}"
  [[ "$entry_type" == "-" || "$entry_type" == "d" ]] || die 'Link ou tipo especial rejeitado no backup.'
done < <(tar -tvzf "$TEMP_DIR/payload.tar.gz")

expanded_bytes="$(tar --numeric-owner -tvzf "$TEMP_DIR/payload.tar.gz" | awk '{total += $3} END {printf "%.0f", total}')"
[[ "$expanded_bytes" -le $((MAX_RESTORE_MB * 1024 * 1024)) ]] || die 'Conteúdo expandido excede o limite de verificação.'
tar -xzf "$TEMP_DIR/payload.tar.gz" -C "$TEMP_DIR"
(
  cd "$TEMP_DIR"
  sha256sum -c checksums.sha256
)
[[ -s "$TEMP_DIR/database.dump" && -s "$TEMP_DIR/uploads.tar.gz" && -s "$TEMP_DIR/manifest.json" ]] \
  || die 'Backup autenticado, mas incompleto.'
while IFS= read -r entry; do
  [[ "$entry" != /* && "$entry" != *"../"* && "$entry" != ".." ]] || die "Entrada insegura nos uploads: $entry"
done < <(tar -tzf "$TEMP_DIR/uploads.tar.gz")
while IFS= read -r listing; do
  entry_type="${listing:0:1}"
  [[ "$entry_type" == "-" || "$entry_type" == "d" ]] || die 'Link ou tipo especial rejeitado nos uploads.'
done < <(tar -tvzf "$TEMP_DIR/uploads.tar.gz")
uploads_expanded_bytes="$(tar --numeric-owner -tvzf "$TEMP_DIR/uploads.tar.gz" | awk '{total += $3} END {printf "%.0f", total}')"
[[ "$uploads_expanded_bytes" -le $((MAX_RESTORE_MB * 1024 * 1024)) ]] || die 'Uploads excedem o limite de verificação.'

printf 'Backup verificado: %s\n' "$BACKUP_FILE"
