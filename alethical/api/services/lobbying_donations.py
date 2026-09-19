"""Annual held contribution sums supported by recipient or donor-specific proof.

A known unresolved donor record withholds the whole annual amount. Official
report evidence can establish a held row's identity without changing its source.
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
from alethical.api.services.lobbyist_donation_evidence import (
    active_evidence,
    matched_row_numbers,
)
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
    evidence = active_evidence(db, release.contributions.snapshot_id, held)
    rows = db.execute(
        select(
            gifts.contrib_reg_num,
            gifts.year,
            gifts.recipient_reg_num,
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
        .group_by(gifts.contrib_reg_num, gifts.year, gifts.recipient_reg_num)
    ).all()
    groups = {
        (row.contrib_reg_num, row.year, row.recipient_reg_num): row.amount
        if row.supported
        else None
        for row in rows
    }
    if evidence is not None:
        people_numbers = set(
            db.scalars(
                select(people.registration_number).where(
                    people.snapshot_id == lobbyist_snapshot_id
                )
            )
        )
        # Sum unchanged held rows, not a total supplied by the evidence artifact.
        numbers = matched_row_numbers(evidence)
        values = (
            {
                row.row_number: row
                for row in db.execute(
                    select(
                        gifts.row_number,
                        gifts.amount,
                        gifts.year,
                        gifts.recipient_reg_num,
                        gifts.receipt_type,
                    ).where(
                        gifts.snapshot_id == release.contributions.snapshot_id,
                        gifts.row_number.in_(numbers),
                    )
                ).all()
            }
            if numbers
            else {}
        )
        for recipient in evidence.get("withheld_recipients", []):
            for key in list(groups):
                if key[1:] == (recipient["year"], recipient["registration_number"]):
                    groups[key] = None
        for recipient in evidence["recipients"]:
            year = recipient["year"]
            if not 2015 <= year <= last_completed_year():
                continue
            for donor, proof in recipient["donors"].items():
                if donor not in people_numbers:
                    continue
                row_numbers = proof["row_numbers"]
                supported = (
                    proof["status"] == "agrees"
                    and bool(row_numbers)
                    and all(
                        number in values
                        and values[number].amount is not None
                        and values[number].year == year
                        and values[number].recipient_reg_num
                        == recipient["registration_number"]
                        and values[number].receipt_type == "Contribution"
                        for number in row_numbers
                    )
                )
                groups[donor, year, recipient["registration_number"]] = (
                    sum((values[number].amount for number in row_numbers), Decimal(0))
                    if supported
                    else None
                )
        # Previously proved missing-ID rows remain known even when a newer report
        # cannot be read. Losing the proof must not publish a smaller partial amount.
        for unresolved in evidence.get("unresolved_donors", []):
            donor = unresolved["donor_registration_number"]
            year = unresolved["year"]
            if donor in people_numbers and 2015 <= year <= last_completed_year():
                groups[donor, year, unresolved["recipient_registration_number"]] = None
    amounts: dict[tuple[str, int], Decimal | None] = {}
    for (donor, year, _), amount in groups.items():
        key = (donor, year)
        if amount is None or (key in amounts and amounts[key] is None):
            amounts[key] = None
        else:
            amounts[key] = (amounts.get(key) or Decimal(0)) + amount
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
            "evidence_id": evidence["id"] if evidence else None,
            "evidence_checked_at": evidence["checked_at"] if evidence else None,
        },
        amounts=amounts,
    )
