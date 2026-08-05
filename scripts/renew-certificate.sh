#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

DRY_RUN=false
[[ "${1:-}" != --dry-run ]] || { DRY_RUN=true; shift; }
[[ $# -eq 0 ]] || die 'Uso: sudo scripts/renew-certificate.sh [--dry-run]'
require_linux
require_root
command -v certbot >/dev/null 2>&1 || die 'Certbot do host nao esta disponivel.'
load_devflow_env
validate_runtime_paths
docker inspect devflow-nginx >/dev/null 2>&1 || die 'Container devflow-nginx nao foi encontrado.'
ensure_nginx_started() { docker start devflow-nginx >/dev/null 2>&1 || true; }
trap ensure_nginx_started EXIT INT TERM

renew_args=(
  renew --cert-name "$DEVFLOW_DOMAIN" --no-random-sleep-on-renew
  --pre-hook '/usr/bin/docker stop devflow-nginx'
  --post-hook '/usr/bin/docker start devflow-nginx'
  --deploy-hook '/usr/bin/docker start devflow-nginx && /usr/bin/docker exec devflow-nginx nginx -s reload'
)

if [[ "$DRY_RUN" == true ]]; then
  certbot "${renew_args[@]}" --dry-run
  exit 0
fi

certbot "${renew_args[@]}" --quiet
validate_devflow_certificate "$DEVFLOW_DOMAIN" "$DEVFLOW_CERTIFICATE_PATH" >/dev/null \
  || die 'O certificado renovado nao passou pela validacao criptografica.'
