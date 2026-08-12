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
DEVFLOW_APP_ROOT="$PROJECT_DIR"
compose_files

[[ -f "$BACKUP_FILE" && "$BACKUP_FILE" == *.dfbackup ]] || die 'Backup inválido.'
[[ -r "$PASSPHRASE_FILE" ]] || die 'Passphrase de backup ausente.'
[[ "$MAX_RESTORE_MB" =~ ^[0-9]+$ ]] || die 'Limite de verificação inválido.'
[[ "$(stat -c '%s' "$BACKUP_FILE")" -le $((MAX_RESTORE_MB * 1024 * 1024)) ]] || die 'Backup excede o limite de verificação.'

TEMP_ROOT=/opt/devflow/tmp
[[ "$TEMP_ROOT" = /* && "$TEMP_ROOT" == /opt/devflow/* ]] || die 'Namespace temporario de verificacao invalido.'
if [[ -e "$TEMP_ROOT" || -L "$TEMP_ROOT" ]]; then
  [[ -d "$TEMP_ROOT" && ! -L "$TEMP_ROOT" ]] || die 'Namespace temporario de verificacao invalido.'
else
  install -d -m 0700 -o root -g root "$TEMP_ROOT"
fi
[[ -d "$TEMP_ROOT" && ! -L "$TEMP_ROOT" ]] \
  || die 'Namespace temporario de verificacao invalido.'
[[ "$(stat -c '%u:%a' "$TEMP_ROOT")" == 0:700 ]] || die 'Namespace temporario deve pertencer a root e usar modo 0700.'
TEMP_DIR="$(mktemp -d "$TEMP_ROOT/verify-backup.XXXXXX")"
chmod 0700 "$TEMP_DIR"
trap 'rm -rf -- "$TEMP_DIR"' EXIT

"${DEVFLOW_COMPOSE[@]}" run --rm --no-deps --user 0:0 \
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
if [[ -n "${DEVFLOW_BACKUP_EXPECTED_TRANSACTION_ID:-}" ]]; then
  [[ "$DEVFLOW_BACKUP_EXPECTED_TRANSACTION_ID" =~ ^[0-9a-f]{32}$ \
    && "${DEVFLOW_BACKUP_EXPECTED_TRANSACTION_TIMESTAMP:-}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ \
    && "${DEVFLOW_BACKUP_EXPECTED_VERSION:-}" =~ ^[0-9]+\.[0-9]+\.[0-9]+ \
    && "${DEVFLOW_BACKUP_EXPECTED_COMMIT:-}" =~ ^[0-9a-f]{40}$ \
    && "${DEVFLOW_BACKUP_EXPECTED_MIGRATION:-}" =~ ^[0-9]{3}_[A-Za-z0-9_]+\.sql$ \
    && "${DEVFLOW_BACKUP_EXPECTED_STATE_SHA256:-}" =~ ^[0-9a-f]{64}$ ]] \
    || die 'Expectativa transacional do backup invalida.'
  python3 - "$TEMP_DIR/manifest.json" <<'PY'
import datetime
import json
import os
import sys

with open(sys.argv[1], encoding="utf-8") as stream:
    manifest = json.load(stream)
expected = {
    "format": "devflow-backup-v2",
    "transaction_id": os.environ["DEVFLOW_BACKUP_EXPECTED_TRANSACTION_ID"],
    "transaction_timestamp": os.environ["DEVFLOW_BACKUP_EXPECTED_TRANSACTION_TIMESTAMP"],
    "application_version": os.environ["DEVFLOW_BACKUP_EXPECTED_VERSION"],
    "application_sha": os.environ["DEVFLOW_BACKUP_EXPECTED_COMMIT"],
    "database_migration": os.environ["DEVFLOW_BACKUP_EXPECTED_MIGRATION"],
    "installation_state_sha256": os.environ["DEVFLOW_BACKUP_EXPECTED_STATE_SHA256"],
}
for key, value in expected.items():
    if manifest.get(key) != value:
        raise SystemExit(f"backup-transaction-identity-mismatch:{key}")
created = datetime.datetime.fromisoformat(manifest["created_at"].replace("Z", "+00:00"))
started = datetime.datetime.fromisoformat(manifest["transaction_timestamp"].replace("Z", "+00:00"))
now = datetime.datetime.now(datetime.timezone.utc)
if created < started - datetime.timedelta(minutes=5) or created > now + datetime.timedelta(minutes=5):
    raise SystemExit("backup-transaction-timestamp-invalid")
PY
fi
while IFS= read -r entry; do
  [[ "$entry" != /* && "$entry" != *"../"* && "$entry" != ".." ]] || die "Entrada insegura nos uploads: $entry"
done < <(tar -tzf "$TEMP_DIR/uploads.tar.gz")
while IFS= read -r listing; do
  entry_type="${listing:0:1}"
  [[ "$entry_type" == "-" || "$entry_type" == "d" ]] || die 'Link ou tipo especial rejeitado nos uploads.'
done < <(tar -tvzf "$TEMP_DIR/uploads.tar.gz")
uploads_expanded_bytes="$(tar --numeric-owner -tvzf "$TEMP_DIR/uploads.tar.gz" | awk '{total += $3} END {printf "%.0f", total}')"
[[ "$uploads_expanded_bytes" -le $((MAX_RESTORE_MB * 1024 * 1024)) ]] || die 'Uploads excedem o limite de verificação.'

BACKUP_ROOT="$(dirname "$BACKUP_FILE")"
if [[ "$BACKUP_ROOT" == /opt/devflow/backups ]]; then
  metadata_id="$(printf '%s' "$(basename "$BACKUP_FILE")" | sha256sum | cut -c1-32)"
  METADATA_ROOT="$BACKUP_ROOT/.metadata"
  if [[ -e "$METADATA_ROOT" || -L "$METADATA_ROOT" ]]; then
    [[ -d "$METADATA_ROOT" && ! -L "$METADATA_ROOT" ]] || die 'Cache de metadata inseguro.'
  else
    install -d -m 0700 "$METADATA_ROOT"
  fi
  METADATA_ID="$metadata_id" METADATA_FILENAME="$(basename "$BACKUP_FILE")" \
    python3 - "$TEMP_DIR/manifest.json" "$METADATA_ROOT/$metadata_id.json" <<'PY'
import datetime
import json
import os
import pathlib
import tempfile
import sys

manifest = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
metadata = {
    "id": os.environ["METADATA_ID"], "filename": os.environ["METADATA_FILENAME"],
    "status": "verified", "applicationVersion": manifest.get("application_version"),
    "applicationCommit": manifest.get("application_sha"),
    "databaseMigration": manifest.get("database_migration"), "format": manifest.get("format"),
    "verifiedAt": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
}
destination = pathlib.Path(sys.argv[2])
fd, temporary = tempfile.mkstemp(prefix=".metadata.", dir=destination.parent)
try:
    os.chmod(temporary, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        json.dump(metadata, stream, separators=(",", ":")); stream.write("\n")
    os.replace(temporary, destination)
finally:
    if os.path.exists(temporary): os.unlink(temporary)
PY
fi

printf 'Backup verificado: %s\n' "$BACKUP_FILE"
