#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=../../scripts/detect-shared-proxy.sh
. "$ROOT/scripts/detect-shared-proxy.sh"

TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/devflow-privileged-compose.XXXXXX")"
cleanup_test() {
  [[ "$TEST_ROOT" == "${TMPDIR:-/tmp}/devflow-privileged-compose."* ]] && rm -rf -- "$TEST_ROOT"
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

COMPOSE_FIXTURE="$TEST_ROOT/docker-compose.yml"
printf '%s\n' \
  'services:' \
  '  nginx:' \
  '    image: "${NGINX_IMAGE:?required}"' \
  '    env_file:' \
  '      - service.env' > "$COMPOSE_FIXTURE"
printf 'NGINX_IMAGE=nginx:alpine\nSECRET_SENTINEL=never-log-this\n' > "$TEST_ROOT/.env"
printf 'SERVICE_VALUE=opaque\n' > "$TEST_ROOT/service.env"

# 1. .env legível pelo usuário comum.
inventory="$(python3 "$ROOT/scripts/discover-compose-inputs.py" "$COMPOSE_FIXTURE")"
grep -F 'project-env-file' <<< "$inventory" | grep -Fq $'true\ttrue\ttrue'
scenario '.env legível pelo usuário comum'

reset_fullpassword_facts() {
  BLOCKERS=()
  COMPATIBILITY=blocked
  INSTALLATION_READY=false
  PROXY_TYPE=fullpassword-nginx
  FULLPASSWORD_PROJECT=fullpassword
  FULLPASSWORD_SERVICE=nginx
  FULLPASSWORD_IMAGE=nginx:alpine
  FULLPASSWORD_WORKING_DIR=/opt/fullpassword
  FULLPASSWORD_CONFIG_FILES=/opt/fullpassword/docker-compose.yml
  FULLPASSWORD_RUNTIME_MOUNT=true
  FULLPASSWORD_CERTIFICATE_MOUNT=true
  FULLPASSWORD_ORIGINAL_NETWORK=true
  FULLPASSWORD_PORTS=true
  FULLPASSWORD_UPSTREAM_SAFE=true
  FULLPASSWORD_CERTIFICATE_SAFE=true
  NGINX_CONF_D_INCLUDED=true
  CONFIG_VALID=true
  DOMAIN_CONFLICT=false
  FULLPASSWORD_COMPOSE_READABLE=true
  DEVFLOW_DIRECTORY_WRITABLE=true
  DEVFLOW_OVERRIDE_WRITABLE=true
  FULLPASSWORD_EDGE_NETWORK_SAFE=true
  COMPOSE_CROSS_DIRECTORY_SUPPORTED=true
  COMPOSE_MERGE_VALID=true
  FULLPASSWORD_ROLLBACK_READY=true
  FULLPASSWORD_PUBLIC_HEALTH=true
  PRIVILEGED_VALIDATION_REQUIRED=false
  COMPOSE_VALIDATION_BLOCKED_BY=none
}

# 2. .env protegido e execução sem root.
reset_fullpassword_facts
PRIVILEGED_VALIDATION_REQUIRED=true
COMPOSE_CROSS_DIRECTORY_SUPPORTED=unknown
COMPOSE_MERGE_VALID=unknown
execution_uid() { echo 1000; }
if assess_shared_proxy_compatibility; then status=0; else status=$?; fi
[[ "$status" -eq 3 && "$COMPOSE_VALIDATION_BLOCKED_BY" == protected-env-file ]]
scenario '.env protegido bloqueia execução sem root'

# 3. .env protegido e execução como root.
reset_fullpassword_facts
PRIVILEGED_VALIDATION_REQUIRED=true
execution_uid() { echo 0; }
assess_shared_proxy_compatibility
[[ "$COMPATIBILITY" == compatible-with-compose-override && "$INSTALLATION_READY" == true ]]
scenario '.env protegido permite validação read-only como root'

# 4. .env ausente.
rm -f -- "$TEST_ROOT/.env"
inventory="$(python3 "$ROOT/scripts/discover-compose-inputs.py" "$COMPOSE_FIXTURE")"
grep -F 'project-env-file' <<< "$inventory" | grep -Fq $'false\tfalse\tfalse'
scenario '.env ausente é inventariado sem leitura'

ERROR_FILE="$TEST_ROOT/compose.error"

# 5. .env inválido.
printf 'env file has invalid format SECRET_SENTINEL=never-log-this\n' > "$ERROR_FILE"
classify_compose_failure "$ERROR_FILE"
[[ "$COMPOSE_VALIDATION_BLOCKED_BY" == invalid-env-file ]]
scenario '.env inválido mantém o gate fechado'

# 6. Variável obrigatória ausente.
inventory="$(python3 "$ROOT/scripts/discover-compose-inputs.py" "$COMPOSE_FIXTURE")"
grep -Fq $'required-variable\tNGINX_IMAGE' <<< "$inventory"
printf 'required variable NGINX_IMAGE is not set\n' > "$ERROR_FILE"
classify_compose_failure "$ERROR_FILE"
[[ "$COMPOSE_VALIDATION_BLOCKED_BY" == required-variable-missing ]]
scenario 'variável obrigatória ausente é classificada'

# 7. env_file adicional protegido.
grep -F 'service-env-file' <<< "$inventory" | grep -Fq 'service.env'
[[ "$inventory" != *'SERVICE_VALUE=opaque'* ]]
scenario 'env_file adicional é detectado sem conteúdo'

# 8. Saída Compose contendo segredos.
VALIDATOR_SOURCE="$(<"$ROOT/scripts/validate-fullpassword-compose.py")"
[[ "$VALIDATOR_SOURCE" == *'sensitive_values_logged=false'* && "$VALIDATOR_SOURCE" != *'print(base'* && "$VALIDATOR_SOURCE" != *'print(merged'* ]]
scenario 'validador estrutural não imprime JSON interpolado'

# 9. Sanitização de logs.
printf 'env file has invalid format SECRET_SENTINEL=never-log-this\n' > "$ERROR_FILE"
classify_compose_failure "$ERROR_FILE"
[[ "$COMPOSE_VALIDATION_ERROR" == invalid-env-file && "$COMPOSE_VALIDATION_ERROR" != *'never-log-this'* ]]
scenario 'erro sanitizado não contém valor secreto'

# 10. Compose entre diretórios válido.
reset_fullpassword_facts
execution_uid() { echo 0; }
assess_shared_proxy_compatibility
[[ "$COMPOSE_CROSS_DIRECTORY_SUPPORTED" == true && "$COMPATIBILITY" == compatible-with-compose-override ]]
scenario 'Compose entre diretórios válido é aceito'

# 11. Compose entre diretórios inválido.
reset_fullpassword_facts
COMPOSE_CROSS_DIRECTORY_SUPPORTED=false
COMPOSE_MERGE_VALID=unknown
if assess_shared_proxy_compatibility; then status=0; else status=$?; fi
[[ "$status" -eq 2 && "$COMPATIBILITY" == blocked ]]
scenario 'Compose entre diretórios inválido é bloqueado'

# 12. Preservação da configuração original.
for fragment in 'set(base.get("services", {})) != set(merged.get("services", {}))' 'merged_service.get(key) != value' 'merged_networks.get(network_name) != network'; do
  [[ "$VALIDATOR_SOURCE" == *"$fragment"* ]]
done
scenario 'preservação estrutural é validada'

# 13. Override adicionando apenas recursos permitidos.
[[ "$VALIDATOR_SOURCE" == *'added_volume_targets != {'* && "$VALIDATOR_SOURCE" == *'expected_networks = network_names(base_service) | {"devflow_edge"}'* ]]
scenario 'override é limitado aos recursos DevFlow permitidos'

INSTALL_SOURCE="$(<"$ROOT/scripts/install.sh")"
DIAGNOSTIC_SOURCE="$(<"$ROOT/scripts/detect-shared-proxy.sh")"

# 14. --check sem root.
[[ "$INSTALL_SOURCE" == *'CHECK_STATUS=passed-with-privileged-dry-run-required'* && "$INSTALL_SOURCE" == *'check_status=$CHECK_STATUS'* ]]
scenario '--check conclui diagnóstico básico sem root'

# 15. --dry-run sem root.
[[ "$INSTALL_SOURCE" == *'dry_run_status=blocked'* && "$INSTALL_SOURCE" == *'reason=privileged-compose-validation-required'* ]]
scenario '--dry-run sem root orienta repetição privilegiada'

# 16. --dry-run com root.
[[ "$DIAGNOSTIC_SOURCE" == *'"$(execution_uid)" -ne 0'* && "$DIAGNOSTIC_SOURCE" == *'INSTALLATION_READY=true'* ]]
scenario '--dry-run com root mantém validação completa'

# 17. Garantia de ausência de mutações em --dry-run.
dry_run_gate="$(grep -nF '[[ "$MODE" == dry-run ]] && {' "$ROOT/scripts/install.sh" | cut -d: -f1)"
install_gate="$(grep -nF 'install -d -m 0750 "$DEVFLOW_INSTALL_ROOT"' "$ROOT/scripts/install.sh" | cut -d: -f1)"
[[ -n "$dry_run_gate" && -n "$install_gate" && "$dry_run_gate" -lt "$install_gate" ]]
! grep -Eq 'docker (restart|start|stop|network create)|chmod .*fullpassword|chown .*fullpassword' <<< "$DIAGNOSTIC_SOURCE"
scenario '--dry-run termina antes de qualquer mutação de instalação'

# 18. Limpeza dos arquivos temporários.
new_diagnostic_temp
created_temp="$DIAGNOSTIC_TEMP_RESULT"
[[ -d "$created_temp" ]]
cleanup_diagnostic_temps
[[ ! -e "$created_temp" ]]
scenario 'temporários seguros são removidos'

# 19. Interrupção por sinal.
[[ "$DIAGNOSTIC_SOURCE" == *'trap cleanup_diagnostic_temps EXIT'* && "$DIAGNOSTIC_SOURCE" == *"trap 'exit 130' INT TERM"* ]]
scenario 'sinais acionam a limpeza por trap'

# 20. Auditoria read-only do Full Password.
AUDIT_SOURCE="$(<"$ROOT/scripts/audit-fullpassword-readonly.mjs")"
[[ "$AUDIT_SOURCE" == *'forbiddenEnvRead'* && "$AUDIT_SOURCE" == *'envInputRedirect'* && "$DIAGNOSTIC_SOURCE" == *'--project-directory /opt/fullpassword'* ]]
scenario 'auditoria bloqueia leitura ou escrita indevida no Full Password'

[[ "$passed" -eq 20 ]] || { echo "Expected 20 privileged Compose scenarios, got $passed." >&2; exit 1; }
printf 'Privileged Compose tests passed: %s scenarios.\n' "$passed"
