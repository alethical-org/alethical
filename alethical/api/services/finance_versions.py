"""1 short token naming the exact source state a Finance list read.

A Finance list is paged, so its pages are separate requests. Sources change between
them: a campaign-money release publishes, an identity is confirmed or merged, a
station file is checked, a roster refreshes. Joining pages read from different states
can repeat or skip a record and mix 2 sets of figures. Each list therefore answers
with ``version``, and a request that sends a ``version`` back is refused with 409
when the state it names is gone, so the client reloads rather than mixing.

The token covers only the sources that list reads (``MARKS``): the published payment
release by its id (its files never change), and for tables changed in place, a row
count with the latest change date, or for public persons, which carry no change date,
a digest of every row. It is computed in the request's pinned view
(``committee_finance.pin_to_one_view``), before the list itself is read, so the token
and the page describe 1 instant. A changed token says only that something the list
reads changed, never what; a matching token proves that nothing it covers did.
"""

from __future__ import annotations

import hashlib

from sqlalchemy import text
from sqlalchemy.orm import Session

from alethical.api.problems import problem_exception
from alethical.api.services import committee_finance


def _counted(table: str, *dates: str) -> str:
    latest = ", ".join(f"max({column})::text" for column in dates)
    return f"(SELECT jsonb_build_array(count(*), {latest}) FROM {table})"


MARKS = {
    "money": "(SELECT release_id::text FROM cf_current_release WHERE id)",
    "identity": _counted("identity_event", "created_at"),
    "accounts": _counted("legislator_campaign_committee", "updated_at", "withdrawn_at"),
    "lobbying": "(SELECT release_id::text FROM lobbying_current_release WHERE id)",
    "station": "jsonb_build_array("
    + ", ".join(
        [
            _counted("finance_tv_fact", "checked_at", "withdrawn_at"),
            _counted("finance_tv_connection", "checked_at", "withdrawn_at"),
            _counted("tv_ad_fact", "checked_at", "withdrawn_at"),
            _counted("tv_ad_connection", "checked_at", "withdrawn_at"),
            _counted("finance_tv_copy_withdrawal", "withdrawn_at"),
            _counted("fcc_document", "first_seen_at", "last_seen_at"),
        ]
    )
    + ")",
    "people": "jsonb_build_array("
    + ", ".join(
        [
            _counted("legislator", "updated_at"),
            _counted("legislator_service_period", "updated_at"),
            _counted("candidate_record", "checked_at"),
            "(SELECT md5(coalesce(string_agg(p::text, '|' ORDER BY p.id), ''))"
            " FROM public_person p)",
        ]
    )
    + ")",
}


class VersionChanged(Exception):
    """The caller's version names a state the sources no longer hold."""


def current(db: Session, *marks: str) -> str:
    """The token for these sources, read in this request's pinned view."""
    committee_finance.pin_to_one_view(db)
    statement = "SELECT jsonb_build_array(" + ", ".join(MARKS[m] for m in marks) + ")"
    state = db.execute(text(statement)).scalar_one()
    payload = repr((marks, state)).encode()
    return hashlib.sha256(payload).hexdigest()[:16]


def check(db: Session, requested: str | None, *marks: str) -> str:
    """The current token; 409 when the caller's token names a state that changed."""
    version = current(db, *marks)
    if requested is not None and requested != version:
        raise problem_exception(
            409,
            "Conflict",
            "These records changed. Reload the list.",
            type_slug="records-changed",
        )
    return version
