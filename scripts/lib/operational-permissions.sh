#!/usr/bin/env bash

DEVFLOW_OPS_GROUP_NAME="${DEVFLOW_OPS_GROUP_NAME:-devflow-ops}"

devflow_ops_gid_is_valid() {
  local gid="${1:-}"
  [[ "$gid" =~ ^[0-9]+$ && "$gid" -gt 0 && "$gid" -le 2147483647 ]]
}

devflow_resolve_runtime_ops_gid() {
  local runtime_gid
  if devflow_ops_gid_is_valid "${DEVFLOW_OPS_GID:-}"; then return 0; fi
  command -v docker >/dev/null 2>&1 || return 2
  runtime_gid="$(docker exec devflow-backend id -g devflow 2>/dev/null || true)"
  devflow_ops_gid_is_valid "$runtime_gid" || return 2
  DEVFLOW_OPS_GID="$runtime_gid"
  export DEVFLOW_OPS_GID
}

devflow_ensure_host_ops_group() {
  local configured_gid="${DEVFLOW_OPS_GID:-}" group_record group_gid conflicting_group
  command -v getent >/dev/null 2>&1 || return 2
  command -v groupadd >/dev/null 2>&1 || return 2
  [[ -z "$configured_gid" ]] || devflow_ops_gid_is_valid "$configured_gid" || return 2

  group_record="$(getent group "$DEVFLOW_OPS_GROUP_NAME" 2>/dev/null || true)"
  if [[ -n "$group_record" ]]; then
    group_gid="$(printf '%s' "$group_record" | awk -F: '{print $3}')"
    devflow_ops_gid_is_valid "$group_gid" || return 2
    [[ -z "$configured_gid" || "$configured_gid" == "$group_gid" ]] || return 3
  elif [[ -n "$configured_gid" ]]; then
    conflicting_group="$(getent group "$configured_gid" 2>/dev/null || true)"
    [[ -z "$conflicting_group" ]] || return 3
    groupadd --system --gid "$configured_gid" "$DEVFLOW_OPS_GROUP_NAME"
    group_gid="$configured_gid"
  else
    groupadd --system "$DEVFLOW_OPS_GROUP_NAME"
    group_gid="$(getent group "$DEVFLOW_OPS_GROUP_NAME" | awk -F: '{print $3}')"
  fi
  devflow_ops_gid_is_valid "$group_gid" || return 2
  DEVFLOW_OPS_GID="$group_gid"
  export DEVFLOW_OPS_GID
}

devflow_operational_root_is_allowed() {
  [[ "${1:-}" == /opt/devflow/updater || "${1:-}" == /var/lib/devflow/updater ]]
}

devflow_prepare_operational_contract() {
  local root="${1:-}" gid="${2:-${DEVFLOW_OPS_GID:-}}" path
  devflow_operational_root_is_allowed "$root" || return 2
  devflow_ops_gid_is_valid "$gid" || return 2
  for path in "$root" "$root/requests" "$root/processing" "$root/processed" "$root/failed" "$root/status"; do
    [[ ! -L "$path" ]] || return 3
  done
  install -d -o root -g "$gid" -m 2750 "$root"
  install -d -o root -g "$gid" -m 2770 "$root/requests"
  install -d -o root -g "$gid" -m 2750 \
    "$root/processing" "$root/processed" "$root/failed" "$root/status"
}

devflow_reconcile_operational_artifacts() {
  local root="${1:-}" gid="${2:-${DEVFLOW_OPS_GID:-}}" directory artifact
  devflow_prepare_operational_contract "$root" "$gid" || return $?

  for directory in requests processing processed failed; do
    for artifact in "$root/$directory"/*.json; do
      [[ ! -e "$artifact" ]] && continue
      [[ -f "$artifact" && ! -L "$artifact" ]] || return 3
      chown root:"$gid" "$artifact"
      chmod 0640 "$artifact"
    done
  done
  for artifact in "$root/status"/*.json "$root/backup-catalog.json"; do
    [[ ! -e "$artifact" ]] && continue
    [[ -f "$artifact" && ! -L "$artifact" ]] || return 3
    chown root:"$gid" "$artifact"
    chmod 0640 "$artifact"
  done
  for directory in processing processed failed; do
    for artifact in "$root/$directory"/*.log "$root/$directory"/*.validation; do
      [[ ! -e "$artifact" ]] && continue
      [[ -f "$artifact" && ! -L "$artifact" ]] || return 3
      chown root:root "$artifact"
      chmod 0600 "$artifact"
    done
  done
  if [[ -e "$root/daemon.ready" ]]; then
    [[ -f "$root/daemon.ready" && ! -L "$root/daemon.ready" ]] || return 3
    chown root:root "$root/daemon.ready"
    chmod 0600 "$root/daemon.ready"
  fi
}
