"""What the state refunded to one committee's donors, year by year (#2147).

**The program, in plain words.** A Minnesota resident who gives to a state candidate's
principal campaign committee or to a party unit can claim that money back from the state,
up to $75 a year for one person and $150 for a married couple. The Campaign Finance Board
publishes what it refunded once a year, as 2 PDFs and nothing else. So this is not a
figure a committee reported about itself: it is the state's own record of money it paid
back to that committee's donors, which is why it is served in its own block rather than
folded into ``money_in`` where a reader could add it to something.

**Read ``state`` before any number, and read each year's ``state`` before its number.**
Three different silences are kept apart here, because a page that renders any of them as
0 tells a reader something false about a named person
(``.claude/rules/grounded-answers.md`` rule 12, missing versus zero):

* ``not_published`` -- **Minnesota published no summary for that year.** The Board's page
  links 2013, 2014, 2015 and 2017 through 2025, and 2016 is linked nowhere. A year in this
  state is never drawn as a zero, a gap in a chart, or an absence of refunds.
* ``not_matched`` -- the Board published that year's summary and no line in it attaches to
  this committee. That is usually the office moving rather than an error, and the next
  paragraph is why.
* ``unavailable`` -- we hold no published summary at all. A fact about us, never about the
  committee.

**Why a committee's older years often read ``not_matched``, and why that is the honest
answer.** A refund summary names a candidate and the office they sought and never a
registration number, so a line reaches a person only through the 3-part check in
``alethical/pipeline/campaign_finance_refunds.match_row``: the printed name must equal the
register's candidate name character for character, the office and district must both equal
the register's, and the party must equal the register's. The register records a committee's
**current** office and district. Minnesota renumbered every legislative district in the 2022
redistricting, so the same person appears as "House - 44B" in the 2021 summary and
"House - 45B" in the 2025 one, and only the second agrees with the register. Attaching
across that change would mean deciding that 2 differently-numbered seats are one, which is
a judgement nobody has made and which §5.1 is explicit must never be made by a machine: a
wrong link publishes real money under the wrong person's photograph and nothing downstream
would catch it.

**A reported year can still carry no count.** The whole 2024 candidate summary publishes a
refunded amount and no number of contributions, for every row and for its own totals. So
``contributions_refunded`` is ``None`` on a year in ``reported`` state, and a page says the
count was not published rather than showing a 0.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from alethical.db import models as schema
from alethical.pipeline.campaign_finance_filings import live_filings_snapshot

# One year's answer, and the block's overall answer. The same 4 words, so a page never has
# to learn 2 vocabularies for one idea.
REPORTED = "reported"
NOT_PUBLISHED = "not_published"
NOT_MATCHED = "not_matched"
UNAVAILABLE = "unavailable"


@dataclass(frozen=True)
class RefundYear:
    """One year of the refund record for one committee."""

    year: int
    state: str
    contributions_refunded: Optional[int]
    amount_refunded: Optional[Decimal]
    #: The Board's own file name, because the source here **is** a PDF: there is no row
    #: id and no download to cite, so the citation is the file and the day we copied it.
    source_file_name: Optional[str]
    copied_on: Optional[str]


@dataclass(frozen=True)
class CommitteeRefunds:
    state: str
    years: tuple[RefundYear, ...]


def _file_name(url: str) -> str:
    return url.rsplit("/", 1)[-1]


def _registered_since(db: Session, registration_number: str) -> Optional[int]:
    """The year this committee registered, from the published filer directory.

    Used only to stop the list running back through years the committee did not exist for.
    Listing those as ``not_matched`` would say we looked for a line that should have been
    there, which is not true and reads as a failure of ours.
    """
    snapshot = live_filings_snapshot(db)
    if snapshot is None:
        return None
    registered = db.execute(
        select(schema.CampaignFinanceFiler.registration_date).where(
            schema.CampaignFinanceFiler.snapshot_id == snapshot.id,
            schema.CampaignFinanceFiler.registration_number == registration_number,
        )
    ).scalar_one_or_none()
    return registered.year if registered is not None else None


def refunds_for_committee(db: Session, *, registration_number: str) -> CommitteeRefunds:
    """Every year of the state's refund record that speaks about this committee.

    The list is deliberately **not** filtered by the year the request asked for: the card
    this feeds shows a history, and a single year of it would say nothing about whether a
    gap is a quiet year or a year Minnesota published nothing.
    """
    published = db.execute(
        select(
            schema.CampaignFinanceRefundSummary.id,
            schema.CampaignFinanceRefundSummary.year,
            schema.CampaignFinanceRefundSummary.source_url,
            schema.CampaignFinanceRefundSummary.fetched_on,
        ).where(
            schema.CampaignFinanceRefundSummary.kind
            == schema.CampaignFinanceRefundKind.candidate,
            schema.CampaignFinanceRefundSummary.status
            == schema.CampaignFinanceRefundStatus.published,
        )
    ).all()
    if not published:
        return CommitteeRefunds(state=UNAVAILABLE, years=())

    matched = {
        row[0]: (row[1], row[2])
        for row in db.execute(
            select(
                schema.CampaignFinanceRefundSummary.year,
                schema.CampaignFinanceRefundRow.contribution_count,
                schema.CampaignFinanceRefundRow.refunded_amount,
            )
            .join(
                schema.CampaignFinanceRefundSummary,
                schema.CampaignFinanceRefundSummary.id
                == schema.CampaignFinanceRefundRow.summary_id,
            )
            .where(
                schema.CampaignFinanceRefundRow.matched_registration_number
                == registration_number,
                schema.CampaignFinanceRefundSummary.status
                == schema.CampaignFinanceRefundStatus.published,
                schema.CampaignFinanceRefundSummary.kind
                == schema.CampaignFinanceRefundKind.candidate,
            )
        ).all()
    }
    unpublished_years = set(
        db.execute(
            select(schema.CampaignFinanceRefundNotPublished.year).where(
                schema.CampaignFinanceRefundNotPublished.kind
                == schema.CampaignFinanceRefundKind.candidate
            )
        )
        .scalars()
        .all()
    )
    since = _registered_since(db, registration_number)
    held = {row[1]: (row[2], row[3]) for row in published}
    span = sorted(set(held) | unpublished_years, reverse=True)

    years: list[RefundYear] = []
    for year in span:
        if since is not None and year < since:
            continue
        if year in held:
            url, fetched_on = held[year]
            figures = matched.get(year)
            years.append(
                RefundYear(
                    year=year,
                    state=REPORTED if figures is not None else NOT_MATCHED,
                    contributions_refunded=(
                        figures[0] if figures is not None else None
                    ),
                    amount_refunded=figures[1] if figures is not None else None,
                    source_file_name=_file_name(url),
                    copied_on=fetched_on.isoformat(),
                )
            )
        else:
            years.append(
                RefundYear(
                    year=year,
                    state=NOT_PUBLISHED,
                    contributions_refunded=None,
                    amount_refunded=None,
                    source_file_name=None,
                    copied_on=None,
                )
            )
    state = (
        REPORTED
        if any(entry.state == REPORTED for entry in years)
        else NOT_MATCHED
        if any(entry.state == NOT_MATCHED for entry in years)
        else UNAVAILABLE
    )
    return CommitteeRefunds(state=state, years=tuple(years))
