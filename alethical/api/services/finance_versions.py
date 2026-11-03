"""1 short token naming the exact source state a Finance list read.

A Finance list is paged, so its pages are separate requests. Sources change between
them: a campaign-money release publishes, an identity is confirmed or merged, a
station file is checked, a roster refreshes. Joining pages read from different states
can repeat or skip a record and mix 2 sets of figures. Each list therefore answers
with ``version``, and a request that sends a ``version`` back is refused with 409
when the state it names is gone, so the client reloads rather than mixing.

The token covers only the sources that list reads (``MARKS``): the published payment
release by its id (its files never change), and for tables changed in place, a row
count with the latest change date. Tables without change dates use a digest of
row revisions. People also includes the local date used for membership. The token
is computed in the request's pinned view
(``committee_finance.pin_to_one_view``), before the list itself is read, so the token
and the page describe 1 instant. A changed token says only that something the list
reads changed, never what; a matching token proves that nothing it covers did.
"""

from __future__ import annotations

import hashlib
from datetime import date

from sqlalchemy import text
from sqlalchemy.exc import InvalidRequestError
from sqlalchemy.orm import Session

from alethical.api.problems import problem_exception
from alethical.api.services import committee_finance


def _counted(table: str, *dates: str) -> str:
    latest = ", ".join(f"max({column})::text" for column in dates)
    return f"(SELECT jsonb_build_array(count(*), {latest}) FROM {table})"


def _digest(table: str, order: str) -> str:
    # PostgreSQL xmin changes whenever a row is replaced. Hash ordered keys and
    # row revisions, not large text/JSON bodies. This also catches in-place edits
    # where the source table has no updated_at. Vacuum/restore may invalidate a
    # token conservatively; tokens are opaque and never persistent record IDs.
    return (
        "(SELECT md5(coalesce(string_agg(ROW("
        + order
        + ", r.xmin)::text, '|' ORDER BY "
        + order
        + "), '')) FROM "
        + table
        + " r)"
    )


MARKS = {
    "money": "(SELECT release_id::text FROM cf_current_release WHERE id)",
    "identity": _counted("identity_event", "created_at"),
    "accounts": "jsonb_build_array("
    + _counted("legislator_campaign_committee", "updated_at", "withdrawn_at")
    + ", "
    + _counted("legislator", "updated_at")
    + ")",
    "lobbying": "(SELECT release_id::text FROM lobbying_current_release WHERE id)",
    "station": "jsonb_build_array("
    + ", ".join(
        [
            _counted("finance_tv_fact", "checked_at", "withdrawn_at"),
            _counted("finance_tv_connection", "checked_at", "withdrawn_at"),
            _counted("tv_ad_fact", "checked_at", "withdrawn_at"),
            _counted("tv_ad_connection", "checked_at", "withdrawn_at"),
            _counted("finance_tv_copy_withdrawal", "withdrawn_at"),
            _counted(
                "fcc_document", "first_seen_at", "last_seen_at", "last_downloaded_at"
            ),
            _counted(
                "tv_ad_publication",
                "created_at",
                "reviewed_at",
                "withdrawn_at",
                "metadata_reviewed_at",
            ),
            _digest("fcc_extraction", "r.content_hash, r.version"),
            _digest("fcc_page", "r.content_hash, r.version, r.page"),
        ]
    )
    + ")",
    "people": "jsonb_build_array("
    + ", ".join(
        [
            _counted("legislator", "updated_at"),
            _counted("legislator_service_period", "updated_at"),
            _counted("legislative_session", "updated_at"),
            _counted("chamber", "updated_at"),
            _counted("district", "updated_at"),
            _counted("candidate_record", "checked_at"),
            _digest("public_person", "r.id"),
        ]
    )
    + ")",
}


def current(db: Session, *marks: str, on_date: date | None = None) -> str:
    """The token for these sources, read in this request's pinned view.

    Pinned first, because whichever statement runs first fixes the transaction's
    view: a fresh request session (every request in production) is pinned here, so
    the token and the list read 1 instant. A connection already inside a
    transaction keeps that transaction's view.
    """
    try:
        committee_finance.pin_to_one_view(db)
    except InvalidRequestError:
        # The connection already holds an open transaction; its view governs.
        pass
    statement = "SELECT jsonb_build_array(" + ", ".join(MARKS[m] for m in marks) + ")"
    state = db.execute(text(statement)).scalar_one()
    payload = repr((marks, state, on_date)).encode()
    return hashlib.sha256(payload).hexdigest()[:16]


def check(
    db: Session, requested: str | None, *marks: str, on_date: date | None = None
) -> str:
    """The current token; 409 when the caller's token names a state that changed."""
    version = current(db, *marks, on_date=on_date)
    if requested is not None and requested != version:
        raise problem_exception(
            409,
            "Conflict",
            "These records changed. Reload the list.",
            type_slug="records-changed",
        )
    return version
