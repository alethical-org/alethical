"""Public lobbying reads preserve source identity, missing amounts and copy dates."""

from datetime import UTC, date, datetime
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import re
import uuid

import pytest
from sqlalchemy import event, text
from fastapi.testclient import TestClient

from alethical.api.services import lobbying
from alethical.db import models
from alethical.db.session import get_session_factory
from alethical.tests.test_campaign_finance_lists_and_search import (
    Published,
    _clear,
    _filer,
    _register,
)

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures/lobbying_api_real.json").read_text()
)
COPIED = datetime(2026, 9, 13, 23, 0, tzinfo=UTC)


def _clear_lobbying(db):
    db.rollback()
    db.execute(text("UPDATE lobbying_current_release SET release_id = NULL"))
    db.execute(text("DELETE FROM lobbying_release"))
    db.execute(text("DELETE FROM lobbyist_snapshot"))
    db.execute(text("UPDATE lobbying_expenditure_current SET snapshot_id = NULL"))
    db.execute(text("DELETE FROM lobbying_fetch_observation"))
    db.execute(text("DELETE FROM lobbying_expenditure_snapshot"))
    db.commit()


@pytest.fixture()
def db(seed_database):
    session = get_session_factory()()
    _clear_lobbying(session)
    _clear(session)
    try:
        yield session
    finally:
        _clear_lobbying(session)
        _clear(session)
        session.close()


def _pair(db, extra=0):
    marker = hashlib.sha256(str(uuid.uuid4()).encode()).hexdigest()
    spending = models.LobbyingExpenditureSnapshot(
        source_url="https://cfb.mn.gov/lobbying/spending.csv",
        download_id="-1",
        content_hash=marker,
        record_set_hash=marker,
        byte_size=100,
        fetch_started_at=COPIED,
        fetch_completed_at=COPIED,
        status=models.CampaignFinanceSnapshotStatus.loaded,
        row_count=len(FIXTURE["spending"]),
    )
    active = models.LobbyistSnapshot(
        source_url="https://cfb.mn.gov/lobbying/active.csv",
        download_id="-2",
        content_hash=marker,
        record_set_hash=marker,
        byte_size=100,
        fetch_started_at=COPIED,
        fetch_completed_at=COPIED,
        status=models.CampaignFinanceSnapshotStatus.loaded,
        row_count=len(FIXTURE["active"]) + extra,
        association_count=0,
        unparsed_association_count=0,
    )
    db.add_all([spending, active])
    db.flush()
    for source in FIXTURE["spending"]:
        db.add(models.LobbyingExpenditureRow(snapshot_id=spending.id, **source))
    for source in FIXTURE["active"]:
        db.add(
            models.LobbyistRow(
                snapshot_id=active.id,
                registration_number=source["Reg num"],
                name=source["Name"],
                formatted_name=source["Formatted Name"],
            )
        )
    for n in range(extra):
        db.add(
            models.LobbyistRow(
                snapshot_id=active.id,
                registration_number=f"9{n:05}",
                name=f"Test lobbyist {n:03}",
                formatted_name=f"Test lobbyist {n:03}",
            )
        )
    db.flush()
    for source in FIXTURE["active"]:
        for position, entry in enumerate(
            filter(str.strip, source["Associations"].split(";")), 1
        ):
            match = re.fullmatch(r"\((\d+)\) (.+)", entry.strip())
            assert match
            db.add(
                models.LobbyistAssociation(
                    snapshot_id=active.id,
                    registration_number=source["Reg num"],
                    position=position,
                    entity_id=int(match[1]),
                    principal_name=match[2],
                )
            )
            active.association_count += 1
    release = models.LobbyingRelease(
        expenditure_snapshot_id=spending.id,
        lobbyist_snapshot_id=active.id,
        fetch_started_at=COPIED,
        copied_at=COPIED,
    )
    db.add(release)
    db.flush()
    db.execute(
        text(
            "INSERT INTO lobbying_current_release (id, release_id) VALUES (true,:id) ON CONFLICT(id) DO UPDATE SET release_id=excluded.release_id"
        ),
        {"id": release.id},
    )
    db.commit()
    return active, spending, release


def _payments(db):
    register = _register(db, filer_count=2)
    _filer(db, register, "17868", name="Abeler, Jim Senate Committee")
    _filer(
        db,
        register,
        "20006",
        name="DFL House Caucus",
        kind=models.CampaignFinanceFilerKind.party_unit,
    )
    published = Published(db)
    for source in FIXTURE["contributions"]:
        source = dict(source)
        source["receipt_date"] = date.fromisoformat(source["receipt_date"])
        # The data store holds a ZIP but this API must never read or return it.
        db.add(
            models.CampaignFinanceContributionRow(
                snapshot_id=published.contributions.id, contrib_zip="99998", **source
            )
        )
    published.contributions.row_count = len(FIXTURE["contributions"])
    db.commit()
    return published


def _get(client, path):
    response = client.get("/api/v1/lobbying/" + path)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def test_real_kozak_payments_group_by_year_and_committee_without_totals(client, db):
    _pair(db)
    published = _payments(db)
    data = _get(client, "lobbyists/141")
    assert data["name"] == "Kozak, Andrew"
    groups = data["contributions"]["years"][0]["committees"]
    assert groups[0]["registration_number"] == "20006"
    abeler = next(group for group in groups if group["registration_number"] == "17868")
    assert abeler["payment_count"] == 3
    assert [payment["amount"] for payment in abeler["payments"]] == [
        "200.0000",
        "100.0000",
        "100.0000",
    ]
    assert abeler["kind"] == "candidate_committee" and abeler["linkable"]
    assert groups[0]["kind"] == "party_unit"
    assert groups[0]["payments"][0]["contributor_name"] == "Kozak, Andrew V"
    assert data["contributions"]["release_id"] == str(published.release.id)
    assert data["contributions"]["copied_at"] != data["copied_at"]
    assert data["contributions"]["source_url"].endswith("contributions.csv")
    assert "99998" not in json.dumps(data)
    for group in groups:
        assert "total" not in group and "amount" not in group
    assert "total" not in data["contributions"]


def test_observed_recipients_are_linkable_without_reading_their_other_payments(db):
    _pair(db)
    _payments(db)
    # A held payment proves this recipient has a committee page even when the
    # current register has no matching row. Do not turn registration into a gate.
    db.execute(text("DELETE FROM cf_filer WHERE registration_number = '17868'"))
    db.commit()
    statements = []

    def record_query(_connection, _cursor, statement, *_rest):
        statements.append(statement)

    connection = db.connection()
    event.listen(connection, "before_cursor_execute", record_query)
    try:
        data = lobbying._contributions(db, "141")
    finally:
        event.remove(connection, "before_cursor_execute", record_query)
    groups = [group for year in data["years"] for group in year["committees"]]
    assert {group["registration_number"] for group in groups} == {"17868", "20006"}
    assert all(group["linkable"] for group in groups)
    abeler = next(group for group in groups if group["registration_number"] == "17868")
    assert abeler["kind"] is None
    assert abeler["payment_count"] == 3
    # Reading this lobbyist's recipients already proves their existence. Looking
    # up every expenditure of those recipients added seconds on the live record.
    assert not any("cf_expenditure_row" in statement for statement in statements)


def test_principal_uses_spending_name_and_retains_blank_and_zero(client, db):
    _pair(db)
    data = _get(client, "principals/2263")
    source = sorted(
        FIXTURE["spending"], key=lambda row: row["report_year"], reverse=True
    )
    assert data["name"] == source[0]["principal"]
    assert data["spending"]["rows"][0]["year"] == source[0]["report_year"]
    assert data["lobbyists"]["rows"][0]["registration_number"] == "141"
    assert any(
        row["puc_lobbying_amount"] == "0.0000" for row in data["spending"]["rows"]
    )
    assert "total" not in data["spending"]


def test_names_that_differ_are_never_replaced(client, db):
    active, _, _ = _pair(db)
    association = db.get(models.LobbyistAssociation, (active.id, "141", 1))
    association.principal_name = "A different filed spelling"
    db.commit()
    data = _get(client, "principals/2263")
    row = data["lobbyists"]["rows"][0]
    assert row["principal_name_differs"] is True
    assert row["principal_name_as_listed"] == "A different filed spelling"
    assert data["name"] == "American Express"


def test_unregistered_number_keeps_its_contributions(client, db):
    _pair(db)
    published = _payments(db)
    db.execute(
        text(
            "UPDATE cf_contribution_row SET contrib_reg_num='999999' WHERE snapshot_id=:id"
        ),
        {"id": published.contributions.id},
    )
    db.commit()
    data = _get(client, "lobbyists/999999")
    assert data["state"] == "not_registered_today" and data["name"] is None
    assert data["principals"]["state"] == "not_registered_today"
    assert data["contributions"]["payment_count"] == len(FIXTURE["contributions"])


def test_86_associations_and_only_resolved_principal_links(client, db):
    _pair(db)
    data = _get(client, "lobbyists/9865")
    assert data["principals"]["total"] == 86
    assert len(data["principals"]["rows"]) == 86
    assert all(
        row["state"] == "no_spending_rows" and not row["linkable"]
        for row in data["principals"]["rows"]
    )
    kozak = _get(client, "lobbyists/141")
    assert kozak["principals"]["rows"][0]["linkable"] is True


def test_numbered_lists_count_the_whole_and_include_list_only_principals(client, db):
    _pair(db, extra=60)
    people = _get(client, "lobbyists?limit=50&offset=50")
    assert people["total"] == 62 and len(people["lobbyists"]) == 12
    assert people["has_more"] is False
    principals = _get(client, "principals?limit=50&offset=50")
    assert principals["total"] == 99
    assert len(principals["principals"]) == 49
    assert any(
        row["state"] == "no_spending_rows" and not row["linkable"]
        for row in principals["principals"]
    )
    assert client.get("/api/v1/lobbying/lobbyists?limit=51").status_code == 422


def test_principal_list_preserves_distinct_registered_names_by_number(client, db):
    active, _, _ = _pair(db)
    for position, (entity_id, name) in enumerate(
        (
            (2263, "AMERICAN EXPRESS"),
            (2263, "American Express Co."),
            (2263, "AMERICAN EXPRESS"),
            (999999, "American Express"),
            (999999, "Another organisation's name"),
        ),
        100,
    ):
        db.add(
            models.LobbyistAssociation(
                snapshot_id=active.id,
                registration_number="9865",
                position=position,
                entity_id=entity_id,
                principal_name=name,
            )
        )
        active.association_count += 1
    db.commit()

    data = _get(client, "principals?q=American%20Express")
    assert data["total"] == 1
    assert data["has_more"] is False
    assert data["principals"][0] == {
        "entity_id": 2263,
        "name": "American Express",
        "registered_names": ["AMERICAN EXPRESS", "American Express Co."],
        "state": "reported",
        "linkable": True,
        "latest_reported_year": 2025,
    }
    # Registered spellings explain a result but do not change name matching.
    assert _get(client, "principals?q=Express%20Co.")["principals"] == []


def test_principal_list_has_empty_registered_names_without_a_different_spelling(
    client, db
):
    _, spending, _ = _pair(db)
    db.add(
        models.LobbyingExpenditureRow(
            snapshot_id=spending.id, **FIXTURE["blank_spending"]
        )
    )
    spending.row_count += 1
    db.commit()
    for query in ("American%20Express", "Hunter%20Valley", "Moorhead"):
        data = _get(client, f"principals?q={query}")
        assert len(data["principals"]) == 1
        assert data["principals"][0]["registered_names"] == []


def test_principal_list_registered_names_use_only_the_current_pair(client, db):
    old_active, _, _ = _pair(db)
    old_name = db.get(models.LobbyistAssociation, (old_active.id, "141", 1))
    old_name.principal_name = "Old registered spelling"
    db.commit()
    active, _, _ = _pair(db)
    current_name = db.get(models.LobbyistAssociation, (active.id, "141", 1))
    current_name.principal_name = "Current registered spelling"
    db.commit()
    data = _get(client, "principals?q=American%20Express")
    assert data["principals"][0]["registered_names"] == ["Current registered spelling"]
    db.execute(text("UPDATE lobbying_current_release SET release_id = NULL"))
    db.commit()
    unavailable = _get(client, "principals?q=American%20Express")
    assert unavailable["state"] == "unavailable"
    assert unavailable["principals"] == []


def test_principal_list_query_count_does_not_grow_with_the_page(db):
    _pair(db)
    pair = lobbying.published_pair(db)
    counts = []
    for limit in (1, 50):
        statements = []

        def record_query(_connection, _cursor, statement, *_rest):
            statements.append(statement)

        connection = db.connection()
        event.listen(connection, "before_cursor_execute", record_query)
        try:
            data = lobbying.principals_page(db, pair, limit=limit, offset=0)
        finally:
            event.remove(connection, "before_cursor_execute", record_query)
        assert len(data["principals"]) == limit
        counts.append(len(statements))
    assert counts[0] == counts[1]


def test_search_returns_separate_lobbying_groups_with_literal_matching(client, db):
    _pair(db)
    kozak = client.get("/api/v1/campaign-finance/search?q=Kozak").json()["data"]
    group = next(group for group in kozak["groups"] if group["kind"] == "lobbyists")
    assert group["total"] == 1 and group["results"][0]["registration_number"] == "141"
    principal = client.get("/api/v1/campaign-finance/search?q=Hunter%20Valley").json()[
        "data"
    ]
    group = next(
        group for group in principal["groups"] if group["kind"] == "principals"
    )
    assert group["total"] == 1 and group["results"][0]["state"] == "no_spending_rows"
    assert group["results"][0]["linkable"] is False
    assert group["results"][0]["latest_reported_year"] is None
    assert group["results"][0]["source_latest_year"] == max(
        row["report_year"] for row in FIXTURE["spending"]
    )
    typo = client.get("/api/v1/campaign-finance/search?q=Kozakk").json()["data"]
    assert (
        next(group for group in typo["groups"] if group["kind"] == "lobbyists")["total"]
        == 0
    )
    assert kozak["lobbying_copied_at"] is not None


def test_summary_ignores_all_blank_years_and_counts_zero_as_reported(client, db):
    _, spending, _ = _pair(db)
    db.add(
        models.LobbyingExpenditureRow(
            snapshot_id=spending.id,
            row_number=999900,
            entity_id="555",
            principal="Blank only",
            report_year=2029,
        )
    )
    db.add(
        models.LobbyingExpenditureRow(
            snapshot_id=spending.id,
            row_number=999901,
            entity_id="556",
            principal="Stated zero",
            report_year=2028,
            total_spent=Decimal("0"),
        )
    )
    spending.row_count += 2
    db.commit()
    data = _get(client, "summary")
    assert data["registered_lobbyists"] == 2
    assert data["latest_reported_year"] == 2028
    assert data["principals_reporting"] == 1
    blank = _get(client, "principals/555")
    assert blank["spending"]["rows"][0]["total_spent"] is None


def test_missing_pair_or_pruned_rows_never_become_zero(client, db):
    assert _get(client, "summary")["registered_lobbyists"] is None
    assert _get(client, "lobbyists/141")["state"] == "unavailable"
    active, _, _ = _pair(db)
    db.execute(
        text(
            "DELETE FROM lobbyist_association WHERE snapshot_id=:id AND registration_number='141'"
        ),
        {"id": active.id},
    )
    db.commit()
    data = _get(client, "summary")
    assert data["state"] == "unavailable" and data["registered_lobbyists"] is None


def test_pair_does_not_read_the_legacy_spending_pointer(client, db):
    _pair(db)
    db.execute(text("UPDATE lobbying_expenditure_current SET snapshot_id=NULL"))
    db.commit()
    assert _get(client, "principals/2263")["state"] == "reported"


def test_failed_database_read_is_not_an_empty_list(client, db, monkeypatch):
    _pair(db)

    def failed(*args, **kwargs):
        raise RuntimeError("simulated read failure")

    monkeypatch.setattr(lobbying, "principals_page", failed)
    with TestClient(client.app, raise_server_exceptions=False) as failed_client:
        assert failed_client.get("/api/v1/lobbying/principals").status_code == 500


def test_real_blank_spending_row_is_not_replaced_by_zero(client, db):
    _, spending, _ = _pair(db)
    db.add(
        models.LobbyingExpenditureRow(
            snapshot_id=spending.id, **FIXTURE["blank_spending"]
        )
    )
    spending.row_count += 1
    db.commit()
    row = _get(client, "principals/1893")["spending"]["rows"][0]
    assert row["year"] == 2014
    assert all(row[key] is None for key in lobbying.MONEY_COLUMNS)


def test_pruned_contribution_rows_do_not_claim_no_payments(client, db):
    _pair(db)
    published = _payments(db)
    db.execute(
        text("DELETE FROM cf_contribution_row WHERE snapshot_id=:id"),
        {"id": published.contributions.id},
    )
    db.commit()
    data = _get(client, "lobbyists/141")["contributions"]
    assert data["state"] == "unavailable" and data["payment_count"] is None


def test_donation_match_uses_number_and_both_source_type_fields(client, db):
    _pair(db)
    published = _payments(db)
    row = dict(FIXTURE["contributions"][0])
    row["receipt_date"] = date.fromisoformat(row["receipt_date"])
    for number, changes in enumerate(
        (
            {"contrib_type": "Individual"},
            {"receipt_type": "Loan Payable"},
            {"contrib_reg_num": "0141"},
        ),
        990001,
    ):
        db.add(
            models.CampaignFinanceContributionRow(
                snapshot_id=published.contributions.id,
                **{**row, **changes, "row_number": number},
            )
        )
    published.contributions.row_count += 3
    db.commit()
    assert _get(client, "lobbyists/141")["contributions"]["payment_count"] == len(
        FIXTURE["contributions"]
    )


def test_principal_latest_year_ignores_its_newest_blank_row(client, db):
    _, spending, _ = _pair(db)
    latest = max(row["report_year"] for row in FIXTURE["spending"])
    db.add(
        models.LobbyingExpenditureRow(
            snapshot_id=spending.id,
            row_number=999990,
            entity_id="2263",
            principal="American Express",
            report_year=2030,
        )
    )
    spending.row_count += 1
    db.commit()
    detail = _get(client, "principals/2263")
    assert detail["latest_reported_year"] == latest
    listed = _get(client, "principals?q=American%20Express")["principals"][0]
    assert listed["latest_reported_year"] == latest
    searched = client.get(
        "/api/v1/campaign-finance/search?q=American%20Express"
    ).json()["data"]
    group = next(group for group in searched["groups"] if group["kind"] == "principals")
    assert group["results"][0]["latest_reported_year"] == latest
    summary = _get(client, "summary")
    assert summary["first_year"] == min(
        row["report_year"] for row in FIXTURE["spending"]
    )
    assert summary["last_year"] == 2030
    assert summary["latest_reported_year"] == latest


@pytest.mark.parametrize("number", ["0", "000", "unknown", "-1"])
def test_nonidentifying_registration_numbers_never_gather_donations(client, db, number):
    _pair(db)
    _payments(db)
    response = client.get(f"/api/v1/lobbying/lobbyists/{number}")
    assert response.status_code == 422
