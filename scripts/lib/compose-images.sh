#!/usr/bin/env bash

DEVFLOW_IMAGE_RESOLVER="${DEVFLOW_IMAGE_RESOLVER:-$DEVFLOW_SOURCE_ROOT/scripts/resolve-compose-image.py}"

validate_image_reference() {
  local image="${1:-}"
  [[ -n "$image" && "$image" != *$'\n'* && "$image" != *$'\r'* \
    && "$image" =~ ^[A-Za-z0-9][A-Za-z0-9._/@:-]*$ \
    && "$image" != *'..'* && "$image" != *'//'* \
    && "$image" != *://* && "$image" != */ && "$image" != *: && "$image" != *@ ]]
}

normalize_image_reference() {
  local image="$1" first
  validate_image_reference "$image" || return 2
  [[ "$image" == *@* || "${image##*/}" == *:* ]] || image="$image:latest"
  first="${image%%/*}"
  if [[ "$image" != */* ]]; then
    image="docker.io/library/$image"
  elif [[ "$first" != *.* && "$first" != *:* && "$first" != localhost ]]; then
    image="docker.io/$image"
  fi
  printf '%s\n' "$image"
}

compose_render_config_json() {
  "${DEVFLOW_COMPOSE[@]}" config --format json
}

compose_service_image_expected() {
  local service="$1" python_bin="${DEVFLOW_IMAGE_PYTHON:-python3}" image
  [[ "$service" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]] || return 2
  command -v "$python_bin" >/dev/null 2>&1 || return 2
  [[ -f "$DEVFLOW_IMAGE_RESOLVER" && ! -L "$DEVFLOW_IMAGE_RESOLVER" ]] || return 2
  image="$(compose_render_config_json | "$python_bin" "$DEVFLOW_IMAGE_RESOLVER" "$service")" || return 2
  validate_image_reference "$image" || return 2
  [[ "$(printf '%s\n' "$image" | wc -l | tr -d ' ')" -eq 1 ]] || return 2
  printf '%s\n' "$image"
}

resolve_compose_service_image() {
  local service="$1" expected resolved
  expected="$(compose_service_image_expected "$service")" || return 2
  resolved="$(normalize_image_reference "$expected")" || return 2
  docker image inspect "$resolved" >/dev/null 2>&1 || return 3
  printf '%s\n' "$resolved"
}

compose_image_matches_release() {
  local image="$1" expected_commit="$2" expected_version="$3" actual_commit actual_version
  docker image inspect "$image" >/dev/null 2>&1 || return 1
  actual_commit="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image" 2>/dev/null || true)"
  actual_version="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' "$image" 2>/dev/null || true)"
  [[ "$actual_commit" == "$expected_commit" && "$actual_version" == "$expected_version" ]]
}

list_existing_devflow_images() {
  docker image ls --format '{{.Repository}}:{{.Tag}}' --filter reference='devflow-*' 2>/dev/null \
    | sed '/<none>/d' | sort -u
}
