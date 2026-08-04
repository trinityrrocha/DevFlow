#!/usr/bin/env python3
"""Validate and atomically write the isolated DevFlow installation state v3."""

from __future__ import annotations

import json
import os
import re
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlparse

REQUIRED_KEYS = {
    "schemaVersion", "installationMode", "installedVersion", "installedCommit",
    "installedRef", "repository", "applicationInstalled", "applicationHealthy",
    "externalPublicationEnabled", "certificateIssued", "domain", "adminEmail",
    "frontendUrl", "backendUrl", "migration",
}
BOOLEAN_KEYS = {
    "applicationInstalled", "applicationHealthy", "externalPublicationEnabled", "certificateIssued",
}
SEMVER = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$")
COMMIT = re.compile(r"^[0-9a-f]{40}$")
DOMAIN = re.compile(r"^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$")
EMAIL = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
CANONICAL_REPOSITORY = "https://github.com/trinityrrocha/DevFlow.git"


def fail(message: str) -> None:
    print(f"installation-state-invalid: {message}", file=sys.stderr)
    raise SystemExit(2)


def validate_url(value: object, label: str, expected_host: str, suffix: str) -> None:
    if not isinstance(value, str):
        fail(f"{label} must be a string")
    parsed = urlparse(value)
    if (parsed.scheme != "https" or parsed.hostname != expected_host
            or parsed.netloc != expected_host or parsed.username or parsed.password
            or parsed.query or parsed.fragment or parsed.params):
        fail(f"{label} is not the isolated HTTPS URL")
    if parsed.path.rstrip("/") != suffix:
        fail(f"{label} path is invalid")


def validate(document: object) -> dict[str, object]:
    if not isinstance(document, dict):
        fail("root must be an object")
    keys = set(document)
    if keys != REQUIRED_KEYS:
        missing = REQUIRED_KEYS - keys
        unknown = keys - REQUIRED_KEYS
        fail(f"keys diverge; missing={','.join(sorted(missing))}; unknown={','.join(sorted(unknown))}")
    if document["schemaVersion"] != 3 or document["installationMode"] != "isolated":
        fail("schemaVersion 3 and isolated mode are mandatory")
    if not isinstance(document["installedVersion"], str) or not SEMVER.fullmatch(document["installedVersion"]):
        fail("installedVersion is invalid")
    if not isinstance(document["installedCommit"], str) or not COMMIT.fullmatch(document["installedCommit"]):
        fail("installedCommit is invalid")
    if document["installedRef"] != "main":
        fail("installedRef must be main")
    if document["repository"] != CANONICAL_REPOSITORY:
        fail("repository is not canonical")
    for key in BOOLEAN_KEYS:
        if not isinstance(document[key], bool):
            fail(f"{key} must be boolean")
    if not all(document[key] for key in BOOLEAN_KEYS):
        fail("final isolated state requires installed, healthy, published and certificate flags")
    domain = document["domain"]
    if not isinstance(domain, str) or not DOMAIN.fullmatch(domain) or "." not in domain:
        fail("domain is invalid")
    if not isinstance(document["adminEmail"], str) or not EMAIL.fullmatch(document["adminEmail"]):
        fail("adminEmail is invalid")
    validate_url(document["frontendUrl"], "frontendUrl", domain, "")
    validate_url(document["backendUrl"], "backendUrl", domain, "/api")
    if not isinstance(document["migration"], str) or not document["migration"] or len(document["migration"]) > 255:
        fail("migration is invalid")
    return document


def read_document(path: Path) -> dict[str, object]:
    try:
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 65536:
            fail("state file is unsafe")
        return validate(json.loads(path.read_text(encoding="utf-8")))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        fail(f"cannot read JSON: {error}")


def atomic_write(destination: Path) -> None:
    try:
        document = validate(json.load(sys.stdin))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        fail(f"cannot parse candidate JSON: {error}")
    destination.parent.mkdir(mode=0o750, parents=True, exist_ok=True)
    if destination.is_symlink():
        fail("destination cannot be a symlink")
    descriptor, temporary_name = tempfile.mkstemp(prefix=".installation.", dir=destination.parent)
    temporary = Path(temporary_name)
    try:
        os.chmod(temporary, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(document, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        read_document(temporary)
        os.replace(temporary, destination)
        os.chmod(destination, 0o600)
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            os.chown(destination, 0, 0)
    finally:
        if temporary.exists():
            temporary.unlink()


def main() -> None:
    if len(sys.argv) != 3 or sys.argv[1] not in {"validate", "write"}:
        fail("usage: validate-installation-state.py validate|write PATH")
    path = Path(sys.argv[2])
    if not path.is_absolute():
        fail("state path must be absolute")
    if sys.argv[1] == "validate":
        read_document(path)
        print("installed_state_schema_valid=true")
    else:
        atomic_write(path)


if __name__ == "__main__":
    main()
