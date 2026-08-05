#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECKOUT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
. "$SCRIPT_DIR/lib/common.sh"
. "$SCRIPT_DIR/lib/compose-images.sh"
. "$SCRIPT_DIR/lib/install-transaction.sh"

MODE=check
MODE_EXPLICIT=false
DOMAIN=
ADMIN_EMAIL_INPUT=
EXPECTED_VERSION=
FIREWALL_CONFIRMED=false
CURRENT_INSTALL_STAGE=01-preflight
TRANSACTION_STARTED=false
CONTAINERS_STARTED=false
BASE_PACKAGES_NEEDED=false
PUBLIC_REMOTE='https://github.com/trinityrrocha/DevFlow.git'
PUBLIC_IP=
DOMAIN_IPV4=
RESUME_START_STAGE=05-images
RESUME_UPDATER_IMAGE_REBUILD=false
INSTALLATION_GATE_FILE="$DEVFLOW_STATE_ROOT/installation-in-progress"
APP_SYMLINK_PREVIOUSLY_PRESENT=false
PREVIOUS_APP_TARGET=
APP_SYMLINK_CANDIDATE_TARGET=
APP_SYMLINK_ACTIVATED=false
APP_SYMLINK_COMMITTED=false
CREDENTIAL_TTY_AVAILABLE=false
TEMPORARY_PASSWORD_GENERATED=false
INITIAL_CREDENTIALS_PENDING_FILE="$DEVFLOW_STATE_ROOT/initial-credentials-pending"
INSTALL_LOGGER_PID=

usage() {
  cat <<'EOF'
DevFlow - instalador isolado para homologacao

Uso comum seguro:
  ./install.sh --check --domain HOST --admin-email EMAIL

Automacao e suporte:
  ./install.sh --check --domain HOST --admin-email EMAIL
  sudo ./install.sh --dry-run --domain HOST --admin-email EMAIL
  sudo ./install.sh --install --domain HOST --admin-email EMAIL --firewall-confirmed
  sudo ./install.sh --resume --firewall-confirmed
EOF
}

set_mode() { [[ "$MODE_EXPLICIT" == false ]] || die 'Informe somente um modo.'; MODE="$1"; MODE_EXPLICIT=true; }
require_value() { [[ -n "${2:-}" ]] || die "A opcao $1 exige um valor."; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) set_mode check; shift ;;
    --dry-run) set_mode dry-run; shift ;;
    --install) set_mode install; shift ;;
    --resume) set_mode resume; shift ;;
    --domain) require_value "$1" "${2:-}"; DOMAIN="$2"; shift 2 ;;
    --admin-email|--email) require_value "$1" "${2:-}"; ADMIN_EMAIL_INPUT="$2"; shift 2 ;;
    --expected-version) require_value "$1" "${2:-}"; EXPECTED_VERSION="$2"; shift 2 ;;
    --firewall-confirmed) FIREWALL_CONFIRMED=true; shift ;;
    --proxy-mode|--provider|--install-scope|--letsencrypt-email|--super-admin-email|--install-internal|--http-port|--api-port)
      die "O parametro $1 foi descontinuado; existe somente instalacao isolada."
      ;;
    --help|-h) usage; exit 0 ;;
    *) die "Opcao desconhecida: $1" ;;
  esac
done

validate_noninteractive_install_contract() {
  if [[ "$MODE" == install && ! -t 0 ]]; then
    [[ -n "$DOMAIN" && -n "$ADMIN_EMAIL_INPUT" && "$FIREWALL_CONFIRMED" == true ]] \
      || die 'execucao nao interativa exige --domain, --admin-email e --firewall-confirmed.'
  fi
}

validate_noninteractive_install_contract

cancel_installation() {
  local message="${1:-Instalacao cancelada.}"
  printf '%s\n' "$message" "mode=$MODE" 'changes_applied=false'
  if [[ "${DEVFLOW_BOOTSTRAP_REF:-}" == main ]]; then
    exit 20
  fi
  exit 0
}

show_banner() {
  cat <<'EOF'
============================================================
 INSTALADOR DO DEVFLOW
============================================================

O DevFlow sera instalado em modo isolado.
O certificado HTTPS sera emitido por Certbot standalone antes da stack Docker.
Somente o Nginx do DevFlow publicara 80/TCP e 443/TCP.
EOF
}

prompt_configuration() {
  [[ "$MODE" != resume ]] || return 0
  if [[ -z "$DOMAIN" ]]; then
    [[ -t 0 ]] || die 'Informe --domain em execucao nao interativa.'
    read -r -p 'Dominio do DevFlow: ' DOMAIN
  fi
  DOMAIN="$(printf '%s' "$DOMAIN" | tr '[:upper:]' '[:lower:]')"
  validate_domain "$DOMAIN"
  [[ "$DOMAIN" != *://* && "$DOMAIN" != */* && "$DOMAIN" != *[[:space:]]* ]] \
    || die 'Dominio invalido: informe somente o nome DNS.'
  if [[ -z "$ADMIN_EMAIL_INPUT" ]]; then
    [[ -t 0 ]] || die 'Informe --admin-email em execucao nao interativa.'
    read -r -p 'E-mail administrativo: ' ADMIN_EMAIL_INPUT
  fi
  validate_email "$ADMIN_EMAIL_INPUT"
}

show_summary() {
  cat <<EOF

Resumo da instalacao

Modo:
  Isolado

Dominio:
  $DOMAIN

E-mail administrativo:
  $ADMIN_EMAIL_INPUT

Diretorio:
  /opt/devflow

Portas publicas:
  80 e 443

Certificado:
  Certbot standalone no host

Servicos:
  PostgreSQL
  Backend
  Frontend
  Nginx
  Updater
EOF
  if [[ "$MODE" == install && -t 0 ]]; then
    prompt_numeric_confirmation initial-installation \
      'A instalacao isolada do DevFlow esta pronta para iniciar.' \
      'INSTALAR DEVFLOW' 'CANCELAR' \
      || cancel_installation 'Instalacao cancelada.'
  fi
}

confirm_external_firewall() {
  [[ "$MODE" == install || "$MODE" == resume ]] || return 0
  [[ "$FIREWALL_CONFIRMED" == false ]] || return 0
  prompt_numeric_confirmation external-firewall \
    $'O Let\047s Encrypt precisa acessar externamente 80/TCP e 443/TCP.\nConfirme a liberacao no firewall do provedor.' \
    'AS PORTAS ESTAO LIBERADAS' 'CANCELAR' \
    || cancel_installation 'Instalacao cancelada antes do certificado.'
  FIREWALL_CONFIRMED=true
}

port_owner() {
  local port="$1" docker_owner process_owner
  docker_owner="$(docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null \
    | awk -v port=":$port->" 'index($0, port) {print $1; exit}')"
  process_owner="$(ss -H -ltnp "sport = :$port" 2>/dev/null | head -n1 | sed -n 's/.*users:(("\([^"]*\)".*/\1/p')"
  printf '%s' "${docker_owner:-${process_owner:-unknown}}"
}

inspect_ports() {
  local port owner blocked=false
  for port in 80 443; do
    if ! ss -H -ltn "sport = :$port" 2>/dev/null | grep -q .; then
      printf 'port=%s\nowner=free\n' "$port"
      continue
    fi
    owner="$(port_owner "$port")"
    printf 'port=%s\nowner=%s\n' "$port" "$owner"
    if [[ "$MODE" == resume && "$owner" == devflow-* ]]; then continue; fi
    blocked=true
  done
  [[ "$blocked" == false ]] || {
    printf '%s\n' 'As portas 80 e/ou 443 pertencem a um servico desconhecido.' \
      'Nenhum processo arbitrario sera interrompido.' >&2
    return 1
  }
}

fetch_public_ipv4() {
  local endpoint candidate consensus= valid_sources=0
  for endpoint in https://api.ipify.org https://ifconfig.me/ip; do
    candidate=
    if command -v curl >/dev/null 2>&1; then
      candidate="$(curl -4 --fail --silent --show-error --max-time 10 "$endpoint" 2>/dev/null || true)"
    elif command -v wget >/dev/null 2>&1; then
      candidate="$(wget -4 -q -T 10 -O - "$endpoint" 2>/dev/null || true)"
    fi
    candidate="$(printf '%s' "$candidate" | tr -d '[:space:]')"
    if validate_ipv4 "$candidate"; then
      valid_sources=$((valid_sources + 1))
      if [[ -z "$consensus" ]]; then
        consensus="$candidate"
      elif [[ "$candidate" != "$consensus" ]]; then
        die 'Fontes de IPv4 publico divergiram; nenhuma alteracao foi realizada.'
      fi
    fi
  done
  [[ "$valid_sources" -ge 2 ]] || return 1
  PUBLIC_IP="$consensus"
}

resolve_domain_ipv4() {
  local value
  DOMAIN_IPV4=
  if command -v dig >/dev/null 2>&1; then
    DOMAIN_IPV4="$(dig +short A "$DOMAIN" 2>/dev/null | sort -u | paste -sd, -)"
  else
    DOMAIN_IPV4="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk '{print $1}' | sort -u | paste -sd, -)"
  fi
  [[ -n "$DOMAIN_IPV4" ]] || return 1
  IFS=',' read -r -a values <<< "$DOMAIN_IPV4"
  for value in "${values[@]}"; do
    validate_ipv4 "$value" || return 1
  done
}

validate_dns_alignment() {
  local match=false value
  fetch_public_ipv4 || die 'Nao foi possivel obter o IPv4 publico por fontes independentes.'
  resolve_domain_ipv4 || die 'O dominio nao possui registro A resolvivel.'
  IFS=',' read -r -a values <<< "$DOMAIN_IPV4"
  for value in "${values[@]}"; do [[ "$value" != "$PUBLIC_IP" ]] || match=true; done
  printf 'public_ip=%s\ndomain_ipv4=%s\ndns_match=%s\n' "$PUBLIC_IP" "$DOMAIN_IPV4" "$match"
  [[ "$match" == true ]] || die 'DNS ainda nao aponta para esta VPS. Nenhuma alteracao de containers ou certificados foi realizada.'
}

preflight() {
  require_linux
  detect_platform
  [[ "$DEVFLOW_DISTRO" == ubuntu ]] || die 'A instalacao suporta Ubuntu 22.04 e 24.04.'
  [[ "$MODE" == check || "$(id -u)" -eq 0 ]] || die 'Execute com sudo ou como root.'
  for command_name in git getent ss awk sed grep sort tar sha256sum; do
    command -v "$command_name" >/dev/null 2>&1 || die "Dependencia ausente: $command_name"
  done
  command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1 \
    || die 'Instale curl ou wget para o diagnostico inicial.'
  for command_name in curl openssl python3 gpg certbot dig timeout; do
    command -v "$command_name" >/dev/null 2>&1 || BASE_PACKAGES_NEEDED=true
  done
  check_capacity /opt
  validate_dns_alignment
  inspect_ports
  if [[ -f "$DEVFLOW_STATE_ROOT/installation.json" && "$MODE" != check ]]; then
    die 'Uma instalacao concluida existe. Use scripts/update.sh.'
  fi
  if [[ "$MODE" == install && -e "$DEVFLOW_INSTALL_TRANSACTION_FILE" ]]; then
    die 'Instalacao parcial detectada. Use sudo ./install.sh --resume.'
  fi
  if [[ "$MODE" == resume ]]; then
    [[ -f "$DEVFLOW_INSTALL_TRANSACTION_FILE" && -f "$DEVFLOW_ENV_FILE" ]] \
      || die 'Nao existe transacao parcial retomavel.'
  fi
}

install_base_dependencies() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates certbot coreutils curl dnsutils git gnupg iproute2 openssl python3
}

configure_docker_repository() {
  local expected key_tmp
  install_base_dependencies
  install -m 0755 -d /etc/apt/keyrings
  key_tmp="$(mktemp /etc/apt/keyrings/.docker.gpg.XXXXXX)"
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor --yes -o "$key_tmp"
  mv -f -- "$key_tmp" /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  expected="deb [arch=$DEVFLOW_ARCH signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $DEVFLOW_CODENAME stable"
  if [[ -e /etc/apt/sources.list.d/docker.list \
    && "$(tr -d '\r' < /etc/apt/sources.list.d/docker.list)" != "$expected" ]]; then
    die 'Repositorio Docker existente diverge do oficial esperado.'
  fi
  printf '%s\n' "$expected" > /etc/apt/sources.list.d/docker.list
  apt-get update
}

ensure_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    configure_docker_repository
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    systemctl enable --now docker
  elif ! docker compose version >/dev/null 2>&1; then
    configure_docker_repository
    apt-get install -y docker-compose-plugin
  fi
  docker version >/dev/null 2>&1 || die 'Docker daemon indisponivel.'
  docker compose version >/dev/null 2>&1 || die 'Docker Compose v2 indisponivel.'
  version_at_least "$(docker version --format '{{.Server.Version}}')" 24.0 || die 'Docker 24 ou superior e obrigatorio.'
  version_at_least "$(docker compose version --short | sed 's/^v//')" 2.20 || die 'Compose 2.20 ou superior e obrigatorio.'
}

prepare_source() {
  local remote_commit release_dir
  [[ -d "$CHECKOUT_DIR/.git" ]] || die 'Checkout DevFlow invalido.'
  [[ "$(git -C "$CHECKOUT_DIR" remote get-url origin)" == "$PUBLIC_REMOTE" \
    && "$(git -C "$CHECKOUT_DIR" branch --show-current)" == main \
    && -z "$(git -C "$CHECKOUT_DIR" status --porcelain)" ]] || die 'Checkout local divergente.'
  RELEASE_COMMIT="$(git -C "$CHECKOUT_DIR" rev-parse HEAD)"
  remote_commit="$(GIT_TERMINAL_PROMPT=0 git -C "$CHECKOUT_DIR" ls-remote origin refs/heads/main | awk 'NR==1 {print $1}')"
  [[ "$RELEASE_COMMIT" == "$remote_commit" ]] || die 'O commit local ainda nao esta publicado em origin/main.'
  if [[ ! -d "$DEVFLOW_INSTALL_ROOT/source/.git" ]]; then
    GIT_TERMINAL_PROMPT=0 git clone --branch main --single-branch "$PUBLIC_REMOTE" "$DEVFLOW_INSTALL_ROOT/source"
    git -C "$DEVFLOW_INSTALL_ROOT/source" config --local core.hooksPath /dev/null
  fi
  [[ "$(git -C "$DEVFLOW_INSTALL_ROOT/source" remote get-url origin)" == "$PUBLIC_REMOTE" \
    && -z "$(git -C "$DEVFLOW_INSTALL_ROOT/source" status --porcelain)" ]] || die 'Checkout operacional incompativel.'
  GIT_TERMINAL_PROMPT=0 git -C "$DEVFLOW_INSTALL_ROOT/source" fetch origin main
  git -C "$DEVFLOW_INSTALL_ROOT/source" merge --ff-only "$RELEASE_COMMIT"
  release_dir="$DEVFLOW_INSTALL_ROOT/releases/$RELEASE_COMMIT"
  if [[ ! -d "$release_dir" ]]; then
    install -d -m 0750 "$release_dir"
    git -C "$DEVFLOW_INSTALL_ROOT/source" archive "$RELEASE_COMMIT" | tar -x -C "$release_dir"
    printf '%s\n' "$RELEASE_COMMIT" > "$release_dir/.devflow-release"
  fi
  RELEASE_DIR="$release_dir"
  DEVFLOW_RELEASE_COMMIT="$RELEASE_COMMIT"
  export DEVFLOW_RELEASE_COMMIT
}

generate_private_configuration() {
  local generated db_password jwt_secret bootstrap_token encryption_key update_secret backup_passphrase
  [[ ! -e "$DEVFLOW_ENV_FILE" ]] || return 0
  db_password="$(openssl rand -base64 48 | tr -d '\n')"
  jwt_secret="$(openssl rand -hex 48)"
  bootstrap_token="$(openssl rand -base64 48 | tr -d '\n')"
  encryption_key="$(openssl rand -base64 32 | tr -d '\n')"
  update_secret="$(openssl rand -hex 48)"
  backup_passphrase="$(openssl rand -base64 64 | tr -d '\n')"
  generated="$(mktemp "$DEVFLOW_CONFIG_ROOT/.devflow-env.XXXXXX")"
  cat > "$generated" <<EOF
DEVFLOW_VERSION=$DEVFLOW_RELEASE_VERSION
DEVFLOW_RELEASE_COMMIT=$RELEASE_COMMIT
DEVFLOW_IMAGE_TAG=latest
DEVFLOW_SOURCE_DIR=$DEVFLOW_INSTALL_ROOT/source
DEVFLOW_ENV_FILE=$DEVFLOW_ENV_FILE
NODE_ENV=production
PORT=3000
TZ=America/Sao_Paulo
APP_ORIGIN=https://$DOMAIN
VITE_API_URL=/api
DEVFLOW_DOMAIN=$DOMAIN
ADMIN_EMAIL=$ADMIN_EMAIL_INPUT
SUPER_ADMIN_EMAIL=$ADMIN_EMAIL_INPUT
LETSENCRYPT_EMAIL=$ADMIN_EMAIL_INPUT
DEVFLOW_DB_DATA_PATH=$DEVFLOW_INSTALL_ROOT/storage/postgres
DEVFLOW_UPLOADS_PATH=$DEVFLOW_INSTALL_ROOT/storage/uploads
DEVFLOW_CERTIFICATE_PATH=/etc/letsencrypt
DEVFLOW_NGINX_CONFIG_PATH=$DEVFLOW_CONFIG_ROOT/nginx/nginx.runtime.conf
DEVFLOW_UPDATER_ROOT=$DEVFLOW_INSTALL_ROOT/updater
DB_HOST=db
DB_PORT=5432
DB_USER=devflow_user
DB_PASSWORD=$db_password
DB_NAME=devflow_db
JWT_SECRET=$jwt_secret
ADMIN_BOOTSTRAP_TOKEN=$bootstrap_token
CONFIG_ENCRYPTION_KEY=$encryption_key
UPDATE_REQUEST_SECRET=$update_secret
SESSION_ABSOLUTE_HOURS=12
SESSION_IDLE_MINUTES=60
UPLOAD_DIR=/var/lib/devflow/uploads
MAX_UPLOAD_MB=25
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
BACKUP_ARCHIVE_DIR=$DEVFLOW_INSTALL_ROOT/backups
BACKUP_PASSPHRASE_FILE=$DEVFLOW_CONFIG_ROOT/backup.passphrase
BACKUP_RETENTION_DAYS=30
BACKUP_MAX_RESTORE_MB=4096
LOG_LEVEL=info
DEVFLOW_LOG_ROOT=$DEVFLOW_LOG_ROOT
METRICS_REFRESH_SECONDS=60
UPDATE_CHANNEL=main
UPDATE_API_ENABLED=true
EOF
  printf '%s\n' "$backup_passphrase" > "$DEVFLOW_CONFIG_ROOT/backup.passphrase"
  printf '%s\n' "$bootstrap_token" > "$DEVFLOW_CONFIG_ROOT/bootstrap-token"
  chmod 0600 "$generated" "$DEVFLOW_CONFIG_ROOT/backup.passphrase" "$DEVFLOW_CONFIG_ROOT/bootstrap-token"
  mv -f -- "$generated" "$DEVFLOW_ENV_FILE"
}

migrate_partial_configuration() {
  [[ "$MODE" == resume ]] || return 0
  set_managed_env_value DEVFLOW_VERSION "$DEVFLOW_RELEASE_VERSION"
  set_managed_env_value DEVFLOW_RELEASE_COMMIT "$RELEASE_COMMIT"
  set_managed_env_value DEVFLOW_CERTIFICATE_PATH /etc/letsencrypt
  set_managed_env_value DEVFLOW_NGINX_CONFIG_PATH "$DEVFLOW_CONFIG_ROOT/nginx/nginx.runtime.conf"
  set_managed_env_value DEVFLOW_UPDATER_ROOT "$DEVFLOW_INSTALL_ROOT/updater"
  devflow_env_key_has_value UPDATE_REQUEST_SECRET "$DEVFLOW_ENV_FILE" \
    || set_managed_env_value UPDATE_REQUEST_SECRET "$(openssl rand -hex 48)"
  set_managed_env_value UPDATE_API_ENABLED true
}

service_healthy() {
  local service="$1" id status
  id="$("${DEVFLOW_COMPOSE[@]}" ps -q "$service" 2>/dev/null || true)"
  [[ -n "$id" ]] || return 1
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || true)"
  [[ "$status" == healthy ]]
}

valid_release_target() {
  local target="${1:-}" resolved marker
  resolved="$(readlink -f -- "$target" 2>/dev/null || true)"
  [[ -n "$resolved" && "$resolved" == "$DEVFLOW_INSTALL_ROOT/releases/"* \
    && -d "$resolved" && ! -L "$resolved" && -f "$resolved/.devflow-release" \
    && ! -L "$resolved/.devflow-release" ]] || return 1
  marker="$(tr -d '\r\n' < "$resolved/.devflow-release")"
  [[ "$marker" =~ ^[0-9a-f]{40}$ && "$resolved" == "$DEVFLOW_INSTALL_ROOT/releases/$marker" ]]
}

replace_app_symlink_atomically() {
  local target="$1" temporary
  valid_release_target "$target" || die 'Destino do symlink app nao e uma release valida.'
  temporary="$(mktemp -d "$DEVFLOW_INSTALL_ROOT/.app-link.XXXXXX")"
  if ! ln -s -- "$target" "$temporary/app" \
    || ! mv -Tf -- "$temporary/app" "$DEVFLOW_INSTALL_ROOT/app"; then
    rm -rf -- "$temporary"
    die 'Nao foi possivel trocar o symlink app atomicamente.'
  fi
  rmdir -- "$temporary"
}

validate_active_app_symlink() {
  local resolved_candidate resolved_active
  resolved_candidate="$(readlink -f -- "$RELEASE_DIR" 2>/dev/null || true)"
  resolved_active="$(readlink -f -- "$DEVFLOW_INSTALL_ROOT/app" 2>/dev/null || true)"
  [[ -L "$DEVFLOW_INSTALL_ROOT/app" && -n "$resolved_candidate" \
    && "$resolved_active" == "$resolved_candidate" \
    && -f "$DEVFLOW_INSTALL_ROOT/app/scripts/updater-daemon.sh" \
    && -x "$DEVFLOW_INSTALL_ROOT/app/scripts/updater-daemon.sh" ]]
}

activate_candidate_app_symlink() {
  local active_path="$DEVFLOW_INSTALL_ROOT/app"
  APP_SYMLINK_PREVIOUSLY_PRESENT=false
  PREVIOUS_APP_TARGET=
  APP_SYMLINK_CANDIDATE_TARGET="$(readlink -f -- "$RELEASE_DIR")"
  valid_release_target "$APP_SYMLINK_CANDIDATE_TARGET" \
    || die 'A release candidata nao passou pela validacao do symlink app.'
  if [[ -L "$active_path" ]]; then
    PREVIOUS_APP_TARGET="$(readlink -f -- "$active_path" 2>/dev/null || true)"
    valid_release_target "$PREVIOUS_APP_TARGET" \
      || die 'O symlink app anterior nao aponta para uma release valida.'
    APP_SYMLINK_PREVIOUSLY_PRESENT=true
  elif [[ -e "$active_path" ]]; then
    die 'O caminho app existente nao e um symlink regular.'
  fi
  replace_app_symlink_atomically "$APP_SYMLINK_CANDIDATE_TARGET"
  APP_SYMLINK_ACTIVATED=true
  validate_active_app_symlink || die 'O symlink app ativo nao passou pelos gates do updater.'
}

restore_previous_app_symlink() {
  local current_target
  [[ "$APP_SYMLINK_ACTIVATED" == true && "$APP_SYMLINK_COMMITTED" == false ]] || return 0
  current_target="$(readlink -f -- "$DEVFLOW_INSTALL_ROOT/app" 2>/dev/null || true)"
  if [[ "$current_target" != "$APP_SYMLINK_CANDIDATE_TARGET" ]]; then
    log ERROR 'Rollback do symlink app ignorado porque o destino ativo mudou externamente.'
    return 1
  fi
  if [[ "$APP_SYMLINK_PREVIOUSLY_PRESENT" == true ]]; then
    valid_release_target "$PREVIOUS_APP_TARGET" || {
      log ERROR 'Rollback do symlink app recusado: destino anterior deixou de ser valido.'
      return 1
    }
    replace_app_symlink_atomically "$PREVIOUS_APP_TARGET"
    log INFO "Symlink app restaurado para a release anterior: ${PREVIOUS_APP_TARGET##*/}."
  else
    rm -f -- "$DEVFLOW_INSTALL_ROOT/app"
    log INFO 'Symlink app candidato removido apos falha da instalacao inicial.'
  fi
  APP_SYMLINK_ACTIVATED=false
}

commit_app_symlink() {
  validate_active_app_symlink || die 'O symlink app definitivo diverge da release instalada.'
  APP_SYMLINK_COMMITTED=true
  APP_SYMLINK_ACTIVATED=false
}

create_installation_gate() {
  install -o root -g root -m 0600 /dev/null "$INSTALLATION_GATE_FILE"
  [[ -f "$INSTALLATION_GATE_FILE" && ! -L "$INSTALLATION_GATE_FILE" \
    && "$(stat -c '%U:%G %a' "$INSTALLATION_GATE_FILE")" == 'root:root 600' ]] \
    || die 'Nao foi possivel proteger o marcador installation-in-progress.'
}

report_updater_prerequisites() {
  local target daemon_present=false daemon_executable=false gate_present=false
  target="$(readlink -f -- "$DEVFLOW_INSTALL_ROOT/app" 2>/dev/null || true)"
  [[ -f "$DEVFLOW_INSTALL_ROOT/app/scripts/updater-daemon.sh" ]] && daemon_present=true
  [[ -x "$DEVFLOW_INSTALL_ROOT/app/scripts/updater-daemon.sh" ]] && daemon_executable=true
  [[ -f "$INSTALLATION_GATE_FILE" && ! -L "$INSTALLATION_GATE_FILE" ]] && gate_present=true
  printf '%s\n' \
    "active_app_symlink_present=$([[ -L "$DEVFLOW_INSTALL_ROOT/app" ]] && echo true || echo false)" \
    "active_app_target=${target##*/}" \
    "updater_daemon_present=$daemon_present" \
    "updater_daemon_executable=$daemon_executable" \
    "installation_gate_present=$gate_present"
  validate_active_app_symlink && [[ "$gate_present" == true ]]
}

capture_updater_failure_diagnostics() {
  log ERROR 'Diagnostico sanitizado do updater apos falha no estagio 14.'
  docker logs --tail 100 devflow-updater 2>&1 | redact_stream || true
  docker inspect --format \
    'name={{.Name}} image={{.Config.Image}} status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} exit_code={{.State.ExitCode}} error={{json .State.Error}} restart_count={{.RestartCount}}' \
    devflow-updater 2>&1 | redact_stream || true
}

run_edge_updater_stage() {
  local status=0 updater_id edge_id updater_running=false updater_ready=false
  report_updater_prerequisites || die 'Preflight do updater falhou antes do estagio 14.'
  if [[ "$RESUME_UPDATER_IMAGE_REBUILD" == true ]]; then
    "${DEVFLOW_COMPOSE[@]}" build updater
  fi
  "${DEVFLOW_COMPOSE[@]}" up -d edge updater --wait || status=$?
  if [[ "$status" -ne 0 ]]; then
    capture_updater_failure_diagnostics
    return "$status"
  fi
  updater_id="$("${DEVFLOW_COMPOSE[@]}" ps -q updater 2>/dev/null || true)"
  edge_id="$("${DEVFLOW_COMPOSE[@]}" ps -q edge 2>/dev/null || true)"
  [[ -n "$updater_id" ]] && updater_running="$(docker inspect --format '{{.State.Running}}' "$updater_id" 2>/dev/null || true)"
  docker exec devflow-updater test -f /var/lib/devflow-updater/daemon.ready 2>/dev/null && updater_ready=true
  printf '%s\n' \
    "updater_container_present=$([[ -n "$updater_id" ]] && echo true || echo false)" \
    "updater_container_running=$updater_running" \
    "updater_ready_file_present=$updater_ready" \
    "updater_healthy=$([[ -n "$updater_id" ]] && service_healthy updater && echo true || echo false)" \
    "edge_healthy=$([[ -n "$edge_id" ]] && service_healthy edge && echo true || echo false)"
  [[ -n "$updater_id" && "$updater_running" == true && "$updater_ready" == true ]] \
    && service_healthy updater && [[ -n "$edge_id" ]] && service_healthy edge
}

recalculate_resume_stage() {
  local service image expected_version actual_version latest migration required
  RESUME_START_STAGE=05-images
  RESUME_UPDATER_IMAGE_REBUILD=false
  expected_version="$DEVFLOW_RELEASE_VERSION"
  for service in backend frontend updater; do
    image="$(compose_service_image_expected "$service" 2>/dev/null || true)"
    [[ -n "$image" ]] && docker image inspect "$image" >/dev/null 2>&1 \
      || { printf 'resume_recalculated_stage=%s\n' "$RESUME_START_STAGE"; return; }
  done
  image="$(compose_service_image_expected updater)"
  actual_version="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' "$image" 2>/dev/null || true)"
  [[ "$actual_version" == "$expected_version" ]] || RESUME_UPDATER_IMAGE_REBUILD=true
  RESUME_START_STAGE=07-certificate
  validate_devflow_certificate "$DEVFLOW_DOMAIN" /etc/letsencrypt >/dev/null 2>&1 \
    || { printf 'resume_recalculated_stage=%s\n' "$RESUME_START_STAGE"; return; }
  RESUME_START_STAGE=08-runtime-nginx
  [[ -f "$DEVFLOW_NGINX_CONFIG_PATH" && ! -L "$DEVFLOW_NGINX_CONFIG_PATH" \
    && "$(grep -Fc "server_name $DEVFLOW_DOMAIN;" "$DEVFLOW_NGINX_CONFIG_PATH")" -eq 2 \
    && "$(grep -Fc "/etc/letsencrypt/live/$DEVFLOW_DOMAIN/fullchain.pem" "$DEVFLOW_NGINX_CONFIG_PATH")" -eq 1 ]] \
    || { printf 'resume_recalculated_stage=%s\n' "$RESUME_START_STAGE"; return; }
  RESUME_START_STAGE=09-containers
  service_healthy db || { printf 'resume_recalculated_stage=%s\n' "$RESUME_START_STAGE"; return; }
  RESUME_START_STAGE=11-migrations
  latest="$(find "$RELEASE_DIR/database/migrations" -maxdepth 1 -type f -name '*.sql' -print | sort | tail -n1)"
  migration="$("${DEVFLOW_COMPOSE[@]}" exec -T db sh -c 'psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT version FROM schema_migrations ORDER BY applied_at DESC LIMIT 1"' 2>/dev/null || true)"
  [[ "$migration" == "${latest##*/}" ]] || { printf 'resume_recalculated_stage=%s\n' "$RESUME_START_STAGE"; return; }
  RESUME_START_STAGE=12-backend
  service_healthy backend || { printf 'resume_recalculated_stage=%s\n' "$RESUME_START_STAGE"; return; }
  RESUME_START_STAGE=13-frontend
  service_healthy frontend || { printf 'resume_recalculated_stage=%s\n' "$RESUME_START_STAGE"; return; }
  RESUME_START_STAGE=14-nginx-https
  service_healthy edge || { printf 'resume_recalculated_stage=%s\n' "$RESUME_START_STAGE"; return; }
  service_healthy updater || { printf 'resume_recalculated_stage=%s\n' "$RESUME_START_STAGE"; return; }
  RESUME_START_STAGE=15-super-admin
  required="$(docker exec devflow-backend node -e "fetch('http://127.0.0.1:3000/api/auth/bootstrap/status').then(r=>r.json()).then(v=>process.stdout.write(String(v.required))).catch(()=>process.exit(1))" 2>/dev/null || true)"
  [[ "$required" == false ]] || { printf 'resume_recalculated_stage=%s\n' "$RESUME_START_STAGE"; return; }
  RESUME_START_STAGE=16-final-health-state
  printf 'resume_recalculated_stage=%s\n' "$RESUME_START_STAGE"
}

stage_number() { printf '%s' "${1%%-*}" | sed 's/^0*//'; }
should_run() { (( 10#$(stage_number "$1") >= 10#$(stage_number "$RESUME_START_STAGE") )); }

stop_partial_devflow_runtime() {
  local owner80 owner443
  owner80="$(port_owner 80)"; owner443="$(port_owner 443)"
  if [[ "$owner80" == devflow-* || "$owner443" == devflow-* ]]; then
    "${DEVFLOW_COMPOSE[@]}" stop edge
  fi
  inspect_ports
}

obtain_certificate() {
  if validate_devflow_certificate "$DEVFLOW_DOMAIN" /etc/letsencrypt; then
    printf 'certificate_reused=true\ncertificate_issued=false\n'
    return 0
  fi
  stop_partial_devflow_runtime
  if ! timeout 300 certbot certonly --standalone --domain "$DEVFLOW_DOMAIN" \
    --non-interactive --agree-tos --email "$ADMIN_EMAIL"; then
    install_transaction_fail 07-certificate certbot-standalone-failed || true
    die 'Certbot standalone falhou; fonte, configuracao, imagens e logs foram preservados.'
  fi
  validate_devflow_certificate "$DEVFLOW_DOMAIN" /etc/letsencrypt \
    || { install_transaction_fail 07-certificate certificate-validation-failed || true; \
      die 'O certificado emitido nao passou pela validacao criptografica.'; }
  printf 'certificate_reused=false\ncertificate_issued=true\n'
}

ensure_temporary_admin_password() {
  local password_file="$DEVFLOW_CONFIG_ROOT/super-admin-temporary-password"
  local temporary
  if [[ ! -e "$password_file" && ! -L "$password_file" ]]; then
    temporary="$(mktemp "$DEVFLOW_CONFIG_ROOT/.super-admin-password.XXXXXX")"
    printf 'Aa1!%s\n' "$(openssl rand -base64 36 | tr -d '\n')" > "$temporary"
    chown root:root "$temporary"; chmod 0600 "$temporary"
    mv -f -- "$temporary" "$password_file"
    TEMPORARY_PASSWORD_GENERATED=true
  fi
  [[ -f "$password_file" && ! -L "$password_file" \
    && "$(stat -c '%u:%g %a' "$password_file")" == '0:0 600' ]] \
    || die 'O arquivo da senha temporaria nao atende root:root 0600.'
}

bootstrap_super_admin() {
  local password_file="$DEVFLOW_CONFIG_ROOT/super-admin-temporary-password"
  local payload_file container_payload=/tmp/devflow-bootstrap-admin.json password token required
  required="$(docker exec devflow-backend node -e \
    "fetch('http://127.0.0.1:3000/api/auth/bootstrap/status').then(r=>r.json()).then(v=>process.stdout.write(String(v.required))).catch(()=>process.exit(1))")"
  [[ "$required" == true || "$required" == false ]] || die 'A API nao confirmou o estado do Super Admin.'
  if [[ "$required" == false ]]; then
    printf '%s\n' 'super_admin_created=false' 'temporary_password_regenerated=false'
    return 0
  fi
  ensure_temporary_admin_password
  install -o root -g root -m 0600 /dev/null "$INITIAL_CREDENTIALS_PENDING_FILE"
  password="$(tr -d '\r\n' < "$password_file")"; token="$(tr -d '\r\n' < "$DEVFLOW_CONFIG_ROOT/bootstrap-token")"
  payload_file="$(mktemp "$DEVFLOW_CONFIG_ROOT/.bootstrap-admin.XXXXXX.json")"
  printf '{"name":"Super Administrador","email":"%s","password":"%s","company_name":"DevFlow","bootstrap_token":"%s"}\n' \
    "$ADMIN_EMAIL" "$password" "$token" > "$payload_file"
  docker cp "$payload_file" "devflow-backend:$container_payload" >/dev/null; rm -f -- "$payload_file"
  docker exec -u 0 devflow-backend chown devflow:devflow "$container_payload"
  if ! docker exec -u devflow devflow-backend node -e '
    const fs=require("node:fs"), endpoint="http://127.0.0.1:3000/api/auth";
    (async()=>{const s=await fetch(`${endpoint}/bootstrap/status`);if(!s.ok)process.exit(20);
    if(!(await s.json()).required)return;const body=fs.readFileSync(process.argv[1],"utf8");
    const r=await fetch(`${endpoint}/bootstrap`,{method:"POST",headers:{"content-type":"application/json"},body});
    if(r.status!==201)process.exit(21)})().catch(()=>process.exit(22));' "$container_payload"; then
    docker exec -u 0 devflow-backend rm -f -- "$container_payload" >/dev/null 2>&1 || true
    die 'A API recusou o bootstrap idempotente do Super Administrador.'
  fi
  docker exec -u 0 devflow-backend rm -f -- "$container_payload"
  printf 'super_admin_created=true\ntemporary_password_generated=%s\n' "$TEMPORARY_PASSWORD_GENERATED"
}

show_initial_credentials() {
  local password_file="$DEVFLOW_CONFIG_ROOT/super-admin-temporary-password" password
  [[ -f "$INITIAL_CREDENTIALS_PENDING_FILE" && ! -L "$INITIAL_CREDENTIALS_PENDING_FILE" ]] || return 0
  if [[ "$CREDENTIAL_TTY_AVAILABLE" == true ]]; then
    password="$(tr -d '\r\n' < "$password_file")"
    printf '%s\n' \
      '============================================================' \
      'CREDENCIAIS INICIAIS DO DEVFLOW' \
      '============================================================' \
      '' 'Super Administrador:' "  $ADMIN_EMAIL" '' 'Senha temporaria:' "  $password" '' \
      'Troque a senha no primeiro acesso.' \
      'A configuracao de MFA e opcional por padrao.' '' \
      '============================================================' >&3
    password=
  else
    printf 'initial_credentials_displayed=false\ninitial_credentials_path=%s\n' "$password_file" >> "$INSTALL_LOG"
  fi
  rm -f -- "$INITIAL_CREDENTIALS_PENDING_FILE"
}

finish_installation_logging() {
  exec 1>&- 2>&-
  if [[ -n "$INSTALL_LOGGER_PID" ]]; then wait "$INSTALL_LOGGER_PID" || true; fi
  cat >> "$INSTALL_LOG" <<EOF
DevFlow instalado com sucesso.
mode=$MODE
URL: https://$DEVFLOW_DOMAIN
Super Administrador: $ADMIN_EMAIL
Senha temporaria protegida: $DEVFLOW_CONFIG_ROOT/super-admin-temporary-password
O DevFlow permanece em homologacao e nao esta aprovado para producao.
EOF
}

install_systemd_units() {
  local unit
  for unit in devflow-backup.service devflow-backup.timer devflow-certificate-renewal.service devflow-certificate-renewal.timer; do
    install -m 0644 "$RELEASE_DIR/scripts/systemd/$unit" "/etc/systemd/system/$unit"
  done
  systemctl daemon-reload
  systemctl enable --now devflow-backup.timer devflow-certificate-renewal.timer
  printf '%s\n' "$(timestamp)" > "$DEVFLOW_STATE_ROOT/certificate-renewal-managed"
  chmod 0600 "$DEVFLOW_STATE_ROOT/certificate-renewal-managed"
  printf '%s\n' "$(timestamp)" > "$DEVFLOW_STATE_ROOT/host-units.installed"
  chmod 0600 "$DEVFLOW_STATE_ROOT/host-units.installed"
}

installation_failed() {
  local code=$?
  trap - ERR EXIT INT TERM
  if [[ "$code" -ne 0 && "$TRANSACTION_STARTED" == true ]]; then
    restore_previous_app_symlink || true
    if [[ "$INSTALL_TRANSACTION_ROOT_CAUSE" == none ]]; then
      install_transaction_fail "$CURRENT_INSTALL_STAGE" isolated-installation-failed || true
    fi
    log ERROR "Instalacao interrompida em $CURRENT_INSTALL_STAGE. Containers existentes foram preservados."
    printf '%s\n' 'Diagnostico: docker ps -a' \
      'Logs: use o comando Compose registrado no relatorio da instalacao.'
  fi
  exit "$code"
}

show_banner
if [[ "$MODE" == resume ]]; then
  load_devflow_env
  DOMAIN="$DEVFLOW_DOMAIN"; ADMIN_EMAIL_INPUT="$ADMIN_EMAIL"
else
  prompt_configuration
fi
preflight
if [[ "$MODE" == check ]]; then
  printf 'mode=check\ninstallation_mode=isolated\npreflight=passed\nbase_packages_needed=%s\nchanges_applied=false\n' "$BASE_PACKAGES_NEEDED"
  exit 0
fi
show_summary
if [[ "$MODE" == dry-run ]]; then
  printf '%s\n' 'mode=dry-run' 'certificate_strategy=certbot-standalone' 'nginx_runtime_after_certificate=true' 'changes_applied=false'
  exit 0
fi
confirm_external_firewall
trap installation_failed ERR EXIT INT TERM

[[ "$BASE_PACKAGES_NEEDED" == false ]] || install_base_dependencies
ensure_docker
install -d -m 0750 "$DEVFLOW_INSTALL_ROOT" "$DEVFLOW_CONFIG_ROOT" "$DEVFLOW_CONFIG_ROOT/nginx" \
  "$DEVFLOW_STATE_ROOT" "$DEVFLOW_LOG_ROOT" "$DEVFLOW_INSTALL_ROOT/backups" "$DEVFLOW_INSTALL_ROOT/releases" \
  "$DEVFLOW_INSTALL_ROOT/storage/postgres" "$DEVFLOW_INSTALL_ROOT/storage/uploads" "$DEVFLOW_INSTALL_ROOT/updater" \
  /run/lock/devflow
INSTALL_LOG="$DEVFLOW_LOG_ROOT/install-$(date -u +%Y%m%dT%H%M%SZ).log"
if [[ -t 1 && -w /dev/tty ]]; then exec 3>/dev/tty; CREDENTIAL_TTY_AVAILABLE=true; fi
touch "$INSTALL_LOG"; chmod 0640 "$INSTALL_LOG"; exec > >(redact_stream | tee -a "$INSTALL_LOG") 2>&1
INSTALL_LOGGER_PID=$!

prepare_source
[[ -z "$EXPECTED_VERSION" || "$EXPECTED_VERSION" == "$DEVFLOW_RELEASE_VERSION" ]] || die 'Versao esperada divergente.'
generate_private_configuration
migrate_partial_configuration
load_devflow_env
validate_runtime_paths
ln -sfn "$RELEASE_DIR" "$DEVFLOW_INSTALL_ROOT/app.candidate"
DEVFLOW_APP_ROOT="$DEVFLOW_INSTALL_ROOT/app.candidate"; compose_files
"${DEVFLOW_COMPOSE[@]}" config --quiet
if [[ "$MODE" == resume ]]; then recalculate_resume_stage; else RESUME_START_STAGE=05-images; fi
install_transaction_begin "$DEVFLOW_RELEASE_VERSION" "$RELEASE_COMMIT"
TRANSACTION_STARTED=true
create_installation_gate
activate_candidate_app_symlink
DEVFLOW_APP_ROOT="$DEVFLOW_INSTALL_ROOT/app"; compose_files
"${DEVFLOW_COMPOSE[@]}" config --quiet
for stage in 01-preflight 02-directories 03-source 04-private-configuration; do install_transaction_complete_stage "$stage"; done

CURRENT_INSTALL_STAGE=05-images
if should_run "$CURRENT_INSTALL_STAGE"; then
  "${DEVFLOW_COMPOSE[@]}" build backend frontend updater
  "${DEVFLOW_COMPOSE[@]}" pull db edge
  backend_image="$(resolve_compose_service_image backend)"
  backend_image_id="$(docker image inspect --format '{{.Id}}' "$backend_image")"
  latest_path="$(find "$RELEASE_DIR/database/migrations" -maxdepth 1 -type f -name '*.sql' -print | sort | tail -n1)"
  validate_backend_migration_image "$backend_image" "${latest_path##*/}" "$backend_image_id" "$(sha256sum "$latest_path" | awk '{print $1}')"
  read -r db_uid db_gid < <(docker run --rm --network none --entrypoint sh postgres:16-alpine -c 'printf "%s %s\n" "$(id -u postgres)" "$(id -g postgres)"')
  read -r backend_uid backend_gid < <(docker run --rm --network none --entrypoint sh "$backend_image" -c 'printf "%s %s\n" "$(id -u devflow)" "$(id -g devflow)"')
  chown "$db_uid:$db_gid" "$DEVFLOW_INSTALL_ROOT/storage/postgres"
  chown "$backend_uid:$backend_gid" "$DEVFLOW_INSTALL_ROOT/storage/uploads"
fi
install_transaction_complete_stage "$CURRENT_INSTALL_STAGE"

CURRENT_INSTALL_STAGE=06-dns-and-firewall; install_transaction_complete_stage "$CURRENT_INSTALL_STAGE"
CURRENT_INSTALL_STAGE=07-certificate
if should_run "$CURRENT_INSTALL_STAGE"; then obtain_certificate; fi
install_transaction_complete_stage "$CURRENT_INSTALL_STAGE"

CURRENT_INSTALL_STAGE=08-runtime-nginx
if should_run "$CURRENT_INSTALL_STAGE"; then render_runtime_nginx_config "$RELEASE_DIR" "$DEVFLOW_NGINX_CONFIG_PATH"; fi
install_transaction_complete_stage "$CURRENT_INSTALL_STAGE"

CURRENT_INSTALL_STAGE=09-containers
if should_run "$CURRENT_INSTALL_STAGE"; then "${DEVFLOW_COMPOSE[@]}" create db backend frontend edge updater >/dev/null; fi
install_transaction_complete_stage "$CURRENT_INSTALL_STAGE"

CURRENT_INSTALL_STAGE=10-database
if should_run "$CURRENT_INSTALL_STAGE"; then "${DEVFLOW_COMPOSE[@]}" up -d db --wait; CONTAINERS_STARTED=true; fi
service_healthy db || die 'PostgreSQL nao ficou saudavel.'
install_transaction_complete_stage "$CURRENT_INSTALL_STAGE"

CURRENT_INSTALL_STAGE=11-migrations
if should_run "$CURRENT_INSTALL_STAGE"; then run_devflow_migrations; fi
DEVFLOW_MIGRATION_VERSION="$("${DEVFLOW_COMPOSE[@]}" exec -T db sh -c 'psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT version FROM schema_migrations ORDER BY applied_at DESC LIMIT 1"')"
[[ -n "$DEVFLOW_MIGRATION_VERSION" ]] || die 'PostgreSQL nao confirmou a migration.'
install_transaction_complete_stage "$CURRENT_INSTALL_STAGE"

CURRENT_INSTALL_STAGE=12-backend
if should_run "$CURRENT_INSTALL_STAGE"; then "${DEVFLOW_COMPOSE[@]}" up -d backend --wait; fi
service_healthy backend || die 'Backend nao ficou saudavel.'
install_transaction_complete_stage "$CURRENT_INSTALL_STAGE"

CURRENT_INSTALL_STAGE=13-frontend
if should_run "$CURRENT_INSTALL_STAGE"; then "${DEVFLOW_COMPOSE[@]}" up -d frontend --wait; fi
service_healthy frontend || die 'Frontend nao ficou saudavel.'
install_transaction_complete_stage "$CURRENT_INSTALL_STAGE"

CURRENT_INSTALL_STAGE=14-nginx-https
if should_run "$CURRENT_INSTALL_STAGE"; then run_edge_updater_stage; fi
service_healthy edge || die 'Nginx nao ficou saudavel.'
service_healthy updater || die 'Updater nao ficou saudavel.'
install_transaction_complete_stage "$CURRENT_INSTALL_STAGE"

CURRENT_INSTALL_STAGE=15-super-admin
if should_run "$CURRENT_INSTALL_STAGE"; then bootstrap_super_admin; fi
install_transaction_complete_stage "$CURRENT_INSTALL_STAGE"

CURRENT_INSTALL_STAGE=16-final-health-state
curl --resolve "$DEVFLOW_DOMAIN:443:127.0.0.1" --fail --silent --show-error "https://$DEVFLOW_DOMAIN/healthz" >/dev/null
curl --resolve "$DEVFLOW_DOMAIN:443:127.0.0.1" --fail --silent --show-error "https://$DEVFLOW_DOMAIN/api/health" >/dev/null
validate_devflow_certificate "$DEVFLOW_DOMAIN" /etc/letsencrypt
db_id="$("${DEVFLOW_COMPOSE[@]}" ps -q db)"; [[ -n "$db_id" && -z "$(docker port "$db_id" 2>/dev/null || true)" ]] || die 'PostgreSQL publicou porta.'
set_managed_env_value DEVFLOW_VERSION "$DEVFLOW_RELEASE_VERSION"; set_managed_env_value DEVFLOW_RELEASE_COMMIT "$RELEASE_COMMIT"
validate_active_app_symlink || die 'O symlink app definitivo nao foi confirmado no health final.'
rm -f -- "$DEVFLOW_INSTALL_ROOT/app.candidate"
DEVFLOW_APP_ROOT="$DEVFLOW_INSTALL_ROOT/app"; DEVFLOW_INSTALLED_SOURCE_DIR="$DEVFLOW_INSTALL_ROOT/source"; DEVFLOW_IDENTITY_RELEASE_ROOT="$RELEASE_DIR"; DEVFLOW_VERSION="$DEVFLOW_RELEASE_VERSION"
DEVFLOW_INSTALLATION_STATE_VALIDATOR="$DEVFLOW_INSTALL_ROOT/app/scripts/validate-installation-state.py"
export DEVFLOW_APP_ROOT DEVFLOW_INSTALLED_SOURCE_DIR DEVFLOW_IDENTITY_RELEASE_ROOT DEVFLOW_VERSION DEVFLOW_MIGRATION_VERSION DEVFLOW_INSTALLATION_STATE_VALIDATOR
resolve_installed_release_identity "$DEVFLOW_INSTALL_ROOT/source" main >/dev/null
DEVFLOW_APPLICATION_INSTALLED=true; DEVFLOW_APPLICATION_HEALTHY=true; DEVFLOW_CERTIFICATE_ISSUED=true
export DEVFLOW_APPLICATION_INSTALLED DEVFLOW_APPLICATION_HEALTHY DEVFLOW_CERTIFICATE_ISSUED
install_systemd_units
write_installation_state
if ! installation_state_schema_valid "$DEVFLOW_STATE_ROOT/installation.json"; then
  diagnose_installation_state "$DEVFLOW_STATE_ROOT/installation.json" || true
  die 'installation.json nao foi confirmado pelo codigo instalado.'
fi
load_installation_state "$DEVFLOW_STATE_ROOT/installation.json" || die 'installation.json nao pode ser recarregado pelo codigo instalado.'
health_output=; health_status=0
health_output="$("$DEVFLOW_INSTALL_ROOT/app/scripts/health.sh" --quiet)" || health_status=$?
printf '%s\n' "$health_output"
[[ "$health_status" -eq 0 && "$health_output" == *'overall_health=healthy'* ]] \
  || die 'O health instalado em novo processo recusou o estado final.'
validate_active_app_symlink || die 'O symlink app divergiu antes de liberar o updater.'
rm -f -- "$INSTALLATION_GATE_FILE"
[[ ! -e "$INSTALLATION_GATE_FILE" ]] || die 'O marcador de instalacao nao pode ser removido.'
commit_app_symlink
install_transaction_complete_stage "$CURRENT_INSTALL_STAGE"
trap - ERR EXIT INT TERM
finish_installation_logging
show_initial_credentials
