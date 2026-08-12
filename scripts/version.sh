#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

MODE=installed
REFRESH=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --installed) MODE=installed; shift ;;
    --available) MODE=available; shift ;;
    --all) MODE=all; shift ;;
    --refresh) REFRESH=true; shift ;;
    --help|-h)
      cat <<'EOF'
Uso: scripts/version.sh [--installed|--available|--all] [--refresh]

--installed  mostra versao e commit da release ativa (padrao)
--available  mostra versao e commit disponiveis em origin/main
--all        mostra ambos
--refresh    executa fetch somente leitura antes de consultar origin/main
EOF
      exit 0
      ;;
    *) die "Opcao desconhecida: $1" ;;
  esac
done

installed_version=unknown
installed_commit=unknown
if [[ -r "$DEVFLOW_ENV_FILE" ]]; then load_devflow_env; fi
if [[ -r "$DEVFLOW_STATE_ROOT/installation.json" ]]; then
  load_installation_state "$DEVFLOW_STATE_ROOT/installation.json" \
    || die 'A identidade da release instalada nao pode ser comprovada.'
  active_release="$(readlink -f "$DEVFLOW_INSTALL_ROOT/app" 2>/dev/null || true)"
  valid_devflow_release_target "$active_release" \
    || die 'A identidade da release instalada nao pode ser comprovada.'
  active_commit="$(tr -d '\r\n' < "$active_release/.devflow-release")"
  active_version="$(devflow_read_version_file "$active_release/VERSION" 2>/dev/null || true)"
  [[ "$active_commit" == "$DEVFLOW_INSTALLATION_STATE_COMMIT" \
    && "$active_version" == "$DEVFLOW_INSTALLATION_STATE_VERSION" ]] \
    || die 'A identidade da release instalada nao pode ser comprovada.'
  [[ -d "$DEVFLOW_INSTALL_ROOT/source/.git" ]] \
    && git -C "$DEVFLOW_INSTALL_ROOT/source" cat-file -e "$active_commit^{commit}" 2>/dev/null \
    || die 'O commit da release instalada nao existe no checkout operacional.'
  installed_version="$active_version"
  installed_commit="$active_commit"
fi
[[ "$installed_version" == unknown ]] || devflow_semver_is_valid "$installed_version" \
  || die 'Versao instalada invalida.'
[[ "$installed_commit" == unknown || "$installed_commit" =~ ^[0-9a-f]{40}$ ]] \
  || die 'Commit instalado invalido.'

available_version=unknown
available_commit=unknown
if [[ "$MODE" != installed ]]; then
  source_dir="${DEVFLOW_SOURCE_DIR:-}"
  if [[ -z "$source_dir" ]] && git -C "$DEVFLOW_SOURCE_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    source_dir="$DEVFLOW_SOURCE_ROOT"
  fi
  if [[ -n "$source_dir" && -d "$source_dir/.git" ]]; then
    remote_url="$(git -C "$source_dir" remote get-url origin 2>/dev/null || true)"
    case "$remote_url" in
      'https://github.com/trinityrrocha/DevFlow'|'https://github.com/trinityrrocha/DevFlow.git'|'git@github.com:trinityrrocha/DevFlow.git') ;;
      *) die 'O remote origin nao corresponde a trinityrrocha/DevFlow.' ;;
    esac
    if [[ "$REFRESH" == true ]]; then
      GIT_TERMINAL_PROMPT=0 git -C "$source_dir" fetch --quiet origin main
    fi
    available_commit="$(git -C "$source_dir" rev-parse origin/main 2>/dev/null || true)"
    available_version="$(devflow_validate_git_tree_version_consistency "$source_dir" "$available_commit" 2>/dev/null || true)"
    [[ -n "$available_version" ]] || available_version=unknown
    [[ -n "$available_commit" ]] || available_commit=unknown
    devflow_semver_is_valid "$available_version" || die 'Versao disponivel invalida ou inconsistente.'
    [[ "$available_commit" =~ ^[0-9a-f]{40}$ ]] || die 'Commit disponivel invalido.'
  fi
fi

case "$MODE" in
  installed) printf 'installed_version=%s\ninstalled_commit=%s\n' "$installed_version" "$installed_commit" ;;
  available) printf 'available_version=%s\navailable_commit=%s\n' "$available_version" "$available_commit" ;;
  all)
    printf 'installed_version=%s\ninstalled_commit=%s\navailable_version=%s\navailable_commit=%s\n' \
      "$installed_version" "$installed_commit" "$available_version" "$available_commit"
    ;;
esac
