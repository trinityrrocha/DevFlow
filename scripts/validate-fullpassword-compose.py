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
    base_networks = base.get("networks", {})
    merged_networks = merged.get("networks", {})
    for network_name, network in base_networks.items():
        if merged_networks.get(network_name) != network:
            fail(f"definição da rede original alterada: {network_name}")
    if set(merged_networks) - set(base_networks) != {"devflow_edge"}:
        fail("o override deve adicionar exclusivamente a rede devflow_edge")

    allowed_changes = {"volumes", "networks"}
    for key, value in base_service.items():
        if key not in allowed_changes and merged_service.get(key) != value:
            fail(f"definição original alterada: services.nginx.{key}")

    if not normalize_ports(base_service).issubset(normalize_ports(merged_service)):
        fail("portas originais do nginx não foram preservadas")

    base_volumes = volumes_by_target(base_service)
    merged_volumes = volumes_by_target(merged_service)
    for target, value in base_volumes.items():
        if merged_volumes.get(target) != value:
            fail(f"mount original alterado ou removido: {target}")

    devflow_mount = merged_volumes.get("/etc/nginx/conf.d/devflow.conf")
    if not isinstance(devflow_mount, dict):
        fail("mount independente de devflow.conf ausente")
    if devflow_mount.get("source") != "/opt/devflow/config/nginx/devflow.conf" or not devflow_mount.get("read_only"):
        fail("mount devflow.conf não é o bind read-only esperado")

    certbot_mount = merged_volumes.get("/var/www/certbot")
    if not isinstance(certbot_mount, dict) or not certbot_mount.get("read_only"):
        fail("mount read-only do webroot ACME ausente")

    if not network_names(base_service).issubset(network_names(merged_service)):
        fail("rede original do nginx não foi preservada")
    if "devflow_edge" not in network_names(merged_service):
        fail("devflow_edge ausente do serviço nginx")

    edge = merged.get("networks", {}).get("devflow_edge", {})
    if edge.get("name") != "devflow_edge" or edge.get("external") is not True:
        fail("devflow_edge não está declarada como rede externa persistente")

    print("Compose override preserva serviço, portas, mounts e redes originais do Full Password.")


if __name__ == "__main__":
    main()
