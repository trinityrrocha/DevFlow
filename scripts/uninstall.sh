#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

MODE=
ASSUME_YES=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep-data) MODE=keep-data; shift ;;
    --purge) MODE=purge; shift ;;
    --yes) ASSUME_YES=true; shift ;;
    --help|-h)
      echo 'Uso: sudo scripts/uninstall.sh --keep-data | --purge'
      exit 0
      ;;
    *) die "Opção desconhecida: $1" ;;
  esac
done

[[ "$MODE" == keep-data || "$MODE" == purge ]] || { echo 'Informe --keep-data ou --purge.' >&2; exit 2; }
require_linux
require_root
validate_safe_absolute_path "$DEVFLOW_INSTALL_ROOT" 'Diretório de instalação'
[[ -r "$DEVFLOW_ENV_FILE" ]] || die 'Configuração DevFlow não encontrada; nenhuma remoção foi realizada.'
load_devflow_env
validate_runtime_paths
DEVFLOW_APP_ROOT="$DEVFLOW_INSTALL_ROOT/app"
[[ -e "$DEVFLOW_APP_ROOT/docker-compose.yml" ]] || die 'Compose instalado não encontrado.'
compose_files

echo 'Recursos da aplicação que serão removidos:'
"${DEVFLOW_COMPOSE[@]}" ps --all 2>/dev/null || true
echo 'A configuração do proxy DevFlow e os timers DevFlow serão removidos.'

if [[ -f /etc/nginx/conf.d/devflow.conf ]]; then
  [[ "$(head -n1 /etc/nginx/conf.d/devflow.conf)" == '# Managed by DevFlow installer. Do not merge with another application.' ]] \
    || die 'Configuração Nginx não reconhecida; nenhuma remoção foi iniciada.'
fi
for unit_file in /etc/systemd/system/devflow-backup.service /etc/systemd/system/devflow-backup.timer; do
  if [[ -e "$unit_file" ]]; then
    [[ "$(head -n1 "$unit_file")" == '# Managed by DevFlow installer.' ]] \
      || die "$unit_file não é reconhecido como recurso DevFlow; nenhuma remoção foi iniciada."
  fi
done

if [[ "$MODE" == keep-data ]]; then
  echo 'Serão preservados: banco, storage, configuração privada, backups e releases.'
  DEVFLOW_ASSUME_YES="$ASSUME_YES"
  confirm_exact 'REMOVER APLICACAO' 'Confirma a remoção dos serviços DevFlow?'
  "${DEVFLOW_COMPOSE[@]}" down --remove-orphans
else
  echo 'ATENÇÃO: serão removidos exatamente:'
  printf '  %s\n' "$DEVFLOW_INSTALL_ROOT" /etc/nginx/conf.d/devflow.conf \
    /etc/systemd/system/devflow-backup.service /etc/systemd/system/devflow-backup.timer
  latest_backup="$(find "$DEVFLOW_INSTALL_ROOT/backups" -maxdepth 1 -type f -name 'devflow-*.dfbackup' -size +0c -print -quit 2>/dev/null || true)"
  [[ -n "$latest_backup" ]] || die 'Nenhum backup DevFlow válido foi encontrado. Execute scripts/backup.sh antes do purge.'
  echo 'Copie o backup para outro host antes de prosseguir; o diretório local de backups também será removido.'
  DEVFLOW_ASSUME_YES=false
  confirm_exact 'PURGE DEVFLOW' 'Primeira confirmação destrutiva.'
  confirm_exact "$(hostname)" 'Segunda confirmação: confirme o hostname alvo.'
  "${DEVFLOW_COMPOSE[@]}" down --volumes --remove-orphans
fi

if [[ -f /etc/nginx/conf.d/devflow.conf ]]; then
  nginx_backup="$(mktemp /tmp/devflow-nginx-remove.XXXXXX)"
  cp -a -- /etc/nginx/conf.d/devflow.conf "$nginx_backup"
  rm -f -- /etc/nginx/conf.d/devflow.conf
  if nginx -t; then
    rm -f -- "$nginx_backup"
    systemctl reload nginx
  else
    mv -f -- "$nginx_backup" /etc/nginx/conf.d/devflow.conf
    nginx -t || true
    die 'A remoção invalidaria o Nginx; a configuração DevFlow foi restaurada.'
  fi
fi

systemctl disable --now devflow-backup.timer >/dev/null 2>&1 || true
rm -f -- /etc/systemd/system/devflow-backup.service /etc/systemd/system/devflow-backup.timer
systemctl daemon-reload

if [[ "$MODE" == purge ]]; then
  resolved_root="$(realpath -m "$DEVFLOW_INSTALL_ROOT")"
  [[ "$resolved_root" == /opt/devflow ]] || die "Purge recusado para caminho inesperado: $resolved_root"
  rm -rf -- "$resolved_root"
  echo 'Dados DevFlow removidos. Certificados e Docker global foram preservados.'
else
  echo 'Aplicação removida; dados DevFlow preservados.'
fi
