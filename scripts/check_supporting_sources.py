#!/usr/bin/env python3
"""Report supporting-source changes as JSON without changing published records."""

from __future__ import annotations

import argparse
from datetime import date, datetime, timezone
import json
from pathlib import Path

from alethical.pipeline.supporting_source_checks import (
    check_ballot_contract,
    check_maps,
    check_zip_reference,
)

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source", choices=("maps", "candidates", "zip", "all"), default="all"
    )
    args = parser.parse_args()
    today = datetime.now(timezone.utc).date()
    results = []
    if args.source in ("maps", "all"):
        from scripts.build_legislative_district_boundaries import SOURCE_SHA256

        results.extend(check_maps(SOURCE_SHA256))
    if args.source in ("candidates", "all"):
        from alethical.api.services.candidate_lookup import SUPPORTED_ELECTION

        results.append(check_ballot_contract(SUPPORTED_ELECTION, today))
    if args.source in ("zip", "all"):
        held = json.loads((ROOT / "alethical/api/data/zip_states.json").read_text())
        results.append(check_zip_reference(date.fromisoformat(held["as_of"]), today))
    print(
        json.dumps(
            {
                "checked_at": datetime.now(timezone.utc).isoformat(),
                "published": False,
                "results": [result.document() for result in results],
            },
            indent=2,
        )
    )
    # 1 means the source could not be checked. 2 means a review is due, not a
    # broken download; the shared runner must retain this distinction.
    if any(result.status == "unavailable" for result in results):
        return 1
    return 2 if any(result.status == "review_required" for result in results) else 0


if __name__ == "__main__":
    raise SystemExit(main())
