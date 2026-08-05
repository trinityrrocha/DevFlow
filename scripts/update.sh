#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECKOUT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/compose-images.sh
. "$SCRIPT_DIR/lib/compose-images.sh"

CHECK_ONLY=false
ROLLBACK_REQUESTED=false
EXPECTED_UPDATE_VERSION=
REQUEST_FILE=
DAEMON_MODE=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) CHECK_ONLY=true; shift ;;
    --rollback) ROLLBACK_REQUESTED=true; shift ;;
    --request-file)
      [[ -n "${2:-}" ]] || die '--request-file exige um arquivo.'
      REQUEST_FILE="$2"; DAEMON_MODE=true; shift 2
      ;;
    --expected-version)
      [[ -n "${2:-}" ]] || die '--expected-version exige um valor.'
      EXPECTED_UPDATE_VERSION="$2"
      shift 2
      ;;
    --help|-h)
      cat <<'EOF'
Uso:
  sudo scripts/update.sh --check [--expected-version SEMVER]
  sudo scripts/update.sh [--expected-version SEMVER]

--check  consulta versão e changelog, sem backup ou alterações

Sem argumentos, exibe o plano e exige a escolha numérica explícita ATUALIZAR DEVFLOW.
EOF
      exit 0
      ;;
    *) die "Opção desconhecida: $1" ;;
  esac
done

[[ "$ROLLBACK_REQUESTED" == false || "$CHECK_ONLY" == false ]] \
  || die '--rollback e --check sao mutuamente exclusivos.'
[[ "$ROLLBACK_REQUESTED" == false || -z "$EXPECTED_UPDATE_VERSION" ]] \
  || die '--expected-version nao se aplica ao rollback.'
[[ -z "$EXPECTED_UPDATE_VERSION" ]] || devflow_semver_is_valid "$EXPECTED_UPDATE_VERSION" \
  || die 'Versão explicitamente esperada não atende ao contrato SemVer.'

require_linux
require_root
command -v flock >/dev/null 2>&1 || die 'flock é obrigatório para impedir atualizações concorrentes.'
command -v git >/dev/null 2>&1 || die 'Git é obrigatório para consultar o repositório de atualização.'
command -v tar >/dev/null 2>&1 || die 'tar é obrigatório para validar a consistência da release.'
command -v docker >/dev/null 2>&1 || die 'Docker não está disponível.'
docker compose version >/dev/null 2>&1 || die 'Docker Compose v2 não está disponível.'

install -d -m 0750 /run/lock/devflow
exec 9>/run/lock/devflow/update.lock
flock -n 9 || die 'Outra atualização DevFlow está em andamento.'

load_devflow_env
validate_runtime_paths
if [[ "$DAEMON_MODE" == true ]]; then
  [[ "${DEVFLOW_UPDATE_DAEMON:-false}" == true \
    && "$REQUEST_FILE" == /var/lib/devflow-updater/processing/*.json \
    && -f "$REQUEST_FILE" && ! -L "$REQUEST_FILE" ]] || die 'Contexto do updater daemon invalido.'
  request_id="${REQUEST_FILE##*/}"; request_id="${request_id%.json}"
  node "$SCRIPT_DIR/validate-updater-request.mjs" "$REQUEST_FILE" "$request_id" >/dev/null \
    || die 'Solicitacao assinada do updater invalida.'
  [[ "$ROLLBACK_REQUESTED" == false && "$CHECK_ONLY" == false ]] || die 'O daemon aceita somente install-update.'
fi
[[ "$DEVFLOW_INSTALL_ROOT" == /opt/devflow ]] || die 'Diretório instalado inesperado.'
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
DEVFLOW_INSTALLED_SOURCE_DIR="$SOURCE_DIR"
DEVFLOW_IDENTITY_RELEASE_ROOT="$OLD_RELEASE_DIR"
validate_installed_state_consistency "$DEVFLOW_STATE_ROOT/installation.json" \
  || die 'Estado instalado schema v3 inconsistente; atualização bloqueada.'
[[ "$DEVFLOW_INSTALLATION_STATE_MODE" == isolated ]] || die 'A atualização aceita somente instalações isoladas.'
OLD_SHA="$INSTALLED_COMMIT"
OLD_VERSION="$INSTALLED_VERSION"
SOURCE_OLD_SHA="$(git -C "$SOURCE_DIR" rev-parse HEAD 2>/dev/null || true)"
[[ "$SOURCE_OLD_SHA" == "$OLD_SHA" ]] \
  || die 'O checkout operacional não corresponde exatamente à release instalada.'
devflow_semver_is_valid "$OLD_VERSION" || die 'Versão instalada inválida.'
[[ "${DEVFLOW_VERSION:-}" == "$OLD_VERSION" ]] \
  || die 'DEVFLOW_VERSION diverge da release instalada; corrija a configuração antes de atualizar.'
if [[ "$DAEMON_MODE" == false ]]; then
for unit_file in /etc/systemd/system/devflow-backup.service /etc/systemd/system/devflow-backup.timer; do
  [[ -f "$unit_file" ]] || die "Unidade obrigatória ausente: $unit_file"
  managed_file "$unit_file" '# Managed by DevFlow installer.' || die "$unit_file pertence a outro sistema."
done
else
  [[ -f "$DEVFLOW_STATE_ROOT/host-units.installed" ]] \
    || die 'O host nao confirmou a instalacao das unidades operacionais.'
fi
DEVFLOW_APP_ROOT="$OLD_RELEASE_DIR"
DEVFLOW_VERSION="$OLD_VERSION"
DEVFLOW_RELEASE_COMMIT="$OLD_SHA"
export DEVFLOW_APP_ROOT DEVFLOW_VERSION DEVFLOW_RELEASE_COMMIT DEVFLOW_INSTALLED_SOURCE_DIR \
  DEVFLOW_IDENTITY_RELEASE_ROOT
compose_files
validate_installed_release_runtime \
  || die 'Identidade da release instalada diverge das imagens ou da API; atualização bloqueada.'

TEMP_REMOTE_REPO=
if [[ "$ROLLBACK_REQUESTED" == false && "$CHECK_ONLY" == true ]]; then
  TEMP_REMOTE_REPO="$(mktemp -d "${TMPDIR:-/tmp}/devflow-update-check.XXXXXX")"
  cleanup_remote_check() { rm -rf -- "$TEMP_REMOTE_REPO"; }
  trap cleanup_remote_check EXIT INT TERM
  git -C "$TEMP_REMOTE_REPO" init --bare --quiet
  git -C "$TEMP_REMOTE_REPO" remote add origin "$remote_url"
  GIT_TERMINAL_PROMPT=0 git -C "$TEMP_REMOTE_REPO" fetch --quiet origin main
  REMOTE_REPO="$TEMP_REMOTE_REPO"
  REMOTE_REF=FETCH_HEAD
  UPDATE_LOG=not-created-check-only
elif [[ "$ROLLBACK_REQUESTED" == false ]]; then
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
if [[ "$ROLLBACK_REQUESTED" == false ]]; then
NEW_SHA="$(git -C "$REMOTE_REPO" rev-parse "$REMOTE_REF")"
[[ "$NEW_SHA" =~ ^[0-9a-f]{40}$ ]] || die 'Commit remoto inválido.'
git -C "$REMOTE_REPO" merge-base --is-ancestor "$OLD_SHA" "$NEW_SHA" \
  || die 'origin/main não é uma continuação fast-forward da release instalada.'
NEW_VERSION="$(devflow_validate_git_tree_version_consistency "$REMOTE_REPO" "$NEW_SHA" 2>/dev/null || true)"
devflow_semver_is_valid "$NEW_VERSION" || die 'version_consistency=false; release remota ausente, inválida ou divergente.'
if [[ -n "$EXPECTED_UPDATE_VERSION" && "$NEW_VERSION" != "$EXPECTED_UPDATE_VERSION" ]]; then
  devflow_version_mismatch_message main "$EXPECTED_UPDATE_VERSION" "$NEW_VERSION" "$NEW_SHA" >&2
  exit 1
fi

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
if [[ "$DAEMON_MODE" == false ]]; then
require_numeric_confirmation application-update \
  "A atualização do DevFlow de $OLD_VERSION para $NEW_VERSION está pronta." \
  'ATUALIZAR DEVFLOW'
else
  log INFO "Atualizacao autorizada por solicitacao assinada: $request_id"
fi

else
  install -d -m 0750 "$DEVFLOW_LOG_ROOT" "$DEVFLOW_STATE_ROOT" "$DEVFLOW_INSTALL_ROOT/releases"
  UPDATE_LOG="$DEVFLOW_LOG_ROOT/update-rollback-$(date -u +%Y%m%dT%H%M%SZ).log"
  touch "$UPDATE_LOG"
  chmod 0640 "$UPDATE_LOG"
  exec > >(redact_stream | tee -a "$UPDATE_LOG") 2>&1
fi

UPDATE_TRANSACTION_FILE="$DEVFLOW_STATE_ROOT/update-transaction.json"
if [[ "$ROLLBACK_REQUESTED" == true ]]; then
  [[ "$(installation_state_value state "$UPDATE_TRANSACTION_FILE" 2>/dev/null || true)" == completed ]] \
    || die 'A ultima atualizacao nao possui transacao concluida apta a rollback.'
  CURRENT_VERSION="$OLD_VERSION"
  CURRENT_SHA="$OLD_SHA"
  CURRENT_RELEASE_DIR="$OLD_RELEASE_DIR"
  NEW_VERSION="$(installation_state_value candidateVersion "$UPDATE_TRANSACTION_FILE")"
  NEW_SHA="$(installation_state_value candidateCommit "$UPDATE_TRANSACTION_FILE")"
  [[ "$NEW_VERSION" == "$CURRENT_VERSION" && "$NEW_SHA" == "$CURRENT_SHA" ]] \
    || die 'A transacao nao corresponde a release atualmente instalada.'
  OLD_VERSION="$(installation_state_value previousInstalledVersion "$UPDATE_TRANSACTION_FILE")"
  OLD_SHA="$(installation_state_value previousInstalledCommit "$UPDATE_TRANSACTION_FILE")"
  OLD_RELEASE_DIR="$(installation_state_value previousReleaseDirectory "$UPDATE_TRANSACTION_FILE")"
  BACKUP_FILE="$(installation_state_value backupFile "$UPDATE_TRANSACTION_FILE")"
  validate_safe_absolute_path "$OLD_RELEASE_DIR" 'Release anterior'
  validate_safe_absolute_path "$BACKUP_FILE" 'Backup da atualizacao'
  [[ "$OLD_RELEASE_DIR" == "$DEVFLOW_INSTALL_ROOT/releases/"* && -d "$OLD_RELEASE_DIR" ]] \
    || die 'Release anterior registrada esta ausente.'
  [[ "$BACKUP_FILE" == "$DEVFLOW_INSTALL_ROOT/backups/"* && -s "$BACKUP_FILE" ]] \
    || die 'Backup da atualizacao esta ausente.'
  CANDIDATE_DIR="$CURRENT_RELEASE_DIR"
else
  CANDIDATE_DIR="$DEVFLOW_INSTALL_ROOT/releases/$NEW_SHA"
  BACKUP_FILE=
fi
CANDIDATE_TEMP=
CANDIDATE_CREATED="$ROLLBACK_REQUESTED"
ROLLBACK_ARMED="$ROLLBACK_REQUESTED"
MAINTENANCE_ACTIVE=false
SOURCE_ADVANCED="$ROLLBACK_REQUESTED"
BACKUP_TIMER_PAUSED=false
UPDATE_PHASE=backup
[[ "$ROLLBACK_REQUESTED" == false ]] || UPDATE_PHASE=manual-rollback
ROLLBACK_RESULT=not-required

pause_backup_schedule() {
  [[ "$DAEMON_MODE" == true ]] && return 0
  systemctl stop devflow-backup.timer
  BACKUP_TIMER_PAUSED=true
  if systemctl is-active --quiet devflow-backup.service; then
    systemctl start devflow-backup.timer || true
    BACKUP_TIMER_PAUSED=false
    return 1
  fi
}

refresh_host_units() {
  local release="$1" unit_name
  [[ "$DAEMON_MODE" == true ]] && return 0
  for unit_name in devflow-backup.service devflow-backup.timer \
    devflow-certificate-renewal.service devflow-certificate-renewal.timer; do
    install -m 0644 "$release/scripts/systemd/$unit_name" "/etc/systemd/system/$unit_name" || return 1
  done
  systemctl daemon-reload
  systemctl enable --now devflow-backup.timer devflow-certificate-renewal.timer
  BACKUP_TIMER_PAUSED=false
}

write_update_transaction() {
  local state="$1" temporary
  temporary="$(mktemp "$DEVFLOW_STATE_ROOT/.update-transaction.XXXXXX")"
  {
    printf '{\n'
    printf '  "schemaVersion": 1,\n'
    printf '  "timestamp": "%s",\n' "$(timestamp)"
    printf '  "state": "%s",\n' "$state"
    printf '  "previousInstalledVersion": "%s",\n' "$OLD_VERSION"
    printf '  "previousInstalledCommit": "%s",\n' "$OLD_SHA"
    printf '  "candidateVersion": "%s",\n' "$NEW_VERSION"
    printf '  "candidateCommit": "%s",\n' "$NEW_SHA"
    printf '  "previousReleaseDirectory": "%s",\n' "$OLD_RELEASE_DIR"
    printf '  "backupFile": "%s"\n' "${BACKUP_FILE:-pending}"
    printf '}\n'
  } > "$temporary"
  chmod 0600 "$temporary"
  python3 -m json.tool "$temporary" >/dev/null || { rm -f -- "$temporary"; return 1; }
  sync -f "$temporary" 2>/dev/null || true
  mv -f -- "$temporary" "$UPDATE_TRANSACTION_FILE"
}

persist_operational_installation_state() {
  DEVFLOW_APPLICATION_INSTALLED=true
  DEVFLOW_APPLICATION_HEALTHY=true
  DEVFLOW_CERTIFICATE_ISSUED="$DEVFLOW_INSTALLATION_STATE_CERTIFICATE_ISSUED"
  ADMIN_EMAIL="$DEVFLOW_INSTALLATION_STATE_ADMIN_EMAIL"
  DEVFLOW_MIGRATION_VERSION="${DEVFLOW_MIGRATION_VERSION:-$DEVFLOW_INSTALLATION_STATE_MIGRATION}"
  export DEVFLOW_APPLICATION_INSTALLED DEVFLOW_APPLICATION_HEALTHY \
    DEVFLOW_CERTIFICATE_ISSUED ADMIN_EMAIL DEVFLOW_MIGRATION_VERSION
  write_installation_state
}

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
  build_devflow_compose_command "$root" "$DEVFLOW_ENV_FILE" DEVFLOW_MAINTENANCE_COMPOSE \
    devflow-maintenance maintenance \
    || die 'Não foi possível montar o Compose de manutenção com a configuração privada.'
}

maintenance_http_ok() {
  local status resolve_ip=127.0.0.1
  if [[ "$DAEMON_MODE" == true ]]; then
    resolve_ip="$(docker inspect --format '{{(index .NetworkSettings.Networks "devflow_edge").IPAddress}}' devflow-maintenance 2>/dev/null || true)"
  fi
  validate_ipv4 "$resolve_ip" || return 1
  status="$(curl --resolve "$DEVFLOW_DOMAIN:443:$resolve_ip" --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --max-time 20 "https://$DEVFLOW_DOMAIN/" || true)"
  [[ "$status" == 503 ]]
}

enter_maintenance() {
  local root="$1"
  log INFO 'Ativando modo de manutenção.'
  set_compose_for "$OLD_RELEASE_DIR"
  "${DEVFLOW_COMPOSE[@]}" stop edge >/dev/null 2>&1 || true
  if [[ -r "$CANDIDATE_DIR/docker-compose.yml" ]]; then
    set_compose_for "$CANDIDATE_DIR"
    "${DEVFLOW_COMPOSE[@]}" stop edge >/dev/null 2>&1 || true
  fi
  maintenance_compose_for "$root"
  "${DEVFLOW_MAINTENANCE_COMPOSE[@]}" up -d --wait
  MAINTENANCE_ACTIVE=true
  maintenance_http_ok || return 1
  log INFO 'Modo de manutenção confirmado com HTTP 503.'
}

restore_proxy_for() {
  local root="$1"
  maintenance_compose_for "$CANDIDATE_DIR"
  "${DEVFLOW_MAINTENANCE_COMPOSE[@]}" down --remove-orphans
  set_compose_for "$root"
  "${DEVFLOW_COMPOSE[@]}" up -d edge --wait
}

rollback_update() {
  local rollback_failures=0 recorded_previous_commit
  set +e
  log ERROR "Falha na fase $UPDATE_PHASE. Iniciando rollback automático."
  recorded_previous_commit="$(installation_state_value previousInstalledCommit "$UPDATE_TRANSACTION_FILE" 2>/dev/null || true)"
  if [[ "$recorded_previous_commit" != "$OLD_SHA" ]] \
    || ! git -C "$SOURCE_DIR" cat-file -e "$recorded_previous_commit^{commit}" 2>/dev/null; then
    log ERROR 'previousInstalledCommit transacional não corresponde à release anterior comprovada.'
    return 1
  fi

  enter_maintenance "$CANDIDATE_DIR"
  [[ $? -eq 0 ]] || { log ERROR 'Não foi possível confirmar a página de manutenção durante o rollback.'; rollback_failures=$((rollback_failures + 1)); }

  UPDATE_PHASE=rollback-code
  (set_managed_env_value DEVFLOW_VERSION "$OLD_VERSION")
  [[ $? -eq 0 ]] || { log ERROR 'Não foi possível restaurar a versão no ambiente.'; rollback_failures=$((rollback_failures + 1)); }
  (set_managed_env_value DEVFLOW_RELEASE_COMMIT "$recorded_previous_commit")
  [[ $? -eq 0 ]] || { log ERROR 'Não foi possível restaurar o commit no ambiente.'; rollback_failures=$((rollback_failures + 1)); }
  export DEVFLOW_VERSION="$OLD_VERSION"
  export DEVFLOW_RELEASE_COMMIT="$OLD_SHA"
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
  "${DEVFLOW_COMPOSE[@]}" build backend frontend updater
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
  render_runtime_nginx_config "$OLD_RELEASE_DIR" "$DEVFLOW_NGINX_CONFIG_PATH"
  restore_proxy_for "$OLD_RELEASE_DIR"
  [[ $? -eq 0 ]] || { log ERROR 'Não foi possível restaurar o proxy anterior.'; rollback_failures=$((rollback_failures + 1)); }
  MAINTENANCE_ACTIVE=false
  DEVFLOW_APP_ROOT="$OLD_RELEASE_DIR" DEVFLOW_EXPECTED_VERSION="$OLD_VERSION" \
    "$CANDIDATE_DIR/scripts/health.sh"
  [[ $? -eq 0 ]] || { log ERROR 'Health check público após rollback falhou.'; rollback_failures=$((rollback_failures + 1)); }

  if ! refresh_host_units "$OLD_RELEASE_DIR"; then
    log ERROR 'Nao foi possivel restaurar as unidades operacionais do host.'
    rollback_failures=$((rollback_failures + 1))
  fi

  if [[ "$rollback_failures" -eq 0 && "$CANDIDATE_CREATED" == true && "$CANDIDATE_DIR" == "$DEVFLOW_INSTALL_ROOT/releases/"* ]]; then
    rm -rf -- "$CANDIDATE_DIR"
    [[ $? -eq 0 ]] || { log ERROR 'Não foi possível remover a release candidata rejeitada.'; rollback_failures=$((rollback_failures + 1)); }
  fi

  if [[ "$rollback_failures" -eq 0 ]]; then
    DEVFLOW_VERSION="$OLD_VERSION"
    DEVFLOW_RELEASE_COMMIT="$recorded_previous_commit"
    DEVFLOW_IDENTITY_RELEASE_ROOT="$OLD_RELEASE_DIR"
    export DEVFLOW_VERSION DEVFLOW_RELEASE_COMMIT DEVFLOW_IDENTITY_RELEASE_ROOT
    set_compose_for "$OLD_RELEASE_DIR"
    DEVFLOW_MIGRATION_VERSION="$("${DEVFLOW_COMPOSE[@]}" exec -T db sh -c \
      'psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT version FROM schema_migrations ORDER BY applied_at DESC LIMIT 1"' \
      2>/dev/null || true)"
    resolve_installed_release_identity "$SOURCE_DIR" main >/dev/null \
      && [[ "$INSTALLED_COMMIT" == "$recorded_previous_commit" ]] \
      && persist_operational_installation_state \
      || rollback_failures=$((rollback_failures + 1))
  fi

  if [[ "$rollback_failures" -eq 0 ]]; then
    write_update_transaction rolled-back || rollback_failures=$((rollback_failures + 1))
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
  if [[ "$DAEMON_MODE" == false && "$ROLLBACK_ARMED" == false && "$BACKUP_TIMER_PAUSED" == true ]]; then
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

if [[ "$ROLLBACK_REQUESTED" == true ]]; then
  require_numeric_confirmation application-update-rollback \
    "A release $CURRENT_VERSION sera revertida para $OLD_VERSION usando o backup validado da atualizacao." \
    'REVERTER ATUALIZACAO'
  manual_rollback_status=0
  rollback_update || manual_rollback_status=$?
  ROLLBACK_ARMED=false
  [[ "$manual_rollback_status" -eq 0 ]] || die 'Rollback manual da atualizacao nao foi concluido.'
  write_update_report manual-rollback
  trap - EXIT ERR INT TERM
  exit 0
fi

write_update_transaction prepared \
  || die 'Não foi possível registrar a identidade transacional da atualização.'
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
candidate_version="$(devflow_validate_directory_version_consistency "$CANDIDATE_DIR")" \
  || die 'version_consistency=false; release candidata possui versões divergentes.'
[[ "$candidate_version" == "$NEW_VERSION" ]] || die 'Release candidata possui versão divergente.'
[[ -x "$CANDIDATE_DIR/scripts/health.sh" && -r "$CANDIDATE_DIR/docker-compose.maintenance.yml" ]] \
  || die 'Release candidata não contém os componentes transacionais obrigatórios.'
if ! pause_backup_schedule; then
  die 'Um backup agendado ainda está ativo; a atualização foi cancelada antes de qualquer mutação.'
fi
ln -sfn "$CANDIDATE_DIR" "$DEVFLOW_INSTALL_ROOT/app.candidate"
ROLLBACK_ARMED=true

UPDATE_PHASE=source
SOURCE_ADVANCED=true
GIT_TERMINAL_PROMPT=0 git -C "$SOURCE_DIR" pull --ff-only origin main
[[ -z "$(git -C "$SOURCE_DIR" status --porcelain)" ]] || die 'Checkout ficou inconsistente após fast-forward.'
[[ "$(git -C "$SOURCE_DIR" rev-parse HEAD)" == "$NEW_SHA" ]] || die 'Checkout não atingiu o commit esperado.'

export DEVFLOW_VERSION="$NEW_VERSION"
export DEVFLOW_RELEASE_COMMIT="$NEW_SHA"
set_compose_for "$CANDIDATE_DIR"
"${DEVFLOW_COMPOSE[@]}" config --quiet
render_runtime_nginx_config "$CANDIDATE_DIR" "$DEVFLOW_NGINX_CONFIG_PATH"
"${DEVFLOW_COMPOSE[@]}" build backend frontend updater
candidate_backend_image="$(resolve_compose_service_image backend)" \
  || die 'A imagem candidata do backend não pôde ser resolvida após a build.'
candidate_backend_image_id="$(docker image inspect --format '{{.Id}}' "$candidate_backend_image")"
candidate_expected_migration="$(find "$CANDIDATE_DIR/database/migrations" -maxdepth 1 -type f -name '*.sql' -print \
  | sed 's#.*/##' | LC_ALL=C sort | tail -n1)"
candidate_expected_migration_sha256="$(sha256sum "$CANDIDATE_DIR/database/migrations/$candidate_expected_migration" | awk '{print $1}')"
candidate_image_validation_status=0
validate_backend_migration_image "$candidate_backend_image" "$candidate_expected_migration" \
  "$candidate_backend_image_id" "$candidate_expected_migration_sha256" \
  || candidate_image_validation_status=$?
case "$candidate_image_validation_status" in
  0) ;;
  40|41|43|44|45|46|47|48) die 'A imagem candidata do backend não atende ao contrato de conteúdo e permissões das migrations.' ;;
  *) die 'O runtime Docker não conseguiu validar a imagem candidata do backend.' ;;
esac

UPDATE_PHASE=maintenance
enter_maintenance "$CANDIDATE_DIR"

UPDATE_PHASE=migrations
set_compose_for "$CANDIDATE_DIR"
"${DEVFLOW_COMPOSE[@]}" stop backend frontend
"${DEVFLOW_COMPOSE[@]}" up -d db --wait
"${DEVFLOW_COMPOSE[@]}" exec -T db sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
run_devflow_migrations
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
set_managed_env_value DEVFLOW_RELEASE_COMMIT "$NEW_SHA"
ln -sfn "$CANDIDATE_DIR" "$DEVFLOW_INSTALL_ROOT/app"

UPDATE_PHASE=proxy
render_runtime_nginx_config "$CANDIDATE_DIR" "$DEVFLOW_NGINX_CONFIG_PATH"
restore_proxy_for "$CANDIDATE_DIR"
MAINTENANCE_ACTIVE=false

UPDATE_PHASE=health-public
DEVFLOW_APP_ROOT="$CANDIDATE_DIR" DEVFLOW_EXPECTED_VERSION="$NEW_VERSION" \
  DEVFLOW_HEALTH_ALLOW_PENDING_VERSION=true \
  "$CANDIDATE_DIR/scripts/health.sh"

UPDATE_PHASE=finalize
rm -f -- "$DEVFLOW_INSTALL_ROOT/app.candidate"
refresh_host_units "$CANDIDATE_DIR"
DEVFLOW_VERSION="$NEW_VERSION"
DEVFLOW_RELEASE_COMMIT="$NEW_SHA"
DEVFLOW_IDENTITY_RELEASE_ROOT="$CANDIDATE_DIR"
export DEVFLOW_VERSION DEVFLOW_RELEASE_COMMIT DEVFLOW_IDENTITY_RELEASE_ROOT
resolve_installed_release_identity "$SOURCE_DIR" main >/dev/null \
  || die 'Checkout canônico não confirma a release candidata promovida.'
[[ "$INSTALLED_COMMIT" == "$NEW_SHA" && "$INSTALLED_VERSION" == "$NEW_VERSION" ]] \
  || die 'Identidade promovida diverge da release candidata.'
validate_installed_release_runtime \
  || die 'Imagens ou API divergem da identidade candidata após o health.'
persist_operational_installation_state \
  || die 'Estado instalado não pôde ser gravado com a identidade candidata.'
ROLLBACK_RESULT=not-required
write_update_transaction completed
write_update_report success
ROLLBACK_ARMED=false
trap - EXIT ERR INT TERM
log INFO "Atualização concluída: $OLD_VERSION ($OLD_SHA) -> $NEW_VERSION ($NEW_SHA)."
