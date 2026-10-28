#!/usr/bin/env python3
"""Add, revoke or read 1 address on Alethical Finance's access list.

The address comes from the command's arguments only, never from a file in this
repository: a client's address names the client, and the repository is public
(docs/architecture/alethical-finance-architecture.md §3). Every listed account
gets the same Finance access; ``--team`` marks an Alethical team account, which
decides only what alethical.com may print.

Usage:
    # Read 1 entry.
    ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. uv run \
        python scripts/finance_access.py show person@example.com

    # Add a client, or restore a revoked one.
    ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. uv run \
        python scripts/finance_access.py grant person@example.com

    # Add an Alethical team account.
    ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. uv run \
        python scripts/finance_access.py grant person@example.com --team

    # Revoke. The next Finance request from that account is refused.
    ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. uv run \
        python scripts/finance_access.py revoke person@example.com

Each command prints the entry as it stands after the change. Undo a grant with
``revoke`` and a revoke with ``grant``.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from alethical.api.services import finance_access  # noqa: E402
from alethical.db.session import (  # noqa: E402
    NO_PREPARED_STATEMENTS,
    database_url_for_target,
)


def _describe(entry) -> str:
    revoked = entry.revoked_at.isoformat() if entry.revoked_at else "active"
    team = "team" if entry.is_alethical_team else "client"
    return (
        f"{entry.email}: {entry.change}; {team}; "
        f"granted {entry.granted_at.isoformat()}; revoked {revoked}"
    )


def run(session: Session, args: argparse.Namespace) -> tuple[int, str]:
    if args.command == "show":
        entry = finance_access.read_entry(session, args.email)
        if entry is None:
            return 1, f"{finance_access.normalize_email(args.email)}: not on the list"
        return 0, _describe(entry)
    if args.command == "grant":
        entry = finance_access.grant(session, args.email, team=args.team)
    else:
        entry = finance_access.revoke(session, args.email)
        if entry is None:
            return 1, f"{finance_access.normalize_email(args.email)}: not on the list"
    session.commit()
    return 0, _describe(_read_back(session, entry))


def _read_back(session: Session, entry):
    """What the database now holds, not what this process meant to write."""
    stored = finance_access.read_entry(session, entry.email)
    return finance_access.EntryChange(
        email=stored.email,
        change=entry.change,
        is_alethical_team=stored.is_alethical_team,
        granted_at=stored.granted_at,
        revoked_at=stored.revoked_at,
    )


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    commands = parser.add_subparsers(dest="command", required=True)
    show = commands.add_parser("show", help="Read 1 entry")
    show.add_argument("email")
    grant = commands.add_parser("grant", help="Add or restore an address")
    grant.add_argument("email")
    grant.add_argument(
        "--team",
        action="store_true",
        help="Mark an Alethical team account (decides only what alethical.com prints)",
    )
    revoke = commands.add_parser("revoke", help="Revoke an address")
    revoke.add_argument("email")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        finance_access.normalize_email(args.email)
    except ValueError:
        print("Not an email address.", file=sys.stderr)
        return 2
    url = database_url_for_target(os.environ.get("ALETHICAL_DATABASE_TARGET"))
    engine = create_engine(url, connect_args=NO_PREPARED_STATEMENTS)
    try:
        with Session(engine) as session:
            code, message = run(session, args)
    finally:
        engine.dispose()
    print(message, file=sys.stdout if code == 0 else sys.stderr)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
