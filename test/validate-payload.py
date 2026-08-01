#!/usr/bin/env python3
"""Nova Debug 페이로드를 JSON Schema(draft 2020-12)로 검증한다.

사용법:
    python3 test/validate-payload.py [--schema schema/debug-payload.v2.schema.json] <payload.json ...>
"""
import argparse
import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator


DEFAULT_SCHEMA = Path(__file__).resolve().parent.parent / "schema" / "debug-payload.v2.schema.json"


def format_path(absolute_path):
    if not absolute_path:
        return "$"
    return "$." + ".".join(str(p) for p in absolute_path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", default=str(DEFAULT_SCHEMA), help="JSON Schema 파일 경로")
    parser.add_argument("payloads", nargs="+", help="검증할 페이로드 JSON 파일")
    args = parser.parse_args()

    with open(args.schema, encoding="utf-8") as f:
        schema = json.load(f)

    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema)

    all_passed = True
    for payload_path in args.payloads:
        try:
            with open(payload_path, encoding="utf-8") as f:
                instance = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            all_passed = False
            print(f"FAIL  {payload_path}")
            print(f"      {e}")
            continue

        errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.absolute_path))
        if not errors:
            print(f"PASS  {payload_path}")
            continue

        all_passed = False
        print(f"FAIL  {payload_path}")
        for error in errors:
            print(f"      {format_path(error.absolute_path)}: {error.message}")

    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(main())
