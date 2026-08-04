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
# shellcheck source=lib/compose-images.sh
. "$SCRIPT_DIR/lib/compose-images.sh"

MODE=check
MODE_SELECTED=false
PROVIDER=host-nginx
DOMAIN=
LETSENCRYPT_EMAIL=
HTTP_PORT=18080
API_PORT=13000
PUBLICATION_TRANSACTION_FILE="$DEVFLOW_STATE_ROOT/publication-transaction.json"

usage() {
  cat <<'EOF'
Uso:
  sudo ./scripts/publish.sh --check --provider host-nginx --domain HOST [--letsencrypt-email EMAIL]
  sudo ./scripts/publish.sh --dry-run --provider host-nginx --domain HOST --letsencrypt-email EMAIL
  sudo ./scripts/publish.sh --publish --provider host-nginx --domain HOST --letsencrypt-email EMAIL
  sudo ./scripts/publish.sh --rollback

Sem modo explícito, executa somente --check. Publicação e rollback nunca executam migrations.
EOF
}

select_mode() {
  [[ "$MODE_SELECTED" == false ]] || die 'Informe somente um modo de publicação.'
  MODE="$1"
  MODE_SELECTED=true
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) select_mode check; shift ;;
    --dry-run) select_mode dry-run; shift ;;
    --publish) select_mode publish; shift ;;
    --rollback) select_mode rollback; shift ;;
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
for command_name in flock curl git ip openssl python3; do
  command -v "$command_name" >/dev/null 2>&1 || die "Comando obrigatório ausente: $command_name"
done
exec 8>/run/lock/devflow-release-reconcile.lock
flock -n 8 || die 'Reconciliação da release instalada em andamento; publicação bloqueada.'
exec 9>/run/lock/devflow-publish.lock
flock -n 9 || die 'Outra operação de publicação DevFlow está em andamento.'

load_devflow_env
validate_runtime_paths
[[ "$DEVFLOW_INSTALL_ROOT" == /opt/devflow ]] || die 'Diretório instalado inesperado.'

write_publication_transaction() {
  local status="$1" backup_directory="$2" certificate_created="$3" transaction_domain="$4" temporary
  install -d -m 0750 "$DEVFLOW_STATE_ROOT"
  temporary="$(mktemp "$DEVFLOW_STATE_ROOT/.publication-transaction.XXXXXX")"
  {
    printf '{\n'
    printf '  "schemaVersion": 1,\n'
    printf '  "status": "%s",\n' "$status"
    printf '  "domain": "%s",\n' "$transaction_domain"
    printf '  "provider": "host-nginx",\n'
    printf '  "backupDirectory": "%s",\n' "$backup_directory"
    printf '  "certificateCreated": %s\n' "$certificate_created"
    printf '}\n'
  } > "$temporary"
  chmod 0600 "$temporary"
  python3 -m json.tool "$temporary" >/dev/null
  mv -f -- "$temporary" "$PUBLICATION_TRANSACTION_FILE"
}

restore_publication() {
  local backup_directory transaction_domain certificate_created failures=0
  [[ -f "$PUBLICATION_TRANSACTION_FILE" && ! -L "$PUBLICATION_TRANSACTION_FILE" ]] || {
    log ERROR 'Transação de publicação ausente; rollback fail-closed.'; return 1;
  }
  backup_directory="$(installation_state_value backupDirectory "$PUBLICATION_TRANSACTION_FILE")"
  transaction_domain="$(installation_state_value domain "$PUBLICATION_TRANSACTION_FILE")"
  certificate_created="$(installation_state_value certificateCreated "$PUBLICATION_TRANSACTION_FILE")"
  [[ "$backup_directory" == "$DEVFLOW_STATE_ROOT/publication-backups/"* && -d "$backup_directory" && ! -L "$backup_directory" ]] \
    || { log ERROR 'Diretório de rollback inválido.'; return 1; }
  validate_domain "$transaction_domain"
  [[ "$certificate_created" == true || "$certificate_created" == false ]] || return 1
  for backup_name in devflow.env installation.json infrastructure-provider.json; do
    [[ -f "$backup_directory/$backup_name" && ! -L "$backup_directory/$backup_name" ]] \
      || { log ERROR "Backup obrigatório ausente: $backup_name"; return 1; }
  done

  set +e
  provider_load host-nginx
  provider_uninstall
  [[ $? -eq 0 ]] || failures=$((failures + 1))
  if [[ "$certificate_created" == true && -e "/etc/letsencrypt/live/$transaction_domain" ]]; then
    certbot delete --cert-name "$transaction_domain" --non-interactive >/dev/null 2>&1
    [[ $? -eq 0 ]] || failures=$((failures + 1))
  fi
  install -m 0600 "$backup_directory/devflow.env" "$DEVFLOW_ENV_FILE"
  [[ $? -eq 0 ]] || failures=$((failures + 1))
  install -m 0600 "$backup_directory/installation.json" "$DEVFLOW_STATE_ROOT/installation.json"
  [[ $? -eq 0 ]] || failures=$((failures + 1))
  install -m 0640 "$backup_directory/infrastructure-provider.json" "$DEVFLOW_PROVIDER_STATE_FILE"
  [[ $? -eq 0 ]] || failures=$((failures + 1))
  nginx -t >/dev/null 2>&1 && systemctl reload nginx >/dev/null 2>&1
  [[ $? -eq 0 ]] || failures=$((failures + 1))
  load_devflow_env
  DEVFLOW_APP_ROOT="$DEVFLOW_INSTALL_ROOT/app"
  compose_files
  "${DEVFLOW_COMPOSE[@]}" up -d backend --no-deps --wait >/dev/null 2>&1
  [[ $? -eq 0 ]] || failures=$((failures + 1))
  DEVFLOW_APP_ROOT="$DEVFLOW_INSTALL_ROOT/app" "$DEVFLOW_INSTALL_ROOT/app/scripts/health.sh" --internal --quiet
  [[ $? -eq 0 ]] || failures=$((failures + 1))
  if [[ "$failures" -eq 0 ]]; then
    write_publication_transaction rolled-back "$backup_directory" "$certificate_created" "$transaction_domain"
    log WARN "Rollback da publicação concluído; domínio removido: $transaction_domain"
  else
    write_publication_transaction rollback-failed "$backup_directory" "$certificate_created" "$transaction_domain" || true
    log ERROR "Rollback terminou com $failures falha(s); preserve os backups em $backup_directory"
  fi
  set -e
  [[ "$failures" -eq 0 ]]
}

if [[ "$MODE" == rollback ]]; then
  require_numeric_confirmation external-publication-rollback \
    'O rollback removerá somente os artefatos da última publicação DevFlow e restaurará o estado interno.' \
    'REVERTER PUBLICAÇÃO'
  restore_publication
  exit 0
fi

[[ "$PROVIDER" == host-nginx ]] || die 'A publicação compartilhada suporta somente o provider host-nginx.'
validate_domain "$DOMAIN"
[[ -z "$LETSENCRYPT_EMAIL" ]] || validate_email "$LETSENCRYPT_EMAIL"
[[ "$MODE" != publish && "$MODE" != dry-run ]] || validate_email "$LETSENCRYPT_EMAIL"
validate_port "$HTTP_PORT"
validate_port "$API_PORT"
[[ "$HTTP_PORT" != "$API_PORT" ]] || die 'Portas locais devem ser diferentes.'

validate_installed_state_consistency "$DEVFLOW_STATE_ROOT/installation.json" \
  || die 'Estado de instalação inconsistente; execute repair-installation-state.sh antes de publicar.'
[[ "$DEVFLOW_INSTALLATION_STATE_APPLICATION_INSTALLED" == true \
  && "$DEVFLOW_INSTALLATION_STATE_APPLICATION_HEALTHY" == true ]] \
  || die 'A aplicação interna não está instalada e saudável.'
[[ "$DEVFLOW_INSTALLATION_STATE_EXTERNAL_ENABLED" == false ]] || die 'A publicação externa já está habilitada.'
[[ "$DEVFLOW_INSTALLATION_STATE_PROVIDER" == "$PROVIDER" ]] || die 'Provider solicitado diverge do estado instalado.'
[[ "$DEVFLOW_INSTALLATION_STATE_PROXY_MODE" == shared ]] || die 'Publicação compartilhada exige proxyMode=shared.'
[[ "${DEVFLOW_HTTP_PORT:-}" == "$HTTP_PORT" && "${DEVFLOW_API_PORT:-}" == "$API_PORT" ]] \
  || die 'Portas solicitadas divergem da instalação interna.'

DEVFLOW_VERSION="$INSTALLED_VERSION"
DEVFLOW_RELEASE_COMMIT="$INSTALLED_COMMIT"
DEVFLOW_APP_ROOT="$DEVFLOW_INSTALL_ROOT/app"
export DEVFLOW_VERSION DEVFLOW_RELEASE_COMMIT DEVFLOW_APP_ROOT
compose_files
reconcile_installed_release_runtime \
  || die 'Identidade, imagens ou API divergem da fonte canônica /opt/devflow/source.'
"$DEVFLOW_INSTALL_ROOT/app/scripts/health.sh" --internal --quiet \
  || die 'Health interno falhou; publicação bloqueada.'

resolved_addresses="$(getent ahosts "$DOMAIN" | awk '{print $1}' | sort -u)"
local_addresses="$(ip -o addr show scope global 2>/dev/null | awk '{sub(/\/.*/, "", $4); print $4}' | sort -u)"
[[ -n "$resolved_addresses" && -n "$local_addresses" ]] || die 'DNS ou endereços locais não puderam ser comprovados.'
dns_matches_host=false
while IFS= read -r address; do
  grep -Fxq "$address" <<< "$local_addresses" && dns_matches_host=true
done <<< "$resolved_addresses"
[[ "$dns_matches_host" == true ]] || die "O DNS de $DOMAIN não aponta para esta VPS."

provider_load "$PROVIDER" || die 'Provider de publicação não pode ser carregado.'
host_nginx_select_layout
renewal_hook=/etc/letsencrypt/renewal-hooks/deploy/devflow-nginx-reload
[[ ! -e "$HOST_NGINX_AVAILABLE" && ! -e "$HOST_NGINX_ENABLED" && ! -e "$renewal_hook" ]] \
  || die 'Artefatos públicos DevFlow já existem fora de uma publicação registrada.'
[[ -f "$DEVFLOW_PROVIDER_STATE_FILE" && ! -L "$DEVFLOW_PROVIDER_STATE_FILE" ]] \
  || die 'Estado persistido do provider está ausente ou inseguro.'

provider_status=0
provider_dry_run || provider_status=$?
devflow_detect_public_port_ownership
devflow_print_port_evidence 80
devflow_print_port_evidence 443
printf 'public_proxy_status=%s\n' "$DEVFLOW_PUBLIC_PROXY_STATUS"
case "$provider_status" in
  0) ;;
  4) die 'Proxy Docker conhecido ocupa 80/443; execute primeiro a migração controlada para Nginx do host.' ;;
  3) die 'Propriedade de 80/443 não pôde ser comprovada.' ;;
  *) die 'Provider host-nginx bloqueou a publicação sem aplicar alterações.' ;;
esac
provider_prepare "$DOMAIN" "$HTTP_PORT" "$API_PORT"

template="$DEVFLOW_INSTALL_ROOT/app/docker/nginx/host-shared.conf.template"
for evidence in 'proxy_set_header Upgrade' 'Content-Security-Policy' 'Strict-Transport-Security' \
  'limit_req zone=devflow_api' 'proxy_request_buffering off' 'proxy_buffering off' \
  'proxy_send_timeout 1800s' 'proxy_read_timeout 1800s' 'gzip on'; do
  grep -Fq "$evidence" "$template" || die "Vhost sem evidência obrigatória: $evidence"
done
certbot_capability=available
command -v certbot >/dev/null 2>&1 || certbot_capability=will-install-from-distribution
[[ "$certbot_capability" == available || -x /usr/bin/apt-get ]] || die 'Certbot não está disponível nem pode ser instalado pelo provider aprovado.'
[[ -w "$DEVFLOW_STATE_ROOT" ]] || die 'Estado não permite criar backup transacional de rollback.'

printf '%s\n' \
  'dns_ready=true' \
  'port_80_ready=true' \
  'port_443_ready=true' \
  'provider_ready=true' \
  'host_nginx_ready=true' \
  'vhost_valid=true' \
  "certbot_status=$certbot_capability" \
  'renewal_plan_valid=true' \
  'websocket_valid=true' \
  'security_headers_valid=true' \
  'csp_valid=true' \
  'hsts_valid=true' \
  'rate_limit_valid=true' \
  'http_health=healthy' \
  'https_health=not-configured' \
  'rollback_possible=true' \
  'changes_applied=false'
if [[ "$MODE" == check || "$MODE" == dry-run ]]; then
  printf 'publication_status=ready\n'
  exit 0
fi

require_numeric_confirmation external-publication \
  "A publicação externa do DevFlow em https://$DOMAIN está pronta." \
  'PUBLICAR DEVFLOW'

install -d -m 0750 "$DEVFLOW_LOG_ROOT" "$DEVFLOW_STATE_ROOT/publication-backups" \
  "$DEVFLOW_CONFIG_ROOT/nginx" "$DEVFLOW_INSTALL_ROOT/backups/proxy" "$DEVFLOW_INSTALL_ROOT/storage/acme"
PUBLISH_LOG="$DEVFLOW_LOG_ROOT/publish-$(date -u +%Y%m%dT%H%M%SZ).log"
touch "$PUBLISH_LOG"
chmod 0640 "$PUBLISH_LOG"
exec > >(redact_stream | tee -a "$PUBLISH_LOG") 2>&1
BACKUP_DIRECTORY="$(mktemp -d "$DEVFLOW_STATE_ROOT/publication-backups/transaction.XXXXXX")"
chmod 0700 "$BACKUP_DIRECTORY"
cp -a -- "$DEVFLOW_ENV_FILE" "$BACKUP_DIRECTORY/devflow.env"
cp -a -- "$DEVFLOW_STATE_ROOT/installation.json" "$BACKUP_DIRECTORY/installation.json"
cp -a -- "$DEVFLOW_PROVIDER_STATE_FILE" "$BACKUP_DIRECTORY/infrastructure-provider.json"
CERTIFICATE_CREATED=false
[[ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]] || CERTIFICATE_CREATED=true
write_publication_transaction prepared "$BACKUP_DIRECTORY" "$CERTIFICATE_CREATED" "$DOMAIN"
ROLLBACK_ARMED=true

publication_failed() {
  local exit_code="${1:-$?}"
  trap - ERR INT TERM HUP
  if [[ "$ROLLBACK_ARMED" == true ]]; then restore_publication || true; fi
  log ERROR "Publicação falhou (código $exit_code); rollback solicitado. Log: $PUBLISH_LOG"
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
provider_activate "$DEVFLOW_INSTALL_ROOT/app" "$DOMAIN" "$LETSENCRYPT_EMAIL" "$HTTP_PORT" "$API_PORT"
provider_validate
provider_health "$DOMAIN" "$HTTP_PORT" "$API_PORT"
curl --fail --silent --show-error --max-time 20 "http://$DOMAIN/" >/dev/null
curl --fail --silent --show-error --max-time 20 "https://$DOMAIN/api/health" >/dev/null
curl --fail --silent --show-error --max-time 20 "https://$DOMAIN/" >/dev/null

resolve_installed_release_identity "$DEVFLOW_INSTALL_ROOT/source" main >/dev/null \
  || die 'A fonte canônica deixou de ser comprovável durante a publicação.'
DEVFLOW_INSTALLATION_SCOPE=complete
DEVFLOW_APPLICATION_INSTALLED=true
DEVFLOW_APPLICATION_HEALTHY=true
DEVFLOW_EXTERNAL_PUBLICATION_ENABLED=true
DEVFLOW_INFRASTRUCTURE_PROVIDER="$PROVIDER"
DEVFLOW_PROXY_MODE=shared
DEVFLOW_FRONTEND_URL="https://$DOMAIN"
DEVFLOW_BACKEND_URL="https://$DOMAIN/api"
DEVFLOW_PROXY_MIGRATION_EXECUTED="$DEVFLOW_INSTALLATION_STATE_PROXY_MIGRATION_EXECUTED"
DEVFLOW_CERTIFICATE_ISSUED=true
DEVFLOW_DOMAIN="$DOMAIN"
DEVFLOW_MIGRATION_VERSION="$("${DEVFLOW_COMPOSE[@]}" exec -T db sh -c \
  'psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT version FROM schema_migrations ORDER BY applied_at DESC LIMIT 1"')"
export DEVFLOW_INSTALLATION_SCOPE DEVFLOW_APPLICATION_INSTALLED DEVFLOW_APPLICATION_HEALTHY \
  DEVFLOW_EXTERNAL_PUBLICATION_ENABLED DEVFLOW_INFRASTRUCTURE_PROVIDER DEVFLOW_PROXY_MODE \
  DEVFLOW_FRONTEND_URL DEVFLOW_BACKEND_URL DEVFLOW_PROXY_MIGRATION_EXECUTED \
  DEVFLOW_CERTIFICATE_ISSUED DEVFLOW_DOMAIN DEVFLOW_MIGRATION_VERSION
provider_state_write "$PROVIDER" "$DOMAIN" "$HTTP_PORT" "$API_PORT"
write_installation_state
write_publication_transaction completed "$BACKUP_DIRECTORY" "$CERTIFICATE_CREATED" "$DOMAIN"
DEVFLOW_APP_ROOT="$DEVFLOW_INSTALL_ROOT/app" "$DEVFLOW_INSTALL_ROOT/app/scripts/health.sh" --quiet
ROLLBACK_ARMED=false
trap - ERR INT TERM HUP
log INFO "DevFlow publicado em https://$DOMAIN; rollback persistente disponível com --rollback."
