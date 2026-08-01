#!/usr/bin/env bash

FULLPASSWORD_ROOT=/opt/fullpassword
FULLPASSWORD_COMPOSE_FILE="$FULLPASSWORD_ROOT/docker-compose.yml"
FULLPASSWORD_OVERRIDE_FILE="$FULLPASSWORD_ROOT/docker-compose.devflow.yml"
FULLPASSWORD_SERVICE=nginx
FULLPASSWORD_CONTAINER=fullpassword_nginx
FULLPASSWORD_ORIGINAL_DOMAIN="${FULLPASSWORD_ORIGINAL_DOMAIN:-pw.sti1.com.br}"
FULLPASSWORD_RUNTIME_CONFIG="$FULLPASSWORD_ROOT/docker/nginx.runtime.conf"
DEVFLOW_PROXY_CONFIG="$DEVFLOW_CONFIG_ROOT/nginx/devflow.conf"
DEVFLOW_EDGE_NETWORK=devflow_edge
DEVFLOW_ACME_WEBROOT="${DEVFLOW_ACME_WEBROOT:-/var/www/certbot}"
FULLPASSWORD_OVERRIDE_MARKER='# Managed by DevFlow Full Password proxy adapter. Do not edit the original Compose.'
FULLPASSWORD_CONFIG_MARKER='# Managed by DevFlow Full Password proxy adapter. Independent virtual host.'

fullpassword_audit() {
  local level="$1" message="$2" logfile line
  line="$(log "$level" "$message")"
  printf '%s\n' "$line"
  if [[ -n "${DEVFLOW_LOG_ROOT:-}" ]]; then
    if ! install -d -m 0750 "$DEVFLOW_LOG_ROOT"; then
      printf '%s [WARN] Não foi possível preparar o log persistente do adaptador.\n' "$(timestamp)" >&2
      return 0
    fi
    logfile="$DEVFLOW_LOG_ROOT/fullpassword-proxy.log"
    if ! printf '%s\n' "$line" | redact_stream >> "$logfile" || ! chmod 0640 "$logfile"; then
      printf '%s [WARN] Não foi possível persistir uma entrada do log do adaptador.\n' "$(timestamp)" >&2
    fi
  fi
  return 0
}

fullpassword_compose() {
  if [[ -f "$FULLPASSWORD_OVERRIDE_FILE" ]]; then
    docker compose -f "$FULLPASSWORD_COMPOSE_FILE" -f "$FULLPASSWORD_OVERRIDE_FILE" "$@"
  else
    docker compose -f "$FULLPASSWORD_COMPOSE_FILE" "$@"
  fi
}

fullpassword_public_health() {
  local http_code
  http_code="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 20 "http://$FULLPASSWORD_ORIGINAL_DOMAIN/" || true)"
  [[ "$http_code" =~ ^[23][0-9][0-9]$ ]] \
    && curl --fail --silent --show-error --max-time 20 "https://$FULLPASSWORD_ORIGINAL_DOMAIN/" >/dev/null
}

devflow_public_health() {
  local domain="$1" http_code
  http_code="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 20 "http://$domain/" || true)"
  [[ "$http_code" =~ ^[23][0-9][0-9]$ ]] \
    && curl --fail --silent --show-error --max-time 20 "https://$domain/" >/dev/null \
    && curl --fail --silent --show-error --max-time 20 "https://$domain/api/health" >/dev/null
}

validate_devflow_acme_route() {
  local domain="$1" challenge_dir challenge_file token response
  challenge_dir="$DEVFLOW_ACME_WEBROOT/.well-known/acme-challenge"
  install -d -m 0755 "$challenge_dir"
  token="$(openssl rand -hex 32)"
  challenge_file="$challenge_dir/devflow-route-$token"
  printf '%s\n' "$token" > "$challenge_file"
  chmod 0644 "$challenge_file"
  response="$(curl --fail --silent --show-error --max-time 20 "http://$domain/.well-known/acme-challenge/$(basename "$challenge_file")" || true)"
  rm -f -- "$challenge_file"
  [[ "$response" == "$token" ]]
}

fullpassword_adapter_preflight() {
  local mounts networks working_dir config_files image certificate_sans
  [[ -r "$FULLPASSWORD_COMPOSE_FILE" ]] || { log ERROR "Compose original ausente: $FULLPASSWORD_COMPOSE_FILE"; return 1; }
  [[ -r "$FULLPASSWORD_RUNTIME_CONFIG" ]] || { log ERROR 'Configuração runtime original do Full Password ausente.'; return 1; }
  [[ -w "$FULLPASSWORD_ROOT" ]] || { log ERROR "$FULLPASSWORD_ROOT não permite criar o override independente."; return 1; }
  docker inspect "$FULLPASSWORD_CONTAINER" >/dev/null 2>&1 || { log ERROR 'fullpassword_nginx não está disponível.'; return 1; }
  image="$(docker inspect --format '{{.Config.Image}}' "$FULLPASSWORD_CONTAINER")"
  [[ "$image" == nginx:alpine ]] || { log ERROR 'Imagem do proxy diverge de nginx:alpine.'; return 1; }
  [[ "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$FULLPASSWORD_CONTAINER")" == fullpassword ]] \
    || { log ERROR 'Projeto Compose do proxy não é fullpassword.'; return 1; }
  [[ "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "$FULLPASSWORD_CONTAINER")" == "$FULLPASSWORD_SERVICE" ]] \
    || { log ERROR 'Serviço Compose do proxy não é nginx.'; return 1; }
  working_dir="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$FULLPASSWORD_CONTAINER")"
  config_files="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$FULLPASSWORD_CONTAINER")"
  [[ "$working_dir" == "$FULLPASSWORD_ROOT" ]] \
    || { log ERROR 'Origem Compose do proxy diverge do diagnóstico aprovado.'; return 1; }
  [[ "$config_files" == "$FULLPASSWORD_COMPOSE_FILE" \
    || "$config_files" == "$FULLPASSWORD_COMPOSE_FILE,$FULLPASSWORD_OVERRIDE_FILE" ]] \
    || { log ERROR 'Lista de arquivos Compose do proxy diverge do contrato aprovado.'; return 1; }
  mounts="$(docker inspect --format '{{range .Mounts}}{{.Type}}|{{.Source}}|{{.Destination}}|{{.RW}}{{println}}{{end}}' "$FULLPASSWORD_CONTAINER")"
  grep -Fxq "bind|$FULLPASSWORD_RUNTIME_CONFIG|/etc/nginx/conf.d/default.conf|false" <<< "$mounts" \
    || { log ERROR 'Mount read-only da configuração original não foi preservado.'; return 1; }
  grep -Fxq 'bind|/etc/letsencrypt|/etc/letsencrypt|false' <<< "$mounts" \
    || { log ERROR 'Bind mount read-only /etc/letsencrypt -> /etc/letsencrypt não foi comprovado.'; return 1; }
  networks="$(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{println}}{{end}}' "$FULLPASSWORD_CONTAINER")"
  grep -Fxq fullpassword_fullpassword_network <<< "$networks" \
    || { log ERROR 'Rede original fullpassword_fullpassword_network ausente.'; return 1; }
  [[ -n "$(docker port "$FULLPASSWORD_CONTAINER" 80/tcp 2>/dev/null || true)" \
    && -n "$(docker port "$FULLPASSWORD_CONTAINER" 443/tcp 2>/dev/null || true)" ]] \
    || { log ERROR 'Publicação original das portas 80/443 não foi comprovada.'; return 1; }
  ! grep -Eq 'devflow-(backend|frontend)' "$FULLPASSWORD_RUNTIME_CONFIG" \
    || { log ERROR 'A configuração original usa aliases reservados aos upstreams DevFlow.'; return 1; }
  if [[ -e "/etc/letsencrypt/live/${DEVFLOW_DOMAIN:-invalid}/fullchain.pem" ]]; then
    certificate_sans="$(openssl x509 -in "/etc/letsencrypt/live/$DEVFLOW_DOMAIN/fullchain.pem" -noout -ext subjectAltName 2>/dev/null || true)"
    ! grep -Fq 'DNS:*' <<< "$certificate_sans" \
      && grep -Eq "DNS:${DEVFLOW_DOMAIN//./\\.}([,[:space:]]|$)" <<< "$certificate_sans" \
      || { log ERROR 'Certificado DevFlow preexistente é wildcard, inválido ou não corresponde ao domínio.'; return 1; }
  fi
  if [[ -e "$FULLPASSWORD_OVERRIDE_FILE" ]]; then
    grep -Fxq "bind|$DEVFLOW_PROXY_CONFIG|/etc/nginx/conf.d/devflow.conf|false" <<< "$mounts" \
      || { log ERROR 'Mount persistente de devflow.conf não está ativo no proxy.'; return 1; }
    grep -Fxq 'bind|/var/www/certbot|/var/www/certbot|false' <<< "$mounts" \
      || { log ERROR 'Mount persistente do webroot ACME não está ativo no proxy.'; return 1; }
    grep -Fxq "$DEVFLOW_EDGE_NETWORK" <<< "$networks" \
      || { log ERROR 'fullpassword_nginx não está conectado à devflow_edge.'; return 1; }
  fi
  docker exec "$FULLPASSWORD_CONTAINER" nginx -t >/dev/null 2>&1 \
    || { log ERROR 'Configuração atual do fullpassword_nginx é inválida.'; return 1; }
  fullpassword_public_health || { log ERROR "Health público de $FULLPASSWORD_ORIGINAL_DOMAIN falhou antes da integração."; return 1; }
}

ensure_devflow_edge_network() {
  if docker network inspect "$DEVFLOW_EDGE_NETWORK" >/dev/null 2>&1; then
    [[ "$(docker network inspect "$DEVFLOW_EDGE_NETWORK" --format '{{index .Labels "devflow.managed"}}')" == true ]] \
      || { log ERROR 'devflow_edge existente não possui propriedade DevFlow comprovada.'; return 1; }
    return 0
  fi
  docker network create --driver bridge \
    --label devflow.managed=true --label com.docker.compose.project=devflow \
    "$DEVFLOW_EDGE_NETWORK" >/dev/null
}

remove_devflow_edge_network_if_unused() {
  local containers
  docker network inspect "$DEVFLOW_EDGE_NETWORK" >/dev/null 2>&1 || return 0
  [[ "$(docker network inspect "$DEVFLOW_EDGE_NETWORK" --format '{{index .Labels "devflow.managed"}}')" == true ]] || return 1
  containers="$(docker network inspect "$DEVFLOW_EDGE_NETWORK" --format '{{len .Containers}}')"
  [[ "$containers" == 0 ]] || return 0
  docker network rm "$DEVFLOW_EDGE_NETWORK" >/dev/null
}

render_fullpassword_override() {
  local root="$1" output="$2"
  install -m 0600 "$root/docker/fullpassword/docker-compose.devflow.yml.template" "$output"
}

render_fullpassword_proxy() {
  local root="$1" template="$2" domain="$3" output="$4"
  validate_domain "$domain"
  sed "s/__DEVFLOW_DOMAIN__/$domain/g" "$root/docker/nginx/$template" > "$output"
  chmod 0600 "$output"
}

validate_fullpassword_compose_merge() {
  local root="$1" override="$2" temporary base_json merged_json
  temporary="$(mktemp -d "${TMPDIR:-/tmp}/devflow-compose-validation.XXXXXX")"
  base_json="$temporary/base.json"
  merged_json="$temporary/merged.json"
  if ! docker compose -f "$FULLPASSWORD_COMPOSE_FILE" config --format json > "$base_json" \
    || ! docker compose -f "$FULLPASSWORD_COMPOSE_FILE" -f "$override" config --format json > "$merged_json" \
    || ! python3 "$root/scripts/validate-fullpassword-compose.py" "$base_json" "$merged_json"; then
    rm -rf -- "$temporary"
    return 1
  fi
  rm -rf -- "$temporary"
}

validate_fullpassword_nginx_candidate() {
  local candidate="$1" image_id validation_container status=0
  image_id="$(docker inspect --format '{{.Image}}' "$FULLPASSWORD_CONTAINER" 2>/dev/null || true)"
  [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || { log ERROR 'Imagem imutável do fullpassword_nginx não pôde ser identificada.'; return 1; }
  validation_container="devflow_nginx_validate_${BASHPID}_${RANDOM}"
  docker create --name "$validation_container" --network fullpassword_fullpassword_network \
    -v "$FULLPASSWORD_RUNTIME_CONFIG:/etc/nginx/conf.d/default.conf:ro" \
    -v "$candidate:/etc/nginx/conf.d/devflow.conf:ro" \
    -v /etc/letsencrypt:/etc/letsencrypt:ro \
    -v "$DEVFLOW_ACME_WEBROOT:/var/www/certbot:ro" \
    "$image_id" nginx -t >/dev/null 2>&1 || return 1
  docker network connect "$DEVFLOW_EDGE_NETWORK" "$validation_container" >/dev/null 2>&1 || status=1
  if [[ "$status" -eq 0 ]]; then
    docker start --attach "$validation_container" >/dev/null 2>&1 || status=1
  fi
  docker rm -f "$validation_container" >/dev/null 2>&1 || status=1
  return "$status"
}

fullpassword_adapter_snapshot() {
  local transaction="$1"
  install -d -m 0700 "$transaction"
  if [[ -e "$FULLPASSWORD_OVERRIDE_FILE" ]]; then
    [[ "$(head -n1 "$FULLPASSWORD_OVERRIDE_FILE" 2>/dev/null || true)" == "$FULLPASSWORD_OVERRIDE_MARKER" ]] || return 1
    cp -a -- "$FULLPASSWORD_OVERRIDE_FILE" "$transaction/override.previous"
    touch "$transaction/had-override"
  fi
  if [[ -e "$DEVFLOW_PROXY_CONFIG" ]]; then
    [[ "$(head -n1 "$DEVFLOW_PROXY_CONFIG" 2>/dev/null || true)" == "$FULLPASSWORD_CONFIG_MARKER" ]] || return 1
    cp -a -- "$DEVFLOW_PROXY_CONFIG" "$transaction/config.previous"
    touch "$transaction/had-config"
  fi
  docker network inspect "$DEVFLOW_EDGE_NETWORK" >/dev/null 2>&1 && touch "$transaction/had-network"
  [[ -e "/etc/letsencrypt/live/${DEVFLOW_DOMAIN:-invalid}/fullchain.pem" ]] && touch "$transaction/had-certificate"
}

atomic_managed_install() {
  local source="$1" target="$2" marker="$3" parent staged
  [[ "$(head -n1 "$source" 2>/dev/null || true)" == "$marker" ]] || return 1
  parent="$(dirname "$target")"
  install -d -m 0750 "$parent"
  if [[ -e "$target" ]]; then
    [[ "$(head -n1 "$target" 2>/dev/null || true)" == "$marker" ]] || return 1
  fi
  staged="$(mktemp "$parent/.devflow-managed.XXXXXX")"
  install -m 0644 "$source" "$staged"
  mv -f -- "$staged" "$target"
}

fullpassword_recreate_nginx() {
  fullpassword_audit INFO 'Validando os dois arquivos Compose e recriando somente o serviço nginx.'
  fullpassword_compose config --quiet \
    && fullpassword_compose up -d --no-deps --force-recreate "$FULLPASSWORD_SERVICE" \
    && docker exec "$FULLPASSWORD_CONTAINER" nginx -t >/dev/null 2>&1 \
    && fullpassword_audit INFO 'Serviço nginx recriado e nginx -t confirmado.'
}

fullpassword_adapter_restore_snapshot() {
  local transaction="$1" status=0
  fullpassword_audit WARN 'Iniciando rollback do adaptador fullpassword_nginx.'
  if [[ -e "$transaction/had-override" ]]; then
    cp -a -- "$transaction/override.previous" "$FULLPASSWORD_OVERRIDE_FILE" || status=1
  else
    rm -f -- "$FULLPASSWORD_OVERRIDE_FILE" || status=1
  fi
  if [[ -e "$transaction/had-config" ]]; then
    cp -a -- "$transaction/config.previous" "$DEVFLOW_PROXY_CONFIG" || status=1
  else
    rm -f -- "$DEVFLOW_PROXY_CONFIG" || status=1
  fi
  fullpassword_recreate_nginx || status=1
  fullpassword_public_health || status=1
  if [[ ! -e "$transaction/had-certificate" && -n "${DEVFLOW_DOMAIN:-}" ]]; then
    certbot delete --cert-name "$DEVFLOW_DOMAIN" --non-interactive >/dev/null 2>&1 || true
  fi
  if [[ ! -e "$transaction/had-network" ]]; then
    remove_devflow_edge_network_if_unused || true
  fi
  if [[ "$status" -eq 0 ]]; then
    fullpassword_audit WARN 'Rollback do adaptador concluído; health do Full Password confirmado.'
  else
    fullpassword_audit ERROR 'Rollback do adaptador terminou com falha e requer intervenção.'
  fi
  return "$status"
}

issue_fullpassword_certificate() {
  local domain="$1" email="$2"
  certbot certonly --webroot -w "$DEVFLOW_ACME_WEBROOT" -d "$domain" --email "$email" --agree-tos --non-interactive \
    && fullpassword_audit INFO 'Certificado exclusivo do domínio DevFlow emitido ou validado.'
}

fullpassword_adapter_apply_files() {
  local root="$1" override_candidate="$2" config_candidate="$3"
  validate_fullpassword_compose_merge "$root" "$override_candidate" \
    && validate_fullpassword_nginx_candidate "$config_candidate" \
    && atomic_managed_install "$override_candidate" "$FULLPASSWORD_OVERRIDE_FILE" "$FULLPASSWORD_OVERRIDE_MARKER" \
    && atomic_managed_install "$config_candidate" "$DEVFLOW_PROXY_CONFIG" "$FULLPASSWORD_CONFIG_MARKER" \
    && fullpassword_recreate_nginx \
    && fullpassword_public_health
}

install_fullpassword_proxy_adapter() {
  local root="$1" domain="$2" email="$3" transaction override_candidate config_candidate
  install -d -m 0750 "$DEVFLOW_INSTALL_ROOT/backups/proxy" "$DEVFLOW_CONFIG_ROOT/nginx"
  install -d -m 0755 "$DEVFLOW_ACME_WEBROOT"
  transaction="$(mktemp -d "$DEVFLOW_INSTALL_ROOT/backups/proxy/fullpassword-install.XXXXXX")"
  override_candidate="$(mktemp /tmp/devflow-fullpassword-override.XXXXXX)"
  config_candidate="$(mktemp /tmp/devflow-fullpassword-nginx.XXXXXX)"
  fullpassword_adapter_snapshot "$transaction" || { rm -rf -- "$transaction"; return 1; }
  fullpassword_audit INFO 'Iniciando instalação transacional do adaptador fullpassword_nginx.'

  if ! fullpassword_adapter_preflight \
    || ! ensure_devflow_edge_network \
    || ! render_fullpassword_override "$root" "$override_candidate" \
    || ! render_fullpassword_proxy "$root" fullpassword-acme.conf.template "$domain" "$config_candidate" \
    || ! fullpassword_adapter_apply_files "$root" "$override_candidate" "$config_candidate" \
    || ! validate_devflow_acme_route "$domain" \
    || ! issue_fullpassword_certificate "$domain" "$email" \
    || ! render_fullpassword_override "$root" "$override_candidate" \
    || ! render_fullpassword_proxy "$root" fullpassword-shared.conf.template "$domain" "$config_candidate" \
    || ! fullpassword_adapter_apply_files "$root" "$override_candidate" "$config_candidate" \
    || ! devflow_public_health "$domain"; then
    log ERROR 'Integração com fullpassword_nginx falhou; iniciando rollback do adaptador.'
    fullpassword_adapter_restore_snapshot "$transaction" \
      || log ERROR 'Rollback do adaptador encontrou falha; preserve a VPS para intervenção manual.'
    rm -f -- "$override_candidate" "$config_candidate"
    return 1
  fi

  rm -f -- "$override_candidate" "$config_candidate"
  chmod -R go-rwx "$transaction"
  fullpassword_audit INFO 'Adaptador fullpassword_nginx aplicado com sucesso e backup transacional preservado.'
}

promote_fullpassword_proxy_config() {
  local root="$1" template="$2" domain="$3" expected_http="${4:-healthy}"
  local transaction override_candidate config_candidate
  install -d -m 0750 "$DEVFLOW_INSTALL_ROOT/backups/proxy" "$DEVFLOW_CONFIG_ROOT/nginx"
  transaction="$(mktemp -d "$DEVFLOW_INSTALL_ROOT/backups/proxy/fullpassword-update.XXXXXX")"
  override_candidate="$(mktemp /tmp/devflow-fullpassword-override.XXXXXX)"
  config_candidate="$(mktemp /tmp/devflow-fullpassword-nginx.XXXXXX)"
  fullpassword_adapter_snapshot "$transaction" || { rm -rf -- "$transaction"; return 1; }
  fullpassword_audit INFO 'Iniciando promoção transacional da configuração compartilhada DevFlow.'
  if ! render_fullpassword_override "$root" "$override_candidate" \
    || ! render_fullpassword_proxy "$root" "$template" "$domain" "$config_candidate" \
    || ! fullpassword_adapter_apply_files "$root" "$override_candidate" "$config_candidate"; then
    fullpassword_adapter_restore_snapshot "$transaction" || true
    rm -f -- "$override_candidate" "$config_candidate"
    return 1
  fi
  if [[ "$expected_http" == healthy ]]; then
    if ! devflow_public_health "$domain"; then
      fullpassword_adapter_restore_snapshot "$transaction" || true
      rm -f -- "$override_candidate" "$config_candidate"
      return 1
    fi
  fi
  rm -f -- "$override_candidate" "$config_candidate"
  chmod -R go-rwx "$transaction"
  fullpassword_audit INFO 'Configuração compartilhada DevFlow promovida com health confirmado.'
}

uninstall_fullpassword_proxy_adapter() {
  local transaction
  install -d -m 0750 "$DEVFLOW_INSTALL_ROOT/backups/proxy"
  transaction="$(mktemp -d "$DEVFLOW_INSTALL_ROOT/backups/proxy/fullpassword-remove.XXXXXX")"
  fullpassword_adapter_snapshot "$transaction" || return 1
  fullpassword_audit INFO 'Iniciando remoção transacional do adaptador fullpassword_nginx.'
  rm -f -- "$FULLPASSWORD_OVERRIDE_FILE" "$DEVFLOW_PROXY_CONFIG"
  if ! fullpassword_recreate_nginx || ! fullpassword_public_health; then
    fullpassword_adapter_restore_snapshot "$transaction" || true
    return 1
  fi
  remove_devflow_edge_network_if_unused || true
  chmod -R go-rwx "$transaction"
  fullpassword_audit INFO 'Adaptador removido; Compose original e health do Full Password confirmados.'
}
