#!/usr/bin/env python3
"""Manage one shared Finance research login without exposing its password.

Commands: show EMAIL, set-password EMAIL, revoke EMAIL. Password entry uses a
hidden terminal prompt, or --password-stdin for a private provisioning process.
Never pass a password as an argument or save credentials in the repository.
Setting a password creates/restores the login and ends every previous session.
The command uses ALETHICAL_DATABASE_TARGET and the normal database settings.
"""

from __future__ import annotations

import argparse
import getpass
import os
import sys
from pathlib import Path

from sqlalchemy import create_engine, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from alethical.api.services import finance_research_access as research  # noqa: E402
from alethical.api.services.finance_access import normalize_email  # noqa: E402
from alethical.db.models import FinanceResearchAccount  # noqa: E402
from alethical.db.session import NO_PREPARED_STATEMENTS, database_url_for_target  # noqa: E402


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("show", "set-password", "revoke"):
        command = commands.add_parser(name)
        command.add_argument("email")
        if name == "set-password":
            command.add_argument("--password-stdin", action="store_true")
    return parser.parse_args(argv)


def run(db: Session, args, password: str | None = None) -> tuple[int, str]:
    email = normalize_email(args.email)
    if args.command == "set-password":
        if password is None:
            raise ValueError("A password is required.")
        research.set_password(db, email, password)
        db.commit()
    elif args.command == "revoke":
        research.revoke(db, email)
        db.commit()
    account = db.scalar(
        select(FinanceResearchAccount).where(FinanceResearchAccount.email == email)
    )
    if account is None:
        return 1, f"{email}: no research login"
    state = "revoked" if account.revoked_at else "active"
    return (
        0,
        f"{email}: {state}; research only; password set {account.password_changed_at.isoformat()}",
    )


def main(argv=None) -> int:
    args = parse_args(argv)
    try:
        normalize_email(args.email)
        password = None
        if args.command == "set-password":
            if args.password_stdin:
                password = (
                    sys.stdin.readline(4098).removesuffix("\n").removesuffix("\r")
                )
            else:
                password = getpass.getpass("Shared Finance password: ")
                if password != getpass.getpass("Repeat password: "):
                    raise ValueError("Passwords do not match.")
            if not 8 <= len(password) <= 1024:
                raise ValueError("Use a password between 8 and 1024 characters.")
        target = os.environ.get("ALETHICAL_DATABASE_TARGET") or "local"
        url = make_url(database_url_for_target(target))
        print(f"Database: {target} ({url.host}/{url.database})")
        engine = create_engine(url, connect_args=NO_PREPARED_STATEMENTS)
        try:
            with Session(engine) as db:
                code, message = run(db, args, password)
        finally:
            engine.dispose()
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    print(message, file=sys.stdout if code == 0 else sys.stderr)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
