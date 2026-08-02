#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECKOUT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/proxy-config.sh
. "$SCRIPT_DIR/lib/proxy-config.sh"
# shellcheck source=lib/fullpassword-proxy.sh
. "$SCRIPT_DIR/lib/fullpassword-proxy.sh"

CHECK_ONLY=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) CHECK_ONLY=true; shift ;;
    --help|-h)
      cat <<'EOF'
Uso:
  sudo scripts/update.sh --check
  sudo scripts/update.sh

--check  consulta versão e changelog, sem backup ou alterações

Sem argumentos, exibe o plano e exige a confirmação literal ATUALIZAR DEVFLOW.
EOF
      exit 0
      ;;
    *) die "Opção desconhecida: $1" ;;
  esac
done

require_linux
require_root
command -v flock >/dev/null 2>&1 || die 'flock é obrigatório para impedir atualizações concorrentes.'
command -v git >/dev/null 2>&1 || die 'Git é obrigatório para consultar o repositório de atualização.'
command -v docker >/dev/null 2>&1 || die 'Docker não está disponível.'
docker compose version >/dev/null 2>&1 || die 'Docker Compose v2 não está disponível.'

exec 9>/run/lock/devflow-update.lock
flock -n 9 || die 'Outra atualização DevFlow está em andamento.'

load_devflow_env
validate_runtime_paths
[[ "$DEVFLOW_INSTALL_ROOT" == /opt/devflow ]] || die 'Diretório instalado inesperado.'
[[ "$DEVFLOW_PROXY_MODE" == isolated || "$DEVFLOW_PROXY_MODE" == shared ]] || die 'Modo de proxy inválido.'
validate_domain "$DEVFLOW_DOMAIN"
check_capacity "$DEVFLOW_INSTALL_ROOT"

SOURCE_DIR="${DEVFLOW_SOURCE_DIR:-$CHECKOUT_DIR}"
validate_safe_absolute_path "$SOURCE_DIR" 'Checkout operacional'
[[ -d "$SOURCE_DIR/.git" ]] || die "Checkout Git ausente: $SOURCE_DIR"
[[ "$(stat -c '%u' "$SOURCE_DIR")" == 0 && "$(stat -c '%u' "$SOURCE_DIR/.git")" == 0 ]] \
  || die 'O checkout operacional e seus metadados devem pertencer a root.'
source_mode="$(stat -c '%a' "$SOURCE_DIR")"
(( (8#$source_mode & 0022) == 0 )) || die 'O checkout operacional não pode ser gravável por grupo ou terceiros.'
[[ -z "$(find "$SOURCE_DIR" -xdev -perm /022 -print -quit)" ]] \
  || die 'O checkout operacional contém arquivos graváveis por grupo ou terceiros.'
[[ "$(git -C "$SOURCE_DIR" config --local --get core.hooksPath 2>/dev/null || true)" == /dev/null ]] \
  || die 'Hooks Git devem permanecer desabilitados no checkout operacional.'
[[ "$(git -C "$SOURCE_DIR" branch --show-current)" == main ]] || die 'O checkout operacional deve estar na branch main.'
[[ -z "$(git -C "$SOURCE_DIR" status --porcelain)" ]] || die 'O checkout operacional possui alterações locais.'
remote_url="$(git -C "$SOURCE_DIR" remote get-url origin 2>/dev/null || true)"
[[ "$remote_url" == 'https://github.com/trinityrrocha/DevFlow.git' ]] \
  || die 'O remote origin deve ser o HTTPS público de trinityrrocha/DevFlow.'

OLD_RELEASE_DIR="$(readlink -f "$DEVFLOW_INSTALL_ROOT/app" 2>/dev/null || true)"
validate_safe_absolute_path "$OLD_RELEASE_DIR" 'Release instalada'
[[ "$OLD_RELEASE_DIR" == "$DEVFLOW_INSTALL_ROOT/releases/"* ]] || die 'A release instalada está fora de /opt/devflow/releases.'
OLD_SHA="$(tr -d '\r\n' < "$OLD_RELEASE_DIR/.devflow-release" 2>/dev/null || true)"
[[ "$OLD_SHA" =~ ^[0-9a-f]{40}$ ]] || die 'Commit da release instalada não pôde ser confirmado.'
SOURCE_OLD_SHA="$(git -C "$SOURCE_DIR" rev-parse HEAD 2>/dev/null || true)"
[[ "$SOURCE_OLD_SHA" == "$OLD_SHA" ]] \
  || die 'O checkout operacional não corresponde exatamente à release instalada.'
if [[ -r "$OLD_RELEASE_DIR/VERSION" ]]; then
  OLD_VERSION="$(tr -d '\r\n' < "$OLD_RELEASE_DIR/VERSION")"
else
  OLD_VERSION="${DEVFLOW_VERSION:-unknown}"
fi
[[ "$OLD_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || die 'Versão instalada inválida.'
[[ "${DEVFLOW_VERSION:-}" == "$OLD_VERSION" ]] \
  || die 'DEVFLOW_VERSION diverge da release instalada; corrija a configuração antes de atualizar.'
for unit_file in /etc/systemd/system/devflow-backup.service /etc/systemd/system/devflow-backup.timer; do
  [[ -f "$unit_file" ]] || die "Unidade obrigatória ausente: $unit_file"
  managed_file "$unit_file" '# Managed by DevFlow installer.' || die "$unit_file pertence a outro sistema."
done
if [[ "$DEVFLOW_PROXY_MODE" == shared ]]; then
  if [[ "${DEVFLOW_SHARED_PROXY_ADAPTER:-host-nginx}" == fullpassword-nginx ]]; then
    [[ -f "$FULLPASSWORD_OVERRIDE_FILE" && "$(head -n1 "$FULLPASSWORD_OVERRIDE_FILE")" == "$FULLPASSWORD_OVERRIDE_MARKER" ]] \
      || die 'Override persistente do Full Password ausente ou divergente.'
    [[ -f "$DEVFLOW_PROXY_CONFIG" && "$(head -n1 "$DEVFLOW_PROXY_CONFIG")" == "$FULLPASSWORD_CONFIG_MARKER" ]] \
      || die 'Configuração independente DevFlow ausente ou divergente.'
    fullpassword_adapter_preflight || die 'Preflight do adaptador fullpassword_nginx falhou.'
  else
    managed_file /etc/nginx/conf.d/devflow.conf '# Managed by DevFlow installer. Do not merge with another application.' \
      || die '/etc/nginx/conf.d/devflow.conf pertence a outro sistema.'
    nginx -t >/dev/null 2>&1 || die 'A configuração Nginx atual é inválida.'
  fi
fi

TEMP_REMOTE_REPO=
if [[ "$CHECK_ONLY" == true ]]; then
  TEMP_REMOTE_REPO="$(mktemp -d "${TMPDIR:-/tmp}/devflow-update-check.XXXXXX")"
  cleanup_remote_check() { rm -rf -- "$TEMP_REMOTE_REPO"; }
  trap cleanup_remote_check EXIT INT TERM
  git -C "$TEMP_REMOTE_REPO" init --bare --quiet
  git -C "$TEMP_REMOTE_REPO" remote add origin "$remote_url"
  GIT_TERMINAL_PROMPT=0 git -C "$TEMP_REMOTE_REPO" fetch --quiet origin main
  REMOTE_REPO="$TEMP_REMOTE_REPO"
  REMOTE_REF=FETCH_HEAD
  UPDATE_LOG=not-created-check-only
else
  install -d -m 0750 "$DEVFLOW_LOG_ROOT" "$DEVFLOW_STATE_ROOT" "$DEVFLOW_INSTALL_ROOT/releases"
  UPDATE_LOG="$DEVFLOW_LOG_ROOT/update-$(date -u +%Y%m%dT%H%M%SZ).log"
  touch "$UPDATE_LOG"
  chmod 0640 "$UPDATE_LOG"
  exec > >(redact_stream | tee -a "$UPDATE_LOG") 2>&1
  GIT_TERMINAL_PROMPT=0 git -C "$SOURCE_DIR" fetch origin main
  REMOTE_REPO="$SOURCE_DIR"
  REMOTE_REF=origin/main
fi

log INFO "Iniciando verificação de atualização a partir de $OLD_VERSION ($OLD_SHA)."
NEW_SHA="$(git -C "$REMOTE_REPO" rev-parse "$REMOTE_REF")"
[[ "$NEW_SHA" =~ ^[0-9a-f]{40}$ ]] || die 'Commit remoto inválido.'
git -C "$REMOTE_REPO" merge-base --is-ancestor "$OLD_SHA" "$NEW_SHA" \
  || die 'origin/main não é uma continuação fast-forward da release instalada.'
NEW_VERSION="$(git -C "$REMOTE_REPO" show "$NEW_SHA:VERSION" 2>/dev/null | tr -d '\r\n' || true)"
[[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || die 'VERSION remoto ausente ou inválido.'

printf '\nVersão instalada: %s\nCommit instalado: %s\n' "$OLD_VERSION" "$OLD_SHA"
printf 'Versão disponível: %s\nCommit disponível: %s\n\n' "$NEW_VERSION" "$NEW_SHA"

if [[ "$NEW_SHA" == "$OLD_SHA" ]]; then
  log INFO 'A instalação já corresponde à versão disponível.'
  exit 0
fi
version_is_greater "$NEW_VERSION" "$OLD_VERSION" \
  || die "A versão remota $NEW_VERSION não é superior à instalada $OLD_VERSION."

CHANGELOG_CONTENT="$(git -C "$REMOTE_REPO" show "$NEW_SHA:CHANGELOG.md")"
CHANGELOG_SECTION="$(printf '%s\n' "$CHANGELOG_CONTENT" | awk -v version="$NEW_VERSION" '
  index($0, "## [" version "]") == 1 { printing=1 }
  printing && index($0, "## [") == 1 && index($0, "## [" version "]") != 1 { exit }
  printing { print }
')"
[[ -n "$CHANGELOG_SECTION" ]] || die "Changelog da versão $NEW_VERSION não encontrado."
printf '%s\n\n' "$CHANGELOG_SECTION"

if [[ "$CHECK_ONLY" == true ]]; then
  log INFO 'Verificação concluída sem alterações.'
  exit 0
fi

cat <<EOF
Plano de atualização:
  1. gerar e verificar backup criptografado;
  2. preparar release imutável $NEW_SHA;
  3. ativar modo de manutenção HTTP 503;
  4. aplicar migrations pendentes sob lock;
  5. recriar somente containers DevFlow;
  6. executar health checks internos e públicos;
  7. promover $NEW_VERSION e retirar manutenção;
  8. após a primeira mutação, restaurar backup e release $OLD_VERSION em qualquer falha.

Log sanitizado: $UPDATE_LOG
EOF
DEVFLOW_ASSUME_YES=false
confirm_exact 'ATUALIZAR DEVFLOW' "Confirma a atualização de $OLD_VERSION para $NEW_VERSION?"

NGINX_CONFIG=/etc/nginx/conf.d/devflow.conf
NGINX_MARKER='# Managed by DevFlow installer. Do not merge with another application.'
CANDIDATE_DIR="$DEVFLOW_INSTALL_ROOT/releases/$NEW_SHA"
CANDIDATE_TEMP=
CANDIDATE_CREATED=false
BACKUP_FILE=
ROLLBACK_ARMED=false
MAINTENANCE_ACTIVE=false
SOURCE_ADVANCED=false
BACKUP_TIMER_PAUSED=false
UPDATE_PHASE=backup
ROLLBACK_RESULT=not-required
EDGE_NETWORK_PREEXISTED=true

write_update_report() {
  local result="$1"
  {
    printf 'DevFlow update report\n'
    printf 'timestamp=%s\n' "$(timestamp)"
    printf 'result=%s\n' "$result"
    printf 'phase=%s\n' "$UPDATE_PHASE"
    printf 'from_version=%s\n' "$OLD_VERSION"
    printf 'to_version=%s\n' "$NEW_VERSION"
    printf 'from_commit=%s\n' "$OLD_SHA"
    printf 'to_commit=%s\n' "$NEW_SHA"
    printf 'backup=%s\n' "${BACKUP_FILE:-none}"
    printf 'rollback=%s\n' "$ROLLBACK_RESULT"
    printf 'log=%s\n' "$UPDATE_LOG"
  } > "$DEVFLOW_STATE_ROOT/update-report.txt"
  chmod 0640 "$DEVFLOW_STATE_ROOT/update-report.txt"
}

set_compose_for() {
  DEVFLOW_APP_ROOT="$1"
  compose_files
}

maintenance_compose_for() {
  local root="$1"
  DEVFLOW_MAINTENANCE_COMPOSE=(docker compose --env-file "$DEVFLOW_ENV_FILE" \
    -p devflow-maintenance --project-directory "$root" -f "$root/docker-compose.maintenance.yml")
}

render_host_proxy() {
  local root="$1" template="$2" output="$3"
  sed -e "s/__DEVFLOW_DOMAIN__/$DEVFLOW_DOMAIN/g" \
    -e "s/__DEVFLOW_HTTP_PORT__/${DEVFLOW_HTTP_PORT:-18080}/g" \
    -e "s/__DEVFLOW_API_PORT__/${DEVFLOW_API_PORT:-13000}/g" \
    "$root/docker/nginx/$template" > "$output"
}

maintenance_http_ok() {
  local status
  status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --max-time 20 "https://$DEVFLOW_DOMAIN/" || true)"
  [[ "$status" == 503 ]]
}

enter_maintenance() {
  local root="$1" candidate
  log INFO 'Ativando modo de manutenção.'
  if [[ "$DEVFLOW_PROXY_MODE" == shared ]]; then
    if [[ "${DEVFLOW_SHARED_PROXY_ADAPTER:-host-nginx}" == fullpassword-nginx ]]; then
      promote_fullpassword_proxy_config "$root" fullpassword-maintenance.conf.template "$DEVFLOW_DOMAIN" maintenance
    else
      candidate="$(mktemp /tmp/devflow-host-maintenance.XXXXXX)"
      render_host_proxy "$root" host-maintenance.conf.template "$candidate"
      promote_host_nginx_config "$candidate" "$NGINX_CONFIG" "$NGINX_MARKER" "$DEVFLOW_INSTALL_ROOT/backups/proxy"
    fi
  else
    set_compose_for "$OLD_RELEASE_DIR"
    "${DEVFLOW_COMPOSE[@]}" stop edge >/dev/null 2>&1 || true
    if [[ -r "$CANDIDATE_DIR/docker-compose.yml" ]]; then
      set_compose_for "$CANDIDATE_DIR"
      "${DEVFLOW_COMPOSE[@]}" stop edge >/dev/null 2>&1 || true
    fi
    maintenance_compose_for "$root"
    "${DEVFLOW_MAINTENANCE_COMPOSE[@]}" up -d --wait
  fi
  MAINTENANCE_ACTIVE=true
  maintenance_http_ok || return 1
  log INFO 'Modo de manutenção confirmado com HTTP 503.'
}

restore_proxy_for() {
  local root="$1" candidate
  if [[ "$DEVFLOW_PROXY_MODE" == shared ]]; then
    if [[ "${DEVFLOW_SHARED_PROXY_ADAPTER:-host-nginx}" == fullpassword-nginx ]]; then
      promote_fullpassword_proxy_config "$root" fullpassword-shared.conf.template "$DEVFLOW_DOMAIN" healthy
    else
      candidate="$(mktemp /tmp/devflow-host-proxy.XXXXXX)"
      render_host_proxy "$root" host-shared.conf.template "$candidate"
      promote_host_nginx_config "$candidate" "$NGINX_CONFIG" "$NGINX_MARKER" "$DEVFLOW_INSTALL_ROOT/backups/proxy"
    fi
  else
    maintenance_compose_for "$CANDIDATE_DIR"
    "${DEVFLOW_MAINTENANCE_COMPOSE[@]}" down --remove-orphans
    set_compose_for "$root"
    "${DEVFLOW_COMPOSE[@]}" up -d edge --wait
  fi
}

rollback_update() {
  local rollback_failures=0
  set +e
  log ERROR "Falha na fase $UPDATE_PHASE. Iniciando rollback automático."

  enter_maintenance "$CANDIDATE_DIR"
  [[ $? -eq 0 ]] || { log ERROR 'Não foi possível confirmar a página de manutenção durante o rollback.'; rollback_failures=$((rollback_failures + 1)); }

  UPDATE_PHASE=rollback-code
  (set_managed_env_value DEVFLOW_VERSION "$OLD_VERSION")
  [[ $? -eq 0 ]] || { log ERROR 'Não foi possível restaurar a versão no ambiente.'; rollback_failures=$((rollback_failures + 1)); }
  export DEVFLOW_VERSION="$OLD_VERSION"
  ln -sfn "$OLD_RELEASE_DIR" "$DEVFLOW_INSTALL_ROOT/app"
  [[ $? -eq 0 ]] || { log ERROR 'Não foi possível restaurar o link da release anterior.'; rollback_failures=$((rollback_failures + 1)); }
  rm -f -- "$DEVFLOW_INSTALL_ROOT/app.candidate"
  [[ $? -eq 0 ]] || rollback_failures=$((rollback_failures + 1))
  if [[ "$SOURCE_ADVANCED" == true ]]; then
    git -C "$SOURCE_DIR" reset --hard "$OLD_SHA"
    [[ $? -eq 0 ]] || { log ERROR 'Não foi possível retornar o checkout operacional.'; rollback_failures=$((rollback_failures + 1)); }
  fi

  set_compose_for "$OLD_RELEASE_DIR"
  "${DEVFLOW_COMPOSE[@]}" stop backend frontend
  [[ $? -eq 0 ]] || rollback_failures=$((rollback_failures + 1))
  "${DEVFLOW_COMPOSE[@]}" build backend frontend
  [[ $? -eq 0 ]] || { log ERROR 'Não foi possível reconstruir as imagens anteriores.'; rollback_failures=$((rollback_failures + 1)); }

  UPDATE_PHASE=rollback-restore
  CONFIRM_RESTORE='RESTAURAR BACKUP' \
    DEVFLOW_RESTORE_SKIP_PREBACKUP=true \
    DEVFLOW_RESTORE_NO_START=true \
    DEVFLOW_PROJECT_DIR="$OLD_RELEASE_DIR" \
    DEVFLOW_ENV_FILE="$DEVFLOW_ENV_FILE" \
    "$SCRIPT_DIR/restore.sh" "$BACKUP_FILE"
  [[ $? -eq 0 ]] || { log ERROR 'Restauração automática do backup falhou.'; rollback_failures=$((rollback_failures + 1)); }

  UPDATE_PHASE=rollback-containers
  set_compose_for "$OLD_RELEASE_DIR"
  "${DEVFLOW_COMPOSE[@]}" up -d db backend frontend --wait --remove-orphans
  [[ $? -eq 0 ]] || { log ERROR 'Containers anteriores não ficaram saudáveis.'; rollback_failures=$((rollback_failures + 1)); }
  DEVFLOW_APP_ROOT="$OLD_RELEASE_DIR" DEVFLOW_EXPECTED_VERSION="$OLD_VERSION" \
    "$CANDIDATE_DIR/scripts/health.sh" --internal
  [[ $? -eq 0 ]] || { log ERROR 'Health check interno da release anterior falhou.'; rollback_failures=$((rollback_failures + 1)); }

  UPDATE_PHASE=rollback-proxy
  restore_proxy_for "$OLD_RELEASE_DIR"
  [[ $? -eq 0 ]] || { log ERROR 'Não foi possível restaurar o proxy anterior.'; rollback_failures=$((rollback_failures + 1)); }
  MAINTENANCE_ACTIVE=false
  DEVFLOW_APP_ROOT="$OLD_RELEASE_DIR" DEVFLOW_EXPECTED_VERSION="$OLD_VERSION" \
    "$CANDIDATE_DIR/scripts/health.sh"
  [[ $? -eq 0 ]] || { log ERROR 'Health check público após rollback falhou.'; rollback_failures=$((rollback_failures + 1)); }

  for unit_name in devflow-backup.service devflow-backup.timer; do
    install -m 0644 "$OLD_RELEASE_DIR/scripts/systemd/$unit_name" "/etc/systemd/system/$unit_name"
    [[ $? -eq 0 ]] || rollback_failures=$((rollback_failures + 1))
  done
  systemctl daemon-reload
  [[ $? -eq 0 ]] || { log ERROR 'systemd daemon-reload falhou durante o rollback.'; rollback_failures=$((rollback_failures + 1)); }
  if systemctl enable --now devflow-backup.timer; then
    BACKUP_TIMER_PAUSED=false
  else
    log ERROR 'Não foi possível restaurar o timer de backup.'
    rollback_failures=$((rollback_failures + 1))
  fi

  if [[ "$rollback_failures" -eq 0 && "$CANDIDATE_CREATED" == true && "$CANDIDATE_DIR" == "$DEVFLOW_INSTALL_ROOT/releases/"* ]]; then
    rm -rf -- "$CANDIDATE_DIR"
    [[ $? -eq 0 ]] || { log ERROR 'Não foi possível remover a release candidata rejeitada.'; rollback_failures=$((rollback_failures + 1)); }
  fi

  if [[ "$EDGE_NETWORK_PREEXISTED" == false ]]; then
    remove_devflow_edge_network_if_unused
    [[ $? -eq 0 ]] || { log ERROR 'Não foi possível remover a rede de borda criada pela atualização rejeitada.'; rollback_failures=$((rollback_failures + 1)); }
  fi

  if [[ "$rollback_failures" -eq 0 ]]; then
    DEVFLOW_VERSION="$OLD_VERSION" write_version_state "$OLD_SHA" || rollback_failures=$((rollback_failures + 1))
  fi

  if [[ "$rollback_failures" -eq 0 ]]; then
    ROLLBACK_RESULT=success
    log WARN "Rollback concluído. DevFlow retornou a $OLD_VERSION ($OLD_SHA)."
  else
    ROLLBACK_RESULT=failed
    log ERROR "Rollback terminou com $rollback_failures falha(s); mantenha o ambiente isolado e use $UPDATE_LOG."
  fi
  set -e
  [[ "$rollback_failures" -eq 0 ]]
}

update_failed() {
  local exit_code=$?
  local failed_phase="$UPDATE_PHASE"
  [[ "$exit_code" -ne 0 ]] || return 0
  trap - EXIT ERR INT TERM
  rm -f -- "$DEVFLOW_INSTALL_ROOT/app.candidate"
  if [[ -n "$CANDIDATE_TEMP" && "$CANDIDATE_TEMP" == "$DEVFLOW_INSTALL_ROOT/releases/.candidate."* ]]; then
    rm -rf -- "$CANDIDATE_TEMP"
  fi
  if [[ "$ROLLBACK_ARMED" == false && "$CANDIDATE_CREATED" == true && "$CANDIDATE_DIR" == "$DEVFLOW_INSTALL_ROOT/releases/"* ]]; then
    rm -rf -- "$CANDIDATE_DIR"
  fi
  if [[ "$ROLLBACK_ARMED" == false && "$BACKUP_TIMER_PAUSED" == true ]]; then
    systemctl start devflow-backup.timer || true
  fi
  if [[ "$ROLLBACK_ARMED" == true ]]; then
    rollback_update || true
  fi
  UPDATE_PHASE="$failed_phase"
  write_update_report failure || true
  log ERROR "Atualização interrompida (código $exit_code). rollback=$ROLLBACK_RESULT"
  exit "$exit_code"
}
trap update_failed EXIT
trap 'exit 130' INT TERM

log INFO 'Criando backup pré-update.'
BACKUP_OUTPUT="$(DEVFLOW_PROJECT_DIR="$OLD_RELEASE_DIR" \
  DEVFLOW_ENV_FILE="$DEVFLOW_ENV_FILE" \
  BACKUP_ARCHIVE_DIR="$DEVFLOW_INSTALL_ROOT/backups" \
  BACKUP_PASSPHRASE_FILE="$DEVFLOW_CONFIG_ROOT/backup.passphrase" \
  "$OLD_RELEASE_DIR/scripts/backup.sh")"
printf '%s\n' "$BACKUP_OUTPUT"
BACKUP_FILE="$(printf '%s\n' "$BACKUP_OUTPUT" | sed -n 's/^Backup criado: //p' | tail -n1)"
[[ -n "$BACKUP_FILE" && -s "$BACKUP_FILE" ]] || die 'Backup pré-update não foi criado.'
DEVFLOW_PROJECT_DIR="$OLD_RELEASE_DIR" DEVFLOW_ENV_FILE="$DEVFLOW_ENV_FILE" \
  "$OLD_RELEASE_DIR/scripts/verify-backup.sh" "$BACKUP_FILE"
log INFO "Backup autenticado e validado: $BACKUP_FILE"

UPDATE_PHASE=release
[[ ! -e "$CANDIDATE_DIR" ]] \
  || die 'A release candidata já existe; preserve o ambiente e investigue a tentativa anterior antes de removê-la.'
CANDIDATE_TEMP="$(mktemp -d "$DEVFLOW_INSTALL_ROOT/releases/.candidate.$NEW_SHA.XXXXXX")"
chmod 0750 "$CANDIDATE_TEMP"
git -C "$SOURCE_DIR" archive "$NEW_SHA" | tar -x -C "$CANDIDATE_TEMP"
printf '%s\n' "$NEW_SHA" > "$CANDIDATE_TEMP/.devflow-release"
chmod 0644 "$CANDIDATE_TEMP/.devflow-release"
mv -- "$CANDIDATE_TEMP" "$CANDIDATE_DIR"
CANDIDATE_TEMP=
CANDIDATE_CREATED=true
[[ "$(tr -d '\r\n' < "$CANDIDATE_DIR/VERSION")" == "$NEW_VERSION" ]] || die 'Release candidata possui versão divergente.'
[[ -x "$CANDIDATE_DIR/scripts/health.sh" && -r "$CANDIDATE_DIR/docker-compose.maintenance.yml" ]] \
  || die 'Release candidata não contém os componentes transacionais obrigatórios.'
systemctl stop devflow-backup.timer
BACKUP_TIMER_PAUSED=true
if systemctl is-active --quiet devflow-backup.service; then
  systemctl start devflow-backup.timer || true
  BACKUP_TIMER_PAUSED=false
  die 'Um backup agendado ainda está ativo; a atualização foi cancelada antes de qualquer mutação.'
fi
ln -sfn "$CANDIDATE_DIR" "$DEVFLOW_INSTALL_ROOT/app.candidate"
ROLLBACK_ARMED=true

if ! docker network inspect "$DEVFLOW_EDGE_NETWORK" >/dev/null 2>&1; then
  EDGE_NETWORK_PREEXISTED=false
fi
ensure_devflow_edge_network || die 'A rede externa devflow_edge não pôde ser preparada com propriedade segura.'

UPDATE_PHASE=source
SOURCE_ADVANCED=true
git -C "$SOURCE_DIR" merge --ff-only "$NEW_SHA"
[[ -z "$(git -C "$SOURCE_DIR" status --porcelain)" ]] || die 'Checkout ficou inconsistente após fast-forward.'
[[ "$(git -C "$SOURCE_DIR" rev-parse HEAD)" == "$NEW_SHA" ]] || die 'Checkout não atingiu o commit esperado.'

export DEVFLOW_VERSION="$NEW_VERSION"
set_compose_for "$CANDIDATE_DIR"
"${DEVFLOW_COMPOSE[@]}" config --quiet
"${DEVFLOW_COMPOSE[@]}" build backend frontend

UPDATE_PHASE=maintenance
enter_maintenance "$CANDIDATE_DIR"

UPDATE_PHASE=migrations
set_compose_for "$CANDIDATE_DIR"
"${DEVFLOW_COMPOSE[@]}" stop backend frontend
"${DEVFLOW_COMPOSE[@]}" up -d db --wait
"${DEVFLOW_COMPOSE[@]}" exec -T db sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
"${DEVFLOW_COMPOSE[@]}" run --rm --no-deps backend node scripts/migrate.js
DEVFLOW_MIGRATION_VERSION="$("${DEVFLOW_COMPOSE[@]}" exec -T db sh -c \
  'psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT version FROM schema_migrations ORDER BY applied_at DESC LIMIT 1"')"
[[ -n "$DEVFLOW_MIGRATION_VERSION" ]] || die 'PostgreSQL não confirmou a migration após atualização.'

UPDATE_PHASE=containers
"${DEVFLOW_COMPOSE[@]}" up -d backend frontend --wait --force-recreate --remove-orphans

UPDATE_PHASE=health-internal
DEVFLOW_APP_ROOT="$CANDIDATE_DIR" DEVFLOW_EXPECTED_VERSION="$NEW_VERSION" \
  DEVFLOW_HEALTH_ALLOW_PENDING_VERSION=true \
  "$CANDIDATE_DIR/scripts/health.sh" --internal

UPDATE_PHASE=promotion
set_managed_env_value DEVFLOW_VERSION "$NEW_VERSION"
ln -sfn "$CANDIDATE_DIR" "$DEVFLOW_INSTALL_ROOT/app"

UPDATE_PHASE=proxy
restore_proxy_for "$CANDIDATE_DIR"
MAINTENANCE_ACTIVE=false

UPDATE_PHASE=health-public
DEVFLOW_APP_ROOT="$CANDIDATE_DIR" DEVFLOW_EXPECTED_VERSION="$NEW_VERSION" \
  "$CANDIDATE_DIR/scripts/health.sh"

UPDATE_PHASE=finalize
rm -f -- "$DEVFLOW_INSTALL_ROOT/app.candidate"
install -m 0644 "$CANDIDATE_DIR/scripts/systemd/devflow-backup.service" /etc/systemd/system/devflow-backup.service
install -m 0644 "$CANDIDATE_DIR/scripts/systemd/devflow-backup.timer" /etc/systemd/system/devflow-backup.timer
systemctl daemon-reload
systemctl enable --now devflow-backup.timer
BACKUP_TIMER_PAUSED=false
write_version_state "$NEW_SHA"
ROLLBACK_RESULT=not-required
write_update_report success
ROLLBACK_ARMED=false
trap - EXIT ERR INT TERM
log INFO "Atualização concluída: $OLD_VERSION ($OLD_SHA) -> $NEW_VERSION ($NEW_SHA)."
