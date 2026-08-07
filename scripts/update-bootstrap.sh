#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

REPOSITORY='https://github.com/trinityrrocha/DevFlow.git'
BRANCH=main
TEMP_ROOT=
cleanup() { [[ -z "$TEMP_ROOT" ]] || rm -rf -- "$TEMP_ROOT"; }
trap cleanup EXIT INT TERM

[[ "$(uname -s)" == Linux ]] || { printf '%s\n' 'ERRO: bootstrap suportado somente em Linux.' >&2; exit 1; }
[[ "$(id -u)" -eq 0 ]] || { printf '%s\n' 'ERRO: execute com sudo.' >&2; exit 1; }
command -v git >/dev/null 2>&1 || { printf '%s\n' 'ERRO: Git nao encontrado.' >&2; exit 1; }

TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/devflow-update-bootstrap.XXXXXX")"
chmod 0700 "$TEMP_ROOT"
GIT_TERMINAL_PROMPT=0 git clone --quiet --branch "$BRANCH" --single-branch "$REPOSITORY" "$TEMP_ROOT/release"
detected_remote="$(git -C "$TEMP_ROOT/release" remote get-url origin)"
[[ "$detected_remote" == "$REPOSITORY" ]] || { printf '%s\n' 'ERRO: repository inesperado.' >&2; exit 1; }
detected_commit="$(git -C "$TEMP_ROOT/release" rev-parse HEAD)"
[[ "$detected_commit" =~ ^[0-9a-f]{40}$ ]] || { printf '%s\n' 'ERRO: commit invalido.' >&2; exit 1; }
git -C "$TEMP_ROOT/release" fsck --strict >/dev/null
[[ "$(git -C "$TEMP_ROOT/release" rev-parse origin/main)" == "$detected_commit" ]] \
  || { printf '%s\n' 'ERRO: commit nao corresponde a origin/main.' >&2; exit 1; }
# shellcheck source=lib/version.sh
. "$TEMP_ROOT/release/scripts/lib/version.sh"
version="$(devflow_validate_checkout_version_consistency "$TEMP_ROOT/release")" \
  || { printf '%s\n' 'ERRO: contrato de versao invalido.' >&2; exit 1; }
[[ -x "$TEMP_ROOT/release/scripts/update-cli.sh" ]] || { printf '%s\n' 'ERRO: CLI de update ausente.' >&2; exit 1; }

status=0
DEVFLOW_UPDATE_BOOTSTRAP_RELEASE="$TEMP_ROOT/release" \
  "$TEMP_ROOT/release/scripts/update-cli.sh" "$@" || status=$?
if [[ "$status" -eq 0 && "${1:-}" != --check ]]; then
  printf '%s\n' \
    'Bootstrap concluido. Se a instalacao anterior era menor que 0.6.4-alpha,' \
    'promova o container updater fora de qualquer request conforme:' \
    'docs/infrastructure/update-backup-rollback.md'
fi
cleanup
TEMP_ROOT=
trap - EXIT INT TERM
exit "$status"
