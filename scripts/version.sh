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

--installed  mostra versão e commit instalados (padrão)
--available  mostra versão e commit disponíveis em origin/main
--all        mostra ambos
--refresh    executa fetch somente leitura antes de consultar origin/main
EOF
      exit 0
      ;;
    *) die "Opção desconhecida: $1" ;;
  esac
done

installed_version=unknown
installed_commit=unknown
config_loaded=false
if [[ -r "$DEVFLOW_ENV_FILE" ]]; then
  load_devflow_env
  config_loaded=true
fi
if [[ -r "$DEVFLOW_INSTALL_ROOT/app/VERSION" ]]; then
  installed_version="$(devflow_read_version_file "$DEVFLOW_INSTALL_ROOT/app/VERSION")" || die 'Versão instalada inválida.'
elif [[ "$config_loaded" == true && "${DEVFLOW_VERSION:-}" != "" ]]; then
  installed_version="${DEVFLOW_VERSION:-unknown}"
fi
if [[ -r "$DEVFLOW_INSTALL_ROOT/app/.devflow-release" ]]; then
  installed_commit="$(tr -d '\r\n' < "$DEVFLOW_INSTALL_ROOT/app/.devflow-release")"
fi
[[ "$installed_version" == unknown ]] || devflow_semver_is_valid "$installed_version" || die 'Versão instalada inválida.'
[[ "$installed_commit" == unknown || "$installed_commit" =~ ^[0-9a-f]{40}$ ]] \
  || die 'Commit instalado inválido.'

available_version=unknown
available_commit=unknown
if [[ "$MODE" != installed ]]; then
  source_dir="${DEVFLOW_SOURCE_DIR:-}"
  if [[ -z "$source_dir" ]] && git -C "$DEVFLOW_SOURCE_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    source_dir="$DEVFLOW_SOURCE_ROOT"
  fi
  if [[ -n "$source_dir" && -d "$source_dir/.git" ]]; then
    remote_url="$(git -C "$source_dir" remote get-url origin 2>/dev/null || true)"
    [[ "$remote_url" == 'https://github.com/trinityrrocha/DevFlow.git' ]] \
      || die 'O remote origin não corresponde ao HTTPS público de trinityrrocha/DevFlow.'
    if [[ "$REFRESH" == true ]]; then
      GIT_TERMINAL_PROMPT=0 git -C "$source_dir" fetch --quiet origin main
    fi
    available_commit="$(git -C "$source_dir" rev-parse origin/main 2>/dev/null || true)"
    available_version="$(devflow_validate_git_tree_version_consistency "$source_dir" "$available_commit" 2>/dev/null || true)"
    [[ -n "$available_version" ]] || available_version=unknown
    [[ -n "$available_commit" ]] || available_commit=unknown
    devflow_semver_is_valid "$available_version" || die 'Versão disponível inválida ou inconsistente.'
    [[ "$available_commit" =~ ^[0-9a-f]{40}$ ]] || die 'Commit disponível inválido.'
  fi
fi

case "$MODE" in
  installed)
    printf 'installed_version=%s\ninstalled_commit=%s\n' "$installed_version" "$installed_commit"
    ;;
  available)
    printf 'available_version=%s\navailable_commit=%s\n' "$available_version" "$available_commit"
    ;;
  all)
    printf 'installed_version=%s\ninstalled_commit=%s\navailable_version=%s\navailable_commit=%s\n' \
      "$installed_version" "$installed_commit" "$available_version" "$available_commit"
    ;;
esac
