#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECKOUT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/compose-images.sh
. "$SCRIPT_DIR/lib/compose-images.sh"
# shellcheck source=lib/install-transaction.sh
. "$SCRIPT_DIR/lib/install-transaction.sh"

MODE=
MODE_EXPLICIT=false
DOMAIN=
ADMIN_EMAIL_INPUT=
EXPECTED_VERSION=
CURRENT_INSTALL_STAGE=01-preflight
TRANSACTION_STARTED=false
COMPOSE_READY=false
CHANGES_APPLIED=false
BASE_PACKAGES_NEEDED=false
PUBLIC_REMOTE='https://github.com/trinityrrocha/DevFlow.git'

usage() {
  cat <<'EOF'
DevFlow - instalador isolado para homologacao

Uso principal:
  sudo ./install.sh

Automacao e suporte:
  ./install.sh --check [--domain HOST] [--admin-email EMAIL]
  sudo ./install.sh --dry-run --domain HOST --admin-email EMAIL
  sudo ./install.sh --install --domain HOST --admin-email EMAIL
  sudo ./install.sh --resume

Parametros removidos retornam erro de descontinuacao; nao existe modo compartilhado.
EOF
}

set_mode() {
  [[ "$MODE_EXPLICIT" == false ]] || die 'Informe somente um modo.'
  MODE="$1"
  MODE_EXPLICIT=true
}

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
    --proxy-mode|--provider|--install-scope|--letsencrypt-email|--super-admin-email)
      die "O parametro $1 foi descontinuado. O DevFlow aceita somente --domain e --admin-email no modo isolado."
      ;;
    --install-internal)
      die 'O modo interno/compartilhado foi descontinuado. Use a instalacao isolada.'
      ;;
    --http-port|--api-port)
      die 'Portas alternativas foram descontinuadas; a instalacao isolada exige 80 e 443.'
      ;;
    --help|-h) usage; exit 0 ;;
    *) die "Opcao desconhecida: $1" ;;
  esac
done

[[ -n "$MODE" ]] || MODE=install

show_banner() {
  cat <<'EOF'
============================================================
 INSTALADOR DO DEVFLOW
============================================================

O DevFlow sera instalado em modo isolado.

Este servidor devera disponibilizar as portas:
  - 80/TCP
  - 443/TCP

O instalador criara:
  - proxy Nginx proprio;
  - containers do DevFlow;
  - redes Docker proprias;
  - volumes persistentes proprios;
  - certificado HTTPS;
  - Super Administrador.
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
    || die 'Dominio invalido: informe somente o nome DNS, sem protocolo ou caminho.'
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

Servicos:
  Nginx
  Frontend
  Backend
  PostgreSQL
  Certbot

O e-mail sera usado para:
  - Super Administrador;
  - emissao e renovacao do certificado HTTPS.
EOF
  if [[ "$MODE" == install && -t 0 ]]; then
    prompt_numeric_confirmation initial-installation \
      'A instalacao isolada do DevFlow esta pronta para iniciar.' \
      'INSTALAR DEVFLOW' 'CANCELAR' || { echo 'Instalacao cancelada.'; exit 0; }
  fi
}

port_owner() {
  local port="$1" docker_owner process_owner
  docker_owner="$(docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null \
    | awk -v port=":$port->" 'index($0, port) {print $1; exit}')"
  process_owner="$(ss -H -ltnp "sport = :$port" 2>/dev/null | head -n1 | sed -n 's/.*users:(("\([^"]*\)".*/\1/p')"
  printf '%s' "${docker_owner:-${process_owner:-unknown}}"
}

port_available_or_owned_by_devflow() {
  local port="$1" owner
  if ! ss -H -ltn "sport = :$port" 2>/dev/null | grep -q .; then return 0; fi
  owner="$(port_owner "$port")"
  if [[ "$MODE" == resume && "$owner" == devflow-nginx ]]; then return 0; fi
  printf 'port=%s\nowner=%s\n' "$port" "$owner"
  return 1
}

preflight() {
  require_linux
  detect_platform
  [[ "$DEVFLOW_DISTRO" == ubuntu ]] || die 'A instalacao isolada suporta Ubuntu 22.04 e 24.04.'
  [[ "$MODE" == check || "$(id -u)" -eq 0 ]] || die 'Execute com sudo ou como root.'
  for command_name in git getent ss awk sed grep sort tar sha256sum; do
    command -v "$command_name" >/dev/null 2>&1 || die "Dependencia ausente: $command_name"
  done
  if ! command -v curl >/dev/null 2>&1; then
    command -v wget >/dev/null 2>&1 || die 'Dependencia ausente: instale curl ou wget.'
    BASE_PACKAGES_NEEDED=true
  fi
  for command_name in openssl python3 gpg; do
    command -v "$command_name" >/dev/null 2>&1 || BASE_PACKAGES_NEEDED=true
  done
  check_capacity /opt
  [[ -z "$DOMAIN" ]] || getent ahosts "$DOMAIN" >/dev/null 2>&1 \
    || die "DNS nao resolve o dominio $DOMAIN."
  local blocked=false
  port_available_or_owned_by_devflow 80 || blocked=true
  port_available_or_owned_by_devflow 443 || blocked=true
  if [[ "$blocked" == true ]]; then
    cat >&2 <<'EOF'
Instalacao isolada bloqueada.

As portas 80 e/ou 443 ja estao em uso.
O modo isolado exige controle exclusivo dessas portas.
Nenhuma alteracao foi realizada.
EOF
    return 1
  fi
  if [[ -f "$DEVFLOW_STATE_ROOT/installation.json" && "$MODE" != check ]]; then
    die 'Uma instalacao DevFlow concluida ja existe. Use scripts/update.sh.'
  fi
  if [[ -e "$DEVFLOW_INSTALL_ROOT" && "$MODE" == install \
    && ! -f "$DEVFLOW_INSTALL_TRANSACTION_FILE" ]]; then
    die 'Instalacao parcial incompativel detectada; nenhuma alteracao foi realizada.'
  fi
  if [[ "$MODE" == resume ]]; then
    [[ -f "$DEVFLOW_INSTALL_TRANSACTION_FILE" && -f "$DEVFLOW_ENV_FILE" ]] \
      || die 'Nao existe transacao isolada retomavel.'
  fi
}

install_base_dependencies() {
  log INFO 'Instalando dependencias base pelos repositorios oficiais do Ubuntu.'
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl gnupg git openssl python3 iproute2
}

configure_docker_repository() {
  local expected_repository key_temporary
  install_base_dependencies
  install -m 0755 -d /etc/apt/keyrings
  key_temporary="$(mktemp /etc/apt/keyrings/.docker.gpg.XXXXXX)"
  curl -fsSL 'https://download.docker.com/linux/ubuntu/gpg' \
    | gpg --dearmor --yes -o "$key_temporary"
  mv -f -- "$key_temporary" /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  expected_repository="deb [arch=$DEVFLOW_ARCH signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $DEVFLOW_CODENAME stable"
  if [[ -e /etc/apt/sources.list.d/docker.list \
    && "$(tr -d '\r' < /etc/apt/sources.list.d/docker.list)" != "$expected_repository" ]]; then
    die 'Repositorio Docker existente diverge do repositorio oficial esperado; corrija-o manualmente.'
  fi
  printf '%s\n' "$expected_repository" > /etc/apt/sources.list.d/docker.list
  apt-get update
}

install_docker_official() {
  log INFO 'Instalando Docker Engine pelo repositorio oficial.'
  configure_docker_repository
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
}

install_compose_official() {
  log INFO 'Instalando somente Docker Compose v2 pelo repositorio oficial.'
  configure_docker_repository
  apt-get install -y docker-compose-plugin
}

prepare_source() {
  local remote_commit release_dir
  [[ -d "$CHECKOUT_DIR/.git" ]] || die 'Execute o instalador a partir do checkout DevFlow validado.'
  [[ "$(git -C "$CHECKOUT_DIR" remote get-url origin)" == "$PUBLIC_REMOTE" ]] || die 'Remote DevFlow divergente.'
  [[ "$(git -C "$CHECKOUT_DIR" branch --show-current)" == main ]] || die 'O checkout deve estar em main.'
  [[ -z "$(git -C "$CHECKOUT_DIR" status --porcelain)" ]] || die 'O checkout possui alteracoes locais.'
  RELEASE_COMMIT="$(git -C "$CHECKOUT_DIR" rev-parse HEAD)"
  remote_commit="$(GIT_TERMINAL_PROMPT=0 git -C "$CHECKOUT_DIR" ls-remote origin refs/heads/main | awk 'NR==1 {print $1}')"
  [[ "$RELEASE_COMMIT" == "$remote_commit" ]] || die 'O commit local ainda nao corresponde a origin/main.'
  if [[ ! -d "$DEVFLOW_INSTALL_ROOT/source/.git" ]]; then
    GIT_TERMINAL_PROMPT=0 git clone --branch main --single-branch "$PUBLIC_REMOTE" "$DEVFLOW_INSTALL_ROOT/source"
    git -C "$DEVFLOW_INSTALL_ROOT/source" config --local core.hooksPath /dev/null
  fi
  [[ "$(git -C "$DEVFLOW_INSTALL_ROOT/source" remote get-url origin)" == "$PUBLIC_REMOTE" \
    && -z "$(git -C "$DEVFLOW_INSTALL_ROOT/source" status --porcelain)" ]] \
    || die 'Checkout operacional existente e incompativel.'
  GIT_TERMINAL_PROMPT=0 git -C "$DEVFLOW_INSTALL_ROOT/source" fetch origin main
  git -C "$DEVFLOW_INSTALL_ROOT/source" merge --ff-only "$RELEASE_COMMIT"
  release_dir="$DEVFLOW_INSTALL_ROOT/releases/$RELEASE_COMMIT"
  if [[ ! -d "$release_dir" ]]; then
    install -d -m 0750 "$release_dir"
    git -C "$DEVFLOW_INSTALL_ROOT/source" archive "$RELEASE_COMMIT" | tar -x -C "$release_dir"
    printf '%s\n' "$RELEASE_COMMIT" > "$release_dir/.devflow-release"
    chmod 0644 "$release_dir/.devflow-release"
  fi
  RELEASE_DIR="$release_dir"
  DEVFLOW_RELEASE_COMMIT="$RELEASE_COMMIT"
  export DEVFLOW_RELEASE_COMMIT
}

generate_private_configuration() {
  local generated db_password jwt_secret bootstrap_token encryption_key backup_passphrase
  [[ ! -e "$DEVFLOW_ENV_FILE" ]] || return 0
  db_password="$(openssl rand -base64 48 | tr -d '\n')"
  jwt_secret="$(openssl rand -hex 48)"
  bootstrap_token="$(openssl rand -base64 48 | tr -d '\n')"
  encryption_key="$(openssl rand -base64 32 | tr -d '\n')"
  backup_passphrase="$(openssl rand -base64 64 | tr -d '\n')"
  generated="$(mktemp "$DEVFLOW_CONFIG_ROOT/.devflow-env.XXXXXX")"
  cat > "$generated" <<EOF
# DevFlow isolated runtime configuration - generated locally, never commit
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
DEVFLOW_ACME_PATH=$DEVFLOW_INSTALL_ROOT/storage/acme
DEVFLOW_CERTIFICATE_PATH=$DEVFLOW_INSTALL_ROOT/certificates
DEVFLOW_NGINX_CONFIG_PATH=$DEVFLOW_CONFIG_ROOT/nginx/active.conf.template
DB_HOST=db
DB_PORT=5432
DB_USER=devflow_user
DB_PASSWORD=$db_password
DB_NAME=devflow_db
JWT_SECRET=$jwt_secret
ADMIN_BOOTSTRAP_TOKEN=$bootstrap_token
CONFIG_ENCRYPTION_KEY=$encryption_key
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
UPDATE_API_ENABLED=false
EOF
  printf '%s\n' "$backup_passphrase" > "$DEVFLOW_CONFIG_ROOT/backup.passphrase"
  printf '%s\n' "$bootstrap_token" > "$DEVFLOW_CONFIG_ROOT/bootstrap-token"
  chmod 0600 "$generated" "$DEVFLOW_CONFIG_ROOT/backup.passphrase" "$DEVFLOW_CONFIG_ROOT/bootstrap-token"
  mv -f -- "$generated" "$DEVFLOW_ENV_FILE"
  unset db_password jwt_secret bootstrap_token encryption_key backup_passphrase
}

install_systemd_units() {
  local unit
  for unit in devflow-backup.service devflow-backup.timer \
    devflow-certificate-renewal.service devflow-certificate-renewal.timer; do
    install -m 0644 "$RELEASE_DIR/scripts/systemd/$unit" "/etc/systemd/system/$unit"
  done
  systemctl daemon-reload
  systemctl enable --now devflow-backup.timer devflow-certificate-renewal.timer
}

bootstrap_super_admin() {
  local password_file="$DEVFLOW_CONFIG_ROOT/super-admin-temporary-password"
  local payload_file container_payload='/tmp/devflow-bootstrap-admin.json'
  local temporary_password bootstrap_token
  if [[ ! -e "$password_file" ]]; then
    temporary_password="Aa1!$(openssl rand -base64 36 | tr -d '\n')"
    printf '%s\n' "$temporary_password" > "$password_file"
    chmod 0600 "$password_file"
  fi
  temporary_password="$(tr -d '\r\n' < "$password_file")"
  bootstrap_token="$(tr -d '\r\n' < "$DEVFLOW_CONFIG_ROOT/bootstrap-token")"
  [[ ${#temporary_password} -ge 16 && ${#bootstrap_token} -ge 48 ]] \
    || die 'Credenciais protegidas do bootstrap estao invalidas.'
  payload_file="$(mktemp "$DEVFLOW_CONFIG_ROOT/.bootstrap-admin.XXXXXX.json")"
  printf '{"name":"Super Administrador","email":"%s","password":"%s","company_name":"DevFlow","bootstrap_token":"%s"}\n' \
    "$ADMIN_EMAIL" "$temporary_password" "$bootstrap_token" > "$payload_file"
  chmod 0600 "$payload_file"
  docker cp "$payload_file" "devflow-backend:$container_payload" >/dev/null
  rm -f -- "$payload_file"
  docker exec -u 0 devflow-backend chown devflow:devflow "$container_payload"
  if ! docker exec -u devflow devflow-backend node -e '
    const fs = require("node:fs");
    const endpoint = "http://127.0.0.1:3000/api/auth";
    (async () => {
      const status = await fetch(`${endpoint}/bootstrap/status`);
      if (!status.ok) process.exit(20);
      if (!(await status.json()).required) process.exit(0);
      const body = fs.readFileSync(process.argv[1], "utf8");
      const response = await fetch(`${endpoint}/bootstrap`, {
        method: "POST", headers: { "content-type": "application/json" }, body
      });
      if (response.status !== 201) process.exit(21);
    })().catch(() => process.exit(22));
  ' "$container_payload"; then
    docker exec -u 0 devflow-backend rm -f -- "$container_payload" >/dev/null 2>&1 || true
    die 'A API recusou a criacao idempotente do Super Administrador.'
  fi
  docker exec -u 0 devflow-backend rm -f -- "$container_payload"
}

installation_failed() {
  local code=$?
  trap - ERR EXIT INT TERM
  if [[ "$code" -ne 0 && "$TRANSACTION_STARTED" == true ]]; then
    install_transaction_fail "$CURRENT_INSTALL_STAGE" isolated-installation-failed || true
    if [[ "$COMPOSE_READY" == true ]]; then
      "${DEVFLOW_COMPOSE[@]}" down --remove-orphans >/dev/null 2>&1 || true
    fi
    log ERROR "Instalacao interrompida em $CURRENT_INSTALL_STAGE; dados, logs e imagens foram preservados."
  fi
  exit "$code"
}

show_banner
if [[ "$MODE" == resume ]]; then
  [[ -r "$DEVFLOW_ENV_FILE" ]] || die 'Configuracao parcial ausente.'
  load_devflow_env
  DOMAIN="$DEVFLOW_DOMAIN"
  ADMIN_EMAIL_INPUT="$ADMIN_EMAIL"
else
  prompt_configuration
fi
preflight

if [[ "$MODE" == check ]]; then
  printf '%s\n' \
    'installation_mode=isolated' \
    'preflight=passed' \
    'ports_80_443=available' \
    "base_packages_needed=$BASE_PACKAGES_NEEDED" \
    'changes_applied=false'
  exit 0
fi

show_summary
if [[ "$MODE" == dry-run ]]; then
  printf '%s\n' \
    'installation_mode=isolated' \
    'planned_directory=/opt/devflow' \
    'planned_services=nginx,frontend,backend,postgresql,certbot' \
    'planned_ports=80,443' \
    'planned_certificate=letsencrypt' \
    'changes_applied=false'
  exit 0
fi

trap installation_failed ERR EXIT INT TERM

if [[ "$BASE_PACKAGES_NEEDED" == true ]]; then install_base_dependencies; fi
if ! command -v docker >/dev/null 2>&1; then install_docker_official; fi
docker version >/dev/null 2>&1 || die 'Docker daemon indisponivel.'
if ! docker compose version >/dev/null 2>&1; then install_compose_official; fi
docker compose version >/dev/null 2>&1 || die 'Docker Compose v2 indisponivel apos instalacao oficial.'
version_at_least "$(docker version --format '{{.Server.Version}}')" 24.0 || die 'Docker 24 ou superior e obrigatorio.'
version_at_least "$(docker compose version --short | sed 's/^v//')" 2.20 || die 'Compose 2.20 ou superior e obrigatorio.'

install -d -m 0750 "$DEVFLOW_INSTALL_ROOT" "$DEVFLOW_CONFIG_ROOT" "$DEVFLOW_CONFIG_ROOT/nginx" \
  "$DEVFLOW_STATE_ROOT" "$DEVFLOW_LOG_ROOT" "$DEVFLOW_INSTALL_ROOT/backups" \
  "$DEVFLOW_INSTALL_ROOT/releases" "$DEVFLOW_INSTALL_ROOT/storage/postgres" \
  "$DEVFLOW_INSTALL_ROOT/storage/uploads" "$DEVFLOW_INSTALL_ROOT/storage/acme/.well-known/acme-challenge" \
  "$DEVFLOW_INSTALL_ROOT/certificates"
INSTALL_LOG="$DEVFLOW_LOG_ROOT/install-$(date -u +%Y%m%dT%H%M%SZ).log"
touch "$INSTALL_LOG"; chmod 0640 "$INSTALL_LOG"
exec > >(redact_stream | tee -a "$INSTALL_LOG") 2>&1
CHANGES_APPLIED=true

prepare_source
if [[ -n "$EXPECTED_VERSION" && "$EXPECTED_VERSION" != "$DEVFLOW_RELEASE_VERSION" ]]; then
  die "Versao esperada $EXPECTED_VERSION diverge de $DEVFLOW_RELEASE_VERSION."
fi
if [[ "$MODE" == resume ]]; then
  install_transaction_load || die 'Transacao parcial invalida ou nao isolada.'
  [[ "$INSTALL_TRANSACTION_COMMIT" == "$RELEASE_COMMIT" ]] || die 'Transacao parcial pertence a outro commit.'
else
  install_transaction_begin "$DEVFLOW_RELEASE_VERSION" "$RELEASE_COMMIT"
fi
TRANSACTION_STARTED=true
install_transaction_complete_stage 01-preflight
CURRENT_INSTALL_STAGE=02-directories; install_transaction_complete_stage "$CURRENT_INSTALL_STAGE"
CURRENT_INSTALL_STAGE=03-source; install_transaction_complete_stage "$CURRENT_INSTALL_STAGE"

CURRENT_INSTALL_STAGE=04-private-configuration
generate_private_configuration
load_devflow_env
validate_runtime_paths
install -m 0644 "$RELEASE_DIR/docker/nginx/isolated-http.conf.template" "$DEVFLOW_NGINX_CONFIG_PATH"
ln -sfn "$RELEASE_DIR" "$DEVFLOW_INSTALL_ROOT/app.candidate"
DEVFLOW_APP_ROOT="$DEVFLOW_INSTALL_ROOT/app.candidate"
compose_files
COMPOSE_READY=true
"${DEVFLOW_COMPOSE[@]}" config --quiet
install_transaction_complete_stage "$CURRENT_INSTALL_STAGE"

CURRENT_INSTALL_STAGE=05-images
"${DEVFLOW_COMPOSE[@]}" build backend frontend
"${DEVFLOW_COMPOSE[@]}" pull db edge certbot
backend_image="$(resolve_compose_service_image backend)"
backend_image_id="$(docker image inspect --format '{{.Id}}' "$backend_image")"
latest_path="$(find "$RELEASE_DIR/database/migrations" -maxdepth 1 -type f -name '*.sql' -print | LC_ALL=C sort | tail -n1)"
[[ -n "$latest_path" ]] || die 'Nenhuma migration encontrada.'
latest_name="${latest_path##*/}"
latest_hash="$(sha256sum "$latest_path" | awk '{print $1}')"
validate_backend_migration_image "$backend_image" "$latest_name" "$backend_image_id" "$latest_hash"
read -r db_uid db_gid < <(docker run --rm --network none --entrypoint sh postgres:16-alpine -c 'printf "%s %s\n" "$(id -u postgres)" "$(id -g postgres)"')
read -r backend_uid backend_gid < <(docker run --rm --network none --entrypoint sh "$backend_image" -c 'printf "%s %s\n" "$(id -u devflow)" "$(id -g devflow)"')
chown "$db_uid:$db_gid" "$DEVFLOW_INSTALL_ROOT/storage/postgres"
chown "$backend_uid:$backend_gid" "$DEVFLOW_INSTALL_ROOT/storage/uploads"
chmod 0750 "$DEVFLOW_INSTALL_ROOT/storage/postgres" "$DEVFLOW_INSTALL_ROOT/storage/uploads"
install_transaction_complete_stage "$CURRENT_INSTALL_STAGE"

CURRENT_INSTALL_STAGE=06-networks
"${DEVFLOW_COMPOSE[@]}" create db backend frontend edge >/dev/null
install_transaction_complete_stage "$CURRENT_INSTALL_STAGE"

CURRENT_INSTALL_STAGE=07-database
"${DEVFLOW_COMPOSE[@]}" up -d db --wait
install_transaction_complete_stage "$CURRENT_INSTALL_STAGE"

CURRENT_INSTALL_STAGE=08-migrations
run_devflow_migrations
DEVFLOW_MIGRATION_VERSION="$("${DEVFLOW_COMPOSE[@]}" exec -T db sh -c \
  'psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT version FROM schema_migrations ORDER BY applied_at DESC LIMIT 1"')"
[[ -n "$DEVFLOW_MIGRATION_VERSION" ]] || die 'PostgreSQL nao confirmou a migration.'
install_transaction_complete_stage "$CURRENT_INSTALL_STAGE"

CURRENT_INSTALL_STAGE=09-backend
"${DEVFLOW_COMPOSE[@]}" up -d backend --wait
install_transaction_complete_stage "$CURRENT_INSTALL_STAGE"

CURRENT_INSTALL_STAGE=10-frontend
"${DEVFLOW_COMPOSE[@]}" up -d frontend --wait
install_transaction_complete_stage "$CURRENT_INSTALL_STAGE"

CURRENT_INSTALL_STAGE=11-nginx-http
"${DEVFLOW_COMPOSE[@]}" up -d edge --wait
challenge="devflow-$(openssl rand -hex 12)"
printf '%s' "$challenge" > "$DEVFLOW_ACME_PATH/.well-known/acme-challenge/$challenge"
[[ "$(curl --fail --silent --max-time 15 -H "Host: $DEVFLOW_DOMAIN" \
  "http://127.0.0.1/.well-known/acme-challenge/$challenge")" == "$challenge" ]] \
  || die 'A rota ACME HTTP nao respondeu corretamente.'
rm -f -- "$DEVFLOW_ACME_PATH/.well-known/acme-challenge/$challenge"
install_transaction_complete_stage "$CURRENT_INSTALL_STAGE"

CURRENT_INSTALL_STAGE=12-certificate
if [[ ! -r "$DEVFLOW_CERTIFICATE_PATH/live/$DEVFLOW_DOMAIN/fullchain.pem" ]]; then
  "${DEVFLOW_COMPOSE[@]}" --profile operations run --rm certbot certonly --webroot \
    --webroot-path /var/www/certbot --domain "$DEVFLOW_DOMAIN" --email "$ADMIN_EMAIL" \
    --agree-tos --no-eff-email --non-interactive
fi
openssl x509 -in "$DEVFLOW_CERTIFICATE_PATH/live/$DEVFLOW_DOMAIN/fullchain.pem" \
  -noout -checkhost "$DEVFLOW_DOMAIN" >/dev/null
install_transaction_complete_stage "$CURRENT_INSTALL_STAGE"

CURRENT_INSTALL_STAGE=13-nginx-https
install -m 0644 "$RELEASE_DIR/docker/nginx/isolated-https.conf.template" "$DEVFLOW_NGINX_CONFIG_PATH"
"${DEVFLOW_COMPOSE[@]}" up -d edge --wait --force-recreate
install_transaction_complete_stage "$CURRENT_INSTALL_STAGE"

CURRENT_INSTALL_STAGE=14-super-admin
[[ -s "$DEVFLOW_CONFIG_ROOT/bootstrap-token" && "$(stat -c '%a' "$DEVFLOW_CONFIG_ROOT/bootstrap-token")" == 600 ]] \
  || die 'Token protegido do Super Admin ausente.'
bootstrap_super_admin
install_transaction_complete_stage "$CURRENT_INSTALL_STAGE"

CURRENT_INSTALL_STAGE=15-health
curl --fail --silent --show-error --max-time 30 "https://$DEVFLOW_DOMAIN/api/health" >/dev/null
curl --fail --silent --show-error --max-time 30 "https://$DEVFLOW_DOMAIN/" >/dev/null
db_id="$("${DEVFLOW_COMPOSE[@]}" ps -q db)"
[[ -n "$db_id" && -z "$(docker port "$db_id" 2>/dev/null || true)" ]] || die 'PostgreSQL publicou porta no host.'
install_transaction_complete_stage "$CURRENT_INSTALL_STAGE"

CURRENT_INSTALL_STAGE=16-final-state
set_managed_env_value DEVFLOW_VERSION "$DEVFLOW_RELEASE_VERSION"
set_managed_env_value DEVFLOW_RELEASE_COMMIT "$RELEASE_COMMIT"
ln -sfn "$RELEASE_DIR" "$DEVFLOW_INSTALL_ROOT/app"
rm -f -- "$DEVFLOW_INSTALL_ROOT/app.candidate"
DEVFLOW_APP_ROOT="$DEVFLOW_INSTALL_ROOT/app"
DEVFLOW_INSTALLED_SOURCE_DIR="$DEVFLOW_INSTALL_ROOT/source"
DEVFLOW_IDENTITY_RELEASE_ROOT="$RELEASE_DIR"
DEVFLOW_VERSION="$DEVFLOW_RELEASE_VERSION"
export DEVFLOW_APP_ROOT DEVFLOW_INSTALLED_SOURCE_DIR DEVFLOW_IDENTITY_RELEASE_ROOT DEVFLOW_VERSION
resolve_installed_release_identity "$DEVFLOW_INSTALL_ROOT/source" main >/dev/null
DEVFLOW_APPLICATION_INSTALLED=true
DEVFLOW_APPLICATION_HEALTHY=true
DEVFLOW_CERTIFICATE_ISSUED=true
export DEVFLOW_APPLICATION_INSTALLED DEVFLOW_APPLICATION_HEALTHY DEVFLOW_CERTIFICATE_ISSUED \
  DEVFLOW_MIGRATION_VERSION
write_installation_state
install_systemd_units
install_transaction_complete_stage "$CURRENT_INSTALL_STAGE"

trap - ERR EXIT INT TERM
cat <<EOF

DevFlow instalado com sucesso.

URL:
  https://$DEVFLOW_DOMAIN

Super Administrador:
  $ADMIN_EMAIL

HTTPS:
  ativo

Banco:
  saudavel

Backend:
  saudavel

Frontend:
  saudavel

Atualizacoes:
  habilitadas

A senha temporaria esta protegida em $DEVFLOW_CONFIG_ROOT/super-admin-temporary-password e nao foi exibida.
No primeiro acesso, a troca de senha e a configuracao de MFA sao obrigatorias.
O DevFlow permanece em homologacao e nao esta aprovado para producao.
EOF
