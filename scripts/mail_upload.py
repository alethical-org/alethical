#!/usr/bin/env python3
"""Create or revoke restricted mail-upload invitations; never print invitation secrets."""

from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from alethical.api.services import mail_upload as service  # noqa: E402
from alethical.db.models import MailUploadInvitation  # noqa: E402
from alethical.db.session import NO_PREPARED_STATEMENTS, database_url_for_target  # noqa: E402


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=("local", "production"), default="local")
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("create")
    create.add_argument(
        "--output",
        required=True,
        type=Path,
        help="New private JSON file outside this repo",
    )
    create.add_argument("--days", type=int, default=7)
    create.add_argument("--sessions", type=int, default=20)
    revoke = commands.add_parser("revoke")
    revoke.add_argument("invitation_id", type=uuid.UUID)
    args = parser.parse_args(argv)
    if args.command == "create":
        if not 1 <= args.days <= 30 or not 1 <= args.sessions <= 100:
            parser.error("Use 1–30 days and 1–100 sessions")
        output = args.output.expanduser().absolute()
        if output.resolve().is_relative_to(REPO_ROOT):
            parser.error("Save invitation secrets outside the repository")
        # Exclusive creation prevents overwriting another invitation or following a symlink.
        descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    else:
        descriptor = None
    engine = create_engine(
        database_url_for_target(args.target), connect_args=NO_PREPARED_STATEMENTS
    )
    try:
        with Session(engine) as db:
            if args.command == "create":
                with os.fdopen(descriptor, "w") as handle:
                    descriptor = None
                    row, token = service.create_invitation(
                        db, days=args.days, max_sessions=args.sessions
                    )
                    json.dump(
                        {
                            "invitation_id": str(row.id),
                            "invitation_token": token,
                            "expires_at": row.expires_at.isoformat(),
                        },
                        handle,
                    )
                    handle.write("\n")
                print(
                    f"Created invitation {row.id}; secret saved in the private output file"
                )
            else:
                row = db.get(MailUploadInvitation, args.invitation_id)
                if row is None:
                    parser.error("Invitation not found")
                row.revoked_at = service.now()
                db.commit()
                print(f"Revoked invitation {row.id} and its sessions")
    finally:
        if descriptor is not None:
            os.close(descriptor)
        engine.dispose()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
