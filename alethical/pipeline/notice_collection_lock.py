"""One fenced writer for notices, statements and their shared amendment rows.

A database row works through transaction pooling. Every mutation commits while
holding that row and proving the same live owner. Expired owners cannot publish
late. Campaign money uses a different row and can keep collecting independently.
"""

from contextlib import contextmanager
from datetime import timedelta
from functools import wraps
import uuid

from sqlalchemy import text

KEY = "notice_statement_writer"
TTL = timedelta(hours=4)
INFO_KEY = "notice_statement_writer_owner"


class NoticeWriterBusy(RuntimeError):
    pass


class NoticeWriterLost(RuntimeError):
    pass


@contextmanager
def hold_notice_writer(db, *, dry_run=False, key=KEY):
    owners = db.info.setdefault(INFO_KEY, {})
    if dry_run or key in owners:
        yield
        return
    owner = str(uuid.uuid4())
    acquired = db.execute(
        text("""
        INSERT INTO cf_refresh_state(key, value, updated_at)
        VALUES (:key, jsonb_build_object('owner', CAST(:owner AS text),
            'expires_at', clock_timestamp() + :seconds * interval '1 second'), clock_timestamp())
        ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at
        WHERE (cf_refresh_state.value->>'expires_at')::timestamptz <= clock_timestamp()
        RETURNING key
    """),
        {"key": key, "owner": owner, "seconds": TTL.total_seconds()},
    ).first()
    notice_commit(db)
    if acquired is None:
        raise NoticeWriterBusy("another notice or statement collector is running")
    owners[key] = owner
    try:
        yield
        if db.new or db.dirty or db.deleted:
            notice_commit(db)
    finally:
        db.rollback()
        owners.pop(key, None)
        db.execute(
            text(
                "DELETE FROM cf_refresh_state WHERE key=:key AND value->>'owner'=:owner"
            ),
            {"key": key, "owner": owner},
        )
        db.commit()


def notice_commit(db):
    for key, owner in db.info.get(INFO_KEY, {}).items():
        # Autoflush must not write records before locking and fencing this owner.
        with db.no_autoflush:
            fenced = db.execute(
                text("""
                UPDATE cf_refresh_state SET
                    updated_at=clock_timestamp()
                WHERE key=:key AND value->>'owner'=:owner
                    AND (value->>'expires_at')::timestamptz > clock_timestamp()
                RETURNING key
            """),
                {"key": key, "owner": owner},
            ).first()
        if fenced is None:
            db.rollback()
            raise NoticeWriterLost("notice or statement writer lost its lease")
    db.commit()


def synchronized_notice_writer(function):
    @wraps(function)
    def synchronized(db, *args, **kwargs):
        key = {
            "collect_notices": "notice_collector",
            "scan_catalogues_for_statements": "statement_collector",
        }.get(function.__name__, KEY)
        with hold_notice_writer(db, dry_run=kwargs.get("dry_run", False), key=key):
            return function(db, *args, **kwargs)

    return synchronized
