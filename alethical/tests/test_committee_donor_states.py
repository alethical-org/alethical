"""Checked committee-year donor states, without exposing the source ZIPs."""

from __future__ import annotations

import json
from dataclasses import asdict, replace
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest
from sqlalchemy import text

from alethical.api.services import committee_donor_states as service
from alethical.api.services.committee_finance import current_release
from alethical.api.services.zip_state_reference import ZipStateReference
from alethical.db import models
from alethical.db.session import get_session_factory
from alethical.pipeline.campaign_finance_reader import ReleaseNoLongerHeld
from alethical.tests.filed_figures import publish_filings_snapshot
from alethical.tests.test_committee_page_reads import Published, _clear, _confirm
from alethical.tests.test_committee_stated_by_kind import _seed as seed_filed_check

FIXTURES = Path(__file__).parent / "fixtures/campaign_finance_donor_states"


@pytest.fixture()
def db(seed_database):
    session = get_session_factory()()
    _clear(session)
    try:
        yield session
    finally:
        _clear(session)
        session.close()


@pytest.fixture(autouse=True)
def reference(monkeypatch):
    # Deliberately invented test assignments, never evidence about a real donor.
    reference = ZipStateReference(
        source_url="https://example.test/postal-reference",
        as_of="2026-08-01",
        copied_at="2026-09-13",
        content_hash="test-reference-hash",
        states={"11111": "MN", "22222": "WI", "33333": "IA", "44444": None},
    )
    monkeypatch.setattr(service, "load_zip_state_reference", lambda: reference)
    return reference


def _seed_rows(db, rows):
    published, _ = seed_filed_check(db)
    db.execute(text("DELETE FROM cf_contribution_row"))
    for number, values in enumerate(rows, start=900001):
        attrs = {
            "snapshot_id": published.contributions.id,
            "row_number": number,
            "recipient_reg_num": "17868",
            "recipient": "Test committee",
            "recipient_type": "PCC",
            "year": 2025,
            "receipt_date": date(2025, 6, 1),
            "receipt_type": "Contribution",
            "contrib_type": "Individual",
            "contributor": "Test Donor",
            "contrib_zip": "11111",
            "in_kind": "No",
            "amount": Decimal("10"),
            **values,
        }
        db.add(models.CampaignFinanceContributionRow(**attrs))
    published.contributions.row_count = len(rows)
    db.commit()
    return published


def _answer(db, registration="17868", year=2025):
    release = current_release(db)
    assert release is not None
    return service.donor_states(db, release, registration, year)


def _buckets(block):
    return {row.state: (row.names, row.cash_total) for row in block.rows}


def _seed_real(db):
    published, filed = seed_filed_check(db)
    fixture = json.loads((FIXTURES / "17868-2025.json").read_text())
    assert (
        fixture["current"]["contributions_snapshot_id"]
        == filed["current"]["contributions_snapshot_id"]
    )
    for row in fixture["rows"]:
        result = db.execute(
            text(
                "UPDATE cf_contribution_row SET contributor = :contributor, "
                "contrib_zip = :contrib_zip WHERE snapshot_id = :snapshot "
                "AND row_number = :row_number AND contrib_type = 'Individual' "
                "AND receipt_type = 'Contribution'"
            ),
            {**row, "snapshot": published.contributions.id},
        )
        assert result.rowcount == 1
    db.commit()
    return fixture


def test_held_rows_preserve_cash_and_names_on_both_routes_without_inventing_states(
    db, client, monkeypatch, reference
):
    fixture = _seed_real(db)
    # This test has no geographical mappings. It proves the real donation
    # arithmetic and route parity, not the pending HUD state assignments.
    empty_reference = replace(reference, states={})
    monkeypatch.setattr(service, "load_zip_state_reference", lambda: empty_reference)
    assert len(fixture["rows"]) == 82
    assert len({row["contributor"] for row in fixture["rows"]}) == 74
    short = [row for row in fixture["rows"] if len(row["contrib_zip"].strip()) < 5]
    assert len(short) == 3
    assert sum(Decimal(row["amount"]) for row in short) == Decimal("1250")
    blocks = []
    for confirmation in (True, False):
        response = client.get(
            "/api/v1/committees/17868/finance",
            params={"year": 2025, "include_confirmation": confirmation},
        )
        assert response.status_code == 200, response.text
        blocks.append(response.json()["data"]["donor_states"])
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
    blocks.append(response.json()["data"]["committees"][0]["donor_states"])
    assert blocks[0] == blocks[1] == blocks[2]
    block = blocks[0]
    assert block["state"] == "reported" and block["year"] == 2025
    assert block["rows"] == [
        {"state": "unknown", "names": 74, "cash_total": "39950.0000"}
    ]
    assert block["summary"] == {
        "minnesota": {"names": 0, "cash_total": "0"},
        "other_states": {"names": 0, "cash_total": "0"},
        "unknown": {"names": 74, "cash_total": "39950.0000"},
    }
    assert block["reference"] == empty_reference.public_metadata()
    # Only state aggregates and source metadata may cross the public boundary.
    assert set(block) == {"state", "year", "rows", "summary", "reference"}
    assert all(set(row) == {"state", "names", "cash_total"} for row in block["rows"])
    serialized = json.dumps(block)
    assert '"contributor"' not in serialized and '"contrib_zip"' not in serialized
    for row in fixture["rows"]:
        assert json.dumps(row["contributor"]) not in serialized
        assert json.dumps(row["contrib_zip"]) not in serialized
        assert json.dumps(row["contrib_zip"].strip()) not in serialized


def test_names_are_exact_printed_names_and_other_states_deduplicates_them(db):
    _seed_rows(
        db,
        [
            {"contributor": "Same Name", "amount": Decimal("10")},
            {"contributor": "Same Name", "amount": Decimal("20")},
            {"contributor": "same name", "amount": Decimal("30")},
            {
                "contributor": "Same Name",
                "contrib_zip": "22222",
                "amount": Decimal("40"),
            },
            {
                "contributor": "Same Name",
                "contrib_zip": "33333",
                "amount": Decimal("50"),
            },
            {"contributor": "Same Name", "contrib_zip": None, "amount": Decimal("60")},
            {
                "contributor": "Gift Donor",
                "contrib_zip": "22222",
                "in_kind": "Yes",
                "amount": Decimal("1000"),
            },
            {"contributor": None, "amount": Decimal("5")},
        ],
    )
    block = _answer(db)
    assert block is not None
    assert _buckets(block) == {
        "MN": (2, Decimal("65")),
        "WI": (2, Decimal("40")),
        "IA": (1, Decimal("50")),
        "unknown": (1, Decimal("60")),
    }
    assert asdict(block.summary) == {
        "minnesota": {"names": 2, "cash_total": Decimal("65")},
        "other_states": {"names": 2, "cash_total": Decimal("90")},
        "unknown": {"names": 1, "cash_total": Decimal("60")},
    }


def test_zip_parsing_keeps_missing_short_unmatched_and_ambiguous_values_unknown(db):
    zips = [
        "11111",
        " 11111 ",
        "11111-1234",
        "111111234",
        None,
        "",
        " 1234 ",
        "99999",
        "44444",
        "11111-12",
        "11111 extra",
        "１１１１１",
    ]
    _seed_rows(
        db,
        [
            {"contributor": f"Donor {i}", "contrib_zip": value}
            for i, value in enumerate(zips)
        ],
    )
    block = _answer(db)
    assert block is not None
    assert _buckets(block) == {"MN": (4, Decimal("40")), "unknown": (8, Decimal("80"))}


def test_all_calendar_year_individual_occurrences_count_without_a_filing_cutoff(db):
    _seed_rows(
        db,
        [
            {"contributor": "Earlier", "receipt_date": date(2025, 1, 1)},
            {"contributor": "Later", "receipt_date": date(2025, 12, 31)},
            {"contributor": "Undated", "receipt_date": None},
            {"contributor": "Source year wins", "receipt_date": date(2024, 12, 31)},
            {"contributor": "Gift", "in_kind": "YES", "amount": None},
            {"contributor": "Wrong year", "year": 2024},
            {"contributor": "Loan", "receipt_type": "Loan Payable"},
            {"contributor": "Self", "contrib_type": "Self"},
            {"contributor": "Lobbyist", "contrib_type": "Lobbyist"},
            {"contributor": "Unknown kind", "contrib_type": None},
            {"contributor": "Different committee", "recipient_reg_num": "99999"},
        ],
    )
    db.execute(text("UPDATE cf_filing SET reported_through = '2025-03-31'"))
    db.execute(text("UPDATE cf_stated_split SET cut_off_date = '2025-03-31'"))
    db.commit()
    block = _answer(db)
    assert block is not None and block.year == 2025
    assert _buckets(block) == {"MN": (5, Decimal("40")), "unknown": (0, Decimal(0))}


@pytest.mark.parametrize(
    "bad_row",
    [{"amount": None}, {"in_kind": None}, {"in_kind": "Maybe"}, {"in_kind": ""}],
)
def test_unreadable_cash_withholds_the_block_but_preserves_the_committee_response(
    db, client, bad_row
):
    _seed_rows(db, [bad_row])
    assert _answer(db) is None
    response = client.get("/api/v1/committees/17868/finance", params={"year": 2025})
    assert response.status_code == 200, response.text
    assert "donor_states" not in response.json()["data"]


@pytest.mark.parametrize(
    "mutation",
    [
        "UPDATE cf_filing SET filer_kind = 'party_unit'",
        "UPDATE cf_filing SET reported_through = '2026-12-31'",
        "UPDATE cf_stated_split SET cut_off_date = '2025-07-01'",
        "UPDATE cf_stated_split SET status = 'disagrees'",
        "UPDATE cf_stated_split SET status = 'not_checked'",
        "UPDATE cf_stated_split SET status = 'reader_unproven'",
        "DELETE FROM cf_stated_split",
    ],
)
def test_unproved_or_wrong_period_evidence_omits_the_block(db, client, mutation):
    _seed_rows(db, [{}])
    db.execute(text(mutation))
    db.commit()
    response = client.get("/api/v1/committees/17868/finance", params={"year": 2025})
    assert response.status_code == 200, response.text
    assert "donor_states" not in response.json()["data"]


@pytest.mark.parametrize("replacement", ["filings", "contributions"])
def test_either_replaced_source_copy_retires_the_old_permission(db, replacement):
    _seed_rows(db, [{}])
    if replacement == "contributions":
        Published(db)
    else:
        publish_filings_snapshot(
            db,
            filings=[
                (
                    "17868",
                    2025,
                    "individuals_contributions",
                    Decimal(10),
                    date(2025, 12, 31),
                )
            ],
        )
    assert _answer(db) is None


def test_agreeing_evidence_cannot_leak_to_another_committee_or_year(db):
    _seed_rows(db, [{}, {"recipient_reg_num": "99999"}, {"year": 2024}])
    assert _answer(db, "99999") is None
    assert _answer(db, year=2024) is None


def test_special_election_series_omits_the_block(db):
    _seed_rows(db, [{}])
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


def test_missing_reference_is_an_omitted_answer(db, monkeypatch):
    _seed_rows(db, [{}])
    monkeypatch.setattr(service, "load_zip_state_reference", lambda: None)
    assert _answer(db) is None


def test_pruned_copy_refuses_instead_of_reporting_zero_donors(db, client):
    _seed_rows(db, [{}])
    db.execute(text("DELETE FROM cf_contribution_row"))
    db.commit()
    with pytest.raises(ReleaseNoLongerHeld):
        _answer(db)
    response = client.get("/api/v1/committees/17868/finance", params={"year": 2025})
    assert response.status_code == 503
    assert "donor_states" not in response.json().get("data", {})
    assert "public" not in response.headers.get("cache-control", "")


def test_proved_empty_individual_rows_are_zero_even_without_a_bulk_committee(
    db, client
):
    _seed_rows(db, [])
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
    member = _confirm(
        db,
        "17868",
        decision=models.CommitteeLinkReviewDecision.confirmed,
        basis={"office_as_reviewed": "Senate"},
    )
    answers = [
        client.get("/api/v1/committees/17868/finance", params={"year": 2025}),
        client.get(
            f"/api/v1/legislators/{member[0]}/campaign-finance", params={"year": 2025}
        ),
    ]
    for response in answers:
        assert response.status_code == 200, response.text
    committee = answers[0].json()["data"]["donor_states"]
    legislator = answers[1].json()["data"]["committees"][0]["donor_states"]
    assert committee == legislator
    assert committee["rows"] == [{"state": "unknown", "names": 0, "cash_total": "0"}]
    assert committee["summary"] == {
        category: {"names": 0, "cash_total": "0"}
        for category in ("minnesota", "other_states", "unknown")
    }


@pytest.mark.parametrize(
    "damage",
    ["missing", "json", "fields", "metadata", "states", "short_zip", "wrong_state"],
)
def test_unusable_packaged_reference_preserves_both_finance_responses(
    db, client, monkeypatch, tmp_path, reference, damage
):
    from alethical.api.services import zip_state_reference as reference_module

    _seed_rows(db, [{}])
    member = _confirm(
        db,
        "17868",
        decision=models.CommitteeLinkReviewDecision.confirmed,
        basis={"office_as_reviewed": "Senate"},
    )
    value = asdict(reference)
    if damage == "fields":
        del value["source_url"]
    elif damage == "metadata":
        value["as_of"] = None
    elif damage == "states":
        value["states"] = []
    elif damage == "short_zip":
        value["states"] = {"1111": "MN"}
    elif damage == "wrong_state":
        value["states"] = {"11111": "XX"}
    path = tmp_path / "reference.json"
    if damage != "missing":
        path.write_text("{" if damage == "json" else json.dumps(value))
    monkeypatch.setattr(reference_module, "REFERENCE_PATH", path)
    monkeypatch.setattr(
        service, "load_zip_state_reference", reference_module.load_zip_state_reference
    )
    reference_module.load_zip_state_reference.cache_clear()
    try:
        responses = [
            client.get("/api/v1/committees/17868/finance", params={"year": 2025}),
            client.get(
                f"/api/v1/legislators/{member[0]}/campaign-finance",
                params={"year": 2025},
            ),
        ]
        for response in responses:
            assert response.status_code == 200, response.text
        blocks = [
            responses[0].json()["data"],
            responses[1].json()["data"]["committees"][0],
        ]
        for block in blocks:
            assert "donor_states" not in block
            assert "money_in" in block and "money_out" in block
    finally:
        reference_module.load_zip_state_reference.cache_clear()


def test_packaged_reference_is_read_without_serving_the_lookup_table(
    monkeypatch, tmp_path, reference
):
    from alethical.api.services import zip_state_reference as reference_module

    path = tmp_path / "reference.json"
    path.write_text(json.dumps(asdict(reference)))
    monkeypatch.setattr(reference_module, "REFERENCE_PATH", path)
    reference_module.load_zip_state_reference.cache_clear()
    try:
        loaded = reference_module.load_zip_state_reference()
        assert loaded == reference
        assert loaded.state_for("11111") == "MN"
        assert "states" not in loaded.public_metadata()
    finally:
        reference_module.load_zip_state_reference.cache_clear()
