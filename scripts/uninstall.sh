#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

MODE=
while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep-data) MODE=keep-data; shift ;;
    --purge) MODE=purge; shift ;;
    --help|-h)
      echo 'Uso: sudo scripts/uninstall.sh [--keep-data|--purge]'
      exit 0
      ;;
    *) die "Opcao desconhecida: $1" ;;
  esac
done

if [[ -z "$MODE" ]]; then
  [[ -t 0 ]] || die 'Informe --keep-data ou --purge em execucao nao interativa.'
  cat <<'EOF'
1 - REMOVER APLICACAO E PRESERVAR DADOS
2 - REMOVER TUDO, INCLUINDO BANCO E UPLOADS
3 - CANCELAR
EOF
  read -r -p 'Escolha [1/2/3]: ' choice
  case "$choice" in
    1) MODE=keep-data ;;
    2) MODE=purge ;;
    3) echo 'Desinstalacao cancelada.'; exit 0 ;;
    *) die 'Opcao invalida.' ;;
  esac
fi

require_linux
require_root
[[ "$DEVFLOW_INSTALL_ROOT" == /opt/devflow ]] || die 'Diretorio de instalacao inesperado.'
[[ -r "$DEVFLOW_ENV_FILE" ]] || die 'Configuracao DevFlow ausente; nenhuma remocao foi realizada.'
load_devflow_env
validate_runtime_paths
DEVFLOW_APP_ROOT="$DEVFLOW_INSTALL_ROOT/app"
[[ -r "$DEVFLOW_APP_ROOT/docker-compose.yml" ]] || die 'Compose DevFlow ausente.'
compose_files

echo 'Recursos exclusivos DevFlow selecionados:'
"${DEVFLOW_COMPOSE[@]}" ps --all 2>/dev/null || true
printf 'redes=%s\n' 'devflow_edge,devflow_internal'
printf 'certificado=%s\n' "$DEVFLOW_CERTIFICATE_PATH/live/$DEVFLOW_DOMAIN"

if [[ "$MODE" == keep-data ]]; then
  echo 'Serao preservados: PostgreSQL, uploads, certificados, configuracao, backups, releases e estado.'
  require_numeric_confirmation uninstall-keep-data \
    'A remocao dos servicos DevFlow esta pronta; os dados serao preservados.' \
    'REMOVER APLICACAO E PRESERVAR DADOS'
  "${DEVFLOW_COMPOSE[@]}" down --remove-orphans
else
  latest_backup="$(find "$DEVFLOW_INSTALL_ROOT/backups" -maxdepth 1 -type f \
    -name 'devflow-*.dfbackup' -size +0c -print -quit 2>/dev/null || true)"
  [[ -n "$latest_backup" ]] || die 'Purge bloqueado: crie e copie um backup valido antes de continuar.'
  cat <<EOF
ATENCAO: serao removidos exatamente:
  containers e redes do projeto devflow
  $DEVFLOW_INSTALL_ROOT/storage/postgres
  $DEVFLOW_INSTALL_ROOT/storage/uploads
  $DEVFLOW_INSTALL_ROOT/certificates
  $DEVFLOW_INSTALL_ROOT/config
  $DEVFLOW_INSTALL_ROOT/state
  $DEVFLOW_INSTALL_ROOT/backups
  $DEVFLOW_INSTALL_ROOT/releases
  unidades systemd exclusivas do DevFlow

Backup detectado: $latest_backup
Copie-o para outro host antes de prosseguir.
EOF
  require_numeric_confirmation uninstall-purge-first \
    'Primeira confirmacao da remocao definitiva.' 'CONTINUAR PARA CONFIRMACAO FINAL'
  require_numeric_confirmation uninstall-purge-final \
    'Confirmacao final: banco, uploads e backups locais serao removidos.' \
    'REMOVER TUDO, INCLUINDO BANCO E UPLOADS'
  "${DEVFLOW_COMPOSE[@]}" down --remove-orphans
fi

for image in devflow-backend:latest devflow-frontend:latest; do
  docker image inspect "$image" >/dev/null 2>&1 && docker image rm "$image" >/dev/null || true
done

for unit in devflow-backup.timer devflow-backup.service \
  devflow-certificate-renewal.timer devflow-certificate-renewal.service; do
  systemctl disable --now "$unit" >/dev/null 2>&1 || true
  unit_path="/etc/systemd/system/$unit"
  if [[ -e "$unit_path" ]]; then
    [[ "$(head -n1 "$unit_path")" == '# Managed by DevFlow installer.' ]] \
      || die "Unidade $unit nao pertence ao DevFlow; remocao interrompida."
    rm -f -- "$unit_path"
  fi
done
systemctl daemon-reload

if [[ "$MODE" == purge ]]; then
  resolved_root="$(realpath -m "$DEVFLOW_INSTALL_ROOT")"
  [[ "$resolved_root" == /opt/devflow ]] || die 'Purge recusado para caminho inesperado.'
  rm -rf -- "$resolved_root"
  echo 'DevFlow e seus dados foram removidos. Docker global e recursos de terceiros foram preservados.'
else
  echo 'Aplicacao DevFlow removida; dados e configuracao foram preservados.'
fi
