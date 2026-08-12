#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/compose-images.sh
. "$SCRIPT_DIR/lib/compose-images.sh"

INTERNAL_ONLY=false
QUIET=false
DAEMON_MODE="${DEVFLOW_UPDATE_DAEMON:-false}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --internal) INTERNAL_ONLY=true; shift ;;
    --daemon) DAEMON_MODE=true; shift ;;
    --quiet) QUIET=true; shift ;;
    --help|-h) echo 'Uso: sudo scripts/health.sh [--internal|--daemon] [--quiet]'; exit 0 ;;
    *) die "Opcao desconhecida: $1" ;;
  esac
done

[[ "$DAEMON_MODE" == true || "$DAEMON_MODE" == false ]] \
  || die 'DEVFLOW_UPDATE_DAEMON deve ser true ou false.'
[[ "$DAEMON_MODE" == false || "$INTERNAL_ONLY" == false ]] \
  || die '--daemon e --internal nao podem ser combinados.'

require_linux
require_root
load_devflow_env
validate_runtime_paths
load_installation_state "$DEVFLOW_STATE_ROOT/installation.json" \
  || die 'Estado instalado schema v3 ausente ou invalido.'
[[ "$DEVFLOW_INSTALLATION_STATE_MODE" == isolated ]] || die 'Somente o modo isolado e suportado.'

DEVFLOW_APP_ROOT="${DEVFLOW_APP_ROOT:-$DEVFLOW_INSTALL_ROOT/app}"
DEVFLOW_INSTALLED_SOURCE_DIR="${DEVFLOW_INSTALLED_SOURCE_DIR:-$DEVFLOW_INSTALL_ROOT/source}"
DEVFLOW_IDENTITY_RELEASE_ROOT="$DEVFLOW_APP_ROOT"
compose_files

failures=0
report() {
  local state="$1" key="$2" value="$3"
  [[ "$state" == PASS ]] || failures=$((failures + 1))
  [[ "$QUIET" == true ]] || printf '%-4s %-28s %s\n' "$state" "$key" "$value"
  printf -v "RESULT_${key^^}" '%s' "$value"
}

CONFIGURED_VERSION="${DEVFLOW_VERSION:-unknown}"
CONFIGURED_COMMIT="${DEVFLOW_RELEASE_COMMIT:-unknown}"
EXPECTED_VERSION="$DEVFLOW_INSTALLATION_STATE_VERSION"
EXPECTED_COMMIT="$DEVFLOW_INSTALLATION_STATE_COMMIT"
EXPECTED_MIGRATION="$DEVFLOW_INSTALLATION_STATE_MIGRATION"
if [[ "$CONFIGURED_VERSION" == "$EXPECTED_VERSION" ]]; then
  report PASS configured_version "$CONFIGURED_VERSION"
else
  report FAIL configured_version "$CONFIGURED_VERSION"
fi
if [[ "$CONFIGURED_COMMIT" == "$EXPECTED_COMMIT" ]]; then
  report PASS configured_commit "$CONFIGURED_COMMIT"
else
  report FAIL configured_commit "$CONFIGURED_COMMIT"
fi
report PASS installed_commit "$DEVFLOW_INSTALLATION_STATE_COMMIT"

for tuple in backend:backend_image worker:worker_image frontend:frontend_image db:db_image edge:nginx_image updater:updater_image; do
  service="${tuple%%:*}"; key="${tuple##*:}"
  if [[ "$service" == updater ]]; then
    updater_container_id="$(docker ps --filter 'name=^/devflow-updater$' --format '{{.ID}}' | head -n1)"
    updater_image_id="$(docker inspect --format '{{.Image}}' "$updater_container_id" 2>/dev/null || true)"
    if [[ -n "$updater_image_id" ]] && docker image inspect "$updater_image_id" >/dev/null 2>&1; then
      report PASS "$key" preserved-running-image
    else
      report FAIL "$key" missing
    fi
    continue
  fi
  image="$(compose_service_image_expected "$service" 2>/dev/null || true)"
  if [[ -n "$image" ]] && docker image inspect "$image" >/dev/null 2>&1; then
    image_id="$(docker image inspect --format '{{.Id}}' "$image" 2>/dev/null || true)"
    printf -v "EXPECTED_IMAGE_ID_${service^^}" '%s' "$image_id"
    if [[ "$service" == backend || "$service" == frontend || "$service" == worker ]]; then
      image_version="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' "$image" 2>/dev/null || true)"
      image_commit="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image" 2>/dev/null || true)"
      [[ "$image_version" == "$EXPECTED_VERSION" && "$image_commit" == "$EXPECTED_COMMIT" ]] \
        && report PASS "$key" "$image" || report FAIL "$key" identity-mismatch
    else
      report PASS "$key" "$image"
    fi
  else
    report FAIL "$key" "${image:-unresolved}"
  fi
done

for tuple in db:db backend:backend worker:worker frontend:frontend updater:updater edge:nginx; do
  service="${tuple%%:*}"
  key="${tuple##*:}"
  if [[ "$service" == edge && "$INTERNAL_ONLY" == true ]]; then
    report PASS "$key" skipped-internal
    continue
  fi
  container_id="$("${DEVFLOW_COMPOSE[@]}" ps -q "$service" 2>/dev/null || true)"
  health_state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
    "$container_id" 2>/dev/null || true)"
  [[ "$health_state" == healthy ]] \
    && report PASS "$key" healthy || report FAIL "$key" "${health_state:-missing}"
  if [[ "$service" == backend || "$service" == frontend || "$service" == worker ]]; then
    runtime_image_id="$(docker inspect --format '{{.Image}}' "$container_id" 2>/dev/null || true)"
    case "$service" in
      backend) expected_image_id="${EXPECTED_IMAGE_ID_BACKEND:-}" ;;
      frontend) expected_image_id="${EXPECTED_IMAGE_ID_FRONTEND:-}" ;;
      worker) expected_image_id="${EXPECTED_IMAGE_ID_WORKER:-}" ;;
    esac
    [[ -n "$expected_image_id" && "$runtime_image_id" == "$expected_image_id" ]] \
      && report PASS "${service}_runtime_image" "$runtime_image_id" \
      || report FAIL "${service}_runtime_image" "${runtime_image_id:-missing}"
  fi
done

db_id="$("${DEVFLOW_COMPOSE[@]}" ps -q db 2>/dev/null || true)"
db_networks="$(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{println}}{{end}}' \
  "$db_id" 2>/dev/null || true)"
if grep -Fxq devflow_internal <<< "$db_networks" \
  && ! grep -Fxq devflow_edge <<< "$db_networks" \
  && [[ -z "$(docker port "$db_id" 2>/dev/null || true)" ]]; then
  report PASS network_boundary isolated
else
  report FAIL network_boundary invalid
fi

if "${DEVFLOW_COMPOSE[@]}" exec -T db sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null; then
  report PASS database healthy
else
  report FAIL database unhealthy
fi

migration="$("${DEVFLOW_COMPOSE[@]}" exec -T db sh -c \
  'psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT version FROM schema_migrations ORDER BY applied_at DESC LIMIT 1"' \
  2>/dev/null || true)"
[[ -n "$migration" && "$migration" == "$EXPECTED_MIGRATION" ]] \
  && report PASS migration "$migration" || report FAIL migration "${migration:-missing}"

api_payload="$("${DEVFLOW_COMPOSE[@]}" exec -T backend node -e \
  "fetch('http://127.0.0.1:3000/api/health').then(async r=>{if(!r.ok)process.exit(1);process.stdout.write(await r.text())}).catch(()=>process.exit(1))" \
  2>/dev/null || true)"
api_version="$(printf '%s' "$api_payload" | python3 -c 'import json,sys; v=json.load(sys.stdin).get("version",""); print(v if isinstance(v,str) else "")' 2>/dev/null || true)"
api_commit="$(printf '%s' "$api_payload" | python3 -c 'import json,sys; v=json.load(sys.stdin).get("commit",""); print(v if isinstance(v,str) else "")' 2>/dev/null || true)"
if [[ "$api_version" == "$EXPECTED_VERSION" && "$api_commit" == "$EXPECTED_COMMIT" ]]; then
  report PASS backend_api healthy
  report PASS api_version "$api_version"
  report PASS api_commit "$api_commit"
else
  report FAIL backend_api unhealthy
  [[ "$api_version" == "$EXPECTED_VERSION" ]] && report PASS api_version "$api_version" || report FAIL api_version "${api_version:-missing}"
  [[ "$api_commit" == "$EXPECTED_COMMIT" ]] && report PASS api_commit "$api_commit" || report FAIL api_commit "${api_commit:-missing}"
fi
if "${DEVFLOW_COMPOSE[@]}" exec -T frontend wget -q -O /dev/null http://127.0.0.1/healthz; then
  report PASS frontend_http healthy
else
  report FAIL frontend_http unhealthy
fi

if [[ "$INTERNAL_ONLY" == false ]]; then
  resolve_ip="${DEVFLOW_HEALTH_RESOLVE_IP:-127.0.0.1}"
  if [[ "$DAEMON_MODE" == true ]]; then
    resolve_ip="$(docker inspect --format '{{(index .NetworkSettings.Networks "devflow_edge").IPAddress}}' devflow-nginx 2>/dev/null || true)"
    if validate_ipv4 "$resolve_ip"; then
      report PASS nginx_edge_ip "$resolve_ip"
    else
      report FAIL nginx_edge_ip "${resolve_ip:-missing}"
      resolve_ip=0.0.0.0
    fi
  else
    validate_ipv4 "$resolve_ip" || die 'Endereco de resolucao local do health invalido.'
  fi
  http_code="$(curl --resolve "$DEVFLOW_DOMAIN:80:$resolve_ip" --silent --output /dev/null \
    --write-out '%{http_code}' --max-time 20 "http://$DEVFLOW_DOMAIN/" || true)"
  [[ "$http_code" == 301 || "$http_code" == 308 ]] \
    && report PASS external_http redirect-https || report FAIL external_http "$http_code"
  if curl --resolve "$DEVFLOW_DOMAIN:443:$resolve_ip" --fail --silent --show-error --max-time 20 \
    "https://$DEVFLOW_DOMAIN/api/health" >/dev/null; then
    report PASS external_https healthy
  else
    report FAIL external_https unhealthy
  fi
  if [[ "$DAEMON_MODE" == true ]]; then
    report PASS certificate_file_check skipped-host-only
    report PASS certificate_expiration_file_check skipped-host-only
    report PASS certificate_renewal_timer skipped-host-only
  else
    certificate="$DEVFLOW_CERTIFICATE_PATH/live/$DEVFLOW_DOMAIN/fullchain.pem"
    if validate_devflow_certificate "$DEVFLOW_DOMAIN" "$DEVFLOW_CERTIFICATE_PATH" >/dev/null; then
      report PASS certificate valid
    else
      report FAIL certificate invalid
    fi
    if [[ -r "$certificate" ]] && openssl x509 -checkend 2592000 -noout -in "$certificate" >/dev/null 2>&1; then
      report PASS certificate_expiration valid-30-days
    else
      report FAIL certificate_expiration expiring
    fi
    if { command -v systemctl >/dev/null 2>&1 \
        && systemctl is-enabled --quiet devflow-certificate-renewal.timer \
        && systemctl is-active --quiet devflow-certificate-renewal.timer; } \
      || [[ -f "$DEVFLOW_STATE_ROOT/host-units.installed" ]]; then
      report PASS certificate_renewal active
    else
      report FAIL certificate_renewal inactive
    fi
  fi
else
  report PASS external_http skipped-internal
  report PASS external_https skipped-internal
  report PASS certificate skipped-internal
  report PASS certificate_expiration skipped-internal
  report PASS certificate_renewal skipped-internal
fi

overall=healthy
[[ "$failures" -eq 0 ]] || overall=unhealthy
if [[ "$DAEMON_MODE" == true ]]; then
  printf '%s\n' "daemon_runtime_health=$overall"
fi
printf '%s\n' \
  'installation_mode=isolated' \
  'external_publication_enabled=true' \
  "external_https_status=$([[ "$INTERNAL_ONLY" == true ]] && echo skipped-internal || echo "$RESULT_EXTERNAL_HTTPS")" \
  "overall_health=$overall"
[[ "$overall" == healthy ]]
