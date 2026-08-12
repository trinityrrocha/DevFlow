#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE="$SCRIPT_DIR/update.sh"

usage() {
  printf '%s\n' 'Uso: sudo scripts/update-cli.sh [--check]' >&2
}

[[ $# -le 1 ]] || { usage; exit 2; }
if [[ "${1:-}" == --check ]]; then
  exec "$ENGINE" --check
fi
[[ $# -eq 0 ]] || { usage; exit 2; }
[[ -r /dev/tty && -w /dev/tty ]] || {
  printf '%s\n' 'ERRO: O modo interativo requer /dev/tty. Use --check para diagnostico.' >&2
  exit 11
}

check_output="$($ENGINE --check)"
installed_version="$(printf '%s\n' "$check_output" | sed -n 's/^installed_version=//p' | tail -n1)"
available_version="$(printf '%s\n' "$check_output" | sed -n 's/^available_version=//p' | tail -n1)"
update_available="$(printf '%s\n' "$check_output" | sed -n 's/^update_available=//p' | tail -n1)"

if [[ "$update_available" == false ]]; then
  cat >/dev/tty <<EOF
============================================================
 ATUALIZACAO DO DEVFLOW
============================================================

Versao instalada:
  $installed_version

O DevFlow ja esta na versao mais recente.
============================================================
EOF
  exit 0
fi
[[ "$update_available" == true ]] || { printf '%s\n' 'ERRO: resposta de check invalida.' >&2; exit 1; }

cat >/dev/tty <<EOF
============================================================
 ATUALIZACAO DO DEVFLOW
============================================================

Versao instalada:
  $installed_version

Versao disponivel:
  $available_version

A atualizacao podera executar migrations e reiniciar servicos.
Recomendamos possuir um backup recente antes de atualizar.
O processo nao cria nem exige backup automaticamente.
O rollback automatico e somente operacional e nao restaura banco ou uploads.

1 - ATUALIZAR DEVFLOW
2 - CANCELAR
EOF

while true; do
  printf '\nOpcao: ' >/dev/tty
  IFS= read -r choice </dev/tty || exit 11
  case "$choice" in
    1)
      "$ENGINE"
      installed_version="$($SCRIPT_DIR/version.sh --installed | sed -n 's/^installed_version=//p')"
      cat >/dev/tty <<EOF
============================================================
 DEVFLOW ATUALIZADO COM SUCESSO
============================================================

Versao instalada:
  $installed_version
============================================================
EOF
      exit 0
      ;;
    2)
      printf '%s\n' 'operation_cancelled_by_user=true' 'changes_applied=false'
      exit 0
      ;;
    *) printf '%s\n' 'Opcao invalida. Digite 1 ou 2.' >/dev/tty ;;
  esac
done
