#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/proxy-config.sh
. "$SCRIPT_DIR/lib/proxy-config.sh"
# shellcheck source=lib/fullpassword-proxy.sh
. "$SCRIPT_DIR/lib/fullpassword-proxy.sh"
# shellcheck source=providers/provider-contract.sh
. "$SCRIPT_DIR/providers/provider-contract.sh"

MODE=check
MODE_EXPLICIT=false
DOMAIN=
LETSENCRYPT_EMAIL=
SUPER_ADMIN_EMAIL=
INFRASTRUCTURE_PROVIDER=host-nginx
PROVIDER_EXPLICIT=false
PROXY_MODE=shared
HTTP_PORT=18080
API_PORT=13000
SHARED_PROXY_ADAPTER=none
CHECK_STATUS=passed
CHECK_PRIVILEGED_DRY_RUN_REQUIRED=false
NGINX_CONFIG=/etc/nginx/conf.d/devflow.conf
MANAGED_MARKER='# Managed by DevFlow installer. Do not merge with another application.'

usage() {
  printf 'DevFlow %s — instalador inicial para homologação\n\n' "$DEVFLOW_RELEASE_VERSION"
  cat <<'EOF'
Uso:
  ./install.sh --check
  ./install.sh --dry-run [--provider host-nginx|isolated-nginx] --domain HOST \
    --letsencrypt-email EMAIL --super-admin-email EMAIL
  sudo ./install.sh --install [--provider host-nginx|isolated-nginx] --domain HOST \
    --letsencrypt-email EMAIL --super-admin-email EMAIL

Modos:
  --check       diagnóstico somente leitura (padrão)
  --dry-run     valida e apresenta o plano; não altera o host
  --install     primeira instalação, com confirmação explícita

Opções:
  --provider PROVIDER       host-nginx (padrão), isolated-nginx ou legado explícito
  --proxy-mode MODE         alias legado: shared=host-nginx, isolated=isolated-nginx
  --domain HOST             domínio exclusivo do DevFlow
  --letsencrypt-email EMAIL contato do Let's Encrypt
  --super-admin-email EMAIL identidade permitida no bootstrap
  --http-port PORT          frontend em loopback no modo shared (padrão 18080)
  --api-port PORT           backend em loopback no modo shared (padrão 13000)
  --help                    mostra esta ajuda

Provider de infraestrutura:

  host-nginx — recomendado e padrão
    Proxy central instalado diretamente no Linux. Cada aplicação mantém
    containers, redes, volumes, storage e banco próprios.

  isolated-nginx
    Proxy Docker exclusivo; indicado apenas para VPS exclusiva do DevFlow.

  legacy-docker-nginx
    Adaptador descontinuado do fullpassword_nginx, disponível somente por seleção
    explícita para transição, diagnóstico e rollback.
EOF
}

set_mode() {
  [[ "$MODE_EXPLICIT" == false ]] || die 'Informe somente um modo de execução.'
  MODE="$1"
  MODE_EXPLICIT=true
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) set_mode check; shift ;;
    --dry-run) set_mode dry-run; shift ;;
    --install) set_mode install; shift ;;
    --provider) INFRASTRUCTURE_PROVIDER="${2:-}"; PROVIDER_EXPLICIT=true; shift 2 ;;
    --proxy-mode)
      case "${2:-}" in
        shared) INFRASTRUCTURE_PROVIDER=host-nginx ;;
        isolated) INFRASTRUCTURE_PROVIDER=isolated-nginx ;;
        *) die 'Informe --proxy-mode isolated ou shared.' ;;
      esac
      PROVIDER_EXPLICIT=true
      shift 2
      ;;
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --letsencrypt-email|--email) LETSENCRYPT_EMAIL="${2:-}"; shift 2 ;;
    --super-admin-email|--super-admin) SUPER_ADMIN_EMAIL="${2:-}"; shift 2 ;;
    --http-port) HTTP_PORT="${2:-}"; shift 2 ;;
    --api-port) API_PORT="${2:-}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) die "Opção desconhecida: $1" ;;
  esac
done

require_linux
detect_platform
validate_safe_absolute_path "$DEVFLOW_INSTALL_ROOT" 'Diretório de instalação'
[[ "$DEVFLOW_INSTALL_ROOT" == /opt/devflow ]] || die 'Esta versão suporta somente o diretório /opt/devflow.'
validate_safe_absolute_path "$SOURCE_DIR" 'Checkout operacional'
check_capacity /
validate_port "$HTTP_PORT"
validate_port "$API_PORT"
[[ "$HTTP_PORT" != "$API_PORT" ]] || die 'As portas do frontend e da API devem ser diferentes.'

docker_state=missing
compose_state=missing
docker_version=unknown
compose_version=unknown
if command -v docker >/dev/null 2>&1; then
  docker_state=present
  docker_version="$(docker version --format '{{.Server.Version}}' 2>/dev/null || true)"
  [[ -n "$docker_version" ]] || docker_version=daemon-unavailable
  if docker compose version >/dev/null 2>&1; then
    compose_state=present
    compose_version="$(docker compose version --short 2>/dev/null | sed 's/^v//')"
  fi
fi

fullpassword_container=
shared_proxy_container=
devflow_containers=0
config_state=absent
proxy_detected=none
if command -v caddy >/dev/null 2>&1 && systemctl is-active --quiet caddy 2>/dev/null; then
  proxy_detected=caddy-host
elif command -v nginx >/dev/null 2>&1; then
  proxy_detected=host-nginx
fi
if [[ "$docker_version" != daemon-unavailable && "$docker_state" == present ]]; then
  fullpassword_container="$(docker ps -a --filter name='^/fullpassword_nginx$' --format '{{.Names}}' | head -n1)"
  if [[ -n "$fullpassword_container" ]]; then
    shared_proxy_container="$fullpassword_container"
    proxy_detected=fullpassword_nginx
  else
    while IFS='|' read -r container_name container_image; do
      [[ "$container_name $container_image" =~ [Cc]addy|[Nn]ginx ]] || continue
      if [[ -n "$shared_proxy_container" ]]; then
        proxy_detected=multiple-container-proxies
        shared_proxy_container=
        break
      fi
      shared_proxy_container="$container_name"
      if [[ "$container_name $container_image" =~ [Cc]addy ]]; then
        proxy_detected=caddy-container
      else
        proxy_detected=nginx-container
      fi
    done < <(docker ps -a --format '{{.Names}}|{{.Image}}')
  fi
  devflow_containers="$(docker ps -a --filter "label=com.docker.compose.project=$DEVFLOW_PROJECT" --format '{{.ID}}' | wc -l | tr -d ' ')"
fi

if [[ "$MODE" == check && -e "$DEVFLOW_ENV_FILE" ]]; then
  if [[ -r "$DEVFLOW_ENV_FILE" ]]; then
    load_devflow_env
    validate_runtime_paths
    DOMAIN="${DEVFLOW_DOMAIN:-}"
    if [[ -n "${DEVFLOW_INFRASTRUCTURE_PROVIDER:-}" ]]; then
      INFRASTRUCTURE_PROVIDER="$DEVFLOW_INFRASTRUCTURE_PROVIDER"
      derive_legacy_proxy_settings "$INFRASTRUCTURE_PROVIDER"
    else
      provider_resolve_installed
      INFRASTRUCTURE_PROVIDER="$DEVFLOW_INFRASTRUCTURE_PROVIDER"
    fi
    PROXY_MODE="$DEVFLOW_PROXY_MODE"
    SHARED_PROXY_ADAPTER="$DEVFLOW_SHARED_PROXY_ADAPTER"
    HTTP_PORT="${DEVFLOW_HTTP_PORT:-18080}"
    API_PORT="${DEVFLOW_API_PORT:-13000}"
    [[ "$PROXY_MODE" == isolated || "$PROXY_MODE" == shared ]] || die 'DEVFLOW_PROXY_MODE inválido na configuração.'
    validate_domain "$DOMAIN"
    validate_email "${LETSENCRYPT_EMAIL:-}"
    validate_email "${SUPER_ADMIN_EMAIL:-}"
    validate_port "${DEVFLOW_HTTP_PORT:-18080}"
    validate_port "${DEVFLOW_API_PORT:-13000}"
    config_state=valid
  else
    config_state=protected-unreadable
  fi
fi

if [[ "$MODE" != check ]]; then
  for unit_file in /etc/systemd/system/devflow-backup.service /etc/systemd/system/devflow-backup.timer; do
    managed_file "$unit_file" '# Managed by DevFlow installer.' || die "$unit_file pertence a outro sistema."
  done
  if [[ "$docker_state" == missing ]] && { [[ -e /etc/apt/keyrings/docker.gpg ]] || [[ -e /etc/apt/sources.list.d/docker.list ]]; }; then
    die 'Docker CLI ausente, mas uma configuração de repositório Docker já existe. Revise a instalação parcial manualmente.'
  fi
  [[ "$PROXY_MODE" == isolated || "$PROXY_MODE" == shared ]] || die 'Informe --proxy-mode isolated ou shared.'
  provider_validate_name "$INFRASTRUCTURE_PROVIDER" || die 'Provider de infraestrutura invalido.'
  derive_legacy_proxy_settings "$INFRASTRUCTURE_PROVIDER"
  PROXY_MODE="$DEVFLOW_PROXY_MODE"
  SHARED_PROXY_ADAPTER="$DEVFLOW_SHARED_PROXY_ADAPTER"
  validate_domain "$DOMAIN"
  validate_email "$LETSENCRYPT_EMAIL"
  validate_email "$SUPER_ADMIN_EMAIL"
fi

provider_load "$INFRASTRUCTURE_PROVIDER" || die 'Nao foi possivel carregar o provider solicitado.'

provider_status=0
if [[ "$MODE" == check ]]; then
  provider_check || provider_status=$?
  if [[ "$provider_status" -eq 4 ]]; then
    cat <<'EOF'
Um proxy Docker existente esta ocupando as portas 80 e 443.
O Nginx central exige uma migracao controlada separada; o instalador comum
nao alterara o proxy existente.

Execute primeiro:
  sudo ./scripts/migrate-proxy-to-host-nginx.sh --check
EOF
  elif [[ "$provider_status" -eq 3 ]]; then
    CHECK_STATUS=passed-with-privileged-dry-run-required
  elif [[ "$provider_status" -ne 0 ]]; then
    CHECK_STATUS=failed
  fi
elif [[ "$INFRASTRUCTURE_PROVIDER" != legacy-docker-nginx ]]; then
  provider_dry_run || provider_status=$?
  if [[ "$provider_status" -eq 4 ]]; then
    cat <<'EOF'
dry_run_status=blocked
reason=controlled-proxy-migration-required
changes_applied=false

Execute somente:
  sudo ./scripts/migrate-proxy-to-host-nginx.sh --check
EOF
    exit 4
  elif [[ "$provider_status" -eq 3 && "$MODE" == dry-run ]]; then
    cat <<EOF
dry_run_status=blocked
reason=privileged-port-owner-check-required
changes_applied=false

Repita somente o dry-run com sudo e os mesmos parametros.
EOF
    exit 3
  fi
  [[ "$provider_status" -eq 0 ]] || die 'O provider bloqueou a operacao por seguranca.'
fi

if [[ "$MODE" == install && -e "$DEVFLOW_INSTALL_ROOT/app" ]]; then
  die 'Uma instalação já existe. O instalador não atualiza sistemas; use scripts/update.sh.'
fi

if [[ "$MODE" != check && "$docker_state" == present && "$docker_version" == daemon-unavailable ]]; then
  die 'Docker está instalado, mas o daemon não responde. Corrija o serviço antes da instalação.'
fi

if [[ "$docker_state" == present && "$docker_version" != daemon-unavailable ]]; then
  version_at_least "$docker_version" 24.0 || die "Docker $docker_version é incompatível; mínimo 24.0."
fi
if [[ "$compose_state" == present ]]; then
  version_at_least "$compose_version" 2.20 || die "Docker Compose $compose_version é incompatível; mínimo 2.20."
fi

run_shared_proxy_diagnostic() {
  local -a diagnostic_args=(
    --domain "$DOMAIN"
    --letsencrypt-email "$LETSENCRYPT_EMAIL"
    --super-admin-email "$SUPER_ADMIN_EMAIL"
    --http-port "$HTTP_PORT"
    --api-port "$API_PORT"
    --operation-mode "$MODE"
  )
  local diagnostic_status=0 report=/opt/devflow/logs/shared-proxy-diagnostic.log answer
  [[ -z "$shared_proxy_container" ]] || diagnostic_args+=(--container "$shared_proxy_container")

  cat <<'EOF'
O DevFlow irá analisar o proxy existente em modo somente leitura.

Nenhum container, arquivo, certificado ou serviço será alterado
até que uma integração persistente e reversível seja comprovada.
EOF
  if [[ "$MODE" == install ]]; then
    [[ -t 0 ]] || die 'O diagnóstico compartilhado exige confirmação em terminal interativo.'
    read -r -p 'Deseja executar o diagnóstico? [s/N] ' answer
    [[ "$answer" == s || "$answer" == S ]] || die 'Diagnóstico cancelado. Nenhuma alteração foi realizada.'
    require_root
    diagnostic_args+=(--output "$report")
  fi

  if "$SCRIPT_DIR/detect-shared-proxy.sh" "${diagnostic_args[@]}"; then
    case "$proxy_detected" in
      fullpassword_nginx) SHARED_PROXY_ADAPTER=fullpassword-nginx ;;
      host-nginx) SHARED_PROXY_ADAPTER=host-nginx ;;
      *) die "Diagnóstico aprovou um proxy inesperado: $proxy_detected" ;;
    esac
    echo "Integração automática compatível: $SHARED_PROXY_ADAPTER."
    return 0
  else
    diagnostic_status=$?
    if [[ "$diagnostic_status" -eq 3 && "$MODE" == dry-run ]]; then
      cat <<EOF
dry_run_status=blocked
reason=privileged-compose-validation-required
changes_applied=false

Para concluir a validação somente leitura, execute:

  sudo ./install.sh --dry-run \\
    --proxy-mode shared \\
    --domain $DOMAIN \\
    --letsencrypt-email $LETSENCRYPT_EMAIL \\
    --super-admin-email $SUPER_ADMIN_EMAIL \\
    --http-port $HTTP_PORT \\
    --api-port $API_PORT

Nenhum arquivo, container, rede ou certificado será alterado durante essa validação.
EOF
      return 3
    fi
    echo 'Integração automática não comprovada.'
    echo 'Nenhuma alteração foi realizada no proxy.'
    [[ "$MODE" != install ]] || echo "Consulte o relatório gerado: $report"
    return "$diagnostic_status"
  fi
}

check_protected_compose_inputs() {
  local inventory kind path exists readable privileged protected
  [[ -n "$fullpassword_container" && -r /opt/fullpassword/docker-compose.yml ]] || return 0
  if command -v python3 >/dev/null 2>&1; then
    if ! inventory="$(python3 "$SCRIPT_DIR/discover-compose-inputs.py" /opt/fullpassword/docker-compose.yml)"; then
      log WARN 'Não foi possível inventariar todos os inputs do Compose no diagnóstico básico.'
      return 0
    fi
    while IFS=$'\t' read -r kind path exists readable privileged protected; do
      [[ "$kind" != required-variable ]] || continue
      if [[ "$exists" == true && "$readable" == false ]]; then
        CHECK_PRIVILEGED_DRY_RUN_REQUIRED=true
        printf 'Arquivo protegido detectado: %s\n' "$path"
      fi
    done <<< "$inventory"
  elif [[ -e /opt/fullpassword/.env && ! -r /opt/fullpassword/.env ]]; then
    CHECK_PRIVILEGED_DRY_RUN_REQUIRED=true
    printf 'Arquivo protegido detectado: %s\n' /opt/fullpassword/.env
  fi
  if [[ "$CHECK_PRIVILEGED_DRY_RUN_REQUIRED" == true ]]; then
    CHECK_STATUS=passed-with-privileged-dry-run-required
  fi
}

if [[ "$MODE" == check && "$INFRASTRUCTURE_PROVIDER" == legacy-docker-nginx ]]; then
  check_protected_compose_inputs
fi

if [[ "$MODE" != check && "$INFRASTRUCTURE_PROVIDER" == legacy-docker-nginx ]]; then
  shared_diagnostic_status=0
  run_shared_proxy_diagnostic || shared_diagnostic_status=$?
  if [[ "$shared_diagnostic_status" -eq 3 && "$MODE" == dry-run ]]; then
    exit 3
  elif [[ "$shared_diagnostic_status" -ne 0 ]]; then
    die 'O modo compartilhado permaneceu bloqueado por segurança; consulte o diagnóstico.'
  fi
fi

if [[ "$MODE" != check ]]; then
  if [[ "$PROXY_MODE" == isolated ]]; then
    for port in 80 443; do
      if port_is_listening "$port" && ! devflow_container_running edge; then
        die "Porta $port ocupada. O modo isolated não interrompe o proprietário atual."
      fi
    done
  elif [[ "$SHARED_PROXY_ADAPTER" == host-nginx ]]; then
    for tuple in "frontend:$HTTP_PORT" "backend:$API_PORT"; do
      service="${tuple%%:*}"
      port="${tuple##*:}"
      if port_is_listening "$port" && ! devflow_container_running "$service"; then
        die "Porta loopback $port ocupada por outro serviço."
      fi
    done
    managed_file "$NGINX_CONFIG" "$MANAGED_MARKER" || die "$NGINX_CONFIG pertence a outro sistema."
    if [[ -d /etc/nginx ]]; then
      while IFS= read -r nginx_file; do
        [[ "$nginx_file" == "$NGINX_CONFIG" ]] && continue
        [[ -r "$nginx_file" ]] || die "Não foi possível validar a configuração Nginx: $nginx_file"
        grep -Eq "server_name[[:space:]]+([^;[:space:]]+[[:space:]]+)*$DOMAIN([[:space:];]|$)" "$nginx_file" \
          && die "Domínio já declarado em outra configuração Nginx: $nginx_file"
      done < <(find /etc/nginx -type f -name '*.conf' -print 2>/dev/null)
    fi
  fi
  getent ahosts "$DOMAIN" >/dev/null 2>&1 || die "O domínio $DOMAIN não resolve no DNS."
fi

if [[ "$docker_state" == present && "$docker_version" != daemon-unavailable ]]; then
  while IFS='|' read -r name project; do
    [[ -z "$name" || "$name" != devflow* || "$project" == "$DEVFLOW_PROJECT" ]] \
      || die "Container conflitante detectado: $name"
  done < <(docker ps -a --format '{{.Names}}|{{.Label "com.docker.compose.project"}}')
  for volume in devflow_devflow_db_data devflow_devflow_uploads; do
    if docker volume inspect "$volume" >/dev/null 2>&1; then
      owner="$(docker volume inspect "$volume" --format '{{index .Labels "com.docker.compose.project"}}')"
      [[ "$owner" == "$DEVFLOW_PROJECT" ]] || die "Volume conflitante detectado: $volume"
    fi
  done
  if docker network inspect devflow_devflow_internal >/dev/null 2>&1; then
    owner="$(docker network inspect devflow_devflow_internal --format '{{index .Labels "com.docker.compose.project"}}')"
    [[ "$owner" == "$DEVFLOW_PROJECT" ]] || die 'Rede devflow_devflow_internal pertence a outro projeto.'
  fi
  if docker network inspect devflow_edge >/dev/null 2>&1; then
    owner="$(docker network inspect devflow_edge --format '{{index .Labels "devflow.managed"}}')"
    [[ "$owner" == true ]] || die 'Rede externa devflow_edge não possui propriedade DevFlow comprovada.'
  fi
fi

cat <<EOF
Resumo DevFlow $DEVFLOW_VERSION
  modo: $MODE
  sistema: ${PRETTY_NAME:-$DEVFLOW_DISTRO} ($DEVFLOW_ARCH)
  Docker: $docker_state ($docker_version)
  Compose v2: $compose_state ($compose_version)
  containers DevFlow existentes: $devflow_containers
  fullpassword_nginx: ${fullpassword_container:-não detectado}
  proxy existente: $proxy_detected
  provider: $INFRASTRUCTURE_PROVIDER
  estado do provider: $DEVFLOW_PROVIDER_STATUS
  proxy solicitado: ${PROXY_MODE:-não definido}
  adaptador compartilhado: $SHARED_PROXY_ADAPTER
  domínio: ${DOMAIN:-não definido}
  diretório: $DEVFLOW_INSTALL_ROOT
  configuração privada: $DEVFLOW_ENV_FILE
  override compartilhado: $DEVFLOW_CONFIG_ROOT/proxy/fullpassword-nginx.override.yml
  rota Nginx DevFlow: $DEVFLOW_CONFIG_ROOT/nginx/devflow.conf
  backups do proxy: $DEVFLOW_INSTALL_ROOT/backups/proxy
  estado operacional: $DEVFLOW_STATE_ROOT
  estado da configuração: $config_state
EOF

if [[ "$MODE" == check ]]; then
  [[ "$docker_version" != daemon-unavailable ]] || log WARN 'Docker ausente ou daemon indisponível.'
  [[ "$compose_state" == present ]] || log WARN 'Docker Compose v2 ausente.'
  [[ -z "$fullpassword_container" ]] || log WARN 'fullpassword_nginx exige diagnóstico estrito; somente o contrato aprovado permite o Compose override transacional.'
  if [[ "$CHECK_PRIVILEGED_DRY_RUN_REQUIRED" == true ]]; then
    cat <<EOF
Validação básica concluída.

A configuração compartilhada utiliza arquivos protegidos.
A validação completa do Compose exigirá execução privilegiada do modo --dry-run.
check_status=$CHECK_STATUS
changes_applied=false
EOF
  else
    echo "check_status=$CHECK_STATUS"
    echo 'changes_applied=false'
  fi
  log INFO 'Diagnóstico concluído sem alterações.'
  exit 0
fi

cat <<EOF
Ações planejadas:
  - instalar Docker Engine pelo repositório oficial apenas se estiver ausente;
  - delegar proxy, Nginx, Certbot, validação e rollback ao provider $INFRASTRUCTURE_PROVIDER;
  - criar somente diretórios e recursos do projeto Compose devflow;
  - manter segredos em $DEVFLOW_ENV_FILE com permissão 600;
  - iniciar o banco, executar migrations reais e então subir a aplicação;
  - validar healthchecks HTTP e HTTPS;
  - publicar frontend/API somente em loopback no provider host-nginx;
  - preservar Compose, configuração, redes, certificados e containers de terceiros;
  - modificar somente estes recursos do provider: $(provider_resources).
EOF
[[ "$MODE" == dry-run ]] && { log INFO 'Dry-run concluído sem alterações.'; exit 0; }

require_root
if [[ "${DEVFLOW_BOOTSTRAP_CONFIRMED:-false}" == true ]]; then
  log INFO 'Confirmação explícita recebida pelo bootstrap público.'
else
  DEVFLOW_ASSUME_YES=false
  confirm_exact 'INSTALAR DEVFLOW' 'Autoriza a instalação inicial no host de homologação?'
fi

install -d -m 0750 "$DEVFLOW_INSTALL_ROOT" "$DEVFLOW_INSTALL_ROOT/releases" \
  "$DEVFLOW_CONFIG_ROOT" "$DEVFLOW_CONFIG_ROOT/proxy" "$DEVFLOW_DATA_ROOT" "$DEVFLOW_STATE_ROOT" "$DEVFLOW_INSTALL_ROOT/backups" \
  "$DEVFLOW_INSTALL_ROOT/backups/proxy" "$DEVFLOW_CONFIG_ROOT/nginx" \
  "$DEVFLOW_LOG_ROOT" "$DEVFLOW_INSTALL_ROOT/storage/uploads" "$DEVFLOW_INSTALL_ROOT/storage/acme" "$DEVFLOW_DATA_ROOT/postgres"
INSTALL_LOG="$DEVFLOW_LOG_ROOT/install-$(date -u +%Y%m%dT%H%M%SZ).log"
touch "$INSTALL_LOG"
chmod 0640 "$INSTALL_LOG"
log INFO "Log sanitizado: $INSTALL_LOG" | tee -a "$INSTALL_LOG"
PROVIDER_APPLIED=false

installation_failed() {
  local exit_code=$?
  trap - ERR
  if [[ -r "$DEVFLOW_ENV_FILE" ]]; then
    DEVFLOW_APP_ROOT="$DEVFLOW_INSTALL_ROOT/app.candidate"
    load_devflow_env || true
    compose_files
    "${DEVFLOW_COMPOSE[@]}" down --remove-orphans >/dev/null 2>&1 || true
    if [[ "$PROVIDER_APPLIED" == true ]]; then
      provider_uninstall >/dev/null 2>&1 || true
      if [[ "${CERTIFICATE_EXISTED_BEFORE:-true}" == false ]]; then
        certbot delete --cert-name "$DOMAIN" --non-interactive >/dev/null 2>&1 || true
      fi
    fi
    remove_devflow_edge_network_if_unused || true
  fi
  rm -f -- "$DEVFLOW_INSTALL_ROOT/app.candidate"
  write_install_report failure || true
  log ERROR "A operação falhou (código $exit_code). Os dados existentes foram preservados; consulte $INSTALL_LOG." \
    | tee -a "$INSTALL_LOG" >&2
  exit "$exit_code"
}
trap installation_failed ERR

install_docker_official() {
  log INFO 'Instalando Docker Engine pelo repositório oficial.' | tee -a "$INSTALL_LOG"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/$DEVFLOW_DISTRO/gpg" \
    | gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/%s %s stable\n' \
    "$DEVFLOW_ARCH" "$DEVFLOW_DISTRO" "$DEVFLOW_CODENAME" > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
}

[[ "$docker_state" == present ]] || install_docker_official
docker version >/dev/null 2>&1 || die 'Docker foi instalado, mas o daemon não responde.'
if ! docker compose version >/dev/null 2>&1; then
  apt-get update
  if apt-cache show docker-compose-plugin >/dev/null 2>&1; then
    apt-get install -y docker-compose-plugin
  elif apt-cache show docker-compose-v2 >/dev/null 2>&1; then
    apt-get install -y docker-compose-v2
  else
    die 'Docker Compose v2 não está disponível nos repositórios configurados.'
  fi
fi
docker compose version >/dev/null 2>&1 || die 'Docker Compose v2 indisponível após instalação.'
installed_docker_version="$(docker version --format '{{.Server.Version}}')"
installed_compose_version="$(docker compose version --short | sed 's/^v//')"
version_at_least "$installed_docker_version" 24.0 || die "Docker instalado incompatível: $installed_docker_version."
version_at_least "$installed_compose_version" 2.20 || die "Compose instalado incompatível: $installed_compose_version."

export DEBIAN_FRONTEND=noninteractive
packages=(certbot openssl python3)
missing_packages=()
for package in "${packages[@]}"; do
  dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q 'install ok installed' || missing_packages+=("$package")
done
if [[ ${#missing_packages[@]} -gt 0 ]]; then
  apt-get update
  apt-get install -y "${missing_packages[@]}"
fi
provider_prepare "$DOMAIN" "$HTTP_PORT" "$API_PORT"
provider_install

if [[ -e "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]]; then
  [[ -r "/etc/letsencrypt/live/$DOMAIN/privkey.pem" ]] || die 'Certificado existente sem chave privada correspondente.'
  openssl x509 -in "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" -noout -checkhost "$DOMAIN" >/dev/null 2>&1 \
    || die 'O certificado existente não corresponde ao domínio DevFlow.'
fi

[[ -z "$(git -C "$SOURCE_DIR" status --porcelain 2>/dev/null || true)" ]] \
  || die 'O checkout de origem possui alterações locais; a release não seria reproduzível.'
[[ "$(git -C "$SOURCE_DIR" branch --show-current 2>/dev/null || true)" == main ]] \
  || die 'A instalação inicial aceita somente a branch main.'
source_remote="$(git -C "$SOURCE_DIR" remote get-url origin 2>/dev/null || true)"
[[ "$source_remote" =~ ^(https://github\.com/|git@github\.com:)trinityrrocha/DevFlow(\.git)?$ ]] \
  || die 'O remote origin deve pertencer exatamente a trinityrrocha/DevFlow.'
public_remote='https://github.com/trinityrrocha/DevFlow.git'
[[ "$(tr -d '\r\n' < "$SOURCE_DIR/VERSION")" == "$DEVFLOW_RELEASE_VERSION" ]] \
  || die 'VERSION diverge da versão carregada pelo instalador.'
release_sha="$(git -C "$SOURCE_DIR" rev-parse --verify HEAD 2>/dev/null || true)"
[[ "$release_sha" =~ ^[0-9a-f]{40}$ ]] || die 'A origem deve ser um checkout Git publicado.'
[[ "$(git -C "$SOURCE_DIR" rev-parse refs/remotes/origin/main 2>/dev/null || true)" == "$release_sha" ]] \
  || die 'O commit local deve corresponder exatamente a origin/main antes da instalação.'
release_dir="$DEVFLOW_INSTALL_ROOT/releases/$release_sha"
if [[ ! -d "$release_dir" ]]; then
  install -d -m 0750 "$release_dir"
  git -C "$SOURCE_DIR" archive HEAD | tar -x -C "$release_dir"
  printf '%s\n' "$release_sha" > "$release_dir/.devflow-release"
  chmod 0644 "$release_dir/.devflow-release"
else
  [[ "$(cat "$release_dir/.devflow-release" 2>/dev/null || true)" == "$release_sha" ]] \
    || die 'Diretório de release existente sem identidade DevFlow comprovada.'
fi

operational_source_dir="$DEVFLOW_INSTALL_ROOT/source"
if [[ ! -e "$operational_source_dir" ]]; then
  GIT_TERMINAL_PROMPT=0 git clone --no-local --branch main --single-branch \
    "$SOURCE_DIR" "$operational_source_dir"
  git -C "$operational_source_dir" remote set-url origin "$public_remote"
  git -C "$operational_source_dir" config --local core.hooksPath /dev/null
else
  [[ -d "$operational_source_dir/.git" ]] || die 'Checkout operacional existente não é um repositório Git.'
  [[ "$(git -C "$operational_source_dir" remote get-url origin 2>/dev/null || true)" == "$public_remote" ]] \
    || die 'Checkout operacional existente possui remote divergente.'
  [[ "$(git -C "$operational_source_dir" config --local --get core.hooksPath 2>/dev/null || true)" == /dev/null ]] \
    || die 'Checkout operacional existente não possui hooks desabilitados.'
  [[ "$(git -C "$operational_source_dir" branch --show-current)" == main ]] \
    || die 'Checkout operacional existente não está na branch main.'
  [[ -z "$(git -C "$operational_source_dir" status --porcelain)" ]] \
    || die 'Checkout operacional existente possui alterações; a retomada foi bloqueada.'
  operational_sha="$(git -C "$operational_source_dir" rev-parse HEAD 2>/dev/null || true)"
  if [[ "$operational_sha" != "$release_sha" ]]; then
    GIT_TERMINAL_PROMPT=0 git -C "$operational_source_dir" fetch origin main
    [[ "$(git -C "$operational_source_dir" rev-parse origin/main 2>/dev/null || true)" == "$release_sha" ]] \
      || die 'origin/main do checkout operacional diverge da release verificada.'
    git -C "$operational_source_dir" merge-base --is-ancestor "$operational_sha" "$release_sha" \
      || die 'Retomada recusada: o checkout operacional não permite fast-forward seguro.'
    git -C "$operational_source_dir" merge --ff-only "$release_sha"
    [[ -z "$(git -C "$operational_source_dir" status --porcelain)" ]] \
      || die 'Checkout operacional ficou inconsistente após a retomada.'
  fi
fi
chown -R root:root "$operational_source_dir"
chmod -R go-w "$operational_source_dir"
DEVFLOW_RELEASE_COMMIT="$release_sha"
DEVFLOW_RELEASE_REF=main
DEVFLOW_REPOSITORY_URL="$public_remote"
DEVFLOW_UPDATE_CHANNEL=main
export DEVFLOW_RELEASE_COMMIT DEVFLOW_RELEASE_REF DEVFLOW_REPOSITORY_URL DEVFLOW_UPDATE_CHANNEL

if [[ ! -f "$DEVFLOW_ENV_FILE" ]]; then
  db_password="$(openssl rand -base64 48 | tr -d '\n')"
  jwt_secret="$(openssl rand -hex 48)"
  bootstrap_token="$(openssl rand -base64 48 | tr -d '\n')"
  encryption_key="$(openssl rand -base64 32 | tr -d '\n')"
  backup_passphrase="$(openssl rand -base64 64 | tr -d '\n')"
  cat > "$DEVFLOW_ENV_FILE" <<EOF
# DevFlow runtime configuration — generated locally, never commit
DEVFLOW_VERSION=$DEVFLOW_VERSION
DEVFLOW_SOURCE_DIR=$operational_source_dir
NODE_ENV=production
PORT=3000
TZ=America/Sao_Paulo
APP_ORIGIN=https://$DOMAIN
VITE_API_URL=/api
DEVFLOW_DOMAIN=$DOMAIN
DEVFLOW_INFRASTRUCTURE_PROVIDER=$INFRASTRUCTURE_PROVIDER
DEVFLOW_PROXY_MODE=$PROXY_MODE
DEVFLOW_SHARED_PROXY_ADAPTER=$SHARED_PROXY_ADAPTER
LETSENCRYPT_EMAIL=$LETSENCRYPT_EMAIL
DEVFLOW_ENV_FILE=$DEVFLOW_ENV_FILE
DEVFLOW_BIND_ADDRESS=127.0.0.1
DEVFLOW_HTTP_PORT=$HTTP_PORT
DEVFLOW_API_PORT=$API_PORT
DEVFLOW_DB_DATA_PATH=$DEVFLOW_DATA_ROOT/postgres
DEVFLOW_UPLOADS_PATH=$DEVFLOW_INSTALL_ROOT/storage/uploads
DB_HOST=db
DB_PORT=5432
DB_USER=devflow_user
DB_PASSWORD=$db_password
DB_NAME=devflow_db
JWT_SECRET=$jwt_secret
ADMIN_BOOTSTRAP_TOKEN=$bootstrap_token
CONFIG_ENCRYPTION_KEY=$encryption_key
SUPER_ADMIN_EMAIL=$SUPER_ADMIN_EMAIL
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
BACKUP_RETENTION_DAYS=30
BACKUP_MAX_RESTORE_MB=4096
BACKUP_PASSPHRASE_FILE=$DEVFLOW_CONFIG_ROOT/backup.passphrase
LOG_LEVEL=info
DEVFLOW_LOG_ROOT=$DEVFLOW_LOG_ROOT
METRICS_REFRESH_SECONDS=60
UPDATE_CHANNEL=main
EOF
  chmod 0600 "$DEVFLOW_ENV_FILE"
  printf '%s\n' "$backup_passphrase" > "$DEVFLOW_CONFIG_ROOT/backup.passphrase"
  printf '%s\n' "$bootstrap_token" > "$DEVFLOW_CONFIG_ROOT/bootstrap-token"
  chmod 0600 "$DEVFLOW_CONFIG_ROOT/backup.passphrase" "$DEVFLOW_CONFIG_ROOT/bootstrap-token"
  unset db_password jwt_secret bootstrap_token encryption_key backup_passphrase
fi

ln -sfn "$release_dir" "$DEVFLOW_INSTALL_ROOT/app.candidate"
DEVFLOW_APP_ROOT="$DEVFLOW_INSTALL_ROOT/app.candidate"
load_devflow_env
validate_runtime_paths
[[ "${DEVFLOW_SHARED_PROXY_ADAPTER:-none}" == "$SHARED_PROXY_ADAPTER" ]] \
  || die 'Adaptador compartilhado diverge da configuração gerada.'
DEVFLOW_VERSION="$DEVFLOW_RELEASE_VERSION"
export DEVFLOW_VERSION
ensure_devflow_edge_network
compose_files
"${DEVFLOW_COMPOSE[@]}" config --quiet
"${DEVFLOW_COMPOSE[@]}" build backend frontend
read -r db_uid db_gid < <(docker run --rm --entrypoint sh postgres:16-alpine -c 'printf "%s %s\n" "$(id -u postgres)" "$(id -g postgres)"')
backend_image="$("${DEVFLOW_COMPOSE[@]}" images -q backend)"
[[ -n "$backend_image" ]] || die 'Não foi possível identificar a imagem do backend.'
read -r backend_uid backend_gid < <(docker run --rm --entrypoint sh "$backend_image" -c 'printf "%s %s\n" "$(id -u devflow)" "$(id -g devflow)"')
[[ "$db_uid" =~ ^[0-9]+$ && "$db_gid" =~ ^[0-9]+$ && "$backend_uid" =~ ^[0-9]+$ && "$backend_gid" =~ ^[0-9]+$ ]] \
  || die 'Não foi possível validar os usuários não-root dos containers.'
chown "$db_uid:$db_gid" "$DEVFLOW_DATA_ROOT/postgres"
chown "$backend_uid:$backend_gid" "$DEVFLOW_INSTALL_ROOT/storage/uploads"
chmod 0750 "$DEVFLOW_DATA_ROOT/postgres" "$DEVFLOW_INSTALL_ROOT/storage/uploads"
"${DEVFLOW_COMPOSE[@]}" up -d db --wait
"${DEVFLOW_COMPOSE[@]}" exec -T db sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
"${DEVFLOW_COMPOSE[@]}" run --rm --no-deps backend node scripts/migrate.js
DEVFLOW_MIGRATION_VERSION="$("${DEVFLOW_COMPOSE[@]}" exec -T db sh -c \
  'psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT version FROM schema_migrations ORDER BY applied_at DESC LIMIT 1"')"
[[ -n "$DEVFLOW_MIGRATION_VERSION" ]] || die 'PostgreSQL não confirmou a migration aplicada.'

CERTIFICATE_EXISTED_BEFORE=false
[[ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]] && CERTIFICATE_EXISTED_BEFORE=true

"${DEVFLOW_COMPOSE[@]}" up -d backend frontend --wait
PROVIDER_APPLIED=true
provider_activate "$release_dir" "$DOMAIN" "$LETSENCRYPT_EMAIL" "$HTTP_PORT" "$API_PORT"
provider_validate

curl --fail --silent --show-error --max-time 20 "https://$DOMAIN/api/health" >/dev/null
curl --fail --silent --show-error --max-time 20 "https://$DOMAIN/" >/dev/null
set_managed_env_value DEVFLOW_VERSION "$DEVFLOW_RELEASE_VERSION"
ln -sfn "$release_dir" "$DEVFLOW_INSTALL_ROOT/app"
rm -f "$DEVFLOW_INSTALL_ROOT/app.candidate"

install -m 0644 "$release_dir/scripts/systemd/devflow-backup.service" /etc/systemd/system/devflow-backup.service
install -m 0644 "$release_dir/scripts/systemd/devflow-backup.timer" /etc/systemd/system/devflow-backup.timer
systemctl daemon-reload
systemctl enable --now devflow-backup.timer
provider_state_write "$INFRASTRUCTURE_PROVIDER" "$DOMAIN" "$HTTP_PORT" "$API_PORT"
write_install_report success
trap - ERR

log INFO "DevFlow $DEVFLOW_VERSION instalado para homologação em https://$DOMAIN" | tee -a "$INSTALL_LOG"
log INFO "Bootstrap: use o e-mail configurado e o token protegido em $DEVFLOW_CONFIG_ROOT/bootstrap-token." | tee -a "$INSTALL_LOG"
log WARN 'O DevFlow ainda não está aprovado para produção.' | tee -a "$INSTALL_LOG"
