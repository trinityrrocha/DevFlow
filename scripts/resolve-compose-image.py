#!/usr/bin/env python3
"""Return the single resolved image configured for one Compose service."""

import json
import sys


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(2)


if len(sys.argv) != 2 or not sys.argv[1].replace("-", "").replace("_", "").isalnum():
    fail("invalid-service")

try:
    document = json.load(sys.stdin)
except (json.JSONDecodeError, UnicodeDecodeError):
    fail("invalid-compose-json")

services = document.get("services")
if not isinstance(services, dict) or sys.argv[1] not in services:
    fail("service-not-found")

service = services[sys.argv[1]]
if not isinstance(service, dict):
    fail("invalid-service-definition")

image = service.get("image")
if isinstance(image, list):
    fail("multiple-images")
if not isinstance(image, str) or not image.strip():
    fail("image-not-defined")
if "\n" in image or "\r" in image:
    fail("invalid-image-reference")

print(image.strip())
