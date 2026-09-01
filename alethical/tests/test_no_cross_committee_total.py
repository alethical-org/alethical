"""A person's campaign committees may never be added together ([#1663]).

A candidate can register more than one campaign committee, usually after moving
between offices or starting a new run. When they close one and open another the
leftover money is transferred, and Minnesota records that transfer exactly as it
records a donation: a ``Contribution``, from the old committee to the new one. So the
same dollars are reported by both committees, correctly, and a combined figure counts
them twice.

**The 2 cases below are read from the Board's own records rather than taken from the
issue**, on 28 Aug 2026:

* **Diane Napper.** Her Senate committee (19520) reports one itemized contribution for
  2026: **$3,000.00 on 15 June 2026, from "Napper Diane House Committee" (19121)**,
  contributor type ``Candidate Committee``, receipt type ``Contribution``. 19121 is her
  own House committee, in the Board's registered-candidate directory as
  "Napper, Diane House Committee", RPM, House 63B. Her House committee reports nothing
  at all for 2026, so a combined 2026 figure would be $3,000.00 and **every dollar of
  it** would be money she moved from one of her own committees to the other.
* **Frank Pafko.** The same shape: his House committee (19512) reports **$2,851.97 on
  16 June 2026, from "Pafko Frank Senate Committee" (18920)**, and 18920 reports
  nothing for 2026.

Those are 2 candidate-years, read one at a time. The population figure they come from
(9 candidates, 30 payments, $121,241.64) is [#1663]'s measurement and is not re-derived
here.

Nothing shipped adds them, so these tests are a guard rather than a repair. They are
written to fail on the **attempt**: a page that sums 2 committees breaks the moment it
is written, rather than publishing a figure that looks right.

[#1663]: https://github.com/alethical-org/alethical/issues/1663
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path

import pytest
from sqlalchemy import text

from alethical.api.services.committee_amount import (
    CommitteeAmount,
    CrossCommitteeTotal,
    reported_by,
)
from alethical.api.services.committee_filing_schedule import (
    NOT_ON_THE_BALLOT,
    CommitteeFilingSchedule,
)
from alethical.api.services.committee_finance import (
    REPORTED,
    Committee,
    CommitteeFinance,
    IndependentSpendingAbout,
    MoneyIn,
    MoneyOut,
    ReceiptTypeTotal,
)
from alethical.api.services.legislator_finance import (
    LINK_CONFIRMED,
    SPLIT_SHOWN,
    STATED_SPLIT_NOT_CHECKED,
    LegislatorCommitteeMoney,
    LegislatorFinance,
    NamedMoneySplit,
)

# Diane Napper's 2 committees and the 2026 figures the Board publishes for them.
NAPPER_SENATE = "19520"
NAPPER_HOUSE = "19121"
NAPPER_TRANSFER = Decimal("3000.00")
# Frank Pafko's, the other candidate-year where a combined figure would be 100% the
# same money twice.
PAFKO_HOUSE = "19512"
PAFKO_TRANSFER = Decimal("2851.97")


def _committee(
    registration_number: str, *, contributions: Decimal
) -> LegislatorCommitteeMoney:
    """One committee card with **plain** figures, exactly as the service builds it.

    Untagged on purpose. Everything below goes through ``LegislatorFinance``, so what
    is under test is the tab's own shape rather than a helper a future call site could
    forget to use.
    """
    finance = CommitteeFinance(
        committee=Committee(registration_number, "A Committee", "PCC", None),
        year=2026,
        release_id=uuid.uuid4(),
        fetched_at=datetime(2026, 8, 12, 2, 54, tzinfo=UTC),
        money_in=MoneyIn(
            state=REPORTED,
            itemized_contribution_total=contributions,
            itemized_contribution_payments=1,
            other_receipts=(ReceiptTypeTotal("Miscellaneous", Decimal("100.00"), 1),),
            reported_total=contributions,
            reported_through=date(2026, 7, 20),
            reported_period_start=None,
            source_url="https://cfb.mn.gov/reports/contributions.csv",
        ),
        money_out=MoneyOut(
            REPORTED, Decimal("250.00"), 2, (), Decimal("40.00"), None, None, None
        ),
        independent_spending=IndependentSpendingAbout(REPORTED, None, None),
    )
    split = NamedMoneySplit(
        state=SPLIT_SHOWN,
        reported_total=contributions,
        reported_through=date(2026, 7, 20),
        named_total=contributions,
        named_payments=1,
        named_cash_total=contributions,
        named_in_kind_total=Decimal("0.00"),
        unnamed_total=Decimal("0.00"),
        first_payment_on=date(2026, 6, 15),
        last_payment_on=date(2026, 6, 15),
        stated_split_state=STATED_SPLIT_NOT_CHECKED,
    )
    return LegislatorCommitteeMoney(
        registration_number=registration_number,
        committee_name_as_reviewed="A Committee",
        office_as_reviewed="Senate",
        finance=finance,
        split=split,
        schedule=CommitteeFilingSchedule(NOT_ON_THE_BALLOT),
    )


def _tab(*committees: LegislatorCommitteeMoney) -> LegislatorFinance:
    """One legislator's money tab, which is where the tagging happens."""
    return LegislatorFinance(
        legislator_id=uuid.uuid4(),
        year=2026,
        link_state=LINK_CONFIRMED,
        committees=tuple(committees),
        other_office_committees=0,
    )


def test_adding_a_persons_two_committees_raises_instead_of_answering():
    """The whole issue, in the arithmetic somebody will one day write.

    Diane Napper's 2026 money is $3,000.00 in her Senate committee and nothing in her
    House committee, and the $3,000.00 came from the House committee. A page summing
    the 2 would print $3,000.00 as what she raised, when it is one movement of her own
    money reported by the committee that received it.
    """
    tab = _tab(
        _committee(NAPPER_SENATE, contributions=NAPPER_TRANSFER),
        _committee(NAPPER_HOUSE, contributions=Decimal("0.00")),
    )

    with pytest.raises(CrossCommitteeTotal):
        sum(
            committee.split.reported_total
            for committee in tab.committees
            if committee.split.reported_total is not None
        )


def test_every_figure_on_a_card_refuses_the_same_way():
    """Not just the headline. A combined figure can be built from any of them.

    ``money_out`` matters as much as ``money_in``: a transfer leaves the first
    committee as an expenditure typed ``Contribution``, so a combined "spent" figure
    counts the same movement as the combined "raised" figure does.
    """
    first, second = _tab(
        _committee(NAPPER_SENATE, contributions=NAPPER_TRANSFER),
        _committee(PAFKO_HOUSE, contributions=PAFKO_TRANSFER),
    ).committees
    assert first.finance is not None and second.finance is not None

    pairs = [
        (
            first.finance.money_in.itemized_contribution_total,
            second.finance.money_in.itemized_contribution_total,
        ),
        (first.finance.money_in.reported_total, second.finance.money_in.reported_total),
        (
            first.finance.money_in.other_receipts[0].total,
            second.finance.money_in.other_receipts[0].total,
        ),
        (
            first.finance.money_out.itemized_payment_total,
            second.finance.money_out.itemized_payment_total,
        ),
        (first.finance.money_out.in_kind_total, second.finance.money_out.in_kind_total),
        (first.split.reported_total, second.split.reported_total),
        (first.split.named_total, second.split.named_total),
        (first.split.named_cash_total, second.split.named_cash_total),
        (first.split.named_in_kind_total, second.split.named_in_kind_total),
        (first.split.unnamed_total, second.split.unnamed_total),
    ]
    for left, right in pairs:
        assert isinstance(left, CommitteeAmount) and isinstance(right, CommitteeAmount)
        with pytest.raises(CrossCommitteeTotal):
            left + right
        with pytest.raises(CrossCommitteeTotal):
            left - right


def test_one_committees_own_arithmetic_is_untouched():
    """A committee's own figure is correct and is not what this guard is about.

    The split subtracts a committee's named cash from its own reported total, and that
    has to keep working: withholding it is what rule 12 calls for when the subtraction
    cannot be honest, and there is nothing dishonest about a committee minus itself.
    """
    reported = reported_by(NAPPER_SENATE, Decimal("3000.00"))
    named = reported_by(NAPPER_SENATE, Decimal("1200.00"))
    assert reported is not None and named is not None

    unnamed = reported - named
    assert unnamed == Decimal("1800.00")
    assert isinstance(unnamed, CommitteeAmount)
    assert unnamed.registration_number == NAPPER_SENATE
    # And against a plain number, which is how a tolerance comparison is written.
    assert reported + Decimal("0.01") == Decimal("3000.01")


def test_a_missing_figure_stays_missing_rather_than_becoming_a_zero():
    """Rule 12's oldest rule, and the one a wrapper is most likely to break.

    A committee we hold no figure for is not a committee that reported nothing, so
    tagging must pass ``None`` through untouched rather than wrap it in anything a
    surface could print.
    """
    assert reported_by(NAPPER_SENATE, None) is None


def test_a_tagged_figure_serialises_exactly_as_a_plain_one_did():
    """The guard is invisible on the wire, so no reader-facing figure moves.

    ``CommitteeAmount`` is a ``Decimal``, and the API serialises a decimal to a string.
    If a subclass changed that, this guard would silently change every figure on the
    tab, which is a far worse outcome than the one it prevents.
    """
    from pydantic import BaseModel

    class Payload(BaseModel):
        data: object

    plain = Payload(data={"amount": Decimal("3000.00")}).model_dump_json()
    tagged = Payload(
        data={"amount": CommitteeAmount(Decimal("3000.00"), NAPPER_SENATE)}
    ).model_dump_json()
    assert tagged == plain == '{"data":{"amount":"3000.00"}}'


def test_independent_spending_may_still_be_summed_across_a_persons_committees():
    """The one cross-committee total that is sound, kept working on purpose.

    Money others spent about a legislator lives in a different file. Every row of
    ``cf_independent_expenditure_row`` names exactly 1 affected committee, and a
    transfer between a person's own committees never appears in that file at all, so no
    dollar there can sit in 2 of one person's committees. Its total is deliberately
    summed (``alethical/api/services/independent_spending.py``) and this test exists so
    nobody copies the guard above onto it while tidying up.
    """
    from alethical.api.services.independent_spending import (
        REPORTED as SPENDING_REPORTED,
        CommitteeSpending,
        IndependentSpending,
    )

    def about(number: str, supporting: str) -> CommitteeSpending:
        return CommitteeSpending(
            registration_number=number,
            committee_name="A Committee",
            office="Senate",
            supporting=Decimal(supporting),
            opposing=Decimal("0.00"),
            supporting_payments=1,
            opposing_payments=0,
            direction_not_recorded=Decimal("0.00"),
            direction_not_recorded_payments=0,
            rows_missing_an_amount=0,
            first_payment_on=date(2026, 6, 15),
            last_payment_on=date(2026, 6, 15),
        )

    spending = IndependentSpending(
        state=SPENDING_REPORTED,
        year=2026,
        committees=(about(NAPPER_SENATE, "1000.00"), about(NAPPER_HOUSE, "500.00")),
        source_url=None,
        fetched_at=None,
    )
    assert spending.supporting == Decimal("1500.00")


def test_the_frontend_check_catches_the_summing_code_and_passes_on_the_app():
    """The frontend's half of the guard, mutation-checked in both directions.

    The frontend receives plain strings, so it has no runtime guard to lean on. What it
    has is ``scripts/check_no_cross_committee_total.py``, which fails the build on the
    one step a combined figure cannot skip: turning 2 committees' amounts into numbers.
    A check that has never been seen to fail is not a check, so this writes the summing
    code, confirms the check reports it, and confirms the real app is clean.
    """
    import importlib.util

    script = (
        Path(__file__).resolve().parents[2]
        / "scripts"
        / "check_no_cross_committee_total.py"
    )
    spec = importlib.util.spec_from_file_location(
        "check_no_cross_committee_total", script
    )
    assert spec is not None and spec.loader is not None
    guard = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(guard)

    assert guard.violations() == []

    def scratch(tmp: Path, body: str) -> list[str]:
        (tmp / "Money.tsx").write_text(
            "import type { LegislatorCampaignMoney } from '../data/types';\n" + body,
            encoding="utf-8",
        )
        return guard.violations(tmp)

    import tempfile

    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        assert (
            scratch(
                tmp,
                "const clean = money.committees.map((c) => c.registrationNumber);\n",
            )
            == []
        )
        assert scratch(
            tmp,
            "const total = money.committees.map((c) => Number(c.split.reportedTotal));\n",
        )
        assert scratch(
            tmp, "const total = money.committees.map((c) => +c.split.namedTotal);\n"
        )
        assert scratch(
            tmp, "const total = money.committees.reduce((n, c) => n + 1, 0);\n"
        )


# --- The route itself, against a real database ---------------------------------
#
# Everything above tests the shape a page is handed. These 2 test the shape that
# actually leaves the building, because that is where a wrong figure would reach a
# reader, and because the guard wraps every amount on the way out: if it changed how
# one serialised, it would silently move every figure on the tab -- a far worse
# outcome than the double count it prevents.
#
# They need the local Postgres on port 54329.

NAPPER_SENATE_NAME = "Napper, Diane Senate Committee"
NAPPER_HOUSE_NAME = "Napper, Diane House Committee"


def _clear(session) -> None:
    session.rollback()
    session.execute(text("UPDATE cf_current_release SET release_id = NULL"))
    session.execute(text("DELETE FROM cf_release"))
    for table in (
        "cf_contribution_row",
        "cf_expenditure_row",
        "cf_independent_expenditure_row",
    ):
        session.execute(text(f"DELETE FROM {table}"))
    session.execute(text("DELETE FROM cf_snapshot"))
    session.execute(text("DELETE FROM legislator_campaign_committee"))
    session.commit()


@pytest.fixture()
def db(seed_database: None):
    from alethical.db.session import get_session_factory

    session = get_session_factory()()
    _clear(session)
    try:
        yield session
    finally:
        _clear(session)
        session.close()


def _two_committees_for_one_member(db) -> str:
    """Diane Napper's 2026 as Minnesota publishes it, in the local database.

    The Senate committee holds the $3,000.00 that came from the House committee, and
    the House committee holds nothing, which is what the Board's own viewer says for
    both. So a page adding them would print $3,000.00 as what she raised.
    """
    from alethical.db import models

    dataset = models.CampaignFinanceDataset
    snapshots = {}
    for name in ("contributions", "expenditures", "independent_expenditures"):
        marker = f"{name}-{uuid.uuid4()}"
        snapshot = models.CampaignFinanceSnapshot(
            dataset=getattr(dataset, name),
            download_id="-2113865252",
            source_url=f"https://cfb.mn.gov/reports/{name}.csv",
            content_hash=hashlib.sha256(marker.encode()).hexdigest(),
            record_set_hash=hashlib.sha256(f"records-{marker}".encode()).hexdigest(),
            byte_size=1024,
            row_count=0,
            status=models.CampaignFinanceSnapshotStatus.loaded,
        )
        db.add(snapshot)
        db.flush()
        snapshots[name] = snapshot

    release = models.CampaignFinanceRelease(
        contributions_snapshot_id=snapshots["contributions"].id,
        expenditures_snapshot_id=snapshots["expenditures"].id,
        independent_expenditures_snapshot_id=snapshots["independent_expenditures"].id,
        status=models.CampaignFinanceReleaseStatus.published,
        fetch_started_at=datetime(2026, 8, 12, 2, 52, tzinfo=UTC),
        fetch_completed_at=datetime(2026, 8, 12, 2, 54, tzinfo=UTC),
        published_at=datetime(2026, 8, 12, 2, 56, tzinfo=UTC),
    )
    db.add(release)
    db.flush()
    db.execute(
        text(
            "INSERT INTO cf_current_release (id, release_id) VALUES (true, :rid) "
            "ON CONFLICT (id) DO UPDATE SET release_id = EXCLUDED.release_id"
        ),
        {"rid": release.id},
    )

    # The transfer, exactly as the Board's own file carries it: typed `Contribution`,
    # with the giving committee named as the donor.
    db.add(
        models.CampaignFinanceContributionRow(
            snapshot_id=snapshots["contributions"].id,
            row_number=1,
            recipient_reg_num=NAPPER_SENATE,
            recipient=NAPPER_SENATE_NAME,
            recipient_type="PCC",
            amount=NAPPER_TRANSFER,
            receipt_date=date(2026, 6, 15),
            year=2026,
            contributor="Napper Diane House Committee",
            receipt_type="Contribution",
            in_kind="No",
        )
    )
    # Her only other 2026 receipt, typed `Miscellaneous`, which the Board keeps out of
    # the contribution total and this page shows on its own line. Included so the
    # guard is exercised on an `other_receipts` figure too.
    db.add(
        models.CampaignFinanceContributionRow(
            snapshot_id=snapshots["contributions"].id,
            row_number=2,
            recipient_reg_num=NAPPER_SENATE,
            recipient=NAPPER_SENATE_NAME,
            recipient_type="PCC",
            amount=Decimal("100.00"),
            receipt_date=date(2026, 6, 2),
            year=2026,
            contributor="Napper, Diane",
            receipt_type="Miscellaneous",
            in_kind="No",
        )
    )
    db.commit()

    legislator_id = db.execute(text("SELECT id FROM legislator LIMIT 1")).scalar_one()
    for number, name, office in (
        (NAPPER_SENATE, NAPPER_SENATE_NAME, "Senate"),
        (NAPPER_HOUSE, NAPPER_HOUSE_NAME, "House"),
    ):
        db.add(
            models.LegislatorCampaignCommittee(
                legislator_id=legislator_id,
                registration_number=number,
                decision=models.CommitteeLinkReviewDecision.confirmed,
                committee_name_as_reviewed=name,
                office_as_reviewed=office,
                reviewed_by="a person",
            )
        )
    db.commit()
    return str(legislator_id)


def test_the_route_serves_two_committees_and_no_total_of_them(db, client):
    """What actually leaves the building for a member holding 2 committees.

    Both committees come back with their own figures, and the response carries no
    combined figure at any level for a page to print or a caller to trust.
    """
    legislator_id = _two_committees_for_one_member(db)

    response = client.get(
        f"/api/v1/legislators/{legislator_id}/campaign-finance", params={"year": 2026}
    )
    assert response.status_code == 200
    data = response.json()["data"]

    assert len(data["committees"]) == 2
    by_number = {row["registration_number"]: row for row in data["committees"]}
    assert (
        by_number[NAPPER_SENATE]["money_in"]["itemized_contribution_total"]
        == "3000.0000"
    )
    # Her House committee holds no row in the release at all, which is what the Board's
    # own viewer says too ("Data not available for 2026"). The link stays visible with
    # no money block rather than a zero: rule 12's missing-versus-zero rule, and the
    # reason a combined figure would have been 100% the transfer.
    assert by_number[NAPPER_HOUSE]["money_in"] is None
    assert by_number[NAPPER_HOUSE]["money_out"] is None

    # No total across them at the top level. Named words rather than a shape check, so
    # adding a combined figure has to be a deliberate edit to this list.
    for banned in ("total", "combined", "raised", "all_committees"):
        offenders = [key for key in data if banned in key]
        assert not offenders, (
            f"the response grew a cross-committee key containing {banned!r}: {offenders}"
        )


def test_the_guard_moves_no_figure_a_reader_sees(db, client):
    """The change is invisible on the wire, proven against the route rather than a type.

    Run twice, once with the tagging the guard applies and once with it removed. Every
    byte of the response has to match: a guard that quietly reformatted a dollar figure
    would be worse than the double count it prevents.
    """
    from alethical.api.services import legislator_finance as service

    legislator_id = _two_committees_for_one_member(db)
    url = f"/api/v1/legislators/{legislator_id}/campaign-finance"

    guarded = client.get(url, params={"year": 2026}).text

    original = service.reported_by_one_committee
    service.reported_by_one_committee = lambda entry: entry
    try:
        untagged = client.get(url, params={"year": 2026}).text
    finally:
        service.reported_by_one_committee = original

    assert guarded == untagged
