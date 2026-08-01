#!/usr/bin/env bash

DEVFLOW_RELEASE_VERSION="0.1.0-alpha"
DEVFLOW_VERSION="$DEVFLOW_RELEASE_VERSION"
DEVFLOW_PROJECT="devflow"
DEVFLOW_INSTALL_ROOT="${DEVFLOW_INSTALL_ROOT:-/opt/devflow}"
DEVFLOW_CONFIG_ROOT="${DEVFLOW_CONFIG_ROOT:-$DEVFLOW_INSTALL_ROOT/config}"
DEVFLOW_ENV_FILE="${DEVFLOW_ENV_FILE:-$DEVFLOW_CONFIG_ROOT/devflow.env}"
DEVFLOW_LOG_ROOT="${DEVFLOW_LOG_ROOT:-$DEVFLOW_INSTALL_ROOT/logs}"
DEVFLOW_STATE_ROOT="${DEVFLOW_STATE_ROOT:-$DEVFLOW_INSTALL_ROOT/data}"

timestamp() { date -u +'%Y-%m-%dT%H:%M:%SZ'; }

log() {
  local level="$1"
  shift
  printf '%s [%s] %s\n' "$(timestamp)" "$level" "$*"
}

die() {
  log ERROR "$*" >&2
  exit 1
}

require_linux() {
  [[ "$(uname -s)" == "Linux" ]] || die 'Este script pode ser executado somente em Linux.'
}

require_root() {
  [[ "$(id -u)" -eq 0 ]] || die 'Execute esta operação com sudo ou como root.'
}

detect_platform() {
  [[ -r /etc/os-release ]] || die 'Arquivo /etc/os-release ausente.'
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-}" in
    ubuntu)
      [[ "${VERSION_ID:-}" == 22.04 || "${VERSION_ID:-}" == 24.04 ]] \
        || die "Versão Ubuntu não suportada: ${VERSION_ID:-desconhecida}."
      ;;
    debian)
      [[ "${VERSION_ID:-}" == 12 || "${VERSION_ID:-}" == 13 ]] \
        || die "Versão Debian não suportada: ${VERSION_ID:-desconhecida}."
      ;;
    *) die "Distribuição não suportada: ${ID:-desconhecida}. Use Ubuntu 22.04/24.04 ou Debian 12/13." ;;
  esac
  case "$(uname -m)" in
    x86_64) DEVFLOW_ARCH=amd64 ;;
    aarch64|arm64) DEVFLOW_ARCH=arm64 ;;
    *) die "Arquitetura não suportada: $(uname -m)." ;;
  esac
  DEVFLOW_DISTRO="$ID"
  DEVFLOW_CODENAME="${VERSION_CODENAME:-}"
  [[ -n "$DEVFLOW_CODENAME" ]] || die 'Não foi possível determinar o codinome da distribuição.'
}

version_at_least() {
  local current="$1" required="$2"
  [[ "$(printf '%s\n%s\n' "$required" "$current" | sort -V | head -n1)" == "$required" ]]
}

validate_safe_absolute_path() {
  local value="$1" label="$2"
  [[ "$value" =~ ^/[A-Za-z0-9._/-]+$ ]] || die "$label contém caracteres não permitidos."
  [[ "$value" == /* && "$value" != / && "$value" != /opt && "$value" != /etc && "$value" != /var ]] \
    || die "$label inválido: $value"
  [[ "$value" != *'/../'* && "$value" != *'/..' ]] || die "$label contém navegação insegura."
}

validate_domain() {
  [[ "$1" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ && "$1" == *.* ]] \
    || die 'Domínio inválido.'
}

validate_email() {
  [[ "$1" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die 'E-mail inválido.'
}

validate_port() {
  [[ "$1" =~ ^[0-9]+$ && "$1" -ge 1 && "$1" -le 65535 ]] || die "Porta inválida: $1"
}

load_devflow_env() {
  [[ -r "$DEVFLOW_ENV_FILE" ]] || die "Configuração ausente: $DEVFLOW_ENV_FILE"
  local mode
  mode="$(stat -c '%a' "$DEVFLOW_ENV_FILE")"
  [[ "$mode" == 600 || "$mode" == 400 ]] || die "$DEVFLOW_ENV_FILE deve possuir permissão 600 ou 400; atual: $mode."
  local line key value loaded_file="$DEVFLOW_ENV_FILE"
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" =~ ^([A-Z][A-Z0-9_]*)=(.*)$ ]] || die "$DEVFLOW_ENV_FILE contém uma linha inválida."
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    case "$key" in
      DEVFLOW_VERSION|NODE_ENV|PORT|TZ|APP_ORIGIN|VITE_API_URL|DEVFLOW_DOMAIN|DEVFLOW_PROXY_MODE|LETSENCRYPT_EMAIL|DEVFLOW_ENV_FILE|DEVFLOW_BIND_ADDRESS|DEVFLOW_HTTP_PORT|DEVFLOW_API_PORT|DEVFLOW_DB_DATA_PATH|DEVFLOW_UPLOADS_PATH|DB_HOST|DB_PORT|DB_USER|DB_PASSWORD|DB_NAME|JWT_SECRET|ADMIN_BOOTSTRAP_TOKEN|CONFIG_ENCRYPTION_KEY|SUPER_ADMIN_EMAIL|SESSION_ABSOLUTE_HOURS|SESSION_IDLE_MINUTES|UPLOAD_DIR|MAX_UPLOAD_MB|SMTP_HOST|SMTP_PORT|SMTP_SECURE|SMTP_USER|SMTP_PASSWORD|SMTP_FROM|BACKUP_ARCHIVE_DIR|BACKUP_RETENTION_DAYS|BACKUP_MAX_RESTORE_MB|BACKUP_PASSPHRASE_FILE|LOG_LEVEL|DEVFLOW_LOG_ROOT|METRICS_REFRESH_SECONDS|UPDATE_CHANNEL)
        export "$key=$value"
        ;;
      *) die "$DEVFLOW_ENV_FILE contém variável não permitida: $key" ;;
    esac
  done < "$DEVFLOW_ENV_FILE"
  [[ "$DEVFLOW_ENV_FILE" == "$loaded_file" ]] || die 'DEVFLOW_ENV_FILE não pode redirecionar a própria configuração.'
}

validate_runtime_paths() {
  local db_path uploads_path backups_path passphrase_path
  db_path="$(realpath -m "${DEVFLOW_DB_DATA_PATH:-}")"
  uploads_path="$(realpath -m "${DEVFLOW_UPLOADS_PATH:-}")"
  backups_path="$(realpath -m "${BACKUP_ARCHIVE_DIR:-}")"
  passphrase_path="$(realpath -m "${BACKUP_PASSPHRASE_FILE:-}")"
  [[ "$db_path" == "$DEVFLOW_STATE_ROOT/postgres" ]] || die 'Caminho persistente do PostgreSQL inválido.'
  [[ "$uploads_path" == "$DEVFLOW_INSTALL_ROOT/storage/uploads" ]] || die 'Caminho persistente de uploads inválido.'
  [[ "$backups_path" == "$DEVFLOW_INSTALL_ROOT/backups" ]] || die 'Caminho de backups inválido.'
  [[ "$passphrase_path" == "$DEVFLOW_CONFIG_ROOT/backup.passphrase" ]] || die 'Caminho da passphrase de backup inválido.'
  [[ "${DEVFLOW_BIND_ADDRESS:-}" == 127.0.0.1 ]] || die 'Serviços compartilhados devem permanecer vinculados a 127.0.0.1.'
}

set_managed_env_value() {
  local key="$1" value="$2" temporary
  [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ && "$value" != *$'\n'* && "$value" != *$'\r'* ]] \
    || die 'Atualização de ambiente inválida.'
  temporary="$(mktemp "$DEVFLOW_CONFIG_ROOT/.devflow-env.XXXXXX")"
  awk -v target="$key" -v replacement="$value" '
    BEGIN { found=0 }
    $0 ~ "^" target "=" { print target "=" replacement; found=1; next }
    { print }
    END { if (!found) print target "=" replacement }
  ' "$DEVFLOW_ENV_FILE" > "$temporary"
  chmod 0600 "$temporary"
  mv -f -- "$temporary" "$DEVFLOW_ENV_FILE"
}

compose_files() {
  local app_root="${DEVFLOW_APP_ROOT:-$DEVFLOW_INSTALL_ROOT/app}"
  DEVFLOW_COMPOSE=(docker compose --env-file "$DEVFLOW_ENV_FILE" -p "$DEVFLOW_PROJECT" --project-directory "$app_root" -f "$app_root/docker-compose.yml")
  if [[ "${DEVFLOW_PROXY_MODE:-}" == shared ]]; then
    DEVFLOW_COMPOSE+=(-f "$app_root/docker-compose.shared.yml")
  elif [[ "${DEVFLOW_PROXY_MODE:-}" == isolated ]]; then
    DEVFLOW_COMPOSE+=(--profile standalone)
  fi
}

confirm_exact() {
  local expected="$1" prompt="$2" answer
  [[ "${DEVFLOW_ASSUME_YES:-false}" != true ]] || return 0
  read -r -p "$prompt Digite '$expected': " answer
  [[ "$answer" == "$expected" ]] || die 'Confirmação não recebida; nenhuma alteração foi aplicada.'
}

redact_stream() {
  sed -E \
    -e 's/([Pp]assword|[Tt]oken|[Ss]ecret|[Kk]ey|[Pp]assphrase)([=:][[:space:]]*)[^[:space:]]+/\1\2[REDACTED]/g' \
    -e 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/[EMAIL_REDACTED]/g' \
    -e 's/(Authorization:[[:space:]]*)(Bearer|Basic)[[:space:]]+[^[:space:]]+/\1[REDACTED]/Ig' \
    -e 's/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/[GITHUB_TOKEN_REDACTED]/g' \
    -e 's/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/[JWT_REDACTED]/g'
}

managed_file() {
  local file="$1" marker="$2"
  [[ ! -e "$file" ]] || [[ "$(head -n1 "$file" 2>/dev/null || true)" == "$marker" ]]
}

port_is_listening() {
  local port="$1"
  ss -H -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "(^|:)$port$"
}

devflow_container_running() {
  local service="$1"
  docker ps --filter "label=com.docker.compose.project=$DEVFLOW_PROJECT" \
    --filter "label=com.docker.compose.service=$service" --format '{{.ID}}' | grep -q .
}

check_capacity() {
  local available_kb memory_kb
  available_kb="$(df -Pk "${1:-/opt}" 2>/dev/null | awk 'NR==2 {print $4}')"
  memory_kb="$(awk '/MemTotal/ {print $2}' /proc/meminfo)"
  [[ "${available_kb:-0}" -ge 5242880 ]] || die 'São necessários pelo menos 5 GiB livres.'
  [[ "${memory_kb:-0}" -ge 1900000 ]] || die 'São necessários pelo menos 2 GiB de memória RAM para homologação.'
}

write_install_report() {
  local result="$1" report="$DEVFLOW_STATE_ROOT/install-report.txt"
  install -d -m 0750 "$DEVFLOW_STATE_ROOT"
  {
    printf 'DevFlow installation report\n'
    printf 'timestamp=%s\n' "$(timestamp)"
    printf 'version=%s\n' "$DEVFLOW_VERSION"
    printf 'result=%s\n' "$result"
    printf 'proxy_mode=%s\n' "${DEVFLOW_PROXY_MODE:-unknown}"
    printf 'domain=%s\n' "${DEVFLOW_DOMAIN:-unknown}"
    printf 'migration=%s\n' "${DEVFLOW_MIGRATION_VERSION:-unknown}"
  } > "$report"
  chmod 0640 "$report"
}
