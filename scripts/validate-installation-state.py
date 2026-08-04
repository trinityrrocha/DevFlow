#!/usr/bin/env python3
"""Validate and atomically write the versioned DevFlow installation state."""

from __future__ import annotations

import json
import os
import re
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlparse


REQUIRED_KEYS = {
    "schemaVersion", "timestamp", "version", "commit", "ref", "repository",
    "updateChannel", "result", "installationScope", "applicationInstalled",
    "externalPublicationEnabled", "provider", "frontendUrl", "backendUrl",
    "proxyMigrationRequired", "fullpasswordModified", "publicProxyModified",
    "proxyMigrationExecuted", "certificateIssued", "proxyMode",
    "sharedProxyAdapter", "domain", "migration",
}
BOOLEAN_KEYS = {
    "applicationInstalled", "externalPublicationEnabled", "proxyMigrationRequired",
    "fullpasswordModified", "publicProxyModified", "proxyMigrationExecuted",
    "certificateIssued",
}
SEMVER = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$")
COMMIT = re.compile(r"^[0-9a-f]{40}$")
TIMESTAMP = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")
DOMAIN = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$")
CANONICAL_REPOSITORY = "https://github.com/trinityrrocha/DevFlow.git"


def fail(message: str) -> None:
    print(f"installation-state-invalid: {message}", file=sys.stderr)
    raise SystemExit(2)


def validate_url(value: object, label: str) -> None:
    if not isinstance(value, str):
        fail(f"{label} must be a string")
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        fail(f"{label} is not a safe HTTP URL")


def validate(document: object) -> dict[str, object]:
    if not isinstance(document, dict):
        fail("root must be an object")
    keys = set(document)
    missing = REQUIRED_KEYS - keys
    unknown = keys - REQUIRED_KEYS
    if missing:
        fail(f"missing keys: {','.join(sorted(missing))}")
    if unknown:
        fail(f"unknown keys: {','.join(sorted(unknown))}")
    if document["schemaVersion"] != 1:
        fail("schemaVersion must be 1")
    if not isinstance(document["timestamp"], str) or not TIMESTAMP.fullmatch(document["timestamp"]):
        fail("timestamp must be UTC")
    if not isinstance(document["version"], str) or not SEMVER.fullmatch(document["version"]):
        fail("version is invalid")
    if not isinstance(document["commit"], str) or not COMMIT.fullmatch(document["commit"]):
        fail("commit is invalid")
    if document["ref"] != "main" and not (
        isinstance(document["ref"], str) and document["ref"].startswith("v")
        and SEMVER.fullmatch(document["ref"][1:])
    ):
        fail("ref is invalid")
    if document["repository"] != CANONICAL_REPOSITORY:
        fail("repository is not canonical")
    if document["updateChannel"] != "main":
        fail("updateChannel must be main")
    if document["result"] not in {"success", "published"}:
        fail("result is invalid")
    if document["installationScope"] not in {"internal", "complete"}:
        fail("installationScope is invalid")
    if document["provider"] not in {"host-nginx", "isolated-nginx", "legacy-docker-nginx"}:
        fail("provider is invalid")
    if document["proxyMode"] not in {"isolated", "shared"}:
        fail("proxyMode is invalid")
    if document["sharedProxyAdapter"] not in {"none", "host-nginx", "fullpassword-nginx"}:
        fail("sharedProxyAdapter is invalid")
    for key in BOOLEAN_KEYS:
        if not isinstance(document[key], bool):
            fail(f"{key} must be boolean")
    for key in ("frontendUrl", "backendUrl"):
        validate_url(document[key], key)
    if not isinstance(document["domain"], str) or not DOMAIN.fullmatch(document["domain"]):
        fail("domain is invalid")
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
        if os.name == "posix":
            directory_descriptor = os.open(destination.parent, os.O_RDONLY)
            try:
                os.fsync(directory_descriptor)
            finally:
                os.close(directory_descriptor)
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
