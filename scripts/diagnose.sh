#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/fullpassword-proxy.sh
. "$SCRIPT_DIR/lib/fullpassword-proxy.sh"

OUTPUT=
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output) OUTPUT="${2:-}"; shift 2 ;;
    --help|-h)
      echo 'Uso: scripts/diagnose.sh [--output ARQUIVO]'
      exit 0
      ;;
    *) die "Opção desconhecida: $1" ;;
  esac
done

require_linux
if [[ -n "$OUTPUT" ]]; then
  [[ "$OUTPUT" != / && ! -d "$OUTPUT" ]] || die 'Arquivo de saída inválido.'
  [[ ! -e "$OUTPUT" ]] || die 'O arquivo de saída já existe; escolha um caminho novo.'
  exec > >(tee "$OUTPUT") 2>&1
fi

echo "DevFlow sanitized diagnostic — $(timestamp)"
echo "version=$DEVFLOW_VERSION"
echo
echo '[system]'
uname -srvmo | redact_stream
if [[ -r /etc/os-release ]]; then
  grep -E '^(NAME|VERSION|ID|VERSION_ID)=' /etc/os-release | redact_stream
fi
echo
echo '[capacity]'
df -h / "$DEVFLOW_INSTALL_ROOT" 2>/dev/null | awk 'NR==1 || !seen[$1]++'
free -h 2>/dev/null || true
echo
echo '[docker]'
if command -v docker >/dev/null 2>&1; then
  docker version --format 'client={{.Client.Version}} server={{.Server.Version}}' 2>&1 | redact_stream || true
  docker compose version 2>&1 | redact_stream || true
  echo 'containers:'
  docker ps -a --filter "label=com.docker.compose.project=$DEVFLOW_PROJECT" \
    --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}' 2>&1 | redact_stream || true
  echo 'networks:'
  docker network ls --filter "label=com.docker.compose.project=$DEVFLOW_PROJECT" \
    --format 'table {{.Name}}\t{{.Driver}}' 2>&1 | redact_stream || true
  echo 'volumes:'
  docker volume ls --filter "label=com.docker.compose.project=$DEVFLOW_PROJECT" \
    --format 'table {{.Name}}\t{{.Driver}}' 2>&1 | redact_stream || true
  echo 'fullpassword_nginx:'
  docker ps -a --filter name='^/fullpassword_nginx$' --format '{{.Names}} {{.Status}}' 2>&1 | redact_stream || true
else
  echo 'Docker ausente.'
fi
echo
echo '[ports]'
ss -H -ltn 2>/dev/null | awk '{print $1, $4}' | sort -u || true
echo
echo '[configuration]'
if [[ -r "$DEVFLOW_ENV_FILE" ]]; then
  mode="$(stat -c '%a' "$DEVFLOW_ENV_FILE")"
  echo "env_file=present mode=$mode"
  load_devflow_env
  echo "proxy_mode=${DEVFLOW_PROXY_MODE:-unknown}"
  echo "shared_proxy_adapter=${DEVFLOW_SHARED_PROXY_ADAPTER:-none}"
  echo "domain=${DEVFLOW_DOMAIN:-unknown}"
else
  echo 'env_file=absent'
fi
echo
echo '[migrations]'
if [[ -r "$DEVFLOW_ENV_FILE" ]] && command -v docker >/dev/null 2>&1; then
  DEVFLOW_APP_ROOT="${DEVFLOW_APP_ROOT:-$DEVFLOW_INSTALL_ROOT/app}"
  if [[ -e "$DEVFLOW_APP_ROOT/docker-compose.yml" ]]; then
    compose_files
    "${DEVFLOW_COMPOSE[@]}" exec -T db sh -c \
      'psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT version || '\'' '\'' || applied_at FROM schema_migrations ORDER BY applied_at"' \
      2>&1 | redact_stream || echo 'Migration status unavailable.'
  fi
else
  echo 'Migration status unavailable.'
fi
echo
echo '[proxy]'
if [[ "${DEVFLOW_SHARED_PROXY_ADAPTER:-none}" == fullpassword-nginx ]] && command -v docker >/dev/null 2>&1; then
  echo "override=$([[ -f "$FULLPASSWORD_OVERRIDE_FILE" ]] && echo present || echo absent)"
  echo "devflow_config=$([[ -f "$DEVFLOW_PROXY_CONFIG" ]] && echo present || echo absent)"
  docker exec "$FULLPASSWORD_CONTAINER" nginx -t 2>&1 | redact_stream || true
  docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}network={{$name}}{{println}}{{end}}' \
    "$FULLPASSWORD_CONTAINER" 2>&1 | redact_stream || true
elif command -v nginx >/dev/null 2>&1; then
  nginx -t 2>&1 | redact_stream || true
else
  echo 'Host Nginx ausente ou não utilizado.'
fi
echo
echo '[recent DevFlow logs — redacted]'
if [[ -r "$DEVFLOW_ENV_FILE" && -e "$DEVFLOW_INSTALL_ROOT/app/docker-compose.yml" ]]; then
  DEVFLOW_APP_ROOT="$DEVFLOW_INSTALL_ROOT/app"
  compose_files
  "${DEVFLOW_COMPOSE[@]}" logs --tail 50 --no-color 2>&1 | redact_stream || true
  if [[ -r "$DEVFLOW_LOG_ROOT/fullpassword-proxy.log" ]]; then
    tail -n 50 "$DEVFLOW_LOG_ROOT/fullpassword-proxy.log" | redact_stream
  fi
else
  echo 'Logs indisponíveis.'
fi
echo
echo 'Diagnostic complete. Environment values, credentials, attachments and user data were not collected.'

if [[ -n "$OUTPUT" ]]; then
  chmod 0600 "$OUTPUT"
fi
