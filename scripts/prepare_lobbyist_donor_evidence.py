#!/usr/bin/env python3
"""Collect supported completed years and privately retain an unapproved donor audit.

Print only private object identifiers and counts, never donor rows. No database
writes, reviewed-proof activation, committee matching, paid calls or local inputs.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402
from alethical.db.session import database_url_for_target, NO_PREPARED_STATEMENTS  # noqa: E402
from alethical.pipeline.lobbyist_evidence_preparation import prepare_candidate  # noqa: E402
from alethical.pipeline.raw_file_store import raw_file_store_from_env  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=["local", "production"], default="local")
    parser.add_argument("--years", nargs="+", type=int)
    args = parser.parse_args()
    engine = create_engine(
        database_url_for_target(args.target), connect_args=NO_PREPARED_STATEMENTS
    )
    with Session(engine) as db:
        result = prepare_candidate(db, raw_file_store_from_env(), args.years)
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
