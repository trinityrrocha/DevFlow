#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPERATION="${1:-}"
BACKUP_ID="${2:-}"
STATUS_FILE="${DEVFLOW_OPERATION_STATUS_FILE:-}"
BACKUP_ROOT=/opt/devflow/backups

case "$OPERATION" in
  create-backup) [[ -z "$BACKUP_ID" ]] || exit 2 ;;
  verify-backup|restore-backup|delete-backup) [[ "$BACKUP_ID" =~ ^[0-9a-f]{32}$ ]] || exit 2 ;;
  *) echo 'Operacao de backup nao autorizada.' >&2; exit 2 ;;
esac
[[ "$STATUS_FILE" == /var/lib/devflow/updater/status/*.json ]] || { echo 'Status operacional invalido.' >&2; exit 2; }

status() { node "$SCRIPT_DIR/write-update-status.mjs" "$STATUS_FILE" "$1" "$OPERATION"; }
resolve_backup() { node "$SCRIPT_DIR/resolve-backup-id.mjs" "$BACKUP_ROOT" "$BACKUP_ID"; }
project_env=(DEVFLOW_PROJECT_DIR=/opt/devflow/app DEVFLOW_ENV_FILE=/opt/devflow/config/devflow.env DEVFLOW_OPERATION_LOCK_HELD=true)

case "$OPERATION" in
  create-backup)
    status processing
    env "${project_env[@]}" BACKUP_ARCHIVE_DIR="$BACKUP_ROOT" "$SCRIPT_DIR/backup.sh"
    ;;
  verify-backup)
    status processing
    backup_file="$(resolve_backup)"
    env "${project_env[@]}" "$SCRIPT_DIR/verify-backup.sh" "$backup_file"
    ;;
  delete-backup)
    status processing
    backup_file="$(resolve_backup)"
    [[ -f "$backup_file" && ! -L "$backup_file" ]] || exit 2
    rm -- "$backup_file"
    printf 'Backup excluido: %s\n' "$BACKUP_ID"
    ;;
  restore-backup)
    status backup
    selected_backup="$(resolve_backup)"
    safety_output="$(env "${project_env[@]}" BACKUP_ARCHIVE_DIR="$BACKUP_ROOT" "$SCRIPT_DIR/backup.sh")"
    printf '%s\n' "$safety_output"
    safety_backup="$(printf '%s\n' "$safety_output" | sed -n 's/^Backup criado: //p' | tail -n1)"
    [[ -n "$safety_backup" && -f "$safety_backup" ]] || { echo 'Backup de seguranca nao foi criado.' >&2; exit 1; }
    env "${project_env[@]}" "$SCRIPT_DIR/verify-backup.sh" "$safety_backup"
    env "${project_env[@]}" "$SCRIPT_DIR/verify-backup.sh" "$selected_backup"
    status maintenance
    DEVFLOW_APP_ROOT=/opt/devflow/app DEVFLOW_ENV_FILE=/opt/devflow/config/devflow.env
    export DEVFLOW_APP_ROOT DEVFLOW_ENV_FILE
    # shellcheck source=lib/common.sh
    . "$SCRIPT_DIR/lib/common.sh"
    load_devflow_env
    compose_files
    build_devflow_compose_command /opt/devflow/app "$DEVFLOW_ENV_FILE" MAINTENANCE_COMPOSE devflow-maintenance maintenance
    "${DEVFLOW_COMPOSE[@]}" stop edge >/dev/null 2>&1 || true
    "${MAINTENANCE_COMPOSE[@]}" up -d --wait
    restore_status=0
    env "${project_env[@]}" CONFIRM_RESTORE='RESTAURAR BACKUP' DEVFLOW_RESTORE_SKIP_PREBACKUP=true \
      DEVFLOW_RESTORE_NO_START=true "$SCRIPT_DIR/restore.sh" "$selected_backup" || restore_status=$?
    if [[ "$restore_status" -ne 0 ]]; then
      echo 'Restore selecionado falhou; restaurando o backup de seguranca da operacao.' >&2
      safety_restore_status=0
      env "${project_env[@]}" CONFIRM_RESTORE='RESTAURAR BACKUP' DEVFLOW_RESTORE_SKIP_PREBACKUP=true \
        DEVFLOW_RESTORE_NO_START=true "$SCRIPT_DIR/restore.sh" "$safety_backup" || safety_restore_status=$?
      if [[ "$safety_restore_status" -ne 0 ]]; then
        echo 'manualRecoveryRequired=true' >&2
        echo 'O backup de seguranca tambem falhou; manutencao preservada para recuperacao manual.' >&2
        exit "$safety_restore_status"
      fi
      "${MAINTENANCE_COMPOSE[@]}" down --remove-orphans >/dev/null 2>&1 || true
      "${DEVFLOW_COMPOSE[@]}" up -d --wait
      DEVFLOW_UPDATE_DAEMON=true /opt/devflow/app/scripts/health.sh --daemon
      exit "$restore_status"
    fi
    "${MAINTENANCE_COMPOSE[@]}" down --remove-orphans >/dev/null 2>&1 || true
    "${DEVFLOW_COMPOSE[@]}" up -d --wait
    status health
    DEVFLOW_UPDATE_DAEMON=true /opt/devflow/app/scripts/health.sh --daemon
    ;;
esac
