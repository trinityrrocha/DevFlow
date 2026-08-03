#!/usr/bin/env bash

PROVIDER_IMPLEMENTATION_NAME=isolated-nginx
PROVIDER_MUTABLE_RESOURCES='containers e rede Docker exclusivos DevFlow; portas 80/443; certificado exclusivo DevFlow'

provider_detect() {
  ISOLATED_PORT_CONFLICT=false
  local port
  for port in 80 443; do
    if port_is_listening "$port" && ! devflow_container_running edge; then ISOLATED_PORT_CONFLICT=true; fi
  done
}
provider_check() { provider_detect; [[ "$ISOLATED_PORT_CONFLICT" == false ]] || { log ERROR 'Portas 80/443 ocupadas.'; return 1; }; }
provider_dry_run() { provider_check; }
provider_prepare() { validate_domain "$1"; provider_check; }
provider_install() { return 0; }
provider_activate() {
  local root="$1" domain="$2" email="$3"
  if [[ ! -r "/etc/letsencrypt/live/$domain/fullchain.pem" ]]; then
    certbot certonly --standalone -d "$domain" --email "$email" --agree-tos --non-interactive
  fi
  DEVFLOW_APP_ROOT="$root"; compose_files; "${DEVFLOW_COMPOSE[@]}" up -d edge --wait
}
provider_validate() { devflow_container_running edge; }
provider_health() { provider_validate; }
provider_update() { local root="$1"; DEVFLOW_APP_ROOT="$root"; compose_files; "${DEVFLOW_COMPOSE[@]}" up -d edge --wait; }
provider_rollback() { provider_update "$@"; }
provider_uninstall() { return 0; }
