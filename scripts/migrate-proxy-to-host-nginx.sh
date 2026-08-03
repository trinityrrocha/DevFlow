#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

MODE=check
MODE_EXPLICIT=false
FULLPASSWORD_ROOT="${FULLPASSWORD_ROOT:-/opt/fullpassword}"
FULLPASSWORD_COMPOSE_FILE="$FULLPASSWORD_ROOT/docker-compose.yml"
FULLPASSWORD_CONTAINER=fullpassword_nginx
FULLPASSWORD_DOMAIN="${FULLPASSWORD_DOMAIN:-pw.sti1.com.br}"
MIGRATION_ROOT="${DEVFLOW_PROXY_MIGRATION_ROOT:-/etc/devflow/proxy-migrations}"
OVERRIDE_FILE="$MIGRATION_ROOT/fullpassword-host-nginx.override.yml"
STATE_FILE="$MIGRATION_ROOT/fullpassword-host-nginx.state"
BACKUP_ROOT="$MIGRATION_ROOT/backups"
LOG_ROOT="${DEVFLOW_PROXY_MIGRATION_LOG_ROOT:-/var/log/devflow}"
HOST_CONFIG=/etc/nginx/sites-available/fullpassword-proxy-migration.conf
HOST_ENABLED=/etc/nginx/sites-enabled/fullpassword-proxy-migration.conf
MIGRATION_MARKER='# Managed by DevFlow proxy migration. Independent Full Password host route.'
MIGRATION_STARTED=false
ORIGINAL_NGINX_ACTIVE=false
HOST_NGINX_INSTALLED_BY_MIGRATION=false
STATE_CAPTURE=

usage() {
  cat <<'EOF'
Uso:
  sudo ./scripts/migrate-proxy-to-host-nginx.sh --check
  sudo ./scripts/migrate-proxy-to-host-nginx.sh --dry-run
  sudo ./scripts/migrate-proxy-to-host-nginx.sh --migrate
  sudo ./scripts/migrate-proxy-to-host-nginx.sh --rollback

--check e --dry-run sao somente leitura. --migrate e --rollback exigem
confirmacao literal e nunca sao chamados pelo instalador comum.
EOF
}

set_mode() {
  [[ "$MODE_EXPLICIT" == false ]] || die 'Informe somente um modo.'
  MODE="$1"; MODE_EXPLICIT=true
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) set_mode check; shift ;;
    --dry-run) set_mode dry-run; shift ;;
    --migrate) set_mode migrate; shift ;;
    --rollback) set_mode rollback; shift ;;
    --fullpassword-domain) FULLPASSWORD_DOMAIN="${2:-}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) die "Opcao desconhecida: $1" ;;
  esac
done

require_linux
validate_domain "$FULLPASSWORD_DOMAIN"
validate_safe_absolute_path "$FULLPASSWORD_ROOT" 'Diretorio Full Password'
validate_safe_absolute_path "$MIGRATION_ROOT" 'Diretorio neutro da migracao'
[[ "$FULLPASSWORD_ROOT" == /opt/fullpassword ]] || die 'A migracao aceita somente /opt/fullpassword.'
[[ "$MIGRATION_ROOT" == /etc/devflow/proxy-migrations ]] || die 'Diretorio de migracao inesperado.'

compose_version=absent
nginx_state=absent
container_state=absent
ports_state=unknown
certificate_state=absent
preflight_status=ready

read_only_preflight() {
  command -v python3 >/dev/null 2>&1 || { preflight_status=python-missing; return 1; }
  command -v docker >/dev/null 2>&1 || { preflight_status=docker-missing; return 1; }
  docker compose version >/dev/null 2>&1 || { preflight_status=compose-missing; return 1; }
  compose_version="$(docker compose version --short | sed 's/^v//')"
  version_at_least "$compose_version" 2.24.4 || { preflight_status=compose-too-old; return 1; }
  [[ -r "$FULLPASSWORD_COMPOSE_FILE" ]] || { preflight_status=compose-unreadable; return 1; }
  docker compose --project-directory "$FULLPASSWORD_ROOT" -f "$FULLPASSWORD_COMPOSE_FILE" \
    -f "$SOURCE_ROOT/docker/fullpassword/fullpassword-host-nginx.override.yml.template" config --format json \
    | python3 -c 'import json,sys
d=json.load(sys.stdin); p=d["services"]["nginx"].get("ports",[])
assert len(p)==1 and str(p[0].get("host_ip"))=="127.0.0.1"
assert str(p[0].get("published"))=="18081" and int(p[0].get("target"))==80' \
    || { preflight_status=compose-override-invalid; return 1; }
  docker inspect "$FULLPASSWORD_CONTAINER" >/dev/null 2>&1 || { preflight_status=container-missing; return 1; }
  [[ "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$FULLPASSWORD_CONTAINER")" == fullpassword ]] \
    || { preflight_status=container-owner-mismatch; return 1; }
  [[ "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "$FULLPASSWORD_CONTAINER")" == nginx ]] \
    || { preflight_status=container-service-mismatch; return 1; }
  container_state="$(docker inspect --format '{{.State.Status}}' "$FULLPASSWORD_CONTAINER")"
  [[ "$container_state" == running ]] || { preflight_status=container-unhealthy; return 1; }
  docker exec "$FULLPASSWORD_CONTAINER" nginx -t >/dev/null 2>&1 || { preflight_status=container-nginx-invalid; return 1; }
  local published80 published443
  published80="$(docker port "$FULLPASSWORD_CONTAINER" 80/tcp 2>/dev/null || true)"
  published443="$(docker port "$FULLPASSWORD_CONTAINER" 443/tcp 2>/dev/null || true)"
  [[ -n "$published80" && -n "$published443" ]] || { preflight_status=public-ports-not-confirmed; return 1; }
  ports_state=fullpassword-public
  [[ -r "/etc/letsencrypt/live/$FULLPASSWORD_DOMAIN/fullchain.pem" \
    && -r "/etc/letsencrypt/live/$FULLPASSWORD_DOMAIN/privkey.pem" ]] \
    || { preflight_status=certificate-missing; return 1; }
  openssl x509 -in "/etc/letsencrypt/live/$FULLPASSWORD_DOMAIN/fullchain.pem" -noout -checkhost "$FULLPASSWORD_DOMAIN" >/dev/null 2>&1 \
    || { preflight_status=certificate-invalid; return 1; }
  certificate_state=valid
  if command -v nginx >/dev/null 2>&1; then
    nginx_state=installed
    nginx -t >/dev/null 2>&1 || { preflight_status=host-nginx-invalid; return 1; }
  fi
  curl --fail --silent --show-error --max-time 20 "https://$FULLPASSWORD_DOMAIN/" >/dev/null \
    || { preflight_status=fullpassword-health-failed; return 1; }
}

preflight_exit=0
read_only_preflight || preflight_exit=$?
cat <<EOF
DevFlow proxy migration diagnostic
  mode: $MODE
  fullpassword root: $FULLPASSWORD_ROOT (read-only)
  container: $FULLPASSWORD_CONTAINER ($container_state)
  public ports: $ports_state
  compose: $compose_version
  host nginx: $nginx_state
  certificate: $certificate_state
  neutral override: $OVERRIDE_FILE
  status: $preflight_status
  changes_applied: false
EOF

if [[ "$MODE" == check ]]; then
  [[ "$preflight_exit" -eq 0 ]] || exit 1
  log INFO 'Check concluido sem alteracoes.'
  exit 0
fi
[[ "$preflight_exit" -eq 0 ]] || die 'Preflight falhou; migracao bloqueada.'

cat <<EOF
Plano transacional:
  1. confirmar snapshot externo e capturar estado/hashes;
  2. preparar Nginx do host sem assumir 80/443;
  3. gravar override somente em $OVERRIDE_FILE;
  4. validar o Compose combinado;
  5. mover somente fullpassword_nginx para 127.0.0.1:18081;
  6. iniciar Nginx do host e validar HTTPS, autenticacao e API por health HTTP;
  7. em qualquer falha, parar Nginx do host e recriar somente o proxy com o Compose original.

Downtime zero nao e prometido; a janela de troca sera medida e registrada.
EOF
if [[ "$MODE" == dry-run ]]; then
  log INFO 'Dry-run concluido sem arquivos, reloads ou containers alterados.'
  exit 0
fi

require_root
detect_platform

install_nginx_stopped() {
  command -v nginx >/dev/null 2>&1 && return 0
  [[ ! -e /usr/sbin/policy-rc.d ]] || die 'policy-rc.d preexistente impede instalacao automatica segura do Nginx.'
  printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d
  chmod 0755 /usr/sbin/policy-rc.d
  export DEBIAN_FRONTEND=noninteractive
  if ! apt-get update || ! apt-get install -y nginx certbot python3-certbot-nginx; then
    rm -f -- /usr/sbin/policy-rc.d
    return 1
  fi
  rm -f -- /usr/sbin/policy-rc.d
  HOST_NGINX_INSTALLED_BY_MIGRATION=true
  systemctl stop nginx >/dev/null 2>&1 || true
  nginx -t >/dev/null 2>&1
}

render_artifacts() {
  local temp_root="$1"
  install -m 0600 "$SOURCE_ROOT/docker/fullpassword/fullpassword-host-nginx.override.yml.template" "$temp_root/override.yml"
  sed "s/__FULLPASSWORD_DOMAIN__/$FULLPASSWORD_DOMAIN/g" \
    "$SOURCE_ROOT/docker/nginx/fullpassword-host.conf.template" > "$temp_root/fullpassword.conf"
  chmod 0640 "$temp_root/fullpassword.conf"
  grep -Fqx "$MIGRATION_MARKER" "$temp_root/fullpassword.conf"
  docker compose --project-directory "$FULLPASSWORD_ROOT" -f "$FULLPASSWORD_COMPOSE_FILE" \
    -f "$temp_root/override.yml" config --format json \
    | python3 -c 'import json,sys
d=json.load(sys.stdin); p=d["services"]["nginx"].get("ports",[])
assert len(p)==1 and str(p[0].get("host_ip"))=="127.0.0.1"
assert str(p[0].get("published"))=="18081" and int(p[0].get("target"))==80'
}

write_state() {
  local original_active="$1" installed_by_migration="$2" started_at="$3" completed_at="$4" temporary
  temporary="$(mktemp "$MIGRATION_ROOT/.state.XXXXXX")"
  {
    printf 'marker=DEVFLOW_FULLPASSWORD_HOST_NGINX_V1\n'
    printf 'fullpassword_root=%s\n' "$FULLPASSWORD_ROOT"
    printf 'fullpassword_domain=%s\n' "$FULLPASSWORD_DOMAIN"
    printf 'override=%s\n' "$OVERRIDE_FILE"
    printf 'host_config=%s\n' "$HOST_CONFIG"
    printf 'nginx_was_active=%s\n' "$original_active"
    printf 'nginx_installed_by_migration=%s\n' "$installed_by_migration"
    printf 'started_at=%s\n' "$started_at"
    printf 'completed_at=%s\n' "$completed_at"
  } > "$temporary"
  chmod 0600 "$temporary"
  mv -f -- "$temporary" "$STATE_FILE"
}

load_state() {
  local line key value marker= state_root= state_domain= state_override= state_config=
  [[ -r "$STATE_FILE" ]] || return 1
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^([a-z_]+)=([A-Za-z0-9._:/+-]+)$ ]] || return 1
    key="${BASH_REMATCH[1]}"; value="${BASH_REMATCH[2]}"
    case "$key" in
      marker) marker="$value" ;;
      fullpassword_root) state_root="$value" ;;
      fullpassword_domain) state_domain="$value" ;;
      override) state_override="$value" ;;
      host_config) state_config="$value" ;;
      nginx_was_active) ORIGINAL_NGINX_ACTIVE="$value" ;;
      nginx_installed_by_migration) HOST_NGINX_INSTALLED_BY_MIGRATION="$value" ;;
      started_at|completed_at) : ;;
      *) return 1 ;;
    esac
  done < "$STATE_FILE"
  [[ "$marker" == DEVFLOW_FULLPASSWORD_HOST_NGINX_V1 \
    && "$state_root" == "$FULLPASSWORD_ROOT" \
    && "$state_domain" == "$FULLPASSWORD_DOMAIN" \
    && "$state_override" == "$OVERRIDE_FILE" \
    && "$state_config" == "$HOST_CONFIG" ]] || return 1
  [[ "$ORIGINAL_NGINX_ACTIVE" == true || "$ORIGINAL_NGINX_ACTIVE" == false ]] || return 1
  [[ "$HOST_NGINX_INSTALLED_BY_MIGRATION" == true || "$HOST_NGINX_INSTALLED_BY_MIGRATION" == false ]] || return 1
}

rollback_transaction() {
  local failures=0
  set +e
  systemctl stop nginx >/dev/null 2>&1
  rm -f -- "$HOST_ENABLED" "$HOST_CONFIG"
  docker compose --project-directory "$FULLPASSWORD_ROOT" -f "$FULLPASSWORD_COMPOSE_FILE" up -d --no-deps --force-recreate nginx
  [[ $? -eq 0 ]] || failures=$((failures + 1))
  docker exec "$FULLPASSWORD_CONTAINER" nginx -t >/dev/null 2>&1 || failures=$((failures + 1))
  curl --fail --silent --show-error --max-time 20 "https://$FULLPASSWORD_DOMAIN/" >/dev/null || failures=$((failures + 1))
  [[ "$ORIGINAL_NGINX_ACTIVE" != true ]] || systemctl start nginx >/dev/null 2>&1 || failures=$((failures + 1))
  set -e
  [[ "$failures" -eq 0 ]]
}

on_failure() {
  local code=$?
  trap - ERR
  if [[ "$MIGRATION_STARTED" == true ]]; then
    rollback_transaction && log WARN 'Rollback automatico da migracao concluido.' \
      || log ERROR 'Rollback incompleto; intervencao manual obrigatoria.'
  fi
  log ERROR "Migracao interrompida (codigo $code)."
  exit "$code"
}

if [[ "$MODE" == rollback ]]; then
  load_state || die 'Estado de migracao ausente ou invalido; rollback recusado.'
  [[ ! -e /etc/nginx/sites-available/devflow.conf && ! -e /etc/nginx/conf.d/devflow.conf ]] \
    || die 'DevFlow ja utiliza o Nginx do host; remova-o de forma controlada antes deste rollback global.'
  confirm_exact 'REVERTER PROXY DO HOST' 'Confirma restaurar fullpassword_nginx em 80/443?'
  rollback_transaction || die 'Rollback falhou; consulte os servicos manualmente.'
  rm -f -- "$STATE_FILE" "$OVERRIDE_FILE"
  log INFO 'Rollback concluido; o repositorio Full Password permaneceu inalterado.'
  exit 0
fi

confirm_exact 'SNAPSHOT CONFIRMADO' 'Confirme que existe snapshot externo recente da VPS.'
confirm_exact 'MIGRAR PROXY PUBLICO' 'Confirma a troca controlada das portas publicas?'
[[ ! -e "$STATE_FILE" ]] || die 'Uma migracao ja esta registrada.'
systemctl is-active --quiet nginx 2>/dev/null && ORIGINAL_NGINX_ACTIVE=true
temp_root="$(mktemp -d "${TMPDIR:-/tmp}/devflow-proxy-migration.XXXXXX")"
cleanup_temp() { [[ "$temp_root" == "${TMPDIR:-/tmp}/devflow-proxy-migration."* ]] && rm -rf -- "$temp_root"; }
trap cleanup_temp EXIT
install_nginx_stopped
render_artifacts "$temp_root"
install -d -m 0700 "$MIGRATION_ROOT" "$BACKUP_ROOT"
install -d -m 0750 "$LOG_ROOT"
MIGRATION_LOG="$LOG_ROOT/proxy-migration-$(date -u +%Y%m%dT%H%M%SZ).log"
touch "$MIGRATION_LOG"; chmod 0640 "$MIGRATION_LOG"
exec > >(redact_stream | tee -a "$MIGRATION_LOG") 2>&1
started_at="$(timestamp)"
sha256sum "$FULLPASSWORD_COMPOSE_FILE" > "$BACKUP_ROOT/original-compose.sha256"
docker inspect --format 'name={{.Name}}\nimage={{.Config.Image}}\nproject={{index .Config.Labels "com.docker.compose.project"}}\nservice={{index .Config.Labels "com.docker.compose.service"}}\nnetworks={{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}\nports={{json .HostConfig.PortBindings}}' \
  "$FULLPASSWORD_CONTAINER" > "$BACKUP_ROOT/fullpassword-nginx.state.txt"
install -m 0600 "$temp_root/override.yml" "$OVERRIDE_FILE"
install -m 0640 "$temp_root/fullpassword.conf" "$HOST_CONFIG"
ln -sfn "$HOST_CONFIG" "$HOST_ENABLED"
nginx -t >/dev/null 2>&1
MIGRATION_STARTED=true
trap on_failure ERR
perform_migration() {
  docker compose --project-directory "$FULLPASSWORD_ROOT" -f "$FULLPASSWORD_COMPOSE_FILE" -f "$OVERRIDE_FILE" \
    up -d --no-deps --force-recreate nginx || return 1
  if [[ "$(docker port "$FULLPASSWORD_CONTAINER" 80/tcp 2>/dev/null)" != 127.0.0.1:18081 ]]; then
    log ERROR 'Publicacao loopback nao foi comprovada.'
    return 1
  fi
  if [[ -n "$(docker port "$FULLPASSWORD_CONTAINER" 443/tcp 2>/dev/null || true)" ]]; then
    log ERROR 'Porta 443 permaneceu publicada pelo container.'
    return 1
  fi
  systemctl enable --now nginx || return 1
  nginx -t >/dev/null 2>&1 || return 1
  curl --fail --silent --show-error --max-time 20 "https://$FULLPASSWORD_DOMAIN/" >/dev/null || return 1
}
perform_migration
completed_at="$(timestamp)"
write_state "$ORIGINAL_NGINX_ACTIVE" "$HOST_NGINX_INSTALLED_BY_MIGRATION" "$started_at" "$completed_at"
trap - ERR
log INFO "Migracao concluida em janela iniciada em $started_at e finalizada em $completed_at."
