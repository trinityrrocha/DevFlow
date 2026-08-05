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
    01-preflight|02-directories|03-source|04-private-configuration|05-images|06-dns-and-firewall|\
    07-certificate|08-runtime-nginx|09-containers|10-database|11-migrations|12-backend|\
    13-frontend|14-nginx-https|15-super-admin|16-final-health-state) return 0 ;;
    *) return 1 ;;
  esac
}

install_stage_next() {
  case "$1" in
    01-preflight) echo 02-directories ;; 02-directories) echo 03-source ;;
    03-source) echo 04-private-configuration ;; 04-private-configuration) echo 05-images ;;
    05-images) echo 06-dns-and-firewall ;; 06-dns-and-firewall) echo 07-certificate ;;
    07-certificate) echo 08-runtime-nginx ;; 08-runtime-nginx) echo 09-containers ;;
    09-containers) echo 10-database ;; 10-database) echo 11-migrations ;;
    11-migrations) echo 12-backend ;; 12-backend) echo 13-frontend ;;
    13-frontend) echo 14-nginx-https ;; 14-nginx-https) echo 15-super-admin ;;
    15-super-admin) echo 16-final-health-state ;; 16-final-health-state) echo 16-final-health-state ;;
    *) return 1 ;;
  esac
}

install_transaction_has_stage() {
  local wanted="$1" stage
  for stage in "${INSTALL_TRANSACTION_COMPLETED[@]}"; do [[ "$stage" != "$wanted" ]] || return 0; done
  return 1
}

install_transaction_write() {
  local temporary stage index
  install -d -m 0750 "$DEVFLOW_STATE_ROOT"
  temporary="$(mktemp "$DEVFLOW_STATE_ROOT/.install-transaction.XXXXXX")"
  {
    printf '{\n  "schemaVersion": 3,\n  "installationMode": "isolated",\n'
    printf '  "version": "%s",\n  "commit": "%s",\n  "stage": "%s",\n' \
      "$INSTALL_TRANSACTION_VERSION" "$INSTALL_TRANSACTION_COMMIT" "$INSTALL_TRANSACTION_STAGE"
    printf '  "completedStages": [\n'
    for ((index=0; index<${#INSTALL_TRANSACTION_COMPLETED[@]}; index++)); do
      stage="${INSTALL_TRANSACTION_COMPLETED[index]}"
      [[ "$index" -eq $((${#INSTALL_TRANSACTION_COMPLETED[@]}-1)) ]] \
        && printf '    "%s"\n' "$stage" || printf '    "%s",\n' "$stage"
    done
    printf '  ],\n  "failedStage": "%s",\n  "rootCause": "%s",\n' "$INSTALL_TRANSACTION_FAILED_STAGE" "$INSTALL_TRANSACTION_ROOT_CAUSE"
    printf '  "canResume": %s,\n  "resumeFromStage": "%s",\n' "$INSTALL_TRANSACTION_CAN_RESUME" "$INSTALL_TRANSACTION_RESUME_FROM_STAGE"
    printf '  "containersPreserved": true,\n  "updatedAt": "%s"\n}\n' "$(timestamp)"
  } > "$temporary"
  chmod 0640 "$temporary"
  python3 -m json.tool "$temporary" >/dev/null
  mv -f -- "$temporary" "$DEVFLOW_INSTALL_TRANSACTION_FILE"
}

install_transaction_begin() {
  INSTALL_TRANSACTION_VERSION="$1"; INSTALL_TRANSACTION_COMMIT="$2"
  INSTALL_TRANSACTION_STAGE=01-preflight; INSTALL_TRANSACTION_FAILED_STAGE=none
  INSTALL_TRANSACTION_ROOT_CAUSE=none; INSTALL_TRANSACTION_CAN_RESUME=true
  INSTALL_TRANSACTION_ACTIVE=true; INSTALL_TRANSACTION_RESUME_FROM_STAGE=01-preflight
  INSTALL_TRANSACTION_COMPLETED=()
  devflow_semver_is_valid "$INSTALL_TRANSACTION_VERSION" || return 2
  [[ "$INSTALL_TRANSACTION_COMMIT" =~ ^[0-9a-f]{40}$ ]] || return 2
  install_transaction_write
}

install_transaction_complete_stage() {
  local stage="$1"
  install_stage_valid "$stage" || return 2
  INSTALL_TRANSACTION_STAGE="$stage"; INSTALL_TRANSACTION_FAILED_STAGE=none; INSTALL_TRANSACTION_ROOT_CAUSE=none
  INSTALL_TRANSACTION_RESUME_FROM_STAGE="$(install_stage_next "$stage")"
  install_transaction_has_stage "$stage" || INSTALL_TRANSACTION_COMPLETED+=("$stage")
  INSTALL_TRANSACTION_CAN_RESUME=true; [[ "$stage" != 16-final-health-state ]] || INSTALL_TRANSACTION_CAN_RESUME=false
  install_transaction_write
  log INFO "stage=$stage completed=true resume_from=$INSTALL_TRANSACTION_RESUME_FROM_STAGE"
}

install_transaction_fail() {
  local stage="$1" root_cause="${2:-unexpected-command-failure}"
  [[ "$INSTALL_TRANSACTION_ACTIVE" == true ]] || return 0
  install_stage_valid "$stage" || stage=01-preflight
  [[ "$root_cause" =~ ^[a-z0-9-]+$ ]] || root_cause=unexpected-command-failure
  INSTALL_TRANSACTION_STAGE="$stage"; INSTALL_TRANSACTION_FAILED_STAGE="$stage"
  INSTALL_TRANSACTION_ROOT_CAUSE="$root_cause"; INSTALL_TRANSACTION_CAN_RESUME=true
  INSTALL_TRANSACTION_RESUME_FROM_STAGE="$stage"
  install_transaction_write
  printf 'failed_stage=%s\nresume_from_stage=%s\nroot_cause=%s\ncontainers_preserved=true\n' "$stage" "$stage" "$root_cause"
}
