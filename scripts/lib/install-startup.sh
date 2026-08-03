#!/usr/bin/env bash

# This library is intentionally declaration-only. It must be safe to source
# from a caller running with set -Eeuo pipefail.

detect_partial_installation() {
  local source_dir="$DEVFLOW_INSTALL_ROOT/source" source_commit= state_file="$DEVFLOW_STATE_ROOT/installation.json" env_mode
  [[ ! -e "$DEVFLOW_INSTALL_ROOT/app" ]] || return 0
  if [[ -e "$source_dir" || -e "$DEVFLOW_ENV_FILE" || -e "$state_file" || -e "$DEVFLOW_INSTALL_TRANSACTION_FILE" ]]; then
    PARTIAL_INSTALLATION_DETECTED=true
  else
    return 0
  fi

  if [[ -d "$source_dir/.git" && ! -L "$source_dir/.git" \
    && "$(git -C "$source_dir" remote get-url origin 2>/dev/null || true)" == "$public_remote" \
    && "$(git -C "$source_dir" branch --show-current 2>/dev/null || true)" == main \
    && -z "$(git -C "$source_dir" status --porcelain 2>/dev/null || printf invalid)" ]]; then
    source_commit="$(git -C "$source_dir" rev-parse HEAD 2>/dev/null || true)"
    if [[ "$source_commit" =~ ^[0-9a-f]{40}$ ]] \
      && git -C "$SOURCE_DIR" merge-base --is-ancestor "$source_commit" "$release_sha" 2>/dev/null; then
      RESUME_CHECKOUT_VALID=true
      SOURCE_READY=true
      PARTIAL_INSTALLATION_COMMIT="$source_commit"
    fi
  fi

  if [[ -f "$DEVFLOW_ENV_FILE" && ! -L "$DEVFLOW_ENV_FILE" ]]; then
    PARTIAL_CONFIGURATION_PRESENT=true
    env_mode="$(stat -c '%a' "$DEVFLOW_ENV_FILE" 2>/dev/null || true)"
    if [[ "$env_mode" == 600 || "$env_mode" == 400 ]]; then
      RESUME_CONFIGURATION_VALID=true
      CONFIGURATION_READY=true
    fi
  fi

  if [[ -e "$DEVFLOW_INSTALL_TRANSACTION_FILE" ]]; then
    TRANSACTION_STATE_PRESENT=true
    if install_transaction_load 2>/dev/null; then
      RESUME_TRANSACTION_VALID=true
      PARTIAL_INSTALLATION_VERSION="$INSTALL_TRANSACTION_VERSION"
      PARTIAL_INSTALLATION_COMMIT="$INSTALL_TRANSACTION_COMMIT"
      PARTIAL_INSTALLATION_STAGE="$INSTALL_TRANSACTION_STAGE"
    else
      TRANSACTION_STATE_CORRUPT=true
    fi
  elif [[ -r "$state_file" ]]; then
    LEGACY_PARTIAL_INSTALLATION_DETECTED=true
    PARTIAL_INSTALLATION_VERSION="$(installation_state_value version "$state_file" || true)"
    [[ "$PARTIAL_INSTALLATION_COMMIT" != unknown ]] \
      || PARTIAL_INSTALLATION_COMMIT="$(installation_state_value commit "$state_file" || true)"
    PARTIAL_INSTALLATION_STAGE="$(installation_state_value result "$state_file" || true)"
  else
    LEGACY_PARTIAL_INSTALLATION_DETECTED=true
  fi
  if [[ "$PARTIAL_INSTALLATION_VERSION" == unknown && -r "$source_dir/VERSION" ]]; then
    PARTIAL_INSTALLATION_VERSION="$(devflow_read_version_file "$source_dir/VERSION" 2>/dev/null || printf unknown)"
  fi
  if [[ "$PARTIAL_INSTALLATION_COMMIT" != unknown && "$source_commit" != "$PARTIAL_INSTALLATION_COMMIT" ]]; then
    RESUME_CHECKOUT_VALID=false
    SOURCE_READY=false
  fi
  if install_transaction_has_stage 09-run-migrations; then
    MIGRATIONS_READY=true
  fi
  if install_transaction_has_stage 12-bootstrap-super-admin; then
    SUPER_ADMIN_READY=true
  fi
  if [[ "$RESUME_CHECKOUT_VALID" == true && "$RESUME_CONFIGURATION_VALID" == true \
    && "$TRANSACTION_STATE_CORRUPT" == false ]]; then
    CAN_RESUME=true
    if [[ "$TRANSACTION_STATE_PRESENT" == false ]]; then
      TRANSACTION_STATE_RECONSTRUCTION_PLANNED=true
    fi
  fi
  return 0
}

determine_resume_stage() {
  [[ "$PARTIAL_INSTALLATION_DETECTED" == true ]] || return 0
  if [[ "$BACKEND_BUILD_REQUIRED" == true || "$FRONTEND_BUILD_REQUIRED" == true \
    || "$POSTGRES_PULL_REQUIRED" == true ]]; then
    RESUME_FROM_STAGE=05-build-images
  elif [[ "$IMAGES_READY" != true ]]; then
    RESUME_FROM_STAGE=06-validate-images
  elif [[ "$DATABASE_CONTAINER_READY" != true ]]; then
    RESUME_FROM_STAGE=07-create-networks
  elif [[ "$DATABASE_HEALTHY" != true ]]; then
    RESUME_FROM_STAGE=08-start-database
  elif [[ "$MIGRATIONS_READY" != true ]]; then
    RESUME_FROM_STAGE=09-run-migrations
  elif [[ "$BACKEND_READY" != true ]]; then
    RESUME_FROM_STAGE=10-start-backend
  elif [[ "$FRONTEND_READY" != true ]]; then
    RESUME_FROM_STAGE=11-start-frontend
  elif [[ "$SUPER_ADMIN_READY" != true ]]; then
    RESUME_FROM_STAGE=12-bootstrap-super-admin
  elif [[ "$INSTALLATION_STATE_READY" != true ]]; then
    RESUME_FROM_STAGE=14-write-final-state
  fi
  return 0
}
