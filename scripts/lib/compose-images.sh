#!/usr/bin/env bash

BACKEND_IMAGE_VERSION_MATCH=false
BACKEND_IMAGE_COMMIT_MATCH=false
FRONTEND_IMAGE_VERSION_MATCH=false
FRONTEND_IMAGE_COMMIT_MATCH=false
API_VERSION_MATCH=false
API_COMMIT_MATCH=unavailable
CONFIGURATION_VERSION_MATCH=false

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

report_compose_render_failure() {
  local category="$1" variable="${2:-unknown}"
  printf '%s\n' \
    'Não foi possível renderizar o Docker Compose.' \
    '' \
    "Motivo: $([[ "$category" == required-variable-missing ]] && printf '%s' 'variável obrigatória ausente.' || printf '%s' 'configuração inválida.')" \
    "Variável: $variable" \
    "Arquivo de configuração esperado: ${DEVFLOW_ENV_FILE:-indisponível}" \
    '' \
    'Nenhum valor sensível foi exibido.' \
    'Nenhuma alteração foi aplicada.' \
    'logical_operation=compose-render' \
    "startup_stage=${STARTUP_STAGE:-runtime}" \
    "root_cause=$category" >&2
}

compose_render_config_json() {
  local output_file="${1:-}" error_file temporary_output status=0 variable=unknown
  [[ -n "$output_file" ]] || return 2
  error_file="$(mktemp "${TMPDIR:-/tmp}/devflow-compose-error.XXXXXX")"
  temporary_output="$(mktemp "${TMPDIR:-/tmp}/devflow-compose-json.XXXXXX")"
  chmod 0600 "$error_file" "$temporary_output"
  if ! "${DEVFLOW_COMPOSE[@]}" config --format json > "$temporary_output" 2> "$error_file"; then
    variable="$(grep -Eo 'required variable [A-Z][A-Z0-9_]*' "$error_file" 2>/dev/null \
      | awk 'NR==1 {print $3}' || true)"
    if [[ -n "$variable" ]]; then
      report_compose_render_failure required-variable-missing "$variable"
    else
      report_compose_render_failure compose-render-failed unknown
    fi
    status=20
  elif ! "${DEVFLOW_IMAGE_PYTHON:-python3}" -c \
    'import json,sys; json.load(open(sys.argv[1], encoding="utf-8"))' "$temporary_output" >/dev/null 2>&1; then
    report_compose_render_failure invalid-compose-json unknown
    status=21
  else
    mv -f -- "$temporary_output" "$output_file"
  fi
  rm -f -- "$error_file" "$temporary_output"
  return "$status"
}

compose_service_image_expected() {
  local service="$1" python_bin="${DEVFLOW_IMAGE_PYTHON:-python3}" image compose_json status=0
  [[ "$service" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]] || return 2
  command -v "$python_bin" >/dev/null 2>&1 || return 2
  [[ -f "$DEVFLOW_IMAGE_RESOLVER" && ! -L "$DEVFLOW_IMAGE_RESOLVER" ]] || return 2
  compose_json="$(mktemp "${TMPDIR:-/tmp}/devflow-compose-resolved.XXXXXX.json")"
  chmod 0600 "$compose_json"
  compose_render_config_json "$compose_json" || status=$?
  if [[ "$status" -ne 0 ]]; then
    rm -f -- "$compose_json"
    return "$status"
  fi
  image="$("$python_bin" "$DEVFLOW_IMAGE_RESOLVER" "$service" < "$compose_json")" || status=22
  rm -f -- "$compose_json"
  [[ "$status" -eq 0 ]] || return "$status"
  validate_image_reference "$image" || return 23
  [[ "$(printf '%s\n' "$image" | wc -l | tr -d ' ')" -eq 1 ]] || return 23
  printf '%s\n' "$image"
}

resolve_compose_service_image() {
  local service="$1" expected resolved status=0
  expected="$(compose_service_image_expected "$service")" || status=$?
  [[ "$status" -eq 0 ]] || return "$status"
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

validate_installed_release_runtime() {
  local backend_image frontend_image api_payload api_version api_commit installed_source
  BACKEND_IMAGE_VERSION_MATCH=false
  BACKEND_IMAGE_COMMIT_MATCH=false
  FRONTEND_IMAGE_VERSION_MATCH=false
  FRONTEND_IMAGE_COMMIT_MATCH=false
  API_VERSION_MATCH=false
  API_COMMIT_MATCH=unavailable
  CONFIGURATION_VERSION_MATCH=false

  [[ -n "${INSTALLED_VERSION:-}" && -n "${INSTALLED_COMMIT:-}" ]] \
    || resolve_installed_release_identity "${DEVFLOW_INSTALLED_SOURCE_DIR:-$DEVFLOW_INSTALL_ROOT/source}" main >/dev/null \
    || return 1
  installed_source="${DEVFLOW_INSTALLED_SOURCE_DIR:-$DEVFLOW_INSTALL_ROOT/source}"
  [[ "${DEVFLOW_VERSION:-}" == "$INSTALLED_VERSION" ]] && CONFIGURATION_VERSION_MATCH=true
  backend_image="$(resolve_compose_service_image backend 2>/dev/null || true)"
  frontend_image="$(resolve_compose_service_image frontend 2>/dev/null || true)"
  if [[ -n "$backend_image" ]]; then
    [[ "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' "$backend_image" 2>/dev/null || true)" == "$INSTALLED_VERSION" ]] \
      && BACKEND_IMAGE_VERSION_MATCH=true
    [[ "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$backend_image" 2>/dev/null || true)" == "$INSTALLED_COMMIT" ]] \
      && BACKEND_IMAGE_COMMIT_MATCH=true
  fi
  if [[ -n "$frontend_image" ]]; then
    [[ "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' "$frontend_image" 2>/dev/null || true)" == "$INSTALLED_VERSION" ]] \
      && FRONTEND_IMAGE_VERSION_MATCH=true
    [[ "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$frontend_image" 2>/dev/null || true)" == "$INSTALLED_COMMIT" ]] \
      && FRONTEND_IMAGE_COMMIT_MATCH=true
  fi
  api_payload="$("${DEVFLOW_COMPOSE[@]}" exec -T backend node -e \
    "fetch('http://127.0.0.1:3000/api/health').then(async r=>{if(!r.ok)process.exit(1);process.stdout.write(await r.text())}).catch(()=>process.exit(1))" \
    2>/dev/null || true)"
  if [[ -n "$api_payload" ]]; then
    api_version="$(printf '%s' "$api_payload" | python3 -c \
      'import json,sys; value=json.load(sys.stdin).get("version", ""); print(value if isinstance(value, str) else "")' \
      2>/dev/null || true)"
    api_commit="$(printf '%s' "$api_payload" | python3 -c \
      'import json,sys; value=json.load(sys.stdin).get("commit", ""); print(value if isinstance(value, str) else "")' \
      2>/dev/null || true)"
    [[ "$api_version" == "$INSTALLED_VERSION" ]] && API_VERSION_MATCH=true
    if [[ -n "$api_commit" ]]; then
      API_COMMIT_MATCH=false
      [[ "$api_commit" == "$INSTALLED_COMMIT" ]] && API_COMMIT_MATCH=true
    elif [[ -r "$installed_source/backend/src/app.js" ]] \
      && ! grep -Fq 'commit: env.DEVFLOW_RELEASE_COMMIT' "$installed_source/backend/src/app.js"; then
      API_COMMIT_MATCH=unsupported-by-installed-release
    fi
  fi
  export BACKEND_IMAGE_VERSION_MATCH BACKEND_IMAGE_COMMIT_MATCH \
    FRONTEND_IMAGE_VERSION_MATCH FRONTEND_IMAGE_COMMIT_MATCH API_VERSION_MATCH \
    API_COMMIT_MATCH CONFIGURATION_VERSION_MATCH
  [[ "$CONFIGURATION_VERSION_MATCH" == true \
    && "$BACKEND_IMAGE_VERSION_MATCH" == true && "$BACKEND_IMAGE_COMMIT_MATCH" == true \
    && "$FRONTEND_IMAGE_VERSION_MATCH" == true && "$FRONTEND_IMAGE_COMMIT_MATCH" == true \
    && "$API_VERSION_MATCH" == true \
    && ( "$API_COMMIT_MATCH" == true || "$API_COMMIT_MATCH" == unsupported-by-installed-release ) ]]
}

list_existing_devflow_images() {
  docker image ls --format '{{.Repository}}:{{.Tag}}' --filter reference='devflow-*' 2>/dev/null \
    | sed '/<none>/d' | sort -u
}
