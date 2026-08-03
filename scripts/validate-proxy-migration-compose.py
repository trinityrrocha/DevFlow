#!/usr/bin/env python3
"""Validate the Full Password host-Nginx migration without disclosing Compose values."""

from __future__ import annotations

import copy
import json
import sys
from pathlib import Path
from typing import Any


RESULT_KEYS = (
    "compose_merge_valid",
    "original_services_preserved",
    "original_mounts_preserved",
    "original_networks_preserved",
    "original_environment_preserved",
    "original_restart_policy_preserved",
    "public_ports_removed",
    "loopback_port_added",
    "unexpected_changes",
    "rollback_compose_valid",
    "rollback_public_port_80_present",
    "rollback_public_port_443_present",
    "rollback_nginx_service_present",
)


def load_json(path: str) -> dict[str, Any]:
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        raise ValueError("invalid-json") from None
    if not isinstance(value, dict):
        raise ValueError("invalid-compose-root")
    return value


def port_fields(port: Any) -> tuple[str, str, str, str]:
    if isinstance(port, dict):
        return (
            str(port.get("host_ip") or ""),
            str(port.get("published") or ""),
            str(port.get("target") or ""),
            str(port.get("protocol") or "tcp"),
        )
    if not isinstance(port, str):
        return ("", "", "", "")
    text = port.split("/", 1)[0]
    protocol = port.split("/", 1)[1] if "/" in port else "tcp"
    if text.startswith("[") and "]:" in text:
        host_ip, remainder = text[1:].split("]:", 1)
        parts = remainder.split(":")
        if len(parts) == 2:
            return (host_ip, parts[0], parts[1], protocol)
    parts = text.split(":")
    if len(parts) == 3:
        return (parts[0], parts[1], parts[2], protocol)
    if len(parts) == 2:
        return ("", parts[0], parts[1], protocol)
    return ("", "", parts[0], protocol)


def is_public_port(port: Any, expected: int) -> bool:
    host_ip, published, target, protocol = port_fields(port)
    return (
        protocol == "tcp"
        and published == str(expected)
        and target == str(expected)
        and host_ip in {"", "0.0.0.0", "::"}
    )


def is_loopback_port(port: Any) -> bool:
    host_ip, published, target, protocol = port_fields(port)
    return (host_ip, published, target, protocol) == ("127.0.0.1", "18081", "80", "tcp")


def main() -> int:
    results = {key: False for key in RESULT_KEYS}
    error = "none"
    try:
        if len(sys.argv) != 3:
            raise ValueError("invalid-arguments")
        original = load_json(sys.argv[1])
        merged = load_json(sys.argv[2])
        original_services = original.get("services")
        merged_services = merged.get("services")
        if not isinstance(original_services, dict) or not isinstance(merged_services, dict):
            raise ValueError("services-missing")

        original_nginx = original_services.get("nginx")
        merged_nginx = merged_services.get("nginx")
        results["rollback_nginx_service_present"] = isinstance(original_nginx, dict)
        if not isinstance(original_nginx, dict) or not isinstance(merged_nginx, dict):
            raise ValueError("nginx-service-missing")

        original_ports = original_nginx.get("ports", [])
        merged_ports = merged_nginx.get("ports", [])
        results["rollback_public_port_80_present"] = any(is_public_port(port, 80) for port in original_ports)
        results["rollback_public_port_443_present"] = any(is_public_port(port, 443) for port in original_ports)
        results["rollback_compose_valid"] = all(
            (
                results["rollback_nginx_service_present"],
                results["rollback_public_port_80_present"],
                results["rollback_public_port_443_present"],
            )
        )

        results["original_services_preserved"] = set(original_services) == set(merged_services)
        results["original_mounts_preserved"] = all(
            original_services[name].get("volumes", []) == merged_services.get(name, {}).get("volumes", [])
            for name in original_services
        )
        results["original_networks_preserved"] = (
            original.get("networks", {}) == merged.get("networks", {})
            and all(
                original_services[name].get("networks", {}) == merged_services.get(name, {}).get("networks", {})
                for name in original_services
            )
        )
        results["original_environment_preserved"] = all(
            original_services[name].get("environment", {}) == merged_services.get(name, {}).get("environment", {})
            for name in original_services
        )
        results["original_restart_policy_preserved"] = all(
            original_services[name].get("restart") == merged_services.get(name, {}).get("restart")
            for name in original_services
        )
        results["public_ports_removed"] = not any(
            is_public_port(port, expected) for port in merged_ports for expected in (80, 443)
        )
        results["loopback_port_added"] = len(merged_ports) == 1 and is_loopback_port(merged_ports[0])

        expected = copy.deepcopy(original)
        expected["services"]["nginx"]["ports"] = copy.deepcopy(merged_ports)
        results["unexpected_changes"] = expected != merged
        results["compose_merge_valid"] = all(
            (
                results["rollback_compose_valid"],
                results["original_services_preserved"],
                results["original_mounts_preserved"],
                results["original_networks_preserved"],
                results["original_environment_preserved"],
                results["original_restart_policy_preserved"],
                results["public_ports_removed"],
                results["loopback_port_added"],
                not results["unexpected_changes"],
            )
        )
    except (ValueError, KeyError, TypeError, AttributeError) as exception:
        error = str(exception) if str(exception) else "validation-failed"

    for key in RESULT_KEYS:
        print(f"{key}={'true' if results[key] else 'false'}")
    print(f"compose_validation_error={error}")
    return 0 if results["compose_merge_valid"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
