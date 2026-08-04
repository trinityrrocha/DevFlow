#!/usr/bin/env bash

DEVFLOW_INSTALL_TRANSACTION_FILE="${DEVFLOW_INSTALL_TRANSACTION_FILE:-$DEVFLOW_STATE_ROOT/install-transaction.json}"
INSTALL_TRANSACTION_VERSION=
INSTALL_TRANSACTION_COMMIT=
INSTALL_TRANSACTION_STAGE=01-preflight
INSTALL_TRANSACTION_FAILED_STAGE=none
INSTALL_TRANSACTION_ROOT_CAUSE=none
INSTALL_TRANSACTION_CAN_RESUME=false
INSTALL_TRANSACTION_ACTIVE=false
INSTALL_TRANSACTION_RESUME_FROM_STAGE=01-preflight
INSTALL_TRANSACTION_COMPLETED=()

install_stage_valid() {
  case "$1" in
    01-preflight|02-directories|03-source|04-private-configuration|05-images|06-networks|\
    07-database|08-migrations|09-backend|10-frontend|11-nginx-http|12-certificate|\
    13-nginx-https|14-super-admin|15-health|16-final-state) return 0 ;;
    *) return 1 ;;
  esac
}

install_stage_next() {
  case "$1" in
    01-preflight) echo 02-directories ;;
    02-directories) echo 03-source ;;
    03-source) echo 04-private-configuration ;;
    04-private-configuration) echo 05-images ;;
    05-images) echo 06-networks ;;
    06-networks) echo 07-database ;;
    07-database) echo 08-migrations ;;
    08-migrations) echo 09-backend ;;
    09-backend) echo 10-frontend ;;
    10-frontend) echo 11-nginx-http ;;
    11-nginx-http) echo 12-certificate ;;
    12-certificate) echo 13-nginx-https ;;
    13-nginx-https) echo 14-super-admin ;;
    14-super-admin) echo 15-health ;;
    15-health) echo 16-final-state ;;
    16-final-state) echo 16-final-state ;;
    *) return 1 ;;
  esac
}

install_transaction_has_stage() {
  local wanted="$1" stage
  for stage in "${INSTALL_TRANSACTION_COMPLETED[@]}"; do
    [[ "$stage" != "$wanted" ]] || return 0
  done
  return 1
}

install_transaction_write() {
  local temporary stage index
  install -d -m 0750 "$DEVFLOW_STATE_ROOT"
  temporary="$(mktemp "$DEVFLOW_STATE_ROOT/.install-transaction.XXXXXX")"
  {
    printf '{\n'
    printf '  "schemaVersion": 2,\n'
    printf '  "installationMode": "isolated",\n'
    printf '  "version": "%s",\n' "$INSTALL_TRANSACTION_VERSION"
    printf '  "commit": "%s",\n' "$INSTALL_TRANSACTION_COMMIT"
    printf '  "stage": "%s",\n' "$INSTALL_TRANSACTION_STAGE"
    printf '  "completedStages": [\n'
    for ((index = 0; index < ${#INSTALL_TRANSACTION_COMPLETED[@]}; index++)); do
      stage="${INSTALL_TRANSACTION_COMPLETED[index]}"
      [[ "$index" -eq $((${#INSTALL_TRANSACTION_COMPLETED[@]} - 1)) ]] \
        && printf '    "%s"\n' "$stage" || printf '    "%s",\n' "$stage"
    done
    printf '  ],\n'
    printf '  "failedStage": "%s",\n' "$INSTALL_TRANSACTION_FAILED_STAGE"
    printf '  "rootCause": "%s",\n' "$INSTALL_TRANSACTION_ROOT_CAUSE"
    printf '  "canResume": %s,\n' "$INSTALL_TRANSACTION_CAN_RESUME"
    printf '  "resumeFromStage": "%s",\n' "$INSTALL_TRANSACTION_RESUME_FROM_STAGE"
    printf '  "updatedAt": "%s"\n' "$(timestamp)"
    printf '}\n'
  } > "$temporary"
  chmod 0640 "$temporary"
  python3 -m json.tool "$temporary" >/dev/null
  mv -f -- "$temporary" "$DEVFLOW_INSTALL_TRANSACTION_FILE"
}

install_transaction_begin() {
  INSTALL_TRANSACTION_VERSION="$1"
  INSTALL_TRANSACTION_COMMIT="$2"
  INSTALL_TRANSACTION_STAGE=01-preflight
  INSTALL_TRANSACTION_FAILED_STAGE=none
  INSTALL_TRANSACTION_ROOT_CAUSE=none
  INSTALL_TRANSACTION_CAN_RESUME=true
  INSTALL_TRANSACTION_ACTIVE=true
  INSTALL_TRANSACTION_RESUME_FROM_STAGE=01-preflight
  INSTALL_TRANSACTION_COMPLETED=()
  devflow_semver_is_valid "$INSTALL_TRANSACTION_VERSION" || return 2
  [[ "$INSTALL_TRANSACTION_COMMIT" =~ ^[0-9a-f]{40}$ ]] || return 2
  install_transaction_write
}

install_transaction_load() {
  local file="${1:-$DEVFLOW_INSTALL_TRANSACTION_FILE}" stage
  [[ -f "$file" && ! -L "$file" && -r "$file" ]] || return 1
  [[ "$(installation_state_value schemaVersion "$file")" == 2 \
    && "$(installation_state_value installationMode "$file")" == isolated ]] || return 1
  INSTALL_TRANSACTION_VERSION="$(installation_state_value version "$file")"
  INSTALL_TRANSACTION_COMMIT="$(installation_state_value commit "$file")"
  INSTALL_TRANSACTION_STAGE="$(installation_state_value stage "$file")"
  INSTALL_TRANSACTION_FAILED_STAGE="$(installation_state_value failedStage "$file")"
  INSTALL_TRANSACTION_ROOT_CAUSE="$(installation_state_value rootCause "$file")"
  INSTALL_TRANSACTION_CAN_RESUME="$(installation_state_value canResume "$file")"
  INSTALL_TRANSACTION_RESUME_FROM_STAGE="$(installation_state_value resumeFromStage "$file")"
  devflow_semver_is_valid "$INSTALL_TRANSACTION_VERSION" || return 1
  [[ "$INSTALL_TRANSACTION_COMMIT" =~ ^[0-9a-f]{40}$ ]] || return 1
  install_stage_valid "$INSTALL_TRANSACTION_STAGE" || return 1
  [[ "$INSTALL_TRANSACTION_FAILED_STAGE" == none ]] || install_stage_valid "$INSTALL_TRANSACTION_FAILED_STAGE" || return 1
  [[ "$INSTALL_TRANSACTION_ROOT_CAUSE" =~ ^[a-z0-9-]+$ ]] || return 1
  [[ "$INSTALL_TRANSACTION_CAN_RESUME" == true || "$INSTALL_TRANSACTION_CAN_RESUME" == false ]] || return 1
  install_stage_valid "$INSTALL_TRANSACTION_RESUME_FROM_STAGE" || return 1
  INSTALL_TRANSACTION_COMPLETED=()
  while IFS= read -r stage; do
    install_stage_valid "$stage" || return 1
    INSTALL_TRANSACTION_COMPLETED+=("$stage")
  done < <(sed -n '/"completedStages"[[:space:]]*:/,/^[[:space:]]*]/ {
    s/^[[:space:]]*"\([0-9][0-9]-[a-z-]*\)"[,]\{0,1\}[[:space:]]*$/\1/p
  }' "$file")
  INSTALL_TRANSACTION_ACTIVE=true
}

install_transaction_complete_stage() {
  local stage="$1"
  install_stage_valid "$stage" || return 2
  INSTALL_TRANSACTION_STAGE="$stage"
  INSTALL_TRANSACTION_FAILED_STAGE=none
  INSTALL_TRANSACTION_ROOT_CAUSE=none
  INSTALL_TRANSACTION_RESUME_FROM_STAGE="$(install_stage_next "$stage")"
  install_transaction_has_stage "$stage" || INSTALL_TRANSACTION_COMPLETED+=("$stage")
  INSTALL_TRANSACTION_CAN_RESUME=true
  [[ "$stage" != 16-final-state ]] || INSTALL_TRANSACTION_CAN_RESUME=false
  install_transaction_write
  log INFO "stage=$stage completed=true resume_from=$INSTALL_TRANSACTION_RESUME_FROM_STAGE"
}

install_transaction_fail() {
  local stage="$1" root_cause="${2:-unexpected-command-failure}"
  [[ "$INSTALL_TRANSACTION_ACTIVE" == true ]] || return 0
  install_stage_valid "$stage" || stage=01-preflight
  [[ "$root_cause" =~ ^[a-z0-9-]+$ ]] || root_cause=unexpected-command-failure
  INSTALL_TRANSACTION_STAGE="$stage"
  INSTALL_TRANSACTION_FAILED_STAGE="$stage"
  INSTALL_TRANSACTION_ROOT_CAUSE="$root_cause"
  INSTALL_TRANSACTION_CAN_RESUME=true
  INSTALL_TRANSACTION_RESUME_FROM_STAGE="$stage"
  install_transaction_write
  printf 'failed_stage=%s\nresume_from_stage=%s\nroot_cause=%s\n' "$stage" "$stage" "$root_cause"
}
