#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=../../scripts/lib/common.sh
. "$ROOT/scripts/lib/common.sh"
# shellcheck source=../../scripts/lib/fullpassword-proxy.sh
. "$ROOT/scripts/lib/fullpassword-proxy.sh"

TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/devflow-fullpassword-adapter.XXXXXX")"
cleanup_test() {
  [[ ! -d "${FULLPASSWORD_ROOT:-}" ]] || chmod -R u+w "$FULLPASSWORD_ROOT" 2>/dev/null || true
  [[ "$TEST_ROOT" == "${TMPDIR:-/tmp}/devflow-fullpassword-adapter."* ]] && rm -rf -- "$TEST_ROOT"
}
trap cleanup_test EXIT

DEVFLOW_INSTALL_ROOT="$TEST_ROOT/devflow"
DEVFLOW_CONFIG_ROOT="$DEVFLOW_INSTALL_ROOT/config"
DEVFLOW_DATA_ROOT="$DEVFLOW_INSTALL_ROOT/data"
DEVFLOW_STATE_ROOT="$DEVFLOW_INSTALL_ROOT/state"
DEVFLOW_LOG_ROOT="$DEVFLOW_INSTALL_ROOT/logs"
DEVFLOW_PROXY_CONFIG="$DEVFLOW_CONFIG_ROOT/nginx/devflow.conf"
DEVFLOW_PROXY_ROOT="$DEVFLOW_CONFIG_ROOT/proxy"
DEVFLOW_ACME_WEBROOT="$TEST_ROOT/certbot"
FULLPASSWORD_ROOT="$TEST_ROOT/fullpassword"
FULLPASSWORD_COMPOSE_FILE="$FULLPASSWORD_ROOT/docker-compose.yml"
FULLPASSWORD_OVERRIDE_FILE="$DEVFLOW_PROXY_ROOT/fullpassword-nginx.override.yml"
DEVFLOW_PROXY_STATE="$DEVFLOW_STATE_ROOT/proxy-adapter.json"
DEVFLOW_DOMAIN=dev.sti1.com.br
mkdir -p "$DEVFLOW_CONFIG_ROOT/nginx" "$DEVFLOW_PROXY_ROOT" "$DEVFLOW_STATE_ROOT" "$FULLPASSWORD_ROOT" "$DEVFLOW_ACME_WEBROOT"
printf 'services: {}\n' > "$FULLPASSWORD_COMPOSE_FILE"
printf 'ORIGINAL FULL PASSWORD\n' > "$FULLPASSWORD_ROOT/read-only-sentinel"
FULLPASSWORD_BEFORE="$(sha256sum "$FULLPASSWORD_COMPOSE_FILE" "$FULLPASSWORD_ROOT/read-only-sentinel")"
chmod 0444 "$FULLPASSWORD_COMPOSE_FILE" "$FULLPASSWORD_ROOT/read-only-sentinel" 2>/dev/null || true
chmod 0555 "$FULLPASSWORD_ROOT" 2>/dev/null || true

# O Git Bash no Windows não consegue aplicar todos os modos POSIX; os testes
# preservam a semântica de criação/cópia e os modos são validados estaticamente.
install() {
  if [[ "$1" == -d ]]; then
    shift
    [[ "${1:-}" == -m ]] && shift 2
    mkdir -p -- "$@"
  else
    [[ "$1" == -m ]] && shift 2
    cp -- "$1" "$2"
  fi
}

FAIL_STAGE=none
APPLY_COUNT=0
ROLLBACK_COUNT=0
RECREATE_COUNT=0
FULLPASSWORD_HEALTH_COUNT=0

record_failure() {
  [[ "$FAIL_STAGE" != "$1" ]]
}

fullpassword_adapter_snapshot() {
  install -d -m 0700 "$1"
  return 0
}
fullpassword_adapter_preflight() { record_failure preflight; }
ensure_devflow_edge_network() { record_failure network; }
render_fullpassword_override() {
  printf '%s\nservices: {}\n' "$FULLPASSWORD_OVERRIDE_MARKER" > "$2"
}
render_fullpassword_proxy() {
  printf '%s\nserver {}\n' "$FULLPASSWORD_CONFIG_MARKER" > "$4"
}
fullpassword_adapter_apply_files() {
  APPLY_COUNT=$((APPLY_COUNT + 1))
  if [[ "$FAIL_STAGE" == nginx-t && "$APPLY_COUNT" -eq 1 ]]; then return 1; fi
  if [[ "$FAIL_STAGE" == recreate && "$APPLY_COUNT" -eq 1 ]]; then return 1; fi
  if [[ "$FAIL_STAGE" == fullpassword-health && "$APPLY_COUNT" -eq 1 ]]; then return 1; fi
  return 0
}
validate_devflow_acme_route() { record_failure acme-route; }
certbot() { record_failure certificate; }
devflow_public_health() { record_failure devflow-health; }
fullpassword_adapter_restore_snapshot() { ROLLBACK_COUNT=$((ROLLBACK_COUNT + 1)); return 0; }
fullpassword_recreate_nginx() { RECREATE_COUNT=$((RECREATE_COUNT + 1)); record_failure recreate; }
fullpassword_public_health() { FULLPASSWORD_HEALTH_COUNT=$((FULLPASSWORD_HEALTH_COUNT + 1)); record_failure fullpassword-health; }
remove_devflow_edge_network_if_unused() { return 0; }

expect_install_success() {
  FAIL_STAGE=none APPLY_COUNT=0 ROLLBACK_COUNT=0
  install_fullpassword_proxy_adapter "$ROOT" "$DEVFLOW_DOMAIN" contato@sti1.com.br >/dev/null
  [[ "$APPLY_COUNT" -eq 2 && "$ROLLBACK_COUNT" -eq 0 ]]
}

expect_install_rollback() {
  local stage="$1"
  FAIL_STAGE="$stage" APPLY_COUNT=0 ROLLBACK_COUNT=0
  if install_fullpassword_proxy_adapter "$ROOT" "$DEVFLOW_DOMAIN" contato@sti1.com.br >/dev/null 2>&1; then
    echo "Falha $stage foi aceita indevidamente." >&2
    exit 1
  fi
  [[ "$ROLLBACK_COUNT" -eq 1 ]] || { echo "Rollback ausente em $stage." >&2; exit 1; }
}

# Instalação, criação repetida e reinstalação seguem o mesmo caminho idempotente.
expect_install_success
expect_install_success
expect_install_success

for stage in certificate acme-route nginx-t recreate fullpassword-health devflow-health; do
  expect_install_rollback "$stage"
done

# Promoção usada pelo update preserva backup e reverte falha pública.
FAIL_STAGE=none APPLY_COUNT=0 ROLLBACK_COUNT=0
promote_fullpassword_proxy_config "$ROOT" fullpassword-shared.conf.template "$DEVFLOW_DOMAIN" healthy
[[ "$APPLY_COUNT" -eq 1 && "$ROLLBACK_COUNT" -eq 0 ]]
FAIL_STAGE=devflow-health APPLY_COUNT=0 ROLLBACK_COUNT=0
if promote_fullpassword_proxy_config "$ROOT" fullpassword-shared.conf.template "$DEVFLOW_DOMAIN" healthy >/dev/null 2>&1; then exit 1; fi
[[ "$ROLLBACK_COUNT" -eq 1 ]]

# Desinstalação remove apenas arquivos gerenciados e restaura se o proxy falhar.
printf '%s\n' "$FULLPASSWORD_OVERRIDE_MARKER" > "$FULLPASSWORD_OVERRIDE_FILE"
printf '%s\n' "$FULLPASSWORD_CONFIG_MARKER" > "$DEVFLOW_PROXY_CONFIG"
FAIL_STAGE=none ROLLBACK_COUNT=0 RECREATE_COUNT=0 FULLPASSWORD_HEALTH_COUNT=0
uninstall_fullpassword_proxy_adapter
[[ ! -e "$FULLPASSWORD_OVERRIDE_FILE" && ! -e "$DEVFLOW_PROXY_CONFIG" ]]
[[ "$RECREATE_COUNT" -eq 1 && "$FULLPASSWORD_HEALTH_COUNT" -eq 1 && "$ROLLBACK_COUNT" -eq 0 ]]

printf '%s\n' "$FULLPASSWORD_OVERRIDE_MARKER" > "$FULLPASSWORD_OVERRIDE_FILE"
printf '%s\n' "$FULLPASSWORD_CONFIG_MARKER" > "$DEVFLOW_PROXY_CONFIG"
FAIL_STAGE=recreate ROLLBACK_COUNT=0
if uninstall_fullpassword_proxy_adapter >/dev/null 2>&1; then exit 1; fi
[[ "$ROLLBACK_COUNT" -eq 1 ]]

FULLPASSWORD_AFTER="$(sha256sum "$FULLPASSWORD_COMPOSE_FILE" "$FULLPASSWORD_ROOT/read-only-sentinel")"
[[ "$FULLPASSWORD_AFTER" == "$FULLPASSWORD_BEFORE" ]]
[[ "$(find "$FULLPASSWORD_ROOT" -mindepth 1 -maxdepth 1 -type f | wc -l | tr -d ' ')" == 2 ]]

printf 'Full Password transaction tests passed: install, repeat, reinstall, update, failures, rollback and uninstall.\n'
