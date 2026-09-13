"""Exact printed-name connections, never a combined identity or money total."""

import json
from pathlib import Path
from dataclasses import asdict

import pytest
from sqlalchemy import text

from alethical.api.services.committee_finance import current_release
from alethical.api.services.committee_name_connections import name_connections
from alethical.db import models
from alethical.db.session import get_session_factory
from alethical.pipeline.campaign_finance_reader import ReleaseNoLongerHeld
from alethical.tests.test_committee_page_reads import Published, _clear, _confirm


@pytest.fixture()
def db(seed_database):
    session = get_session_factory()()
    _clear(session)
    try:
        yield session
    finally:
        _clear(session)
        session.close()


def _seed(db, rows):
    published = Published(db)
    for number, row in enumerate(rows, 1):
        db.add(
            models.CampaignFinanceContributionRow(
                **{
                    "snapshot_id": published.contributions.id,
                    "row_number": number,
                    "recipient_reg_num": "17868",
                    "recipient": "Test candidate committee",
                    "recipient_type": "PCC",
                    "year": 2025,
                    "receipt_type": "Contribution",
                    "contrib_type": "Individual",
                    "contributor": "Test Name",
                    "amount": 10,
                    "in_kind": "No",
                    **row,
                }
            )
        )
    published.contributions.row_count = len(rows)
    db.commit()
    return published


def _answer(db, year=2025):
    release = current_release(db)
    assert release is not None
    return name_connections(db, release, "17868", year)


def test_exact_spellings_year_kind_and_distinct_other_registrations(db):
    # Different case, whitespace, initials and Unicode remain separate spellings.
    names = ["Test Name", "test name", "Test Name ", "Test N", "Tést", "Tést"]
    rows = [{"contributor": name} for name in names]
    rows += [{"recipient_reg_num": "10001"}] * 3
    rows += [{"recipient_reg_num": "10002", "in_kind": "Yes"}]
    rows += [
        {"recipient_reg_num": str(20000 + i), "contributor": "test name"}
        for i in range(5)
    ]
    rows += [
        {"recipient_reg_num": "30001", "year": 2024},
        {"recipient_reg_num": "30002", "receipt_type": "Other receipt"},
        {"recipient_reg_num": "30003", "contrib_type": "Lobbyist"},
        {"recipient_reg_num": "30004", "recipient_type": "PPU"},
        {"recipient_reg_num": "30005", "recipient_type": None},
        {"recipient_reg_num": "30006", "recipient_type": "PCF"},
        {"contributor": "Not selected", "receipt_type": "Other receipt"},
        {"contributor": "Also not selected", "contrib_type": "Lobbyist"},
        {"contributor": None},
    ]
    _seed(db, rows)
    answer = _answer(db)
    assert answer.state == "reported" and answer.matching == "exact_printed_name"
    assert (answer.numerator, answer.denominator) == (2, 6)
    assert [bucket.names for bucket in answer.distribution] == [4, 0, 1, 0, 1]
    assert [bucket.other_committees for bucket in answer.distribution] == [
        "0",
        "1",
        "2",
        "3",
        "4+",
    ]
    assert [(row.name, row.other_committees) for row in answer.top_names] == [
        ("test name", 5),
        ("Test Name", 2),
        ("Test N", 0),
        ("Test Name ", 0),
        ("Tést", 0),
    ]


def test_every_distribution_bucket_and_top_five_order(db):
    rows = []
    for count in range(7):
        name = f"Name {count}"
        rows.append({"contributor": name})
        rows.extend(
            {"contributor": name, "recipient_reg_num": str(40000 + i)}
            for i in range(count)
        )
    _seed(db, rows)
    answer = _answer(db)
    assert [row.names for row in answer.distribution] == [1, 1, 1, 1, 3]
    assert (answer.numerator, answer.denominator) == (6, 7)
    assert [row.other_committees for row in answer.top_names] == [6, 5, 4, 3, 2]


def test_absence_and_unheld_year_never_publish_zero_counts(db):
    _seed(db, [{"recipient_reg_num": "10000"}])
    for year, state in [(2025, "not_reported"), (2027, "unavailable")]:
        answer = _answer(db, year)
        assert answer.state == state
        assert answer.numerator is None and answer.denominator is None
        assert answer.distribution == answer.top_names == ()


def test_removed_copy_refuses_instead_of_claiming_no_names(db):
    _seed(db, [{}])
    release = current_release(db)
    db.execute(text("DELETE FROM cf_contribution_row"))
    db.commit()
    with pytest.raises(ReleaseNoLongerHeld):
        name_connections(db, release, "17868", 2025)


def test_another_snapshot_cannot_supply_connections(db):
    old = _seed(db, [{"recipient_reg_num": "10000"}])
    _seed(db, [{}])
    assert old.contributions.id != current_release(db).contributions.snapshot_id
    answer = _answer(db)
    assert (answer.numerator, answer.denominator) == (0, 1)


def test_committee_and_confirmed_member_routes_keep_same_block(db, client):
    _seed(db, [{}, {"recipient_reg_num": "10000"}])
    expected = asdict(_answer(db))
    member = _confirm(
        db,
        "17868",
        decision=models.CommitteeLinkReviewDecision.confirmed,
        basis={"office_as_reviewed": "Senate"},
    )
    blocks = []
    for confirmation in (True, False):
        response = client.get(
            "/api/v1/committees/17868/finance",
            params={"year": 2025, "include_confirmation": confirmation},
        )
        assert response.status_code == 200, response.text
        blocks.append(response.json()["data"]["name_connections"])
    response = client.get(
        f"/api/v1/legislators/{member[0]}/campaign-finance", params={"year": 2025}
    )
    assert response.status_code == 200, response.text
    blocks.append(response.json()["data"]["committees"][0]["name_connections"])
    assert blocks[0] == blocks[1] == blocks[2]
    assert blocks[0]["numerator"] == expected["numerator"] == 1
    assert set(blocks[0]) == {
        "state",
        "year",
        "matching",
        "numerator",
        "denominator",
        "distribution",
        "top_names",
    }


def test_real_17868_2025_rows_reconcile_on_public_routes(db, client):
    fixture = json.loads(
        (
            Path(__file__).parent
            / "fixtures/campaign_finance_name_connections/17868-2025.json"
        ).read_text()
    )
    rows = fixture["target_rows"] + fixture["other_pcc_rows"]
    assert len(rows) == 129
    assert len({row["row_number"] for row in rows}) == 129
    _seed(db, rows)
    result = _answer(db)
    expected = fixture["expected"]
    assert result.denominator == expected["denominator"] == 74
    assert result.numerator == expected["numerator"] == 19
    assert {b.other_committees: b.names for b in result.distribution} == expected[
        "distribution"
    ]
    assert [(r.name, r.other_committees) for r in result.top_names] == [
        (r["contributor"], r["other_pcc_count"]) for r in expected["top_five"]
    ]
    member = _confirm(
        db,
        "17868",
        decision=models.CommitteeLinkReviewDecision.confirmed,
        basis={"office_as_reviewed": "Senate"},
    )
    blocks = []
    for suffix in ("", "&include_confirmation=false"):
        response = client.get(f"/api/v1/committees/17868/finance?year=2025{suffix}")
        assert response.status_code == 200, response.text
        blocks.append(response.json()["data"]["name_connections"])
    response = client.get(f"/api/v1/legislators/{member[0]}/campaign-finance?year=2025")
    assert response.status_code == 200, response.text
    blocks.append(response.json()["data"]["committees"][0]["name_connections"])
    assert blocks[0] == blocks[1] == blocks[2]
    assert blocks[0]["numerator"] == 19 and blocks[0]["denominator"] == 74
