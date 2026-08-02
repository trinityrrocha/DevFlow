#!/usr/bin/env python3
"""Fail-closed validation for the Full Password Compose override."""

import json
import sys
from pathlib import Path


def fail(message: str) -> None:
    raise SystemExit(f"Compose override inválido: {message}")


def load(path: str) -> dict:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        fail(f"não foi possível ler {path}: {error}")


def normalize_ports(service: dict) -> set[str]:
    result = set()
    for port in service.get("ports", []):
        if isinstance(port, str):
            result.add(port)
        else:
            result.add(json.dumps(port, sort_keys=True, separators=(",", ":")))
    return result


def volumes_by_target(service: dict) -> dict[str, dict | str]:
    result = {}
    for volume in service.get("volumes", []):
        if isinstance(volume, str):
            target = volume.split(":", 2)[1] if ":" in volume else volume
        else:
            target = volume.get("target")
        if not target:
            fail("volume sem target no serviço nginx")
        result[target] = volume
    return result


def network_names(service: dict) -> set[str]:
    networks = service.get("networks", {})
    return set(networks if isinstance(networks, (list, dict)) else [])


def main() -> None:
    if len(sys.argv) != 3:
        fail("uso: validate-fullpassword-compose.py BASE.json MERGED.json")
    base = load(sys.argv[1])
    merged = load(sys.argv[2])
    base_service = base.get("services", {}).get("nginx")
    merged_service = merged.get("services", {}).get("nginx")
    if not isinstance(base_service, dict) or not isinstance(merged_service, dict):
        fail("serviço nginx ausente")

    if set(base.get("services", {})) != set(merged.get("services", {})):
        fail("serviços originais foram removidos ou serviços inesperados foram adicionados")
    for service_name, service in base.get("services", {}).items():
        if service_name != "nginx" and merged["services"].get(service_name) != service:
            fail(f"serviço original alterado: {service_name}")

    for key, value in base.items():
        if key not in {"services", "networks"} and merged.get(key) != value:
            fail(f"definição original de topo alterada: {key}")
    unexpected_top_level = set(merged) - set(base)
    if unexpected_top_level:
        fail("o override adicionou definições de topo não permitidas")
    base_networks = base.get("networks", {})
    merged_networks = merged.get("networks", {})
    for network_name, network in base_networks.items():
        if merged_networks.get(network_name) != network:
            fail(f"definição da rede original alterada: {network_name}")
    if set(merged_networks) - set(base_networks) != {"devflow_edge"}:
        fail("o override deve adicionar exclusivamente a rede devflow_edge")

    allowed_changes = {"volumes", "networks"}
    if set(merged_service) - set(base_service) - allowed_changes:
        fail("o override adicionou propriedades não permitidas ao serviço nginx")
    for key, value in base_service.items():
        if key not in allowed_changes and merged_service.get(key) != value:
            fail(f"definição original alterada: services.nginx.{key}")

    if normalize_ports(base_service) != normalize_ports(merged_service):
        fail("portas originais do nginx foram removidas, substituídas ou ampliadas")

    base_volumes = volumes_by_target(base_service)
    merged_volumes = volumes_by_target(merged_service)
    for target, value in base_volumes.items():
        if merged_volumes.get(target) != value:
            fail(f"mount original alterado ou removido: {target}")
    added_volume_targets = set(merged_volumes) - set(base_volumes)
    if added_volume_targets != {"/etc/nginx/conf.d/devflow.conf", "/var/www/certbot"}:
        fail("o override adicionou mounts diferentes dos dois recursos DevFlow permitidos")

    devflow_mount = merged_volumes.get("/etc/nginx/conf.d/devflow.conf")
    if not isinstance(devflow_mount, dict):
        fail("mount independente de devflow.conf ausente")
    if devflow_mount.get("source") != "/opt/devflow/config/nginx/devflow.conf" or not devflow_mount.get("read_only"):
        fail("mount devflow.conf não é o bind read-only esperado")

    certbot_mount = merged_volumes.get("/var/www/certbot")
    if not isinstance(certbot_mount, dict) or not certbot_mount.get("read_only"):
        fail("mount read-only do webroot ACME ausente")

    expected_networks = network_names(base_service) | {"devflow_edge"}
    if network_names(merged_service) != expected_networks:
        fail("o override deve preservar as redes originais e adicionar exclusivamente devflow_edge")

    edge = merged.get("networks", {}).get("devflow_edge", {})
    if edge.get("name") != "devflow_edge" or edge.get("external") is not True:
        fail("devflow_edge não está declarada como rede externa persistente")

    for key in (
        "original_services_preserved",
        "original_ports_preserved",
        "original_mounts_preserved",
        "original_networks_preserved",
        "original_restart_policies_preserved",
        "original_images_preserved",
        "original_volumes_preserved",
        "original_environment_preserved",
        "devflow_override_added",
        "devflow_edge_added",
        "devflow_nginx_mount_added",
        "devflow_database_exposure_absent",
    ):
        print(f"{key}=true")
    print("sensitive_values_logged=false")


if __name__ == "__main__":
    main()
