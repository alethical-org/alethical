"""Public campaign records beside a scoped payer candidate, never a funding claim."""

from dataclasses import asdict
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from uuid import UUID

from sqlalchemy import text

from alethical.api.services import campaign_finance_payments as payments
from alethical.api.services import committee_finance
from alethical.db.session import get_session_factory


def serializable(value):
    if isinstance(value, dict):
        return {key: serializable(item) for key, item in value.items()}
    if isinstance(value, (tuple, list, set, frozenset)):
        return [serializable(item) for item in value]
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, (Decimal, UUID)):
        return str(value)
    if isinstance(value, Enum):
        return value.value
    return value


def public_records(registration_number: str, year: int) -> dict:
    """Read one published snapshot, retain dates, row evidence and partial states.

    This uses only services already exposed on public campaign-money pages. It
    never calls the separate, access-controlled Finance identity/research graph.
    A small latest-payment sample has an explicit total and has_more flag; it is
    not presented as every connection or evidence about this individual mailer.
    """
    with get_session_factory()() as db:
        committee_finance.pin_to_one_view(db)
        db.execute(text("SET LOCAL statement_timeout = '10s'"))
        release = committee_finance.current_release(db)
        if release is None:
            return {"state": "unavailable", "registration_number": registration_number}
        result = {
            "state": "available",
            "registration_number": registration_number,
            "year": year,
            "release_id": str(release.id),
            "fetched_at": serializable(release.fetched_at),
            "scope": "registration_records",
        }
        for key, read in (
            ("received", payments.payments_received),
            ("paid", payments.payments_made),
            ("independent_spending", payments.independent_payments_by),
        ):
            page = read(
                db, release, registration_number=registration_number, year=year, limit=5
            )
            result[key] = serializable(asdict(page))
        return result
