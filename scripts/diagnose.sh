#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

OUTPUT_FILE=
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output) [[ -n "${2:-}" ]] || die '--output exige um arquivo.'; OUTPUT_FILE="$2"; shift 2 ;;
    --help|-h) echo 'Uso: sudo scripts/diagnose.sh [--output ARQUIVO]'; exit 0 ;;
    *) die "Opcao desconhecida: $1" ;;
  esac
done

require_linux
require_root
load_devflow_env
validate_runtime_paths
DEVFLOW_APP_ROOT="$DEVFLOW_INSTALL_ROOT/app"
compose_files

collect() {
  echo 'DevFlow isolated diagnostic'
  printf 'timestamp=%s\n' "$(timestamp)"
  printf 'installation_mode=isolated\n'
  printf 'system=%s\n' "$(. /etc/os-release; printf '%s %s' "$ID" "$VERSION_ID")"
  printf 'architecture=%s\n' "$(uname -m)"
  printf 'docker=%s\n' "$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo unavailable)"
  printf 'compose=%s\n' "$(docker compose version --short 2>/dev/null || echo unavailable)"
  printf 'configured_version=%s\n' "${DEVFLOW_VERSION:-unknown}"
  printf 'configured_commit=%s\n' "${DEVFLOW_RELEASE_COMMIT:-unknown}"
  echo 'containers:'
  "${DEVFLOW_COMPOSE[@]}" ps --all 2>&1 | redact_stream || true
  echo 'networks:'
  docker network inspect devflow_edge devflow_internal \
    --format '{{.Name}} internal={{.Internal}} containers={{len .Containers}}' 2>&1 | redact_stream || true
  echo 'ports:'
  ss -H -ltnp 'sport = :80 or sport = :443' 2>&1 | redact_stream || true
  echo 'disk:'
  df -h "$DEVFLOW_INSTALL_ROOT" 2>&1 | redact_stream || true
  echo 'state:'
  python3 "$SCRIPT_DIR/validate-installation-state.py" validate "$DEVFLOW_STATE_ROOT/installation.json" 2>&1 \
    | redact_stream || true
  echo 'certificate:'
  validate_devflow_certificate "$DEVFLOW_DOMAIN" "$DEVFLOW_CERTIFICATE_PATH" 2>&1 | redact_stream || true
  echo 'renewal_timer:'
  systemctl is-active devflow-certificate-renewal.timer 2>&1 | redact_stream || true
  printf 'certificate_renewal_dry_run_command=%s\n' \
    'sudo /opt/devflow/app/scripts/renew-certificate.sh --dry-run'
  echo 'health:'
  "$SCRIPT_DIR/health.sh" --quiet 2>&1 | redact_stream || true
  echo 'recent_logs:'
  "${DEVFLOW_COMPOSE[@]}" logs --tail 40 --no-color 2>&1 | redact_stream || true
}

if [[ -n "$OUTPUT_FILE" ]]; then
  validate_safe_absolute_path "$(realpath -m "$OUTPUT_FILE")" 'Arquivo de diagnostico'
  collect > "$OUTPUT_FILE"
  chmod 0600 "$OUTPUT_FILE"
  printf 'Diagnostico sanitizado salvo em %s\n' "$OUTPUT_FILE"
else
  collect
fi
