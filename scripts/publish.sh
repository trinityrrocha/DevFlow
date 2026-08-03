#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/proxy-config.sh
. "$SCRIPT_DIR/lib/proxy-config.sh"
# shellcheck source=lib/fullpassword-proxy.sh
. "$SCRIPT_DIR/lib/fullpassword-proxy.sh"
# shellcheck source=providers/provider-contract.sh
. "$SCRIPT_DIR/providers/provider-contract.sh"

MODE=publish
PROVIDER=host-nginx
DOMAIN=
LETSENCRYPT_EMAIL=
HTTP_PORT=18080
API_PORT=13000

usage() {
  cat <<'EOF'
Uso:
  sudo ./scripts/publish.sh --check --provider host-nginx --domain HOST --letsencrypt-email EMAIL
  sudo ./scripts/publish.sh --dry-run --provider host-nginx --domain HOST --letsencrypt-email EMAIL
  sudo ./scripts/publish.sh --provider host-nginx --domain HOST --letsencrypt-email EMAIL

Publica uma instalação interna saudável. Não reinstala a aplicação e não executa migrations.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) MODE=check; shift ;;
    --dry-run) MODE=dry-run; shift ;;
    --provider) PROVIDER="${2:-}"; shift 2 ;;
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --letsencrypt-email|--email) LETSENCRYPT_EMAIL="${2:-}"; shift 2 ;;
    --http-port) HTTP_PORT="${2:-}"; shift 2 ;;
    --api-port) API_PORT="${2:-}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) die "Opção desconhecida: $1" ;;
  esac
done

require_linux
require_root
command -v flock >/dev/null 2>&1 || die 'flock é obrigatório para impedir publicações concorrentes.'
command -v ip >/dev/null 2>&1 || die 'iproute2 é obrigatório para validar o DNS local.'
[[ "$PROVIDER" == host-nginx ]] || die 'Esta versão publica posteriormente somente pelo provider host-nginx.'
validate_domain "$DOMAIN"
validate_email "$LETSENCRYPT_EMAIL"
validate_port "$HTTP_PORT"
validate_port "$API_PORT"
[[ "$HTTP_PORT" != "$API_PORT" ]] || die 'Portas locais devem ser diferentes.'
load_devflow_env
validate_runtime_paths
load_installation_state || die 'Estado de instalação ausente ou inválido.'
[[ "$DEVFLOW_INSTALLATION_STATE_APPLICATION_INSTALLED" == true ]] || die 'A aplicação interna ainda não está instalada.'
[[ "$DEVFLOW_INSTALLATION_STATE_EXTERNAL_ENABLED" == false ]] || die 'A publicação externa já está habilitada.'
[[ "$DEVFLOW_INSTALLATION_STATE_PROVIDER" == "$PROVIDER" ]] || die 'Provider solicitado diverge do provider planejado.'
[[ "${DEVFLOW_HTTP_PORT:-}" == "$HTTP_PORT" && "${DEVFLOW_API_PORT:-}" == "$API_PORT" ]] \
  || die 'Portas solicitadas divergem da instalação interna.'
resolved_addresses="$(getent ahosts "$DOMAIN" | awk '{print $1}' | sort -u)"
[[ -n "$resolved_addresses" ]] || die "O domínio $DOMAIN não resolve no DNS."
local_addresses="$(ip -o addr show scope global 2>/dev/null | awk '{sub(/\/.*/, "", $4); print $4}' | sort -u)"
[[ -n "$local_addresses" ]] || die 'Nenhum endereço global local foi encontrado para validar o DNS.'
dns_matches_host=false
while IFS= read -r resolved_address; do
  grep -Fxq "$resolved_address" <<< "$local_addresses" && dns_matches_host=true
done <<< "$resolved_addresses"
[[ "$dns_matches_host" == true ]] || die "O DNS de $DOMAIN não aponta para um endereço global desta VPS."
"$DEVFLOW_INSTALL_ROOT/app/scripts/health.sh" --internal --quiet \
  || die 'A aplicação interna não está saudável; publicação bloqueada.'

provider_load "$PROVIDER" || die 'Provider de publicação não pode ser carregado.'
host_nginx_select_layout
renewal_hook=/etc/letsencrypt/renewal-hooks/deploy/devflow-nginx-reload
[[ ! -e "$HOST_NGINX_AVAILABLE" && ! -e "$HOST_NGINX_ENABLED" && ! -e "$renewal_hook" ]] \
  || die 'Estado interno diverge: artefatos públicos DevFlow já existem e exigem revisão manual.'
[[ -f "$DEVFLOW_PROVIDER_STATE_FILE" && ! -L "$DEVFLOW_PROVIDER_STATE_FILE" ]] \
  || die 'Estado persistido do provider está ausente ou não é um arquivo regular.'
provider_status=0
provider_dry_run || provider_status=$?
devflow_detect_public_port_ownership
devflow_print_port_evidence 80
devflow_print_port_evidence 443
printf 'public_proxy_status=%s\n' "$DEVFLOW_PUBLIC_PROXY_STATUS"
printf 'internal_installation_ready=true\n'
printf 'external_publication_ready=%s\n' "$DEVFLOW_EXTERNAL_PUBLICATION_READY"
if [[ "$provider_status" -eq 4 ]]; then
  die 'Publicação bloqueada: proxy Docker conhecido exige migração controlada separada.'
elif [[ "$provider_status" -eq 3 ]]; then
  die 'Publicação bloqueada: propriedade de 80/443 não comprovada.'
elif [[ "$provider_status" -ne 0 ]]; then
  die 'Publicação bloqueada pelo provider; nenhuma alteração foi realizada.'
fi
provider_prepare "$DOMAIN" "$HTTP_PORT" "$API_PORT"

cat <<EOF
Plano de publicação externa:
  provider: $PROVIDER
  domínio: $DOMAIN
  frontend interno: http://127.0.0.1:$HTTP_PORT
  backend interno: http://127.0.0.1:$API_PORT
  aplicação e migrations: preservadas
  Full Password: somente leitura e sem integração automática
EOF
[[ "$MODE" == check || "$MODE" == dry-run ]] && {
  printf 'publication_status=ready\nchanges_applied=false\n'
  exit 0
}

require_numeric_confirmation external-publication \
  "A publicação externa do DevFlow em https://$DOMAIN está pronta." \
  'PUBLICAR DEVFLOW'
exec 9>/run/lock/devflow-publish.lock
flock -n 9 || die 'Outra publicação DevFlow está em andamento.'
install -d -m 0750 "$DEVFLOW_LOG_ROOT" "$DEVFLOW_STATE_ROOT" "$DEVFLOW_CONFIG_ROOT/nginx" \
  "$DEVFLOW_INSTALL_ROOT/backups/proxy" "$DEVFLOW_INSTALL_ROOT/storage/acme"
PUBLISH_LOG="$DEVFLOW_LOG_ROOT/publish-$(date -u +%Y%m%dT%H%M%SZ).log"
touch "$PUBLISH_LOG"
chmod 0640 "$PUBLISH_LOG"
exec > >(redact_stream | tee -a "$PUBLISH_LOG") 2>&1

ENV_BACKUP="$(mktemp "$DEVFLOW_STATE_ROOT/.publish-env.XXXXXX")"
STATE_BACKUP="$(mktemp "$DEVFLOW_STATE_ROOT/.publish-state.XXXXXX")"
PROVIDER_STATE_BACKUP="$(mktemp "$DEVFLOW_STATE_ROOT/.publish-provider-state.XXXXXX")"
cp -a -- "$DEVFLOW_ENV_FILE" "$ENV_BACKUP"
cp -a -- "$DEVFLOW_STATE_ROOT/installation.json" "$STATE_BACKUP"
cp -a -- "$DEVFLOW_PROVIDER_STATE_FILE" "$PROVIDER_STATE_BACKUP"
PROVIDER_APPLIED=false
CERTIFICATE_EXISTED_BEFORE=false
[[ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]] && CERTIFICATE_EXISTED_BEFORE=true

publication_failed() {
  local exit_code="${1:-$?}"
  trap - ERR INT TERM HUP
  [[ "$PROVIDER_APPLIED" != true ]] || provider_uninstall >/dev/null 2>&1 || true
  if [[ "$CERTIFICATE_EXISTED_BEFORE" == false && -e "/etc/letsencrypt/live/$DOMAIN" ]]; then
    certbot delete --cert-name "$DOMAIN" --non-interactive >/dev/null 2>&1 || true
  fi
  install -m 0600 "$ENV_BACKUP" "$DEVFLOW_ENV_FILE" || true
  install -m 0640 "$STATE_BACKUP" "$DEVFLOW_STATE_ROOT/installation.json" || true
  install -m 0640 "$PROVIDER_STATE_BACKUP" "$DEVFLOW_PROVIDER_STATE_FILE" || true
  load_devflow_env || true
  DEVFLOW_APP_ROOT="$DEVFLOW_INSTALL_ROOT/app"
  compose_files
  "${DEVFLOW_COMPOSE[@]}" up -d backend --no-deps --wait >/dev/null 2>&1 || true
  rm -f -- "$ENV_BACKUP" "$STATE_BACKUP" "$PROVIDER_STATE_BACKUP"
  log ERROR "Publicação falhou (código $exit_code); estado interno restaurado. Log: $PUBLISH_LOG"
  exit "$exit_code"
}
trap publication_failed ERR
trap 'publication_failed 130' INT
trap 'publication_failed 143' TERM
trap 'publication_failed 129' HUP

provider_install
set_managed_env_value DEVFLOW_DOMAIN "$DOMAIN"
set_managed_env_value LETSENCRYPT_EMAIL "$LETSENCRYPT_EMAIL"
set_managed_env_value APP_ORIGIN "https://$DOMAIN"
load_devflow_env
DEVFLOW_APP_ROOT="$DEVFLOW_INSTALL_ROOT/app"
compose_files
"${DEVFLOW_COMPOSE[@]}" up -d backend --no-deps --wait

PROVIDER_APPLIED=true
provider_activate "$DEVFLOW_INSTALL_ROOT/app" "$DOMAIN" "$LETSENCRYPT_EMAIL" "$HTTP_PORT" "$API_PORT"
provider_validate
provider_health "$DOMAIN" "$HTTP_PORT" "$API_PORT"
curl --fail --silent --show-error --max-time 20 "https://$DOMAIN/api/health" >/dev/null
curl --fail --silent --show-error --max-time 20 "https://$DOMAIN/" >/dev/null

DEVFLOW_RELEASE_COMMIT="$(tr -d '\r\n' < "$DEVFLOW_INSTALL_ROOT/app/.devflow-release")"
DEVFLOW_RELEASE_REF="$(installation_state_value ref "$STATE_BACKUP")"
DEVFLOW_REPOSITORY_URL='https://github.com/trinityrrocha/DevFlow.git'
DEVFLOW_UPDATE_CHANNEL=main
DEVFLOW_INSTALLATION_SCOPE=complete
DEVFLOW_APPLICATION_INSTALLED=true
DEVFLOW_EXTERNAL_PUBLICATION_ENABLED=true
DEVFLOW_INFRASTRUCTURE_PROVIDER="$PROVIDER"
DEVFLOW_FRONTEND_URL="https://$DOMAIN"
DEVFLOW_BACKEND_URL="https://$DOMAIN/api"
DEVFLOW_PROXY_MIGRATION_REQUIRED=false
DEVFLOW_FULLPASSWORD_MODIFIED=false
DEVFLOW_PUBLIC_PROXY_MODIFIED=true
DEVFLOW_PROXY_MIGRATION_EXECUTED=false
DEVFLOW_CERTIFICATE_ISSUED=true
[[ "$CERTIFICATE_EXISTED_BEFORE" == true ]] && DEVFLOW_CERTIFICATE_ISSUED=false
DEVFLOW_MIGRATION_VERSION="$("${DEVFLOW_COMPOSE[@]}" exec -T db sh -c \
  'psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT version FROM schema_migrations ORDER BY applied_at DESC LIMIT 1"')"
export DEVFLOW_RELEASE_COMMIT DEVFLOW_RELEASE_REF DEVFLOW_REPOSITORY_URL DEVFLOW_UPDATE_CHANNEL \
  DEVFLOW_INSTALLATION_SCOPE DEVFLOW_APPLICATION_INSTALLED DEVFLOW_EXTERNAL_PUBLICATION_ENABLED \
  DEVFLOW_INFRASTRUCTURE_PROVIDER DEVFLOW_FRONTEND_URL DEVFLOW_BACKEND_URL \
  DEVFLOW_PROXY_MIGRATION_REQUIRED DEVFLOW_FULLPASSWORD_MODIFIED DEVFLOW_PUBLIC_PROXY_MODIFIED \
  DEVFLOW_PROXY_MIGRATION_EXECUTED DEVFLOW_CERTIFICATE_ISSUED DEVFLOW_MIGRATION_VERSION
provider_state_write "$PROVIDER" "$DOMAIN" "$HTTP_PORT" "$API_PORT"
write_install_report published
trap - ERR INT TERM HUP
rm -f -- "$ENV_BACKUP" "$STATE_BACKUP" "$PROVIDER_STATE_BACKUP"
log INFO "DevFlow publicado em https://$DOMAIN sem reinstalação ou migrations."
