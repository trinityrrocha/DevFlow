#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=providers/provider-contract.sh
. "$SCRIPT_DIR/providers/provider-contract.sh"

MODE=check
MODE_EXPLICIT=false
FULLPASSWORD_ROOT="${FULLPASSWORD_ROOT:-/opt/fullpassword}"
FULLPASSWORD_COMPOSE_FILE="$FULLPASSWORD_ROOT/docker-compose.yml"
FULLPASSWORD_CONTAINER=fullpassword_nginx
FULLPASSWORD_DOMAIN="${FULLPASSWORD_DOMAIN:-pw.sti1.com.br}"
LOOPBACK_HOST=127.0.0.1
LOOPBACK_PORT=18081
MIGRATION_ROOT="${DEVFLOW_PROXY_MIGRATION_ROOT:-/etc/devflow/proxy-migrations}"
OVERRIDE_FILE="$MIGRATION_ROOT/fullpassword-host-nginx.override.yml"
STATE_FILE="$MIGRATION_ROOT/fullpassword-host-nginx.state"
BACKUP_ROOT="$MIGRATION_ROOT/backups"
INSTALLATION_STATE_FILE="$DEVFLOW_STATE_ROOT/installation.json"
INSTALLATION_STATE_BACKUP="$BACKUP_ROOT/devflow-installation.json"
LOG_ROOT="${DEVFLOW_PROXY_MIGRATION_LOG_ROOT:-/var/log/devflow}"
DRY_RUN_REPORT="$LOG_ROOT/proxy-migration-dry-run.log"
HOST_CONFIG=/etc/nginx/sites-available/fullpassword-proxy-migration.conf
HOST_ENABLED=/etc/nginx/sites-enabled/fullpassword-proxy-migration.conf
MIGRATION_MARKER='# Managed by DevFlow proxy migration. Independent Full Password host route.'
MIGRATION_STARTED=false
ARTIFACTS_APPLIED=false
ORIGINAL_NGINX_ACTIVE=false
HOST_NGINX_INSTALLED_BY_MIGRATION=false
EVIDENCE_TEMP_ROOT=
CURRENT_PORT_MAPPINGS=
BLOCKERS=()

compose_version=absent
container_state=absent
compose_validation_attempted=false
compose_validation_exit_code=not-executed
compose_merge_valid=false
original_services_preserved=false
original_mounts_preserved=false
original_networks_preserved=false
original_environment_preserved=false
original_restart_policy_preserved=false
public_ports_removed=false
loopback_port_added=false
unexpected_changes=true
rollback_compose_valid=false
rollback_public_port_80_present=false
rollback_public_port_443_present=false
rollback_nginx_service_present=false
current_public_port_80_present=false
current_public_port_443_present=false
loopback_socket_available=false
loopback_docker_publication_available=false
loopback_container_conflict_absent=false
loopback_systemd_conflict_absent=false
loopback_config_duplicate_absent=false
loopback_port_available=false
host_nginx_vhost_generated=false
host_nginx_upstream="$LOOPBACK_HOST:$LOOPBACK_PORT"
host_nginx_routes_preserved=false
host_nginx_config_valid=false
host_nginx_current_config_valid=false
host_nginx_reload_executed=false
host_nginx_started=false
host_nginx_installed=false
host_nginx_service_active=false
host_nginx_service_enabled=false
host_nginx_process_running=false
host_nginx_previous_attempt_present=false
host_nginx_currently_owns_public_ports=false
host_nginx_public_listener_conflict=false
host_nginx_listener_80_present=false
host_nginx_listener_443_present=false
host_public_listener_count=0
host_nginx_state_explanation=not-installed
fullpassword_public_http_reachable=false
fullpassword_public_https_reachable=false
fullpassword_certificate_valid=false
fullpassword_frontend_healthy=false
fullpassword_backend_healthy=false
fullpassword_health_current=false
planned_upstream_runtime_test=not-executed
planned_upstream_runtime_reason=migration-not-applied
rollback_sequence_valid=true
rollback_stops_host_nginx_first=true
rollback_restores_port_80=true
rollback_restores_port_443=true
rollback_health_check_defined=true
rollback_ready=false
migration_ready=false
changes_applied=false
diagnostic_report_written=false
environment_os=linux-unknown

usage() {
  cat <<'EOF'
Uso:
  sudo ./scripts/migrate-proxy-to-host-nginx.sh --check
  sudo ./scripts/migrate-proxy-to-host-nginx.sh --dry-run
  sudo ./scripts/migrate-proxy-to-host-nginx.sh --migrate
  sudo ./scripts/migrate-proxy-to-host-nginx.sh --rollback

--check nao persiste arquivos. --dry-run persiste somente um relatorio sanitizado.
Nenhum dos dois altera portas, containers ou Nginx. --migrate e --rollback exigem
confirmacao literal e nunca sao chamados pelo instalador comum.
EOF
}

set_mode() {
  [[ "$MODE_EXPLICIT" == false ]] || die 'Informe somente um modo.'
  MODE="$1"
  MODE_EXPLICIT=true
}

add_blocker() {
  local blocker="$1" existing
  for existing in "${BLOCKERS[@]:-}"; do
    [[ "$existing" != "$blocker" ]] || return 0
  done
  BLOCKERS+=("$blocker")
}

bool_text() {
  [[ "$1" == true ]] && printf 'true' || printf 'false'
}

cleanup_evidence_temp() {
  if [[ -n "$EVIDENCE_TEMP_ROOT" && "$EVIDENCE_TEMP_ROOT" == "${TMPDIR:-/tmp}/devflow-proxy-evidence."* ]]; then
    rm -rf -- "$EVIDENCE_TEMP_ROOT"
  fi
}

render_artifacts() {
  local temp_root="$1"
  install -m 0600 "$SOURCE_ROOT/docker/fullpassword/fullpassword-host-nginx.override.yml.template" "$temp_root/override.yml"
  sed "s/__FULLPASSWORD_DOMAIN__/$FULLPASSWORD_DOMAIN/g" \
    "$SOURCE_ROOT/docker/nginx/fullpassword-host.conf.template" > "$temp_root/fullpassword.conf"
  chmod 0600 "$temp_root/fullpassword.conf"
  grep -Fqx "$MIGRATION_MARKER" "$temp_root/fullpassword.conf"
}

collect_current_port_mappings() {
  local target binding normalized
  CURRENT_PORT_MAPPINGS=
  for target in 80 443; do
    while IFS= read -r binding; do
      [[ -n "$binding" ]] || continue
      normalized="$binding"
      [[ "$normalized" != :::* ]] || normalized="[::]:${normalized##*:}"
      CURRENT_PORT_MAPPINGS+="  $normalized -> $FULLPASSWORD_CONTAINER:$target"$'\n'
      case "$target:$normalized" in
        80:0.0.0.0:80|80:'[::]:80') current_public_port_80_present=true ;;
        443:0.0.0.0:443|443:'[::]:443') current_public_port_443_present=true ;;
      esac
    done < <(docker port "$FULLPASSWORD_CONTAINER" "$target/tcp" 2>/dev/null || true)
  done
  [[ "$current_public_port_80_present" == true ]] || add_blocker current-public-port-80-not-confirmed
  [[ "$current_public_port_443_present" == true ]] || add_blocker current-public-port-443-not-confirmed
}

validate_loopback_availability() {
  local socket_conflict=false docker_conflict=false systemd_conflict=false config_conflict=false
  if command -v ss >/dev/null 2>&1; then
    if ss -H -ltn 2>/dev/null | awk '{print $4}' | grep -Eq '(^|\]|:|\*)[:.]?18081$'; then
      socket_conflict=true
    fi
    [[ "$socket_conflict" == true ]] || loopback_socket_available=true
  else
    add_blocker socket-inspection-unavailable
  fi

  if docker ps -a --format '{{.Names}}|{{.Ports}}' 2>/dev/null | grep -Eq '(^|[^0-9])18081([^0-9]|$)'; then
    docker_conflict=true
  fi
  [[ "$docker_conflict" == true ]] || {
    loopback_docker_publication_available=true
    loopback_container_conflict_absent=true
  }

  if command -v systemctl >/dev/null 2>&1; then
    if systemctl list-sockets --all --no-legend 2>/dev/null | grep -Eq '(^|[^0-9])18081([^0-9]|$)'; then
      systemd_conflict=true
    fi
    [[ "$systemd_conflict" == true ]] || loopback_systemd_conflict_absent=true
  else
    add_blocker systemd-inspection-unavailable
  fi

  local search_root
  for search_root in /etc/nginx/sites-available /etc/nginx/conf.d /etc/systemd/system /etc/docker; do
    [[ -d "$search_root" ]] || continue
    if grep -RIl --exclude='*.key' --exclude='*.pem' -- "$LOOPBACK_PORT" "$search_root" 2>/dev/null | grep -q .; then
      config_conflict=true
    fi
  done
  [[ "$config_conflict" == true ]] || loopback_config_duplicate_absent=true

  if [[ "$loopback_socket_available" == true \
    && "$loopback_docker_publication_available" == true \
    && "$loopback_container_conflict_absent" == true \
    && "$loopback_systemd_conflict_absent" == true \
    && "$loopback_config_duplicate_absent" == true ]]; then
    loopback_port_available=true
  else
    add_blocker loopback-port-in-use
  fi
}

read_compose_result() {
  local file="$1" key value
  while IFS='=' read -r key value; do
    case "$key" in
      compose_merge_valid|original_services_preserved|original_mounts_preserved|original_networks_preserved|original_environment_preserved|original_restart_policy_preserved|public_ports_removed|loopback_port_added|unexpected_changes|rollback_compose_valid|rollback_public_port_80_present|rollback_public_port_443_present|rollback_nginx_service_present)
        [[ "$value" == true || "$value" == false ]] && printf -v "$key" '%s' "$value"
        ;;
      compose_validation_error) : ;;
    esac
  done < "$file"
}

validate_compose_evidence() {
  local original_json="$EVIDENCE_TEMP_ROOT/original-compose.json"
  local merged_json="$EVIDENCE_TEMP_ROOT/merged-compose.json"
  local validator_result="$EVIDENCE_TEMP_ROOT/compose-validation.txt"
  local original_exit merged_exit validator_exit
  compose_validation_attempted=true
  set +e
  docker compose --project-directory "$FULLPASSWORD_ROOT" -f "$FULLPASSWORD_COMPOSE_FILE" \
    config --format json > "$original_json" 2>/dev/null
  original_exit=$?
  docker compose --project-directory "$FULLPASSWORD_ROOT" -f "$FULLPASSWORD_COMPOSE_FILE" \
    -f "$EVIDENCE_TEMP_ROOT/override.yml" config --format json > "$merged_json" 2>/dev/null
  merged_exit=$?
  compose_validation_exit_code="$merged_exit"
  if [[ "$original_exit" -eq 0 && "$merged_exit" -eq 0 ]]; then
    python3 "$SCRIPT_DIR/validate-proxy-migration-compose.py" "$original_json" "$merged_json" \
      > "$validator_result" 2>/dev/null
    validator_exit=$?
  else
    validator_exit=1
  fi
  set -e
  [[ -r "$validator_result" ]] && read_compose_result "$validator_result"
  if [[ "$original_exit" -ne 0 ]]; then
    add_blocker rollback-compose-invalid
  fi
  if [[ "$merged_exit" -ne 0 || "$validator_exit" -ne 0 || "$compose_merge_valid" != true ]]; then
    add_blocker compose-override-invalid
  fi
}

validate_host_nginx_evidence() {
  local wrapper="$EVIDENCE_TEMP_ROOT/nginx-validation.conf" listener_lines=
  host_nginx_vhost_generated=true
  if grep -Fq 'proxy_pass http://127.0.0.1:18081;' "$EVIDENCE_TEMP_ROOT/fullpassword.conf" \
    && grep -Fq 'location /api/' "$EVIDENCE_TEMP_ROOT/fullpassword.conf" \
    && grep -Fq 'location ^~ /api/system/backup/restore' "$EVIDENCE_TEMP_ROOT/fullpassword.conf" \
    && grep -Fq 'client_max_body_size 201m;' "$EVIDENCE_TEMP_ROOT/fullpassword.conf" \
    && grep -Fq 'proxy_read_timeout 1800s;' "$EVIDENCE_TEMP_ROOT/fullpassword.conf" \
    && grep -Fq 'X-Forwarded-Proto $scheme' "$EVIDENCE_TEMP_ROOT/fullpassword.conf" \
    && grep -Fq 'X-Real-IP $remote_addr' "$EVIDENCE_TEMP_ROOT/fullpassword.conf"; then
    host_nginx_routes_preserved=true
  else
    add_blocker host-nginx-routes-incomplete
  fi

  if command -v nginx >/dev/null 2>&1; then
    host_nginx_installed=true
    nginx -t >/dev/null 2>&1 && host_nginx_current_config_valid=true
    cat > "$wrapper" <<EOF
worker_processes 1;
pid $EVIDENCE_TEMP_ROOT/nginx.pid;
error_log $EVIDENCE_TEMP_ROOT/nginx-error.log notice;
events { worker_connections 64; }
http {
    include /etc/nginx/mime.types;
    include $EVIDENCE_TEMP_ROOT/fullpassword.conf;
}
EOF
    chmod 0600 "$wrapper"
    nginx -t -p / -c "$wrapper" >/dev/null 2>&1 && host_nginx_config_valid=true
  else
    add_blocker host-nginx-not-installed
  fi

  systemctl is-active --quiet nginx 2>/dev/null && host_nginx_service_active=true
  systemctl is-enabled --quiet nginx 2>/dev/null && host_nginx_service_enabled=true
  pgrep -x nginx >/dev/null 2>&1 && host_nginx_process_running=true
  if [[ "$host_nginx_process_running" == true && "$host_nginx_service_active" == false ]]; then
    add_blocker host-nginx-process-outside-systemd
  elif [[ "$host_nginx_service_active" == true && "$host_nginx_process_running" == false ]]; then
    add_blocker host-nginx-service-process-mismatch
  fi
  [[ ! -e "$STATE_FILE" && ! -e "$OVERRIDE_FILE" && ! -e "$HOST_CONFIG" && ! -e "$HOST_ENABLED" ]] \
    || host_nginx_previous_attempt_present=true
  [[ "$host_nginx_previous_attempt_present" == false ]] || add_blocker previous-migration-artifacts-present

  if command -v ss >/dev/null 2>&1; then
    listener_lines="$(ss -H -ltnp 2>/dev/null | awk '$4 ~ /:80$/ || $4 ~ /:443$/ {print}' || true)"
    host_public_listener_count="$(printf '%s\n' "$listener_lines" | grep -c . || true)"
    if printf '%s\n' "$listener_lines" | grep -q 'nginx'; then
      host_nginx_currently_owns_public_ports=true
    fi
    printf '%s\n' "$listener_lines" | grep -E ':80([^0-9]|$)' | grep -q nginx && host_nginx_listener_80_present=true
    printf '%s\n' "$listener_lines" | grep -E ':443([^0-9]|$)' | grep -q nginx && host_nginx_listener_443_present=true
    if printf '%s\n' "$listener_lines" | grep -Ev '(^$|nginx|docker-proxy|dockerd)' | grep -q .; then
      host_nginx_public_listener_conflict=true
    fi
  fi

  if [[ "$host_nginx_service_active" == true && "$host_nginx_currently_owns_public_ports" == false ]]; then
    host_nginx_state_explanation=active-without-public-listeners
  elif [[ "$host_nginx_service_active" == true ]]; then
    host_nginx_state_explanation=active-with-public-listeners
  elif [[ "$host_nginx_installed" == true ]]; then
    host_nginx_state_explanation=installed-and-inactive
  fi
  [[ "$host_nginx_currently_owns_public_ports" == false ]] || add_blocker host-nginx-already-owns-public-ports
  [[ "$host_nginx_public_listener_conflict" == false ]] || add_blocker public-listener-conflict
  [[ "$host_nginx_current_config_valid" == true ]] || add_blocker host-nginx-current-config-invalid
  [[ "$host_nginx_config_valid" == true ]] || add_blocker host-nginx-planned-config-invalid
}

http_code() {
  curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 20 "$1" 2>/dev/null || printf '000'
}

code_is_healthy() {
  [[ "$1" =~ ^(2|3)[0-9][0-9]$ ]]
}

code_is_success() {
  [[ "$1" =~ ^2[0-9][0-9]$ ]]
}

validate_fullpassword_health() {
  local http_status https_status api_status api_body="$EVIDENCE_TEMP_ROOT/fullpassword-health.json"
  http_status="$(http_code "http://$FULLPASSWORD_DOMAIN/")"
  https_status="$(http_code "https://$FULLPASSWORD_DOMAIN/")"
  code_is_healthy "$http_status" && fullpassword_public_http_reachable=true
  code_is_success "$https_status" && {
    fullpassword_public_https_reachable=true
    fullpassword_frontend_healthy=true
  }

  if [[ -r "/etc/letsencrypt/live/$FULLPASSWORD_DOMAIN/fullchain.pem" \
    && -r "/etc/letsencrypt/live/$FULLPASSWORD_DOMAIN/privkey.pem" ]] \
    && openssl x509 -in "/etc/letsencrypt/live/$FULLPASSWORD_DOMAIN/fullchain.pem" \
      -noout -checkhost "$FULLPASSWORD_DOMAIN" >/dev/null 2>&1 \
    && openssl x509 -in "/etc/letsencrypt/live/$FULLPASSWORD_DOMAIN/fullchain.pem" \
      -noout -checkend 86400 >/dev/null 2>&1 \
    && timeout 15 openssl s_client -connect "$FULLPASSWORD_DOMAIN:443" -servername "$FULLPASSWORD_DOMAIN" \
      -verify_hostname "$FULLPASSWORD_DOMAIN" -verify_return_error </dev/null >/dev/null 2>&1; then
    fullpassword_certificate_valid=true
  fi

  set +e
  api_status="$(curl --silent --show-error --output "$api_body" --write-out '%{http_code}' \
    --max-time 20 "https://$FULLPASSWORD_DOMAIN/api/health" 2>/dev/null)"
  set -e
  if [[ "$api_status" == 200 ]] && python3 - "$api_body" >/dev/null 2>&1 <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as stream:
    value = json.load(stream)
assert value.get("status") == "ok"
PY
  then
    fullpassword_backend_healthy=true
  fi

  if [[ "$fullpassword_public_http_reachable" == true \
    && "$fullpassword_public_https_reachable" == true \
    && "$fullpassword_certificate_valid" == true \
    && "$fullpassword_frontend_healthy" == true \
    && "$fullpassword_backend_healthy" == true ]]; then
    fullpassword_health_current=true
  else
    add_blocker fullpassword-current-health-failed
  fi
}

evaluate_readiness() {
  local gate
  local required_gates=(
    compose_merge_valid original_services_preserved original_mounts_preserved
    original_networks_preserved original_environment_preserved original_restart_policy_preserved
    public_ports_removed loopback_port_added rollback_compose_valid rollback_public_port_80_present
    rollback_public_port_443_present rollback_nginx_service_present current_public_port_80_present
    current_public_port_443_present loopback_port_available host_nginx_vhost_generated
    host_nginx_routes_preserved host_nginx_installed host_nginx_current_config_valid
    host_nginx_config_valid fullpassword_health_current
  )
  for gate in "${required_gates[@]}"; do
    [[ "${!gate}" == true ]] || add_blocker "gate-failed-$gate"
  done
  [[ "$unexpected_changes" == false ]] || add_blocker unexpected-compose-changes
  [[ "$host_nginx_currently_owns_public_ports" == false ]] || add_blocker host-nginx-public-port-conflict
  [[ "$host_nginx_public_listener_conflict" == false ]] || add_blocker third-party-public-port-conflict

  if [[ "$rollback_compose_valid" == true \
    && "$rollback_sequence_valid" == true \
    && "$rollback_stops_host_nginx_first" == true \
    && "$rollback_restores_port_80" == true \
    && "$rollback_restores_port_443" == true \
    && "$rollback_health_check_defined" == true ]]; then
    rollback_ready=true
  fi
  [[ "$rollback_ready" == true ]] || add_blocker rollback-not-ready
  [[ "${#BLOCKERS[@]}" -eq 0 ]] && migration_ready=true
}

run_read_only_evidence() {
  command -v python3 >/dev/null 2>&1 || add_blocker python-missing
  command -v docker >/dev/null 2>&1 || add_blocker docker-missing
  command -v curl >/dev/null 2>&1 || add_blocker curl-missing
  command -v openssl >/dev/null 2>&1 || add_blocker openssl-missing
  command -v timeout >/dev/null 2>&1 || add_blocker timeout-missing
  if [[ -r /etc/os-release ]]; then
    environment_os="$(awk -F= '
      $1 == "ID" { gsub(/^"|"$/, "", $2); id=$2 }
      $1 == "VERSION_ID" { gsub(/^"|"$/, "", $2); version=$2 }
      END { if (id ~ /^[a-z0-9._-]+$/ && version ~ /^[A-Za-z0-9._-]+$/) print id "-" version; else print "linux-unknown" }
    ' /etc/os-release)"
  fi
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    compose_version="$(docker compose version --short 2>/dev/null | sed 's/^v//' || true)"
    version_at_least "$compose_version" 2.24.4 || add_blocker compose-too-old
  else
    add_blocker compose-missing
  fi
  [[ -r "$FULLPASSWORD_COMPOSE_FILE" ]] || add_blocker compose-unreadable

  EVIDENCE_TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/devflow-proxy-evidence.XXXXXX")"
  chmod 0700 "$EVIDENCE_TEMP_ROOT"
  trap cleanup_evidence_temp EXIT HUP INT TERM
  render_artifacts "$EVIDENCE_TEMP_ROOT" || add_blocker artifact-render-failed

  if docker inspect "$FULLPASSWORD_CONTAINER" >/dev/null 2>&1; then
    container_state="$(docker inspect --format '{{.State.Status}}' "$FULLPASSWORD_CONTAINER" 2>/dev/null || printf unknown)"
    [[ "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$FULLPASSWORD_CONTAINER" 2>/dev/null || true)" == fullpassword ]] \
      || add_blocker container-owner-mismatch
    [[ "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "$FULLPASSWORD_CONTAINER" 2>/dev/null || true)" == nginx ]] \
      || add_blocker container-service-mismatch
    [[ "$container_state" == running ]] || add_blocker container-not-running
    docker exec "$FULLPASSWORD_CONTAINER" nginx -t >/dev/null 2>&1 || add_blocker container-nginx-invalid
    collect_current_port_mappings
  else
    add_blocker container-missing
  fi

  validate_loopback_availability
  if [[ -r "$FULLPASSWORD_COMPOSE_FILE" && "$compose_version" != absent \
    && -x "$(command -v python3 2>/dev/null || true)" ]]; then
    validate_compose_evidence
  fi
  validate_host_nginx_evidence
  validate_fullpassword_health
  evaluate_readiness
}

render_evidence_report() {
  local blocker
  cat <<EOF
DevFlow proxy migration evidence
date=$(timestamp)
version=$DEVFLOW_VERSION
commit=$(git -C "$SOURCE_ROOT" rev-parse HEAD 2>/dev/null | grep -E '^[0-9a-f]{40}$' || printf unknown)
mode=$MODE
environment=$environment_os
fullpassword_root=$FULLPASSWORD_ROOT (read-only)
container=$FULLPASSWORD_CONTAINER
container_state=$container_state
compose_version=$compose_version
current_port_mappings:
${CURRENT_PORT_MAPPINGS:-  none-confirmed}
current_public_port_80_present=$current_public_port_80_present
current_public_port_443_present=$current_public_port_443_present
planned_port_mapping=$LOOPBACK_HOST:$LOOPBACK_PORT->$FULLPASSWORD_CONTAINER:80
loopback_host=$LOOPBACK_HOST
loopback_port=$LOOPBACK_PORT
loopback_socket_available=$loopback_socket_available
loopback_docker_publication_available=$loopback_docker_publication_available
loopback_container_conflict_absent=$loopback_container_conflict_absent
loopback_systemd_conflict_absent=$loopback_systemd_conflict_absent
loopback_config_duplicate_absent=$loopback_config_duplicate_absent
loopback_port_available=$loopback_port_available
compose_validation_attempted=$compose_validation_attempted
compose_validation_exit_code=$compose_validation_exit_code
compose_merge_valid=$compose_merge_valid
original_services_preserved=$original_services_preserved
original_mounts_preserved=$original_mounts_preserved
original_networks_preserved=$original_networks_preserved
original_environment_preserved=$original_environment_preserved
original_restart_policy_preserved=$original_restart_policy_preserved
public_ports_removed=$public_ports_removed
loopback_port_added=$loopback_port_added
unexpected_changes=$unexpected_changes
rollback_compose_valid=$rollback_compose_valid
rollback_public_port_80_present=$rollback_public_port_80_present
rollback_public_port_443_present=$rollback_public_port_443_present
rollback_nginx_service_present=$rollback_nginx_service_present
host_nginx_vhost_generated=$host_nginx_vhost_generated
host_nginx_upstream=$host_nginx_upstream
host_nginx_routes_preserved=$host_nginx_routes_preserved
host_nginx_config_valid=$host_nginx_config_valid
host_nginx_current_config_valid=$host_nginx_current_config_valid
host_nginx_reload_executed=$host_nginx_reload_executed
host_nginx_started=$host_nginx_started
host_nginx_installed=$host_nginx_installed
host_nginx_service_active=$host_nginx_service_active
host_nginx_service_enabled=$host_nginx_service_enabled
host_nginx_process_running=$host_nginx_process_running
host_nginx_previous_attempt_present=$host_nginx_previous_attempt_present
host_nginx_currently_owns_public_ports=$host_nginx_currently_owns_public_ports
host_nginx_public_listener_conflict=$host_nginx_public_listener_conflict
host_nginx_listener_80_present=$host_nginx_listener_80_present
host_nginx_listener_443_present=$host_nginx_listener_443_present
host_public_listener_count=$host_public_listener_count
host_nginx_state_explanation=$host_nginx_state_explanation
fullpassword_public_http_reachable=$fullpassword_public_http_reachable
fullpassword_public_https_reachable=$fullpassword_public_https_reachable
fullpassword_certificate_valid=$fullpassword_certificate_valid
fullpassword_frontend_healthy=$fullpassword_frontend_healthy
fullpassword_backend_healthy=$fullpassword_backend_healthy
fullpassword_health_current=$fullpassword_health_current
planned_upstream_runtime_test=$planned_upstream_runtime_test
reason=$planned_upstream_runtime_reason
rollback_sequence_valid=$rollback_sequence_valid
rollback_stops_host_nginx_first=$rollback_stops_host_nginx_first
rollback_restores_port_80=$rollback_restores_port_80
rollback_restores_port_443=$rollback_restores_port_443
rollback_health_check_defined=$rollback_health_check_defined
rollback_ready=$rollback_ready
blockers:
EOF
  if [[ "${#BLOCKERS[@]}" -eq 0 ]]; then
    printf '  none\n'
  else
    for blocker in "${BLOCKERS[@]}"; do printf '  - %s\n' "$blocker"; done
  fi
  cat <<EOF
migration_ready=$migration_ready
changes_applied=$changes_applied
infrastructure_changes_applied=false
diagnostic_report_written=$diagnostic_report_written
EOF
}

write_dry_run_report() {
  local temporary report_content="$1"
  install -d -m 0750 "$LOG_ROOT"
  temporary="$(mktemp "$LOG_ROOT/.proxy-migration-dry-run.XXXXXX")"
  printf '%s\n' "$report_content" | redact_stream > "$temporary"
  chmod 0640 "$temporary"
  mv -f -- "$temporary" "$DRY_RUN_REPORT"
  diagnostic_report_written=true
}

print_transaction_plan() {
  cat <<'EOF'
transaction_plan:
  1. confirm-external-snapshot
  2. capture-state-hashes-and-current-mappings
  3. validate-current-fullpassword-health
  4. prepare-and-validate-host-nginx-vhost
  5. validate-original-and-merged-compose
  6. recheck-127.0.0.1:18081
  7. open-maintenance-window
  8. recreate-only-fullpassword_nginx-on-loopback
  9. validate-loopback-frontend-api-and-auth-boundary
  10. start-host-nginx-only-after-loopback-health
  11. validate-public-port-ownership
  12. validate-public-http-https-frontend-api-and-auth-boundary
  13. close-maintenance-window-and-record-duration
rollback_plan:
  1. stop-host-nginx
  2. confirm-public-ports-released
  3. remove-temporary-host-route
  4. recreate-only-fullpassword_nginx-with-original-compose
  5. confirm-public-80-and-443-mappings
  6. validate-container-nginx
  7. validate-public-https-frontend-and-api
  8. record-rollback
EOF
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
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
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

public_ports_are_free() {
  ! ss -H -ltnp 2>/dev/null | awk '$4 ~ /:80$/ || $4 ~ /:443$/ {print}' | grep -q .
}

original_public_mappings_present() {
  docker port "$FULLPASSWORD_CONTAINER" 80/tcp 2>/dev/null | grep -Eq '^(0\.0\.0\.0|:::):80$' \
    && docker port "$FULLPASSWORD_CONTAINER" 443/tcp 2>/dev/null | grep -Eq '^(0\.0\.0\.0|:::):443$'
}

validate_public_runtime() {
  local auth_status
  auth_status="$(http_code "https://$FULLPASSWORD_DOMAIN/api/auth/me")"
  code_is_healthy "$(http_code "http://$FULLPASSWORD_DOMAIN/")" \
    && code_is_success "$(http_code "https://$FULLPASSWORD_DOMAIN/")" \
    && [[ "$(http_code "https://$FULLPASSWORD_DOMAIN/api/health")" == 200 ]] \
    && [[ "$auth_status" == 401 ]] \
    && timeout 15 openssl s_client -connect "$FULLPASSWORD_DOMAIN:443" -servername "$FULLPASSWORD_DOMAIN" \
      -verify_hostname "$FULLPASSWORD_DOMAIN" -verify_return_error </dev/null >/dev/null 2>&1
}

rollback_transaction() {
  local failures=0
  set +e
  systemctl stop nginx >/dev/null 2>&1
  public_ports_are_free || failures=$((failures + 1))
  rm -f -- "$HOST_ENABLED" "$HOST_CONFIG"
  docker compose --project-directory "$FULLPASSWORD_ROOT" -f "$FULLPASSWORD_COMPOSE_FILE" \
    up -d --no-deps --force-recreate nginx
  [[ $? -eq 0 ]] || failures=$((failures + 1))
  original_public_mappings_present || failures=$((failures + 1))
  docker exec "$FULLPASSWORD_CONTAINER" nginx -t >/dev/null 2>&1 || failures=$((failures + 1))
  validate_public_runtime || failures=$((failures + 1))
  [[ "$ORIGINAL_NGINX_ACTIVE" != true ]] || systemctl start nginx >/dev/null 2>&1 || failures=$((failures + 1))
  set -e
  [[ "$failures" -eq 0 ]]
}

promote_proxy_migration_state() {
  local executed="$1"
  [[ "$executed" == true || "$executed" == false ]] || return 1
  validate_installed_state_consistency "$INSTALLATION_STATE_FILE" || return 1
  prepare_installation_state_operational_values "$INSTALLATION_STATE_FILE"
  DEVFLOW_PROXY_MIGRATION_EXECUTED="$executed"
  export DEVFLOW_PROXY_MIGRATION_EXECUTED
  write_installation_state
  validate_installed_state_consistency "$INSTALLATION_STATE_FILE"
}

on_failure() {
  local code=$?
  trap - ERR
  if [[ "$MIGRATION_STARTED" == true ]]; then
    if rollback_transaction; then
      if [[ -f "$INSTALLATION_STATE_BACKUP" && ! -L "$INSTALLATION_STATE_BACKUP" ]]; then
        install -m 0600 "$INSTALLATION_STATE_BACKUP" "$INSTALLATION_STATE_FILE" \
          || log ERROR 'Estado DevFlow nao pode ser restaurado automaticamente.'
      fi
      log WARN 'Rollback automatico da migracao concluido.'
    else
      log ERROR 'Rollback incompleto; intervencao manual obrigatoria.'
    fi
  elif [[ "$ARTIFACTS_APPLIED" == true ]]; then
    rm -f -- "$HOST_ENABLED" "$HOST_CONFIG" "$OVERRIDE_FILE"
    log WARN 'Artefatos preparatorios removidos; nenhuma porta ou container havia sido alterado.'
  fi
  log ERROR "Migracao interrompida (codigo $code)."
  exit "$code"
}

perform_migration() {
  local loopback_frontend loopback_api auth_status
  systemctl stop nginx >/dev/null 2>&1 || true
  docker compose --project-directory "$FULLPASSWORD_ROOT" -f "$FULLPASSWORD_COMPOSE_FILE" -f "$OVERRIDE_FILE" \
    up -d --no-deps --force-recreate nginx || return 1
  [[ "$(docker port "$FULLPASSWORD_CONTAINER" 80/tcp 2>/dev/null)" == "$LOOPBACK_HOST:$LOOPBACK_PORT" ]] || return 1
  [[ -z "$(docker port "$FULLPASSWORD_CONTAINER" 443/tcp 2>/dev/null || true)" ]] || return 1

  loopback_frontend="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --max-time 20 -H "Host: $FULLPASSWORD_DOMAIN" "http://$LOOPBACK_HOST:$LOOPBACK_PORT/" 2>/dev/null || printf 000)"
  loopback_api="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --max-time 20 -H "Host: $FULLPASSWORD_DOMAIN" "http://$LOOPBACK_HOST:$LOOPBACK_PORT/api/health" 2>/dev/null || printf 000)"
  auth_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --max-time 20 -H "Host: $FULLPASSWORD_DOMAIN" "http://$LOOPBACK_HOST:$LOOPBACK_PORT/api/auth/me" 2>/dev/null || printf 000)"
  code_is_success "$loopback_frontend" || return 1
  [[ "$loopback_api" == 200 ]] || return 1
  [[ "$auth_status" == 401 ]] || return 1

  public_ports_are_free || return 1
  systemctl enable --now nginx || return 1
  nginx -t >/dev/null 2>&1 || return 1
  ss -H -ltnp 2>/dev/null | awk '$4 ~ /:80$/ || $4 ~ /:443$/ {print}' | grep -q nginx || return 1
  validate_public_runtime || return 1
}

main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --check) set_mode check; shift ;;
      --dry-run) set_mode dry-run; shift ;;
      --migrate) set_mode migrate; shift ;;
      --rollback) set_mode rollback; shift ;;
      --fullpassword-domain) FULLPASSWORD_DOMAIN="${2:-}"; shift 2 ;;
      --help|-h) usage; return 0 ;;
      *) die "Opcao desconhecida: $1" ;;
    esac
  done

  require_linux
  require_root
  validate_domain "$FULLPASSWORD_DOMAIN"
  validate_safe_absolute_path "$FULLPASSWORD_ROOT" 'Diretorio Full Password'
  validate_safe_absolute_path "$MIGRATION_ROOT" 'Diretorio neutro da migracao'
  [[ "$FULLPASSWORD_ROOT" == /opt/fullpassword ]] || die 'A migracao aceita somente /opt/fullpassword.'
  [[ "$MIGRATION_ROOT" == /etc/devflow/proxy-migrations ]] || die 'Diretorio de migracao inesperado.'

  if [[ "$MODE" == rollback ]]; then
    load_state || die 'Estado de migracao ausente ou invalido; rollback recusado.'
    validate_installed_state_consistency "$INSTALLATION_STATE_FILE" \
      || die 'Estado DevFlow inconsistente; rollback recusado antes de mutacoes.'
    [[ ! -e /etc/nginx/sites-available/devflow.conf && ! -e /etc/nginx/conf.d/devflow.conf ]] \
      || die 'DevFlow utiliza o Nginx do host; remova-o de forma controlada antes deste rollback global.'
    require_numeric_confirmation proxy-migration-rollback \
      'A reversão restaurará o fullpassword_nginx nas portas 80/443.' \
      'REVERTER PROXY DO HOST'
    rollback_transaction || die 'Rollback falhou; consulte o log e os servicos manualmente.'
    promote_proxy_migration_state false \
      || die 'Proxy foi revertido, mas o estado DevFlow nao pode ser promovido; intervencao obrigatoria.'
    rm -f -- "$STATE_FILE" "$OVERRIDE_FILE"
    log INFO 'Rollback concluido; o repositorio Full Password permaneceu inalterado.'
    return 0
  fi

  run_read_only_evidence
  local evidence
  evidence="$(render_evidence_report)"
  if [[ "$MODE" == dry-run ]]; then
    diagnostic_report_written=true
    evidence="$(render_evidence_report)"
    write_dry_run_report "$evidence"
  fi
  printf '%s\n' "$evidence" | redact_stream
  print_transaction_plan

  if [[ "$MODE" == check || "$MODE" == dry-run ]]; then
    [[ "$migration_ready" == true ]] || return 1
    return 0
  fi

  [[ "$migration_ready" == true && "$rollback_ready" == true ]] \
    || die 'Gates incompletos; migracao bloqueada.'
  require_numeric_confirmation proxy-snapshot \
    'Confirme que existe um snapshot externo recente da VPS.' \
    'CONFIRMAR SNAPSHOT DA VPS'
  require_numeric_confirmation proxy-migration \
    'A migração do proxy poderá causar indisponibilidade temporária.' \
    'INICIAR MIGRAÇÃO'
  [[ ! -e "$STATE_FILE" ]] || die 'Uma migracao ja esta registrada.'
  systemctl is-active --quiet nginx 2>/dev/null && ORIGINAL_NGINX_ACTIVE=true

  install -d -m 0700 "$MIGRATION_ROOT" "$BACKUP_ROOT"
  install -d -m 0750 "$LOG_ROOT"
  local migration_log started_at completed_at
  migration_log="$LOG_ROOT/proxy-migration-$(date -u +%Y%m%dT%H%M%SZ).log"
  touch "$migration_log"
  chmod 0640 "$migration_log"
  exec > >(redact_stream | tee -a "$migration_log") 2>&1
  started_at="$(timestamp)"
  validate_installed_state_consistency "$INSTALLATION_STATE_FILE" \
    || die 'Estado DevFlow inconsistente; migracao bloqueada antes das mutacoes.'
  install -m 0600 "$INSTALLATION_STATE_FILE" "$INSTALLATION_STATE_BACKUP"
  sha256sum "$FULLPASSWORD_COMPOSE_FILE" > "$BACKUP_ROOT/original-compose.sha256"
  docker inspect --format 'name={{.Name}}\nimage={{.Config.Image}}\nproject={{index .Config.Labels "com.docker.compose.project"}}\nservice={{index .Config.Labels "com.docker.compose.service"}}\nnetworks={{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}\nports={{json .HostConfig.PortBindings}}' \
    "$FULLPASSWORD_CONTAINER" > "$BACKUP_ROOT/fullpassword-nginx.state.txt"
  trap on_failure ERR
  ARTIFACTS_APPLIED=true
  install -m 0600 "$EVIDENCE_TEMP_ROOT/override.yml" "$OVERRIDE_FILE"
  install -m 0640 "$EVIDENCE_TEMP_ROOT/fullpassword.conf" "$HOST_CONFIG"
  ln -sfn "$HOST_CONFIG" "$HOST_ENABLED"
  nginx -t >/dev/null 2>&1
  ! ss -H -ltn 2>/dev/null | awk '{print $4}' | grep -Eq '(^|\]|:|\*)[:.]?18081$' \
    || die 'A porta loopback deixou de estar disponivel.'
  ! docker ps -a --format '{{.Names}}|{{.Ports}}' 2>/dev/null | grep -Eq '(^|[^0-9])18081([^0-9]|$)' \
    || die 'Uma publicacao Docker passou a utilizar a porta loopback.'

  log INFO 'Janela de manutencao operacional iniciada; nenhuma credencial foi registrada.'
  MIGRATION_STARTED=true
  perform_migration
  promote_proxy_migration_state true
  completed_at="$(timestamp)"
  write_state "$ORIGINAL_NGINX_ACTIVE" "$HOST_NGINX_INSTALLED_BY_MIGRATION" "$started_at" "$completed_at"
  trap - ERR
  log INFO "Migracao concluida em janela iniciada em $started_at e finalizada em $completed_at."
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
