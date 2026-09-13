"""Filed donor-kind lines and matching cash, tested against held source rows."""

from __future__ import annotations

import json
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest
from sqlalchemy import text

from alethical.api.services.committee_stated_by_kind import stated_by_kind
from alethical.db import models
from alethical.api.services.committee_finance import current_release
from alethical.db.session import get_session_factory
from alethical.tests.filed_figures import publish_filings_snapshot
from alethical.tests.test_committee_page_reads import Published, _confirm, _clear

FIXTURES = Path(__file__).parent / "fixtures/campaign_finance_stated_by_kind"


@pytest.fixture()
def db(seed_database):
    session = get_session_factory()()
    _clear(session)
    try:
        yield session
    finally:
        _clear(session)
        session.close()


def _seed(db, name="17868-2025"):
    fixture = json.loads((FIXTURES / f"{name}.json").read_text())
    published = Published(db)
    filing = fixture["filing"]
    registration, year = filing["registration_number"], filing["filing_year"]
    for row in fixture["rows"]:
        values = dict(row)
        values["amount"] = Decimal(values["amount"])
        values["receipt_date"] = (
            date.fromisoformat(values["receipt_date"])
            if values["receipt_date"]
            else None
        )
        db.add(
            models.CampaignFinanceContributionRow(
                snapshot_id=published.contributions.id,
                recipient_reg_num=registration,
                recipient="Abeler, Jim Senate Committee"
                if registration == "17868"
                else "Test committee",
                recipient_type="PCC",
                **values,
            )
        )
    db.commit()
    snapshot = publish_filings_snapshot(
        db,
        filings=[
            (
                registration,
                year,
                row["line_key"],
                Decimal(row["amount"]),
                date.fromisoformat(filing["reported_through"]),
            )
            for row in fixture["figures"]
        ],
    )
    for row in fixture["figures"]:
        db.execute(
            text(
                "UPDATE cf_filing_figure SET label_as_served = :label "
                "WHERE line_key = :key"
            ),
            {"label": row["label_as_served"], "key": row["line_key"]},
        )
    db.execute(
        text("""
        INSERT INTO cf_stated_split
            (snapshot_id, filings_snapshot_id, registration_number, filing_year,
             status, reason, cut_off_date, checked_at)
        VALUES (:payments, :filings, :reg, :year, 'agrees', :reason, :cutoff, now())
    """),
        {
            "payments": published.contributions.id,
            "filings": snapshot,
            "reg": registration,
            "year": year,
            "reason": fixture["verdict"]["reason"],
            "cutoff": date.fromisoformat(fixture["verdict"]["cut_off_date"]),
        },
    )
    db.commit()
    return published, fixture


def _answer(db, registration="17868", year=2025):
    release = current_release(db)
    assert release is not None
    return stated_by_kind(db, release, registration, year)


def test_abelers_five_lines_preserve_all_real_cash_rows_and_the_transfer(db, client):
    _, fixture = _seed(db)
    assert len(fixture["rows"]) == 134
    expected = [
        ("individuals_contributions", "66203.7500", "39950.0000", "26253.7500"),
        ("lobbyist_contributions", "4300.0000", "1400.0000", "2900.0000"),
        ("committee_fund_contributions", "17300.0000", "16050.0000", "1250.0000"),
        ("party_unit_contributions", "9900.0000", "9700.0000", "200.0000"),
        ("other_contributions", "0.0000", "0", "0.0000"),
    ]
    blocks = []
    for confirmation in (True, False):
        response = client.get(
            "/api/v1/committees/17868/finance",
            params={
                "year": 2025,
                "include_confirmation": confirmation,
            },
        )
        assert response.status_code == 200, response.text
        block = response.json()["data"]["stated_by_kind"]
        assert block["state"] == "reported"
        assert block["reported_through"] == "2025-12-31"
        assert [
            (
                line["line_key"],
                line["stated_total"],
                line["itemized_cash_total"],
                line["difference"],
            )
            for line in block["lines"]
        ] == expected
        assert [line["label_as_filed"] for line in block["lines"]] == [
            "Individuals contributions",
            "Lobbyist contributions",
            "Committee/fund contributions",
            "Party unit contributions",
            "Other contributions",
        ]
        blocks.append(block)
    # The member link is test plumbing, not a claim identifying the real candidate.
    member = _confirm(
        db,
        "17868",
        decision=models.CommitteeLinkReviewDecision.confirmed,
        name="Abeler, Jim Senate Committee",
        basis={"office_as_reviewed": "Senate"},
    )
    response = client.get(
        f"/api/v1/legislators/{member[0]}/campaign-finance", params={"year": 2025}
    )
    assert response.status_code == 200, response.text
    assert (
        response.json()["data"]["committees"][0]["stated_by_kind"]
        == blocks[0]
        == blocks[1]
    )


def test_later_donations_do_not_create_a_false_disagreement(db):
    _seed(db, "19287-2026")
    block = _answer(db, "19287", 2026)
    assert block is not None and block.state == "reported"
    assert block.reported_through == date(2026, 3, 31)
    individual = block.lines[0]
    assert individual.stated_total == Decimal("216391.85")
    assert individual.itemized_cash_total == Decimal("168972.94")
    assert individual.difference == Decimal("47418.91")


@pytest.mark.parametrize(
    "name, index, cash",
    [
        ("19492-2026", 0, "1300"),
        ("18807-2024", 4, "1000"),
    ],
)
def test_self_and_explicit_other_follow_their_held_report_schedules(
    db, name, index, cash
):
    _, fixture = _seed(db, name)
    filing = fixture["filing"]
    block = _answer(db, filing["registration_number"], filing["filing_year"])
    assert block is not None and block.state == "reported"
    assert block.lines[index].itemized_cash_total == Decimal(cash)


def test_a_pruned_contribution_copy_never_turns_into_zero_named_cash(db):
    published, fixture = _seed(db)
    published.contributions.row_count = len(fixture["rows"])
    db.execute(text("DELETE FROM cf_contribution_row"))
    db.commit()
    assert _answer(db) is None


def test_special_election_series_withholds_the_whole_block(db):
    _seed(db)
    snapshot = db.execute(
        text("SELECT snapshot_id FROM cf_filing_current WHERE id IS TRUE")
    ).scalar_one()
    db.add(
        models.CampaignFinanceFilingReport(
            snapshot_id=snapshot,
            row_number=1,
            registration_number="17868",
            filing_year=2025,
            report_type="C",
            report_name="Special election",
            special_election=True,
        )
    )
    db.commit()
    assert _answer(db) is None


def test_proved_zero_lines_survive_no_named_payments_on_both_routes(db, client):
    _seed(db)
    db.execute(text("DELETE FROM cf_contribution_row"))
    db.execute(text("UPDATE cf_filing_figure SET amount = 0"))
    snapshot = db.execute(
        text("SELECT snapshot_id FROM cf_filing_current WHERE id IS TRUE")
    ).scalar_one()
    db.add(
        models.CampaignFinanceFiler(
            snapshot_id=snapshot,
            registration_number="17868",
            name="Test committee",
            kind=models.CampaignFinanceFilerKind.candidate_committee,
            office="Senate",
        )
    )
    db.commit()
    committee = client.get("/api/v1/committees/17868/finance", params={"year": 2025})
    assert committee.status_code == 200, committee.text
    block = committee.json()["data"]["stated_by_kind"]
    assert block["state"] == "reported"
    assert len(block["lines"]) == 5
    assert all(
        Decimal(line["stated_total"]) == Decimal(line["itemized_cash_total"]) == 0
        for line in block["lines"]
    )
    member = _confirm(
        db,
        "17868",
        decision=models.CommitteeLinkReviewDecision.confirmed,
        basis={"office_as_reviewed": "Senate"},
    )
    response = client.get(
        f"/api/v1/legislators/{member[0]}/campaign-finance", params={"year": 2025}
    )
    assert response.status_code == 200, response.text
    assert response.json()["data"]["committees"][0]["stated_by_kind"] == block


def test_any_negative_kind_withholds_every_figure_even_with_an_agreeing_check(
    db, client
):
    _seed(db)
    db.execute(
        text(
            "UPDATE cf_filing_figure SET amount = 39949 WHERE line_key = 'individuals_contributions'"
        )
    )
    db.commit()
    response = client.get("/api/v1/committees/17868/finance", params={"year": 2025})
    assert response.json()["data"]["stated_by_kind"] == {
        "state": "sources_disagree",
        "reported_through": "2025-12-31",
        "lines": [],
    }


@pytest.mark.parametrize("status", ["disagrees", "not_checked", "reader_unproven"])
def test_a_non_agreeing_check_never_serves_the_block(db, client, status):
    _seed(db)
    db.execute(
        text(
            "UPDATE cf_stated_split SET status = CAST(:status AS cf_stated_split_status)"
        ),
        {"status": status},
    )
    db.commit()
    response = client.get("/api/v1/committees/17868/finance", params={"year": 2025})
    assert "stated_by_kind" not in response.json()["data"]


@pytest.mark.parametrize("replacement", ["filings", "payments", "no_check"])
def test_both_source_copies_must_match_the_stored_verdict(db, replacement):
    _, fixture = _seed(db)
    if replacement == "filings":
        publish_filings_snapshot(
            db,
            filings=[
                (
                    "17868",
                    2025,
                    row["line_key"],
                    Decimal(row["amount"]),
                    date(2025, 12, 31),
                )
                for row in fixture["figures"]
            ],
        )
    elif replacement == "payments":
        Published(db)
    else:
        db.execute(text("DELETE FROM cf_stated_split"))
        db.commit()
    assert _answer(db) is None


@pytest.mark.parametrize(
    "mutation",
    [
        "UPDATE cf_contribution_row SET contrib_type = NULL WHERE row_number = 69",
        "UPDATE cf_contribution_row SET amount = NULL WHERE row_number = 69",
        "UPDATE cf_contribution_row SET in_kind = NULL WHERE row_number = 69",
        "DELETE FROM cf_filing_figure WHERE line_key = 'other_contributions'",
        "UPDATE cf_filing SET reported_through = '2026-12-31'",
        "UPDATE cf_stated_split SET cut_off_date = '2025-07-01'",
        "UPDATE cf_filing SET filer_kind = 'party_unit'",
    ],
)
def test_incomplete_or_incomparable_inputs_never_become_a_five_line_claim(db, mutation):
    _seed(db)
    db.execute(text(mutation))
    db.commit()
    assert _answer(db) is None


def test_cash_uses_the_source_year_and_keeps_undated_and_repeated_payments(db):
    published, _ = _seed(db)
    for index, values in enumerate(
        [
            {"receipt_date": None},
            {"receipt_date": None},
            {"receipt_date": date(2024, 12, 31)},
            {"in_kind": "Yes"},
            {"receipt_type": "Loan Payable"},
            {"year": 2024},
        ],
        start=900001,
    ):
        attrs = {
            "snapshot_id": published.contributions.id,
            "row_number": index,
            "recipient_reg_num": "17868",
            "year": 2025,
            "amount": Decimal("10"),
            "contrib_type": "Individual",
            "in_kind": "No",
            "receipt_type": "Contribution",
            "receipt_date": date(2025, 1, 1),
            **values,
        }
        db.add(models.CampaignFinanceContributionRow(**attrs))
    db.commit()
    block = _answer(db)
    assert block is not None
    assert block.lines[0].itemized_cash_total == Decimal("39980")
