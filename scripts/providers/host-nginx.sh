#!/usr/bin/env bash

PROVIDER_IMPLEMENTATION_NAME=host-nginx
PROVIDER_MUTABLE_RESOURCES='/etc/nginx/sites-available/devflow.conf; /etc/nginx/sites-enabled/devflow.conf (ou /etc/nginx/conf.d/devflow.conf); certificado e hook de renovacao exclusivos DevFlow; servico Nginx do host; /opt/devflow/config/nginx'
HOST_NGINX_MARKER='# Managed by DevFlow installer. Do not merge with another application.'
HOST_NGINX_AVAILABLE=
HOST_NGINX_ENABLED=
HOST_NGINX_LAYOUT=unknown
HOST_NGINX_PRESENT=false
HOST_NGINX_VALID=false
HOST_NGINX_SERVICE=unknown
HOST_NGINX_VERSION=absent
HOST_NGINX_CERTBOT=false
HOST_NGINX_PUBLIC_CONFLICT=false
HOST_NGINX_CONFLICT_OWNER=none
HOST_NGINX_PRIVILEGED_CHECK_REQUIRED=false

host_nginx_select_layout() {
  if [[ -d /etc/nginx/sites-available && -d /etc/nginx/sites-enabled ]]; then
    HOST_NGINX_LAYOUT=sites
    HOST_NGINX_AVAILABLE=/etc/nginx/sites-available/devflow.conf
    HOST_NGINX_ENABLED=/etc/nginx/sites-enabled/devflow.conf
  else
    HOST_NGINX_LAYOUT=conf.d
    HOST_NGINX_AVAILABLE=/etc/nginx/conf.d/devflow.conf
    HOST_NGINX_ENABLED="$HOST_NGINX_AVAILABLE"
  fi
  export HOST_NGINX_LAYOUT HOST_NGINX_AVAILABLE HOST_NGINX_ENABLED
}

provider_detect() {
  HOST_NGINX_PRESENT=false HOST_NGINX_VALID=false HOST_NGINX_CERTBOT=false
  HOST_NGINX_SERVICE=absent HOST_NGINX_VERSION=absent
  HOST_NGINX_PUBLIC_CONFLICT=false HOST_NGINX_CONFLICT_OWNER=none
  HOST_NGINX_PRIVILEGED_CHECK_REQUIRED=false
  if command -v nginx >/dev/null 2>&1; then
    HOST_NGINX_PRESENT=true
    HOST_NGINX_VERSION="$(nginx -v 2>&1 | sed -E 's#^nginx version: nginx/##' | redact_stream)"
    nginx -t >/dev/null 2>&1 && HOST_NGINX_VALID=true
    if command -v systemctl >/dev/null 2>&1; then
      HOST_NGINX_SERVICE="$(systemctl is-active nginx 2>/dev/null || true)"
      systemctl show nginx -p LoadState --value >/dev/null 2>&1 || HOST_NGINX_SERVICE=not-loaded
    fi
  fi
  command -v certbot >/dev/null 2>&1 && HOST_NGINX_CERTBOT=true
  host_nginx_select_layout
  devflow_detect_public_port_ownership
  case "${DEVFLOW_PUBLIC_PROXY_STATUS:-unknown}" in
    free) ;;
    occupied-by-host-nginx)
      if [[ "$HOST_NGINX_PRESENT" != true || "$HOST_NGINX_SERVICE" != active ]]; then
        HOST_NGINX_PUBLIC_CONFLICT=true
        HOST_NGINX_CONFLICT_OWNER=other
      fi
      ;;
    occupied-by-known-docker-proxy)
      HOST_NGINX_PUBLIC_CONFLICT=true
      [[ "${DEVFLOW_PUBLIC_PROXY_CONTAINER:-none}" == fullpassword_nginx ]] \
        && HOST_NGINX_CONFLICT_OWNER=fullpassword_nginx \
        || HOST_NGINX_CONFLICT_OWNER=other
      ;;
    *)
      if [[ "$(id -u)" -ne 0 ]]; then
        HOST_NGINX_PRIVILEGED_CHECK_REQUIRED=true
      else
        HOST_NGINX_PUBLIC_CONFLICT=true
        HOST_NGINX_CONFLICT_OWNER=other
      fi
      ;;
  esac
}

provider_check() {
  provider_detect
  if [[ "$HOST_NGINX_PRIVILEGED_CHECK_REQUIRED" == true ]]; then
    DEVFLOW_PROVIDER_STATUS=privileged-port-owner-check-required
    log WARN 'A propriedade de 80/443 exige diagnostico com sudo.'
    return 3
  fi
  if [[ "$HOST_NGINX_PRESENT" == true && "$HOST_NGINX_VALID" != true ]]; then
    DEVFLOW_PROVIDER_STATUS=invalid-host-nginx
    log ERROR 'Nginx do host foi detectado, mas nginx -t falhou.'
    return 1
  fi
  if [[ "$HOST_NGINX_PUBLIC_CONFLICT" == true ]]; then
    if [[ "$HOST_NGINX_CONFLICT_OWNER" == fullpassword_nginx ]]; then
      DEVFLOW_PROVIDER_STATUS=migration-required
      log WARN 'fullpassword_nginx ocupa 80/443; a migracao controlada e obrigatoria.'
      return 4
    fi
    DEVFLOW_PROVIDER_STATUS=public-ports-conflict
    log ERROR 'As portas publicas estao ocupadas por um proprietario nao comprovado.'
    return 1
  fi
  DEVFLOW_PROVIDER_STATUS=ready
}

provider_dry_run() {
  provider_check
}

provider_prepare() {
  local domain="$1" frontend_port="$2" backend_port="$3" nginx_file tuple service port
  provider_check || return
  validate_domain "$domain"; validate_port "$frontend_port"; validate_port "$backend_port"
  [[ "$frontend_port" != "$backend_port" ]] || { log ERROR 'Portas locais devem ser distintas.'; return 1; }
  for tuple in "frontend:$frontend_port" "backend:$backend_port"; do
    service="${tuple%%:*}"
    port="${tuple##*:}"
    if port_is_listening "$port" && ! devflow_container_running "$service"; then
      log ERROR "Porta loopback $port esta ocupada por outro servico."; return 1
    fi
  done
  if [[ -d /etc/nginx ]]; then
    while IFS= read -r nginx_file; do
      [[ "$nginx_file" == "$HOST_NGINX_AVAILABLE" || "$nginx_file" == "$HOST_NGINX_ENABLED" ]] && continue
      [[ -r "$nginx_file" ]] || { log ERROR "Configuracao Nginx ilegivel: $nginx_file"; return 1; }
      grep -Eq "server_name[[:space:]]+([^;[:space:]]+[[:space:]]+)*$domain([[:space:];]|$)" "$nginx_file" \
        && { log ERROR "Dominio ja declarado em $nginx_file"; return 1; }
    done < <(find /etc/nginx -type f -name '*.conf' -print 2>/dev/null)
  fi
}

provider_install() {
  provider_detect
  if [[ "$HOST_NGINX_PRESENT" != true ]]; then
    [[ "$HOST_NGINX_PUBLIC_CONFLICT" != true ]] || { log ERROR 'Nginx nao sera instalado enquanto 80/443 estiverem ocupadas.'; return 1; }
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y nginx certbot python3-certbot-nginx
    systemctl enable --now nginx
  elif [[ "$HOST_NGINX_CERTBOT" != true ]]; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y certbot python3-certbot-nginx
  fi
  provider_detect
  [[ "$HOST_NGINX_PRESENT" == true && "$HOST_NGINX_VALID" == true ]] || return 1
}

host_nginx_render() {
  local root="$1" template="$2" output="$3" domain="$4" frontend_port="$5" backend_port="$6"
  sed -e "s/__DEVFLOW_DOMAIN__/$domain/g" \
    -e "s/__DEVFLOW_HTTP_PORT__/$frontend_port/g" \
    -e "s/__DEVFLOW_API_PORT__/$backend_port/g" \
    "$root/docker/nginx/$template" > "$output"
  [[ "$(head -n1 "$output" 2>/dev/null || true)" == "$HOST_NGINX_MARKER" ]]
}

host_nginx_promote() {
  local candidate="$1" backup_root="$2" available_backup enabled_backup had_available=false had_enabled=false staged
  host_nginx_select_layout
  managed_file "$HOST_NGINX_AVAILABLE" "$HOST_NGINX_MARKER" || { log ERROR "$HOST_NGINX_AVAILABLE pertence a outro sistema."; return 1; }
  if [[ "$HOST_NGINX_LAYOUT" == conf.d ]]; then
    promote_host_nginx_config "$candidate" "$HOST_NGINX_AVAILABLE" "$HOST_NGINX_MARKER" "$backup_root" || return
    install -d -m 0750 "$DEVFLOW_CONFIG_ROOT/nginx"
    install -m 0640 "$HOST_NGINX_AVAILABLE" "$DEVFLOW_CONFIG_ROOT/nginx/devflow.conf"
    return
  fi
  [[ ! -e "$HOST_NGINX_ENABLED" || -L "$HOST_NGINX_ENABLED" ]] || { log ERROR "$HOST_NGINX_ENABLED nao e um link gerenciavel."; return 1; }
  [[ ! -L "$HOST_NGINX_ENABLED" || "$(readlink -f "$HOST_NGINX_ENABLED")" == "$HOST_NGINX_AVAILABLE" ]] \
    || { log ERROR "$HOST_NGINX_ENABLED aponta para outro sistema."; return 1; }
  available_backup="$(mktemp /etc/nginx/sites-available/.devflow-available.XXXXXX)"
  enabled_backup="$(mktemp /etc/nginx/sites-enabled/.devflow-enabled.XXXXXX)"
  if [[ -e "$HOST_NGINX_AVAILABLE" ]]; then cp -a -- "$HOST_NGINX_AVAILABLE" "$available_backup"; had_available=true; fi
  if [[ -L "$HOST_NGINX_ENABLED" ]]; then readlink "$HOST_NGINX_ENABLED" > "$enabled_backup"; had_enabled=true; fi
  proxy_persistent_backup "$HOST_NGINX_AVAILABLE" "$backup_root" before-promote
  staged="$(mktemp /etc/nginx/sites-available/.devflow-candidate.XXXXXX)"
  install -m 0644 "$candidate" "$staged"
  mv -f -- "$staged" "$HOST_NGINX_AVAILABLE"
  ln -sfn "$HOST_NGINX_AVAILABLE" "$HOST_NGINX_ENABLED"
  if ! nginx -t >/dev/null 2>&1 || ! systemctl reload nginx >/dev/null 2>&1; then
    if [[ "$had_enabled" == true ]]; then ln -sfn "$(cat "$enabled_backup")" "$HOST_NGINX_ENABLED"; else rm -f -- "$HOST_NGINX_ENABLED"; fi
    if [[ "$had_available" == true ]]; then mv -f -- "$available_backup" "$HOST_NGINX_AVAILABLE"; else rm -f -- "$HOST_NGINX_AVAILABLE" "$available_backup"; fi
    nginx -t >/dev/null 2>&1 && systemctl reload nginx >/dev/null 2>&1 || log ERROR 'Rollback do site Nginx exige intervencao.'
    rm -f -- "$candidate" "$enabled_backup"
    return 1
  fi
  rm -f -- "$candidate" "$available_backup" "$enabled_backup"
  install -d -m 0750 "$DEVFLOW_CONFIG_ROOT/nginx"
  install -m 0640 "$HOST_NGINX_AVAILABLE" "$DEVFLOW_CONFIG_ROOT/nginx/devflow.conf"
}

provider_activate() {
  local root="$1" domain="$2" email="$3" frontend_port="$4" backend_port="$5" candidate hook
  install -d -m 0755 "$DEVFLOW_INSTALL_ROOT/storage/acme"
  if [[ ! -r "/etc/letsencrypt/live/$domain/fullchain.pem" ]]; then
    candidate="$(mktemp /tmp/devflow-host-acme.XXXXXX)"
    host_nginx_render "$root" host-acme.conf.template "$candidate" "$domain" "$frontend_port" "$backend_port"
    host_nginx_promote "$candidate" "$DEVFLOW_INSTALL_ROOT/backups/proxy"
    certbot certonly --webroot -w "$DEVFLOW_INSTALL_ROOT/storage/acme" -d "$domain" \
      --email "$email" --agree-tos --non-interactive
  fi
  openssl x509 -in "/etc/letsencrypt/live/$domain/fullchain.pem" -noout -checkhost "$domain" >/dev/null 2>&1
  hook=/etc/letsencrypt/renewal-hooks/deploy/devflow-nginx-reload
  [[ ! -e "$hook" ]] || grep -Fqx '# Managed by DevFlow installer.' "$hook" \
    || { log ERROR "$hook pertence a outro sistema."; return 1; }
  install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
  candidate="$(mktemp /etc/letsencrypt/renewal-hooks/deploy/.devflow-hook.XXXXXX)"
  printf '#!/bin/sh\n# Managed by DevFlow installer.\nnginx -t && systemctl reload nginx\n' > "$candidate"
  chmod 0750 "$candidate"
  mv -f -- "$candidate" "$hook"
  candidate="$(mktemp /tmp/devflow-host-nginx.XXXXXX)"
  host_nginx_render "$root" host-shared.conf.template "$candidate" "$domain" "$frontend_port" "$backend_port"
  host_nginx_promote "$candidate" "$DEVFLOW_INSTALL_ROOT/backups/proxy"
  if systemctl list-unit-files certbot.timer >/dev/null 2>&1; then
    systemctl enable --now certbot.timer
  fi
  certbot renew --cert-name "$domain" --dry-run --non-interactive >/dev/null
}

provider_validate() {
  nginx -t >/dev/null 2>&1 || return 1
  systemctl is-active --quiet nginx || return 1
  host_nginx_select_layout
  [[ -r "$HOST_NGINX_AVAILABLE" ]]
}

provider_health() {
  local domain="$1" frontend_port="$2" backend_port="$3"
  provider_validate || return 1
  getent ahosts "$domain" >/dev/null 2>&1 || return 1
  port_is_listening 80 || return 1
  port_is_listening 443 || return 1
  curl --fail --silent --show-error --max-time 10 "http://127.0.0.1:$frontend_port/healthz" >/dev/null || return 1
  curl --fail --silent --show-error --max-time 10 "http://127.0.0.1:$backend_port/api/health" >/dev/null || return 1
  openssl x509 -in "/etc/letsencrypt/live/$domain/fullchain.pem" -noout -checkhost "$domain" >/dev/null 2>&1 || return 1
  certbot certificates --cert-name "$domain" >/dev/null 2>&1 || return 1
  [[ -x /etc/letsencrypt/renewal-hooks/deploy/devflow-nginx-reload ]] || return 1
  if systemctl list-unit-files certbot.timer >/dev/null 2>&1; then
    systemctl is-enabled --quiet certbot.timer || return 1
    systemctl is-active --quiet certbot.timer || return 1
  fi
}

provider_update() {
  local root="$1" template="${2:-host-shared.conf.template}" candidate
  candidate="$(mktemp /tmp/devflow-host-update.XXXXXX)"
  host_nginx_render "$root" "$template" "$candidate" "$DEVFLOW_DOMAIN" "${DEVFLOW_HTTP_PORT:-18080}" "${DEVFLOW_API_PORT:-13000}"
  host_nginx_promote "$candidate" "$DEVFLOW_INSTALL_ROOT/backups/proxy"
}

provider_rollback() { provider_update "$@"; }

provider_uninstall() {
  local hook=/etc/letsencrypt/renewal-hooks/deploy/devflow-nginx-reload saved
  host_nginx_select_layout
  [[ ! -e "$hook" ]] || grep -Fqx '# Managed by DevFlow installer.' "$hook" || return 1
  if [[ "$HOST_NGINX_LAYOUT" == conf.d ]]; then
    remove_host_nginx_config "$HOST_NGINX_AVAILABLE" "$HOST_NGINX_MARKER" "$DEVFLOW_INSTALL_ROOT/backups/proxy"
    rm -f -- "$hook"
    return
  fi
  if [[ ! -e "$HOST_NGINX_AVAILABLE" ]]; then
    rm -f -- "$hook"
    return 0
  fi
  managed_file "$HOST_NGINX_AVAILABLE" "$HOST_NGINX_MARKER" || return 1
  [[ ! -e "$HOST_NGINX_ENABLED" || "$(readlink -f "$HOST_NGINX_ENABLED")" == "$HOST_NGINX_AVAILABLE" ]] || return 1
  proxy_persistent_backup "$HOST_NGINX_AVAILABLE" "$DEVFLOW_INSTALL_ROOT/backups/proxy" before-remove
  saved="$(mktemp /etc/nginx/sites-available/.devflow-remove.XXXXXX)"
  cp -a -- "$HOST_NGINX_AVAILABLE" "$saved"
  rm -f -- "$HOST_NGINX_ENABLED" "$HOST_NGINX_AVAILABLE"
  if ! nginx -t >/dev/null 2>&1 || ! systemctl reload nginx >/dev/null 2>&1; then
    mv -f -- "$saved" "$HOST_NGINX_AVAILABLE"; ln -sfn "$HOST_NGINX_AVAILABLE" "$HOST_NGINX_ENABLED"
    nginx -t >/dev/null 2>&1 && systemctl reload nginx >/dev/null 2>&1 || true
    return 1
  fi
  rm -f -- "$saved"
  rm -f -- "$hook"
}
