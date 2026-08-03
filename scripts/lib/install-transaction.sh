#!/usr/bin/env bash

DEVFLOW_INSTALL_TRANSACTION_FILE="${DEVFLOW_INSTALL_TRANSACTION_FILE:-$DEVFLOW_STATE_ROOT/install-transaction.json}"
INSTALL_TRANSACTION_VERSION=
INSTALL_TRANSACTION_COMMIT=
INSTALL_TRANSACTION_SCOPE=
INSTALL_TRANSACTION_STAGE=01-preflight
INSTALL_TRANSACTION_FAILED_STAGE=none
INSTALL_TRANSACTION_ROOT_CAUSE=none
INSTALL_TRANSACTION_CAN_RESUME=false
INSTALL_TRANSACTION_ACTIVE=false
INSTALL_TRANSACTION_LEGACY_PARTIAL=false
INSTALL_TRANSACTION_RECONSTRUCTED=false
INSTALL_TRANSACTION_RESUME_FROM_STAGE=01-preflight
INSTALL_TRANSACTION_COMPLETED=()

install_stage_valid() {
  case "$1" in
    01-preflight|02-directories|03-source|04-configuration|05-build-images|06-validate-images|\
    07-create-networks|08-start-database|09-run-migrations|10-start-backend|11-start-frontend|\
    12-bootstrap-super-admin|13-health|14-write-final-state) return 0 ;;
    *) return 1 ;;
  esac
}

install_stage_number() {
  printf '%s\n' "${1%%-*}" | sed 's/^0*//'
}

install_stage_description() {
  case "$1" in
    01-preflight) printf '%s\n' 'Preflight validado' ;;
    02-directories) printf '%s\n' 'Diretórios preparados' ;;
    03-source) printf '%s\n' 'Código-fonte validado' ;;
    04-configuration) printf '%s\n' 'Configuração validada' ;;
    05-build-images) printf '%s\n' 'Imagens construídas ou reutilizadas' ;;
    06-validate-images) printf '%s\n' 'Imagens validadas' ;;
    07-create-networks) printf '%s\n' 'Redes criadas ou reutilizadas' ;;
    08-start-database) printf '%s\n' 'Banco iniciado e saudável' ;;
    09-run-migrations) printf '%s\n' 'Migrations confirmadas' ;;
    10-start-backend) printf '%s\n' 'Backend iniciado e saudável' ;;
    11-start-frontend) printf '%s\n' 'Frontend iniciado e saudável' ;;
    12-bootstrap-super-admin) printf '%s\n' 'Bootstrap do Super Admin preparado' ;;
    13-health) printf '%s\n' 'Health interno aprovado' ;;
    14-write-final-state) printf '%s\n' 'Estado final gravado' ;;
  esac
}

install_stage_next() {
  case "$1" in
    01-preflight) printf '%s\n' 02-directories ;;
    02-directories) printf '%s\n' 03-source ;;
    03-source) printf '%s\n' 04-configuration ;;
    04-configuration) printf '%s\n' 05-build-images ;;
    05-build-images) printf '%s\n' 06-validate-images ;;
    06-validate-images) printf '%s\n' 07-create-networks ;;
    07-create-networks) printf '%s\n' 08-start-database ;;
    08-start-database) printf '%s\n' 09-run-migrations ;;
    09-run-migrations) printf '%s\n' 10-start-backend ;;
    10-start-backend) printf '%s\n' 11-start-frontend ;;
    11-start-frontend) printf '%s\n' 12-bootstrap-super-admin ;;
    12-bootstrap-super-admin) printf '%s\n' 13-health ;;
    13-health) printf '%s\n' 14-write-final-state ;;
    14-write-final-state) printf '%s\n' 14-write-final-state ;;
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
    printf '  "version": "%s",\n' "$INSTALL_TRANSACTION_VERSION"
    printf '  "commit": "%s",\n' "$INSTALL_TRANSACTION_COMMIT"
    printf '  "scope": "%s",\n' "$INSTALL_TRANSACTION_SCOPE"
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
    printf '  "legacyPartialInstallation": %s,\n' "$INSTALL_TRANSACTION_LEGACY_PARTIAL"
    printf '  "transactionStateReconstructed": %s,\n' "$INSTALL_TRANSACTION_RECONSTRUCTED"
    printf '  "resumeFromStage": "%s",\n' "$INSTALL_TRANSACTION_RESUME_FROM_STAGE"
    printf '  "updatedAt": "%s"\n' "$(timestamp)"
    printf '}\n'
  } > "$temporary"
  chmod 0640 "$temporary"
  mv -f -- "$temporary" "$DEVFLOW_INSTALL_TRANSACTION_FILE"
}

install_transaction_begin() {
  INSTALL_TRANSACTION_VERSION="$1"
  INSTALL_TRANSACTION_COMMIT="$2"
  INSTALL_TRANSACTION_SCOPE="$3"
  INSTALL_TRANSACTION_LEGACY_PARTIAL="${4:-false}"
  INSTALL_TRANSACTION_RECONSTRUCTED="${5:-false}"
  INSTALL_TRANSACTION_RESUME_FROM_STAGE="${6:-01-preflight}"
  [[ "$INSTALL_TRANSACTION_LEGACY_PARTIAL" == true || "$INSTALL_TRANSACTION_LEGACY_PARTIAL" == false ]] || return 2
  [[ "$INSTALL_TRANSACTION_RECONSTRUCTED" == true || "$INSTALL_TRANSACTION_RECONSTRUCTED" == false ]] || return 2
  install_stage_valid "$INSTALL_TRANSACTION_RESUME_FROM_STAGE" || return 2
  INSTALL_TRANSACTION_STAGE=01-preflight
  INSTALL_TRANSACTION_FAILED_STAGE=none
  INSTALL_TRANSACTION_ROOT_CAUSE=none
  INSTALL_TRANSACTION_CAN_RESUME=true
  INSTALL_TRANSACTION_ACTIVE=true
  INSTALL_TRANSACTION_COMPLETED=()
  install_transaction_write
}

install_transaction_load() {
  local file="${1:-$DEVFLOW_INSTALL_TRANSACTION_FILE}" stage
  [[ -f "$file" && ! -L "$file" && -r "$file" ]] || return 1
  INSTALL_TRANSACTION_VERSION="$(installation_state_value version "$file")"
  INSTALL_TRANSACTION_COMMIT="$(installation_state_value commit "$file")"
  INSTALL_TRANSACTION_SCOPE="$(installation_state_value scope "$file")"
  INSTALL_TRANSACTION_STAGE="$(installation_state_value stage "$file")"
  INSTALL_TRANSACTION_FAILED_STAGE="$(installation_state_value failedStage "$file")"
  INSTALL_TRANSACTION_ROOT_CAUSE="$(installation_state_value rootCause "$file" || true)"
  INSTALL_TRANSACTION_CAN_RESUME="$(installation_state_value canResume "$file")"
  INSTALL_TRANSACTION_LEGACY_PARTIAL="$(installation_state_value legacyPartialInstallation "$file")"
  INSTALL_TRANSACTION_RECONSTRUCTED="$(installation_state_value transactionStateReconstructed "$file")"
  INSTALL_TRANSACTION_RESUME_FROM_STAGE="$(installation_state_value resumeFromStage "$file")"
  [[ -n "$INSTALL_TRANSACTION_LEGACY_PARTIAL" ]] || INSTALL_TRANSACTION_LEGACY_PARTIAL=false
  [[ -n "$INSTALL_TRANSACTION_RECONSTRUCTED" ]] || INSTALL_TRANSACTION_RECONSTRUCTED=false
  [[ -n "$INSTALL_TRANSACTION_RESUME_FROM_STAGE" ]] || INSTALL_TRANSACTION_RESUME_FROM_STAGE=01-preflight
  [[ -n "$INSTALL_TRANSACTION_ROOT_CAUSE" ]] || INSTALL_TRANSACTION_ROOT_CAUSE=none
  devflow_semver_is_valid "$INSTALL_TRANSACTION_VERSION" || return 1
  [[ "$INSTALL_TRANSACTION_COMMIT" =~ ^[0-9a-f]{40}$ ]] || return 1
  [[ "$INSTALL_TRANSACTION_SCOPE" == internal || "$INSTALL_TRANSACTION_SCOPE" == complete ]] || return 1
  install_stage_valid "$INSTALL_TRANSACTION_STAGE" || return 1
  [[ "$INSTALL_TRANSACTION_FAILED_STAGE" == none ]] || install_stage_valid "$INSTALL_TRANSACTION_FAILED_STAGE" || return 1
  [[ "$INSTALL_TRANSACTION_ROOT_CAUSE" =~ ^[a-z0-9-]+$ ]] || return 1
  [[ "$INSTALL_TRANSACTION_CAN_RESUME" == true || "$INSTALL_TRANSACTION_CAN_RESUME" == false ]] || return 1
  [[ "$INSTALL_TRANSACTION_LEGACY_PARTIAL" == true || "$INSTALL_TRANSACTION_LEGACY_PARTIAL" == false ]] || return 1
  [[ "$INSTALL_TRANSACTION_RECONSTRUCTED" == true || "$INSTALL_TRANSACTION_RECONSTRUCTED" == false ]] || return 1
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
  local stage="$1" number
  install_stage_valid "$stage" || return 2
  INSTALL_TRANSACTION_STAGE="$stage"
  INSTALL_TRANSACTION_FAILED_STAGE=none
  INSTALL_TRANSACTION_ROOT_CAUSE=none
  INSTALL_TRANSACTION_CAN_RESUME=true
  INSTALL_TRANSACTION_RESUME_FROM_STAGE="$(install_stage_next "$stage")" || return 2
  install_transaction_has_stage "$stage" || INSTALL_TRANSACTION_COMPLETED+=("$stage")
  [[ "$stage" != 14-write-final-state ]] || INSTALL_TRANSACTION_CAN_RESUME=false
  install_transaction_write
  number="$(install_stage_number "$stage")"
  log INFO "[$(printf '%02d' "$number")/14] $(install_stage_description "$stage")."
  printf 'completed_stage=%s\nresume_from_stage=%s\n' "$stage" "$INSTALL_TRANSACTION_RESUME_FROM_STAGE"
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
