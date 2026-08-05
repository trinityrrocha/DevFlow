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
DEVFLOW_DATA_ROOT="${DEVFLOW_DATA_ROOT:-$DEVFLOW_INSTALL_ROOT/storage}"
DEVFLOW_STATE_ROOT="${DEVFLOW_STATE_ROOT:-$DEVFLOW_INSTALL_ROOT/state}"
DEVFLOW_COMPOSE=()
DEVFLOW_MAINTENANCE_COMPOSE=()
INSTALLED_VERSION=
INSTALLED_COMMIT=
INSTALLED_REF=
INSTALLED_REPOSITORY=

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
  ADMIN_EMAIL
  LETSENCRYPT_EMAIL
  NODE_ENV
  APP_ORIGIN
  DB_USER
  DB_PASSWORD
  DB_NAME
  JWT_SECRET
  ADMIN_BOOTSTRAP_TOKEN
  CONFIG_ENCRYPTION_KEY
  UPDATE_REQUEST_SECRET
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
      DEVFLOW_VERSION|DEVFLOW_RELEASE_COMMIT|DEVFLOW_IMAGE_TAG|DEVFLOW_SOURCE_DIR|DEVFLOW_ENV_FILE|NODE_ENV|PORT|TZ|APP_ORIGIN|VITE_API_URL|DEVFLOW_DOMAIN|ADMIN_EMAIL|LETSENCRYPT_EMAIL|DEVFLOW_DB_DATA_PATH|DEVFLOW_UPLOADS_PATH|DEVFLOW_ACME_PATH|DEVFLOW_CERTIFICATE_PATH|DEVFLOW_NGINX_CONFIG_PATH|DEVFLOW_UPDATER_ROOT|DB_HOST|DB_PORT|DB_USER|DB_PASSWORD|DB_NAME|JWT_SECRET|ADMIN_BOOTSTRAP_TOKEN|CONFIG_ENCRYPTION_KEY|UPDATE_REQUEST_SECRET|SUPER_ADMIN_EMAIL|SESSION_ABSOLUTE_HOURS|SESSION_IDLE_MINUTES|UPLOAD_DIR|MAX_UPLOAD_MB|SMTP_HOST|SMTP_PORT|SMTP_SECURE|SMTP_USER|SMTP_PASSWORD|SMTP_FROM|BACKUP_ARCHIVE_DIR|BACKUP_RETENTION_DAYS|BACKUP_MAX_RESTORE_MB|BACKUP_PASSPHRASE_FILE|LOG_LEVEL|DEVFLOW_LOG_ROOT|METRICS_REFRESH_SECONDS|UPDATE_CHANNEL|UPDATE_API_ENABLED)
        export "$key=$value"
        ;;
      *) die "$DEVFLOW_ENV_FILE contém variável não permitida: $key" ;;
    esac
  done < "$DEVFLOW_ENV_FILE"
  [[ "$DEVFLOW_ENV_FILE" == "$loaded_file" ]] || die 'DEVFLOW_ENV_FILE não pode redirecionar a própria configuração.'
}

validate_runtime_paths() {
  local db_path uploads_path certificate_path nginx_path updater_path backups_path passphrase_path
  db_path="$(realpath -m "${DEVFLOW_DB_DATA_PATH:-}")"
  uploads_path="$(realpath -m "${DEVFLOW_UPLOADS_PATH:-}")"
  certificate_path="$(realpath -m "${DEVFLOW_CERTIFICATE_PATH:-}")"
  nginx_path="$(realpath -m "${DEVFLOW_NGINX_CONFIG_PATH:-}")"
  updater_path="$(realpath -m "${DEVFLOW_UPDATER_ROOT:-}")"
  backups_path="$(realpath -m "${BACKUP_ARCHIVE_DIR:-}")"
  passphrase_path="$(realpath -m "${BACKUP_PASSPHRASE_FILE:-}")"
  [[ "$db_path" == "$DEVFLOW_INSTALL_ROOT/storage/postgres" ]] || die 'Caminho persistente do PostgreSQL invalido.'
  [[ "$uploads_path" == "$DEVFLOW_INSTALL_ROOT/storage/uploads" ]] || die 'Caminho persistente de uploads invalido.'
  [[ "$certificate_path" == /etc/letsencrypt ]] || die 'Caminho de certificados invalido.'
  [[ "$nginx_path" == "$DEVFLOW_CONFIG_ROOT/nginx/nginx.runtime.conf" ]] || die 'Caminho da configuracao Nginx invalido.'
  [[ "$updater_path" == "$DEVFLOW_INSTALL_ROOT/updater" ]] || die 'Caminho do updater invalido.'
  [[ "$backups_path" == "$DEVFLOW_INSTALL_ROOT/backups" ]] || die 'Caminho de backups invalido.'
  [[ "$passphrase_path" == "$DEVFLOW_CONFIG_ROOT/backup.passphrase" ]] || die 'Caminho da passphrase de backup invalido.'
  [[ "${ADMIN_EMAIL:-}" == "${SUPER_ADMIN_EMAIL:-}" \
    && "${ADMIN_EMAIL:-}" == "${LETSENCRYPT_EMAIL:-}" ]] \
    || die 'ADMIN_EMAIL deve ser a autoridade unica para administrador e certificado.'
}

validate_ipv4() {
  local value="${1:-}" octet
  local -a octets
  [[ "$value" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || return 1
  IFS='.' read -r -a octets <<< "$value"
  for octet in "${octets[@]}"; do
    (( 10#$octet >= 0 && 10#$octet <= 255 )) || return 1
  done
}

validate_devflow_certificate() {
  local domain="${1:-${DEVFLOW_DOMAIN:-}}" certificate_root="${2:-/etc/letsencrypt}"
  local fullchain="$certificate_root/live/$domain/fullchain.pem"
  local private_key="$certificate_root/live/$domain/privkey.pem"
  local resolved_chain resolved_key certificate_public key_public
  CERTIFICATE_PRESENT=false
  CERTIFICATE_DOMAIN_MATCH=false
  CERTIFICATE_KEY_MATCH=false
  CERTIFICATE_VALID=false
  validate_domain "$domain" || return 1
  resolved_chain="$(readlink -f "$fullchain" 2>/dev/null || true)"
  resolved_key="$(readlink -f "$private_key" 2>/dev/null || true)"
  if [[ "$resolved_chain" == "$certificate_root/"* && "$resolved_key" == "$certificate_root/"* \
    && -f "$resolved_chain" && -f "$resolved_key" && ! -L "$resolved_chain" && ! -L "$resolved_key" ]]; then
    CERTIFICATE_PRESENT=true
  else
    return 1
  fi
  if openssl x509 -in "$resolved_chain" -noout -checkend 0 >/dev/null 2>&1 \
    && openssl x509 -in "$resolved_chain" -noout -checkhost "$domain" >/dev/null 2>&1; then
    CERTIFICATE_DOMAIN_MATCH=true
  fi
  certificate_public="$(openssl x509 -in "$resolved_chain" -pubkey -noout 2>/dev/null \
    | openssl pkey -pubin -outform DER 2>/dev/null | sha256sum | awk '{print $1}' || true)"
  key_public="$(openssl pkey -in "$resolved_key" -pubout -outform DER 2>/dev/null \
    | sha256sum | awk '{print $1}' || true)"
  if [[ -n "$certificate_public" && "$certificate_public" == "$key_public" ]]; then
    CERTIFICATE_KEY_MATCH=true
  fi
  if [[ "$CERTIFICATE_PRESENT" == true && "$CERTIFICATE_DOMAIN_MATCH" == true \
    && "$CERTIFICATE_KEY_MATCH" == true ]]; then
    CERTIFICATE_VALID=true
  fi
  printf '%s\n' \
    "certificate_present=$CERTIFICATE_PRESENT" \
    "certificate_domain_match=$CERTIFICATE_DOMAIN_MATCH" \
    "certificate_key_match=$CERTIFICATE_KEY_MATCH" \
    "certificate_valid=$CERTIFICATE_VALID"
  [[ "$CERTIFICATE_VALID" == true ]]
}

render_runtime_nginx_config() {
  local release_root="${1:-${DEVFLOW_APP_ROOT:-}}" destination="${2:-${DEVFLOW_NGINX_CONFIG_PATH:-}}"
  local template temporary
  validate_domain "${DEVFLOW_DOMAIN:-}" || return 1
  template="$release_root/docker/nginx.runtime.conf.template"
  [[ -f "$template" && ! -L "$template" && "$destination" == "$DEVFLOW_CONFIG_ROOT/nginx/nginx.runtime.conf" ]] \
    || return 1
  validate_devflow_certificate "$DEVFLOW_DOMAIN" /etc/letsencrypt >/dev/null || return 1
  install -d -m 0750 "$DEVFLOW_CONFIG_ROOT/nginx"
  temporary="$(mktemp "$DEVFLOW_CONFIG_ROOT/nginx/.nginx.runtime.XXXXXX.conf")"
  sed "s/__DEVFLOW_DOMAIN__/$DEVFLOW_DOMAIN/g" "$template" > "$temporary"
  grep -Fq "server_name $DEVFLOW_DOMAIN;" "$temporary" \
    && grep -Fq "/etc/letsencrypt/live/$DEVFLOW_DOMAIN/fullchain.pem" "$temporary" \
    || { rm -f -- "$temporary"; return 1; }
  chmod 0640 "$temporary"
  mv -f -- "$temporary" "$destination"
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
  COMPOSE_ENV_FILE_APPLIED=true
}

compose_files() {
  local app_root="${DEVFLOW_APP_ROOT:-$DEVFLOW_INSTALL_ROOT/app}"
  build_devflow_compose_command "$app_root" "$DEVFLOW_ENV_FILE" DEVFLOW_COMPOSE "$DEVFLOW_PROJECT" application \
    || die 'Não foi possível montar o comando Compose com a configuração privada validada.'
}

compose_validate_structure() {
  local app_root="$1" temporary status=0
  local previous_env_applied="${COMPOSE_ENV_FILE_APPLIED:-false}"
  temporary="$(mktemp "${TMPDIR:-/tmp}/devflow-compose-structure.XXXXXX.env")"
  chmod 0600 "$temporary"
  cat > "$temporary" <<EOF
DEVFLOW_VERSION=$DEVFLOW_RELEASE_VERSION
DEVFLOW_RELEASE_COMMIT=0000000000000000000000000000000000000000
DEVFLOW_ENV_FILE=$temporary
DEVFLOW_DOMAIN=internal.invalid
ADMIN_EMAIL=validation@example.invalid
LETSENCRYPT_EMAIL=validation@example.invalid
NODE_ENV=production
APP_ORIGIN=https://internal.invalid
DB_USER=devflow_validation
DB_PASSWORD=placeholder-structural-validation
DB_NAME=devflow_validation
JWT_SECRET=placeholder-structural-validation-placeholder-structural-validation
ADMIN_BOOTSTRAP_TOKEN=placeholder-structural-validation-placeholder
CONFIG_ENCRYPTION_KEY=placeholder-structural-validation
UPDATE_REQUEST_SECRET=placeholder-structural-validation-placeholder-structural-validation
SUPER_ADMIN_EMAIL=validation@example.invalid
BACKUP_PASSPHRASE_FILE=/tmp/devflow-structural-validation.passphrase
DEVFLOW_DB_DATA_PATH=/opt/devflow/storage/postgres
DEVFLOW_UPLOADS_PATH=/opt/devflow/storage/uploads
DEVFLOW_CERTIFICATE_PATH=/etc/letsencrypt
DEVFLOW_NGINX_CONFIG_PATH=/opt/devflow/config/nginx/nginx.runtime.conf
DEVFLOW_UPDATER_ROOT=/opt/devflow/updater
EOF
  local -a structure_compose=()
  if ! build_devflow_compose_command "$app_root" "$temporary" structure_compose devflow-validation application; then
    status=2
  elif ! "${structure_compose[@]}" config --quiet >/dev/null; then
    status=2
  fi
  COMPOSE_ENV_FILE_APPLIED="$previous_env_applied"
  rm -f -- "$temporary"
  return "$status"
}

is_interactive_terminal() { [[ -t 0 && -t 1 ]]; }

prompt_numeric_confirmation() {
  local prompt_id="$1" heading="$2" primary_action="$3" cancel_action="${4:-CANCELAR}"
  local choice read_status

  if ! is_interactive_terminal; then
    [[ -z "${OUTPUT_EMITTED+x}" ]] || OUTPUT_EMITTED=true
    printf '%s\n' \
      'interactive_confirmation_required=true' \
      'operation_cancelled=true' \
      'changes_applied=false'
    return 11
  fi

  while true; do
    printf '\n%s\n\n1 - %s\n2 - %s\n\n' "$heading" "$primary_action" "$cancel_action"
    printf 'Escolha [1/2]: '
    read_status=0
    IFS= read -r choice || read_status=$?
    if [[ "$read_status" -ge 128 ]]; then
      return 130
    elif [[ "$read_status" -ne 0 ]]; then
      return 10
    fi
    case "$choice" in
      1|2)
        log INFO "confirmation_prompt=$prompt_id confirmation_choice=$choice"
        [[ "$choice" == 1 ]] && return 0
        return 10
        ;;
      *) printf '%s\n' 'Opção inválida. Escolha 1 ou 2.' ;;
    esac
  done
}

require_numeric_confirmation() {
  local status=0
  prompt_numeric_confirmation "$@" || status=$?
  case "$status" in
    0) return 0 ;;
    10|130)
      printf '%s\n' \
        'Operação cancelada pelo usuário.' \
        'Nenhuma alteração foi aplicada.'
      exit 0
      ;;
    11) exit 11 ;;
    *) die "Falha interna ao processar confirmação numérica (código $status)." ;;
  esac
}

validate_backend_migration_image() {
  local backend_image="${1:-}" expected_migration="${2:-001_initial_schema.sql}"
  local expected_image_id="${3:-}" expected_sha256="${4:-}"
  local validation_root stdout_file stderr_file actual_image_id post_validation_image_id
  local configured_user runtime_uid runtime_gid validation_result validation_root_cause sanitized_line
  local docker_exit_code=0
  validate_image_reference "$backend_image" || {
    printf '%s\n' \
      'backend_image_validation_status=runtime-error' \
      'image_validation_container_failed=true' \
      'docker_exit_code=not-run' \
      'root_cause=image-validation-runtime-error'
    return 42
  }
  [[ "$expected_migration" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,254}\.sql$ ]] || {
    printf '%s\n' \
      'backend_image_validation_status=runtime-error' \
      'image_validation_container_failed=false' \
      'docker_exit_code=not-run' \
      'root_cause=invalid-expected-migration'
    return 42
  }
  [[ -z "$expected_sha256" || "$expected_sha256" =~ ^[0-9a-f]{64}$ ]] || {
    printf '%s\n' \
      'backend_image_validation_status=runtime-error' \
      'image_validation_container_failed=false' \
      'docker_exit_code=not-run' \
      'root_cause=invalid-expected-migration-checksum'
    return 42
  }

  actual_image_id="$(docker image inspect --format '{{.Id}}' "$backend_image" 2>/dev/null || true)"
  if [[ ! "$actual_image_id" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    printf '%s\n' \
      'backend_image_validation_status=runtime-error' \
      'image_validation_container_failed=false' \
      'docker_exit_code=not-run' \
      'root_cause=candidate-image-inspect-failed'
    return 42
  fi
  if [[ -n "$expected_image_id" && "$actual_image_id" != "$expected_image_id" ]]; then
    printf '%s\n' \
      'backend_image_validation_status=runtime-error' \
      'image_validation_container_failed=false' \
      'docker_exit_code=not-run' \
      'root_cause=candidate-image-identity-mismatch' \
      "validated_image_id=$actual_image_id"
    return 42
  fi
  configured_user="$(docker image inspect --format '{{.Config.User}}' "$backend_image" 2>/dev/null || true)"
  if [[ "$configured_user" != devflow ]]; then
    printf '%s\n' \
      'backend_image_validation_status=failed' \
      "configured_user=${configured_user:-unset}" \
      'root_cause=backend-configured-user-invalid'
    return 48
  fi

  validation_root="$(mktemp -d "${TMPDIR:-/tmp}/devflow-image-validation.XXXXXX")"
  chmod 0700 "$validation_root"
  stdout_file="$validation_root/stdout"
  stderr_file="$validation_root/stderr"
  : > "$stdout_file"
  : > "$stderr_file"
  chmod 0600 "$stdout_file" "$stderr_file"

  # No --user override is allowed here: Docker must use Config.User=devflow.
  docker run --rm --network none --entrypoint node "$backend_image" \
    scripts/migration-image-contract.js probe /database "$expected_migration" "$expected_sha256" \
    > "$stdout_file" 2> "$stderr_file" || docker_exit_code=$?

  post_validation_image_id="$(docker image inspect --format '{{.Id}}' "$backend_image" 2>/dev/null || true)"
  if [[ "$post_validation_image_id" != "$actual_image_id" ]]; then
    printf '%s\n' \
      'backend_image_validation_status=runtime-error' \
      'image_validation_container_failed=false' \
      "docker_exit_code=$docker_exit_code" \
      'root_cause=candidate-image-reference-changed' \
      "validated_image_id=$actual_image_id"
    rm -rf -- "$validation_root"
    return 42
  fi

  validation_result="$(sed -nE 's/^devflow_image_validation_result=(passed|failed)$/\1/p' "$stdout_file" | head -n1)"
  validation_root_cause="$(sed -nE 's/^devflow_image_validation_root_cause=([a-z0-9-]+)$/\1/p' "$stdout_file" | head -n1)"
  runtime_uid="$(sed -nE 's/^runtime_uid=([0-9]+)$/\1/p' "$stdout_file" | head -n1)"
  runtime_gid="$(sed -nE 's/^runtime_gid=([0-9]+)$/\1/p' "$stdout_file" | head -n1)"
  if [[ "$validation_result:$docker_exit_code" == passed:0 \
    && "$runtime_uid" =~ ^[0-9]+$ && "$runtime_uid" -ne 0 \
    && "$runtime_gid" =~ ^[0-9]+$ ]]; then
      printf '%s\n' \
        'backend_image_validation_status=passed' \
        "configured_user=$configured_user" \
        "runtime_uid=$runtime_uid" \
        "runtime_gid=$runtime_gid" \
        'migration_directory_present=true' \
        'migration_directory_readable=true' \
        'migration_directory_traversable=true' \
        'migration_directory_writable_by_runtime_user=false' \
        'expected_migration_present=true' \
        'expected_migration_regular_file=true' \
        'expected_migration_readable=true' \
        'expected_migration_writable_by_runtime_user=false' \
        'expected_migration_executable=false' \
        'expected_migration_content_match=true' \
        "expected_migration=$expected_migration" \
        "expected_migration_sha256=$expected_sha256" \
        "validated_image_reference=$backend_image" \
        "validated_image_id=$actual_image_id" \
        'image_validation_runtime=docker-run' \
        'image_validation_network=none' \
        'image_validation_probe=node'
      rm -rf -- "$validation_root"
      return 0
  fi

  case "$validation_root_cause" in
    database-directory-missing|database-directory-permission-denied|migration-directory-missing|migration-directory-not-regular|migration-directory-empty|migration-directory-permission-denied|migration-directory-writable-by-runtime-user|migration-entry-symlink|migration-entry-not-regular|expected-migration-missing|expected-migration-not-latest|expected-migration-permission-denied|expected-migration-writable-by-runtime-user|expected-migration-executable|expected-migration-content-mismatch|database-permission-contract-invalid|migration-directory-permission-contract-invalid|migration-file-permission-contract-invalid) ;;
    *) validation_root_cause= ;;
  esac
  if [[ "$validation_result" == failed && "$docker_exit_code" -ge 40 \
    && "$docker_exit_code" -le 47 && -n "$validation_root_cause" ]]; then
      printf '%s\n' \
        'backend_image_validation_status=failed' \
        "configured_user=$configured_user" \
        "expected_migration=$expected_migration" \
        "validated_image_reference=$backend_image" \
        "validated_image_id=$actual_image_id" \
        "root_cause=$validation_root_cause"
      while IFS= read -r sanitized_line; do
        if [[ "$sanitized_line" =~ ^(migration_directory_present|migration_directory_readable|migration_directory_traversable|migration_directory_writable_by_runtime_user|expected_migration_present|expected_migration_regular_file|expected_migration_readable|expected_migration_writable_by_runtime_user|expected_migration_executable|expected_migration_content_match)=(true|false)$ ]]; then
          printf '%s\n' "$sanitized_line"
        fi
      done < "$stdout_file"
      rm -rf -- "$validation_root"
      return "$docker_exit_code"
  fi

  printf '%s\n' \
    'backend_image_validation_status=runtime-error' \
    'image_validation_container_failed=true' \
    "docker_exit_code=$docker_exit_code" \
    "validated_image_reference=$backend_image" \
    "validated_image_id=$actual_image_id" \
    'root_cause=image-validation-runtime-error'
  while IFS= read -r sanitized_line; do
    [[ -z "$sanitized_line" ]] || printf 'docker_stderr=%s\n' "$sanitized_line"
  done < <(redact_stream < "$stderr_file" | head -n5)
  rm -rf -- "$validation_root"
  return 42
}

run_devflow_migrations() {
  local migration_exit_code=0
  "${DEVFLOW_COMPOSE[@]}" run --rm --no-deps backend node scripts/migrate.js \
    || migration_exit_code=$?
  log INFO "migration_exit_code=$migration_exit_code"
  return "$migration_exit_code"
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
  local expected_commit="${1:-}" temporary
  resolve_installed_release_identity "${DEVFLOW_INSTALLED_SOURCE_DIR:-$DEVFLOW_INSTALL_ROOT/source}" main >/dev/null \
    || return 1
  [[ -z "$expected_commit" || "$expected_commit" == "$INSTALLED_COMMIT" ]] || return 1
  install -d -m 0750 "$DEVFLOW_STATE_ROOT"
  temporary="$(mktemp "$DEVFLOW_STATE_ROOT/.version.XXXXXX")"
  {
    printf '{\n'
    printf '  "version": "%s",\n' "$INSTALLED_VERSION"
    printf '  "commit": "%s",\n' "$INSTALLED_COMMIT"
    printf '  "updatedAt": "%s"\n' "$(timestamp)"
    printf '}\n'
  } > "$temporary"
  chmod 0600 "$temporary"
  mv -f -- "$temporary" "$DEVFLOW_STATE_ROOT/version.json"
}

installation_state_schema_valid() {
  local state_file="${1:-$DEVFLOW_STATE_ROOT/installation.json}"
  local validator="${DEVFLOW_INSTALLATION_STATE_VALIDATOR:-$DEVFLOW_SOURCE_ROOT/scripts/validate-installation-state.py}"
  command -v python3 >/dev/null 2>&1 || return 1
  [[ -f "$validator" && ! -L "$validator" && -r "$validator" ]] || return 1
  python3 "$validator" validate "$state_file" >/dev/null 2>&1
}

write_installation_state() {
  local report="$DEVFLOW_STATE_ROOT/installation.json" validator
  resolve_installed_release_identity "${DEVFLOW_INSTALLED_SOURCE_DIR:-$DEVFLOW_INSTALL_ROOT/source}" main >/dev/null \
    || return 1
  [[ "${DEVFLOW_VERSION:-$INSTALLED_VERSION}" == "$INSTALLED_VERSION" ]] || return 1
  validator="${DEVFLOW_INSTALLATION_STATE_VALIDATOR:-$DEVFLOW_SOURCE_ROOT/scripts/validate-installation-state.py}"
  command -v python3 >/dev/null 2>&1 || return 1
  [[ -f "$validator" && ! -L "$validator" && -r "$validator" ]] || return 1
  install -d -m 0750 "$DEVFLOW_STATE_ROOT"
  {
    printf '{\n'
    printf '  "schemaVersion": 3,\n'
    printf '  "installationMode": "isolated",\n'
    printf '  "installedVersion": "%s",\n' "$INSTALLED_VERSION"
    printf '  "installedCommit": "%s",\n' "$INSTALLED_COMMIT"
    printf '  "installedRef": "%s",\n' "$INSTALLED_REF"
    printf '  "repository": "%s",\n' "$INSTALLED_REPOSITORY"
    printf '  "applicationInstalled": %s,\n' "${DEVFLOW_APPLICATION_INSTALLED:-false}"
    printf '  "applicationHealthy": %s,\n' "${DEVFLOW_APPLICATION_HEALTHY:-false}"
    printf '  "externalPublicationEnabled": true,\n'
    printf '  "certificateIssued": %s,\n' "${DEVFLOW_CERTIFICATE_ISSUED:-false}"
    printf '  "domain": "%s",\n' "${DEVFLOW_DOMAIN:-unknown}"
    printf '  "adminEmail": "%s",\n' "${ADMIN_EMAIL:-unknown}"
    printf '  "frontendUrl": "https://%s",\n' "${DEVFLOW_DOMAIN:-unknown}"
    printf '  "backendUrl": "https://%s/api",\n' "${DEVFLOW_DOMAIN:-unknown}"
    printf '  "migration": "%s"\n' "${DEVFLOW_MIGRATION_VERSION:-unknown}"
    printf '}\n'
  } | python3 "$validator" write "$report"
  installation_state_schema_valid "$report" || return 1
  write_version_state "$INSTALLED_COMMIT"
}

installation_state_value() {
  local key="$1" state_file="${2:-$DEVFLOW_STATE_ROOT/installation.json}"
  [[ "$key" =~ ^[A-Za-z][A-Za-z0-9_]*$ && -r "$state_file" ]] || return 1
  sed -nE "s/^[[:space:]]*\"$key\"[[:space:]]*:[[:space:]]*(\"([^\"]*)\"|(true|false)|[0-9]+),?[[:space:]]*$/\\2\\3/p" "$state_file"
}

prepare_installation_state_operational_values() {
  local state_file="${1:-$DEVFLOW_STATE_ROOT/installation.json}"
  load_installation_state "$state_file" || return 1
  DEVFLOW_APPLICATION_INSTALLED="$DEVFLOW_INSTALLATION_STATE_APPLICATION_INSTALLED"
  DEVFLOW_APPLICATION_HEALTHY="$DEVFLOW_INSTALLATION_STATE_APPLICATION_HEALTHY"
  DEVFLOW_CERTIFICATE_ISSUED="$DEVFLOW_INSTALLATION_STATE_CERTIFICATE_ISSUED"
  DEVFLOW_DOMAIN="$DEVFLOW_INSTALLATION_STATE_DOMAIN"
  ADMIN_EMAIL="$DEVFLOW_INSTALLATION_STATE_ADMIN_EMAIL"
  DEVFLOW_MIGRATION_VERSION="$DEVFLOW_INSTALLATION_STATE_MIGRATION"
  export DEVFLOW_APPLICATION_INSTALLED DEVFLOW_APPLICATION_HEALTHY \
    DEVFLOW_CERTIFICATE_ISSUED DEVFLOW_DOMAIN ADMIN_EMAIL DEVFLOW_MIGRATION_VERSION
}

load_installation_state() {
  local state_file="${1:-$DEVFLOW_STATE_ROOT/installation.json}"
  [[ -r "$state_file" ]] || return 1
  installation_state_schema_valid "$state_file" || return 1
  DEVFLOW_INSTALLATION_STATE_SCHEMA_VERSION="$(installation_state_value schemaVersion "$state_file")"
  DEVFLOW_INSTALLATION_STATE_VERSION="$(installation_state_value installedVersion "$state_file")"
  DEVFLOW_INSTALLATION_STATE_COMMIT="$(installation_state_value installedCommit "$state_file")"
  DEVFLOW_INSTALLATION_STATE_REF="$(installation_state_value installedRef "$state_file")"
  DEVFLOW_INSTALLATION_STATE_REPOSITORY="$(installation_state_value repository "$state_file")"
  DEVFLOW_INSTALLATION_STATE_MODE="$(installation_state_value installationMode "$state_file")"
  DEVFLOW_INSTALLATION_STATE_APPLICATION_INSTALLED="$(installation_state_value applicationInstalled "$state_file")"
  DEVFLOW_INSTALLATION_STATE_APPLICATION_HEALTHY="$(installation_state_value applicationHealthy "$state_file")"
  DEVFLOW_INSTALLATION_STATE_EXTERNAL_ENABLED="$(installation_state_value externalPublicationEnabled "$state_file")"
  DEVFLOW_INSTALLATION_STATE_FRONTEND_URL="$(installation_state_value frontendUrl "$state_file")"
  DEVFLOW_INSTALLATION_STATE_BACKEND_URL="$(installation_state_value backendUrl "$state_file")"
  DEVFLOW_INSTALLATION_STATE_DOMAIN="$(installation_state_value domain "$state_file")"
  DEVFLOW_INSTALLATION_STATE_ADMIN_EMAIL="$(installation_state_value adminEmail "$state_file")"
  DEVFLOW_INSTALLATION_STATE_CERTIFICATE_ISSUED="$(installation_state_value certificateIssued "$state_file")"
  DEVFLOW_INSTALLATION_STATE_MIGRATION="$(installation_state_value migration "$state_file")"
  [[ "$DEVFLOW_INSTALLATION_STATE_SCHEMA_VERSION" == 3 ]] || return 1
  devflow_semver_is_valid "$DEVFLOW_INSTALLATION_STATE_VERSION" || return 1
  [[ "$DEVFLOW_INSTALLATION_STATE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || return 1
  devflow_ref_is_valid "$DEVFLOW_INSTALLATION_STATE_REF" || return 1
  [[ "$DEVFLOW_INSTALLATION_STATE_REPOSITORY" == "$DEVFLOW_CANONICAL_REPOSITORY_URL" ]] || return 1
  [[ "$DEVFLOW_INSTALLATION_STATE_MODE" == isolated ]] || return 1
  [[ "$DEVFLOW_INSTALLATION_STATE_APPLICATION_INSTALLED" == true || "$DEVFLOW_INSTALLATION_STATE_APPLICATION_INSTALLED" == false ]] || return 1
  [[ "$DEVFLOW_INSTALLATION_STATE_APPLICATION_HEALTHY" == true || "$DEVFLOW_INSTALLATION_STATE_APPLICATION_HEALTHY" == false ]] || return 1
  [[ "$DEVFLOW_INSTALLATION_STATE_EXTERNAL_ENABLED" == true || "$DEVFLOW_INSTALLATION_STATE_EXTERNAL_ENABLED" == false ]] || return 1
  [[ "$DEVFLOW_INSTALLATION_STATE_EXTERNAL_ENABLED" == true ]] || return 1
  [[ "$DEVFLOW_INSTALLATION_STATE_CERTIFICATE_ISSUED" == true ]] || return 1
  validate_domain "$DEVFLOW_INSTALLATION_STATE_DOMAIN" || return 1
  validate_email "$DEVFLOW_INSTALLATION_STATE_ADMIN_EMAIL" || return 1
  export DEVFLOW_INSTALLATION_STATE_MODE DEVFLOW_INSTALLATION_STATE_APPLICATION_INSTALLED \
    DEVFLOW_INSTALLATION_STATE_APPLICATION_HEALTHY \
    DEVFLOW_INSTALLATION_STATE_EXTERNAL_ENABLED \
    DEVFLOW_INSTALLATION_STATE_FRONTEND_URL DEVFLOW_INSTALLATION_STATE_BACKEND_URL \
    DEVFLOW_INSTALLATION_STATE_DOMAIN DEVFLOW_INSTALLATION_STATE_ADMIN_EMAIL \
    DEVFLOW_INSTALLATION_STATE_SCHEMA_VERSION DEVFLOW_INSTALLATION_STATE_VERSION \
    DEVFLOW_INSTALLATION_STATE_COMMIT DEVFLOW_INSTALLATION_STATE_REF \
    DEVFLOW_INSTALLATION_STATE_REPOSITORY DEVFLOW_INSTALLATION_STATE_CERTIFICATE_ISSUED \
    DEVFLOW_INSTALLATION_STATE_MIGRATION
}

validate_installed_state_consistency() {
  local state_file="${1:-$DEVFLOW_STATE_ROOT/installation.json}"
  INSTALLED_STATE_PRESENT=false
  INSTALLED_STATE_SCHEMA_VALID=false
  INSTALLED_STATE_VERSION_MATCH=false
  INSTALLED_STATE_COMMIT_MATCH=false
  INSTALLED_STATE_SOURCE_COMMIT_MATCH=false
  INSTALLATION_STATE_HEALTH=degraded
  REPAIR_AVAILABLE=false
  [[ -f "$state_file" && ! -L "$state_file" ]] || return 1
  INSTALLED_STATE_PRESENT=true
  load_installation_state "$state_file" || {
    if resolve_installed_release_identity "${DEVFLOW_INSTALLED_SOURCE_DIR:-$DEVFLOW_INSTALL_ROOT/source}" main >/dev/null 2>&1; then
      INSTALLED_STATE_SOURCE_COMMIT_MATCH=true
      REPAIR_AVAILABLE=true
    fi
    return 1
  }
  INSTALLED_STATE_SCHEMA_VALID=true
  [[ "$DEVFLOW_INSTALLATION_STATE_APPLICATION_INSTALLED" == true \
    && "$DEVFLOW_INSTALLATION_STATE_APPLICATION_HEALTHY" == true ]] || return 1
  resolve_installed_release_identity "${DEVFLOW_INSTALLED_SOURCE_DIR:-$DEVFLOW_INSTALL_ROOT/source}" \
    "$DEVFLOW_INSTALLATION_STATE_REF" >/dev/null || return 1
  INSTALLED_STATE_SOURCE_COMMIT_MATCH=true
  [[ "$DEVFLOW_INSTALLATION_STATE_VERSION" == "$INSTALLED_VERSION" ]] \
    && INSTALLED_STATE_VERSION_MATCH=true
  [[ "$DEVFLOW_INSTALLATION_STATE_COMMIT" == "$INSTALLED_COMMIT" ]] \
    && INSTALLED_STATE_COMMIT_MATCH=true
  if [[ "$INSTALLED_STATE_VERSION_MATCH" == true && "$INSTALLED_STATE_COMMIT_MATCH" == true ]]; then
    INSTALLATION_STATE_HEALTH=healthy
    return 0
  fi
  REPAIR_AVAILABLE=true
  return 1
}
