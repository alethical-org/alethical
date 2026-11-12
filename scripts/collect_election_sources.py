#!/usr/bin/env python3
"""Collect explicit official-source leads into private local storage, never publish."""

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from alethical.pipeline.election_source_capture import collect  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--directory", type=Path, required=True)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text())
    if not isinstance(manifest, list):
        parser.error("Manifest must be a list of source requests")
    result = collect(manifest, args.directory)
    (args.directory / "inventory.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({k: v for k, v in result.items() if k != "sources"}))
    return 1 if result["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
