#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

APP_DIR="${APP_DIR:-/opt/devflow}"
REQUEST_ROOT="${UPDATER_REQUEST_DIR:-/var/lib/devflow-updater}"
REQUEST_DIR="$REQUEST_ROOT/requests"
PROCESSING_DIR="$REQUEST_ROOT/processing"
PROCESSED_DIR="$REQUEST_ROOT/processed"
FAILED_DIR="$REQUEST_ROOT/failed"
LOCK_FILE="$REQUEST_ROOT/updater.lock"

log() { printf '%s [DevFlow Updater] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }
mkdir -p "$REQUEST_DIR" "$PROCESSING_DIR" "$PROCESSED_DIR" "$FAILED_DIR"
chown -R 100:100 "$REQUEST_ROOT"
chmod 0700 "$REQUEST_ROOT" "$REQUEST_DIR" "$PROCESSING_DIR" "$PROCESSED_DIR" "$FAILED_DIR"
touch "$REQUEST_ROOT/daemon.ready"
chmod 0600 "$REQUEST_ROOT/daemon.ready"

for interrupted in "$PROCESSING_DIR"/*.json; do
  [[ -f "$interrupted" && ! -L "$interrupted" ]] || continue
  mv -- "$interrupted" "$REQUEST_DIR/${interrupted##*/}"
done
log 'Daemon iniciado; fila privada pronta.'

while true; do
  touch "$REQUEST_ROOT/daemon.ready"
  request=
  for candidate in "$REQUEST_DIR"/*.json; do
    [[ -f "$candidate" && ! -L "$candidate" ]] || continue
    request="$candidate"
    break
  done
  if [[ -z "$request" ]]; then sleep 2; continue; fi
  exec 8>"$LOCK_FILE"
  if ! flock -n 8; then sleep 2; continue; fi
  name="${request##*/}"
  request_id="${name%.json}"
  processing="$PROCESSING_DIR/$name"
  log_file="$PROCESSING_DIR/$request_id.log"
  mv -- "$request" "$processing"
  if ! node "$APP_DIR/app/scripts/validate-updater-request.mjs" "$processing" "$request_id" >"$log_file" 2>&1; then
    mv -- "$processing" "$FAILED_DIR/$name"
    mv -- "$log_file" "$FAILED_DIR/$request_id.log"
    log "Solicitacao invalida recusada: $request_id"
    flock -u 8
    continue
  fi
  log "Processando solicitacao validada: $request_id"
  if DEVFLOW_UPDATE_DAEMON=true "$APP_DIR/app/scripts/update.sh" --request-file "$processing" >>"$log_file" 2>&1; then
    mv -- "$processing" "$PROCESSED_DIR/$name"
    mv -- "$log_file" "$PROCESSED_DIR/$request_id.log"
    log "Solicitacao concluida: $request_id"
  else
    status=$?
    mv -- "$processing" "$FAILED_DIR/$name"
    mv -- "$log_file" "$FAILED_DIR/$request_id.log"
    log "Solicitacao falhou: $request_id status=$status"
  fi
  flock -u 8
done
