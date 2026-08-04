#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/fullpassword-proxy.sh
. "$SCRIPT_DIR/lib/fullpassword-proxy.sh"
# shellcheck source=lib/proxy-config.sh
. "$SCRIPT_DIR/lib/proxy-config.sh"
# shellcheck source=providers/provider-contract.sh
. "$SCRIPT_DIR/providers/provider-contract.sh"
# shellcheck source=lib/compose-images.sh
. "$SCRIPT_DIR/lib/compose-images.sh"

INTERNAL_ONLY=false
QUIET=false
ALLOW_PENDING_VERSION="${DEVFLOW_HEALTH_ALLOW_PENDING_VERSION:-false}"
[[ "$ALLOW_PENDING_VERSION" == true || "$ALLOW_PENDING_VERSION" == false ]] \
  || { echo 'DEVFLOW_HEALTH_ALLOW_PENDING_VERSION inválido.' >&2; exit 1; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --internal) INTERNAL_ONLY=true; shift ;;
    --quiet) QUIET=true; shift ;;
    --help|-h)
      echo 'Uso: sudo scripts/health.sh [--internal] [--quiet]'
      exit 0
      ;;
    *) die "Opção desconhecida: $1" ;;
  esac
done

require_linux
require_root
load_devflow_env
validate_runtime_paths
EXTERNAL_PUBLICATION_ENABLED=false
EXTERNAL_PUBLICATION_STATE_CLAIM=false
EXTERNAL_PUBLICATION_TRANSACTION_VALID=false
INSTALLATION_SCOPE=complete
INSTALLATION_STATE_HEALTH=degraded
REPAIR_AVAILABLE=false
INSTALLED_STATE_PRESENT=false
INSTALLED_STATE_SCHEMA_VALID=false
INSTALLED_STATE_VERSION_MATCH=false
INSTALLED_STATE_COMMIT_MATCH=false
INSTALLED_STATE_SOURCE_COMMIT_MATCH=false
if validate_installed_state_consistency "$DEVFLOW_STATE_ROOT/installation.json"; then
  INSTALLATION_STATE_HEALTH=healthy
  EXTERNAL_PUBLICATION_STATE_CLAIM="$DEVFLOW_INSTALLATION_STATE_EXTERNAL_ENABLED"
  INSTALLATION_SCOPE="$DEVFLOW_INSTALLATION_STATE_SCOPE"
  if [[ "$EXTERNAL_PUBLICATION_STATE_CLAIM" == true ]]; then
    publication_transaction="$DEVFLOW_STATE_ROOT/publication-transaction.json"
    if [[ "$(installation_state_value status "$publication_transaction" 2>/dev/null || true)" == completed \
      && "$(installation_state_value domain "$publication_transaction" 2>/dev/null || true)" == "$DEVFLOW_INSTALLATION_STATE_DOMAIN" \
      && "$(installation_state_value provider "$publication_transaction" 2>/dev/null || true)" == "$DEVFLOW_INSTALLATION_STATE_PROVIDER" \
      && "$DEVFLOW_INSTALLATION_STATE_CERTIFICATE_ISSUED" == true ]]; then
      EXTERNAL_PUBLICATION_TRANSACTION_VALID=true
      EXTERNAL_PUBLICATION_ENABLED=true
    else
      INSTALLATION_STATE_HEALTH=degraded
      REPAIR_AVAILABLE=false
      INTERNAL_ONLY=true
    fi
  else
    INTERNAL_ONLY=true
  fi
else
  INTERNAL_ONLY=true
fi
provider_resolve_installed
provider_load "$DEVFLOW_INFRASTRUCTURE_PROVIDER" || die 'Provider instalado nao pode ser carregado.'
CONFIGURED_VERSION="${DEVFLOW_VERSION:-unknown}"
DEVFLOW_APP_ROOT="${DEVFLOW_APP_ROOT:-$DEVFLOW_INSTALL_ROOT/app}"
[[ -r "$DEVFLOW_APP_ROOT/docker-compose.yml" ]] || die 'Release DevFlow não encontrada.'
EXPECTED_VERSION="${DEVFLOW_EXPECTED_VERSION:-$(devflow_read_version_file "$DEVFLOW_APP_ROOT/VERSION" 2>/dev/null || printf '%s' "$DEVFLOW_VERSION")}"
devflow_semver_is_valid "$EXPECTED_VERSION" || die 'Versão esperada inválida.'
export DEVFLOW_VERSION="$EXPECTED_VERSION"
compose_files
RUNTIME_IDENTITY_VALID=false
reconcile_installed_release_runtime && RUNTIME_IDENTITY_VALID=true
if [[ "$RUNTIME_IDENTITY_VALID" != true ]]; then
  INSTALLATION_STATE_HEALTH=degraded
  REPAIR_AVAILABLE=false
fi

PROVIDER_READY=false
PROXY_READY=false
PUBLICATION_READY=false
PUBLIC_API_READY=false
PUBLIC_FRONTEND_READY=false
CERTIFICATE_READY=false
RENEWAL_READY=false
ROLLBACK_READY=false
RELEASE_IDENTITY_VALID="$RUNTIME_IDENTITY_VALID"
INSTALLATION_STATE_VALID=false
[[ "$INSTALLATION_STATE_HEALTH" == healthy ]] && INSTALLATION_STATE_VALID=true
PROXY_MODE_VALID=false
[[ "$DEVFLOW_PROXY_MODE" == isolated || "$DEVFLOW_PROXY_MODE" == shared ]] && PROXY_MODE_VALID=true
HOST_NGINX_VALID=false
SHARED_ADAPTER_VALID=false
if [[ "$DEVFLOW_PROXY_MODE" == shared && "$DEVFLOW_INFRASTRUCTURE_PROVIDER" == host-nginx \
  && "${DEVFLOW_SHARED_PROXY_ADAPTER:-host-nginx}" == host-nginx ]]; then
  SHARED_ADAPTER_VALID=true
elif [[ "$DEVFLOW_PROXY_MODE" == isolated && "$DEVFLOW_INFRASTRUCTURE_PROVIDER" == isolated-nginx ]]; then
  SHARED_ADAPTER_VALID=true
fi

failures=0
INTERNAL_FRONTEND_HEALTHY=true
INTERNAL_BACKEND_HEALTHY=true
DATABASE_HEALTHY=true
MIGRATIONS_CURRENT=true
BACKEND_IMAGE_PRESENT=true
FRONTEND_IMAGE_PRESENT=true
POSTGRES_IMAGE_PRESENT=true
report() {
  local state="$1" item="$2" detail="${3:-}"
  [[ "$state" == PASS ]] || failures=$((failures + 1))
  [[ "$QUIET" == true ]] || printf '%-4s %-18s %s\n' "$state" "$item" "$detail"
}

if [[ "$INSTALLATION_STATE_HEALTH" == healthy ]]; then
  report PASS installation_state healthy
else
  report FAIL installation_state degraded
fi

if [[ "$CONFIGURED_VERSION" == "$EXPECTED_VERSION" ]]; then
  report PASS configured_version "$CONFIGURED_VERSION"
elif [[ "$ALLOW_PENDING_VERSION" == true ]]; then
  report PASS configured_version "promoção pendente: $CONFIGURED_VERSION -> $EXPECTED_VERSION"
else
  report FAIL configured_version "$CONFIGURED_VERSION != $EXPECTED_VERSION"
fi

for image_tuple in backend:BACKEND_IMAGE_PRESENT frontend:FRONTEND_IMAGE_PRESENT db:POSTGRES_IMAGE_PRESENT; do
  image_service="${image_tuple%%:*}"
  image_status_variable="${image_tuple##*:}"
  image_resolution_status=0
  resolved_image="$(resolve_compose_service_image "$image_service")" || image_resolution_status=$?
  if [[ "$image_resolution_status" -eq 0 ]]; then
    report PASS "${image_service}_image" "$resolved_image"
  elif [[ "$image_resolution_status" -eq 20 || "$image_resolution_status" -eq 21 ]]; then
    printf -v "$image_status_variable" '%s' false
    report FAIL compose_config 'renderização inválida; resolução de imagens interrompida'
    break
  else
    printf -v "$image_status_variable" '%s' false
    report FAIL "${image_service}_image" 'imagem resolvida ausente'
  fi
done

for service in db backend frontend; do
  container_id="$("${DEVFLOW_COMPOSE[@]}" ps -q "$service" 2>/dev/null || true)"
  if [[ -z "$container_id" ]]; then
    report FAIL "$service" 'container ausente'
    [[ "$service" == frontend ]] && INTERNAL_FRONTEND_HEALTHY=false
    [[ "$service" == backend ]] && INTERNAL_BACKEND_HEALTHY=false
    [[ "$service" == db ]] && DATABASE_HEALTHY=false
    continue
  fi
  health_state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
  if [[ "$health_state" == healthy ]]; then
    report PASS "$service" healthy
  else
    report FAIL "$service" "$health_state"
    [[ "$service" == frontend ]] && INTERNAL_FRONTEND_HEALTHY=false
    [[ "$service" == backend ]] && INTERNAL_BACKEND_HEALTHY=false
    [[ "$service" == db ]] && DATABASE_HEALTHY=false
  fi
done

db_networks="$(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{println}}{{end}}' \
  "$("${DEVFLOW_COMPOSE[@]}" ps -q db 2>/dev/null || true)" 2>/dev/null || true)"
if grep -Fxq "$DEVFLOW_EDGE_NETWORK" <<< "$db_networks"; then
  report FAIL network_boundary 'PostgreSQL conectado indevidamente à devflow_edge'
else
  report PASS network_boundary 'PostgreSQL isolado da rede de borda'
fi

if "${DEVFLOW_COMPOSE[@]}" exec -T db sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; then
  report PASS database 'accepting connections'
else
  report FAIL database 'pg_isready falhou'
  DATABASE_HEALTHY=false
fi

migration="$("${DEVFLOW_COMPOSE[@]}" exec -T db sh -c \
  'psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT version FROM schema_migrations ORDER BY applied_at DESC LIMIT 1"' \
  2>/dev/null || true)"
if [[ -n "$migration" ]]; then
  report PASS migration "$migration"
else
  report FAIL migration 'não confirmada'
  MIGRATIONS_CURRENT=false
fi

if "${DEVFLOW_COMPOSE[@]}" exec -T -e "DEVFLOW_EXPECTED_VERSION=$EXPECTED_VERSION" backend node -e \
  "fetch('http://127.0.0.1:3000/api/health').then(async r=>{const d=await r.json();if(!r.ok||d.version!==process.env.DEVFLOW_EXPECTED_VERSION)process.exit(1)}).catch(()=>process.exit(1))"; then
  report PASS backend_api "$EXPECTED_VERSION"
else
  report FAIL backend_api 'versão ou resposta inválida'
  INTERNAL_BACKEND_HEALTHY=false
fi

if "${DEVFLOW_COMPOSE[@]}" exec -T frontend wget -q -O /dev/null http://127.0.0.1/healthz; then
  report PASS frontend_http '/healthz'
else
  report FAIL frontend_http '/healthz indisponível'
  INTERNAL_FRONTEND_HEALTHY=false
fi

if [[ "$INTERNAL_ONLY" == false ]]; then
  if curl --fail --silent --show-error --max-time 20 "https://${DEVFLOW_DOMAIN}/api/health" >/dev/null; then
    PUBLIC_API_READY=true
    report PASS public_api "https://${DEVFLOW_DOMAIN}/api/health"
  else
    report FAIL public_api 'indisponível'
  fi
  if curl --fail --silent --show-error --max-time 20 "https://${DEVFLOW_DOMAIN}/" >/dev/null; then
    PUBLIC_FRONTEND_READY=true
    report PASS public_frontend "https://${DEVFLOW_DOMAIN}/"
  else
    report FAIL public_frontend 'indisponível'
  fi
  if [[ "$DEVFLOW_PROXY_MODE" == shared ]]; then
    if [[ "$DEVFLOW_INFRASTRUCTURE_PROVIDER" == legacy-docker-nginx ]]; then
      docker exec "$FULLPASSWORD_CONTAINER" nginx -t >/dev/null 2>&1 \
        && report PASS proxy 'fullpassword_nginx nginx -t' || report FAIL proxy 'fullpassword_nginx nginx -t falhou'
      docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{println}}{{end}}' "$FULLPASSWORD_CONTAINER" \
        | grep -Fxq "$DEVFLOW_EDGE_NETWORK" \
        && report PASS proxy_network "$DEVFLOW_EDGE_NETWORK" || report FAIL proxy_network "$DEVFLOW_EDGE_NETWORK ausente"
      fullpassword_public_health \
        && report PASS fullpassword "https://$FULLPASSWORD_ORIGINAL_DOMAIN" \
        || report FAIL fullpassword "https://$FULLPASSWORD_ORIGINAL_DOMAIN indisponível"
    else
      if provider_health "$DEVFLOW_DOMAIN" "${DEVFLOW_HTTP_PORT:-18080}" "${DEVFLOW_API_PORT:-13000}"; then
        PROVIDER_READY=true
        PROXY_READY=true
        HOST_NGINX_VALID=true
        report PASS provider "$DEVFLOW_INFRASTRUCTURE_PROVIDER"
      else
        report FAIL provider "$DEVFLOW_INFRASTRUCTURE_PROVIDER"
      fi
    fi
  else
    edge_id="$("${DEVFLOW_COMPOSE[@]}" ps -q edge 2>/dev/null || true)"
    edge_state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$edge_id" 2>/dev/null || true)"
    if [[ "$edge_state" == healthy ]]; then
      PROVIDER_READY=true
      PROXY_READY=true
      report PASS proxy "edge $edge_state"
    else
      report FAIL proxy "edge $edge_state"
    fi
  fi

  if [[ "$DEVFLOW_INFRASTRUCTURE_PROVIDER" == host-nginx ]]; then
    if [[ -r "/etc/letsencrypt/live/$DEVFLOW_DOMAIN/fullchain.pem" ]] \
    && openssl x509 -in "/etc/letsencrypt/live/$DEVFLOW_DOMAIN/fullchain.pem" -noout -checkhost "$DEVFLOW_DOMAIN" >/dev/null 2>&1; then
      CERTIFICATE_READY=true
      report PASS certificate valid
    else
      report FAIL certificate invalid
    fi
    if [[ -r "/etc/letsencrypt/renewal/$DEVFLOW_DOMAIN.conf" \
      && -x /etc/letsencrypt/renewal-hooks/deploy/devflow-nginx-reload ]] \
      && systemctl is-enabled --quiet certbot.timer \
      && systemctl is-active --quiet certbot.timer; then
      RENEWAL_READY=true
      report PASS renewal automatic
    else
      report FAIL renewal unavailable
    fi
    publication_transaction="$DEVFLOW_STATE_ROOT/publication-transaction.json"
    publication_backup="$(installation_state_value backupDirectory "$publication_transaction" 2>/dev/null || true)"
    if [[ "$(installation_state_value status "$publication_transaction" 2>/dev/null || true)" == completed \
      && "$publication_backup" == "$DEVFLOW_STATE_ROOT/publication-backups/"* \
      && -f "$publication_backup/devflow.env" \
      && -f "$publication_backup/installation.json" \
      && -f "$publication_backup/infrastructure-provider.json" ]]; then
      ROLLBACK_READY=true
      report PASS publication_rollback "$publication_backup"
    else
      report FAIL publication_rollback unavailable
    fi
  elif [[ "$failures" -eq 0 ]]; then
    CERTIFICATE_READY=true
    RENEWAL_READY=true
    ROLLBACK_READY=true
  fi
  if [[ "$PROVIDER_READY" == true && "$PROXY_READY" == true && "$CERTIFICATE_READY" == true \
    && "$RENEWAL_READY" == true && "$ROLLBACK_READY" == true \
    && "$PUBLIC_API_READY" == true && "$PUBLIC_FRONTEND_READY" == true ]]; then
    PUBLICATION_READY=true
  fi
fi

if [[ "$failures" -gt 0 ]]; then
  if [[ "$QUIET" == false ]]; then
    printf 'internal_frontend_healthy=%s\n' "$INTERNAL_FRONTEND_HEALTHY"
    printf 'internal_backend_healthy=%s\n' "$INTERNAL_BACKEND_HEALTHY"
    printf 'database_healthy=%s\n' "$DATABASE_HEALTHY"
    printf 'migrations_current=%s\n' "$MIGRATIONS_CURRENT"
    printf 'backend_image_present=%s\n' "$BACKEND_IMAGE_PRESENT"
    printf 'frontend_image_present=%s\n' "$FRONTEND_IMAGE_PRESENT"
    printf 'postgres_image_present=%s\n' "$POSTGRES_IMAGE_PRESENT"
    printf 'external_publication_enabled=%s\n' "$EXTERNAL_PUBLICATION_ENABLED"
    printf 'external_publication_state_claim=%s\n' "$EXTERNAL_PUBLICATION_STATE_CLAIM"
    printf 'external_publication_transaction_valid=%s\n' "$EXTERNAL_PUBLICATION_TRANSACTION_VALID"
    printf 'installed_state_present=%s\n' "$INSTALLED_STATE_PRESENT"
    printf 'installed_state_schema_valid=%s\n' "$INSTALLED_STATE_SCHEMA_VALID"
    printf 'installed_state_version_match=%s\n' "$INSTALLED_STATE_VERSION_MATCH"
    printf 'installed_state_commit_match=%s\n' "$INSTALLED_STATE_COMMIT_MATCH"
    printf 'source_commit_match=%s\n' "$INSTALLED_STATE_SOURCE_COMMIT_MATCH"
    printf 'backend_image_commit_match=%s\n' "$BACKEND_IMAGE_COMMIT_MATCH"
    printf 'frontend_image_commit_match=%s\n' "$FRONTEND_IMAGE_COMMIT_MATCH"
    printf 'installation_state_health=%s\n' "$INSTALLATION_STATE_HEALTH"
    printf 'repair_available=%s\n' "$REPAIR_AVAILABLE"
    printf 'provider_ready=%s\n' "$PROVIDER_READY"
    printf 'proxy_ready=%s\n' "$PROXY_READY"
    printf 'publication_ready=%s\n' "$PUBLICATION_READY"
    printf 'certificate_ready=%s\n' "$CERTIFICATE_READY"
    printf 'renewal_ready=%s\n' "$RENEWAL_READY"
    printf 'rollback_ready=%s\n' "$ROLLBACK_READY"
    printf 'release_identity_valid=%s\n' "$RELEASE_IDENTITY_VALID"
    printf 'installation_state_valid=%s\n' "$INSTALLATION_STATE_VALID"
    printf 'proxy_mode_valid=%s\n' "$PROXY_MODE_VALID"
    printf 'host_nginx_valid=%s\n' "$HOST_NGINX_VALID"
    printf 'shared_adapter_valid=%s\n' "$SHARED_ADAPTER_VALID"
    [[ "$CERTIFICATE_READY" == true ]] && printf 'certificate_status=valid\n' || printf 'certificate_status=invalid\n'
    [[ "$RENEWAL_READY" == true ]] && printf 'renewal_status=healthy\n' || printf 'renewal_status=unhealthy\n'
    [[ "$EXTERNAL_PUBLICATION_ENABLED" == true ]] \
      && printf 'external_https_status=failed\n' || printf 'external_https_status=not-configured\n'
    printf 'overall_internal_health=unhealthy\n'
    printf 'overall_health=unhealthy\n'
    printf 'health_status=unhealthy failures=%s\n' "$failures"
  fi
  exit 1
fi
if [[ "$QUIET" == false ]]; then
  printf 'internal_frontend_healthy=true\n'
  printf 'internal_backend_healthy=true\n'
  printf 'database_healthy=true\n'
  printf 'migrations_current=true\n'
  printf 'backend_image_present=true\n'
  printf 'frontend_image_present=true\n'
  printf 'postgres_image_present=true\n'
  printf 'external_publication_enabled=%s\n' "$EXTERNAL_PUBLICATION_ENABLED"
  printf 'external_publication_state_claim=%s\n' "$EXTERNAL_PUBLICATION_STATE_CLAIM"
  printf 'external_publication_transaction_valid=%s\n' "$EXTERNAL_PUBLICATION_TRANSACTION_VALID"
  printf 'installed_state_present=%s\n' "$INSTALLED_STATE_PRESENT"
  printf 'installed_state_schema_valid=%s\n' "$INSTALLED_STATE_SCHEMA_VALID"
  printf 'installed_state_version_match=%s\n' "$INSTALLED_STATE_VERSION_MATCH"
  printf 'installed_state_commit_match=%s\n' "$INSTALLED_STATE_COMMIT_MATCH"
  printf 'source_commit_match=%s\n' "$INSTALLED_STATE_SOURCE_COMMIT_MATCH"
  printf 'backend_image_commit_match=%s\n' "$BACKEND_IMAGE_COMMIT_MATCH"
  printf 'frontend_image_commit_match=%s\n' "$FRONTEND_IMAGE_COMMIT_MATCH"
  printf 'installation_state_health=%s\n' "$INSTALLATION_STATE_HEALTH"
  printf 'repair_available=%s\n' "$REPAIR_AVAILABLE"
  printf 'provider_ready=%s\n' "$PROVIDER_READY"
  printf 'proxy_ready=%s\n' "$PROXY_READY"
  printf 'publication_ready=%s\n' "$PUBLICATION_READY"
  printf 'certificate_ready=%s\n' "$CERTIFICATE_READY"
  printf 'renewal_ready=%s\n' "$RENEWAL_READY"
  printf 'rollback_ready=%s\n' "$ROLLBACK_READY"
  printf 'release_identity_valid=%s\n' "$RELEASE_IDENTITY_VALID"
  printf 'installation_state_valid=%s\n' "$INSTALLATION_STATE_VALID"
  printf 'proxy_mode_valid=%s\n' "$PROXY_MODE_VALID"
  printf 'host_nginx_valid=%s\n' "$HOST_NGINX_VALID"
  printf 'shared_adapter_valid=%s\n' "$SHARED_ADAPTER_VALID"
  [[ "$CERTIFICATE_READY" == true ]] && printf 'certificate_status=valid\n' || printf 'certificate_status=not-configured\n'
  [[ "$RENEWAL_READY" == true ]] && printf 'renewal_status=healthy\n' || printf 'renewal_status=not-configured\n'
  [[ "$EXTERNAL_PUBLICATION_ENABLED" == true ]] \
    && printf 'external_https_status=healthy\n' || printf 'external_https_status=not-configured\n'
  printf 'overall_internal_health=healthy\n'
  printf 'overall_health=healthy\n'
  printf 'health_status=healthy version=%s migration=%s scope=%s\n' "$EXPECTED_VERSION" "$migration" "$INSTALLATION_SCOPE"
fi
