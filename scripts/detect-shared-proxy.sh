#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

OUTPUT=-
DOMAIN=
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
declare -a BLOCKERS=()

usage() {
  cat <<'EOF'
Uso:
  sudo scripts/detect-shared-proxy.sh --domain HOST [opções]

Opções:
  --container NOME  inspeciona somente o container indicado
  --http-port PORT  porta loopback planejada para o frontend
  --api-port PORT   porta loopback planejada para o backend
  --output ARQUIVO  relatório atômico; padrão: saída padrão
  --help

O diagnóstico é somente leitura em relação ao proxy, containers, redes,
certificados e configurações. Somente o arquivo de relatório solicitado é criado.
EOF
}

add_blocker() {
  BLOCKERS+=("$1")
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
      add_blocker 'fullpassword_nginx é um proxy containerizado pertencente a outra aplicação.'
      add_blocker 'Persistência, certificados, rede e reload precisam ser analisados antes de qualquer integração.'
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
  if nginx -t >/dev/null 2>&1; then CONFIG_VALID=true; fi
  PROXY_CONFIG_RAW="$(nginx -T 2>&1 || true)"
  if [[ -d /etc/nginx/conf.d ]] \
    && grep -Eq 'include[[:space:]]+/etc/nginx/conf\.d/\*\.conf[[:space:]]*;' <<< "$PROXY_CONFIG_RAW"; then
    PERSISTENT_CONFIG=true
  fi
  if [[ -n "$DOMAIN" ]] \
    && grep -Eq "server_name[[:space:]]+([^;[:space:]]+[[:space:]]+)*$DOMAIN([[:space:];]|$)" <<< "$PROXY_CONFIG_RAW"; then
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
  local mounts
  mounts="$(docker inspect --format '{{range .Mounts}}{{.Type}}|{{.Source}}|{{.Destination}}|{{.RW}}{{println}}{{end}}' "$PROXY_CONTAINER" 2>/dev/null || true)"
  if docker exec "$PROXY_CONTAINER" nginx -t >/dev/null 2>&1; then CONFIG_VALID=true; fi
  PROXY_CONFIG_RAW="$(docker exec "$PROXY_CONTAINER" nginx -T 2>&1 || true)"
  if grep -Eq '\|/etc/nginx(/conf\.d)?\|(true|false)$' <<< "$mounts" \
    && docker exec "$PROXY_CONTAINER" sh -c 'test -d /etc/nginx/conf.d' >/dev/null 2>&1; then
    PERSISTENT_CONFIG=true
  fi
  if [[ -n "$DOMAIN" ]] \
    && grep -Eq "server_name[[:space:]]+([^;[:space:]]+[[:space:]]+)*$DOMAIN([[:space:];]|$)" <<< "$PROXY_CONFIG_RAW"; then
    DOMAIN_CONFLICT=true
  fi
  if grep -Eq '\|/etc/letsencrypt(/|\|)|\|/etc/ssl(/|\|)' <<< "$mounts"; then
    CERTIFICATE_METHOD=mounted-certificates
  elif grep -Eq 'ssl_certificate[[:space:]]+' <<< "$PROXY_CONFIG_RAW"; then
    CERTIFICATE_METHOD=container-managed-certificates
  fi
  RELOAD_PROVEN=false
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
  if [[ "$COMPATIBILITY" == compatible ]]; then
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
    [[ "$output" == /var/log/devflow/shared-proxy-diagnostic.log ]] \
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

main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --container) REQUESTED_CONTAINER="${2:-}"; shift 2 ;;
      --domain) DOMAIN="${2:-}"; shift 2 ;;
      --http-port) HTTP_PORT="${2:-}"; shift 2 ;;
      --api-port) API_PORT="${2:-}"; shift 2 ;;
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

  detect_proxy
  case "$PROXY_TYPE" in
    host-nginx) collect_host_nginx ;;
    fullpassword-nginx|nginx-container) collect_container_nginx ;;
    *) ;;
  esac
  assess_shared_proxy_compatibility || assessment_status=$?
  assessment_status="${assessment_status:-0}"
  write_report "$OUTPUT"
  exit "$assessment_status"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
