"""Annual sums of held lobbyist gifts whose recipients' full-year records agree.

This is deliberately not a complete-giving figure. A missing, unproved or
disagreeing recipient withholds the donor's whole amount, not just those gifts.
The source can retain both original and amended gifts, so duplicate-row guessing
and an unguarded SUM are not acceptable substitutes for the filing comparison.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from alethical.api.services.committee_finance import current_release
from alethical.db import models as schema
from alethical.pipeline.campaign_finance_reader import ReleaseNoLongerHeld


def last_completed_year() -> int:
    return datetime.now(ZoneInfo("America/Chicago")).year - 1


@dataclass(frozen=True)
class DonationYears:
    metadata: dict
    # A key with None has records, but cannot support an amount. No key means no
    # matching records, and must never be treated as a recorded zero.
    amounts: dict[tuple[str, int], Decimal | None]


def annual_donations(db: Session, lobbyist_snapshot_id: UUID) -> DonationYears:
    """Read every registered donor-year once, before directory filtering/paging."""
    unavailable = DonationYears(
        metadata={
            "state": "unavailable",
            "available_years": [],
            "release_id": None,
            "copied_at": None,
            "source_url": None,
        },
        amounts={},
    )
    try:
        release = current_release(db)
    except ReleaseNoLongerHeld:
        return unavailable
    if release is None:
        return unavailable
    gifts = schema.CampaignFinanceContributionRow
    # Comparisons were made against an immutable, complete snapshot. A partial
    # prune must not silently turn a previously supported amount into a smaller one.
    held = db.scalar(
        select(func.count())
        .select_from(gifts)
        .where(gifts.snapshot_id == release.contributions.snapshot_id)
    )
    if held != release.contributions.row_count:
        return unavailable

    compared = schema.CampaignFinanceStatedSplit
    people = schema.LobbyistRow
    filing_pointer = schema.CampaignFinanceFilingCurrentSnapshot
    current_filings = (
        select(filing_pointer.snapshot_id)
        .where(filing_pointer.id.is_(True))
        .scalar_subquery()
    )
    supported = func.coalesce(
        and_(
            gifts.amount.is_not(None),
            compared.filings_snapshot_id == current_filings,
            compared.status == schema.CampaignFinanceStatedSplitStatus.agrees,
            compared.self_test == "passed",
            compared.cut_off_date == func.make_date(gifts.year, 12, 31),
            func.abs(compared.stated_itemized - compared.ours_itemized)
            <= Decimal("0.01"),
            or_(
                gifts.receipt_date.is_(None),
                gifts.receipt_date <= compared.cut_off_date,
            ),
        ),
        False,
    )
    rows = db.execute(
        select(
            gifts.contrib_reg_num,
            gifts.year,
            func.sum(gifts.amount).label("amount"),
            func.bool_and(supported).label("supported"),
        )
        .join(
            people,
            and_(
                people.snapshot_id == lobbyist_snapshot_id,
                people.registration_number == gifts.contrib_reg_num,
            ),
        )
        .outerjoin(
            compared,
            and_(
                compared.snapshot_id == gifts.snapshot_id,
                compared.registration_number == gifts.recipient_reg_num,
                compared.filing_year == gifts.year,
            ),
        )
        .where(
            gifts.snapshot_id == release.contributions.snapshot_id,
            gifts.contrib_type == "Lobbyist",
            gifts.receipt_type == "Contribution",
            gifts.year.between(2015, last_completed_year()),
        )
        .group_by(gifts.contrib_reg_num, gifts.year)
    ).all()
    amounts = {
        (row.contrib_reg_num, row.year): row.amount if row.supported else None
        for row in rows
    }
    return DonationYears(
        metadata={
            "state": "reported",
            "available_years": sorted(
                {year for (_, year), amount in amounts.items() if amount is not None},
                reverse=True,
            ),
            "release_id": str(release.id),
            "copied_at": release.fetched_at,
            "source_url": release.contributions.source_url,
        },
        amounts=amounts,
    )
