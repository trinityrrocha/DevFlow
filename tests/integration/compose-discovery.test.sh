#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=../../scripts/detect-shared-proxy.sh
. "$ROOT/scripts/detect-shared-proxy.sh"

TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/devflow-compose-discovery.XXXXXX")"
cleanup_test() {
  [[ "$TEST_ROOT" == "${TMPDIR:-/tmp}/devflow-compose-discovery."* ]] && rm -rf -- "$TEST_ROOT"
}
trap cleanup_test EXIT

if [[ -n "${DEVFLOW_TEST_PYTHON:-}" ]]; then
  python3() { "$DEVFLOW_TEST_PYTHON" "$@"; }
fi

passed=0
scenario() {
  passed=$((passed + 1))
  printf 'ok %02d - %s\n' "$passed" "$1"
}

reset_discovery() {
  FULLPASSWORD_CONFIG_FILES=
  FULLPASSWORD_WORKING_DIR=
  FULLPASSWORD_COMPOSE_FILE=
  FULLPASSWORD_COMPOSE_DIR=
  FULLPASSWORD_ENV_FILE=
  FULLPASSWORD_COMPOSE_VARIABLE_INITIALIZED=true
  FULLPASSWORD_COMPOSE_DETECTED=false
  FULLPASSWORD_COMPOSE_EXISTS=false
  FULLPASSWORD_COMPOSE_READABLE=false
  compose_path_readable() { local path="${1:-}"; [[ -n "$path" && -r "$path" ]]; }
}

PROJECT="$TEST_ROOT/full password"
mkdir -p "$PROJECT"
COMPOSE="$PROJECT/docker-compose.yml"
printf 'services:\n  nginx:\n    image: nginx:alpine\n' > "$COMPOSE"

# 1. FULLPASSWORD_COMPOSE_FILE inicialmente ausente.
reset_discovery
unset FULLPASSWORD_COMPOSE_FILE
FULLPASSWORD_CONFIG_FILES="$COMPOSE"
discover_fullpassword_compose '' ''
[[ "$FULLPASSWORD_COMPOSE_FILE" == "$COMPOSE" && "$FULLPASSWORD_COMPOSE_VARIABLE_INITIALIZED" == true ]]
scenario 'variável inicialmente ausente é inicializada defensivamente'

# 2. Variável descoberta pelo valor obtido da label Compose.
reset_discovery
FULLPASSWORD_CONFIG_FILES="$COMPOSE"
discover_fullpassword_compose '' ''
[[ "$FULLPASSWORD_COMPOSE_DETECTED" == true && "$FULLPASSWORD_COMPOSE_FILE" == "$COMPOSE" ]]
scenario 'Compose é descoberto pela label'

# 3. Fallback conhecido validado.
reset_discovery
discover_fullpassword_compose '' "$COMPOSE"
[[ "$FULLPASSWORD_COMPOSE_EXISTS" == true && "$FULLPASSWORD_COMPOSE_FILE" == "$COMPOSE" ]]
scenario 'fallback existente e regular é validado'

# 4. Compose inexistente.
reset_discovery
missing="$TEST_ROOT/missing/docker-compose.yml"
status=0
discover_fullpassword_compose '' "$missing" || status=$?
[[ "$status" -eq 3 && "$FULLPASSWORD_COMPOSE_DETECTED" == true && "$FULLPASSWORD_COMPOSE_EXISTS" == false ]]
scenario 'Compose inexistente produz estado controlado'

# 5. Compose não legível.
reset_discovery
compose_path_readable() { return 1; }
status=0
discover_fullpassword_compose '' "$COMPOSE" || status=$?
[[ "$status" -eq 4 && "$FULLPASSWORD_COMPOSE_EXISTS" == true && "$FULLPASSWORD_COMPOSE_READABLE" == false ]]
scenario 'Compose não legível é bloqueado sem erro interno'

reset_compatibility() {
  BLOCKERS=()
  COMPATIBILITY=blocked
  INSTALLATION_READY=false
  PROXY_TYPE=fullpassword-nginx
  FULLPASSWORD_PROJECT=fullpassword
  FULLPASSWORD_SERVICE=nginx
  FULLPASSWORD_IMAGE=nginx:alpine
  FULLPASSWORD_WORKING_DIR=/opt/fullpassword
  FULLPASSWORD_CONFIG_FILES=/opt/fullpassword/docker-compose.yml
  FULLPASSWORD_COMPOSE_VARIABLE_INITIALIZED=true
  FULLPASSWORD_COMPOSE_DETECTED=true
  FULLPASSWORD_COMPOSE_EXISTS=true
  FULLPASSWORD_COMPOSE_READABLE=true
  FULLPASSWORD_RUNTIME_MOUNT=true
  FULLPASSWORD_CERTIFICATE_MOUNT=true
  FULLPASSWORD_ORIGINAL_NETWORK=true
  FULLPASSWORD_PORTS=true
  FULLPASSWORD_UPSTREAM_SAFE=true
  FULLPASSWORD_CERTIFICATE_SAFE=true
  NGINX_CONF_D_INCLUDED=true
  CONFIG_VALID=true
  DOMAIN_CONFLICT=false
  DEVFLOW_DIRECTORY_WRITABLE=true
  DEVFLOW_OVERRIDE_WRITABLE=true
  FULLPASSWORD_EDGE_NETWORK_SAFE=true
  COMPOSE_CROSS_DIRECTORY_SUPPORTED=true
  COMPOSE_MERGE_VALID=true
  FULLPASSWORD_ROLLBACK_READY=true
  FULLPASSWORD_PUBLIC_HEALTH=true
  PRIVILEGED_VALIDATION_REQUIRED=true
  COMPOSE_VALIDATION_BLOCKED_BY=none
}

# 6. .env protegido sem root.
reset_compatibility
execution_uid() { echo 1000; }
status=0
assess_shared_proxy_compatibility || status=$?
[[ "$status" -eq 3 && "$COMPOSE_VALIDATION_BLOCKED_BY" == protected-env-file ]]
scenario '.env protegido sem root retorna código 3'

# 7. .env protegido com root simulado.
reset_compatibility
execution_uid() { echo 0; }
assess_shared_proxy_compatibility
[[ "$COMPATIBILITY" == compatible-with-compose-override && "$INSTALLATION_READY" == true ]]
scenario '.env protegido com root simulado prossegue na validação'

INSTALL_SOURCE="$(<"$ROOT/scripts/install.sh")"
DIAGNOSTIC_SOURCE="$(<"$ROOT/scripts/detect-shared-proxy.sh")"

# 8. Execução --check.
[[ "$INSTALL_SOURCE" == *'check_status=$CHECK_STATUS'* && "$INSTALL_SOURCE" == *'changes_applied=false'* ]]
scenario '--check permanece diagnóstico básico'

# 9. Execução --dry-run sem root.
[[ "$INSTALL_SOURCE" == *'reason=privileged-compose-validation-required'* && "$INSTALL_SOURCE" == *'return 3'* ]]
scenario '--dry-run sem root encerra controladamente'

# 10. Execução --dry-run com root.
dry_run_gate="$(grep -nF 'if [[ "$MODE" == dry-run ]]; then' "$ROOT/scripts/install.sh" | cut -d: -f1 | tail -n1)"
install_gate="$(grep -nF 'install -d -m 0750 "$DEVFLOW_INSTALL_ROOT"' "$ROOT/scripts/install.sh" | cut -d: -f1)"
[[ "$dry_run_gate" -lt "$install_gate" ]]
scenario '--dry-run com root termina antes da instalação'

# 11. Ausência do container e de fallback.
reset_discovery
status=0
discover_fullpassword_compose '' '' || status=$?
[[ "$status" -eq 2 && "$FULLPASSWORD_COMPOSE_DETECTED" == false ]]
scenario 'ausência de container e fallback é controlada'

# 12. Container sem labels Compose usa somente fallback validado.
reset_discovery
FULLPASSWORD_CONFIG_FILES='<no value>'
FULLPASSWORD_WORKING_DIR='<no value>'
discover_fullpassword_compose fullpassword_nginx "$COMPOSE"
[[ "$FULLPASSWORD_COMPOSE_FILE" == "$COMPOSE" && "$FULLPASSWORD_COMPOSE_EXISTS" == true && -z "$FULLPASSWORD_CONFIG_FILES" ]]
scenario 'container sem labels utiliza fallback validado'

# 13. Label com múltiplos arquivos escolhe o Compose original primeiro.
reset_discovery
FULLPASSWORD_CONFIG_FILES="$COMPOSE,$TEST_ROOT/override.yml"
discover_fullpassword_compose '' ''
[[ "$FULLPASSWORD_COMPOSE_FILE" == "$COMPOSE" ]]
scenario 'label múltipla preserva o primeiro Compose original'

# 14. Caminho relativo retornado pela label.
reset_discovery
FULLPASSWORD_WORKING_DIR="$PROJECT"
FULLPASSWORD_CONFIG_FILES=./docker-compose.yml
discover_fullpassword_compose '' ''
[[ "$FULLPASSWORD_COMPOSE_FILE" == "$COMPOSE" ]]
scenario 'caminho relativo é normalizado pelo working directory'

# 15. Caminho absoluto válido.
reset_discovery
FULLPASSWORD_CONFIG_FILES="$COMPOSE"
discover_fullpassword_compose '' ''
[[ "$FULLPASSWORD_COMPOSE_FILE" == /* && "$FULLPASSWORD_COMPOSE_READABLE" == true ]]
scenario 'caminho absoluto válido é aceito'

# 16. Arquivo com espaços no caminho.
reset_discovery
FULLPASSWORD_CONFIG_FILES="$COMPOSE"
discover_fullpassword_compose '' ''
[[ "$FULLPASSWORD_COMPOSE_DIR" == "$PROJECT" ]]
scenario 'caminho com espaços permanece íntegro'

# 17. Limpeza de temporários.
new_diagnostic_temp
temporary="$DIAGNOSTIC_TEMP_RESULT"
cleanup_diagnostic_temps
[[ ! -e "$temporary" ]]
scenario 'temporários são removidos'

# 18. Ausência de mutações.
! grep -Eq 'docker (restart|start|stop|network create)|chmod .*fullpassword|chown .*fullpassword' <<< "$DIAGNOSTIC_SOURCE"
scenario 'diagnóstico não contém mutações do Full Password'

# 19. Nenhum erro unbound variable.
reset_discovery
output="$(
  unset FULLPASSWORD_COMPOSE_FILE
  FULLPASSWORD_CONFIG_FILES="$COMPOSE"
  discover_fullpassword_compose '' ''
  discover_protected_compose_inputs "$FULLPASSWORD_COMPOSE_FILE" "$TEST_ROOT/discovered-inputs.tsv"
  printf 'compose=%s\n' "$FULLPASSWORD_COMPOSE_FILE"
  ) 2>&1"
[[ "$output" == *"compose=$COMPOSE"* && "$output" != *'unbound variable'* ]]
trap_status=0
trap_output="$(CURRENT_OPERATION=compose-discovery; handle_internal_error 7 99 regression_test 2>&1)" || trap_status=$?
[[ "$trap_status" -eq 7 && "$trap_output" == *'script=detect-shared-proxy.sh line=99 function=regression_test exit_code=7 operation=compose-discovery'* ]]
[[ "$trap_output" == *'internal_script_error=true'* && "$trap_output" == *'changes_applied=false'* && "$trap_output" != *'SECRET_SENTINEL'* ]]
scenario 'set -u não produz unbound variable'

# 20. Nenhuma regressão do fail-closed.
reset_compatibility
FULLPASSWORD_COMPOSE_DETECTED=false
PRIVILEGED_VALIDATION_REQUIRED=false
execution_uid() { echo 1000; }
status=0
assess_shared_proxy_compatibility || status=$?
[[ "$status" -eq 2 && "$COMPATIBILITY" == blocked && "${BLOCKERS[*]}" == *'Não foi possível identificar o Compose original'* ]]
scenario 'Compose não comprovado mantém fail-closed'

[[ "$passed" -eq 20 ]] || { echo "Expected 20 Compose discovery scenarios, got $passed." >&2; exit 1; }
printf 'Compose discovery tests passed: %s scenarios.\n' "$passed"
