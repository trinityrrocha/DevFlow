#!/usr/bin/env bash

DEVFLOW_CANONICAL_REPOSITORY_URL='https://github.com/trinityrrocha/DevFlow.git'

devflow_semver_is_valid() {
  local version="${1:-}" main core prerelease= build= major minor patch identifier
  local -a identifiers
  [[ -n "$version" && "$version" != *[[:space:]]* ]] || return 1
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]] || return 1

  main="${version%%+*}"
  [[ "$version" != *+* ]] || build="${version#*+}"
  core="${main%%-*}"
  [[ "$main" != *-* ]] || prerelease="${main#*-}"
  IFS='.' read -r major minor patch <<< "$core"
  for identifier in "$major" "$minor" "$patch"; do
    [[ "$identifier" == 0 || "$identifier" != 0* ]] || return 1
  done

  if [[ -n "$prerelease" ]]; then
    [[ "$prerelease" != .* && "$prerelease" != *. && "$prerelease" != *..* ]] || return 1
    IFS='.' read -r -a identifiers <<< "$prerelease"
    for identifier in "${identifiers[@]}"; do
      [[ "$identifier" =~ ^[0-9A-Za-z-]+$ ]] || return 1
      if [[ "$identifier" =~ ^[0-9]+$ ]]; then
        [[ "$identifier" == 0 || "$identifier" != 0* ]] || return 1
      fi
    done
  fi

  if [[ -n "$build" ]]; then
    [[ "$build" != .* && "$build" != *. && "$build" != *..* ]] || return 1
    IFS='.' read -r -a identifiers <<< "$build"
    for identifier in "${identifiers[@]}"; do
      [[ "$identifier" =~ ^[0-9A-Za-z-]+$ ]] || return 1
    done
  fi
}

devflow_ref_is_valid() {
  local ref="${1:-}"
  [[ "$ref" == main ]] && return 0
  [[ "$ref" == v* ]] || return 1
  devflow_semver_is_valid "${ref#v}"
}

devflow_validate_checkout_identity() {
  local root="${1:-}" ref="${2:-}" expected_commit="${3:-}" head_commit current_branch tagged_commit
  [[ -n "$root" && -d "$root/.git" && ! -L "$root/.git" ]] || return 1
  devflow_ref_is_valid "$ref" || return 1
  [[ "$(git -C "$root" remote get-url origin 2>/dev/null || true)" == "$DEVFLOW_CANONICAL_REPOSITORY_URL" ]] || return 1
  [[ -z "$(git -C "$root" status --porcelain 2>/dev/null || true)" ]] || return 1
  head_commit="$(git -C "$root" rev-parse HEAD 2>/dev/null || true)"
  [[ "$head_commit" =~ ^[0-9a-f]{40}$ && "$head_commit" == "$expected_commit" ]] || return 1
  current_branch="$(git -C "$root" branch --show-current 2>/dev/null || true)"
  if [[ "$ref" == main ]]; then
    [[ "$current_branch" == main ]] || return 1
  else
    [[ -z "$current_branch" ]] || return 1
    tagged_commit="$(git -C "$root" rev-parse "$ref^{commit}" 2>/dev/null || true)"
    [[ "$tagged_commit" == "$head_commit" ]] || return 1
  fi
  git -C "$root" ls-files --error-unmatch VERSION >/dev/null 2>&1 || return 1
  [[ -f "$root/VERSION" && ! -L "$root/VERSION" ]] || return 1
}

resolve_installed_release_identity() {
  local source_dir="${1:-${DEVFLOW_INSTALL_ROOT:-/opt/devflow}/source}"
  local expected_ref="${2:-main}" release_root
  local installed_version installed_commit installed_repository installed_ref current_branch

  [[ "$source_dir" == /* && -d "$source_dir/.git" && ! -L "$source_dir/.git" ]] || return 20
  installed_repository="$(git -C "$source_dir" remote get-url origin 2>/dev/null || true)"
  [[ "$installed_repository" == "$DEVFLOW_CANONICAL_REPOSITORY_URL" ]] || return 21
  [[ -z "$(git -C "$source_dir" status --porcelain 2>/dev/null || printf invalid)" ]] || return 22
  installed_commit="$(git -C "$source_dir" rev-parse HEAD 2>/dev/null || true)"
  [[ "$installed_commit" =~ ^[0-9a-f]{40}$ ]] || return 23
  git -C "$source_dir" cat-file -e "$installed_commit^{commit}" 2>/dev/null || return 23
  current_branch="$(git -C "$source_dir" branch --show-current 2>/dev/null || true)"
  if [[ "$expected_ref" == main ]]; then
    [[ "$current_branch" == main ]] || return 24
    installed_ref=main
  else
    devflow_ref_is_valid "$expected_ref" || return 24
    [[ -z "$current_branch" && "$(git -C "$source_dir" rev-parse "$expected_ref^{commit}" 2>/dev/null || true)" == "$installed_commit" ]] \
      || return 24
    installed_ref="$expected_ref"
  fi
  installed_version="$(devflow_validate_directory_version_consistency "$source_dir")" || return 25

  release_root="${DEVFLOW_IDENTITY_RELEASE_ROOT:-${DEVFLOW_APP_ROOT:-${DEVFLOW_INSTALL_ROOT:-/opt/devflow}/app}}"
  if [[ -e "$release_root" ]]; then
    [[ -r "$release_root/VERSION" && -r "$release_root/.devflow-release" ]] || return 26
    [[ "$(devflow_read_version_file "$release_root/VERSION" 2>/dev/null || true)" == "$installed_version" ]] || return 26
    [[ "$(tr -d '\r\n' < "$release_root/.devflow-release")" == "$installed_commit" ]] || return 26
  fi

  INSTALLED_VERSION="$installed_version"
  INSTALLED_COMMIT="$installed_commit"
  INSTALLED_REF="$installed_ref"
  INSTALLED_REPOSITORY="$installed_repository"
  export INSTALLED_VERSION INSTALLED_COMMIT INSTALLED_REF INSTALLED_REPOSITORY
  printf '%s\n' \
    "installed_version=$INSTALLED_VERSION" \
    "installed_commit=$INSTALLED_COMMIT" \
    "installed_ref=$INSTALLED_REF" \
    "installed_repository=$INSTALLED_REPOSITORY"
}

devflow_read_version_file() {
  local file="${1:-}" line_count version
  [[ -n "$file" && -f "$file" && ! -L "$file" && -r "$file" ]] || return 1
  [[ "$(wc -c < "$file" | tr -d ' ')" -le 128 ]] || return 1
  line_count="$(awk 'END { print NR }' "$file")"
  [[ "$line_count" == 1 ]] || return 1
  IFS= read -r version < "$file" || [[ -n "$version" ]] || return 1
  [[ "$version" != *$'\r'* ]] || return 1
  devflow_semver_is_valid "$version" || return 1
  printf '%s\n' "$version"
}

devflow_package_version() {
  local file="${1:-}" version count
  [[ -f "$file" && ! -L "$file" && -r "$file" ]] || return 1
  count="$(grep -Ec '^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"[^"]+",?[[:space:]]*$' "$file" || true)"
  [[ "$count" == 1 ]] || return 1
  version="$(sed -nE 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"([^"]+)",?[[:space:]]*$/\1/p' "$file")"
  devflow_semver_is_valid "$version" || return 1
  printf '%s\n' "$version"
}

devflow_validate_directory_version_consistency() {
  local root="${1:-}" version package_file package_version
  [[ -n "$root" && -d "$root" ]] || return 1
  version="$(devflow_read_version_file "$root/VERSION")" || return 1

  for package_file in package.json backend/package.json frontend/package.json; do
    package_version="$(devflow_package_version "$root/$package_file")" || return 1
    [[ "$package_version" == "$version" ]] || return 1
  done

  grep -Fq "default('$version')" "$root/backend/src/config/env.js" || return 1
  grep -Fq 'version: env.DEVFLOW_VERSION' "$root/backend/src/app.js" || return 1
  grep -Fqx "DEVFLOW_VERSION=$version" "$root/.env.example" || return 1
  grep -Fq "DEVFLOW_VERSION:-$version" "$root/docker-compose.yml" || return 1
  grep -Fq "DEVFLOW_VERSION:-$version" "$root/docker-compose.maintenance.yml" || return 1
  grep -Fq 'image: devflow-backend:${DEVFLOW_IMAGE_TAG:-latest}' "$root/docker-compose.yml" || return 1
  grep -Fq 'image: devflow-frontend:${DEVFLOW_IMAGE_TAG:-latest}' "$root/docker-compose.yml" || return 1
  grep -Fq "Versao atual: **$version**" "$root/README.md" || return 1
  grep -Fq "## [$version]" "$root/CHANGELOG.md" || return 1
  grep -Fq "Versao: \`$version\`" "$root/docs/implementation-status.md" || return 1
  grep -Fq "Versao \`$version\`" "$root/docs/infrastructure/vps-installation.md" || return 1
  grep -Fq "## Marco \`$version\`" "$root/docs/roadmap.md" || return 1
  grep -Fq "## Instalacao isolada \`$version\`" "$root/docs/traceability.md" || return 1
  grep -Fq 'scripts/lib/version.sh' "$root/scripts/bootstrap.sh" || return 1
  for package_file in scripts/install.sh scripts/update.sh scripts/version.sh scripts/health.sh \
    scripts/uninstall.sh scripts/diagnose.sh scripts/renew-certificate.sh; do
    grep -Fq 'lib/common.sh' "$root/$package_file" || return 1
  done
  grep -Eq "EXPECTED_VERSION=['\"][0-9]" "$root/scripts/bootstrap.sh" && return 1
  printf '%s\n' "$version"
}

devflow_validate_checkout_version_consistency() {
  local root="${1:-}" tracked_file expected_mode
  [[ -n "$root" && -d "$root/.git" ]] || return 1
  for tracked_file in VERSION package.json backend/package.json frontend/package.json \
    backend/src/config/env.js backend/src/app.js backend/scripts/migration-image-contract.js \
    .env.example docker-compose.yml docker/nginx.runtime.conf.template docker/updater/Dockerfile \
    docker-compose.maintenance.yml README.md CHANGELOG.md docs/implementation-status.md \
    docs/infrastructure/vps-installation.md docs/roadmap.md docs/traceability.md \
    scripts/bootstrap.sh scripts/install.sh scripts/update.sh scripts/version.sh scripts/health.sh \
    scripts/backup.sh scripts/verify-backup.sh scripts/restore.sh \
    scripts/uninstall.sh scripts/diagnose.sh scripts/repair-installation-state.sh \
    scripts/renew-certificate.sh scripts/updater-daemon.sh \
    scripts/update-cli.sh scripts/update-bootstrap.sh scripts/write-update-status.mjs \
    scripts/validate-updater-request.mjs scripts/validate-update-workflow.mjs \
    scripts/validate-update-transaction.py scripts/validate-update-transaction.mjs \
    scripts/validate-shell-syntax.mjs \
    scripts/validate-bootstrap-interface.mjs scripts/validate-updater-installation-lifecycle.mjs \
    scripts/validate-auth-state-recovery.mjs \
    scripts/resolve-compose-image.py \
    scripts/validate-isolated-architecture.mjs scripts/audit-compose-command.mjs \
    scripts/validate-installation-state.py scripts/validate-installation-state.mjs \
    scripts/validate-migration-image-permissions.mjs scripts/lib/common.sh scripts/lib/version.sh \
    scripts/lib/compose-images.sh scripts/lib/install-transaction.sh; do
    git -C "$root" ls-files --error-unmatch "$tracked_file" >/dev/null 2>&1 || return 1
    expected_mode=100644
    [[ "$tracked_file" != scripts/*.sh || "$tracked_file" == scripts/lib/* ]] || expected_mode=100755
    [[ "$(git -C "$root" ls-files -s "$tracked_file" | awk '{print $1}')" == "$expected_mode" ]] || return 1
    [[ -f "$root/$tracked_file" && ! -L "$root/$tracked_file" ]] || return 1
  done
  devflow_validate_directory_version_consistency "$root"
}

devflow_validate_git_tree_version_consistency() {
  local repository="${1:-}" commit="${2:-}" temporary version
  [[ -d "$repository" && "$commit" =~ ^[0-9a-f]{40}$ ]] || return 1
  git -C "$repository" cat-file -e "$commit^{commit}" 2>/dev/null || return 1
  temporary="$(mktemp -d "${TMPDIR:-/tmp}/devflow-version-tree.XXXXXX")" || return 1
  chmod 0700 "$temporary"
  if ! git -C "$repository" archive "$commit" \
    VERSION package.json backend/package.json frontend/package.json backend/src/config/env.js \
    backend/src/app.js backend/scripts/migration-image-contract.js .env.example docker-compose.yml \
    docker/nginx.runtime.conf.template docker/updater/Dockerfile \
    docker-compose.maintenance.yml README.md \
    CHANGELOG.md docs/implementation-status.md docs/infrastructure/vps-installation.md \
    docs/roadmap.md docs/traceability.md scripts/bootstrap.sh scripts/install.sh scripts/update.sh \
    scripts/version.sh scripts/health.sh scripts/backup.sh scripts/verify-backup.sh scripts/restore.sh \
    scripts/uninstall.sh scripts/diagnose.sh \
    scripts/repair-installation-state.sh \
    scripts/renew-certificate.sh scripts/updater-daemon.sh scripts/update-cli.sh \
    scripts/update-bootstrap.sh scripts/write-update-status.mjs scripts/validate-updater-request.mjs \
    scripts/validate-update-workflow.mjs scripts/validate-update-transaction.py \
    scripts/validate-update-transaction.mjs \
    scripts/validate-shell-syntax.mjs scripts/validate-bootstrap-interface.mjs \
    scripts/validate-updater-installation-lifecycle.mjs scripts/validate-auth-state-recovery.mjs \
    scripts/resolve-compose-image.py scripts/validate-isolated-architecture.mjs \
    scripts/audit-compose-command.mjs \
    scripts/validate-installation-state.py scripts/validate-installation-state.mjs \
    scripts/validate-migration-image-permissions.mjs scripts/lib/common.sh scripts/lib/version.sh \
    scripts/lib/compose-images.sh scripts/lib/install-transaction.sh \
    | tar -x -C "$temporary"; then
    rm -rf -- "$temporary"
    return 1
  fi
  version="$(devflow_validate_directory_version_consistency "$temporary")" || {
    rm -rf -- "$temporary"
    return 1
  }
  rm -rf -- "$temporary"
  printf '%s\n' "$version"
}

devflow_version_is_greater() {
  local candidate="${1:-}" installed="${2:-}"
  local candidate_major candidate_minor candidate_patch candidate_pre
  local installed_major installed_minor installed_patch installed_pre
  local index candidate_part installed_part
  local -a candidate_parts installed_parts

  devflow_semver_is_valid "$candidate" && devflow_semver_is_valid "$installed" || return 2
  candidate_major="${candidate%%.*}"
  candidate_minor="${candidate#*.}"; candidate_minor="${candidate_minor%%.*}"
  candidate_patch="${candidate#*.*.}"; candidate_patch="${candidate_patch%%[-+]*}"
  installed_major="${installed%%.*}"
  installed_minor="${installed#*.}"; installed_minor="${installed_minor%%.*}"
  installed_patch="${installed#*.*.}"; installed_patch="${installed_patch%%[-+]*}"
  candidate_pre="${candidate%%+*}"; [[ "$candidate_pre" == *-* ]] && candidate_pre="${candidate_pre#*-}" || candidate_pre=
  installed_pre="${installed%%+*}"; [[ "$installed_pre" == *-* ]] && installed_pre="${installed_pre#*-}" || installed_pre=

  for index in major minor patch; do
    candidate_part="candidate_$index"
    installed_part="installed_$index"
    if (( 10#${!candidate_part} > 10#${!installed_part} )); then return 0; fi
    if (( 10#${!candidate_part} < 10#${!installed_part} )); then return 1; fi
  done
  [[ "$candidate_pre" != "$installed_pre" ]] || return 1
  [[ -z "$installed_pre" ]] && return 1
  [[ -z "$candidate_pre" ]] && return 0
  IFS='.' read -r -a candidate_parts <<< "$candidate_pre"
  IFS='.' read -r -a installed_parts <<< "$installed_pre"
  for ((index = 0; index < ${#candidate_parts[@]} || index < ${#installed_parts[@]}; index++)); do
    [[ -n "${candidate_parts[index]+set}" ]] || return 1
    [[ -n "${installed_parts[index]+set}" ]] || return 0
    candidate_part="${candidate_parts[index]}"
    installed_part="${installed_parts[index]}"
    [[ "$candidate_part" != "$installed_part" ]] || continue
    if [[ "$candidate_part" =~ ^[0-9]+$ && "$installed_part" =~ ^[0-9]+$ ]]; then
      (( 10#$candidate_part > 10#$installed_part )) && return 0 || return 1
    elif [[ "$candidate_part" =~ ^[0-9]+$ ]]; then
      return 1
    elif [[ "$installed_part" =~ ^[0-9]+$ ]]; then
      return 0
    fi
    [[ "$candidate_part" > "$installed_part" ]]
    return
  done
  return 1
}

devflow_version_mismatch_message() {
  local ref="$1" expected="$2" detected="$3" commit="$4"
  cat <<EOF
Versão divergente.

Referência solicitada: $ref
Versão esperada: $expected
Versão encontrada: $detected
Commit encontrado: $commit

Nenhuma alteração foi realizada.
EOF
}
