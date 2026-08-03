#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

OUTPUT_EMITTED=false
BOOTSTRAP_LOG=
STARTUP_STAGE=00-bootstrap
REQUESTED_MODE=unparsed
RECOGNIZED_ARGUMENTS=()
export GIT_OPTIONAL_LOCKS=0

bootstrap_timestamp() {
  date -u +'%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || printf '%s\n' unknown-time
}

bootstrap_emit() {
  local level="${1:-ERROR}" message="${2:-Erro interno do instalador.}" line
  line="$(bootstrap_timestamp) [$level] $message"
  OUTPUT_EMITTED=true
  printf '%s\n' "$line" >&2
  if [[ -n "${BOOTSTRAP_LOG:-}" && -f "$BOOTSTRAP_LOG" && ! -L "$BOOTSTRAP_LOG" ]]; then
    printf '%s\n' "$line" >> "$BOOTSTRAP_LOG" 2>/dev/null || true
  fi
}

early_error_handler() {
  local exit_code="$?" line="${BASH_LINENO[0]:-${LINENO}}"
  local source="${BASH_SOURCE[1]:-${BASH_SOURCE[0]}}" function_name="${FUNCNAME[1]:-main}"
  trap - ERR
  bootstrap_emit ERROR "Falha inicial: script=${source##*/} linha=$line função=$function_name código=$exit_code versão=${DEVFLOW_RELEASE_VERSION:-unknown} commit=${release_sha:-unknown} modo=${REQUESTED_MODE:-unparsed} etapa=${STARTUP_STAGE:-00-bootstrap}."
  return "$exit_code"
}

ensure_diagnostic_on_exit() {
  local exit_code="$?"
  if [[ "$exit_code" -ne 0 && "${OUTPUT_EMITTED:-false}" != true ]]; then
    printf '%s\n' \
      'Erro interno do instalador: encerramento sem diagnóstico funcional.' \
      "Consulte o log inicial: ${BOOTSTRAP_LOG:-indisponível}" >&2
  fi
  return "$exit_code"
}

trap early_error_handler ERR
trap ensure_diagnostic_on_exit EXIT

if BOOTSTRAP_LOG="$(mktemp "${TMPDIR:-/tmp}/devflow-install-bootstrap.XXXXXX.log" 2>/dev/null)"; then
  chmod 0600 "$BOOTSTRAP_LOG" 2>/dev/null || true
fi
bootstrap_emit INFO "Inicialização protegida do instalador; log inicial=${BOOTSTRAP_LOG:-indisponível}."

STARTUP_STAGE=01-resolve-source
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
STARTUP_STAGE=02-load-libraries
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/proxy-config.sh
. "$SCRIPT_DIR/lib/proxy-config.sh"
# shellcheck source=lib/fullpassword-proxy.sh
. "$SCRIPT_DIR/lib/fullpassword-proxy.sh"
# shellcheck source=providers/provider-contract.sh
. "$SCRIPT_DIR/providers/provider-contract.sh"
# shellcheck source=lib/compose-images.sh
. "$SCRIPT_DIR/lib/compose-images.sh"
# shellcheck source=lib/install-transaction.sh
. "$SCRIPT_DIR/lib/install-transaction.sh"
# shellcheck source=lib/install-startup.sh
. "$SCRIPT_DIR/lib/install-startup.sh"

log() {
  local level="$1" line
  shift
  line="$(bootstrap_timestamp) [$level] $*"
  OUTPUT_EMITTED=true
  printf '%s\n' "$line"
  if [[ -n "${BOOTSTRAP_LOG:-}" && -f "$BOOTSTRAP_LOG" && ! -L "$BOOTSTRAP_LOG" ]]; then
    printf '%s\n' "$line" >> "$BOOTSTRAP_LOG" 2>/dev/null || true
  fi
}

promote_bootstrap_log() {
  local destination="$1" line
  [[ -n "${BOOTSTRAP_LOG:-}" && -f "$BOOTSTRAP_LOG" && ! -L "$BOOTSTRAP_LOG" ]] || return 0
  while IFS= read -r line; do
    printf '%s\n' "$line" >> "$destination"
  done < "$BOOTSTRAP_LOG"
  rm -f -- "$BOOTSTRAP_LOG"
  BOOTSTRAP_LOG=
}

STARTUP_STAGE=03-parse-arguments

MODE=check
MODE_EXPLICIT=false
INSTALL_SCOPE=complete
INSTALL_SCOPE_EXPLICIT=false
RESUME_REQUESTED=false
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
FRONTEND_LOOPBACK_PORT_AVAILABLE=unknown
BACKEND_LOOPBACK_PORT_AVAILABLE=unknown
POSTGRES_PUBLIC_PORT_EXPOSED=false
EXTERNAL_PUBLICATION_BLOCKED=false
PARTIAL_INSTALLATION_DETECTED=false
RESUME_CHECKOUT_VALID=false
RESUME_CONFIGURATION_VALID=false
PARTIAL_CONFIGURATION_PRESENT=false
RESUME_TRANSACTION_VALID=false
PARTIAL_INSTALLATION_VERSION=unknown
PARTIAL_INSTALLATION_COMMIT=unknown
PARTIAL_INSTALLATION_STAGE=unknown
BACKEND_IMAGE_EXPECTED=unknown
BACKEND_IMAGE_RESOLVED=unknown
BACKEND_IMAGE_PRESENT=false
BACKEND_BUILD_REQUIRED=true
FRONTEND_IMAGE_EXPECTED=unknown
FRONTEND_IMAGE_RESOLVED=unknown
FRONTEND_IMAGE_PRESENT=false
FRONTEND_BUILD_REQUIRED=true
POSTGRES_IMAGE_EXPECTED=unknown
POSTGRES_IMAGE_RESOLVED=unknown
POSTGRES_IMAGE_PRESENT=false
POSTGRES_PULL_REQUIRED=true
IMAGE_RESOLUTION_STATUS=pending-docker-install
SOURCE_READY=false
CONFIGURATION_READY=false
IMAGES_READY=false
DATABASE_CONTAINER_READY=false
DATABASE_HEALTHY=false
MIGRATIONS_READY=false
BACKEND_READY=false
FRONTEND_READY=false
SUPER_ADMIN_READY=false
INSTALLATION_STATE_READY=false
SOURCE_CLONE_PRESERVED=false
SOURCE_CLONE_SIGNATURE_BEFORE=
LEGACY_PARTIAL_INSTALLATION_DETECTED=false
TRANSACTION_STATE_PRESENT=false
TRANSACTION_STATE_CORRUPT=false
TRANSACTION_STATE_RECONSTRUCTED=false
TRANSACTION_STATE_RECONSTRUCTION_PLANNED=false
CAN_RESUME=false
RESUME_FROM_STAGE=01-preflight
NGINX_CONFIG=/etc/nginx/conf.d/devflow.conf
MANAGED_MARKER='# Managed by DevFlow installer. Do not merge with another application.'

usage() {
  OUTPUT_EMITTED=true
  printf 'DevFlow %s — instalador inicial para homologação\n\n' "$DEVFLOW_RELEASE_VERSION"
  cat <<'EOF'
Uso:
  ./install.sh --check
  ./install.sh --dry-run [--provider host-nginx|isolated-nginx] --domain HOST \
    --letsencrypt-email EMAIL --super-admin-email EMAIL
  ./install.sh --dry-run --install-scope internal --super-admin-email EMAIL
  sudo ./install.sh --install [--provider host-nginx|isolated-nginx] --domain HOST \
    --letsencrypt-email EMAIL --super-admin-email EMAIL
  sudo ./install.sh --install-internal [--provider host-nginx] --super-admin-email EMAIL
  sudo ./install.sh --resume --super-admin-email EMAIL
  sudo ./install.sh --diagnose-startup
  sudo ./install.sh --cleanup-failed-install

Modos:
  --check       diagnóstico somente leitura (padrão)
  --dry-run     valida e apresenta o plano; não altera o host
  --install     primeira instalação, com confirmação explícita
  --install-internal instala somente aplicação e serviços em loopback
  --resume      retoma uma instalação interna incompleta e compatível
  --diagnose-startup diagnóstico sanitizado da inicialização; não altera o host
  --cleanup-failed-install informa o procedimento seguro; não remove dados automaticamente

Opções:
  --provider PROVIDER       host-nginx (padrão), isolated-nginx ou legado explícito
  --proxy-mode MODE         alias legado: shared=host-nginx, isolated=isolated-nginx
  --domain HOST             domínio exclusivo do DevFlow
  --letsencrypt-email EMAIL contato do Let's Encrypt
  --super-admin-email EMAIL identidade permitida no bootstrap
  --http-port PORT          frontend em loopback no modo shared (padrão 18080)
  --api-port PORT           backend em loopback no modo shared (padrão 13000)
  --install-scope SCOPE     complete (padrão) ou internal
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

argument_error() {
  log ERROR "Erro: $1"
  log ERROR 'Use --help para consultar as opções.'
  exit 2
}

require_option_value() {
  local option="$1" value="${2:-}"
  [[ -n "$value" && "$value" != --* ]] || argument_error "o argumento $option exige um valor."
}

set_mode() {
  [[ "$MODE_EXPLICIT" == false ]] || die 'Informe somente um modo de execução.'
  MODE="$1"
  MODE_EXPLICIT=true
}

set_install_scope() {
  [[ "$INSTALL_SCOPE_EXPLICIT" == false ]] || die 'Informe --install-scope somente uma vez.'
  case "$1" in internal|complete) INSTALL_SCOPE="$1" ;; *) die 'Informe --install-scope internal ou complete.' ;; esac
  INSTALL_SCOPE_EXPLICIT=true
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) RECOGNIZED_ARGUMENTS+=(--check); REQUESTED_MODE=check; set_mode check; shift ;;
    --dry-run) RECOGNIZED_ARGUMENTS+=(--dry-run); REQUESTED_MODE=dry-run; set_mode dry-run; shift ;;
    --install) RECOGNIZED_ARGUMENTS+=(--install); REQUESTED_MODE=install; set_mode install; shift ;;
    --install-internal) RECOGNIZED_ARGUMENTS+=(--install-internal); REQUESTED_MODE=install-internal; set_mode install; set_install_scope internal; shift ;;
    --resume) RECOGNIZED_ARGUMENTS+=(--resume); REQUESTED_MODE=resume; set_mode install; set_install_scope internal; RESUME_REQUESTED=true; shift ;;
    --diagnose-startup) RECOGNIZED_ARGUMENTS+=(--diagnose-startup); REQUESTED_MODE=diagnose-startup; set_mode diagnose-startup; shift ;;
    --cleanup-failed-install) RECOGNIZED_ARGUMENTS+=(--cleanup-failed-install); REQUESTED_MODE=cleanup-failed-install; set_mode cleanup-failed-install; shift ;;
    --install-scope) require_option_value "$1" "${2:-}"; RECOGNIZED_ARGUMENTS+=(--install-scope); set_install_scope "$2"; shift 2 ;;
    --provider) require_option_value "$1" "${2:-}"; RECOGNIZED_ARGUMENTS+=(--provider); INFRASTRUCTURE_PROVIDER="$2"; PROVIDER_EXPLICIT=true; shift 2 ;;
    --proxy-mode)
      require_option_value "$1" "${2:-}"
      RECOGNIZED_ARGUMENTS+=(--proxy-mode)
      case "${2:-}" in
        shared) INFRASTRUCTURE_PROVIDER=host-nginx ;;
        isolated) INFRASTRUCTURE_PROVIDER=isolated-nginx ;;
        *) die 'Informe --proxy-mode isolated ou shared.' ;;
      esac
      PROVIDER_EXPLICIT=true
      shift 2
      ;;
    --domain) require_option_value "$1" "${2:-}"; RECOGNIZED_ARGUMENTS+=(--domain); DOMAIN="$2"; shift 2 ;;
    --letsencrypt-email|--email) require_option_value "$1" "${2:-}"; RECOGNIZED_ARGUMENTS+=(--letsencrypt-email); LETSENCRYPT_EMAIL="$2"; shift 2 ;;
    --super-admin-email|--super-admin) require_option_value "$1" "${2:-}"; RECOGNIZED_ARGUMENTS+=(--super-admin-email); SUPER_ADMIN_EMAIL="$2"; shift 2 ;;
    --http-port) require_option_value "$1" "${2:-}"; RECOGNIZED_ARGUMENTS+=(--http-port); HTTP_PORT="$2"; shift 2 ;;
    --api-port) require_option_value "$1" "${2:-}"; RECOGNIZED_ARGUMENTS+=(--api-port); API_PORT="$2"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) argument_error "argumento desconhecido: $1" ;;
  esac
done

[[ "$REQUESTED_MODE" != unparsed ]] || REQUESTED_MODE="$MODE"
log INFO "Argumentos reconhecidos: ${RECOGNIZED_ARGUMENTS[*]:-nenhum}; modo=$REQUESTED_MODE; etapa=$STARTUP_STAGE."

STARTUP_STAGE=04-platform
require_linux
detect_platform
SS_PRESENT=false
command -v ss >/dev/null 2>&1 && SS_PRESENT=true
if [[ "$MODE" == diagnose-startup ]]; then
  printf '%s\n' \
    "version=$DEVFLOW_RELEASE_VERSION" \
    'libraries_found=true' \
    'libraries_loaded=true' \
    "arguments_recognized=${RECOGNIZED_ARGUMENTS[*]:-none}" \
    "mode=$MODE" \
    "source_directory=$SOURCE_DIR" \
    "install_directory=$DEVFLOW_INSTALL_ROOT" \
    "effective_user=$(id -u)" \
    "ss_present=$SS_PRESENT" \
    "git_present=$(command -v git >/dev/null 2>&1 && printf true || printf false)" \
    "docker_present=$(command -v docker >/dev/null 2>&1 && printf true || printf false)" \
    "compose_present=$(docker compose version >/dev/null 2>&1 && printf true || printf false)" \
    "startup_stage=$STARTUP_STAGE" \
    'changes_applied=false'
  OUTPUT_EMITTED=true
  exit 0
fi
if [[ "$MODE" == cleanup-failed-install ]]; then
  log ERROR 'A limpeza automática da tentativa parcial não está habilitada; checkout, configuração, dados, logs e imagens foram preservados.'
  log ERROR 'Use scripts/uninstall.sh somente após concluir um backup e revisar exatamente os recursos DevFlow.'
  exit 2
fi
[[ "$SS_PRESENT" == true ]] || die 'ss (iproute2) é obrigatório para comprovar a disponibilidade das portas.'
STARTUP_STAGE=05-source-validation
validate_safe_absolute_path "$DEVFLOW_INSTALL_ROOT" 'Diretório de instalação'
[[ "$DEVFLOW_INSTALL_ROOT" == /opt/devflow ]] || die 'Esta versão suporta somente o diretório /opt/devflow.'
validate_safe_absolute_path "$SOURCE_DIR" 'Checkout operacional'
command -v git >/dev/null 2>&1 || die 'Git é obrigatório para validar a origem publicada.'
source_clone_signature() {
  local index="$SOURCE_DIR/.git/index" metadata digest
  [[ -f "$index" && ! -L "$index" ]] || return 1
  metadata="$(stat -c '%u:%g:%a:%s:%Y' "$index" 2>/dev/null)" || return 1
  digest="$(git hash-object "$index" 2>/dev/null)" || return 1
  printf '%s:%s\n' "$metadata" "$digest"
}
SOURCE_CLONE_SIGNATURE_BEFORE="$(source_clone_signature)" \
  || die 'Não foi possível registrar a integridade read-only do clone de origem.'
public_remote='https://github.com/trinityrrocha/DevFlow.git'
source_ref="${DEVFLOW_BOOTSTRAP_REF:-main}"
devflow_ref_is_valid "$source_ref" || die 'Referência de instalação inválida; use main ou vSEMVER.'
release_sha="$(git -C "$SOURCE_DIR" rev-parse --verify HEAD 2>/dev/null || true)"
[[ "$release_sha" =~ ^[0-9a-f]{40}$ ]] || die 'A origem deve ser um checkout Git publicado.'
log INFO "Contexto validado: versão=$DEVFLOW_RELEASE_VERSION commit=$release_sha modo=$REQUESTED_MODE etapa=$STARTUP_STAGE."
devflow_validate_checkout_identity "$SOURCE_DIR" "$source_ref" "$release_sha" \
  || die 'Origem, referência, commit ou limpeza do checkout de instalação diverge do repositório canônico.'
if [[ "$source_ref" == main ]]; then
  published_sha="$(GIT_TERMINAL_PROMPT=0 git -c http.followRedirects=false -C "$SOURCE_DIR" \
    ls-remote origin refs/heads/main | awk 'NR==1 {print $1}')"
else
  published_sha="$(GIT_TERMINAL_PROMPT=0 git -c http.followRedirects=false -C "$SOURCE_DIR" \
    ls-remote origin "refs/tags/$source_ref^{}" | awk 'NR==1 {print $1}')"
  [[ -n "$published_sha" ]] || published_sha="$(GIT_TERMINAL_PROMPT=0 git -c http.followRedirects=false -C "$SOURCE_DIR" \
    ls-remote origin "refs/tags/$source_ref" | awk 'NR==1 {print $1}')"
fi

STARTUP_STAGE=06-partial-detection
detect_partial_installation
[[ "$published_sha" == "$release_sha" ]] \
  || die 'O commit local não corresponde exatamente à referência publicada solicitada.'
detected_source_version="$(devflow_validate_checkout_version_consistency "$SOURCE_DIR")" \
  || die 'version_consistency=false; checkout de instalação possui versões divergentes ou inválidas.'
[[ "$detected_source_version" == "$DEVFLOW_RELEASE_VERSION" ]] \
  || die 'VERSION diverge da versão carregada pelo instalador.'
[[ "$source_ref" == main || "$source_ref" == "v$detected_source_version" ]] \
  || die 'A tag solicitada diverge da versão validada no checkout.'
check_capacity /
STARTUP_STAGE=07-preflight
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
    if load_installation_state; then
      INSTALL_SCOPE="$DEVFLOW_INSTALLATION_STATE_SCOPE"
    fi
    [[ "$PROXY_MODE" == isolated || "$PROXY_MODE" == shared ]] || die 'DEVFLOW_PROXY_MODE inválido na configuração.'
    [[ -z "$DOMAIN" ]] || validate_domain "$DOMAIN"
    [[ -z "${LETSENCRYPT_EMAIL:-}" ]] || validate_email "$LETSENCRYPT_EMAIL"
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
  if [[ "$INSTALL_SCOPE" == internal && "$INFRASTRUCTURE_PROVIDER" != host-nginx ]]; then
    die 'A instalação interna utiliza somente o provider planejado host-nginx e portas loopback.'
  fi
  derive_legacy_proxy_settings "$INFRASTRUCTURE_PROVIDER"
  PROXY_MODE="$DEVFLOW_PROXY_MODE"
  SHARED_PROXY_ADAPTER="$DEVFLOW_SHARED_PROXY_ADAPTER"
  if [[ "$INSTALL_SCOPE" == complete ]]; then
    validate_domain "$DOMAIN"
    validate_email "$LETSENCRYPT_EMAIL"
  else
    [[ -z "$DOMAIN" ]] || validate_domain "$DOMAIN"
    [[ -z "$LETSENCRYPT_EMAIL" ]] || validate_email "$LETSENCRYPT_EMAIL"
  fi
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
elif [[ "$INSTALL_SCOPE" == internal ]]; then
  provider_detect
  DEVFLOW_PROVIDER_STATUS=planned-internal-only
elif [[ "$INFRASTRUCTURE_PROVIDER" != legacy-docker-nginx ]]; then
  provider_dry_run || provider_status=$?
  if [[ "$provider_status" -eq 4 ]]; then
    if [[ "$MODE" == dry-run ]]; then
      EXTERNAL_PUBLICATION_BLOCKED=true
      cat <<'EOF'
dry_run_status=internal-ready-external-blocked
reason=controlled-proxy-migration-required
changes_applied=false
internal_installation_ready=true
external_publication_ready=false

Instalação interna: pronta.
Publicação externa: bloqueada até migração ou liberação das portas 80/443.

Para instalar somente em loopback, execute:
  sudo ./install.sh --install-internal --super-admin-email EMAIL

Para diagnosticar a futura migração, execute somente:
  sudo ./scripts/migrate-proxy-to-host-nginx.sh --check
EOF
    else
      [[ -t 0 ]] || die 'A publicação está bloqueada. Use explicitamente --install-internal ou cancele.'
      cat <<EOF
As portas 80 e 443 estão ocupadas pelo proxy conhecido:

  ${DEVFLOW_PUBLIC_PROXY_CONTAINER:-fullpassword_nginx}

O DevFlow pode ser instalado internamente sem alterar esse proxy.

Opções:

  1 - Instalar internamente para homologação
  2 - Cancelar
  3 - Exibir instruções da futura migração de proxy
EOF
      read -r -p 'Escolha [1/2/3]: ' scope_choice
      case "$scope_choice" in
        1) INSTALL_SCOPE=internal; DEVFLOW_PROVIDER_STATUS=planned-internal-only ;;
        2) die 'Instalação cancelada sem alterações.' ;;
        3)
          printf '%s\n' 'Execute somente: sudo ./scripts/migrate-proxy-to-host-nginx.sh --check'
          exit 0
          ;;
        *) die 'Opção inválida; nenhuma alteração foi realizada.' ;;
      esac
    fi
  elif [[ "$provider_status" -eq 3 && "$MODE" == dry-run ]]; then
    cat <<EOF
dry_run_status=blocked
reason=privileged-port-owner-check-required
changes_applied=false

Repita somente o dry-run com sudo e os mesmos parametros.
EOF
    exit 3
  fi
  if [[ "$provider_status" -ne 0 && "$provider_status" -ne 4 ]]; then
    die 'A publicação externa foi bloqueada por segurança. A instalação interna exige --install-scope internal.'
  fi
fi

if [[ "$MODE" == install && -e "$DEVFLOW_INSTALL_ROOT/app" ]]; then
  die 'Uma instalação já existe. O instalador não atualiza sistemas; use scripts/update.sh.'
fi

if [[ "$PARTIAL_INSTALLATION_DETECTED" == true && "$MODE" != check ]]; then
  [[ "$TRANSACTION_STATE_CORRUPT" == false ]] \
    || die 'Estado transacional existente é inválido; a retomada foi bloqueada sem sobrescrevê-lo.'
  [[ "$RESUME_CHECKOUT_VALID" == true ]] \
    || die 'Instalação parcial encontrada, mas o checkout não é limpo, canônico ou fast-forward compatível.'
  if [[ "$PARTIAL_CONFIGURATION_PRESENT" == true && "$RESUME_CONFIGURATION_VALID" != true ]]; then
    die 'Instalação parcial contém configuração privada inválida ou com permissões inseguras.'
  fi
  if [[ "$MODE" == install && "$RESUME_REQUESTED" == false ]]; then
    [[ -t 0 ]] || die 'Instalação parcial encontrada. Use explicitamente --resume.'
    cat <<EOF
Foi encontrada uma instalação interna incompleta.

Versão: $PARTIAL_INSTALLATION_VERSION
Commit: $PARTIAL_INSTALLATION_COMMIT
Última etapa registrada: $PARTIAL_INSTALLATION_STAGE

Opções:
  1 - Retomar instalação
  2 - Reexecutar somente as validações
  3 - Cancelar
EOF
    read -r -p 'Escolha [1/2/3]: ' resume_choice
    case "$resume_choice" in
      1) RESUME_REQUESTED=true ;;
      2)
        printf '%s\n' 'Execute: sudo ./install.sh --dry-run --install-scope internal --super-admin-email EMAIL'
        exit 0
        ;;
      3) die 'Retomada cancelada sem alterações.' ;;
      *) die 'Opção inválida; nenhuma alteração foi realizada.' ;;
    esac
  fi
elif [[ "$RESUME_REQUESTED" == true ]]; then
  die 'Nenhuma instalação incompleta compatível foi encontrada para retomada.'
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

IMAGE_ARCHITECTURE_STATUS=pending-docker-install
COMPOSE_STRUCTURE_STATUS=pending-docker-install
if [[ "$MODE" != check ]]; then
  for required_file in database/migrations/001_initial_schema.sql backend/scripts/migrate.js \
    scripts/backup.sh scripts/verify-backup.sh scripts/restore.sh scripts/health.sh \
    scripts/resolve-compose-image.py scripts/lib/compose-images.sh scripts/lib/install-transaction.sh; do
    [[ -f "$SOURCE_DIR/$required_file" && ! -L "$SOURCE_DIR/$required_file" ]] \
      || die "Componente interno obrigatório ausente ou inválido: $required_file"
  done
  if [[ "$docker_state" == present && "$docker_version" != daemon-unavailable && "$compose_state" == present ]]; then
    for image in postgres:16-alpine node:22-alpine nginx:1.27-alpine; do
      docker manifest inspect "$image" 2>/dev/null \
        | grep -Fq "\"architecture\": \"$DEVFLOW_ARCH\"" \
        || die "A imagem $image não comprovou suporte a $DEVFLOW_ARCH."
    done
    IMAGE_ARCHITECTURE_STATUS=compatible
    DB_PASSWORD=validation-only JWT_SECRET=validation-only CONFIG_ENCRYPTION_KEY=validation-only \
      ADMIN_BOOTSTRAP_TOKEN=validation-only BACKUP_PASSPHRASE_FILE=/tmp/validation-only \
      DEVFLOW_DOMAIN="${DOMAIN:-internal.local}" DEVFLOW_ENV_FILE="$SOURCE_DIR/.env.example" \
      DEVFLOW_DB_DATA_PATH="$DEVFLOW_DATA_ROOT/postgres" \
      DEVFLOW_UPLOADS_PATH="$DEVFLOW_INSTALL_ROOT/storage/uploads" \
      docker compose -p devflow-validation --project-directory "$SOURCE_DIR" \
        -f "$SOURCE_DIR/docker-compose.yml" -f "$SOURCE_DIR/docker-compose.shared.yml" config --quiet
    COMPOSE_STRUCTURE_STATUS=valid
    if command -v python3 >/dev/null 2>&1; then
      DEVFLOW_COMPOSE=(docker compose --env-file "$SOURCE_DIR/.env.example" -p "$DEVFLOW_PROJECT" \
        --project-directory "$SOURCE_DIR" -f "$SOURCE_DIR/docker-compose.yml" -f "$SOURCE_DIR/docker-compose.shared.yml")
      for service in backend frontend db; do
        expected="$(compose_service_image_expected "$service")" \
          || die "O Compose não resolveu exatamente uma imagem para o serviço $service."
        resolved="$(normalize_image_reference "$expected")" \
          || die "O Compose retornou referência de imagem inválida para $service."
        case "$service" in
          backend)
            BACKEND_IMAGE_EXPECTED="$expected"; BACKEND_IMAGE_RESOLVED="$resolved"
            if docker image inspect "$resolved" >/dev/null 2>&1; then
              BACKEND_IMAGE_PRESENT=true
              compose_image_matches_release "$resolved" "$release_sha" "$DEVFLOW_RELEASE_VERSION" \
                && BACKEND_BUILD_REQUIRED=false
            fi
            ;;
          frontend)
            FRONTEND_IMAGE_EXPECTED="$expected"; FRONTEND_IMAGE_RESOLVED="$resolved"
            if docker image inspect "$resolved" >/dev/null 2>&1; then
              FRONTEND_IMAGE_PRESENT=true
              compose_image_matches_release "$resolved" "$release_sha" "$DEVFLOW_RELEASE_VERSION" \
                && FRONTEND_BUILD_REQUIRED=false
            fi
            ;;
          db)
            POSTGRES_IMAGE_EXPECTED="$expected"; POSTGRES_IMAGE_RESOLVED="$resolved"
            if docker image inspect "$resolved" >/dev/null 2>&1; then
              POSTGRES_IMAGE_PRESENT=true
              POSTGRES_PULL_REQUIRED=false
            fi
            ;;
        esac
      done
      if [[ "$BACKEND_BUILD_REQUIRED" == false && "$FRONTEND_BUILD_REQUIRED" == false \
        && "$POSTGRES_PULL_REQUIRED" == false ]]; then
        IMAGES_READY=true
      fi
      IMAGE_RESOLUTION_STATUS=validated
    else
      IMAGE_RESOLUTION_STATUS=pending-python-install
    fi
  fi
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

if [[ "$INSTALL_SCOPE" == internal || "$PROXY_MODE" == shared ]]; then
  FRONTEND_LOOPBACK_PORT_AVAILABLE=true
  BACKEND_LOOPBACK_PORT_AVAILABLE=true
  for tuple in "frontend:$HTTP_PORT" "backend:$API_PORT"; do
    service="${tuple%%:*}"
    port="${tuple##*:}"
    if port_is_listening "$port" && ! devflow_container_running "$service"; then
      [[ "$service" == frontend ]] && FRONTEND_LOOPBACK_PORT_AVAILABLE=false \
        || BACKEND_LOOPBACK_PORT_AVAILABLE=false
      if [[ "$MODE" == check ]]; then
        CHECK_STATUS=failed
      else
        die "Porta loopback $port ocupada por outro serviço."
      fi
    fi
  done
fi

if [[ "$MODE" != check ]]; then
  if [[ "$INSTALL_SCOPE" == complete && "$PROXY_MODE" == isolated ]]; then
    for port in 80 443; do
      if port_is_listening "$port" && ! devflow_container_running edge; then
        die "Porta $port ocupada. O modo isolated não interrompe o proprietário atual."
      fi
    done
  elif [[ "$INSTALL_SCOPE" == complete && "$SHARED_PROXY_ADAPTER" == host-nginx ]]; then
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
  if [[ "$INSTALL_SCOPE" == complete ]]; then
    getent ahosts "$DOMAIN" >/dev/null 2>&1 || die "O domínio $DOMAIN não resolve no DNS."
  fi
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
  db_container_id="$(docker ps -a --filter "label=com.docker.compose.project=$DEVFLOW_PROJECT" \
    --filter 'label=com.docker.compose.service=db' --format '{{.ID}}' | head -n1)"
  if [[ -n "$db_container_id" ]]; then
    DATABASE_CONTAINER_READY=true
    [[ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$db_container_id" 2>/dev/null || true)" == healthy ]] \
      && DATABASE_HEALTHY=true
  fi
  backend_container_id="$(docker ps -a --filter "label=com.docker.compose.project=$DEVFLOW_PROJECT" \
    --filter 'label=com.docker.compose.service=backend' --format '{{.ID}}' | head -n1)"
  frontend_container_id="$(docker ps -a --filter "label=com.docker.compose.project=$DEVFLOW_PROJECT" \
    --filter 'label=com.docker.compose.service=frontend' --format '{{.ID}}' | head -n1)"
  [[ -n "$backend_container_id" \
    && "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$backend_container_id" 2>/dev/null || true)" == healthy ]] \
    && BACKEND_READY=true
  [[ -n "$frontend_container_id" \
    && "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$frontend_container_id" 2>/dev/null || true)" == healthy ]] \
    && FRONTEND_READY=true
  if [[ -n "$db_container_id" && -n "$(docker port "$db_container_id" 2>/dev/null || true)" ]]; then
    POSTGRES_PUBLIC_PORT_EXPOSED=true
    die 'O PostgreSQL DevFlow não pode publicar portas no host.'
  fi
fi

determine_resume_stage
if [[ "$RESUME_REQUESTED" == true && "$TRANSACTION_STATE_RECONSTRUCTION_PLANNED" == true ]]; then
  TRANSACTION_STATE_RECONSTRUCTED=true
fi

if [[ "$(source_clone_signature)" == "$SOURCE_CLONE_SIGNATURE_BEFORE" ]]; then
  SOURCE_CLONE_PRESERVED=true
else
  die 'O clone de origem foi alterado durante as validações; a instalação foi interrompida.'
fi

devflow_detect_public_port_ownership
STARTUP_STAGE=08-summary
if [[ "$FRONTEND_LOOPBACK_PORT_AVAILABLE" == false || "$BACKEND_LOOPBACK_PORT_AVAILABLE" == false \
  || "$POSTGRES_PUBLIC_PORT_EXPOSED" == true ]]; then
  DEVFLOW_INTERNAL_INSTALLATION_READY=false
fi

cat <<EOF
Resumo DevFlow $DEVFLOW_VERSION
  modo: $MODE
  escopo de instalação: $INSTALL_SCOPE
  sistema: ${PRETTY_NAME:-$DEVFLOW_DISTRO} ($DEVFLOW_ARCH)
  Docker: $docker_state ($docker_version)
  Compose v2: $compose_state ($compose_version)
  imagens para $DEVFLOW_ARCH: $IMAGE_ARCHITECTURE_STATUS
  estrutura Compose interna: $COMPOSE_STRUCTURE_STATUS
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
  instalação parcial detectada: $PARTIAL_INSTALLATION_DETECTED
  versão parcial: $PARTIAL_INSTALLATION_VERSION
  commit parcial: $PARTIAL_INSTALLATION_COMMIT
  etapa parcial: $PARTIAL_INSTALLATION_STAGE
EOF
devflow_print_port_evidence 80
devflow_print_port_evidence 443
cat <<EOF
public_proxy_status=$DEVFLOW_PUBLIC_PROXY_STATUS
internal_installation_ready=$DEVFLOW_INTERNAL_INSTALLATION_READY
external_publication_ready=$DEVFLOW_EXTERNAL_PUBLICATION_READY
frontend_loopback_port_available=$FRONTEND_LOOPBACK_PORT_AVAILABLE
backend_loopback_port_available=$BACKEND_LOOPBACK_PORT_AVAILABLE
postgres_public_port_exposed=$POSTGRES_PUBLIC_PORT_EXPOSED
image_resolution_status=$IMAGE_RESOLUTION_STATUS
resume_checkout_valid=$RESUME_CHECKOUT_VALID
resume_configuration_valid=$RESUME_CONFIGURATION_VALID
resume_transaction_valid=$RESUME_TRANSACTION_VALID
compose_project=$DEVFLOW_PROJECT
backend_service=backend
backend_image_expected=$BACKEND_IMAGE_EXPECTED
backend_image_resolved=$BACKEND_IMAGE_RESOLVED
backend_image_present=$BACKEND_IMAGE_PRESENT
backend_build_required=$BACKEND_BUILD_REQUIRED
frontend_service=frontend
frontend_image_expected=$FRONTEND_IMAGE_EXPECTED
frontend_image_resolved=$FRONTEND_IMAGE_RESOLVED
frontend_image_present=$FRONTEND_IMAGE_PRESENT
frontend_build_required=$FRONTEND_BUILD_REQUIRED
postgres_service=db
postgres_image_resolved=$POSTGRES_IMAGE_RESOLVED
postgres_image_present=$POSTGRES_IMAGE_PRESENT
postgres_pull_required=$POSTGRES_PULL_REQUIRED
partial_installation_detected=$PARTIAL_INSTALLATION_DETECTED
legacy_partial_installation_detected=$LEGACY_PARTIAL_INSTALLATION_DETECTED
transaction_state_present=$TRANSACTION_STATE_PRESENT
transaction_state_reconstruction_planned=$TRANSACTION_STATE_RECONSTRUCTION_PLANNED
transaction_state_reconstructed=$TRANSACTION_STATE_RECONSTRUCTED
can_resume=$CAN_RESUME
resume_from_stage=$RESUME_FROM_STAGE
source_ready=$SOURCE_READY
configuration_ready=$CONFIGURATION_READY
images_ready=$IMAGES_READY
database_container_ready=$DATABASE_CONTAINER_READY
database_healthy=$DATABASE_HEALTHY
migrations_ready=$MIGRATIONS_READY
backend_ready=$BACKEND_READY
frontend_ready=$FRONTEND_READY
super_admin_ready=$SUPER_ADMIN_READY
installation_state_ready=$INSTALLATION_STATE_READY
source_clone_preserved=$SOURCE_CLONE_PRESERVED
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

if [[ "$INSTALL_SCOPE" == internal ]]; then
  cat <<EOF
Ações planejadas para instalação interna:
  - instalar Docker Engine pelo repositório oficial apenas se estiver ausente;
  - criar somente diretórios, containers, redes e dados do projeto Compose devflow;
  - publicar frontend em 127.0.0.1:$HTTP_PORT e backend em 127.0.0.1:$API_PORT;
  - iniciar PostgreSQL sem porta no host, aplicar migrations e validar health local;
  - criar o Super Admin e manter segredos em $DEVFLOW_ENV_FILE com permissão 600;
  - registrar $INFRASTRUCTURE_PROVIDER apenas como provider planejado;
  - não alterar Nginx, 80/443, certificados, Full Password ou migração de proxy.
EOF
else
  cat <<EOF
Ações planejadas para instalação completa:
  - instalar Docker Engine pelo repositório oficial apenas se estiver ausente;
  - criar somente diretórios e recursos do projeto Compose devflow;
  - iniciar o banco, executar migrations reais e então subir a aplicação;
  - publicar frontend/API em loopback e delegar HTTPS ao provider $INFRASTRUCTURE_PROVIDER;
  - preservar configuração, redes, certificados e containers de terceiros;
  - modificar somente estes recursos do provider: $(provider_resources).
EOF
fi

if [[ "$RESUME_REQUESTED" == true ]]; then
  [[ "$CAN_RESUME" == true ]] || die 'A instalação parcial não possui evidências suficientes para retomada segura.'
  cat <<EOF
Instalação incompleta encontrada.

Versão parcial: $PARTIAL_INSTALLATION_VERSION
Versão atual: $DEVFLOW_RELEASE_VERSION
Checkout: válido
Configuração: válida
Estado transacional: $([[ "$TRANSACTION_STATE_RECONSTRUCTED" == true ]] && printf reconstruído-em-memória || printf validado)
Etapa de retomada: $RESUME_FROM_STAGE

As imagens antigas serão preservadas e reconstruídas com cache quando a proveniência não corresponder à release.
EOF
  OUTPUT_EMITTED=true
fi
if [[ "$MODE" == dry-run ]]; then
  if [[ "$INSTALL_SCOPE" == complete && "$EXTERNAL_PUBLICATION_BLOCKED" == true ]]; then
    log WARN 'Dry-run completo: instalação interna pronta, publicação externa bloqueada; nenhuma alteração foi realizada.'
    exit 0
  fi
  log INFO 'Dry-run concluído sem alterações.'
  exit 0
fi

require_root
if [[ "$RESUME_REQUESTED" == true ]]; then
  DEVFLOW_ASSUME_YES=false
  confirm_exact 'RETOMAR DEVFLOW' 'Autoriza retomar a instalação interna incompleta?'
elif [[ "${DEVFLOW_BOOTSTRAP_CONFIRMED:-false}" == true ]]; then
  log INFO 'Confirmação explícita recebida pelo bootstrap público.'
else
  DEVFLOW_ASSUME_YES=false
  confirm_exact 'INSTALAR DEVFLOW' "Autoriza a instalação inicial ($INSTALL_SCOPE) no host de homologação?"
fi

install -d -m 0750 "$DEVFLOW_INSTALL_ROOT" "$DEVFLOW_INSTALL_ROOT/releases" \
  "$DEVFLOW_CONFIG_ROOT" "$DEVFLOW_DATA_ROOT" "$DEVFLOW_STATE_ROOT" "$DEVFLOW_INSTALL_ROOT/backups" \
  "$DEVFLOW_LOG_ROOT" "$DEVFLOW_INSTALL_ROOT/storage/uploads" "$DEVFLOW_DATA_ROOT/postgres"
if [[ "$INSTALL_SCOPE" == complete ]]; then
  install -d -m 0750 "$DEVFLOW_CONFIG_ROOT/proxy" "$DEVFLOW_INSTALL_ROOT/backups/proxy" \
    "$DEVFLOW_CONFIG_ROOT/nginx" "$DEVFLOW_INSTALL_ROOT/storage/acme"
fi
INSTALL_LOG="$DEVFLOW_LOG_ROOT/install-$(date -u +%Y%m%dT%H%M%SZ).log"
touch "$INSTALL_LOG"
chmod 0640 "$INSTALL_LOG"
promote_bootstrap_log "$INSTALL_LOG"
log INFO "Log sanitizado: $INSTALL_LOG" | tee -a "$INSTALL_LOG"
if [[ "$RESUME_REQUESTED" == true && "$RESUME_TRANSACTION_VALID" == true \
  && "$INSTALL_TRANSACTION_COMMIT" == "$release_sha" \
  && "$INSTALL_TRANSACTION_VERSION" == "$DEVFLOW_RELEASE_VERSION" \
  && "$INSTALL_TRANSACTION_SCOPE" == "$INSTALL_SCOPE" ]]; then
  log INFO "Retomando transação registrada em $INSTALL_TRANSACTION_STAGE." | tee -a "$INSTALL_LOG"
else
  install_transaction_begin "$DEVFLOW_RELEASE_VERSION" "$release_sha" "$INSTALL_SCOPE" \
    "$LEGACY_PARTIAL_INSTALLATION_DETECTED" "$TRANSACTION_STATE_RECONSTRUCTED" "$RESUME_FROM_STAGE"
  if [[ "$TRANSACTION_STATE_RECONSTRUCTED" == true ]]; then
    log INFO "Estado transacional legado reconstruído; resume_from_stage=$RESUME_FROM_STAGE." | tee -a "$INSTALL_LOG"
  fi
fi
CURRENT_INSTALL_STAGE=01-preflight
install_transaction_complete_stage 01-preflight | tee -a "$INSTALL_LOG"
CURRENT_INSTALL_STAGE=02-directories
install_transaction_complete_stage 02-directories | tee -a "$INSTALL_LOG"
PROVIDER_APPLIED=false
INSTALL_PROMOTED=false
DEVFLOW_INSTALLATION_SCOPE="$INSTALL_SCOPE"
DEVFLOW_APPLICATION_INSTALLED=false
DEVFLOW_EXTERNAL_PUBLICATION_ENABLED=false
DEVFLOW_FRONTEND_URL="http://127.0.0.1:$HTTP_PORT"
DEVFLOW_BACKEND_URL="http://127.0.0.1:$API_PORT"
DEVFLOW_FULLPASSWORD_MODIFIED=false
DEVFLOW_PUBLIC_PROXY_MODIFIED=false
DEVFLOW_PROXY_MIGRATION_EXECUTED=false
DEVFLOW_CERTIFICATE_ISSUED=false
export DEVFLOW_INSTALLATION_SCOPE DEVFLOW_APPLICATION_INSTALLED \
  DEVFLOW_EXTERNAL_PUBLICATION_ENABLED DEVFLOW_FRONTEND_URL DEVFLOW_BACKEND_URL \
  DEVFLOW_FULLPASSWORD_MODIFIED DEVFLOW_PUBLIC_PROXY_MODIFIED \
  DEVFLOW_PROXY_MIGRATION_EXECUTED DEVFLOW_CERTIFICATE_ISSUED

installation_failed() {
  local exit_code="${1:-$?}"
  trap - ERR INT TERM HUP
  install_transaction_fail "${CURRENT_INSTALL_STAGE:-01-preflight}" | tee -a "$INSTALL_LOG" || true
  DEVFLOW_APPLICATION_INSTALLED=false
  export DEVFLOW_APPLICATION_INSTALLED
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
  if [[ "$INSTALL_PROMOTED" == true && -L "$DEVFLOW_INSTALL_ROOT/app" ]]; then
    rm -f -- "$DEVFLOW_INSTALL_ROOT/app"
  fi
  write_install_report failure || true
  log ERROR "A operação falhou (código $exit_code). Os dados existentes foram preservados; consulte $INSTALL_LOG." \
    | tee -a "$INSTALL_LOG" >&2
  exit "$exit_code"
}
trap installation_failed ERR
trap 'installation_failed 130' INT
trap 'installation_failed 143' TERM
trap 'installation_failed 129' HUP

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
packages=(openssl)
packages+=(python3)
if [[ "$INSTALL_SCOPE" == complete ]]; then
  packages+=(certbot)
fi
missing_packages=()
for package in "${packages[@]}"; do
  dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q 'install ok installed' || missing_packages+=("$package")
done
if [[ ${#missing_packages[@]} -gt 0 ]]; then
  apt-get update
  apt-get install -y "${missing_packages[@]}"
fi
if [[ "$INSTALL_SCOPE" == complete ]]; then
  provider_prepare "$DOMAIN" "$HTTP_PORT" "$API_PORT"
  provider_install
  if [[ -e "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]]; then
    [[ -r "/etc/letsencrypt/live/$DOMAIN/privkey.pem" ]] || die 'Certificado existente sem chave privada correspondente.'
    openssl x509 -in "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" -noout -checkhost "$DOMAIN" >/dev/null 2>&1 \
      || die 'O certificado existente não corresponde ao domínio DevFlow.'
  fi
fi

CURRENT_INSTALL_STAGE=03-source
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
  GIT_TERMINAL_PROMPT=0 git clone --branch main --single-branch \
    "$public_remote" "$operational_source_dir"
  git -C "$operational_source_dir" merge-base --is-ancestor "$release_sha" origin/main \
    || die 'A release selecionada não pertence ao histórico publicado de main.'
  git -C "$operational_source_dir" reset --hard "$release_sha"
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
    git -C "$operational_source_dir" merge-base --is-ancestor "$release_sha" origin/main \
      || die 'A release verificada não pertence ao histórico publicado de main.'
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
DEVFLOW_RELEASE_REF="$source_ref"
DEVFLOW_REPOSITORY_URL="$public_remote"
DEVFLOW_UPDATE_CHANNEL=main
export DEVFLOW_RELEASE_COMMIT DEVFLOW_RELEASE_REF DEVFLOW_REPOSITORY_URL DEVFLOW_UPDATE_CHANNEL
install_transaction_complete_stage 03-source | tee -a "$INSTALL_LOG"

CURRENT_INSTALL_STAGE=04-configuration
if [[ ! -f "$DEVFLOW_ENV_FILE" ]]; then
  runtime_domain="${DOMAIN:-internal.local}"
  runtime_letsencrypt_email="$LETSENCRYPT_EMAIL"
  runtime_app_origin="http://127.0.0.1:$HTTP_PORT"
  if [[ "$INSTALL_SCOPE" == complete ]]; then
    runtime_app_origin="https://$DOMAIN"
  fi
  db_password="$(openssl rand -base64 48 | tr -d '\n')"
  jwt_secret="$(openssl rand -hex 48)"
  bootstrap_token="$(openssl rand -base64 48 | tr -d '\n')"
  encryption_key="$(openssl rand -base64 32 | tr -d '\n')"
  backup_passphrase="$(openssl rand -base64 64 | tr -d '\n')"
  cat > "$DEVFLOW_ENV_FILE" <<EOF
# DevFlow runtime configuration — generated locally, never commit
DEVFLOW_VERSION=$DEVFLOW_VERSION
DEVFLOW_IMAGE_TAG=latest
DEVFLOW_SOURCE_DIR=$operational_source_dir
NODE_ENV=production
PORT=3000
TZ=America/Sao_Paulo
APP_ORIGIN=$runtime_app_origin
VITE_API_URL=/api
DEVFLOW_DOMAIN=$runtime_domain
DEVFLOW_INFRASTRUCTURE_PROVIDER=$INFRASTRUCTURE_PROVIDER
DEVFLOW_PROXY_MODE=$PROXY_MODE
DEVFLOW_SHARED_PROXY_ADAPTER=$SHARED_PROXY_ADAPTER
LETSENCRYPT_EMAIL=$runtime_letsencrypt_email
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

requested_super_admin_email="$SUPER_ADMIN_EMAIL"

ln -sfn "$release_dir" "$DEVFLOW_INSTALL_ROOT/app.candidate"
DEVFLOW_APP_ROOT="$DEVFLOW_INSTALL_ROOT/app.candidate"
load_devflow_env
validate_runtime_paths
[[ "$SUPER_ADMIN_EMAIL" == "$requested_super_admin_email" ]] \
  || die 'O e-mail informado diverge do Super Admin registrado na configuração parcial.'
[[ "${DEVFLOW_SHARED_PROXY_ADAPTER:-none}" == "$SHARED_PROXY_ADAPTER" ]] \
  || die 'Adaptador compartilhado diverge da configuração gerada.'
DEVFLOW_VERSION="$DEVFLOW_RELEASE_VERSION"
export DEVFLOW_VERSION
compose_files
"${DEVFLOW_COMPOSE[@]}" config --quiet
install_transaction_complete_stage 04-configuration | tee -a "$INSTALL_LOG"

CURRENT_INSTALL_STAGE=05-build-images
BACKEND_IMAGE_EXPECTED="$(compose_service_image_expected backend)" \
  || die 'O Compose não resolveu uma imagem única para backend.'
FRONTEND_IMAGE_EXPECTED="$(compose_service_image_expected frontend)" \
  || die 'O Compose não resolveu uma imagem única para frontend.'
POSTGRES_IMAGE_EXPECTED="$(compose_service_image_expected db)" \
  || die 'O Compose não resolveu uma imagem única para PostgreSQL.'
BACKEND_IMAGE_RESOLVED="$(normalize_image_reference "$BACKEND_IMAGE_EXPECTED")"
FRONTEND_IMAGE_RESOLVED="$(normalize_image_reference "$FRONTEND_IMAGE_EXPECTED")"
POSTGRES_IMAGE_RESOLVED="$(normalize_image_reference "$POSTGRES_IMAGE_EXPECTED")"

BACKEND_BUILD_REQUIRED=true
FRONTEND_BUILD_REQUIRED=true
POSTGRES_PULL_REQUIRED=true
compose_image_matches_release "$BACKEND_IMAGE_RESOLVED" "$release_sha" "$DEVFLOW_RELEASE_VERSION" \
  && BACKEND_BUILD_REQUIRED=false
compose_image_matches_release "$FRONTEND_IMAGE_RESOLVED" "$release_sha" "$DEVFLOW_RELEASE_VERSION" \
  && FRONTEND_BUILD_REQUIRED=false
docker image inspect "$POSTGRES_IMAGE_RESOLVED" >/dev/null 2>&1 && POSTGRES_PULL_REQUIRED=false

build_services=()
[[ "$BACKEND_BUILD_REQUIRED" == false ]] || build_services+=(backend)
[[ "$FRONTEND_BUILD_REQUIRED" == false ]] || build_services+=(frontend)
if [[ ${#build_services[@]} -gt 0 ]]; then
  "${DEVFLOW_COMPOSE[@]}" build "${build_services[@]}"
fi
[[ "$POSTGRES_PULL_REQUIRED" == false ]] || "${DEVFLOW_COMPOSE[@]}" pull db
printf '%s\n' \
  "backend_build_required=$BACKEND_BUILD_REQUIRED" \
  "frontend_build_required=$FRONTEND_BUILD_REQUIRED" \
  "postgres_pull_required=$POSTGRES_PULL_REQUIRED" | tee -a "$INSTALL_LOG"
install_transaction_complete_stage 05-build-images | tee -a "$INSTALL_LOG"

CURRENT_INSTALL_STAGE=06-validate-images
backend_image="$(resolve_compose_service_image backend)" || {
  printf 'backend_image_expected=%s\nbackend_image_resolved=%s\nbackend_image_present=false\n' \
    "$BACKEND_IMAGE_EXPECTED" "$BACKEND_IMAGE_RESOLVED"
  list_existing_devflow_images || true
  die 'A imagem resolvida do backend não existe localmente.'
}
frontend_image="$(resolve_compose_service_image frontend)" || {
  printf 'frontend_image_expected=%s\nfrontend_image_resolved=%s\nfrontend_image_present=false\n' \
    "$FRONTEND_IMAGE_EXPECTED" "$FRONTEND_IMAGE_RESOLVED"
  list_existing_devflow_images || true
  die 'A imagem resolvida do frontend não existe localmente.'
}
postgres_image="$(resolve_compose_service_image db)" || die 'A imagem resolvida do PostgreSQL não existe localmente.'
BACKEND_IMAGE_PRESENT=true
FRONTEND_IMAGE_PRESENT=true
POSTGRES_IMAGE_PRESENT=true
printf '%s\n' \
  "compose_project=$DEVFLOW_PROJECT" \
  'backend_service=backend' \
  "backend_image_expected=$BACKEND_IMAGE_EXPECTED" \
  "backend_image_resolved=$backend_image" \
  'backend_image_present=true' \
  'frontend_service=frontend' \
  "frontend_image_expected=$FRONTEND_IMAGE_EXPECTED" \
  "frontend_image_resolved=$frontend_image" \
  'frontend_image_present=true' \
  'postgres_service=db' \
  "postgres_image_resolved=$postgres_image" \
  'postgres_image_present=true' | tee -a "$INSTALL_LOG"
read -r db_uid db_gid < <(docker run --rm --entrypoint sh "$postgres_image" -c 'printf "%s %s\n" "$(id -u postgres)" "$(id -g postgres)"')
read -r backend_uid backend_gid < <(docker run --rm --entrypoint sh "$backend_image" -c 'printf "%s %s\n" "$(id -u devflow)" "$(id -g devflow)"')
[[ "$db_uid" =~ ^[0-9]+$ && "$db_gid" =~ ^[0-9]+$ && "$backend_uid" =~ ^[0-9]+$ && "$backend_gid" =~ ^[0-9]+$ ]] \
  || die 'Não foi possível validar os usuários não-root dos containers.'
chown "$db_uid:$db_gid" "$DEVFLOW_DATA_ROOT/postgres"
chown "$backend_uid:$backend_gid" "$DEVFLOW_INSTALL_ROOT/storage/uploads"
chmod 0750 "$DEVFLOW_DATA_ROOT/postgres" "$DEVFLOW_INSTALL_ROOT/storage/uploads"
install_transaction_complete_stage 06-validate-images | tee -a "$INSTALL_LOG"

CURRENT_INSTALL_STAGE=07-create-networks
ensure_devflow_edge_network
install_transaction_complete_stage 07-create-networks | tee -a "$INSTALL_LOG"

CURRENT_INSTALL_STAGE=08-start-database
"${DEVFLOW_COMPOSE[@]}" up -d db --wait
"${DEVFLOW_COMPOSE[@]}" exec -T db sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
install_transaction_complete_stage 08-start-database | tee -a "$INSTALL_LOG"

CURRENT_INSTALL_STAGE=09-run-migrations
"${DEVFLOW_COMPOSE[@]}" run --rm --no-deps backend node scripts/migrate.js
DEVFLOW_MIGRATION_VERSION="$("${DEVFLOW_COMPOSE[@]}" exec -T db sh -c \
  'psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT version FROM schema_migrations ORDER BY applied_at DESC LIMIT 1"')"
[[ -n "$DEVFLOW_MIGRATION_VERSION" ]] || die 'PostgreSQL não confirmou a migration aplicada.'
install_transaction_complete_stage 09-run-migrations | tee -a "$INSTALL_LOG"

CERTIFICATE_EXISTED_BEFORE=true
if [[ "$INSTALL_SCOPE" == complete ]]; then
  CERTIFICATE_EXISTED_BEFORE=false
  [[ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]] && CERTIFICATE_EXISTED_BEFORE=true
fi

CURRENT_INSTALL_STAGE=10-start-backend
"${DEVFLOW_COMPOSE[@]}" up -d backend --wait
install_transaction_complete_stage 10-start-backend | tee -a "$INSTALL_LOG"

CURRENT_INSTALL_STAGE=11-start-frontend
"${DEVFLOW_COMPOSE[@]}" up -d frontend --wait
install_transaction_complete_stage 11-start-frontend | tee -a "$INSTALL_LOG"

CURRENT_INSTALL_STAGE=12-bootstrap-super-admin
[[ -s "$DEVFLOW_CONFIG_ROOT/bootstrap-token" && "$(stat -c '%a' "$DEVFLOW_CONFIG_ROOT/bootstrap-token")" == 600 ]] \
  || die 'Token protegido do bootstrap do Super Admin está ausente ou inseguro.'
install_transaction_complete_stage 12-bootstrap-super-admin | tee -a "$INSTALL_LOG"

CURRENT_INSTALL_STAGE=13-health
curl --fail --silent --show-error --max-time 20 "http://127.0.0.1:$API_PORT/api/health" >/dev/null
curl --fail --silent --show-error --max-time 20 "http://127.0.0.1:$HTTP_PORT/healthz" >/dev/null
db_runtime_id="$("${DEVFLOW_COMPOSE[@]}" ps -q db)"
[[ -n "$db_runtime_id" && -z "$(docker port "$db_runtime_id" 2>/dev/null || true)" ]] \
  || die 'postgres_public_port_exposed=true; instalação interna bloqueada.'

if [[ "$INSTALL_SCOPE" == complete ]]; then
  PROVIDER_APPLIED=true
  provider_activate "$release_dir" "$DOMAIN" "$LETSENCRYPT_EMAIL" "$HTTP_PORT" "$API_PORT"
  provider_validate
  curl --fail --silent --show-error --max-time 20 "https://$DOMAIN/api/health" >/dev/null
  curl --fail --silent --show-error --max-time 20 "https://$DOMAIN/" >/dev/null
  DEVFLOW_EXTERNAL_PUBLICATION_ENABLED=true
  DEVFLOW_PUBLIC_PROXY_MODIFIED=true
  [[ "$CERTIFICATE_EXISTED_BEFORE" == true ]] || DEVFLOW_CERTIFICATE_ISSUED=true
  DEVFLOW_FRONTEND_URL="https://$DOMAIN"
  DEVFLOW_BACKEND_URL="https://$DOMAIN/api"
fi
install_transaction_complete_stage 13-health | tee -a "$INSTALL_LOG"

CURRENT_INSTALL_STAGE=14-write-final-state
set_managed_env_value DEVFLOW_VERSION "$DEVFLOW_RELEASE_VERSION"
ln -sfn "$release_dir" "$DEVFLOW_INSTALL_ROOT/app"
INSTALL_PROMOTED=true
rm -f "$DEVFLOW_INSTALL_ROOT/app.candidate"

install -m 0644 "$release_dir/scripts/systemd/devflow-backup.service" /etc/systemd/system/devflow-backup.service
install -m 0644 "$release_dir/scripts/systemd/devflow-backup.timer" /etc/systemd/system/devflow-backup.timer
systemctl daemon-reload
systemctl enable --now devflow-backup.timer
provider_state_write "$INFRASTRUCTURE_PROVIDER" "${DOMAIN:-internal.local}" "$HTTP_PORT" "$API_PORT"
DEVFLOW_APPLICATION_INSTALLED=true
export DEVFLOW_APPLICATION_INSTALLED DEVFLOW_EXTERNAL_PUBLICATION_ENABLED \
  DEVFLOW_PUBLIC_PROXY_MODIFIED DEVFLOW_CERTIFICATE_ISSUED DEVFLOW_FRONTEND_URL DEVFLOW_BACKEND_URL
write_install_report success
install_transaction_complete_stage 14-write-final-state | tee -a "$INSTALL_LOG"
trap - ERR INT TERM HUP

if [[ "$INSTALL_SCOPE" == internal ]]; then
  log INFO "DevFlow $DEVFLOW_VERSION instalado internamente em http://127.0.0.1:$HTTP_PORT" | tee -a "$INSTALL_LOG"
  printf '%s\n' \
    'fullpassword_modified=false' \
    'public_proxy_modified=false' \
    'proxy_migration_executed=false' \
    'certificate_issued=false' \
    'external_publication_enabled=false' \
    'source_ready=true' \
    'configuration_ready=true' \
    'images_ready=true' \
    'database_container_ready=true' \
    'database_healthy=true' \
    'migrations_ready=true' \
    'backend_ready=true' \
    'frontend_ready=true' \
    'super_admin_ready=true' \
    'installation_state_ready=true' | tee -a "$INSTALL_LOG"
else
  log INFO "DevFlow $DEVFLOW_VERSION instalado para homologação em https://$DOMAIN" | tee -a "$INSTALL_LOG"
fi
log INFO "Bootstrap: use o e-mail configurado e o token protegido em $DEVFLOW_CONFIG_ROOT/bootstrap-token." | tee -a "$INSTALL_LOG"
log WARN 'O DevFlow ainda não está aprovado para produção.' | tee -a "$INSTALL_LOG"
