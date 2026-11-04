"""The Confirm identities queue answers the same from its summary as from raw rows.

``cf_identity_name_summary`` holds each saved file's per-name totals, written when
a release publishes, and ``cf_identity_name_summary_build`` marks each (file, kind)
build complete. These tests hold the queue to 1 answer whichever source it reads,
page by page, for every kind and status, across exact and spaced spellings,
searches with %, _ and backslash, missing amounts, refunds, mixed and missing dates
and years, repeated rows and a partly confirmed spelling. They also pin what a
marker means: rows without a marker are never read, a complete empty build is
still complete, and a pruned file is refused rather than listed as empty.
"""

# ruff: noqa: F811
from datetime import date
from decimal import Decimal
from itertools import product

import pytest
from sqlalchemy import delete, func, select

from alethical.api.services import finance_identity_directory as directory
from alethical.api.services import identity_confirmations as identities
from alethical.db import models as m
from alethical.pipeline import campaign_finance_name_summary as name_summary
from alethical.tests.finance_fixtures import finance_api, finance_db  # noqa: F401
from alethical.tests.test_finance_versions import read
from alethical.tests.test_identity_confirmations import (  # noqa: F401
    DONOR,
    board,
    create,
    donor,
    gift,
    prints,
)

Dataset = m.CampaignFinanceDataset
QUEUE = "/api/v1/finance/identities/queue"

# Spellings that only an exact, unfolded, escaped match keeps apart.
SPELLINGS = {
    "Spaced  Name": Decimal("40"),
    " Leading Space": Decimal("40"),
    "Trailing Space ": Decimal("40"),
    "100% Pure LLC": Decimal("75"),
    "100 Pure LLC": Decimal("75"),
    "Under_score Co": Decimal("60"),
    "Underscore Co": Decimal("60"),
    "Back\\slash Inc": Decimal("55"),
    "Backslash Inc": Decimal("55"),
}


def snapshots(board):
    return {
        Dataset.contributions: board.contributions_snapshot_id,
        Dataset.expenditures: board.expenditures_snapshot_id,
        Dataset.independent_expenditures: board.independent_expenditures_snapshot_id,
    }


@pytest.fixture()
def names(board, finance_db):
    """The board's files, plus every shape a per-name total has to keep."""
    gave = board.contributions_snapshot_id
    paid = board.expenditures_snapshot_id
    row = iter(range(100, 1000))
    rows = [
        # A missing amount withholds the total; a refund keeps its sign.
        gift(gave, next(row), contributor="Missing, Amount", amount=None),
        gift(gave, next(row), contributor="Missing, Amount", amount=Decimal(10)),
        gift(gave, next(row), contributor="Refund, Ray", amount=Decimal(-40)),
        # Undated: no date and no year. Years only: the period falls back to years.
        gift(gave, next(row), contributor="Undated, Una", receipt_date=None, year=None),
        gift(gave, next(row), contributor="Years, Only", receipt_date=None, year=2024),
        gift(gave, next(row), contributor="Years, Only", year=2025),
        # A date on 1 row and a year on the other: no complete period basis.
        gift(gave, next(row), contributor="Mixed, Period", year=None),
        gift(
            gave, next(row), contributor="Mixed, Period", receipt_date=None, year=2024
        ),
        # Repeated identical rows count twice.
        gift(gave, next(row), contributor="Twice, Tom"),
        gift(gave, next(row), contributor="Twice, Tom"),
        # Blank and missing names are not listed; a missing employer is skipped.
        gift(gave, next(row), contributor="   "),
        gift(gave, next(row), contributor="No, Employer", contrib_employer_name=None),
        # The same spelling as a payee, so only the kind breaks the tie.
        gift(gave, next(row), contributor="Example Media LLC"),
    ]
    rows += [
        gift(
            gave,
            next(row),
            contributor=spelling,
            contrib_employer_name=spelling,
            amount=amount,
        )
        for spelling, amount in SPELLINGS.items()
    ]
    # Equal complete amounts, so the name decides their order across pages.
    rows += [
        gift(gave, next(row), contributor=f"Tie, {letter}", amount=Decimal(250))
        for letter in "EDCBA"
    ]
    rows += [
        m.CampaignFinanceExpenditureRow(
            snapshot_id=paid,
            row_number=next(row),
            committee_reg_num="18135",
            vendor_name=vendor,
            vendor_zip="55401",
            transaction_date=when,
            amount=amount,
            purpose="ADVERTISING",
            year=year,
        )
        for vendor, when, amount, year in (
            ("Example Media LLC", date(2026, 4, 2), None, 2026),
            ("Printer 100%", date(2026, 4, 3), Decimal("80"), 2026),
            ("Printer, Undated", None, Decimal("80"), None),
        )
    ]
    finance_db.add_all(rows)
    finance_db.commit()
    return board


def build(db, board):
    for dataset, snapshot_id in snapshots(board).items():
        name_summary.rebuild(db, dataset, snapshot_id)
    db.commit()


def unbuild(db, board):
    for snapshot_id in snapshots(board).values():
        name_summary.remove(db, snapshot_id)
    db.commit()


def every_answer(db):
    """Every kind, status and search, page by page, past the last page."""
    answers = {}
    for kind, status, q in product(
        directory.KINDS,
        ("unconfirmed", "confirmed", "all"),
        ("", "example", "%", "_", "\\", "space", "ed  na", "100% pure", "tie, "),
    ):
        page = 1
        while True:
            answer = directory.queue(
                db, record_type=kind, status=status, q=q, page=page, page_size=3
            )
            answers[(kind, status, q, page)] = answer
            if page > answer["pages"]:
                break
            page += 1
    return answers


def test_the_summary_answers_exactly_as_the_raw_rows(names, finance_api, finance_db):
    held = prints(finance_api)
    # The donor's 2 identical records share 1 fingerprint; confirming it covers 2
    # of 3 records, so the spelling is partly confirmed and still unconfirmed.
    create(finance_api, "person", "Example, Jordan", donor(names, [held[31]]))
    raw = every_answer(finance_db)
    build(finance_db, names)
    summarized = every_answer(finance_db)
    assert summarized == raw
    # The answers are not trivially empty: every case the fixture holds is listed.
    rows = {
        (row["record_kind"], row["name"]): row
        for (kind, status, q, _), answer in raw.items()
        if (kind, status, q) == ("all", "all", "")
        for row in answer["rows"]
    }
    assert (
        rows[("donor_name", "Missing, Amount")]["amount_state"] == "incomplete_amount"
    )
    assert rows[("donor_name", "Missing, Amount")]["amount"] is None
    assert rows[("donor_name", "Refund, Ray")]["amount"] == "-40.0000"
    assert rows[("donor_name", "Undated, Una")]["undated_records"] == 1
    assert rows[("donor_name", "Years, Only")]["period_basis"] == "years"
    assert rows[("donor_name", "Mixed, Period")]["amount_state"] == "incomplete_period"
    assert rows[("donor_name", "Twice, Tom")]["records"] == 2
    assert (
        rows[("donor_name", DONOR)]["records"],
        rows[("donor_name", DONOR)]["confirmed"],
    ) == (3, 2)
    assert ("donor_name", DONOR) in {
        (row["record_kind"], row["name"])
        for (kind, status, q, _), answer in raw.items()
        if (kind, status, q) == ("all", "unconfirmed", "")
        for row in answer["rows"]
    }
    assert ("donor_name", "   ") not in rows
    assert {("donor_name", spelling) for spelling in SPELLINGS} <= set(rows)
    assert (
        rows[("payee_name", "Example Media LLC")]["amount_state"] == "incomplete_amount"
    )
    searched = raw[("donor", "all", "%", 1)]["rows"]
    assert [row["name"] for row in searched] == ["100% Pure LLC"]
    assert [row["name"] for row in raw[("donor", "all", "\\", 1)]["rows"]] == [
        "Back\\slash Inc"
    ]
    assert [row["name"] for row in raw[("donor", "all", "_", 1)]["rows"]] == [
        "Under_score Co"
    ]
    assert raw[("donor", "confirmed", "", 1)]["total"] == 0


def test_rows_without_a_complete_build_are_never_read(names, finance_db):
    raw = directory.queue(finance_db, record_type="all", status="all", page_size=100)
    # A build that wrote rows but no marker, as a failed build would leave them.
    finance_db.add(
        name_summary.Summary(
            snapshot_id=names.contributions_snapshot_id,
            record_kind="donor_name",
            name="Invented, Partial",
            records=1,
            amount=Decimal(999999),
            missing_amounts=0,
            undated_records=0,
            dated_records=1,
            yeared_records=1,
        )
    )
    finance_db.commit()
    assert (
        directory.queue(finance_db, record_type="all", status="all", page_size=100)
        == raw
    )
    # Some kinds built and some not: each kind is read from its own source.
    name_summary.rebuild(
        finance_db, Dataset.expenditures, names.expenditures_snapshot_id
    )
    finance_db.commit()
    assert (
        directory.queue(finance_db, record_type="all", status="all", page_size=100)
        == raw
    )


def test_a_complete_build_with_no_names_is_complete(names, finance_db):
    independent = names.independent_expenditures_snapshot_id
    finance_db.execute(
        delete(m.CampaignFinanceIndependentExpenditureRow).where(
            m.CampaignFinanceIndependentExpenditureRow.snapshot_id == independent
        )
    )
    name_summary.rebuild(finance_db, Dataset.independent_expenditures, independent)
    finance_db.commit()
    assert name_summary.complete(finance_db, [(independent, "independent_payee_name")])
    assert (
        finance_db.scalar(
            select(func.count())
            .select_from(name_summary.Summary)
            .where(name_summary.Summary.snapshot_id == independent)
        )
        == 0
    )
    # A marker without rows is a complete empty build, not a missing one.
    assert name_summary.held(
        finance_db, Dataset.independent_expenditures, [independent]
    )
    assert not name_summary.held(
        finance_db, Dataset.contributions, [names.contributions_snapshot_id]
    )


@pytest.mark.parametrize("summarized", [True, False])
def test_a_pruned_file_is_refused_not_listed_empty(names, finance_db, summarized):
    gave = names.contributions_snapshot_id
    snapshot = finance_db.get(m.CampaignFinanceSnapshot, gave)
    snapshot.row_count = finance_db.scalar(
        select(func.count())
        .select_from(m.CampaignFinanceContributionRow)
        .where(m.CampaignFinanceContributionRow.snapshot_id == gave)
    )
    finance_db.commit()
    if summarized:
        build(finance_db, names)
    finance_db.execute(
        delete(m.CampaignFinanceContributionRow).where(
            m.CampaignFinanceContributionRow.snapshot_id == gave
        )
    )
    finance_db.commit()
    with pytest.raises(identities.Unavailable):
        directory.queue(finance_db, record_type="donor")


def test_a_rebuild_changes_the_queue_version(names, finance_api, finance_db):
    build(finance_db, names)
    first = read(finance_api, QUEUE, page_size=3)["data"]
    assert read(finance_api, QUEUE, page_size=3, version=first["version"])["data"]
    name_summary.rebuild(
        finance_db, Dataset.contributions, names.contributions_snapshot_id
    )
    finance_db.commit()
    # A page read before the rebuild cannot be joined to 1 read after it.
    read(finance_api, QUEUE, status=409, page=2, page_size=3, version=first["version"])


def test_the_build_and_the_raw_read_name_the_same_columns():
    for kind, spec in name_summary.NAME_KINDS.items():
        printed = identities._PRINTED[kind]
        assert (spec.dataset, spec.model, spec.name) == (
            printed.dataset,
            printed.model,
            printed.name,
        )
    assert set(name_summary.NAME_KINDS) == set(directory.KINDS["all"])
