#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

REPOSITORY_URL='https://github.com/trinityrrocha/DevFlow.git'
SELECTED_REF=main
REQUESTED_VERSION=
MODE=
MODE_EXPLICIT=false
INSTALL_SCOPE=complete
INSTALL_SCOPE_EXPLICIT=false
INFRASTRUCTURE_PROVIDER=host-nginx
PROVIDER_EXPLICIT=false
DOMAIN=
LETSENCRYPT_EMAIL=
SUPER_ADMIN_EMAIL=
HTTP_PORT=18080
API_PORT=13000
TEMP_ROOT=
TEMP_PARENT=

log() { printf '%s [bootstrap] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }
die() { log "ERRO: $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
DevFlow — bootstrap público para homologação

Uso:
  ./install.sh --check [--ref main|vSEMVER] [--expected-version SEMVER]
  ./install.sh --dry-run [opções]
  ./install.sh --dry-run --install-scope internal --super-admin-email EMAIL
  sudo ./install.sh --install [opções]
  sudo ./install.sh --install-internal --super-admin-email EMAIL
  sudo ./install.sh --resume --super-admin-email EMAIL
  sudo ./install.sh [opções]

Sem argumentos, coleta a configuração de forma interativa e solicita confirmação.
A versão é detectada no checkout validado. Use --expected-version somente para pin explícito.

Opções:
  --provider host-nginx|isolated-nginx
  --proxy-mode isolated|shared (alias legado)
  --domain HOST
  --letsencrypt-email EMAIL
  --super-admin-email EMAIL
  --http-port PORT
  --api-port PORT
  --ref main|vSEMVER
  --expected-version SEMVER
  --install-scope complete|internal
  --help
EOF
}

set_mode() {
  [[ "$MODE_EXPLICIT" == false ]] || die 'Informe somente um modo.'
  MODE="$1"
  MODE_EXPLICIT=true
}

set_install_scope() {
  [[ "$INSTALL_SCOPE_EXPLICIT" == false ]] || die 'Informe --install-scope somente uma vez.'
  case "$1" in internal|complete) INSTALL_SCOPE="$1" ;; *) die 'Escopo inválido.' ;; esac
  INSTALL_SCOPE_EXPLICIT=true
}

require_value() {
  [[ $# -ge 2 && -n "$2" ]] || die "A opção $1 exige um valor."
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) set_mode check; shift ;;
    --dry-run) set_mode dry-run; shift ;;
    --install) set_mode install; shift ;;
    --install-internal) set_mode install; set_install_scope internal; shift ;;
    --resume) set_mode resume; set_install_scope internal; shift ;;
    --install-scope) require_value "$1" "${2:-}"; set_install_scope "$2"; shift 2 ;;
    --provider) require_value "$1" "${2:-}"; INFRASTRUCTURE_PROVIDER="$2"; PROVIDER_EXPLICIT=true; shift 2 ;;
    --proxy-mode)
      require_value "$1" "${2:-}"
      case "$2" in shared) INFRASTRUCTURE_PROVIDER=host-nginx ;; isolated) INFRASTRUCTURE_PROVIDER=isolated-nginx ;; *) die 'Modo legado inválido.' ;; esac
      PROVIDER_EXPLICIT=true
      shift 2
      ;;
    --domain) require_value "$1" "${2:-}"; DOMAIN="$2"; shift 2 ;;
    --letsencrypt-email|--email) require_value "$1" "${2:-}"; LETSENCRYPT_EMAIL="$2"; shift 2 ;;
    --super-admin-email|--super-admin) require_value "$1" "${2:-}"; SUPER_ADMIN_EMAIL="$2"; shift 2 ;;
    --http-port) require_value "$1" "${2:-}"; HTTP_PORT="$2"; shift 2 ;;
    --api-port) require_value "$1" "${2:-}"; API_PORT="$2"; shift 2 ;;
    --ref) require_value "$1" "${2:-}"; SELECTED_REF="$2"; shift 2 ;;
    --expected-version) require_value "$1" "${2:-}"; REQUESTED_VERSION="$2"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) die "Opção desconhecida: $1" ;;
  esac
done

[[ -n "$MODE" ]] || MODE=install
[[ "$(uname -s)" == Linux ]] || die 'Este bootstrap pode ser executado somente em Linux.'
[[ "$SELECTED_REF" == main || "$SELECTED_REF" =~ ^v[0-9A-Za-z.+-]+$ ]] \
  || die 'Referência inválida; use main ou uma tag vSEMVER sem caminhos ou caracteres de shell.'
[[ -z "$REQUESTED_VERSION" || "$REQUESTED_VERSION" =~ ^[0-9A-Za-z.+-]+$ ]] \
  || die 'Versão esperada contém caracteres não permitidos.'
for command_name in git mktemp rm chmod date grep awk cmp tr wc sed readlink stat id; do
  command -v "$command_name" >/dev/null 2>&1 || die "Dependência mínima ausente: $command_name"
done

check_connectivity() {
  GIT_TERMINAL_PROMPT=0 git -c http.followRedirects=false \
    ls-remote --exit-code "$REPOSITORY_URL" >/dev/null
}

check_connectivity || die 'Não foi possível acessar o repositório público no GitHub.'

prompt_value() {
  local variable_name="$1" prompt="$2" value="${!1}"
  [[ -n "$value" ]] && return 0
  [[ -t 0 ]] || die "$prompt deve ser informado por parâmetro em execução não interativa."
  read -r -p "$prompt: " value
  [[ -n "$value" ]] || die "$prompt não pode ficar vazio."
  printf -v "$variable_name" '%s' "$value"
}

prompt_proxy_mode() {
  [[ "$PROVIDER_EXPLICIT" == false ]] || return 0
  [[ -t 0 ]] || return 0
  cat <<'EOF'
Provider de infraestrutura:

  1 - Nginx no host — Recomendado
      Proxy central instalado diretamente no Linux. Cada projeto mantém
      containers, redes, volumes e banco próprios.

  2 - Proxy isolado
      Indicado apenas para VPS exclusiva do DevFlow; ocupa 80 e 443.
EOF
  read -r -p 'Escolha [1/2] (padrão 1): ' proxy_choice
  case "$proxy_choice" in
    ''|1) INFRASTRUCTURE_PROVIDER=host-nginx ;;
    2) INFRASTRUCTURE_PROVIDER=isolated-nginx ;;
    *) die 'Provider inválido.' ;;
  esac
}

if [[ "$MODE" != check ]]; then
  prompt_value SUPER_ADMIN_EMAIL 'E-mail do Super Administrador'
  if [[ "$INSTALL_SCOPE" == complete ]]; then
    prompt_value DOMAIN 'Domínio do DevFlow'
    prompt_value LETSENCRYPT_EMAIL 'E-mail para o certificado HTTPS'
    prompt_proxy_mode
    [[ "$INFRASTRUCTURE_PROVIDER" == host-nginx || "$INFRASTRUCTURE_PROVIDER" == isolated-nginx ]] || die 'Provider inválido.'
    [[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ && "$DOMAIN" == *.* ]] || die 'Domínio inválido.'
    [[ "$LETSENCRYPT_EMAIL" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die 'E-mail TLS inválido.'
  else
    INFRASTRUCTURE_PROVIDER=host-nginx
  fi
  [[ "$SUPER_ADMIN_EMAIL" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die 'E-mail do Super Admin inválido.'
  for port in "$HTTP_PORT" "$API_PORT"; do
    [[ "$port" =~ ^[0-9]+$ && "$port" -ge 1 && "$port" -le 65535 ]] || die "Porta inválida: $port"
  done
  [[ "$HTTP_PORT" != "$API_PORT" ]] || die 'As portas do frontend e da API devem ser diferentes.'
fi

[[ "$MODE" != install && "$MODE" != resume || "$(id -u)" -eq 0 ]] \
  || die 'Execute a instalação com sudo ou como root.'

TEMP_PARENT="$(readlink -f "${TMPDIR:-/tmp}" 2>/dev/null || true)"
[[ "$TEMP_PARENT" == /* && -d "$TEMP_PARENT" ]] || die 'Diretório temporário base inválido.'
TEMP_ROOT="$(mktemp -d "$TEMP_PARENT/devflow-bootstrap.XXXXXX")"
chmod 0700 "$TEMP_ROOT"
[[ ! -L "$TEMP_ROOT" \
  && "$(readlink -f "$TEMP_ROOT")" == "$TEMP_ROOT" \
  && "$(stat -c '%u' "$TEMP_ROOT")" == "$(id -u)" \
  && "$(stat -c '%a' "$TEMP_ROOT")" == 700 ]] \
  || die 'Integridade do diretório temporário não pôde ser comprovada.'
cleanup() {
  if [[ -n "$TEMP_ROOT" && -n "$TEMP_PARENT" \
    && "$TEMP_ROOT" == "$TEMP_PARENT/devflow-bootstrap."* && -d "$TEMP_ROOT" && ! -L "$TEMP_ROOT" ]]; then
    rm -rf -- "$TEMP_ROOT"
  fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

CHECKOUT="$TEMP_ROOT/DevFlow"
log "Obtendo $REPOSITORY_URL ($SELECTED_REF)."
GIT_TERMINAL_PROMPT=0 git -c http.followRedirects=false clone --quiet \
  --branch "$SELECTED_REF" --single-branch "$REPOSITORY_URL" "$CHECKOUT"

[[ -d "$CHECKOUT/.git" && ! -L "$CHECKOUT/.git" ]] || die 'O download não produziu um checkout Git válido.'
[[ "$(git -C "$CHECKOUT" remote get-url origin)" == "$REPOSITORY_URL" ]] || die 'Remote do checkout público divergente.'
if [[ "$SELECTED_REF" == main ]]; then
  [[ "$(git -C "$CHECKOUT" branch --show-current)" == main ]] || die 'Branch obtida é diferente da selecionada.'
  REMOTE_COMMIT="$(GIT_TERMINAL_PROMPT=0 git -c http.followRedirects=false -C "$CHECKOUT" ls-remote origin refs/heads/main | awk 'NR==1 {print $1}')"
else
  [[ -z "$(git -C "$CHECKOUT" branch --show-current)" ]] || die 'Uma tag deve produzir checkout detached.'
  REMOTE_COMMIT="$(GIT_TERMINAL_PROMPT=0 git -c http.followRedirects=false -C "$CHECKOUT" ls-remote origin "refs/tags/$SELECTED_REF^{}" | awk 'NR==1 {print $1}')"
  [[ -n "$REMOTE_COMMIT" ]] || REMOTE_COMMIT="$(GIT_TERMINAL_PROMPT=0 git -c http.followRedirects=false -C "$CHECKOUT" ls-remote origin "refs/tags/$SELECTED_REF" | awk 'NR==1 {print $1}')"
fi
[[ -z "$(git -C "$CHECKOUT" status --porcelain)" ]] || die 'Checkout público contém alterações inesperadas.'
COMMIT="$(git -C "$CHECKOUT" rev-parse HEAD)"
[[ "$COMMIT" =~ ^[0-9a-f]{40}$ && "$COMMIT" == "$REMOTE_COMMIT" ]] || die 'Commit baixado não corresponde à referência remota solicitada.'
git -C "$CHECKOUT" fsck --strict --no-dangling >/dev/null

for trusted_file in VERSION scripts/lib/version.sh scripts/install.sh; do
  git -C "$CHECKOUT" ls-files --error-unmatch "$trusted_file" >/dev/null 2>&1 || die "Arquivo obrigatório não rastreado: $trusted_file"
  [[ -f "$CHECKOUT/$trusted_file" && ! -L "$CHECKOUT/$trusted_file" ]] || die "Arquivo obrigatório inválido: $trusted_file"
done
# A biblioteca somente é carregada após origem, referência, commit e integridade Git serem comprovados.
# shellcheck source=lib/version.sh
. "$CHECKOUT/scripts/lib/version.sh"
devflow_ref_is_valid "$SELECTED_REF" || die 'Referência não atende ao contrato main|vSEMVER.'
devflow_validate_checkout_identity "$CHECKOUT" "$SELECTED_REF" "$COMMIT" \
  || die 'Identidade, referência, commit ou limpeza do checkout não pôde ser comprovada.'
DETECTED_VERSION="$(devflow_validate_checkout_version_consistency "$CHECKOUT")" \
  || die 'version_consistency=false; checkout público possui versões divergentes ou inválidas.'

if [[ "$SELECTED_REF" != main && "$SELECTED_REF" != "v$DETECTED_VERSION" ]]; then
  devflow_version_mismatch_message "$SELECTED_REF" "${SELECTED_REF#v}" "$DETECTED_VERSION" "$COMMIT" >&2
  exit 1
fi
if [[ -n "$REQUESTED_VERSION" ]]; then
  devflow_semver_is_valid "$REQUESTED_VERSION" || die 'Versão explicitamente esperada não atende ao contrato SemVer.'
  if [[ "$DETECTED_VERSION" != "$REQUESTED_VERSION" ]]; then
    devflow_version_mismatch_message "$SELECTED_REF" "$REQUESTED_VERSION" "$DETECTED_VERSION" "$COMMIT" >&2
    exit 1
  fi
  printf 'expected_version=%s\ndetected_version=%s\nversion_match=true\n' "$REQUESTED_VERSION" "$DETECTED_VERSION"
fi
[[ -x "$CHECKOUT/scripts/install.sh" ]] || die 'Instalador interno ausente ou sem permissão de execução.'

SELF_PATH="$(readlink -f "$0" 2>/dev/null || true)"
if [[ "$SELECTED_REF" == main && -n "$SELF_PATH" && -f "$SELF_PATH" ]]; then
  cmp -s "$SELF_PATH" "$CHECKOUT/scripts/bootstrap.sh" || die 'O bootstrap baixado não corresponde mais à main; baixe-o novamente.'
fi

cat <<EOF
Checkout validado:
  repositório: trinityrrocha/DevFlow
  referência: $SELECTED_REF
  versão: $DETECTED_VERSION
  commit: $COMMIT
EOF

if [[ "$MODE" == install || "$MODE" == resume ]]; then
  cat <<EOF
Resumo da instalação pública:
  repositório: $REPOSITORY_URL
  referência: $SELECTED_REF
  versão validada: $DETECTED_VERSION
  commit validado: $COMMIT
  escopo: $INSTALL_SCOPE
  domínio: $DOMAIN
  provider: $INFRASTRUCTURE_PROVIDER
  e-mail TLS: $LETSENCRYPT_EMAIL
  Super Admin: $SUPER_ADMIN_EMAIL
EOF
  [[ -t 0 ]] || die 'A instalação exige confirmação em um terminal interativo.'
  read -r -p 'Deseja iniciar a instalação? [s/N] ' confirmation
  [[ "$confirmation" == s || "$confirmation" == S ]] \
    || die 'Instalação cancelada sem alterações permanentes.'
fi

INSTALL_ARGS=("--$MODE")
if [[ "$MODE" != check ]]; then
  [[ "$MODE" == resume ]] || INSTALL_ARGS+=(--install-scope "$INSTALL_SCOPE")
  INSTALL_ARGS+=(--provider "$INFRASTRUCTURE_PROVIDER" --super-admin-email "$SUPER_ADMIN_EMAIL" \
    --http-port "$HTTP_PORT" --api-port "$API_PORT")
  if [[ "$INSTALL_SCOPE" == complete ]]; then
    INSTALL_ARGS+=(--domain "$DOMAIN" --letsencrypt-email "$LETSENCRYPT_EMAIL")
  fi
fi

if [[ "$MODE" == install || "$MODE" == resume ]]; then
  DEVFLOW_BOOTSTRAP_CONFIRMED=true DEVFLOW_BOOTSTRAP_REF="$SELECTED_REF" \
    "$CHECKOUT/scripts/install.sh" "${INSTALL_ARGS[@]}"
else
  DEVFLOW_BOOTSTRAP_REF="$SELECTED_REF" "$CHECKOUT/scripts/install.sh" "${INSTALL_ARGS[@]}"
fi
log "Bootstrap concluído no modo $MODE; versão=$DETECTED_VERSION commit=$COMMIT; temporários serão removidos."
