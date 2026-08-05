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

Modo: Isolado
Dominio: $DOMAIN
E-mail administrativo: $ADMIN_EMAIL_INPUT
Diretorio: /opt/devflow
Portas publicas: 80 e 443
Certificado: Certbot standalone no host
Servicos: PostgreSQL, backend, frontend, Nginx e updater
EOF
  if [[ "$MODE" == install && -t 0 ]]; then
    prompt_numeric_confirmation initial-installation \
      'A instalacao isolada do DevFlow esta pronta para iniciar.' \
      'INSTALAR DEVFLOW' 'CANCELAR' || { echo 'Instalacao cancelada.'; exit 0; }
  fi
}

confirm_external_firewall() {
  [[ "$MODE" == install || "$MODE" == resume ]] || return 0
  [[ "$FIREWALL_CONFIRMED" == false ]] || return 0
  prompt_numeric_confirmation external-firewall \
    $'O Let\047s Encrypt precisa acessar externamente 80/TCP e 443/TCP.\nConfirme a liberacao no firewall do provedor.' \
    'AS PORTAS ESTAO LIBERADAS' 'CANCELAR' \
    || { echo 'Instalacao cancelada antes do certificado.'; exit 0; }
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

recalculate_resume_stage() {
  local service image expected_version actual_version latest migration required
  RESUME_START_STAGE=05-images
  expected_version="$DEVFLOW_RELEASE_VERSION"
  for service in backend frontend updater; do
    image="$(compose_service_image_expected "$service" 2>/dev/null || true)"
    actual_version="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' "$image" 2>/dev/null || true)"
    [[ -n "$image" && "$actual_version" == "$expected_version" ]] \
      || { printf 'resume_recalculated_stage=%s\n' "$RESUME_START_STAGE"; return; }
  done
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

bootstrap_super_admin() {
  local password_file="$DEVFLOW_CONFIG_ROOT/super-admin-temporary-password"
  local payload_file container_payload=/tmp/devflow-bootstrap-admin.json password token
  if [[ ! -e "$password_file" ]]; then printf 'Aa1!%s\n' "$(openssl rand -base64 36 | tr -d '\n')" > "$password_file"; chmod 0600 "$password_file"; fi
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
  printf 'installation_mode=isolated\npreflight=passed\nbase_packages_needed=%s\nchanges_applied=false\n' "$BASE_PACKAGES_NEEDED"
  exit 0
fi
show_summary
if [[ "$MODE" == dry-run ]]; then
  printf '%s\n' 'certificate_strategy=certbot-standalone' 'nginx_runtime_after_certificate=true' 'changes_applied=false'
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
touch "$INSTALL_LOG"; chmod 0640 "$INSTALL_LOG"; exec > >(redact_stream | tee -a "$INSTALL_LOG") 2>&1

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
if should_run "$CURRENT_INSTALL_STAGE"; then "${DEVFLOW_COMPOSE[@]}" up -d edge updater --wait; fi
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
ln -sfn "$RELEASE_DIR" "$DEVFLOW_INSTALL_ROOT/app"; rm -f -- "$DEVFLOW_INSTALL_ROOT/app.candidate"
DEVFLOW_APP_ROOT="$DEVFLOW_INSTALL_ROOT/app"; DEVFLOW_INSTALLED_SOURCE_DIR="$DEVFLOW_INSTALL_ROOT/source"; DEVFLOW_IDENTITY_RELEASE_ROOT="$RELEASE_DIR"; DEVFLOW_VERSION="$DEVFLOW_RELEASE_VERSION"
export DEVFLOW_APP_ROOT DEVFLOW_INSTALLED_SOURCE_DIR DEVFLOW_IDENTITY_RELEASE_ROOT DEVFLOW_VERSION DEVFLOW_MIGRATION_VERSION
resolve_installed_release_identity "$DEVFLOW_INSTALL_ROOT/source" main >/dev/null
DEVFLOW_APPLICATION_INSTALLED=true; DEVFLOW_APPLICATION_HEALTHY=true; DEVFLOW_CERTIFICATE_ISSUED=true
export DEVFLOW_APPLICATION_INSTALLED DEVFLOW_APPLICATION_HEALTHY DEVFLOW_CERTIFICATE_ISSUED
install_systemd_units
write_installation_state
install_transaction_complete_stage "$CURRENT_INSTALL_STAGE"
trap - ERR EXIT INT TERM

cat <<EOF
DevFlow instalado com sucesso.
URL: https://$DEVFLOW_DOMAIN
Super Administrador: $ADMIN_EMAIL
Senha temporaria protegida: $DEVFLOW_CONFIG_ROOT/super-admin-temporary-password
certificate_valid=true
db_healthy=true
backend_healthy=true
frontend_healthy=true
nginx_healthy=true
external_https_status=healthy
overall_health=healthy
O DevFlow permanece em homologacao e nao esta aprovado para producao.
EOF
