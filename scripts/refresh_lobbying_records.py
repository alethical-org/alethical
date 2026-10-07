#!/usr/bin/env python3
"""Publish a checked lobbying pair and retry unfinished cache clearing."""

from __future__ import annotations
import argparse
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from alethical.db.session import database_url_for_target, NO_PREPARED_STATEMENTS
from alethical.pipeline.lobbying_refresh import refresh
from scripts.load_minnesota_data import _validated_database_target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=("local", "production"), required=True)
    args = parser.parse_args()
    name = os.environ.get("ALETHICAL_REFRESH_JOB_NAME")
    token = os.environ.get("ALETHICAL_REFRESH_JOB_TOKEN")
    if not name or not token:
        parser.error("A scheduled job lease is required")
    url = database_url_for_target(args.target)
    _validated_database_target(args.target, url)
    engine = create_engine(url, connect_args=NO_PREPARED_STATEMENTS)
    try:
        with Session(engine) as db:
            return 0 if refresh(db, name=name, token=token, target=args.target) else 1
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
