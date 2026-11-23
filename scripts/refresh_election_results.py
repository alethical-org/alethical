#!/usr/bin/env python3
"""Recheck official election returns once a day inside each counting window.

The default is a dry run: it downloads the official files into a new temporary
folder, prepares them offline and reports whether they changed. ``--execute``
stages and publishes a changed generation with the current pointer as the
expected previous value. Restore the previous generation with the command in
docs/operations/election-finance-comparison.md ("Publish and restore").

Prints exactly one JSON finding; exits 1 when an election could not be checked
or its change needs review, 0 otherwise.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from alethical.db.session import NO_PREPARED_STATEMENTS, database_url_for_target  # noqa: E402
from alethical.pipeline.election_results_refresh import (  # noqa: E402
    Steps,
    read_published,
    run,
)
from scripts.election_comparison import (  # noqa: E402
    execute_publish,
    execute_stage,
    prepare_from_files,
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=("local", "production"), default="local")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument(
        "--today",
        type=date.fromisoformat,
        help="Minnesota calendar day that selects the active windows (default: today)",
    )
    args = parser.parse_args(argv)
    engine = create_engine(
        database_url_for_target(args.target), connect_args=NO_PREPARED_STATEMENTS
    )

    def read(election_key):
        with Session(engine) as db:
            return read_published(db, election_key)

    def retained(source_hash):
        # Hash-verified bytes of a page already retained with the published
        # generation; used only when the official page cannot be read again.
        from alethical.db import models as m
        from alethical.pipeline.election_comparison import read_source
        from alethical.pipeline.raw_file_store import raw_file_store_from_env

        with Session(engine) as db:
            source = db.get(m.ElectionResultSource, source_hash)
            if source is None:
                raise LookupError("Retained source is missing")
            return read_source(raw_file_store_from_env(), source)

    try:
        code, finding = run(
            target=args.target,
            execute=args.execute,
            read=read,
            steps=Steps(prepare_from_files, execute_stage, execute_publish),
            today=args.today,
            retained=retained,
        )
    except Exception as error:
        # Connection errors can embed credentials; report the type only.
        code, finding = (
            1,
            {
                "status": "failed",
                "reason": "unexpected_error",
                "error": type(error).__name__,
                "results": [
                    {
                        "source": "election-results",
                        "status": "failed",
                        "finding_key": "unexpected-error",
                    }
                ],
            },
        )
    finally:
        engine.dispose()
    print(json.dumps(finding, sort_keys=True, default=str))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
