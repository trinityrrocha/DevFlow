#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/proxy-config.sh
. "$SCRIPT_DIR/lib/proxy-config.sh"
# shellcheck source=lib/fullpassword-proxy.sh
. "$SCRIPT_DIR/lib/fullpassword-proxy.sh"
# shellcheck source=providers/provider-contract.sh
. "$SCRIPT_DIR/providers/provider-contract.sh"

MODE=
REMOVE_DEVFLOW_CERTIFICATE=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep-data) MODE=keep-data; shift ;;
    --purge) MODE=purge; shift ;;
    --remove-devflow-certificate) REMOVE_DEVFLOW_CERTIFICATE=true; shift ;;
    --help|-h)
      echo 'Uso: sudo scripts/uninstall.sh --keep-data | --purge [--remove-devflow-certificate]'
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
provider_resolve_installed
provider_load "$DEVFLOW_INFRASTRUCTURE_PROVIDER" || die 'Provider instalado nao pode ser carregado.'
DEVFLOW_APP_ROOT="$DEVFLOW_INSTALL_ROOT/app"
[[ -e "$DEVFLOW_APP_ROOT/docker-compose.yml" ]] || die 'Compose instalado não encontrado.'
compose_files

echo 'Recursos da aplicação que serão removidos:'
"${DEVFLOW_COMPOSE[@]}" ps --all 2>/dev/null || true
echo 'A configuração do proxy DevFlow e os timers DevFlow serão removidos.'

if [[ "${DEVFLOW_SHARED_PROXY_ADAPTER:-none}" == fullpassword-nginx ]]; then
  [[ -f "$FULLPASSWORD_OVERRIDE_FILE" && "$(head -n1 "$FULLPASSWORD_OVERRIDE_FILE")" == "$FULLPASSWORD_OVERRIDE_MARKER" ]] \
    || die 'Override Full Password ausente ou não reconhecido; nenhuma remoção foi iniciada.'
  [[ -f "$DEVFLOW_PROXY_CONFIG" && "$(head -n1 "$DEVFLOW_PROXY_CONFIG")" == "$FULLPASSWORD_CONFIG_MARKER" ]] \
    || die 'Rota DevFlow do proxy compartilhado ausente ou não reconhecida.'
fi

if [[ "$DEVFLOW_INFRASTRUCTURE_PROVIDER" == host-nginx ]]; then
  host_nginx_select_layout
  managed_file "$HOST_NGINX_AVAILABLE" "$HOST_NGINX_MARKER" \
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
  require_numeric_confirmation uninstall-keep-data \
    'A remoção dos serviços DevFlow está pronta; os dados serão preservados.' \
    'REMOVER SERVIÇOS DEVFLOW'
  "${DEVFLOW_COMPOSE[@]}" down --remove-orphans
else
  echo 'ATENÇÃO: serão removidos exatamente:'
  purge_targets=("$DEVFLOW_INSTALL_ROOT" /etc/systemd/system/devflow-backup.service /etc/systemd/system/devflow-backup.timer)
  if [[ "$DEVFLOW_INFRASTRUCTURE_PROVIDER" == legacy-docker-nginx ]]; then
    purge_targets+=("$FULLPASSWORD_OVERRIDE_FILE" "$DEVFLOW_PROXY_CONFIG")
  elif [[ "$DEVFLOW_INFRASTRUCTURE_PROVIDER" == host-nginx ]]; then
    host_nginx_select_layout
    purge_targets+=("$HOST_NGINX_AVAILABLE")
    [[ "$HOST_NGINX_ENABLED" == "$HOST_NGINX_AVAILABLE" ]] || purge_targets+=("$HOST_NGINX_ENABLED")
  else
    purge_targets+=('provider isolated-nginx: nenhum arquivo Nginx no host')
  fi
  printf '  %s\n' "${purge_targets[@]}"
  latest_backup="$(find "$DEVFLOW_INSTALL_ROOT/backups" -maxdepth 1 -type f -name 'devflow-*.dfbackup' -size +0c -print -quit 2>/dev/null || true)"
  [[ -n "$latest_backup" ]] || die 'Nenhum backup DevFlow válido foi encontrado. Execute scripts/backup.sh antes do purge.'
  echo 'Copie o backup para outro host antes de prosseguir; o diretório local de backups também será removido.'
  require_numeric_confirmation uninstall-purge-first \
    'A remoção definitiva dos dados DevFlow foi solicitada.' \
    'CONTINUAR PARA A CONFIRMAÇÃO FINAL'
  require_numeric_confirmation uninstall-purge-final \
    "Confirmação final para remover os dados DevFlow no host $(hostname)." \
    'REMOVER DEFINITIVAMENTE OS DADOS DEVFLOW'
  "${DEVFLOW_COMPOSE[@]}" down --volumes --remove-orphans
fi

provider_uninstall
remove_devflow_edge_network_if_unused || log WARN 'A rede devflow_edge foi preservada porque ainda está em uso ou sua propriedade não foi comprovada.'

if [[ "$REMOVE_DEVFLOW_CERTIFICATE" == true ]]; then
  require_numeric_confirmation uninstall-certificate \
    "A remoção do certificado exclusivo de $DEVFLOW_DOMAIN foi solicitada." \
    'REMOVER CERTIFICADO DEVFLOW'
  certbot delete --cert-name "$DEVFLOW_DOMAIN" --non-interactive
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
