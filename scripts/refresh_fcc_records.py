#!/usr/bin/env python3
"""Adapt the existing bounded FCC collector to durable source deadlines."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
#: Matches the ``fcc`` job's ``review_exit`` in alethical/pipeline/record_refresh.py.
REVIEW = 2


def outcome(report, code):
    """A bounded pass with backlog never claims complete source coverage."""
    counts = {}
    for section in ("collection", "backlog"):
        value = report.get(section)
        if not isinstance(value, dict):
            raise ValueError("FCC completion counts are missing")
        counts[section] = {
            key: number
            for key, number in value.items()
            if isinstance(key, str) and type(number) is int and number >= 0
        }
    for key in ("source_gaps", "reading_gaps", "reading_operational_failures"):
        number = report.get(key)
        if type(number) is not int or number < 0:
            raise ValueError("FCC gap counts are missing")
        counts[key] = number
    # Our own failures fail the turn. Files the FCC lists but does not serve, or
    # serves without readable text, are source gaps: the turn is checked, the gap
    # report keeps them open for review, and the next pass retries them.
    failed = (
        bool(report.get("errors"))
        or code not in (0, 1)
        or bool(counts["reading_operational_failures"])
    )
    failed |= any(
        counts["collection"].get(k, 0) for k in ("folders_failed", "files_failed")
    )
    failed |= any(
        report.get(section, {}).get("failed", 0) for section in ("mirror", "extraction")
    )
    failed |= report["collection"].get("status") not in {
        "complete",
        "limited",
        "incomplete",
    }
    backlog = any(counts["backlog"].values())
    gaps = bool(counts["source_gaps"] or counts["reading_gaps"])
    gaps |= not backlog and (
        code != 0
        or report["collection"].get("status") != "complete"
        or report.get("needs_attention") is not False
    )
    if failed:
        counts["status"] = "failed"
        return 1, counts
    if gaps:
        counts["status"] = "review_required"
        return REVIEW, counts
    counts["status"] = "continuing" if backlog else "complete"
    return (75 if backlog else 0), counts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=("local", "production"), required=True)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "fcc-refresh-report.json"
        command = [
            sys.executable,
            str(ROOT / "scripts/fcc_political_files.py"),
            "refresh",
            "--target",
            "prod" if args.target == "production" else "dev",
            "--shared-source-budget",
            "--workers",
            "3",
            "--max-files",
            "1000",
            "--mirror-limit",
            "2500",
            "--extract-limit",
            "1000",
            "--summary",
            str(path),
        ]
        result = subprocess.run(command, cwd=ROOT, stdout=sys.stderr)
        try:
            code, finding = outcome(json.loads(path.read_text()), result.returncode)
        except (OSError, ValueError, TypeError):
            code, finding = 1, {"status": "failed", "report_available": False}
        finding["needs_attention"] = code != 0
        (ROOT / "fcc-refresh-report.json").write_text(
            json.dumps(finding, sort_keys=True) + "\n"
        )
        print(json.dumps(finding, sort_keys=True))
        return code


if __name__ == "__main__":
    raise SystemExit(main())
