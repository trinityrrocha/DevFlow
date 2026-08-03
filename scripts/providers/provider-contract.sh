#!/usr/bin/env bash

# Contrato de provider de infraestrutura DevFlow, versao 1.
# Codigos: 0=aprovado, 1=falha, 2=uso/configuracao invalida, 3=acao privilegiada
# necessaria, 4=migracao controlada obrigatoria. Check/dry-run nunca escrevem.

DEVFLOW_PROVIDER_CONTRACT_VERSION=1
DEVFLOW_PROVIDER_STATE_FILE="${DEVFLOW_PROVIDER_STATE_FILE:-$DEVFLOW_STATE_ROOT/infrastructure-provider.json}"
DEVFLOW_PROVIDER_NAME="${DEVFLOW_PROVIDER_NAME:-}"
DEVFLOW_PROVIDER_STATUS=unknown

# shellcheck source=../lib/port-ownership.sh
. "$DEVFLOW_SOURCE_ROOT/scripts/lib/port-ownership.sh"

provider_validate_name() {
  case "$1" in
    host-nginx|isolated-nginx|legacy-docker-nginx) return 0 ;;
    *) log ERROR "Provider desconhecido: $1"; return 2 ;;
  esac
}

provider_load() {
  local name="$1" provider_file
  provider_validate_name "$name" || return
  provider_file="$DEVFLOW_SOURCE_ROOT/scripts/providers/$name.sh"
  [[ -r "$provider_file" ]] || { log ERROR "Provider ausente: $provider_file"; return 1; }
  # shellcheck disable=SC1090
  . "$provider_file"
  DEVFLOW_PROVIDER_NAME="$name"
  local fn
  for fn in detect check dry_run prepare install validate health update rollback uninstall; do
    declare -F "provider_$fn" >/dev/null || {
      log ERROR "Provider $name nao implementa provider_$fn."; return 1;
    }
  done
  [[ "${PROVIDER_IMPLEMENTATION_NAME:-}" == "$name" ]] || {
    log ERROR "Provider carregado declarou identidade divergente."; return 1;
  }
}

provider_state_write() {
  local provider="$1" domain="$2" frontend_port="$3" backend_port="$4" temporary
  provider_validate_name "$provider" || return
  validate_domain "$domain"
  validate_port "$frontend_port"
  validate_port "$backend_port"
  install -d -m 0750 "$DEVFLOW_STATE_ROOT"
  temporary="$(mktemp "$DEVFLOW_STATE_ROOT/.infrastructure-provider.XXXXXX")"
  {
    printf '{\n'
    printf '  "provider": "%s",\n' "$provider"
    printf '  "version": %s,\n' "$DEVFLOW_PROVIDER_CONTRACT_VERSION"
    printf '  "domain": "%s",\n' "$domain"
    printf '  "frontendPort": %s,\n' "$frontend_port"
    printf '  "backendPort": %s\n' "$backend_port"
    printf '}\n'
  } > "$temporary"
  chmod 0640 "$temporary"
  mv -f -- "$temporary" "$DEVFLOW_PROVIDER_STATE_FILE"
}

provider_state_load() {
  local state_file="${1:-$DEVFLOW_PROVIDER_STATE_FILE}" line key value
  [[ -r "$state_file" ]] || return 1
  DEVFLOW_STATE_PROVIDER=
  DEVFLOW_STATE_DOMAIN=
  DEVFLOW_STATE_FRONTEND_PORT=
  DEVFLOW_STATE_BACKEND_PORT=
  DEVFLOW_STATE_PROVIDER_VERSION=
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*\"([A-Za-z]+)\"[[:space:]]*:[[:space:]]*(\"[^\"]*\"|[0-9]+),?[[:space:]]*$ ]] || {
      [[ "$line" =~ ^[[:space:]]*[\{\}][[:space:]]*$ ]] && continue
      log ERROR "Estado de provider invalido: $state_file"
      return 1
    }
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    value="${value#\"}"; value="${value%\"}"
    case "$key" in
      provider) DEVFLOW_STATE_PROVIDER="$value" ;;
      version) DEVFLOW_STATE_PROVIDER_VERSION="$value" ;;
      domain) DEVFLOW_STATE_DOMAIN="$value" ;;
      frontendPort) DEVFLOW_STATE_FRONTEND_PORT="$value" ;;
      backendPort) DEVFLOW_STATE_BACKEND_PORT="$value" ;;
      *) log ERROR "Campo inesperado no estado de provider: $key"; return 1 ;;
    esac
  done < "$state_file"
  provider_validate_name "$DEVFLOW_STATE_PROVIDER" || return
  [[ "$DEVFLOW_STATE_PROVIDER_VERSION" == "$DEVFLOW_PROVIDER_CONTRACT_VERSION" ]] || {
    log ERROR 'Versao do contrato de provider nao suportada.'; return 1;
  }
  validate_domain "$DEVFLOW_STATE_DOMAIN"
  validate_port "$DEVFLOW_STATE_FRONTEND_PORT"
  validate_port "$DEVFLOW_STATE_BACKEND_PORT"
}

provider_resolve_installed() {
  if provider_state_load; then
    DEVFLOW_INFRASTRUCTURE_PROVIDER="$DEVFLOW_STATE_PROVIDER"
  else
    case "${DEVFLOW_SHARED_PROXY_ADAPTER:-none}:${DEVFLOW_PROXY_MODE:-}" in
      fullpassword-nginx:shared) DEVFLOW_INFRASTRUCTURE_PROVIDER=legacy-docker-nginx ;;
      *:isolated) DEVFLOW_INFRASTRUCTURE_PROVIDER=isolated-nginx ;;
      *) DEVFLOW_INFRASTRUCTURE_PROVIDER=host-nginx ;;
    esac
    log WARN 'Estado de provider ausente; provider inferido da configuracao legada.'
  fi
  derive_legacy_proxy_settings "$DEVFLOW_INFRASTRUCTURE_PROVIDER"
}

provider_resources() {
  printf '%s\n' "${PROVIDER_MUTABLE_RESOURCES:-nenhum recurso declarado}"
}
