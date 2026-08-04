#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

REPOSITORY_URL='https://github.com/trinityrrocha/DevFlow.git'
SELECTED_REF=main
EXPECTED_VERSION=
TEMP_ROOT=
FORWARDED_ARGS=()

log() { printf '%s [bootstrap] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }
die() { log "ERRO: $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
DevFlow - bootstrap publico da instalacao isolada

Uso principal:
  sudo ./install.sh

Automacao:
  ./install.sh --check
  sudo ./install.sh --dry-run --domain HOST --admin-email EMAIL
  sudo ./install.sh --install --domain HOST --admin-email EMAIL
  sudo ./install.sh --resume
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check|--dry-run|--install|--resume)
      FORWARDED_ARGS+=("$1"); shift ;;
    --domain|--admin-email|--email)
      [[ -n "${2:-}" ]] || die "$1 exige um valor."
      FORWARDED_ARGS+=("$1" "$2"); shift 2 ;;
    --expected-version)
      [[ -n "${2:-}" ]] || die '--expected-version exige um valor.'
      EXPECTED_VERSION="$2"
      FORWARDED_ARGS+=("$1" "$2"); shift 2 ;;
    --ref)
      [[ -n "${2:-}" ]] || die '--ref exige um valor.'
      SELECTED_REF="$2"; shift 2 ;;
    --proxy-mode|--provider|--install-scope|--letsencrypt-email|--super-admin-email|--install-internal|--http-port|--api-port)
      die "O parametro $1 foi descontinuado; o DevFlow possui somente instalacao isolada."
      ;;
    --help|-h) usage; exit 0 ;;
    *) die "Opcao desconhecida: $1" ;;
  esac
done

[[ "$(uname -s)" == Linux ]] || die 'Este bootstrap pode ser executado somente em Linux.'
[[ "$SELECTED_REF" == main ]] || die 'A instalacao alpha suporta somente a referencia main.'
[[ -z "$EXPECTED_VERSION" || "$EXPECTED_VERSION" =~ ^[0-9A-Za-z.+-]+$ ]] \
  || die 'Versao esperada invalida.'
for command_name in git mktemp rm chmod date awk readlink stat id; do
  command -v "$command_name" >/dev/null 2>&1 || die "Dependencia minima ausente: $command_name"
done

TEMP_PARENT="$(readlink -f "${TMPDIR:-/tmp}")"
[[ "$TEMP_PARENT" == /* && -d "$TEMP_PARENT" ]] || die 'Diretorio temporario invalido.'
TEMP_ROOT="$(mktemp -d "$TEMP_PARENT/devflow-bootstrap.XXXXXX")"
chmod 0700 "$TEMP_ROOT"
cleanup() {
  if [[ -n "$TEMP_ROOT" && "$TEMP_ROOT" == "$TEMP_PARENT/devflow-bootstrap."* \
    && -d "$TEMP_ROOT" && ! -L "$TEMP_ROOT" ]]; then
    rm -rf -- "$TEMP_ROOT"
  fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

CHECKOUT="$TEMP_ROOT/DevFlow"
log 'Baixando e validando trinityrrocha/DevFlow main.'
GIT_TERMINAL_PROMPT=0 git -c http.followRedirects=false clone --quiet \
  --branch main --single-branch "$REPOSITORY_URL" "$CHECKOUT"
[[ -d "$CHECKOUT/.git" && ! -L "$CHECKOUT/.git" ]] || die 'Checkout Git invalido.'
[[ "$(git -C "$CHECKOUT" remote get-url origin)" == "$REPOSITORY_URL" ]] || die 'Remote divergente.'
[[ "$(git -C "$CHECKOUT" branch --show-current)" == main \
  && -z "$(git -C "$CHECKOUT" status --porcelain)" ]] || die 'Checkout main inconsistente.'
COMMIT="$(git -C "$CHECKOUT" rev-parse HEAD)"
REMOTE_COMMIT="$(GIT_TERMINAL_PROMPT=0 git -c http.followRedirects=false -C "$CHECKOUT" \
  ls-remote origin refs/heads/main | awk 'NR==1 {print $1}')"
[[ "$COMMIT" =~ ^[0-9a-f]{40}$ && "$COMMIT" == "$REMOTE_COMMIT" ]] \
  || die 'Commit baixado diverge de origin/main.'
git -C "$CHECKOUT" fsck --strict --no-dangling >/dev/null
for trusted_file in VERSION scripts/lib/version.sh scripts/install.sh; do
  git -C "$CHECKOUT" ls-files --error-unmatch "$trusted_file" >/dev/null 2>&1 \
    || die "Arquivo obrigatorio nao rastreado: $trusted_file"
  [[ -f "$CHECKOUT/$trusted_file" && ! -L "$CHECKOUT/$trusted_file" ]] \
    || die "Arquivo obrigatorio invalido: $trusted_file"
done
# shellcheck source=lib/version.sh
. "$CHECKOUT/scripts/lib/version.sh"
DETECTED_VERSION="$(devflow_validate_checkout_version_consistency "$CHECKOUT")" \
  || die 'O checkout possui versoes divergentes.'
if [[ -n "$EXPECTED_VERSION" && "$EXPECTED_VERSION" != "$DETECTED_VERSION" ]]; then
  devflow_version_mismatch_message main "$EXPECTED_VERSION" "$DETECTED_VERSION" "$COMMIT" >&2
  exit 1
fi
[[ -x "$CHECKOUT/scripts/install.sh" ]] || die 'Instalador interno sem permissao de execucao.'

printf 'repository=trinityrrocha/DevFlow\nref=main\nversion=%s\ncommit=%s\n' \
  "$DETECTED_VERSION" "$COMMIT"
DEVFLOW_BOOTSTRAP_REF=main "$CHECKOUT/scripts/install.sh" "${FORWARDED_ARGS[@]}"
log "Bootstrap concluido; version=$DETECTED_VERSION commit=$COMMIT"
