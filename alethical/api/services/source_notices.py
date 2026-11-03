"""Reviewed notices about one committee-year in one of the Board's payment files.

``.claude/rules/grounded-answers.md`` (Campaign record counts and matching claims): a
specific known discrepancy needs a source-scoped notice. Each entry here is one such
discrepancy, found by a person and recorded on its issue, with fixed words the page
prints beside that committee-year's payments. Nothing here is generated.

Every entry carries the fingerprint of the rows it was reviewed against (how many rows
the file holds for that committee-year, and their summed amount). The notice is served
only while the live file still holds exactly those rows, so a Board correction
withdraws it instead of leaving a sentence about a file that has changed.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from alethical.db import models as schema


@dataclass(frozen=True)
class SourceNotice:
    key: str
    dataset: str
    registration_number: str
    year: int
    rows: int
    amount_sum: Decimal
    text: str
    issue_url: str


NOTICES: tuple[SourceNotice, ...] = (
    # Coleman, Christopher B Gov Committee. The Board's file before 13 Oct 2026 listed
    # nearly every 2017 payment twice; from then on it lists 244 rows that keep part
    # of each version. The filed 2017 report is offline until the Board republishes
    # pre-2022 reports with street addresses removed.
    SourceNotice(
        key="coleman-2017-expenditures-partial",
        dataset="expenditures",
        registration_number="18127",
        year=2017,
        rows=244,
        amount_sum=Decimal("560171.70"),
        text=(
            "Minnesota’s Campaign Finance Board spending file lists only part of this "
            "committee’s 2017 payments. Our copies of the same file up to October 3, "
            "2026 listed more of them. The committee’s filed report for 2017 is offline "
            "while the Board removes street addresses from its reports, so the full "
            "list cannot be checked against it."
        ),
        issue_url="https://github.com/alethical-org/alethical/issues/2831",
    ),
)

_ROW_TABLES = {"expenditures": schema.CampaignFinanceExpenditureRow}


def source_notices(
    db: Session, release: Any, registration_number: str, year: int
) -> list[dict[str, str]]:
    """The notices that still describe this committee-year in the live release."""
    found: list[dict[str, str]] = []
    for notice in NOTICES:
        if notice.registration_number != registration_number or notice.year != year:
            continue
        table = _ROW_TABLES[notice.dataset]
        snapshot_id = getattr(release, notice.dataset).snapshot_id
        rows, amount = db.execute(
            select(func.count(), func.coalesce(func.sum(table.amount), 0)).where(
                table.snapshot_id == snapshot_id,
                table.committee_reg_num == registration_number,
                table.year == year,
            )
        ).one()
        if rows == notice.rows and Decimal(amount) == notice.amount_sum:
            found.append(
                {"key": notice.key, "dataset": notice.dataset, "text": notice.text}
            )
    return found
