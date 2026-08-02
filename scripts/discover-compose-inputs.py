#!/usr/bin/env python3
"""Discover Compose inputs without reading environment-file contents."""

from __future__ import annotations

import argparse
import os
import re
import stat
import sys
from pathlib import Path


SAFE_PATH = re.compile(r"^[A-Za-z0-9_./ +:@-]+$")
VARIABLE = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-+?])([^}]*))?\}")


def fail(message: str) -> None:
    raise SystemExit(f"Compose input discovery failed: {message}")


def clean_scalar(value: str) -> str:
    value = value.strip()
    if not value:
        return ""
    if value[0:1] in {"'", '"'} and value[-1:] == value[0]:
        value = value[1:-1]
    else:
        value = value.split(" #", 1)[0].strip()
    return value


def resolve_input(project: Path, raw: str) -> Path:
    if not SAFE_PATH.fullmatch(raw) or "\n" in raw or "\r" in raw or "\t" in raw or "|" in raw:
        fail("unsafe input path syntax")
    candidate = Path(raw)
    if not candidate.is_absolute():
        candidate = project / candidate
    return candidate.resolve(strict=False)


def inline_env_files(raw: str) -> list[str]:
    raw = raw.strip()
    if raw.startswith("["):
        if not raw.endswith("]"):
            fail("invalid inline env_file list")
        return [clean_scalar(value) for value in raw[1:-1].split(",") if clean_scalar(value)]
    if raw.startswith("{"):
        if not raw.endswith("}"):
            fail("invalid inline env_file mapping")
        path_match = re.search(r"(?:^|,)\s*path\s*:\s*([^,}]+)", raw[1:-1])
        return [clean_scalar(path_match.group(1))] if path_match else []
    return [clean_scalar(raw)] if clean_scalar(raw) else []


def discover_yaml_inputs(compose_file: Path) -> tuple[list[tuple[str, Path]], set[str]]:
    try:
        body = compose_file.read_text(encoding="utf-8")
    except OSError as error:
        fail(f"cannot read Compose file: {error}")

    inputs: list[tuple[str, Path]] = []
    required_variables: set[str] = set()
    lines = body.splitlines()
    env_indent: int | None = None
    env_map_indent: int | None = None

    for line in lines:
        stripped = line.lstrip(" ")
        indent = len(line) - len(stripped)
        if not stripped or stripped.startswith("#"):
            continue

        for match in VARIABLE.finditer(line):
            if match.group(2) in {"?", ":?"}:
                required_variables.add(match.group(1))

        env_match = re.match(r"env_file\s*:\s*(.*)$", stripped)
        if env_match:
            env_indent = indent
            env_map_indent = None
            for inline in inline_env_files(env_match.group(1)):
                inputs.append(("service-env-file", resolve_input(compose_file.parent, inline)))
            continue

        if env_indent is not None:
            if indent <= env_indent:
                env_indent = None
                env_map_indent = None
            else:
                item = re.match(r"-\s*(.*)$", stripped)
                if item:
                    value = clean_scalar(item.group(1))
                    if value.startswith("path:"):
                        value = clean_scalar(value.removeprefix("path:"))
                    if value:
                        inputs.append(("service-env-file", resolve_input(compose_file.parent, value)))
                    env_map_indent = indent
                    continue
                path_match = re.match(r"path\s*:\s*(.*)$", stripped)
                if path_match and (env_map_indent is None or indent > env_indent):
                    value = clean_scalar(path_match.group(1))
                    if value:
                        inputs.append(("service-env-file", resolve_input(compose_file.parent, value)))
                    continue

    return inputs, required_variables


def input_record(kind: str, path: Path) -> str:
    exists = path.exists()
    readable = os.access(path, os.R_OK) if exists else False
    privileged = exists and path.is_file()
    protected = False
    if exists:
        try:
            protected = not bool(path.stat().st_mode & (stat.S_IRGRP | stat.S_IROTH))
        except OSError:
            protected = True
    return "\t".join(
        (
            kind,
            str(path),
            str(exists).lower(),
            str(readable).lower(),
            str(privileged).lower(),
            str(protected).lower(),
        )
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("compose_file")
    args = parser.parse_args()
    compose_file = Path(args.compose_file).resolve(strict=False)
    if not compose_file.is_file():
        fail("Compose file is absent")

    records: list[tuple[str, Path]] = []
    if os.environ.get("COMPOSE_DISABLE_ENV_FILE", "false").lower() not in {"1", "true"}:
        records.append(("project-env-file", compose_file.parent / ".env"))

    compose_env_files = os.environ.get("COMPOSE_ENV_FILES", "")
    if compose_env_files:
        for raw in compose_env_files.split(","):
            records.append(("compose-env-file", resolve_input(compose_file.parent, clean_scalar(raw))))

    yaml_inputs, required_variables = discover_yaml_inputs(compose_file)
    records.extend(yaml_inputs)

    seen: set[tuple[str, str]] = set()
    for kind, path in records:
        key = (kind, str(path))
        if key in seen:
            continue
        seen.add(key)
        print(input_record(kind, path))
    for variable in sorted(required_variables):
        print("\t".join(("required-variable", variable, "unknown", "unknown", "unknown", "unknown")))


if __name__ == "__main__":
    main()
