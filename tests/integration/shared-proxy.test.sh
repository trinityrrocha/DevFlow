#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=../../scripts/detect-shared-proxy.sh
. "$ROOT/scripts/detect-shared-proxy.sh"
# shellcheck source=../../scripts/lib/proxy-config.sh
. "$ROOT/scripts/lib/proxy-config.sh"

passed=0

expect_policy() {
  local expected="$1" scenario="$2"
  if assess_shared_proxy_compatibility; then status=0; else status=$?; fi
  [[ "$COMPATIBILITY" == "$expected" ]] || { echo "Falha em $scenario: $COMPATIBILITY" >&2; exit 1; }
  if [[ "$expected" == compatible ]]; then
    [[ "$status" -eq 0 ]] || exit 1
  else
    [[ "$status" -eq 2 ]] || exit 1
  fi
  passed=$((passed + 1))
}

reset_facts() {
  PROXY_TYPE=host-nginx
  CONFIG_VALID=true
  PERSISTENT_CONFIG=true
  DOMAIN_CONFLICT=false
  PORT_CONFLICT=false
  RELOAD_PROVEN=true
  CERTIFICATE_METHOD=certbot-host
}

reset_facts; PROXY_TYPE=none; expect_policy blocked proxy-inexistente
reset_facts; expect_policy compatible nginx-host
reset_facts; PROXY_TYPE=nginx-container; expect_policy blocked nginx-containerizado
reset_facts; PROXY_TYPE=fullpassword-nginx; expect_policy blocked fullpassword-nginx
reset_facts; PROXY_TYPE=caddy-host; expect_policy blocked caddy-nao-suportado
reset_facts; PERSISTENT_CONFIG=false; expect_policy blocked persistencia-ausente
reset_facts; CONFIG_VALID=false; expect_policy blocked configuracao-invalida
reset_facts; DOMAIN_CONFLICT=true; expect_policy blocked conflito-dominio
reset_facts; PORT_CONFLICT=true; expect_policy blocked conflito-porta
reset_facts; RELOAD_PROVEN=false; expect_policy blocked reload-nao-comprovado

private_key_begin='-----BEGIN PRIVATE'' KEY-----'
private_key_end='-----END PRIVATE'' KEY-----'
sanitized="$(printf '%s\n' \
  'proxy_set_header Authorization Bearer secret-value;' \
  "$private_key_begin" \
  'sensitive-material' \
  "$private_key_end" | sanitize_proxy_stream)"
[[ "$sanitized" == *'[SENSITIVE HEADER REDACTED]'* && "$sanitized" == *'[PRIVATE KEY REDACTED]'* ]]
[[ "$sanitized" != *'secret-value'* && "$sanitized" != *'sensitive-material'* ]]
passed=$((passed + 1))

TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/devflow-proxy-test.XXXXXX")"
cleanup_test() {
  [[ "$TEST_ROOT" == "${TMPDIR:-/tmp}/devflow-proxy-test."* ]] && rm -rf -- "$TEST_ROOT"
}
trap cleanup_test EXIT
mkdir -p "$TEST_ROOT/bin" "$TEST_ROOT/conf.d" "$TEST_ROOT/backups" "$TEST_ROOT/state"
TARGET="$TEST_ROOT/conf.d/devflow.conf"
OTHER="$TEST_ROOT/conf.d/other.conf"
MARKER='# Managed by DevFlow installer. Do not merge with another application.'
printf 'other application\n' > "$OTHER"

cat > "$TEST_ROOT/bin/nginx" <<'EOF'
#!/usr/bin/env bash
[[ "$1" == -t ]] || exit 2
[[ ! -f "$TEST_TARGET" ]] || ! grep -q INVALID "$TEST_TARGET"
EOF
cat > "$TEST_ROOT/bin/systemctl" <<'EOF'
#!/usr/bin/env bash
[[ "$1 $2" == 'reload nginx' ]] || exit 2
count=0
[[ ! -f "$TEST_STATE/reloads" ]] || count="$(cat "$TEST_STATE/reloads")"
count=$((count + 1))
printf '%s\n' "$count" > "$TEST_STATE/reloads"
if [[ "${FAIL_RELOAD_ONCE:-false}" == true && "$count" -eq 1 ]]; then exit 1; fi
exit 0
EOF
cat > "$TEST_ROOT/bin/install" <<'EOF'
#!/usr/bin/env bash
if [[ "$1" == -d ]]; then
  shift
  [[ "${1:-}" == -m ]] && shift 2
  mkdir -p -- "$@"
else
  [[ "$1" == -m ]] && shift 2
  cp -- "$1" "$2"
fi
EOF
chmod +x "$TEST_ROOT/bin/nginx" "$TEST_ROOT/bin/systemctl" "$TEST_ROOT/bin/install"
export PATH="$TEST_ROOT/bin:$PATH" TEST_TARGET="$TARGET" TEST_STATE="$TEST_ROOT/state"

make_candidate() {
  local path="$1" value="$2"
  printf '%s\nserver { %s; }\n' "$MARKER" "$value" > "$path"
}

candidate="$TEST_ROOT/candidate.conf"
make_candidate "$candidate" 'return 200'
promote_host_nginx_config "$candidate" "$TARGET" "$MARKER" "$TEST_ROOT/backups"
grep -q 'return 200' "$TARGET" || exit 1
[[ -f "$OTHER" ]] || exit 1
passed=$((passed + 1))

candidate="$TEST_ROOT/candidate-repeat.conf"
make_candidate "$candidate" 'return 201'
promote_host_nginx_config "$candidate" "$TARGET" "$MARKER" "$TEST_ROOT/backups"
grep -q 'return 201' "$TARGET" || exit 1
passed=$((passed + 1))

candidate="$TEST_ROOT/candidate-invalid.conf"
make_candidate "$candidate" INVALID
if (promote_host_nginx_config "$candidate" "$TARGET" "$MARKER" "$TEST_ROOT/backups" >/dev/null 2>&1); then exit 1; fi
grep -q 'return 201' "$TARGET" || exit 1
passed=$((passed + 1))

rm -f "$TEST_ROOT/state/reloads"
candidate="$TEST_ROOT/candidate-reload.conf"
make_candidate "$candidate" 'return 202'
if (FAIL_RELOAD_ONCE=true promote_host_nginx_config "$candidate" "$TARGET" "$MARKER" "$TEST_ROOT/backups" >/dev/null 2>&1); then exit 1; fi
grep -q 'return 201' "$TARGET" || exit 1
[[ "$(cat "$TEST_ROOT/state/reloads")" -eq 2 ]] || exit 1
passed=$((passed + 1))

rm -f "$TEST_ROOT/state/reloads"
remove_host_nginx_config "$TARGET" "$MARKER" "$TEST_ROOT/backups"
[[ ! -e "$TARGET" && -f "$OTHER" ]] || exit 1
passed=$((passed + 1))

make_candidate "$candidate" 'return 203'
promote_host_nginx_config "$candidate" "$TARGET" "$MARKER" "$TEST_ROOT/backups"
rm -f "$TEST_ROOT/state/reloads"
if (FAIL_RELOAD_ONCE=true remove_host_nginx_config "$TARGET" "$MARKER" "$TEST_ROOT/backups" >/dev/null 2>&1); then exit 1; fi
[[ -f "$TARGET" && -f "$OTHER" ]] || exit 1
passed=$((passed + 1))

printf 'Shared proxy tests passed: %s scenarios.\n' "$passed"
