#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib/common.sh"
. "$SCRIPT_DIR/lib/compose-images.sh"

MODE=
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check|--repair)
      [[ -z "$MODE" ]] || die 'Informe somente um modo.'
      MODE="${1#--}"
      shift
      ;;
    --help|-h)
      printf '%s\n' 'Uso: sudo scripts/repair-installation-state.sh --check|--repair'
      exit 0
      ;;
    *) die "Opcao desconhecida: $1" ;;
  esac
done
[[ -n "$MODE" ]] || die 'Informe --check ou --repair.'

require_linux
require_root
load_devflow_env
validate_runtime_paths
validate_domain "$DEVFLOW_DOMAIN" || die 'Dominio do ambiente protegido invalido.'
validate_email "$ADMIN_EMAIL" || die 'E-mail administrativo do ambiente protegido invalido.'

ACTIVE_APP="$DEVFLOW_INSTALL_ROOT/app"
ACTIVE_RELEASE="$(readlink -f -- "$ACTIVE_APP" 2>/dev/null || true)"
[[ -L "$ACTIVE_APP" && "$ACTIVE_RELEASE" == "$DEVFLOW_INSTALL_ROOT/releases/"* \
  && -d "$ACTIVE_RELEASE" && ! -L "$ACTIVE_RELEASE" ]] \
  || die 'A release ativa nao e um symlink seguro sob releases.'
[[ -f "$ACTIVE_RELEASE/.devflow-release" && ! -L "$ACTIVE_RELEASE/.devflow-release" \
  && -f "$ACTIVE_RELEASE/VERSION" && ! -L "$ACTIVE_RELEASE/VERSION" ]] \
  || die 'A release ativa nao possui identidade imutavel.'

DEVFLOW_APP_ROOT="$ACTIVE_APP"
DEVFLOW_INSTALLED_SOURCE_DIR="${DEVFLOW_SOURCE_DIR:-$DEVFLOW_INSTALL_ROOT/source}"
DEVFLOW_IDENTITY_RELEASE_ROOT="$ACTIVE_RELEASE"
DEVFLOW_INSTALLATION_STATE_VALIDATOR="$SCRIPT_DIR/validate-installation-state.py"
export DEVFLOW_APP_ROOT DEVFLOW_INSTALLED_SOURCE_DIR DEVFLOW_IDENTITY_RELEASE_ROOT \
  DEVFLOW_INSTALLATION_STATE_VALIDATOR
resolve_installed_release_identity "$DEVFLOW_INSTALLED_SOURCE_DIR" main >/dev/null \
  || die 'Versao, commit, source e release ativa divergem.'
DEVFLOW_VERSION="$INSTALLED_VERSION"
DEVFLOW_RELEASE_COMMIT="$INSTALLED_COMMIT"
export DEVFLOW_VERSION DEVFLOW_RELEASE_COMMIT
compose_files
"${DEVFLOW_COMPOSE[@]}" config --quiet

for service in db backend frontend updater edge; do
  container_id="$("${DEVFLOW_COMPOSE[@]}" ps -q "$service" 2>/dev/null || true)"
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
    "$container_id" 2>/dev/null || true)"
  printf 'container_%s_health=%s\n' "$service" "${health:-missing}"
  [[ -n "$container_id" && "$health" == healthy ]] || die "Container $service nao esta saudavel."
done

validate_devflow_certificate "$DEVFLOW_DOMAIN" "$DEVFLOW_CERTIFICATE_PATH" >/dev/null \
  || die 'Certificado instalado invalido.'
DEVFLOW_MIGRATION_VERSION="$("${DEVFLOW_COMPOSE[@]}" exec -T db sh -c \
  'psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT version FROM schema_migrations ORDER BY applied_at DESC LIMIT 1"')"
[[ -n "$DEVFLOW_MIGRATION_VERSION" ]] || die 'Migration instalada nao foi confirmada.'
super_admin_present="$("${DEVFLOW_COMPOSE[@]}" exec -T db sh -c \
  'psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT EXISTS(SELECT 1 FROM users WHERE is_super_admin=TRUE AND deleted_at IS NULL)"')"
[[ "$super_admin_present" == t ]] || die 'Super Admin existente nao foi confirmado.'
password_file="$DEVFLOW_CONFIG_ROOT/super-admin-temporary-password"
[[ -f "$password_file" && ! -L "$password_file" \
  && "$(stat -c '%u:%g %a' "$password_file")" == '0:0 600' ]] \
  || die 'Arquivo da senha temporaria nao atende root:root 0600.'

state_file="$DEVFLOW_STATE_ROOT/installation.json"
state_valid=false
if installation_state_schema_valid "$state_file" && load_installation_state "$state_file"; then
  state_valid=true
fi
printf '%s\n' \
  "repair_mode=$MODE" \
  "installed_version=$INSTALLED_VERSION" \
  "installed_commit=$INSTALLED_COMMIT" \
  "migration=$DEVFLOW_MIGRATION_VERSION" \
  "certificate_valid=true" \
  "domain_valid=true" \
  "admin_email_valid=true" \
  "super_admin_preserved=true" \
  "temporary_password_preserved=true" \
  "installed_state_schema_valid=$state_valid"

if [[ "$MODE" == check ]]; then
  [[ "$state_valid" == true ]] || { diagnose_installation_state "$state_file" || true; exit 2; }
  "$SCRIPT_DIR/health.sh" --quiet
  exit 0
fi

backup_path=none
if [[ -e "$state_file" ]]; then
  [[ -f "$state_file" && ! -L "$state_file" ]] || die 'Estado anterior nao e um arquivo regular seguro.'
  backup_path="$DEVFLOW_STATE_ROOT/installation.json.backup-$(date -u +%Y%m%dT%H%M%SZ)"
  cp --preserve=mode,ownership,timestamps -- "$state_file" "$backup_path"
  chown root:root "$backup_path"; chmod 0600 "$backup_path"
fi

DEVFLOW_APPLICATION_INSTALLED=true
DEVFLOW_APPLICATION_HEALTHY=true
DEVFLOW_CERTIFICATE_ISSUED=true
export DEVFLOW_APPLICATION_INSTALLED DEVFLOW_APPLICATION_HEALTHY DEVFLOW_CERTIFICATE_ISSUED \
  DEVFLOW_MIGRATION_VERSION
write_installation_state || die 'Nao foi possivel escrever o estado reparado.'
installation_state_schema_valid "$state_file" || {
  diagnose_installation_state "$state_file" || true
  die 'O estado reparado foi recusado pelo schema v3.'
}
load_installation_state "$state_file" || die 'O estado reparado nao pode ser recarregado.'
"$SCRIPT_DIR/health.sh" --quiet
printf 'installation_state_repaired=true\ninstallation_state_backup=%s\n' "$backup_path"
