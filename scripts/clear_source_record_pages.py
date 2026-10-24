#!/usr/bin/env python3
"""Retry committed source-record page clearing without recollecting records."""

import argparse
import json
from sqlalchemy import create_engine
from alethical.db.session import database_url_for_target, NO_PREPARED_STATEMENTS
from alethical.pipeline.source_record_clearing import drain_source_clearing


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=("local", "production"), required=True)
    args = parser.parse_args()
    engine = create_engine(
        database_url_for_target(args.target), connect_args=NO_PREPARED_STATEMENTS
    )
    try:
        finished = drain_source_clearing(engine, target=args.target)
        print(
            json.dumps(
                {
                    "status": "complete" if finished else "pending",
                    "source_collected": False,
                }
            )
        )
        return 0 if finished else 1
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
