#!/usr/bin/env bash

DEVFLOW_COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEVFLOW_SOURCE_ROOT="$(cd "$DEVFLOW_COMMON_DIR/../.." && pwd)"
# shellcheck source=version.sh
. "$DEVFLOW_COMMON_DIR/version.sh"
DEVFLOW_RELEASE_VERSION="$(devflow_read_version_file "$DEVFLOW_SOURCE_ROOT/VERSION")" \
  || { echo 'VERSION inválido no código DevFlow.' >&2; exit 1; }
DEVFLOW_VERSION="$DEVFLOW_RELEASE_VERSION"
DEVFLOW_PROJECT="devflow"
DEVFLOW_INSTALL_ROOT="${DEVFLOW_INSTALL_ROOT:-/opt/devflow}"
DEVFLOW_CONFIG_ROOT="${DEVFLOW_CONFIG_ROOT:-$DEVFLOW_INSTALL_ROOT/config}"
DEVFLOW_ENV_FILE="${DEVFLOW_ENV_FILE:-$DEVFLOW_CONFIG_ROOT/devflow.env}"
DEVFLOW_LOG_ROOT="${DEVFLOW_LOG_ROOT:-$DEVFLOW_INSTALL_ROOT/logs}"
DEVFLOW_DATA_ROOT="${DEVFLOW_DATA_ROOT:-$DEVFLOW_INSTALL_ROOT/data}"
DEVFLOW_STATE_ROOT="${DEVFLOW_STATE_ROOT:-$DEVFLOW_INSTALL_ROOT/state}"
DEVFLOW_COMPOSE=()
DEVFLOW_MAINTENANCE_COMPOSE=()

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

version_is_greater() { devflow_version_is_greater "$@"; }

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

DEVFLOW_REQUIRED_PRIVATE_ENV_KEYS=(
  DEVFLOW_VERSION
  DEVFLOW_RELEASE_COMMIT
  DEVFLOW_ENV_FILE
  DEVFLOW_DOMAIN
  NODE_ENV
  APP_ORIGIN
  DB_USER
  DB_PASSWORD
  DB_NAME
  JWT_SECRET
  ADMIN_BOOTSTRAP_TOKEN
  CONFIG_ENCRYPTION_KEY
  SUPER_ADMIN_EMAIL
  BACKUP_PASSPHRASE_FILE
)

devflow_env_key_has_value() {
  local key="$1" file="${2:-$DEVFLOW_ENV_FILE}"
  [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ && -f "$file" && ! -L "$file" ]] || return 2
  awk -v target="$key" '
    index($0, target "=") == 1 {
      value=substr($0, length(target) + 2)
      sub(/\r$/, "", value)
      if (value ~ /^[[:space:]]*$/ || value ~ /^[[:space:]]*([\047\042][\047\042])[[:space:]]*$/) exit 1
      found=1
      exit 0
    }
    END { if (!found) exit 1 }
  ' "$file"
}

devflow_env_metadata_value() {
  local key="$1" file="${2:-$DEVFLOW_ENV_FILE}"
  [[ "$key" == DEVFLOW_VERSION || "$key" == DEVFLOW_RELEASE_COMMIT || "$key" == DEVFLOW_ENV_FILE ]] \
    || return 2
  awk -v target="$key" '
    index($0, target "=") == 1 {
      value=substr($0, length(target) + 2)
      sub(/\r$/, "", value)
      print value
      exit 0
    }
  ' "$file"
}

devflow_inspect_private_env() {
  local file="${1:-$DEVFLOW_ENV_FILE}" mode owner effective_uid key
  local -a missing=()
  PRIVATE_ENV_DETECTED=false
  PRIVATE_ENV_READABLE=false
  PRIVATE_ENV_PERMISSIONS_VALID=false
  PRIVATE_ENV_OWNER_VALID=false
  PRIVATE_ENV_SYNTAX_VALID=false
  DB_PASSWORD_PRESENT=false
  CONFIGURATION_VERSION=unknown
  MISSING_REQUIRED_ENV_KEYS=none

  [[ -e "$file" ]] || return 1
  PRIVATE_ENV_DETECTED=true
  [[ "$file" == /* && -f "$file" && ! -L "$file" && -r "$file" ]] || return 2
  PRIVATE_ENV_READABLE=true
  mode="$(stat -c '%a' "$file" 2>/dev/null || true)"
  [[ "$mode" == 600 || "$mode" == 400 ]] || return 3
  PRIVATE_ENV_PERMISSIONS_VALID=true
  owner="$(stat -c '%u' "$file" 2>/dev/null || true)"
  effective_uid="$(id -u)"
  [[ "$owner" == 0 || "$owner" == "$effective_uid" ]] || return 4
  PRIVATE_ENV_OWNER_VALID=true

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" == \#* || "$line" =~ ^[A-Z][A-Z0-9_]*=.*$ ]] || return 5
  done < "$file"
  PRIVATE_ENV_SYNTAX_VALID=true

  for key in "${DEVFLOW_REQUIRED_PRIVATE_ENV_KEYS[@]}"; do
    devflow_env_key_has_value "$key" "$file" || missing+=("$key")
  done
  devflow_env_key_has_value DB_PASSWORD "$file" && DB_PASSWORD_PRESENT=true
  CONFIGURATION_VERSION="$(devflow_env_metadata_value DEVFLOW_VERSION "$file" 2>/dev/null || true)"
  [[ -n "$CONFIGURATION_VERSION" ]] || CONFIGURATION_VERSION=unknown
  if [[ ${#missing[@]} -gt 0 ]]; then
    MISSING_REQUIRED_ENV_KEYS="$(IFS=,; printf '%s' "${missing[*]}")"
    return 6
  fi
  return 0
}

devflow_report_required_env_keys() {
  local key present
  for key in "${DEVFLOW_REQUIRED_PRIVATE_ENV_KEYS[@]}"; do
    present=false
    devflow_env_key_has_value "$key" "${1:-$DEVFLOW_ENV_FILE}" && present=true
    printf 'required_env_key=%s present=%s value_exposed=false\n' "$key" "$present"
  done
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
      DEVFLOW_VERSION|DEVFLOW_RELEASE_COMMIT|DEVFLOW_IMAGE_TAG|DEVFLOW_SOURCE_DIR|NODE_ENV|PORT|TZ|APP_ORIGIN|VITE_API_URL|DEVFLOW_DOMAIN|DEVFLOW_INFRASTRUCTURE_PROVIDER|DEVFLOW_PROXY_MODE|DEVFLOW_SHARED_PROXY_ADAPTER|LETSENCRYPT_EMAIL|DEVFLOW_ENV_FILE|DEVFLOW_BIND_ADDRESS|DEVFLOW_HTTP_PORT|DEVFLOW_API_PORT|DEVFLOW_DB_DATA_PATH|DEVFLOW_UPLOADS_PATH|DB_HOST|DB_PORT|DB_USER|DB_PASSWORD|DB_NAME|JWT_SECRET|ADMIN_BOOTSTRAP_TOKEN|CONFIG_ENCRYPTION_KEY|SUPER_ADMIN_EMAIL|SESSION_ABSOLUTE_HOURS|SESSION_IDLE_MINUTES|UPLOAD_DIR|MAX_UPLOAD_MB|SMTP_HOST|SMTP_PORT|SMTP_SECURE|SMTP_USER|SMTP_PASSWORD|SMTP_FROM|BACKUP_ARCHIVE_DIR|BACKUP_RETENTION_DAYS|BACKUP_MAX_RESTORE_MB|BACKUP_PASSPHRASE_FILE|LOG_LEVEL|DEVFLOW_LOG_ROOT|METRICS_REFRESH_SECONDS|UPDATE_CHANNEL)
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
  [[ "$db_path" == "$DEVFLOW_DATA_ROOT/postgres" ]] || die 'Caminho persistente do PostgreSQL inválido.'
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

build_devflow_compose_command() {
  local app_root="${1:-${DEVFLOW_APP_ROOT:-$DEVFLOW_INSTALL_ROOT/app}}"
  local env_file="${2:-$DEVFLOW_ENV_FILE}" target_name="${3:-DEVFLOW_COMPOSE}"
  local project="${4:-$DEVFLOW_PROJECT}" layout="${5:-application}" compose_file
  local -n target="$target_name"
  [[ "$app_root" == /* && "$env_file" == /* ]] || return 2
  [[ -d "$app_root" ]] || return 2
  devflow_inspect_private_env "$env_file" || return 3
  case "$layout" in
    application) compose_file="$app_root/docker-compose.yml" ;;
    maintenance) compose_file="$app_root/docker-compose.maintenance.yml" ;;
    *) return 2 ;;
  esac
  [[ -f "$compose_file" && ! -L "$compose_file" && -r "$compose_file" ]] || return 2
  target=(docker compose --env-file "$env_file" -p "$project" --project-directory "$app_root" -f "$compose_file")
  if [[ "$layout" == application ]]; then
    if [[ "${DEVFLOW_PROXY_MODE:-}" == shared ]]; then
      if [[ "${DEVFLOW_SHARED_PROXY_ADAPTER:-host-nginx}" == fullpassword-nginx ]]; then
        [[ -f "$app_root/docker-compose.fullpassword.yml" && ! -L "$app_root/docker-compose.fullpassword.yml" ]] || return 2
        target+=(-f "$app_root/docker-compose.fullpassword.yml")
      else
        [[ -f "$app_root/docker-compose.shared.yml" && ! -L "$app_root/docker-compose.shared.yml" ]] || return 2
        target+=(-f "$app_root/docker-compose.shared.yml")
      fi
    elif [[ "${DEVFLOW_PROXY_MODE:-}" == isolated ]]; then
      target+=(--profile standalone)
    fi
  fi
  COMPOSE_ENV_FILE_APPLIED=true
}

compose_files() {
  local app_root="${DEVFLOW_APP_ROOT:-$DEVFLOW_INSTALL_ROOT/app}"
  build_devflow_compose_command "$app_root" "$DEVFLOW_ENV_FILE" DEVFLOW_COMPOSE "$DEVFLOW_PROJECT" application \
    || die 'Não foi possível montar o comando Compose com a configuração privada validada.'
}

compose_validate_structure() {
  local app_root="$1" temporary status=0 previous_proxy_mode="${DEVFLOW_PROXY_MODE:-}"
  local previous_adapter="${DEVFLOW_SHARED_PROXY_ADAPTER:-}"
  local previous_env_applied="${COMPOSE_ENV_FILE_APPLIED:-false}"
  temporary="$(mktemp "${TMPDIR:-/tmp}/devflow-compose-structure.XXXXXX.env")"
  chmod 0600 "$temporary"
  cat > "$temporary" <<EOF
DEVFLOW_VERSION=$DEVFLOW_RELEASE_VERSION
DEVFLOW_RELEASE_COMMIT=0000000000000000000000000000000000000000
DEVFLOW_ENV_FILE=$temporary
DEVFLOW_DOMAIN=internal.invalid
NODE_ENV=production
APP_ORIGIN=http://127.0.0.1:18080
DB_USER=devflow_validation
DB_PASSWORD=placeholder-structural-validation
DB_NAME=devflow_validation
JWT_SECRET=placeholder-structural-validation-placeholder-structural-validation
ADMIN_BOOTSTRAP_TOKEN=placeholder-structural-validation-placeholder
CONFIG_ENCRYPTION_KEY=placeholder-structural-validation
SUPER_ADMIN_EMAIL=validation@example.invalid
BACKUP_PASSPHRASE_FILE=/tmp/devflow-structural-validation.passphrase
DEVFLOW_DB_DATA_PATH=/opt/devflow/data/postgres
DEVFLOW_UPLOADS_PATH=/opt/devflow/storage/uploads
DEVFLOW_BIND_ADDRESS=127.0.0.1
DEVFLOW_HTTP_PORT=18080
DEVFLOW_API_PORT=13000
EOF
  DEVFLOW_PROXY_MODE=shared
  DEVFLOW_SHARED_PROXY_ADAPTER=host-nginx
  local -a structure_compose=()
  if ! build_devflow_compose_command "$app_root" "$temporary" structure_compose devflow-validation application; then
    status=2
  elif ! "${structure_compose[@]}" config --quiet >/dev/null; then
    status=2
  fi
  DEVFLOW_PROXY_MODE="$previous_proxy_mode"
  DEVFLOW_SHARED_PROXY_ADAPTER="$previous_adapter"
  COMPOSE_ENV_FILE_APPLIED="$previous_env_applied"
  rm -f -- "$temporary"
  return "$status"
}

derive_legacy_proxy_settings() {
  local provider="${1:-${DEVFLOW_INFRASTRUCTURE_PROVIDER:-host-nginx}}"
  case "$provider" in
    host-nginx)
      DEVFLOW_PROXY_MODE=shared
      DEVFLOW_SHARED_PROXY_ADAPTER=host-nginx
      ;;
    isolated-nginx)
      DEVFLOW_PROXY_MODE=isolated
      DEVFLOW_SHARED_PROXY_ADAPTER=none
      ;;
    legacy-docker-nginx)
      DEVFLOW_PROXY_MODE=shared
      DEVFLOW_SHARED_PROXY_ADAPTER=fullpassword-nginx
      ;;
    *) die "Provider de infraestrutura invalido: $provider" ;;
  esac
  export DEVFLOW_INFRASTRUCTURE_PROVIDER="$provider" DEVFLOW_PROXY_MODE DEVFLOW_SHARED_PROXY_ADAPTER
}

confirm_exact() {
  local expected="$1" prompt="$2" answer
  [[ "${DEVFLOW_ASSUME_YES:-false}" != true ]] || return 0
  read -r -p "$prompt Digite '$expected': " answer
  [[ "$answer" == "$expected" ]] || die 'Confirmação não recebida; nenhuma alteração foi aplicada.'
}

redact_stream() {
  sed -E \
    -e 's#(https?|postgres(ql)?|smtp)://[^/@[:space:]]+:[^/@[:space:]]+@#\1://[CREDENTIALS_REDACTED]@#Ig' \
    -e 's/^([[:space:]]*(DB_PASSWORD|JWT_SECRET|ADMIN_BOOTSTRAP_TOKEN|CONFIG_ENCRYPTION_KEY|SMTP_PASSWORD|BACKUP_PASSPHRASE)[[:space:]]*[=:]).*$/\1[REDACTED]/I' \
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
  command -v docker >/dev/null 2>&1 || return 1
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

write_version_state() {
  local commit="${1:-unknown}" temporary
  install -d -m 0750 "$DEVFLOW_STATE_ROOT"
  temporary="$(mktemp "$DEVFLOW_STATE_ROOT/.version.XXXXXX")"
  {
    printf '{\n'
    printf '  "version": "%s",\n' "$DEVFLOW_VERSION"
    printf '  "commit": "%s",\n' "$commit"
    printf '  "updated_at": "%s"\n' "$(timestamp)"
    printf '}\n'
  } > "$temporary"
  chmod 0640 "$temporary"
  mv -f -- "$temporary" "$DEVFLOW_STATE_ROOT/version.json"
}

write_install_report() {
  local result="$1" report="$DEVFLOW_STATE_ROOT/installation.json" temporary
  install -d -m 0750 "$DEVFLOW_STATE_ROOT"
  temporary="$(mktemp "$DEVFLOW_STATE_ROOT/.installation.XXXXXX")"
  {
    printf '{\n'
    printf '  "timestamp": "%s",\n' "$(timestamp)"
    printf '  "version": "%s",\n' "$DEVFLOW_VERSION"
    printf '  "commit": "%s",\n' "${DEVFLOW_RELEASE_COMMIT:-unknown}"
    printf '  "ref": "%s",\n' "${DEVFLOW_RELEASE_REF:-unknown}"
    printf '  "repository": "%s",\n' "${DEVFLOW_REPOSITORY_URL:-unknown}"
    printf '  "update_channel": "%s",\n' "${DEVFLOW_UPDATE_CHANNEL:-${UPDATE_CHANNEL:-unknown}}"
    printf '  "result": "%s",\n' "$result"
    printf '  "installationScope": "%s",\n' "${DEVFLOW_INSTALLATION_SCOPE:-unknown}"
    printf '  "applicationInstalled": %s,\n' "${DEVFLOW_APPLICATION_INSTALLED:-false}"
    printf '  "externalPublicationEnabled": %s,\n' "${DEVFLOW_EXTERNAL_PUBLICATION_ENABLED:-false}"
    printf '  "provider": "%s",\n' "${DEVFLOW_INFRASTRUCTURE_PROVIDER:-unknown}"
    printf '  "frontendUrl": "%s",\n' "${DEVFLOW_FRONTEND_URL:-http://127.0.0.1:${DEVFLOW_HTTP_PORT:-18080}}"
    printf '  "backendUrl": "%s",\n' "${DEVFLOW_BACKEND_URL:-http://127.0.0.1:${DEVFLOW_API_PORT:-13000}}"
    printf '  "proxyMigrationRequired": %s,\n' "${DEVFLOW_PROXY_MIGRATION_REQUIRED:-false}"
    printf '  "fullpasswordModified": %s,\n' "${DEVFLOW_FULLPASSWORD_MODIFIED:-false}"
    printf '  "publicProxyModified": %s,\n' "${DEVFLOW_PUBLIC_PROXY_MODIFIED:-false}"
    printf '  "proxyMigrationExecuted": %s,\n' "${DEVFLOW_PROXY_MIGRATION_EXECUTED:-false}"
    printf '  "certificateIssued": %s,\n' "${DEVFLOW_CERTIFICATE_ISSUED:-false}"
    printf '  "infrastructure_provider": "%s",\n' "${DEVFLOW_INFRASTRUCTURE_PROVIDER:-unknown}"
    printf '  "proxy_mode": "%s",\n' "${DEVFLOW_PROXY_MODE:-unknown}"
    printf '  "shared_proxy_adapter": "%s",\n' "${DEVFLOW_SHARED_PROXY_ADAPTER:-none}"
    printf '  "domain": "%s",\n' "${DEVFLOW_DOMAIN:-unknown}"
    printf '  "migration": "%s"\n' "${DEVFLOW_MIGRATION_VERSION:-unknown}"
    printf '}\n'
  } > "$temporary"
  chmod 0640 "$temporary"
  mv -f -- "$temporary" "$report"
  write_version_state "${DEVFLOW_RELEASE_COMMIT:-unknown}"
}

installation_state_value() {
  local key="$1" state_file="${2:-$DEVFLOW_STATE_ROOT/installation.json}"
  [[ "$key" =~ ^[A-Za-z][A-Za-z0-9_]*$ && -r "$state_file" ]] || return 1
  sed -nE "s/^[[:space:]]*\"$key\"[[:space:]]*:[[:space:]]*(\"([^\"]*)\"|(true|false)|[0-9]+),?[[:space:]]*$/\\2\\3/p" "$state_file"
}

load_installation_state() {
  local state_file="${1:-$DEVFLOW_STATE_ROOT/installation.json}"
  [[ -r "$state_file" ]] || return 1
  DEVFLOW_INSTALLATION_STATE_SCOPE="$(installation_state_value installationScope "$state_file")"
  DEVFLOW_INSTALLATION_STATE_APPLICATION_INSTALLED="$(installation_state_value applicationInstalled "$state_file")"
  DEVFLOW_INSTALLATION_STATE_EXTERNAL_ENABLED="$(installation_state_value externalPublicationEnabled "$state_file")"
  DEVFLOW_INSTALLATION_STATE_PROVIDER="$(installation_state_value provider "$state_file")"
  DEVFLOW_INSTALLATION_STATE_FRONTEND_URL="$(installation_state_value frontendUrl "$state_file")"
  DEVFLOW_INSTALLATION_STATE_BACKEND_URL="$(installation_state_value backendUrl "$state_file")"
  DEVFLOW_INSTALLATION_STATE_DOMAIN="$(installation_state_value domain "$state_file")"
  DEVFLOW_INSTALLATION_STATE_PROXY_MIGRATION_REQUIRED="$(installation_state_value proxyMigrationRequired "$state_file")"
  [[ "$DEVFLOW_INSTALLATION_STATE_SCOPE" == internal || "$DEVFLOW_INSTALLATION_STATE_SCOPE" == complete ]] || return 1
  [[ "$DEVFLOW_INSTALLATION_STATE_APPLICATION_INSTALLED" == true || "$DEVFLOW_INSTALLATION_STATE_APPLICATION_INSTALLED" == false ]] || return 1
  [[ "$DEVFLOW_INSTALLATION_STATE_EXTERNAL_ENABLED" == true || "$DEVFLOW_INSTALLATION_STATE_EXTERNAL_ENABLED" == false ]] || return 1
  [[ "$DEVFLOW_INSTALLATION_STATE_PROXY_MIGRATION_REQUIRED" == true || "$DEVFLOW_INSTALLATION_STATE_PROXY_MIGRATION_REQUIRED" == false ]] || return 1
  provider_validate_name "$DEVFLOW_INSTALLATION_STATE_PROVIDER" >/dev/null 2>&1 || return 1
  export DEVFLOW_INSTALLATION_STATE_SCOPE DEVFLOW_INSTALLATION_STATE_APPLICATION_INSTALLED \
    DEVFLOW_INSTALLATION_STATE_EXTERNAL_ENABLED DEVFLOW_INSTALLATION_STATE_PROVIDER \
    DEVFLOW_INSTALLATION_STATE_FRONTEND_URL DEVFLOW_INSTALLATION_STATE_BACKEND_URL \
    DEVFLOW_INSTALLATION_STATE_DOMAIN DEVFLOW_INSTALLATION_STATE_PROXY_MIGRATION_REQUIRED
}
