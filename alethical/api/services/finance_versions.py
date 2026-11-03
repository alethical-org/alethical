"""1 short token naming the exact source state a Finance list read.

A Finance list is paged, so its pages are separate requests. Sources change between
them: a campaign-money release publishes, an identity is confirmed or merged, a
station file is checked, a roster refreshes. Joining pages read from different states
can repeat or skip a record and mix 2 sets of figures. Each list therefore answers
with ``version``, and a request that sends a ``version`` back is refused with 409
when the state it names is gone, so the client reloads rather than mixing.

The token covers only the sources that list reads (``MARKS``): the published payment
release by its id (its files never change), and for every mutable table, a digest
of ordered row keys and revisions. Observation timestamps alone do not prove that
a row stayed unchanged. People also includes the local date used for membership.
The token is computed in the request's pinned view
(``committee_finance.pin_to_one_view``), before the list itself is read, so the token
and the page describe 1 instant. A changed token says only that something the list
reads changed, never what; a matching token proves that nothing it covers did.
"""

from __future__ import annotations

import hashlib
from datetime import date

from sqlalchemy import Connection, text
from sqlalchemy.orm import Session

from alethical.api.problems import problem_exception
from alethical.api.services import committee_finance
from alethical.pipeline import campaign_finance_filings as filings


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
    "identity": _digest("identity_event", "r.id"),
    "accounts": "jsonb_build_array("
    + _digest("legislator_campaign_committee", "r.id")
    + ", "
    + _digest("legislator", "r.id")
    + ")",
    "lobbying": "(SELECT release_id::text FROM lobbying_current_release WHERE id)",
    "station": "jsonb_build_array("
    + ", ".join(
        [
            _digest("finance_tv_fact", "r.id"),
            _digest("finance_tv_connection", "r.id"),
            _digest("tv_ad_fact", "r.id"),
            _digest("tv_ad_connection", "r.id"),
            _digest("finance_tv_copy_withdrawal", "r.id"),
            _digest("fcc_document", "r.facility_id, r.file_id, r.content_hash"),
            _digest("tv_ad_publication", "r.id"),
            _digest("fcc_extraction", "r.content_hash, r.version"),
            _digest("fcc_page", "r.content_hash, r.version, r.page"),
        ]
    )
    + ")",
    "people": "jsonb_build_array("
    + ", ".join(
        _digest(table, "r.id")
        for table in [
            "legislator",
            "legislator_service_period",
            "legislative_session",
            "chamber",
            "district",
            "candidate_record",
            "public_person",
        ]
    )
    + ")",
}


def current(db: Session, *marks: str, on_date: date | None = None) -> str:
    """The token for these sources, read in this request's pinned view.

    Pinned before the first statement of a fresh request. An already-open
    transaction must actually have a stable snapshot; READ COMMITTED cannot
    establish consistency between the token and the page's later statements.
    """
    bind = db.get_bind()
    if db.in_transaction() or (isinstance(bind, Connection) and bind.in_transaction()):
        if db.connection().get_isolation_level() not in {
            "REPEATABLE READ",
            "SERIALIZABLE",
        }:
            raise problem_exception(
                503,
                "Service Unavailable",
                "Records are temporarily unavailable. Try again.",
                type_slug="service-unavailable",
            )
        filings.mark_pinned_read(db)
    else:
        committee_finance.pin_to_one_view(db)
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
