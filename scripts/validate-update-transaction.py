#!/usr/bin/env python3
"""Validate and atomically write the DevFlow update transaction schema v2."""

from __future__ import annotations

import json
import os
import re
import sys
import tempfile
from pathlib import Path

REQUIRED_KEYS = {
    "schemaVersion", "transactionId", "timestamp", "phase", "result",
    "previousVersion", "previousCommit", "previousRelease", "previousAppTarget",
    "previousMigration", "previousInstallationStateBackup", "previousInstallationStateHash",
    "previousImageTag", "previousBackendImageId", "previousFrontendImageId",
    "candidateVersion", "candidateCommit", "candidateRelease", "candidateMigration",
    "candidateImageTag", "finalImageTag", "backupPath", "backupHash",
    "changesApplied", "databaseMutated", "candidateHealthPassed", "releasePromoted", "statePromoted",
    "rollbackStarted", "databaseRestored", "releaseRestored", "stateRestored",
    "rollbackHealthPassed", "rollbackStatus", "rootCause", "manualRecoveryRequired",
}
BOOLEAN_KEYS = {
    "changesApplied", "databaseMutated", "candidateHealthPassed", "releasePromoted", "statePromoted",
    "rollbackStarted", "databaseRestored", "releaseRestored", "stateRestored",
    "rollbackHealthPassed", "manualRecoveryRequired",
}
SEMVER = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$")
COMMIT = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^(?:pending|[0-9a-f]{64})$")
IMAGE_ID = re.compile(r"^(?:pending|sha256:[0-9a-f]{64})$")
MIGRATION = re.compile(r"^(?:pending|[0-9]{3}_[A-Za-z0-9_]+\.sql)$")
TOKEN = re.compile(r"^[a-z0-9][a-z0-9.-]{0,127}$")
TIMESTAMP = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")


def fail(message: str) -> None:
    print(f"update-transaction-invalid: {message}", file=sys.stderr)
    raise SystemExit(2)


def validate_path(value: object, prefix: str, suffix: str | None = None) -> None:
    if not isinstance(value, str) or not value.startswith(prefix) or ".." in value:
        fail(f"unsafe path for {prefix}")
    if suffix and not value.endswith(suffix):
        fail(f"invalid path suffix for {prefix}")


def validate(document: object) -> dict[str, object]:
    if not isinstance(document, dict) or set(document) != REQUIRED_KEYS:
        fail("keys diverge")
    if document["schemaVersion"] != 2:
        fail("schemaVersion must be 2")
    if not isinstance(document["transactionId"], str) or not re.fullmatch(r"[0-9a-f]{32}", document["transactionId"]):
        fail("transactionId is invalid")
    if not isinstance(document["timestamp"], str) or not TIMESTAMP.fullmatch(document["timestamp"]):
        fail("timestamp is invalid")
    for key in ("previousVersion", "candidateVersion"):
        if not isinstance(document[key], str) or not SEMVER.fullmatch(document[key]):
            fail(f"{key} is invalid")
    for key in ("previousCommit", "candidateCommit"):
        if not isinstance(document[key], str) or not COMMIT.fullmatch(document[key]):
            fail(f"{key} is invalid")
    for key in ("previousMigration", "candidateMigration"):
        if not isinstance(document[key], str) or not MIGRATION.fullmatch(document[key]):
            fail(f"{key} is invalid")
    validate_path(document["previousRelease"], "/opt/devflow/releases/")
    validate_path(document["previousAppTarget"], "/opt/devflow/releases/")
    validate_path(document["candidateRelease"], "/opt/devflow/releases/")
    validate_path(document["previousInstallationStateBackup"], "/opt/devflow/state/", ".json")
    if document["backupPath"] != "pending":
        validate_path(document["backupPath"], "/opt/devflow/backups/", ".dfbackup")
    if not isinstance(document["previousInstallationStateHash"], str) or not SHA256.fullmatch(document["previousInstallationStateHash"]):
        fail("previousInstallationStateHash is invalid")
    if not isinstance(document["backupHash"], str) or not SHA256.fullmatch(document["backupHash"]):
        fail("backupHash is invalid")
    for key in ("previousBackendImageId", "previousFrontendImageId"):
        if not isinstance(document[key], str) or not IMAGE_ID.fullmatch(document[key]):
            fail(f"{key} is invalid")
    for key in ("previousImageTag", "candidateImageTag", "finalImageTag", "phase", "rootCause"):
        if not isinstance(document[key], str) or not TOKEN.fullmatch(document[key]):
            fail(f"{key} is invalid")
    if document["previousRelease"] != f"/opt/devflow/releases/{document['previousCommit']}" \
            or document["previousAppTarget"] != document["previousRelease"]:
        fail("previous release identity diverges")
    if document["candidateRelease"] != f"/opt/devflow/releases/{document['candidateCommit']}":
        fail("candidate release identity diverges")
    if document["previousInstallationStateBackup"] != \
            f"/opt/devflow/state/update-previous-installation-{document['transactionId']}.json":
        fail("installation state snapshot identity diverges")
    if document["candidateImageTag"] != f"candidate-{document['candidateCommit']}" \
            or document["finalImageTag"] != f"release-{document['candidateCommit']}":
        fail("candidate image identity diverges")
    if document["result"] not in {"in-progress", "success", "rolled-back", "failed"}:
        fail("result is invalid")
    if document["rollbackStatus"] not in {"not-required", "in-progress", "successful", "failed"}:
        fail("rollbackStatus is invalid")
    for key in BOOLEAN_KEYS:
        if not isinstance(document[key], bool):
            fail(f"{key} must be boolean")
    if document["result"] == "success":
        if document["rollbackStatus"] != "not-required" or document["manualRecoveryRequired"]:
            fail("successful transaction has invalid rollback state")
        if not all(document[key] for key in ("changesApplied", "candidateHealthPassed", "releasePromoted", "statePromoted")):
            fail("successful transaction is incomplete")
        if document["backupPath"] == "pending" or document["backupHash"] == "pending":
            fail("successful transaction has no authenticated backup")
    if document["result"] == "rolled-back":
        required = ["changesApplied", "rollbackStarted", "releaseRestored", "stateRestored", "rollbackHealthPassed"]
        if document["databaseMutated"]:
            required.append("databaseRestored")
        if document["rollbackStatus"] != "successful" or document["manualRecoveryRequired"] \
                or not all(document[key] for key in required):
            fail("rolled-back transaction is incomplete")
    if document["result"] == "failed" and document["rollbackStatus"] == "failed" \
            and not document["manualRecoveryRequired"]:
        fail("failed rollback must require manual recovery")
    return document


def read_document(path: Path) -> dict[str, object]:
    try:
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 65536:
            fail("transaction file is unsafe")
        return validate(json.loads(path.read_text(encoding="utf-8")))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        fail(f"cannot read transaction: {error}")


def atomic_write(destination: Path) -> None:
    try:
        document = validate(json.load(sys.stdin))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        fail(f"cannot parse transaction: {error}")
    destination.parent.mkdir(mode=0o750, parents=True, exist_ok=True)
    if destination.is_symlink():
        fail("destination cannot be a symlink")
    descriptor, temporary_name = tempfile.mkstemp(prefix=".update-transaction.", dir=destination.parent)
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
    finally:
        if temporary.exists():
            temporary.unlink()


def main() -> None:
    if len(sys.argv) != 3 or sys.argv[1] not in {"validate", "write"}:
        fail("usage: validate-update-transaction.py validate|write PATH")
    path = Path(sys.argv[2])
    if not path.is_absolute():
        fail("path must be absolute")
    if sys.argv[1] == "validate":
        read_document(path)
        print("update_transaction_valid=true")
    else:
        atomic_write(path)


if __name__ == "__main__":
    main()
