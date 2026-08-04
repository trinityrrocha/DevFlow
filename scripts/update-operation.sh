#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'EOF'
Uso: scripts/update-operation.sh OPERACAO [--expected-version SEMVER]

Contrato operacional reutilizavel:
  check-update       consulta a release disponivel
  download-update    baixa e valida a candidata em checkout temporario isolado
  validate-update    repete a validacao integral sem instalar
  install-update     executa a atualizacao transacional
  rollback-update    restaura release e backup da ultima atualizacao
EOF
}

[[ $# -ge 1 ]] || { usage; exit 2; }
operation="$1"
shift
case "$operation" in
  check-update|download-update|validate-update)
    export DEVFLOW_UPDATE_OPERATION="$operation"
    exec "$SCRIPT_DIR/update.sh" --check "$@"
    ;;
  install-update)
    export DEVFLOW_UPDATE_OPERATION=install-update
    exec "$SCRIPT_DIR/update.sh" "$@"
    ;;
  rollback-update)
    [[ $# -eq 0 ]] || { printf '%s\n' 'rollback-update nao aceita parametros.' >&2; exit 2; }
    export DEVFLOW_UPDATE_OPERATION=rollback-update
    exec "$SCRIPT_DIR/update.sh" --rollback
    ;;
  --help|-h) usage ;;
  *) printf 'Operacao desconhecida: %s\n' "$operation" >&2; usage >&2; exit 2 ;;
esac
