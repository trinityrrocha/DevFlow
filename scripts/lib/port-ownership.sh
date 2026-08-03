#!/usr/bin/env bash

# Evidencia somente leitura para portas publicas. O resultado so e considerado
# comprovado quando socket, mapping Docker e inspect sao coerentes.

DEVFLOW_PUBLIC_PROXY_STATUS=unknown
DEVFLOW_EXTERNAL_PUBLICATION_READY=false
DEVFLOW_INTERNAL_INSTALLATION_READY=true
DEVFLOW_PROXY_MIGRATION_REQUIRED=false
DEVFLOW_PUBLIC_PROXY_CONTAINER=none

devflow_detect_port_owner() {
  local port="$1" listener_line docker_ids container_id mapping inspect_ports name container_port
  local mapping_count=0 mapped_container=none mapped_container_port=none
  validate_port "$port"

  listener_line=
  DEVFLOW_PORT_HOST_LISTENER_DETECTED=false
  DEVFLOW_PORT_DOCKER_MAPPING_DETECTED=false
  DEVFLOW_PORT_CONTAINER=none
  DEVFLOW_PORT_CONTAINER_PORT=none
  DEVFLOW_PORT_OWNER_CLASSIFICATION=none
  DEVFLOW_PORT_OWNER_PROVEN=false

  command -v ss >/dev/null 2>&1 || {
    export DEVFLOW_PORT_HOST_LISTENER_DETECTED DEVFLOW_PORT_DOCKER_MAPPING_DETECTED \
      DEVFLOW_PORT_CONTAINER DEVFLOW_PORT_CONTAINER_PORT DEVFLOW_PORT_OWNER_CLASSIFICATION \
      DEVFLOW_PORT_OWNER_PROVEN
    return 0
  }
  listener_line="$(ss -H -ltnp 2>/dev/null | awk -v p=":$port" '$4 ~ p"$" {print; exit}' || true)"
  [[ -z "$listener_line" ]] || DEVFLOW_PORT_HOST_LISTENER_DETECTED=true

  if command -v docker >/dev/null 2>&1 && docker version >/dev/null 2>&1; then
    docker_ids="$(docker ps --format '{{.ID}}' 2>/dev/null || true)"
    while IFS= read -r container_id; do
      [[ -n "$container_id" ]] || continue
      mapping="$(docker port "$container_id" 2>/dev/null || true)"
      container_port="$(awk -v p="$port" '
        $1 ~ /^[0-9]+\/tcp$/ && $2 == "->" && $3 ~ (":" p "$") {
          split($1, parts, "/"); print parts[1]
        }
      ' <<< "$mapping" | sort -u)"
      [[ "$container_port" =~ ^[0-9]+$ ]] || continue
      inspect_ports="$(docker inspect --format '{{json .NetworkSettings.Ports}}' "$container_id" 2>/dev/null || true)"
      grep -Fq "\"$container_port/tcp\"" <<< "$inspect_ports" || continue
      grep -Eq "\"HostPort\"[[:space:]]*:[[:space:]]*\"$port\"" <<< "$inspect_ports" || continue
      name="$(docker inspect --format '{{.Name}}' "$container_id" 2>/dev/null | sed 's#^/##')"
      [[ "$name" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || continue
      mapping_count=$((mapping_count + 1))
      mapped_container="$name"
      mapped_container_port="$container_port"
    done <<< "$docker_ids"
  fi

  if [[ "$mapping_count" -eq 1 ]]; then
    DEVFLOW_PORT_DOCKER_MAPPING_DETECTED=true
    DEVFLOW_PORT_CONTAINER="$mapped_container"
    DEVFLOW_PORT_CONTAINER_PORT="$mapped_container_port"
  fi

  if [[ "$DEVFLOW_PORT_HOST_LISTENER_DETECTED" == false && "$mapping_count" -eq 0 ]]; then
    DEVFLOW_PORT_OWNER_CLASSIFICATION=free
    DEVFLOW_PORT_OWNER_PROVEN=true
  elif [[ "$DEVFLOW_PORT_HOST_LISTENER_DETECTED" == true && "$mapping_count" -eq 1 ]]; then
    DEVFLOW_PORT_OWNER_CLASSIFICATION=docker-container
    DEVFLOW_PORT_OWNER_PROVEN=true
  elif [[ "$DEVFLOW_PORT_HOST_LISTENER_DETECTED" == true && "$mapping_count" -eq 0 \
    && "$listener_line" =~ users:\(\(\"nginx\" ]]; then
    DEVFLOW_PORT_OWNER_CLASSIFICATION=host-nginx
    DEVFLOW_PORT_OWNER_PROVEN=true
  else
    DEVFLOW_PORT_OWNER_CLASSIFICATION=unknown
  fi

  export DEVFLOW_PORT_HOST_LISTENER_DETECTED DEVFLOW_PORT_DOCKER_MAPPING_DETECTED \
    DEVFLOW_PORT_CONTAINER DEVFLOW_PORT_CONTAINER_PORT DEVFLOW_PORT_OWNER_CLASSIFICATION \
    DEVFLOW_PORT_OWNER_PROVEN
}

devflow_capture_port_evidence() {
  local port="$1"
  devflow_detect_port_owner "$port"
  printf -v "DEVFLOW_PORT_${port}_HOST_LISTENER" '%s' "$DEVFLOW_PORT_HOST_LISTENER_DETECTED"
  printf -v "DEVFLOW_PORT_${port}_DOCKER_MAPPING" '%s' "$DEVFLOW_PORT_DOCKER_MAPPING_DETECTED"
  printf -v "DEVFLOW_PORT_${port}_CONTAINER" '%s' "$DEVFLOW_PORT_CONTAINER"
  printf -v "DEVFLOW_PORT_${port}_CONTAINER_PORT" '%s' "$DEVFLOW_PORT_CONTAINER_PORT"
  printf -v "DEVFLOW_PORT_${port}_CLASSIFICATION" '%s' "$DEVFLOW_PORT_OWNER_CLASSIFICATION"
  printf -v "DEVFLOW_PORT_${port}_PROVEN" '%s' "$DEVFLOW_PORT_OWNER_PROVEN"
}

devflow_print_port_evidence() {
  local port="$1" prefix="DEVFLOW_PORT_${1}_" value
  printf 'port=%s\n' "$port"
  for field in HOST_LISTENER DOCKER_MAPPING CONTAINER CONTAINER_PORT CLASSIFICATION PROVEN; do
    value="${prefix}${field}"
    case "$field" in
      HOST_LISTENER) printf 'host_listener_detected=%s\n' "${!value}" ;;
      DOCKER_MAPPING) printf 'docker_mapping_detected=%s\n' "${!value}" ;;
      CONTAINER) printf 'container=%s\n' "${!value}" ;;
      CONTAINER_PORT) printf 'container_port=%s\n' "${!value}" ;;
      CLASSIFICATION) printf 'owner_classification=%s\n' "${!value}" ;;
      PROVEN) printf 'owner_proven=%s\n' "${!value}" ;;
    esac
  done
}

devflow_detect_public_port_ownership() {
  local class80 class443 container80 container443 proven80 proven443
  devflow_capture_port_evidence 80
  devflow_capture_port_evidence 443
  class80="$DEVFLOW_PORT_80_CLASSIFICATION"
  class443="$DEVFLOW_PORT_443_CLASSIFICATION"
  container80="$DEVFLOW_PORT_80_CONTAINER"
  container443="$DEVFLOW_PORT_443_CONTAINER"
  proven80="$DEVFLOW_PORT_80_PROVEN"
  proven443="$DEVFLOW_PORT_443_PROVEN"
  DEVFLOW_INTERNAL_INSTALLATION_READY=true
  DEVFLOW_EXTERNAL_PUBLICATION_READY=false
  DEVFLOW_PROXY_MIGRATION_REQUIRED=false
  DEVFLOW_PUBLIC_PROXY_CONTAINER=none

  if [[ "$class80" == free && "$class443" == free && "$proven80" == true && "$proven443" == true ]]; then
    DEVFLOW_PUBLIC_PROXY_STATUS=free
    DEVFLOW_EXTERNAL_PUBLICATION_READY=true
  elif [[ "$class80" == host-nginx && "$class443" == host-nginx \
    && "$proven80" == true && "$proven443" == true ]]; then
    DEVFLOW_PUBLIC_PROXY_STATUS=occupied-by-host-nginx
    DEVFLOW_EXTERNAL_PUBLICATION_READY=true
  elif [[ "$class80" == docker-container && "$class443" == docker-container \
    && "$container80" == "$container443" && "$container80" != none \
    && "$proven80" == true && "$proven443" == true ]]; then
    DEVFLOW_PUBLIC_PROXY_STATUS=occupied-by-known-docker-proxy
    DEVFLOW_PUBLIC_PROXY_CONTAINER="$container80"
    DEVFLOW_PROXY_MIGRATION_REQUIRED=true
  else
    DEVFLOW_PUBLIC_PROXY_STATUS=owner-unproven
  fi
  export DEVFLOW_PUBLIC_PROXY_STATUS DEVFLOW_EXTERNAL_PUBLICATION_READY \
    DEVFLOW_INTERNAL_INSTALLATION_READY DEVFLOW_PROXY_MIGRATION_REQUIRED \
    DEVFLOW_PUBLIC_PROXY_CONTAINER
}
