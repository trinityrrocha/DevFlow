#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

REPOSITORY_URL='https://github.com/trinityrrocha/DevFlow.git'
RAW_VERSION_URL='https://raw.githubusercontent.com/trinityrrocha/DevFlow/main/VERSION'
EXPECTED_VERSION='0.2.0-alpha'
SELECTED_REF=main
MODE=
MODE_EXPLICIT=false
PROXY_MODE=
DOMAIN=
LETSENCRYPT_EMAIL=
SUPER_ADMIN_EMAIL=
HTTP_PORT=18080
API_PORT=13000
TEMP_ROOT=

log() { printf '%s [bootstrap] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }
die() { log "ERRO: $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
DevFlow 0.2.0-alpha — bootstrap público para homologação

Uso:
  ./install.sh --check
  ./install.sh --dry-run [opções]
  sudo ./install.sh --install [opções]
  sudo ./install.sh [opções]

Sem argumentos, coleta a configuração de forma interativa e solicita confirmação.

Opções:
  --proxy-mode isolated|shared
  --domain HOST
  --letsencrypt-email EMAIL
  --super-admin-email EMAIL
  --http-port PORT
  --api-port PORT
  --ref main
  --help
EOF
}

set_mode() {
  [[ "$MODE_EXPLICIT" == false ]] || die 'Informe somente um modo.'
  MODE="$1"
  MODE_EXPLICIT=true
}

require_value() {
  [[ $# -ge 2 && -n "$2" ]] || die "A opção $1 exige um valor."
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) set_mode check; shift ;;
    --dry-run) set_mode dry-run; shift ;;
    --install) set_mode install; shift ;;
    --proxy-mode) require_value "$1" "${2:-}"; PROXY_MODE="$2"; shift 2 ;;
    --domain) require_value "$1" "${2:-}"; DOMAIN="$2"; shift 2 ;;
    --letsencrypt-email|--email) require_value "$1" "${2:-}"; LETSENCRYPT_EMAIL="$2"; shift 2 ;;
    --super-admin-email|--super-admin) require_value "$1" "${2:-}"; SUPER_ADMIN_EMAIL="$2"; shift 2 ;;
    --http-port) require_value "$1" "${2:-}"; HTTP_PORT="$2"; shift 2 ;;
    --api-port) require_value "$1" "${2:-}"; API_PORT="$2"; shift 2 ;;
    --ref) require_value "$1" "${2:-}"; SELECTED_REF="$2"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) die "Opção desconhecida: $1" ;;
  esac
done

[[ -n "$MODE" ]] || MODE=install
[[ "$(uname -s)" == Linux ]] || die 'Este bootstrap pode ser executado somente em Linux.'
[[ "$SELECTED_REF" == main ]] || die 'Esta versão pública aceita somente a referência main.'
for command_name in mktemp rm chmod date grep awk cmp tr; do
  command -v "$command_name" >/dev/null 2>&1 || die "Dependência mínima ausente: $command_name"
done

check_connectivity() {
  if command -v curl >/dev/null 2>&1; then
    REMOTE_VERSION="$(curl --fail --silent --show-error --location --max-time 20 "$RAW_VERSION_URL" | tr -d '\r\n')"
  elif command -v wget >/dev/null 2>&1; then
    REMOTE_VERSION="$(wget --quiet --output-document=- --timeout=20 "$RAW_VERSION_URL" | tr -d '\r\n')"
  elif command -v git >/dev/null 2>&1; then
    GIT_TERMINAL_PROMPT=0 git ls-remote --exit-code "$REPOSITORY_URL" refs/heads/main >/dev/null
    REMOTE_VERSION=unknown-until-clone
  else
    die 'curl, wget ou git é necessário para validar conectividade com o GitHub.'
  fi
}

check_connectivity || die 'Não foi possível acessar o repositório público no GitHub.'
[[ "$REMOTE_VERSION" == unknown-until-clone || "$REMOTE_VERSION" == "$EXPECTED_VERSION" ]] \
  || die "VERSION público inesperado: $REMOTE_VERSION"

prompt_value() {
  local variable_name="$1" prompt="$2" value="${!1}"
  [[ -n "$value" ]] && return 0
  [[ -t 0 ]] || die "$prompt deve ser informado por parâmetro em execução não interativa."
  read -r -p "$prompt: " value
  [[ -n "$value" ]] || die "$prompt não pode ficar vazio."
  printf -v "$variable_name" '%s' "$value"
}

prompt_proxy_mode() {
  [[ -n "$PROXY_MODE" ]] && return 0
  [[ -t 0 ]] || die 'Informe --proxy-mode em execução não interativa.'
  cat <<'EOF'
Modo de proxy:

  1 - Isolado
      Instalação independente, recomendada para servidor limpo
      ou quando o DevFlow não deve compartilhar proxy.

      Serão utilizados:
      - proxy próprio;
      - containers próprios;
      - rede Docker própria;
      - volumes próprios;
      - banco próprio;
      - certificados HTTPS próprios.

  2 - Compartilhado
      Instalação em servidor que já possui proxy Nginx ou Caddy.

      O DevFlow continuará utilizando:
      - containers próprios;
      - volumes próprios;
      - banco próprio;
      - storage próprio.

      Somente o proxy e, quando necessário, uma rede Docker
      compatível poderão ser compartilhados.

      Nenhuma configuração existente será sobrescrita.
      A integração automática atual é limitada ao Nginx do host.
EOF
  read -r -p 'Escolha [1/2]: ' proxy_choice
  case "$proxy_choice" in
    1) PROXY_MODE=isolated ;;
    2) PROXY_MODE=shared ;;
    *) die 'Modo de proxy inválido.' ;;
  esac
}

if [[ "$MODE" != check ]]; then
  prompt_value DOMAIN 'Domínio do DevFlow'
  prompt_value LETSENCRYPT_EMAIL 'E-mail para o certificado HTTPS'
  prompt_value SUPER_ADMIN_EMAIL 'E-mail do Super Administrador'
  prompt_proxy_mode
  [[ "$PROXY_MODE" == isolated || "$PROXY_MODE" == shared ]] || die 'Modo de proxy inválido.'
  [[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ && "$DOMAIN" == *.* ]] \
    || die 'Domínio inválido.'
  for email in "$LETSENCRYPT_EMAIL" "$SUPER_ADMIN_EMAIL"; do
    [[ "$email" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die "E-mail inválido: $email"
  done
  for port in "$HTTP_PORT" "$API_PORT"; do
    [[ "$port" =~ ^[0-9]+$ && "$port" -ge 1 && "$port" -le 65535 ]] || die "Porta inválida: $port"
  done
  [[ "$HTTP_PORT" != "$API_PORT" ]] || die 'As portas do frontend e da API devem ser diferentes.'
fi

ensure_git() {
  command -v git >/dev/null 2>&1 && return 0
  [[ "$MODE" == install ]] || die 'Git é obrigatório; o modo de diagnóstico não instala dependências.'
  [[ "$(id -u)" -eq 0 ]] || die 'Execute a instalação com sudo para instalar a dependência Git ausente.'
  [[ -r /etc/os-release ]] || die 'Não foi possível identificar a distribuição para instalar Git.'
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-}" in
    ubuntu|debian)
      apt-get update
      apt-get install -y git ca-certificates
      ;;
    *) die 'Git ausente e distribuição não suportada para bootstrap automático.' ;;
  esac
}

if [[ "$MODE" == install ]]; then
  [[ "$(id -u)" -eq 0 ]] || die 'Execute a instalação com sudo ou como root.'
  cat <<EOF
Resumo da instalação pública:
  repositório: $REPOSITORY_URL
  referência: $SELECTED_REF
  versão esperada: $EXPECTED_VERSION
  domínio: $DOMAIN
  proxy: $PROXY_MODE
  e-mail TLS: $LETSENCRYPT_EMAIL
  Super Admin: $SUPER_ADMIN_EMAIL
EOF
  [[ -t 0 ]] || die 'A instalação exige confirmação em um terminal interativo.'
  read -r -p 'Deseja iniciar a instalação? [s/N] ' confirmation
  [[ "$confirmation" == s || "$confirmation" == S ]] || die 'Instalação cancelada sem alterações permanentes.'
fi

ensure_git
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/devflow-bootstrap.XXXXXX")"
chmod 0700 "$TEMP_ROOT"
cleanup() {
  if [[ -n "$TEMP_ROOT" && "$TEMP_ROOT" == "${TMPDIR:-/tmp}/devflow-bootstrap."* && -d "$TEMP_ROOT" ]]; then
    rm -rf -- "$TEMP_ROOT"
  fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

CHECKOUT="$TEMP_ROOT/DevFlow"
log "Obtendo $REPOSITORY_URL ($SELECTED_REF)."
GIT_TERMINAL_PROMPT=0 git clone --quiet --branch "$SELECTED_REF" --single-branch "$REPOSITORY_URL" "$CHECKOUT"

[[ -d "$CHECKOUT/.git" ]] || die 'O download não produziu um checkout Git válido.'
[[ "$(git -C "$CHECKOUT" remote get-url origin)" == "$REPOSITORY_URL" ]] || die 'Remote do checkout público divergente.'
[[ "$(git -C "$CHECKOUT" branch --show-current)" == "$SELECTED_REF" ]] || die 'Branch obtida é diferente da selecionada.'
[[ -z "$(git -C "$CHECKOUT" status --porcelain)" ]] || die 'Checkout público contém alterações inesperadas.'
COMMIT="$(git -C "$CHECKOUT" rev-parse HEAD)"
REMOTE_COMMIT="$(GIT_TERMINAL_PROMPT=0 git -C "$CHECKOUT" ls-remote origin "refs/heads/$SELECTED_REF" | awk 'NR==1 {print $1}')"
[[ "$COMMIT" =~ ^[0-9a-f]{40}$ && "$COMMIT" == "$REMOTE_COMMIT" ]] || die 'Commit baixado não corresponde ao GitHub.'
git -C "$CHECKOUT" fsck --strict --no-dangling >/dev/null

VERSION="$(tr -d '\r\n' < "$CHECKOUT/VERSION")"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || die 'Arquivo VERSION inválido.'
[[ "$VERSION" == "$EXPECTED_VERSION" ]] || die "Bootstrap $EXPECTED_VERSION incompatível com a versão obtida $VERSION."
[[ -x "$CHECKOUT/scripts/install.sh" ]] || die 'Instalador interno ausente ou sem permissão de execução.'

SELF_PATH="$(readlink -f "$0" 2>/dev/null || true)"
if [[ -n "$SELF_PATH" && -f "$SELF_PATH" ]]; then
  cmp -s "$SELF_PATH" "$CHECKOUT/scripts/bootstrap.sh" \
    || die 'O bootstrap baixado não corresponde mais à main; baixe-o novamente.'
fi

INSTALL_ARGS=("--$MODE")
if [[ "$MODE" != check ]]; then
  INSTALL_ARGS+=(--proxy-mode "$PROXY_MODE" --domain "$DOMAIN" \
    --letsencrypt-email "$LETSENCRYPT_EMAIL" --super-admin-email "$SUPER_ADMIN_EMAIL" \
    --http-port "$HTTP_PORT" --api-port "$API_PORT")
fi

log "Checkout validado: versão=$VERSION commit=$COMMIT branch=$SELECTED_REF."
if [[ "$MODE" == install ]]; then
  DEVFLOW_BOOTSTRAP_CONFIRMED=true "$CHECKOUT/scripts/install.sh" "${INSTALL_ARGS[@]}"
else
  "$CHECKOUT/scripts/install.sh" "${INSTALL_ARGS[@]}"
fi
log "Bootstrap concluído no modo $MODE; arquivos temporários serão removidos."
