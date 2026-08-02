#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

OUTPUT=-
DOMAIN=
LETSENCRYPT_EMAIL=
SUPER_ADMIN_EMAIL=
HTTP_PORT=18080
API_PORT=13000
REQUESTED_CONTAINER=
PROXY_TYPE=none
PROXY_CONTAINER=
CONFIG_VALID=false
PERSISTENT_CONFIG=false
DOMAIN_CONFLICT=false
PORT_CONFLICT=false
RELOAD_PROVEN=false
CERTIFICATE_METHOD=unknown
COMPATIBILITY=blocked
PROXY_CONFIG_RAW=
FULLPASSWORD_PROJECT=
FULLPASSWORD_SERVICE=
FULLPASSWORD_IMAGE=
FULLPASSWORD_WORKING_DIR=
FULLPASSWORD_CONFIG_FILES=
FULLPASSWORD_COMPOSE_FILE=
FULLPASSWORD_COMPOSE_DIR=
FULLPASSWORD_ENV_FILE=
FULLPASSWORD_COMPOSE_VARIABLE_INITIALIZED=true
FULLPASSWORD_COMPOSE_DETECTED=false
FULLPASSWORD_COMPOSE_EXISTS=false
FULLPASSWORD_RUNTIME_MOUNT=false
FULLPASSWORD_CERTIFICATE_MOUNT=false
FULLPASSWORD_ORIGINAL_NETWORK=false
FULLPASSWORD_PORTS=false
FULLPASSWORD_UPSTREAM_SAFE=false
FULLPASSWORD_CERTIFICATE_SAFE=false
DEVFLOW_DIRECTORY_WRITABLE=false
DEVFLOW_OVERRIDE_WRITABLE=false
DEVFLOW_PROXY_CONFIG_WRITABLE=false
FULLPASSWORD_COMPOSE_READABLE=false
COMPOSE_CROSS_DIRECTORY_SUPPORTED=unknown
COMPOSE_MERGE_VALID=unknown
COMPOSE_VALIDATION_COMMAND=not-planned
COMPOSE_EXECUTED_COMMAND=not-run
COMPOSE_VALIDATION_EXIT_CODE=not-run
COMPOSE_VALIDATION_ERROR=not-run
COMPOSE_VALIDATION_ATTEMPTED=false
COMPOSE_VALIDATION_BLOCKED_BY=none
COMPOSE_TEMP_OVERRIDE=not-created
PROTECTED_COMPOSE_INPUTS_DETECTED=false
PRIVILEGED_VALIDATION_REQUIRED=false
CHANGES_APPLIED=false
INSTALLATION_READY=false
SENSITIVE_VALUES_LOGGED=false
ORIGINAL_SERVICES_PRESERVED=unknown
ORIGINAL_PORTS_PRESERVED=unknown
ORIGINAL_MOUNTS_PRESERVED=unknown
ORIGINAL_NETWORKS_PRESERVED=unknown
ORIGINAL_RESTART_POLICIES_PRESERVED=unknown
ORIGINAL_IMAGES_PRESERVED=unknown
ORIGINAL_VOLUMES_PRESERVED=unknown
ORIGINAL_ENVIRONMENT_PRESERVED=unknown
DEVFLOW_OVERRIDE_ADDED=unknown
DEVFLOW_EDGE_ADDED=unknown
DEVFLOW_NGINX_MOUNT_ADDED=unknown
DEVFLOW_DATABASE_EXPOSURE_ABSENT=unknown
OPERATION_MODE=diagnostic
FULLPASSWORD_EDGE_NETWORK_SAFE=false
FULLPASSWORD_ROLLBACK_READY=false
FULLPASSWORD_PUBLIC_HEALTH=false
NGINX_CONF_D_INCLUDED=false
INTERNAL_SCRIPT_ERROR=false
CURRENT_OPERATION=initialization
declare -a BLOCKERS=()
declare -a COMPOSE_INPUT_RECORDS=()
declare -a DIAGNOSTIC_TEMP_DIRS=()

usage() {
  cat <<'EOF'
Uso:
  sudo scripts/detect-shared-proxy.sh --domain HOST [opções]

Opções:
  --container NOME  inspeciona somente o container indicado
  --letsencrypt-email EMAIL  preserva o comando completo de repetição
  --super-admin-email EMAIL  preserva o comando completo de repetição
  --http-port PORT  porta loopback planejada para o frontend
  --api-port PORT   porta loopback planejada para o backend
  --operation-mode MODO  contexto: diagnostic, check, dry-run ou install
  --output ARQUIVO  relatório atômico; padrão: saída padrão
  --help

O diagnóstico é somente leitura em relação ao proxy, containers, redes,
certificados e configurações. Somente o arquivo de relatório solicitado é criado.
EOF
}

add_blocker() {
  BLOCKERS+=("$1")
}

root_installation_can_manage() {
  local target="$1" existing="$1" mount_options attributes
  while [[ ! -e "$existing" && "$existing" != / ]]; do
    existing="$(dirname "$existing")"
  done
  mount_options="$(findmnt -n -o OPTIONS --target "$existing" 2>/dev/null || true)"
  [[ -n "$mount_options" && ! ",$mount_options," =~ ,ro, ]] || return 1
  if command -v lsattr >/dev/null 2>&1; then
    attributes="$(lsattr -d "$existing" 2>/dev/null | awk 'NR==1 {print $1}')"
    [[ ! "$attributes" =~ [ia] ]] || return 1
  fi
}

execution_uid() { id -u; }

compose_path_readable() {
  local path="${1:-}"
  [[ -n "$path" && -r "$path" ]]
}

trim_whitespace() {
  local value="${1:-}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s\n' "$value"
}

normalize_docker_label() {
  local value
  value="$(trim_whitespace "${1:-}")"
  case "$value" in
    '<no value>'|'<nil>'|null) value= ;;
  esac
  printf '%s\n' "$value"
}

normalize_compose_path() {
  local candidate="${1:-}" project_dir="${2:-}" normalized
  candidate="$(trim_whitespace "$candidate")"
  [[ -n "$candidate" && "$candidate" != *$'\n'* && "$candidate" != *$'\r'* && "$candidate" != *$'\t'* ]] || return 1
  if [[ "$candidate" != /* ]]; then
    [[ "$project_dir" == /* ]] || return 1
    candidate="$project_dir/$candidate"
  fi
  if command -v realpath >/dev/null 2>&1; then
    normalized="$(realpath -m -- "$candidate")" || return 1
  else
    normalized="$candidate"
  fi
  [[ "$normalized" == /* ]] || return 1
  printf '%s\n' "$normalized"
}

validate_fullpassword_compose_path() {
  local compose_file="${1:-}"
  FULLPASSWORD_COMPOSE_DETECTED=false
  FULLPASSWORD_COMPOSE_EXISTS=false
  FULLPASSWORD_COMPOSE_READABLE=false
  FULLPASSWORD_COMPOSE_DIR=
  FULLPASSWORD_ENV_FILE=
  [[ -n "$compose_file" && "$compose_file" == /* ]] || return 2
  FULLPASSWORD_COMPOSE_FILE="$compose_file"
  FULLPASSWORD_COMPOSE_DETECTED=true
  [[ -f "$compose_file" ]] || return 3
  FULLPASSWORD_COMPOSE_EXISTS=true
  FULLPASSWORD_COMPOSE_DIR="$(dirname "$compose_file")"
  FULLPASSWORD_ENV_FILE="$FULLPASSWORD_COMPOSE_DIR/.env"
  compose_path_readable "$compose_file" || return 4
  FULLPASSWORD_COMPOSE_READABLE=true
}

discover_fullpassword_compose() {
  local container="${1:-}" fallback="${2-/opt/fullpassword/docker-compose.yml}"
  local config_files="${FULLPASSWORD_CONFIG_FILES:-}" project_dir="${FULLPASSWORD_WORKING_DIR:-}"
  local first_candidate= normalized= fallback_normalized= discovery_status=0

  FULLPASSWORD_COMPOSE_FILE="${FULLPASSWORD_COMPOSE_FILE:-}"
  FULLPASSWORD_COMPOSE_DIR="${FULLPASSWORD_COMPOSE_DIR:-}"
  FULLPASSWORD_ENV_FILE="${FULLPASSWORD_ENV_FILE:-}"
  FULLPASSWORD_COMPOSE_VARIABLE_INITIALIZED=true
  config_files="$(normalize_docker_label "$config_files")"
  project_dir="$(normalize_docker_label "$project_dir")"
  FULLPASSWORD_CONFIG_FILES="$config_files"
  FULLPASSWORD_WORKING_DIR="$project_dir"

  if [[ -n "$container" && -z "$project_dir" ]]; then
    project_dir="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$container" 2>/dev/null || true)"
    project_dir="$(normalize_docker_label "$project_dir")"
    FULLPASSWORD_WORKING_DIR="$project_dir"
  fi
  if [[ -n "$container" && -z "$config_files" ]]; then
    config_files="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$container" 2>/dev/null || true)"
    config_files="$(normalize_docker_label "$config_files")"
    FULLPASSWORD_CONFIG_FILES="$config_files"
  fi

  first_candidate="${config_files%%,*}"
  if [[ -n "$(trim_whitespace "$first_candidate")" ]]; then
    normalized="$(normalize_compose_path "$first_candidate" "$project_dir" 2>/dev/null || true)"
  fi
  fallback_normalized="$(normalize_compose_path "$fallback" / 2>/dev/null || true)"

  if [[ -n "$normalized" && -f "$normalized" ]]; then
    validate_fullpassword_compose_path "$normalized" || discovery_status=$?
  elif [[ -n "$fallback_normalized" && -f "$fallback_normalized" ]]; then
    validate_fullpassword_compose_path "$fallback_normalized" || discovery_status=$?
  elif [[ -n "$normalized" ]]; then
    validate_fullpassword_compose_path "$normalized" || discovery_status=$?
  elif [[ -n "$fallback_normalized" ]]; then
    validate_fullpassword_compose_path "$fallback_normalized" || discovery_status=$?
  else
    FULLPASSWORD_COMPOSE_FILE=
    FULLPASSWORD_COMPOSE_DETECTED=false
    discovery_status=2
  fi
  return "$discovery_status"
}

new_diagnostic_temp() {
  DIAGNOSTIC_TEMP_RESULT="$(mktemp -d /tmp/devflow-compose-validation.XXXXXX)"
  chmod 0700 "$DIAGNOSTIC_TEMP_RESULT"
  DIAGNOSTIC_TEMP_DIRS+=("$DIAGNOSTIC_TEMP_RESULT")
}

cleanup_diagnostic_temps() {
  local temporary
  for temporary in "${DIAGNOSTIC_TEMP_DIRS[@]:-}"; do
    [[ -n "$temporary" && "$temporary" == /tmp/devflow-compose-validation.* ]] || continue
    [[ ! -d "$temporary" ]] || rm -rf -- "$temporary"
  done
}

discover_protected_compose_inputs() {
  local compose_file="${1:?compose_file obrigatório}" manifest="${2:?manifest obrigatório}"
  local kind path exists readable privileged protected
  python3 "$DEVFLOW_SOURCE_ROOT/scripts/discover-compose-inputs.py" \
    "$compose_file" > "$manifest"
  while IFS=$'\t' read -r kind path exists readable privileged protected; do
    [[ -n "$kind" ]] || continue
    if [[ "$kind" == required-variable ]]; then
      COMPOSE_INPUT_RECORDS+=("required-variable|$path|unknown|unknown|unknown|unknown")
      continue
    fi
    COMPOSE_INPUT_RECORDS+=("$kind|$path|$exists|$readable|$privileged|$protected")
    if [[ "$exists" == true && "$protected" == true ]]; then
      PROTECTED_COMPOSE_INPUTS_DETECTED=true
    fi
    if [[ "$exists" == true && "$readable" == false ]]; then
      PROTECTED_COMPOSE_INPUTS_DETECTED=true
      PRIVILEGED_VALIDATION_REQUIRED=true
    elif [[ "$exists" == true && "$protected" == true && "$(execution_uid)" -eq 0 ]]; then
      # Root can read the input now, but the report must retain that privilege was required.
      PRIVILEGED_VALIDATION_REQUIRED=true
    fi
  done < "$manifest"
}

print_privileged_dry_run_guidance() {
  local record kind path exists readable privileged protected
  cat <<EOF
O Docker Compose do proxy compartilhado utiliza arquivos de configuração
protegidos que não podem ser lidos pelo usuário atual.

Arquivos protegidos detectados:
EOF
  for record in "${COMPOSE_INPUT_RECORDS[@]}"; do
    IFS='|' read -r kind path exists readable privileged protected <<< "$record"
    [[ "$kind" != required-variable && "$exists" == true && "$readable" == false ]] || continue
    printf '  %s\n' "$path"
  done
  cat <<EOF

Para concluir a validação somente leitura, execute o dry-run com sudo:

  sudo ./install.sh --dry-run \\
    --proxy-mode shared \\
    --domain ${DOMAIN:-HOST_DEVFLOW} \\
    --letsencrypt-email ${LETSENCRYPT_EMAIL:-EMAIL_TLS} \\
    --super-admin-email ${SUPER_ADMIN_EMAIL:-EMAIL_ADMIN} \\
    --http-port $HTTP_PORT \\
    --api-port $API_PORT

Nenhum arquivo, container, rede ou certificado será alterado durante
essa validação.
EOF
}

load_structural_results() {
  local result_file="$1" key value
  while IFS='=' read -r key value; do
    [[ "$value" == true || "$value" == false ]] || continue
    case "$key" in
      original_services_preserved) ORIGINAL_SERVICES_PRESERVED="$value" ;;
      original_ports_preserved) ORIGINAL_PORTS_PRESERVED="$value" ;;
      original_mounts_preserved) ORIGINAL_MOUNTS_PRESERVED="$value" ;;
      original_networks_preserved) ORIGINAL_NETWORKS_PRESERVED="$value" ;;
      original_restart_policies_preserved) ORIGINAL_RESTART_POLICIES_PRESERVED="$value" ;;
      original_images_preserved) ORIGINAL_IMAGES_PRESERVED="$value" ;;
      original_volumes_preserved) ORIGINAL_VOLUMES_PRESERVED="$value" ;;
      original_environment_preserved) ORIGINAL_ENVIRONMENT_PRESERVED="$value" ;;
      devflow_override_added) DEVFLOW_OVERRIDE_ADDED="$value" ;;
      devflow_edge_added) DEVFLOW_EDGE_ADDED="$value" ;;
      devflow_nginx_mount_added) DEVFLOW_NGINX_MOUNT_ADDED="$value" ;;
      devflow_database_exposure_absent) DEVFLOW_DATABASE_EXPOSURE_ABSENT="$value" ;;
      sensitive_values_logged) SENSITIVE_VALUES_LOGGED="$value" ;;
    esac
  done < "$result_file"
}

classify_compose_failure() {
  local error_file="$1"
  if grep -Eqi 'permission denied|operation not permitted' "$error_file"; then
    PROTECTED_COMPOSE_INPUTS_DETECTED=true
    if [[ "$(execution_uid)" -ne 0 ]]; then
      PRIVILEGED_VALIDATION_REQUIRED=true
      COMPOSE_VALIDATION_BLOCKED_BY=protected-env-file
    else
      COMPOSE_VALIDATION_BLOCKED_BY=protected-compose-input
    fi
  elif grep -Eqi 'required variable|variable is not set|must be set|required.*not set' "$error_file"; then
    COMPOSE_VALIDATION_BLOCKED_BY=required-variable-missing
  elif grep -Eqi 'env file|\.env.*(invalid|parse|format)|unexpected character' "$error_file"; then
    COMPOSE_VALIDATION_BLOCKED_BY=invalid-env-file
  else
    COMPOSE_VALIDATION_BLOCKED_BY=compose-command-failed
  fi
  COMPOSE_VALIDATION_ERROR="$COMPOSE_VALIDATION_BLOCKED_BY"
}

validate_compose_merge() {
  local compose_file="${1:?compose_file obrigatório}" project_dir="${2:?project_dir obrigatório}"
  local override_file="${3:?override_file obrigatório}" base_json="${4:?base_json obrigatório}"
  local merged_json="${5:?merged_json obrigatório}" error_file="${6:?error_file obrigatório}"
  local structural_result="${7:?structural_result obrigatório}" structural_error="${8:?structural_error obrigatório}"
  local compose_status=0 validator_status=0

  printf -v COMPOSE_EXECUTED_COMMAND \
    'docker compose --project-directory %q -f %q -f %q config --format json' \
    "$project_dir" "$compose_file" "$override_file"
  COMPOSE_VALIDATION_ATTEMPTED=true
  if docker compose --project-directory "$project_dir" \
    -f "$compose_file" config --format json > "$base_json" 2>"$error_file"; then
    if docker compose --project-directory "$project_dir" \
      -f "$compose_file" -f "$override_file" \
      config --format json > "$merged_json" 2>"$error_file"; then
      COMPOSE_CROSS_DIRECTORY_SUPPORTED=true
    else
      compose_status=$?
      classify_compose_failure "$error_file"
      if [[ "$COMPOSE_VALIDATION_BLOCKED_BY" == compose-command-failed ]]; then
        COMPOSE_CROSS_DIRECTORY_SUPPORTED=false
        COMPOSE_VALIDATION_BLOCKED_BY=compose-cross-directory-incompatible
        COMPOSE_VALIDATION_ERROR=compose-cross-directory-incompatible
      fi
    fi
  else
    compose_status=$?
    classify_compose_failure "$error_file"
  fi
  COMPOSE_VALIDATION_EXIT_CODE="$compose_status"

  if [[ "$COMPOSE_CROSS_DIRECTORY_SUPPORTED" == true ]]; then
    if python3 "$DEVFLOW_SOURCE_ROOT/scripts/validate-fullpassword-compose.py" \
      "$base_json" "$merged_json" > "$structural_result" 2>"$structural_error"; then
      COMPOSE_MERGE_VALID=true
      COMPOSE_VALIDATION_ERROR=none
      COMPOSE_VALIDATION_BLOCKED_BY=none
      load_structural_results "$structural_result"
    else
      validator_status=$?
      COMPOSE_MERGE_VALID=false
      COMPOSE_VALIDATION_EXIT_CODE="$validator_status"
      COMPOSE_VALIDATION_BLOCKED_BY=structural-validation-failed
      COMPOSE_VALIDATION_ERROR=structural-validation-failed
    fi
  fi
  return 0
}

assess_shared_proxy_compatibility() {
  BLOCKERS=()
  COMPATIBILITY=blocked
  case "$PROXY_TYPE" in
    caddy-host|caddy-container)
      add_blocker 'Proxy Caddy detectado, mas a integração automática ainda não está disponível.'
      add_blocker 'A instalação foi interrompida sem alterações no proxy.'
      return 2
      ;;
    fullpassword-nginx)
      if [[ "$PRIVILEGED_VALIDATION_REQUIRED" == true && "$(execution_uid)" -ne 0 ]]; then
        add_blocker 'A validação completa do Compose exige execução privilegiada somente leitura.'
        COMPOSE_VALIDATION_BLOCKED_BY=protected-env-file
        return 3
      fi
      [[ "$FULLPASSWORD_PROJECT" == fullpassword ]] || add_blocker 'Projeto Compose esperado fullpassword não foi comprovado.'
      [[ "$FULLPASSWORD_SERVICE" == nginx ]] || add_blocker 'Serviço Compose esperado nginx não foi comprovado.'
      [[ "$FULLPASSWORD_IMAGE" == nginx:alpine ]] || add_blocker 'Imagem esperada nginx:alpine não foi comprovada.'
      [[ "$FULLPASSWORD_WORKING_DIR" == /opt/fullpassword ]] || add_blocker 'Working directory /opt/fullpassword não foi comprovado.'
      [[ "$FULLPASSWORD_CONFIG_FILES" == /opt/fullpassword/docker-compose.yml \
        || "$FULLPASSWORD_CONFIG_FILES" == /opt/fullpassword/docker-compose.yml,/opt/devflow/config/proxy/fullpassword-nginx.override.yml ]] \
        || add_blocker 'Lista de arquivos Compose diverge do contrato aprovado.'
      [[ "$FULLPASSWORD_RUNTIME_MOUNT" == true ]] || add_blocker 'Mount original nginx.runtime.conf read-only diverge do diagnóstico aprovado.'
      [[ "$FULLPASSWORD_CERTIFICATE_MOUNT" == true ]] || add_blocker 'Mount read-only de /etc/letsencrypt não foi comprovado.'
      [[ "$FULLPASSWORD_ORIGINAL_NETWORK" == true ]] || add_blocker 'Rede original fullpassword_fullpassword_network não foi comprovada.'
      [[ "$FULLPASSWORD_PORTS" == true ]] || add_blocker 'Publicação original das portas 80/443 não foi comprovada.'
      [[ "$FULLPASSWORD_UPSTREAM_SAFE" == true ]] || add_blocker 'A configuração original usa aliases reservados aos upstreams DevFlow.'
      [[ "$FULLPASSWORD_CERTIFICATE_SAFE" == true ]] || add_blocker 'Certificado preexistente do domínio DevFlow não é específico ou é wildcard.'
      [[ "$NGINX_CONF_D_INCLUDED" == true ]] || add_blocker 'Include /etc/nginx/conf.d/*.conf não foi comprovado.'
      [[ "$CONFIG_VALID" == true ]] || add_blocker 'Configuração atual do fullpassword_nginx é inválida.'
      [[ "$DOMAIN_CONFLICT" == false ]] || add_blocker 'O domínio DevFlow conflita com uma rota existente.'
      [[ "$FULLPASSWORD_COMPOSE_VARIABLE_INITIALIZED" == true ]] || add_blocker 'Variável do Compose original não foi inicializada.'
      [[ "$FULLPASSWORD_COMPOSE_DETECTED" == true ]] || add_blocker 'Não foi possível identificar o Compose original do Full Password.'
      [[ "$FULLPASSWORD_COMPOSE_EXISTS" == true ]] || add_blocker 'Compose original do Full Password não existe como arquivo regular.'
      [[ "$FULLPASSWORD_COMPOSE_READABLE" == true ]] || add_blocker 'Compose original do Full Password não está legível.'
      [[ "$DEVFLOW_DIRECTORY_WRITABLE" == true ]] || add_blocker 'Diretório /opt/devflow não pode receber os artefatos do adaptador.'
      [[ "$DEVFLOW_OVERRIDE_WRITABLE" == true ]] || add_blocker 'Override em /opt/devflow não pode ser criado ou atualizado com segurança.'
      [[ "$FULLPASSWORD_EDGE_NETWORK_SAFE" == true ]] || add_blocker 'devflow_edge existente não possui propriedade segura ou não pode ser criada.'
      [[ "$COMPOSE_CROSS_DIRECTORY_SUPPORTED" == true ]] || add_blocker 'Compose com arquivos em diretórios distintos não foi comprovado.'
      [[ "$COMPOSE_MERGE_VALID" == true ]] || add_blocker 'Merge do Compose original com o override não foi validado.'
      [[ "$FULLPASSWORD_ROLLBACK_READY" == true ]] || add_blocker 'Reversibilidade dos arquivos gerenciados não foi comprovada.'
      [[ "$FULLPASSWORD_PUBLIC_HEALTH" == true ]] || add_blocker 'Health público de pw.sti1.com.br falhou antes da integração.'
      if [[ ${#BLOCKERS[@]} -eq 0 ]]; then
        COMPATIBILITY=compatible-with-compose-override
        INSTALLATION_READY=true
        return 0
      fi
      return 2
      ;;
    nginx-container)
      add_blocker 'A integração automática com Nginx containerizado ainda não está implementada.'
      return 2
      ;;
    multiple-proxies)
      add_blocker 'Mais de um proxy candidato foi detectado; a seleção automática seria ambígua.'
      return 2
      ;;
    none)
      add_blocker 'Nenhum proxy existente foi detectado para o modo compartilhado.'
      return 2
      ;;
    host-nginx) ;;
    *)
      add_blocker "Tipo de proxy desconhecido: $PROXY_TYPE"
      return 2
      ;;
  esac

  [[ "$CONFIG_VALID" == true ]] || add_blocker 'A configuração efetiva do Nginx é inválida ou não pôde ser comprovada.'
  [[ "$PERSISTENT_CONFIG" == true ]] || add_blocker 'O include persistente /etc/nginx/conf.d/*.conf não foi comprovado.'
  [[ "$DOMAIN_CONFLICT" == false ]] || add_blocker 'O domínio DevFlow já aparece na configuração efetiva do proxy.'
  [[ "$PORT_CONFLICT" == false ]] || add_blocker 'Uma porta loopback planejada para o DevFlow já está ocupada.'
  [[ "$RELOAD_PROVEN" == true ]] || add_blocker 'O mecanismo persistente de reload do Nginx não foi comprovado.'
  [[ "$CERTIFICATE_METHOD" != unknown ]] || add_blocker 'O mecanismo de certificados HTTPS não foi reconhecido.'
  if [[ ${#BLOCKERS[@]} -eq 0 ]]; then
    COMPATIBILITY=compatible
    return 0
  fi
  return 2
}

sanitize_proxy_stream() {
  awk '
    /-----BEGIN .*PRIVATE KEY-----/ { print "[PRIVATE KEY REDACTED]"; private_key=1; next }
    /-----END .*PRIVATE KEY-----/ { private_key=0; next }
    !private_key { print }
  ' | redact_stream | sed -E \
    -e 's#(https?://)[^/@[:space:]]+:[^/@[:space:]]+@#\1[REDACTED]@#g' \
    -e '/^[[:space:]]*(proxy_set_header|add_header)[[:space:]]+(Authorization|Cookie|Set-Cookie)[[:space:]]/I s#^.*$#[SENSITIVE HEADER REDACTED]#'
}

detect_proxy() {
  local -a candidates=()
  local name image entry
  if [[ -n "$REQUESTED_CONTAINER" ]]; then
    docker inspect "$REQUESTED_CONTAINER" >/dev/null 2>&1 \
      || die "Container solicitado não encontrado: $REQUESTED_CONTAINER"
    PROXY_CONTAINER="$REQUESTED_CONTAINER"
  elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    while IFS='|' read -r name image; do
      [[ -n "$name" ]] || continue
      if [[ "$name" == fullpassword_nginx ]]; then
        candidates=("$name")
        break
      fi
      [[ "$name $image" =~ [Cc]addy|[Nn]ginx ]] && candidates+=("$name")
    done < <(docker ps -a --format '{{.Names}}|{{.Image}}')
    if [[ ${#candidates[@]} -gt 1 ]]; then
      PROXY_TYPE=multiple-proxies
      return
    elif [[ ${#candidates[@]} -eq 1 ]]; then
      PROXY_CONTAINER="${candidates[0]}"
    fi
  fi

  if [[ -n "$PROXY_CONTAINER" ]]; then
    image="$(docker inspect --format '{{.Config.Image}}' "$PROXY_CONTAINER" 2>/dev/null || true)"
    if [[ "$PROXY_CONTAINER" == fullpassword_nginx ]]; then
      PROXY_TYPE=fullpassword-nginx
    elif [[ "$PROXY_CONTAINER $image" =~ [Cc]addy ]]; then
      PROXY_TYPE=caddy-container
    elif [[ "$PROXY_CONTAINER $image" =~ [Nn]ginx ]]; then
      PROXY_TYPE=nginx-container
    else
      PROXY_TYPE=unknown-container
    fi
    return
  fi

  if command -v caddy >/dev/null 2>&1 && systemctl is-active --quiet caddy 2>/dev/null; then
    PROXY_TYPE=caddy-host
  elif command -v nginx >/dev/null 2>&1; then
    PROXY_TYPE=host-nginx
  else
    PROXY_TYPE=none
  fi
}

collect_host_nginx() {
  local domain_pattern="${DOMAIN//./\\.}"
  if nginx -t >/dev/null 2>&1; then CONFIG_VALID=true; fi
  PROXY_CONFIG_RAW="$(nginx -T 2>&1 || true)"
  if [[ -d /etc/nginx/conf.d ]] \
    && grep -Eq 'include[[:space:]]+/etc/nginx/conf\.d/\*\.conf[[:space:]]*;' <<< "$PROXY_CONFIG_RAW"; then
    PERSISTENT_CONFIG=true
  fi
  if [[ -n "$DOMAIN" ]] \
    && grep -Eq "server_name[[:space:]]+([^;[:space:]]+[[:space:]]+)*$domain_pattern([[:space:];]|$)" <<< "$PROXY_CONFIG_RAW"; then
    DOMAIN_CONFLICT=true
  fi
  if port_is_listening "$HTTP_PORT" || port_is_listening "$API_PORT"; then PORT_CONFLICT=true; fi
  if systemctl show nginx --property=ExecReload --value 2>/dev/null | grep -q '[^[:space:]]'; then
    RELOAD_PROVEN=true
  fi
  if command -v certbot >/dev/null 2>&1 || [[ -d /etc/letsencrypt ]]; then
    CERTIFICATE_METHOD=certbot-host
  elif grep -Eq 'ssl_certificate[[:space:]]+' <<< "$PROXY_CONFIG_RAW"; then
    CERTIFICATE_METHOD=existing-host-certificates
  fi
}

collect_container_nginx() {
  local mounts networks temporary base_json merged_json merge_error override_candidate input_manifest structural_result structural_error
  local http_code certificate_sans domain_pattern compose_discovery_status=0
  domain_pattern="${DOMAIN//./\\.}"
  mounts="$(docker inspect --format '{{range .Mounts}}{{.Type}}|{{.Source}}|{{.Destination}}|{{.RW}}{{println}}{{end}}' "$PROXY_CONTAINER" 2>/dev/null || true)"
  if docker exec "$PROXY_CONTAINER" nginx -t >/dev/null 2>&1; then CONFIG_VALID=true; fi
  PROXY_CONFIG_RAW="$(docker exec "$PROXY_CONTAINER" nginx -T 2>&1 || true)"
  grep -Eq 'include[[:space:]]+/etc/nginx/conf\.d/\*\.conf[[:space:]]*;' <<< "$PROXY_CONFIG_RAW" \
    && NGINX_CONF_D_INCLUDED=true
  if grep -Eq '\|/etc/nginx(/conf\.d)?\|(true|false)$' <<< "$mounts" \
    && docker exec "$PROXY_CONTAINER" sh -c 'test -d /etc/nginx/conf.d' >/dev/null 2>&1; then
    PERSISTENT_CONFIG=true
  fi
  if [[ -n "$DOMAIN" ]] \
    && grep -Eq "server_name[[:space:]]+([^;[:space:]]+[[:space:]]+)*$domain_pattern([[:space:];]|$)" <<< "$PROXY_CONFIG_RAW"; then
    DOMAIN_CONFLICT=true
  fi
  if grep -Eq '\|/etc/letsencrypt(/|\|)|\|/etc/ssl(/|\|)' <<< "$mounts"; then
    CERTIFICATE_METHOD=mounted-certificates
  elif grep -Eq 'ssl_certificate[[:space:]]+' <<< "$PROXY_CONFIG_RAW"; then
    CERTIFICATE_METHOD=container-managed-certificates
  fi
  RELOAD_PROVEN=false

  if [[ "$PROXY_TYPE" == fullpassword-nginx ]]; then
    FULLPASSWORD_PROJECT="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$PROXY_CONTAINER" 2>/dev/null || true)"
    FULLPASSWORD_SERVICE="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "$PROXY_CONTAINER" 2>/dev/null || true)"
    FULLPASSWORD_IMAGE="$(docker inspect --format '{{.Config.Image}}' "$PROXY_CONTAINER" 2>/dev/null || true)"
    FULLPASSWORD_WORKING_DIR="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$PROXY_CONTAINER" 2>/dev/null || true)"
    FULLPASSWORD_CONFIG_FILES="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$PROXY_CONTAINER" 2>/dev/null || true)"
    discover_fullpassword_compose "$PROXY_CONTAINER" || compose_discovery_status=$?
    case "$compose_discovery_status" in
      0) ;;
      2) COMPOSE_VALIDATION_BLOCKED_BY=compose-original-not-detected ;;
      3) COMPOSE_VALIDATION_BLOCKED_BY=compose-original-not-found ;;
      4) COMPOSE_VALIDATION_BLOCKED_BY=compose-original-unreadable ;;
      *) COMPOSE_VALIDATION_BLOCKED_BY=compose-original-invalid ;;
    esac
    if [[ "$compose_discovery_status" -ne 0 ]]; then
      COMPOSE_VALIDATION_ERROR="$COMPOSE_VALIDATION_BLOCKED_BY"
    fi
    grep -Fxq 'bind|/opt/fullpassword/docker/nginx.runtime.conf|/etc/nginx/conf.d/default.conf|false' <<< "$mounts" \
      && FULLPASSWORD_RUNTIME_MOUNT=true
    [[ "$FULLPASSWORD_RUNTIME_MOUNT" == true ]] && PERSISTENT_CONFIG=true
    grep -Fxq 'bind|/etc/letsencrypt|/etc/letsencrypt|false' <<< "$mounts" && FULLPASSWORD_CERTIFICATE_MOUNT=true
    networks="$(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{println}}{{end}}' "$PROXY_CONTAINER" 2>/dev/null || true)"
    grep -Fxq fullpassword_fullpassword_network <<< "$networks" && FULLPASSWORD_ORIGINAL_NETWORK=true
    if [[ -n "$(docker port "$PROXY_CONTAINER" 80/tcp 2>/dev/null || true)" \
      && -n "$(docker port "$PROXY_CONTAINER" 443/tcp 2>/dev/null || true)" ]]; then
      FULLPASSWORD_PORTS=true
    fi
    if ! grep -Eq 'devflow-(backend|frontend)' /opt/fullpassword/docker/nginx.runtime.conf 2>/dev/null; then
      FULLPASSWORD_UPSTREAM_SAFE=true
    fi
    if [[ -n "$DOMAIN" && -e "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]]; then
      certificate_sans="$(openssl x509 -in "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" -noout -ext subjectAltName 2>/dev/null || true)"
      if ! grep -Fq 'DNS:*' <<< "$certificate_sans" \
        && grep -Eq "DNS:${DOMAIN//./\\.}([,[:space:]]|$)" <<< "$certificate_sans"; then
        FULLPASSWORD_CERTIFICATE_SAFE=true
      fi
    else
      FULLPASSWORD_CERTIFICATE_SAFE=true
    fi
    if [[ "$DOMAIN_CONFLICT" == true \
      && -f /opt/devflow/config/nginx/devflow.conf \
      && "$(head -n1 /opt/devflow/config/nginx/devflow.conf 2>/dev/null || true)" == '# Managed by DevFlow Full Password proxy adapter. Independent virtual host.' ]] \
      && grep -Eq "server_name[[:space:]]+$domain_pattern[[:space:]]*;" /opt/devflow/config/nginx/devflow.conf; then
      DOMAIN_CONFLICT=false
    fi
    root_installation_can_manage /opt/devflow && DEVFLOW_DIRECTORY_WRITABLE=true
    if [[ -e /opt/devflow/config/proxy/fullpassword-nginx.override.yml ]]; then
      if root_installation_can_manage /opt/devflow/config/proxy/fullpassword-nginx.override.yml \
        && "$(head -n1 /opt/devflow/config/proxy/fullpassword-nginx.override.yml 2>/dev/null || true)" == '# Managed by DevFlow Full Password proxy adapter. Stored exclusively under /opt/devflow.' ]]; then
        DEVFLOW_OVERRIDE_WRITABLE=true
      fi
    elif root_installation_can_manage /opt/devflow/config/proxy/fullpassword-nginx.override.yml; then
      DEVFLOW_OVERRIDE_WRITABLE=true
    fi
    root_installation_can_manage /opt/devflow/config/nginx/devflow.conf && DEVFLOW_PROXY_CONFIG_WRITABLE=true
    if ! docker network inspect devflow_edge >/dev/null 2>&1 \
      || [[ "$(docker network inspect devflow_edge --format '{{index .Labels "devflow.managed"}}' 2>/dev/null || true)" == true ]]; then
      FULLPASSWORD_EDGE_NETWORK_SAFE=true
    fi
    if { [[ ! -e /opt/devflow/config/proxy/fullpassword-nginx.override.yml ]] \
          || [[ "$DEVFLOW_OVERRIDE_WRITABLE" == true \
            && "$(head -n1 /opt/devflow/config/proxy/fullpassword-nginx.override.yml 2>/dev/null || true)" == '# Managed by DevFlow Full Password proxy adapter. Stored exclusively under /opt/devflow.' ]]; } \
      && { [[ ! -e /opt/devflow/config/nginx/devflow.conf ]] \
          || [[ "$DEVFLOW_PROXY_CONFIG_WRITABLE" == true \
            && "$(head -n1 /opt/devflow/config/nginx/devflow.conf 2>/dev/null || true)" == '# Managed by DevFlow Full Password proxy adapter. Independent virtual host.' ]]; }; then
      FULLPASSWORD_ROLLBACK_READY=true
    fi
    http_code="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 20 'http://pw.sti1.com.br/' || true)"
    if [[ "$http_code" =~ ^[23][0-9][0-9]$ ]] \
      && curl --fail --silent --show-error --max-time 20 'https://pw.sti1.com.br/' >/dev/null; then
      FULLPASSWORD_PUBLIC_HEALTH=true
    fi
    if [[ "$FULLPASSWORD_COMPOSE_READABLE" == true ]]; then
      new_diagnostic_temp
      temporary="$DIAGNOSTIC_TEMP_RESULT"
      base_json="$temporary/base.json"
      merged_json="$temporary/merged.json"
      merge_error="$temporary/merge.error"
      input_manifest="$temporary/inputs.tsv"
      structural_result="$temporary/structural-results.txt"
      structural_error="$temporary/structural.error"
      override_candidate="$temporary/fullpassword-nginx.override.yml"
      COMPOSE_TEMP_OVERRIDE="$override_candidate (removido ao concluir)"
      printf -v COMPOSE_VALIDATION_COMMAND \
        'docker compose --project-directory %q -f %q -f %q config --format json' \
        "$FULLPASSWORD_COMPOSE_DIR" "$FULLPASSWORD_COMPOSE_FILE" \
        /opt/devflow/config/proxy/fullpassword-nginx.override.yml
      install -m 0600 "$DEVFLOW_SOURCE_ROOT/docker/fullpassword/fullpassword-nginx.override.yml.template" "$override_candidate"
      if ! discover_protected_compose_inputs "$FULLPASSWORD_COMPOSE_FILE" "$input_manifest"; then
        COMPOSE_VALIDATION_BLOCKED_BY=input-discovery-failed
        COMPOSE_VALIDATION_ERROR=input-discovery-failed
      elif [[ "$PRIVILEGED_VALIDATION_REQUIRED" == true && "$(execution_uid)" -ne 0 ]]; then
        COMPOSE_VALIDATION_BLOCKED_BY=protected-env-file
        COMPOSE_VALIDATION_ERROR=protected-env-file
      else
        validate_compose_merge \
          "$FULLPASSWORD_COMPOSE_FILE" "$FULLPASSWORD_COMPOSE_DIR" "$override_candidate" \
          "$base_json" "$merged_json" "$merge_error" "$structural_result" "$structural_error"
      fi
    fi
  fi
}

render_container_details() {
  local network
  echo '[container]'
  docker inspect --format 'name={{.Name}}' "$PROXY_CONTAINER" | sed 's#name=/#name=#'
  docker inspect --format 'id={{.Id}}' "$PROXY_CONTAINER"
  docker inspect --format 'image={{.Config.Image}}' "$PROXY_CONTAINER"
  docker inspect --format 'status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}not-configured{{end}}' "$PROXY_CONTAINER"
  docker inspect --format 'ports={{json .NetworkSettings.Ports}}' "$PROXY_CONTAINER"
  docker inspect --format 'restart_policy={{.HostConfig.RestartPolicy.Name}}' "$PROXY_CONTAINER"
  docker inspect --format 'compose_project={{index .Config.Labels "com.docker.compose.project"}}' "$PROXY_CONTAINER"
  docker inspect --format 'compose_service={{index .Config.Labels "com.docker.compose.service"}}' "$PROXY_CONTAINER"
  docker inspect --format 'compose_working_dir={{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$PROXY_CONTAINER"
  docker inspect --format 'compose_config_files={{index .Config.Labels "com.docker.compose.project.config_files"}}' "$PROXY_CONTAINER"
  echo 'mounts=type|source|destination|writable'
  docker inspect --format '{{range .Mounts}}{{.Type}}|{{.Source}}|{{.Destination}}|{{.RW}}{{println}}{{end}}' "$PROXY_CONTAINER"
  echo 'networks:'
  while IFS= read -r network; do
    [[ -n "$network" ]] || continue
    docker network inspect --format 'name={{.Name}} id={{.Id}} driver={{.Driver}} internal={{.Internal}} attachable={{.Attachable}} compose_project={{index .Labels "com.docker.compose.project"}}' "$network" 2>/dev/null || true
  done < <(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{println}}{{end}}' "$PROXY_CONTAINER")
  echo 'reload_candidate=docker exec <container> nginx -s reload (not executed)'
}

render_report() {
  local commit=unknown
  commit="$(git -C "$DEVFLOW_SOURCE_ROOT" rev-parse HEAD 2>/dev/null || true)"
  [[ "$commit" =~ ^[0-9a-f]{40}$ ]] || commit=unknown
  echo '# Managed by DevFlow shared proxy diagnostic. Sanitized; no changes applied to the proxy.'
  echo "timestamp=$(timestamp)"
  echo "version=$DEVFLOW_VERSION"
  echo "commit=$commit"
  echo "execution_uid=$(execution_uid)"
  echo "execution_user=$(id -un 2>/dev/null || echo unknown)"
  echo "running_as_root=$([[ "$(execution_uid)" -eq 0 ]] && echo true || echo false)"
  echo "operation_mode=$OPERATION_MODE"
  echo "proxy_type=$PROXY_TYPE"
  echo "container=${PROXY_CONTAINER:-none}"
  echo "domain=${DOMAIN:-not-provided}"
  echo "config_valid=$CONFIG_VALID"
  echo "persistent_config=$PERSISTENT_CONFIG"
  echo "certificate_method=$CERTIFICATE_METHOD"
  echo "reload_proven=$RELOAD_PROVEN"
  echo "domain_conflict=$DOMAIN_CONFLICT"
  echo "port_conflict=$PORT_CONFLICT"
  echo "compatibility=$COMPATIBILITY"
  if [[ "$PROXY_TYPE" == fullpassword-nginx ]]; then
    echo "fullpassword_project=${FULLPASSWORD_PROJECT:-unknown}"
    echo "fullpassword_service=${FULLPASSWORD_SERVICE:-unknown}"
    echo "fullpassword_image=${FULLPASSWORD_IMAGE:-unknown}"
    echo "fullpassword_working_dir=${FULLPASSWORD_WORKING_DIR:-unknown}"
    echo "fullpassword_config_files=${FULLPASSWORD_CONFIG_FILES:-unknown}"
    echo "fullpassword_runtime_mount=$FULLPASSWORD_RUNTIME_MOUNT"
    echo "fullpassword_certificate_mount=$FULLPASSWORD_CERTIFICATE_MOUNT"
    echo "fullpassword_original_network=$FULLPASSWORD_ORIGINAL_NETWORK"
    echo "fullpassword_ports=$FULLPASSWORD_PORTS"
    echo "fullpassword_upstream_safe=$FULLPASSWORD_UPSTREAM_SAFE"
    echo "fullpassword_certificate_safe=$FULLPASSWORD_CERTIFICATE_SAFE"
    echo "nginx_conf_d_included=$NGINX_CONF_D_INCLUDED"
    echo "devflow_directory_writable=$DEVFLOW_DIRECTORY_WRITABLE"
    echo "devflow_override_writable=$DEVFLOW_OVERRIDE_WRITABLE"
    echo "devflow_proxy_config_writable=$DEVFLOW_PROXY_CONFIG_WRITABLE"
    echo 'devflow_write_context=root-installation'
    echo "fullpassword_compose_variable_initialized=$FULLPASSWORD_COMPOSE_VARIABLE_INITIALIZED"
    echo "fullpassword_compose_detected=$FULLPASSWORD_COMPOSE_DETECTED"
    echo "compose_original_detected=$FULLPASSWORD_COMPOSE_DETECTED"
    echo "fullpassword_compose_file=${FULLPASSWORD_COMPOSE_FILE:-not-detected}"
    echo "fullpassword_compose_exists=$FULLPASSWORD_COMPOSE_EXISTS"
    echo "fullpassword_compose_readable=$FULLPASSWORD_COMPOSE_READABLE"
    echo "fullpassword_compose_original=${FULLPASSWORD_COMPOSE_FILE:-not-detected}"
    echo "devflow_override_planned=/opt/devflow/config/proxy/fullpassword-nginx.override.yml"
    echo "compose_temporary_override=$COMPOSE_TEMP_OVERRIDE"
    echo "compose_validation_command=$COMPOSE_VALIDATION_COMMAND"
    echo "compose_executed_command=$COMPOSE_EXECUTED_COMMAND"
    echo "compose_validation_exit_code=$COMPOSE_VALIDATION_EXIT_CODE"
    echo "compose_validation_error=$COMPOSE_VALIDATION_ERROR"
    echo "compose_validation_attempted=$COMPOSE_VALIDATION_ATTEMPTED"
    echo "compose_validation_blocked_by=$COMPOSE_VALIDATION_BLOCKED_BY"
    echo "compose_cross_directory_supported=$COMPOSE_CROSS_DIRECTORY_SUPPORTED"
    echo "compose_merge_valid=$COMPOSE_MERGE_VALID"
    echo "protected_compose_inputs_detected=$PROTECTED_COMPOSE_INPUTS_DETECTED"
    echo "protected_input_detected=$PROTECTED_COMPOSE_INPUTS_DETECTED"
    echo "privileged_validation_required=$PRIVILEGED_VALIDATION_REQUIRED"
    echo "changes_applied=$CHANGES_APPLIED"
    echo "installation_ready=$INSTALLATION_READY"
    echo "original_services_preserved=$ORIGINAL_SERVICES_PRESERVED"
    echo "original_ports_preserved=$ORIGINAL_PORTS_PRESERVED"
    echo "original_mounts_preserved=$ORIGINAL_MOUNTS_PRESERVED"
    echo "original_networks_preserved=$ORIGINAL_NETWORKS_PRESERVED"
    echo "original_restart_policies_preserved=$ORIGINAL_RESTART_POLICIES_PRESERVED"
    echo "original_images_preserved=$ORIGINAL_IMAGES_PRESERVED"
    echo "original_volumes_preserved=$ORIGINAL_VOLUMES_PRESERVED"
    echo "original_environment_preserved=$ORIGINAL_ENVIRONMENT_PRESERVED"
    echo "devflow_override_added=$DEVFLOW_OVERRIDE_ADDED"
    echo "devflow_edge_added=$DEVFLOW_EDGE_ADDED"
    echo "devflow_nginx_mount_added=$DEVFLOW_NGINX_MOUNT_ADDED"
    echo "devflow_database_exposure_absent=$DEVFLOW_DATABASE_EXPOSURE_ABSENT"
    echo "sensitive_values_logged=$SENSITIVE_VALUES_LOGGED"
    echo "internal_script_error=$INTERNAL_SCRIPT_ERROR"
    local record kind path exists readable privileged protected
    for record in "${COMPOSE_INPUT_RECORDS[@]}"; do
      IFS='|' read -r kind path exists readable privileged protected <<< "$record"
      [[ "$kind" != required-variable ]] || continue
      echo "compose_input_file=$path"
      echo "compose_input_kind=$kind"
      echo "compose_input_exists=$exists"
      echo "compose_input_readable_current=$readable"
      echo "compose_input_readable_privileged=$privileged"
      echo 'compose_input_content_exposed=false'
      echo "arquivo_detectado=$path"
      echo "legivel_usuario_atual=$readable"
      echo "legivel_execucao_privilegiada=$privileged"
      echo 'conteudo_exposto=false'
    done
    echo "fullpassword_edge_network_safe=$FULLPASSWORD_EDGE_NETWORK_SAFE"
    echo "fullpassword_rollback_ready=$FULLPASSWORD_ROLLBACK_READY"
    echo "fullpassword_public_health=$FULLPASSWORD_PUBLIC_HEALTH"
  fi
  echo 'blockers:'
  if [[ ${#BLOCKERS[@]} -eq 0 ]]; then
    echo '- none'
  else
    printf -- '- %s\n' "${BLOCKERS[@]}"
  fi
  if [[ -n "$PROXY_CONTAINER" ]]; then
    render_container_details
  elif [[ "$PROXY_TYPE" == host-nginx ]]; then
    echo '[host-nginx]'
    systemctl show nginx --property=ActiveState,UnitFileState,FragmentPath,ExecReload 2>&1 || true
    echo 'conf_d_exists='"$([[ -d /etc/nginx/conf.d ]] && echo true || echo false)"
    echo 'reload_candidate=systemctl reload nginx (not executed)'
  fi
  echo '[included-directives]'
  if [[ -n "$PROXY_CONFIG_RAW" ]]; then
    grep -E '^[[:space:]]*include[[:space:]]+' <<< "$PROXY_CONFIG_RAW" | sanitize_proxy_stream || true
  else
    echo 'not-available'
  fi
  echo '[certificate-paths]'
  if [[ -n "$PROXY_CONFIG_RAW" ]]; then
    grep -E '^[[:space:]]*ssl_certificate(_key)?[[:space:]]+' <<< "$PROXY_CONFIG_RAW" | sanitize_proxy_stream || true
  else
    echo 'not-available'
  fi
  echo '[effective-configuration-sanitized]'
  if [[ -n "$PROXY_CONFIG_RAW" ]]; then
    printf '%s\n' "$PROXY_CONFIG_RAW" | sanitize_proxy_stream
  else
    echo 'not-available'
  fi
  echo '[recommendation]'
  if [[ "$COMPOSE_VALIDATION_BLOCKED_BY" == protected-env-file ]]; then
    echo 'Validação completa requer nova execução privilegiada somente leitura; nenhuma alteração foi realizada.'
  elif [[ "$COMPATIBILITY" == compatible-with-compose-override ]]; then
    echo 'Integração automática compatível com Compose override; nenhuma alteração foi realizada pelo diagnóstico.'
  elif [[ "$COMPATIBILITY" == compatible ]]; then
    echo 'Integração automática compatível para Nginx do host; nenhuma alteração foi realizada pelo diagnóstico.'
  else
    echo 'Integração automática não comprovada. Nenhuma alteração foi realizada no proxy. Consulte os bloqueios acima.'
  fi
}

write_report() {
  local output="$1" parent temporary
  if [[ "$output" == - ]]; then
    render_report | sanitize_proxy_stream
    return
  fi
  validate_safe_absolute_path "$output" 'Arquivo de relatório'
  parent="$(dirname "$output")"
  if [[ ! -d "$parent" ]]; then
    [[ "$output" == /opt/devflow/logs/shared-proxy-diagnostic.log ]] \
      || die "Diretório do relatório ausente: $parent"
    require_root
    install -d -m 0750 "$parent"
  fi
  if [[ -e "$output" ]]; then
    [[ "$(head -n1 "$output" 2>/dev/null || true)" == '# Managed by DevFlow shared proxy diagnostic. Sanitized; no changes applied to the proxy.' ]] \
      || die 'O arquivo de relatório existente não pertence ao DevFlow.'
  fi
  temporary="$(mktemp "$parent/.shared-proxy-diagnostic.XXXXXX")"
  render_report | sanitize_proxy_stream > "$temporary"
  chmod 0600 "$temporary"
  mv -f -- "$temporary" "$output"
  cat "$output"
}

handle_internal_error() {
  local exit_code="${1:-1}" line="${2:-unknown}" function_name="${3:-main}"
  local operation="${CURRENT_OPERATION:-unknown}"
  trap - ERR
  INTERNAL_SCRIPT_ERROR=true
  printf 'Erro interno sanitizado: script=detect-shared-proxy.sh line=%s function=%s exit_code=%s operation=%s\n' \
    "$line" "$function_name" "$exit_code" "$operation" >&2
  printf 'internal_script_error=true\ncompatibility=blocked\nchanges_applied=false\n' >&2
  exit "$exit_code"
}

main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --container) REQUESTED_CONTAINER="${2:-}"; shift 2 ;;
      --domain) DOMAIN="${2:-}"; shift 2 ;;
      --letsencrypt-email) LETSENCRYPT_EMAIL="${2:-}"; shift 2 ;;
      --super-admin-email) SUPER_ADMIN_EMAIL="${2:-}"; shift 2 ;;
      --http-port) HTTP_PORT="${2:-}"; shift 2 ;;
      --api-port) API_PORT="${2:-}"; shift 2 ;;
      --operation-mode) OPERATION_MODE="${2:-}"; shift 2 ;;
      --output) OUTPUT="${2:-}"; shift 2 ;;
      --help|-h) usage; exit 0 ;;
      *) die "Opção desconhecida: $1" ;;
    esac
  done

  require_linux
  [[ -z "$DOMAIN" ]] || validate_domain "$DOMAIN"
  validate_port "$HTTP_PORT"
  validate_port "$API_PORT"
  [[ "$HTTP_PORT" != "$API_PORT" ]] || die 'As portas planejadas devem ser diferentes.'
  [[ -z "$REQUESTED_CONTAINER" || "$REQUESTED_CONTAINER" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]+$ ]] \
    || die 'Nome de container inválido.'
  [[ "$OPERATION_MODE" == diagnostic || "$OPERATION_MODE" == check || "$OPERATION_MODE" == dry-run || "$OPERATION_MODE" == install ]] \
    || die 'Modo operacional do diagnóstico inválido.'

  trap cleanup_diagnostic_temps EXIT
  trap 'exit 130' INT TERM
  trap 'handle_internal_error "$?" "$LINENO" "${FUNCNAME[0]:-main}"' ERR

  CURRENT_OPERATION=detect-proxy
  detect_proxy
  CURRENT_OPERATION=collect-proxy-facts
  case "$PROXY_TYPE" in
    host-nginx) collect_host_nginx ;;
    fullpassword-nginx|nginx-container) collect_container_nginx ;;
    *) ;;
  esac
  CURRENT_OPERATION=assess-compatibility
  assess_shared_proxy_compatibility || assessment_status=$?
  assessment_status="${assessment_status:-0}"
  CURRENT_OPERATION=write-sanitized-report
  write_report "$OUTPUT"
  if [[ "$assessment_status" -eq 3 ]]; then
    print_privileged_dry_run_guidance >&2
  fi
  exit "$assessment_status"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
