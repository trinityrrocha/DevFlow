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
ALLOW_PENDING_STATE="${DEVFLOW_HEALTH_ALLOW_PENDING_VERSION:-false}"
[[ "$ALLOW_PENDING_STATE" == true || "$ALLOW_PENDING_STATE" == false ]] \
  || die 'DEVFLOW_HEALTH_ALLOW_PENDING_VERSION invalido.'
while [[ $# -gt 0 ]]; do
  case "$1" in
    --internal) INTERNAL_ONLY=true; shift ;;
    --quiet) QUIET=true; shift ;;
    --help|-h) echo 'Uso: sudo scripts/health.sh [--internal] [--quiet]'; exit 0 ;;
    *) die "Opcao desconhecida: $1" ;;
  esac
done

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
EXPECTED_VERSION="${DEVFLOW_EXPECTED_VERSION:-$DEVFLOW_INSTALLATION_STATE_VERSION}"
if [[ "$CONFIGURED_VERSION" == "$EXPECTED_VERSION" ]]; then
  report PASS configured_version "$CONFIGURED_VERSION"
else
  report FAIL configured_version "$CONFIGURED_VERSION"
fi
report PASS installed_commit "$DEVFLOW_INSTALLATION_STATE_COMMIT"

for tuple in backend:backend_image frontend:frontend_image db:db_image edge:nginx_image certbot:certbot_image; do
  service="${tuple%%:*}"; key="${tuple##*:}"
  image="$(compose_service_image_expected "$service" 2>/dev/null || true)"
  if [[ -n "$image" ]] && docker image inspect "$image" >/dev/null 2>&1; then
    report PASS "$key" "$image"
  else
    report FAIL "$key" "${image:-unresolved}"
  fi
done

for tuple in db:db backend:backend frontend:frontend edge:nginx; do
  service="${tuple%%:*}"
  key="${tuple##*:}"
  if [[ "$service" == edge && "$INTERNAL_ONLY" == true ]]; then
    report PASS "$key" skipped-maintenance
    continue
  fi
  container_id="$("${DEVFLOW_COMPOSE[@]}" ps -q "$service" 2>/dev/null || true)"
  health_state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
    "$container_id" 2>/dev/null || true)"
  [[ "$health_state" == healthy ]] \
    && report PASS "$key" healthy || report FAIL "$key" "${health_state:-missing}"
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
[[ -n "$migration" && ( "$ALLOW_PENDING_STATE" == true \
  || "$migration" == "$DEVFLOW_INSTALLATION_STATE_MIGRATION" ) ]] \
  && report PASS migration "$migration" || report FAIL migration "${migration:-missing}"

if "${DEVFLOW_COMPOSE[@]}" exec -T backend node -e \
  "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
  report PASS backend_api healthy
else
  report FAIL backend_api unhealthy
fi
if "${DEVFLOW_COMPOSE[@]}" exec -T frontend wget -q -O /dev/null http://127.0.0.1/healthz; then
  report PASS frontend_http healthy
else
  report FAIL frontend_http unhealthy
fi

if [[ "$INTERNAL_ONLY" == false ]]; then
  http_code="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 20 \
    "http://$DEVFLOW_DOMAIN/" || true)"
  [[ "$http_code" == 301 || "$http_code" == 308 ]] \
    && report PASS external_http redirect-https || report FAIL external_http "$http_code"
  if curl --fail --silent --show-error --max-time 20 "https://$DEVFLOW_DOMAIN/api/health" >/dev/null; then
    report PASS external_https healthy
  else
    report FAIL external_https unhealthy
  fi
  certificate="$DEVFLOW_CERTIFICATE_PATH/live/$DEVFLOW_DOMAIN/fullchain.pem"
  if [[ -r "$certificate" ]] \
    && openssl x509 -in "$certificate" -noout -checkhost "$DEVFLOW_DOMAIN" >/dev/null 2>&1; then
    report PASS certificate valid
  else
    report FAIL certificate invalid
  fi
  if [[ -r "$certificate" ]] && openssl x509 -checkend 2592000 -noout -in "$certificate" >/dev/null 2>&1; then
    report PASS certificate_expiration valid-30-days
  else
    report FAIL certificate_expiration expiring
  fi
  if systemctl is-enabled --quiet devflow-certificate-renewal.timer \
    && systemctl is-active --quiet devflow-certificate-renewal.timer; then
    report PASS certificate_renewal active
  else
    report FAIL certificate_renewal inactive
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
printf '%s\n' \
  'installation_mode=isolated' \
  'external_publication_enabled=true' \
  "external_https_status=$([[ "$INTERNAL_ONLY" == true ]] && echo skipped-internal || echo "$RESULT_EXTERNAL_HTTPS")" \
  "overall_health=$overall"
[[ "$overall" == healthy ]]
