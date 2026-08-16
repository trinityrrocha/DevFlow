#!/usr/bin/env bash
set -Eeuo pipefail
umask 0027

APP_DIR="${APP_DIR:-/opt/devflow}"
. "$APP_DIR/app/scripts/lib/operational-permissions.sh"
REQUEST_ROOT="${DEVFLOW_UPDATER_ROOT:-/var/lib/devflow/updater}"
REQUEST_DIR="$REQUEST_ROOT/requests"
PROCESSING_DIR="$REQUEST_ROOT/processing"
PROCESSED_DIR="$REQUEST_ROOT/processed"
FAILED_DIR="$REQUEST_ROOT/failed"
STATUS_DIR="$REQUEST_ROOT/status"
LOCK_FILE="/run/lock/devflow/operations.lock"
INSTALLATION_GATE_FILE="${INSTALLATION_GATE_FILE:-$APP_DIR/state/installation-in-progress}"
INSTALLATION_PROCESSING_BLOCKED=unknown
LAST_CATALOG_REFRESH=0

log() { printf '%s [DevFlow Updater] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }
updater_processing_blocked() { [[ -e "$INSTALLATION_GATE_FILE" ]]; }
devflow_resolve_runtime_ops_gid || { log 'GID operacional indisponivel; daemon recusou iniciar.'; exit 1; }
devflow_reconcile_operational_artifacts "$REQUEST_ROOT" "$DEVFLOW_OPS_GID" \
  || { log 'Contrato de permissoes operacional invalido; daemon recusou iniciar.'; exit 1; }
if [[ -d /opt/devflow/backups && ! -L /opt/devflow/backups ]]; then
  chgrp "$DEVFLOW_OPS_GID" /opt/devflow/backups
  chmod 0750 /opt/devflow/backups
  find /opt/devflow/backups -maxdepth 1 -type f -name 'devflow-????????T??????Z-????????.dfbackup' \
    -exec chgrp "$DEVFLOW_OPS_GID" {} + -exec chmod 0640 {} +
fi
mkdir -p /run/lock/devflow
touch "$REQUEST_ROOT/daemon.ready"
chown root:root "$REQUEST_ROOT/daemon.ready"
chmod 0600 "$REQUEST_ROOT/daemon.ready"
node "$APP_DIR/app/scripts/write-backup-catalog.mjs" /opt/devflow/backups "$REQUEST_ROOT/backup-catalog.json" || true

for interrupted in "$PROCESSING_DIR"/*.json; do
  [[ -f "$interrupted" && ! -L "$interrupted" ]] || continue
  interrupted_name="${interrupted##*/}"
  interrupted_id="${interrupted_name%.json}"
  mv -- "$interrupted" "$REQUEST_DIR/$interrupted_name"
  chown root:"$DEVFLOW_OPS_GID" "$REQUEST_DIR/$interrupted_name"
  chmod 0640 "$REQUEST_DIR/$interrupted_name"
  node "$APP_DIR/app/scripts/write-update-status.mjs" "$STATUS_DIR/$interrupted_id.json" pending || true
done
log 'Daemon iniciado; fila privada pronta.'

while true; do
  touch "$REQUEST_ROOT/daemon.ready"
  now_epoch="$(date +%s)"
  if (( now_epoch - LAST_CATALOG_REFRESH >= 30 )); then
    node "$APP_DIR/app/scripts/write-backup-catalog.mjs" /opt/devflow/backups "$REQUEST_ROOT/backup-catalog.json" || true
    LAST_CATALOG_REFRESH="$now_epoch"
  fi
  if updater_processing_blocked; then
    if [[ "$INSTALLATION_PROCESSING_BLOCKED" != true ]]; then
      log 'Instalacao em andamento; processamento da fila suspenso.'
      INSTALLATION_PROCESSING_BLOCKED=true
    fi
    sleep 2
    continue
  fi
  if [[ "$INSTALLATION_PROCESSING_BLOCKED" != false ]]; then
    log 'Instalacao concluida; processamento da fila liberado.'
    INSTALLATION_PROCESSING_BLOCKED=false
  fi
  request=
  for candidate in "$REQUEST_DIR"/*.json; do
    [[ -f "$candidate" && ! -L "$candidate" ]] || continue
    request="$candidate"
    break
  done
  if [[ -z "$request" ]]; then sleep 2; continue; fi
  exec 8>"$LOCK_FILE"
  if ! flock -n 8; then log 'update_in_progress=true'; sleep 2; continue; fi
  name="${request##*/}"
  request_id="${name%.json}"
  processing="$PROCESSING_DIR/$name"
  log_file="$PROCESSING_DIR/$request_id.log"
  status_file="$STATUS_DIR/$request_id.json"
  mv -- "$request" "$processing"
  chown root:"$DEVFLOW_OPS_GID" "$processing"
  chmod 0640 "$processing"
  : > "$log_file"
  chown root:root "$log_file"
  chmod 0600 "$log_file"
  validation_output="$PROCESSING_DIR/$request_id.validation"
  if ! node "$APP_DIR/app/scripts/validate-updater-request.mjs" "$processing" "$request_id" "$REQUEST_ROOT" >"$validation_output" 2>"$log_file"; then
    rm -f -- "$validation_output"
    node "$APP_DIR/app/scripts/write-update-status.mjs" "$status_file" failed || true
    mv -- "$processing" "$FAILED_DIR/$name"
    mv -- "$log_file" "$FAILED_DIR/$request_id.log"
    chmod 0640 "$FAILED_DIR/$name"
    chmod 0600 "$FAILED_DIR/$request_id.log"
    log "Solicitacao invalida recusada: $request_id"
    flock -u 8
    continue
  fi
  operation="$(sed -n 's/^operation=//p' "$validation_output")"
  backup_id="$(sed -n 's/^backup_id=//p' "$validation_output")"
  rm -f -- "$validation_output"
  case "$operation" in
    install-update|create-backup|verify-backup|restore-backup|delete-backup) ;;
    *) operation=invalid ;;
  esac
  node "$APP_DIR/app/scripts/write-update-status.mjs" "$status_file" processing "$operation"
  log "Processando solicitacao validada: $request_id"
  operation_status=0
  if [[ "$operation" == install-update ]]; then
    DEVFLOW_OPERATION_LOCK_HELD=true DEVFLOW_UPDATE_DAEMON=true DEVFLOW_UPDATE_INTERNAL=true \
      DEVFLOW_UPDATE_STATUS_FILE="$status_file" \
      "$APP_DIR/app/scripts/update.sh" >>"$log_file" 2>&1 || operation_status=$?
  elif [[ "$operation" != invalid ]]; then
    DEVFLOW_OPERATION_STATUS_FILE="$status_file" "$APP_DIR/app/scripts/backup-operation.sh" \
      "$operation" "$backup_id" >>"$log_file" 2>&1 || operation_status=$?
  else
    operation_status=2
  fi
  node "$APP_DIR/app/scripts/write-backup-catalog.mjs" /opt/devflow/backups "$REQUEST_ROOT/backup-catalog.json" || true
  if [[ "$operation_status" -eq 0 ]]; then
    node "$APP_DIR/app/scripts/write-update-status.mjs" "$status_file" completed "$operation" || true
    mv -- "$processing" "$PROCESSED_DIR/$name"
    mv -- "$log_file" "$PROCESSED_DIR/$request_id.log"
    chmod 0640 "$PROCESSED_DIR/$name"
    chmod 0600 "$PROCESSED_DIR/$request_id.log"
    log "Solicitacao concluida: $request_id"
  else
    status="$operation_status"
    node "$APP_DIR/app/scripts/write-update-status.mjs" "$status_file" failed "$operation" || true
    mv -- "$processing" "$FAILED_DIR/$name"
    mv -- "$log_file" "$FAILED_DIR/$request_id.log"
    chmod 0640 "$FAILED_DIR/$name"
    chmod 0600 "$FAILED_DIR/$request_id.log"
    log "Solicitacao falhou: $request_id status=$status"
  fi
  flock -u 8
done
