from __future__ import annotations

import argparse

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from alethical.api.services.notifications import (
    create_tracked_bill_update_events,
    send_due_email_notifications,
)
from alethical.db.session import database_url_for_target


def main() -> int:
    parser = argparse.ArgumentParser(description="Create and send V1 tracked-bill email notifications.")
    parser.add_argument("--target", default="local", choices=["local", "production"])
    parser.add_argument("--database-url", default=None)
    parser.add_argument("--lookback-hours", type=int, default=48)
    parser.add_argument("--send", action="store_true", help="Send due pending emails after creating events.")
    parser.add_argument("--send-only", action="store_true", help="Only send pending due emails.")
    parser.add_argument("--limit", type=int, default=100)
    args = parser.parse_args()

    engine = create_engine(database_url_for_target(args.target, args.database_url), pool_pre_ping=True)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    with session_factory() as db:
        created = None
        if not args.send_only:
            created = create_tracked_bill_update_events(db, lookback_hours=args.lookback_hours)
            print(f"created={created.created} skipped={created.skipped}")

        if args.send or args.send_only:
            sent = send_due_email_notifications(db, limit=args.limit)
            print(f"sent={sent.sent} failed={sent.failed} skipped={sent.skipped}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
