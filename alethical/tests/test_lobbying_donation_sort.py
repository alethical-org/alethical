"""A donation sort must not turn incomplete or doubled records into a ranking."""

from datetime import date, datetime, UTC
from decimal import Decimal

import pytest
from sqlalchemy import func, select, text

from alethical.api.services.lobbying_donations import last_completed_year
from alethical.db import models as schema
from alethical.tests.test_lobbying_api import _get, _pair, _payments
from alethical.tests.test_lobbying_api import db as lobbying_db


@pytest.fixture()
def db(seed_database):
    yield from lobbying_db.__wrapped__(seed_database)


def _support(db, published):
    """Test-only proof records, representing a successful full-year comparison."""
    filings = db.scalar(select(schema.CampaignFinanceFilingCurrentSnapshot.snapshot_id))
    gift = schema.CampaignFinanceContributionRow
    rows = db.execute(
        select(gift.recipient_reg_num, gift.year, func.sum(gift.amount))
        .where(
            gift.snapshot_id == published.contributions.id,
            gift.receipt_type == "Contribution",
        )
        .group_by(gift.recipient_reg_num, gift.year)
    ).all()
    for recipient, year, total in rows:
        db.add(
            schema.CampaignFinanceStatedSplit(
                snapshot_id=published.contributions.id,
                registration_number=recipient,
                filing_year=year,
                filings_snapshot_id=filings,
                status=schema.CampaignFinanceStatedSplitStatus.agrees,
                reason="Synthetic full-year proof for this test fixture",
                self_test="passed",
                cut_off_date=date(year, 12, 31),
                stated_itemized=total,
                ours_itemized=total,
                checked_at=datetime.now(UTC),
            )
        )
    db.commit()


def _gift(db, published, registration, amount, **overrides):
    row = schema.CampaignFinanceContributionRow
    number = db.scalar(select(func.max(row.row_number))) + 1
    values = {
        "snapshot_id": published.contributions.id,
        "row_number": number,
        "recipient_reg_num": "17868",
        "recipient": "Abeler, Jim Senate Committee",
        "contributor": "Test gift",
        "contrib_reg_num": registration,
        "contrib_type": "Lobbyist",
        "receipt_type": "Contribution",
        "amount": amount,
        "year": 2025,
        "receipt_date": date(2025, 5, 1),
    }
    values.update(overrides)
    db.add(row(**values))
    published.contributions.row_count += 1
    db.commit()


def _person(data, registration="141"):
    return next(
        p for p in data["lobbyists"] if p["registration_number"] == registration
    )


def test_supported_amount_preserves_identity_and_links_to_same_payment_rows(client, db):
    _pair(db)
    published = _payments(db)
    # Same name, different official number must not enter this person's sum.
    _gift(db, published, "999999", Decimal("5000"), contributor="Kozak, Andrew")
    _gift(db, published, "141", Decimal("999"), contrib_type="Individual")
    _gift(db, published, "141", Decimal("888"), receipt_type="Loan Payable")
    _support(db, published)
    data = _get(client, "lobbyists?sort=donations_desc")
    assert data["sort"] == "donations_desc"
    assert data["requested_year"] is None
    assert data["donations"]["year"] == 2025
    assert data["donations"]["available_years"] == [2025]
    assert data["donations"]["eligible_count"] == 1
    assert data["donations"]["release_id"] == str(published.release.id)
    assert data["donations"]["copied_at"] != data["copied_at"]
    assert data["donations"]["source_url"].endswith("contributions.csv")
    assert _person(data)["donation_amount"] == "1200.0000"
    assert _person(data)["donation_state"] == "reported"
    record = _get(client, "lobbyists/141")
    payments = record["contributions"]["years"][0]["committees"]
    assert sum(
        Decimal(p["amount"]) for c in payments for p in c["payments"]
    ) == Decimal("1200")


@pytest.mark.parametrize(
    "mutation",
    [
        "status='disagrees'",
        "status='not_checked'",
        "status='reader_unproven'",
        "self_test='failed'",
        "self_test='not_available'",
        "cut_off_date='2025-06-30'",
        "cut_off_date='2026-12-31'",
        "filings_snapshot_id=NULL",
        "stated_itemized=ours_itemized-1",
        "ours_itemized=NULL",
    ],
)
def test_one_unsupported_recipient_withholds_the_entire_donor_amount(
    client, db, mutation
):
    _pair(db)
    published = _payments(db)
    _support(db, published)
    db.execute(
        text(f"UPDATE cf_stated_split SET {mutation} WHERE registration_number='17868'")
    )
    db.commit()
    data = _get(client, "lobbyists?year=2025&sort=donations_desc")
    assert _person(data)["donation_amount"] is None
    assert _person(data)["donation_state"] == "unavailable"
    assert data["donations"]["eligible_count"] == 0
    assert data["donations"]["available_years"] == []


@pytest.mark.parametrize("missing", ["proof", "amount", "recipient", "late_receipt"])
def test_missing_proof_or_gift_fields_never_make_a_smaller_total(client, db, missing):
    _pair(db)
    published = _payments(db)
    _support(db, published)
    if missing == "proof":
        db.execute(
            text("DELETE FROM cf_stated_split WHERE registration_number='17868'")
        )
    else:
        assignment = {
            "amount": "amount=NULL",
            "recipient": "recipient_reg_num=NULL",
            "late_receipt": "receipt_date='2026-01-01'",
        }[missing]
        db.execute(
            text(f"UPDATE cf_contribution_row SET {assignment} WHERE row_number=367605")
        )
    db.commit()
    data = _get(client, "lobbyists?year=2025")
    assert _person(data)["donation_amount"] is None
    assert _person(data)["donation_state"] == "unavailable"


def test_duplicate_rows_signed_amounts_in_kind_and_zero_stay_as_filed(client, db):
    _pair(db, extra=1)
    published = _payments(db)
    _gift(db, published, "141", Decimal("10.25"), in_kind="Yes")
    _gift(db, published, "141", Decimal("10.25"), in_kind="Yes")
    _gift(db, published, "141", Decimal("-20.50"))
    _gift(db, published, "900000", Decimal("0"))
    _support(db, published)
    data = _get(client, "lobbyists?year=2025&sort=donations_asc")
    assert data["lobbyists"][0]["registration_number"] == "900000"
    assert _person(data, "900000")["donation_amount"] == "0.0000"
    assert _person(data, "900000")["donation_state"] == "reported"
    assert _person(data)["donation_amount"] == "1200.0000"
    assert _person(data, "9865")["donation_amount"] is None
    assert _person(data, "9865")["donation_state"] == "no_records"


def test_source_year_controls_selection_and_newer_unsupported_year_is_not_default(
    client, db
):
    _pair(db)
    published = _payments(db)
    _gift(
        db, published, "141", Decimal("100"), year=2024, receipt_date=date(2023, 12, 1)
    )
    _support(db, published)
    db.execute(
        text("UPDATE cf_stated_split SET status='not_checked' WHERE filing_year=2025")
    )
    db.commit()
    data = _get(client, "lobbyists")
    assert data["donations"]["year"] == 2024
    assert data["donations"]["available_years"] == [2024]
    assert _person(data)["donation_amount"] == "100.0000"
    assert (
        _person(_get(client, "lobbyists?year=2023"))["donation_state"] == "no_records"
    )


def test_sort_orders_the_whole_matching_directory_before_pagination(client, db):
    _pair(db, extra=60)
    published = _payments(db)
    _gift(db, published, "900059", Decimal("9999"))
    _gift(db, published, "900002", Decimal("50"))
    _gift(db, published, "900001", Decimal("50"))
    _support(db, published)
    highest = _get(client, "lobbyists?limit=1&sort=donations_desc")
    assert highest["lobbyists"][0]["registration_number"] == "900059"
    assert highest["total"] == 62
    assert highest["donations"]["eligible_count"] == 4
    assert highest["has_more"]
    following = _get(client, "lobbyists?limit=1&offset=1&sort=donations_desc")
    assert following["lobbyists"][0]["registration_number"] == "141"
    lowest = _get(client, "lobbyists?limit=2&sort=donations_asc&q=Test")
    assert [p["registration_number"] for p in lowest["lobbyists"]] == [
        "900001",
        "900002",
    ]
    assert lowest["total"] == 60
    assert lowest["donations"]["eligible_count"] == 3
    end = _get(client, "lobbyists?limit=1&offset=61&sort=donations_asc")
    assert end["lobbyists"][0]["donation_amount"] is None
    assert not end["has_more"]


def test_the_bare_directory_opens_on_the_dollar_order_and_name_stays_reachable(
    client, db
):
    """The address with no sort is the dollar order, so the page and the API agree."""
    _pair(db, extra=60)
    published = _payments(db)
    _gift(db, published, "900059", Decimal("9999"))
    _support(db, published)
    default = _get(client, "lobbyists?limit=1")
    assert default["sort"] == "donations_desc"
    assert default["lobbyists"][0]["registration_number"] == "900059"
    named = _get(client, "lobbyists?limit=1&sort=name")
    assert named["sort"] == "name"
    assert named["lobbyists"][0]["registration_number"] != "900059"
    assert named["total"] == default["total"]


def test_the_name_lookup_stays_alphabetical_whatever_the_directory_defaults_to(
    client, db
):
    """The search surface names people; only the directory address ranks money."""
    _pair(db, extra=60)
    published = _payments(db)
    _gift(db, published, "900059", Decimal("9999"))
    _support(db, published)
    found = client.get(
        "/api/v1/campaign-finance/search", params={"q": "Test", "limit": 5}
    )
    assert found.status_code == 200
    group = next(
        item for item in found.json()["data"]["groups"] if item["kind"] == "lobbyists"
    )
    names = [row["name"] for row in group["results"]]
    assert names == sorted(names)


def test_campaign_data_absent_or_partly_pruned_never_claims_no_gifts(client, db):
    _pair(db)
    absent = _get(client, "lobbyists?year=2025")
    assert absent["donations"]["state"] == "unavailable"
    assert all(p["donation_state"] == "unavailable" for p in absent["lobbyists"])
    published = _payments(db)
    _support(db, published)
    db.execute(text("DELETE FROM cf_contribution_row WHERE row_number=367605"))
    db.commit()
    pruned = _get(client, "lobbyists?year=2025&sort=donations_desc")
    assert pruned["donations"]["state"] == "unavailable"
    assert pruned["donations"]["eligible_count"] is None
    assert all(p["donation_state"] == "unavailable" for p in pruned["lobbyists"])


def test_unavailable_roster_keeps_donation_metadata_unavailable(client, db):
    data = _get(client, "lobbyists?year=2025&sort=donations_desc")
    assert data["state"] == "unavailable"
    assert data["donations"]["state"] == "unavailable"
    assert data["donations"]["year"] == 2025
    assert data["requested_year"] == 2025


@pytest.mark.parametrize("params", ["year=2014", "year=oops", "sort=biggest"])
def test_bad_sort_or_year_is_rejected(client, params):
    assert client.get(f"/api/v1/lobbying/lobbyists?{params}").status_code == 422


def test_incomplete_year_cannot_be_compared(client):
    year = last_completed_year() + 1
    assert client.get(f"/api/v1/lobbying/lobbyists?year={year}").status_code == 422


def _donor_proof(db, published, donors, recipient="17868", withheld=None):
    """Synthetic reviewed evidence, separate from source rows."""
    from uuid import uuid4

    run = schema.LobbyistDonationEvidence(
        contributions_snapshot_id=published.contributions.id,
        filings_snapshot_id=db.scalar(
            select(schema.CampaignFinanceFilingCurrentSnapshot.snapshot_id)
        ),
        source_row_count=published.contributions.row_count,
        proof_version=1,
        content_hash=uuid4().hex * 2,
        object_key="test/evidence.json.gz",
        compressed_hash="a" * 64,
        evidence={
            "recipients": [
                {"registration_number": recipient, "year": 2025, "donors": donors}
            ],
            "withheld_recipients": withheld or [],
        },
    )
    db.add(run)
    db.flush()
    db.add(schema.LobbyistDonationEvidenceCurrent(id=True, evidence_id=run.id))
    db.commit()
    return run


def test_donor_proof_recovers_amount_despite_unrelated_recipient_disagreement(
    client, db
):
    _pair(db)
    published = _payments(db)
    _support(db, published)
    db.execute(
        text(
            "UPDATE cf_stated_split SET status='disagrees' WHERE registration_number='17868'"
        )
    )
    db.commit()
    numbers = list(
        db.scalars(
            select(schema.CampaignFinanceContributionRow.row_number).where(
                schema.CampaignFinanceContributionRow.year == 2025,
                schema.CampaignFinanceContributionRow.recipient_reg_num == "17868",
                schema.CampaignFinanceContributionRow.receipt_type == "Contribution",
                schema.CampaignFinanceContributionRow.contrib_reg_num == "141",
                schema.CampaignFinanceContributionRow.snapshot_id
                == published.contributions.id,
            )
        )
    )
    _donor_proof(db, published, {"141": {"status": "agrees", "row_numbers": numbers}})
    data = _get(client, "lobbyists?year=2025")
    assert _person(data)["donation_amount"] == "1200.0000"
    assert data["donations"]["evidence_id"]


def test_report_backed_identity_uses_same_held_rows_on_profile_and_directory(
    client, db
):
    _pair(db)
    published = _payments(db)
    _support(db, published)
    _gift(
        db,
        published,
        None,
        Decimal("500"),
        contrib_type="Individual",
        contributor="Kozak, Andrew",
    )
    numbers = list(
        db.scalars(
            select(schema.CampaignFinanceContributionRow.row_number).where(
                schema.CampaignFinanceContributionRow.year == 2025,
                schema.CampaignFinanceContributionRow.recipient_reg_num == "17868",
                schema.CampaignFinanceContributionRow.receipt_type == "Contribution",
                schema.CampaignFinanceContributionRow.snapshot_id
                == published.contributions.id,
            )
        )
    )
    _donor_proof(db, published, {"141": {"status": "agrees", "row_numbers": numbers}})
    data = _get(client, "lobbyists?year=2025")
    assert _person(data)["donation_amount"] == "1700.0000"
    profile = _get(client, "lobbyists/141")["contributions"]
    payments = [
        p for y in profile["years"] for c in y["committees"] for p in c["payments"]
    ]
    assert sum(Decimal(p["amount"]) for p in payments) == Decimal("1700")
    assert any(p["identity_basis"] == "official_report" for p in payments)


def test_donor_disagreement_overrides_recipient_pass(client, db):
    _pair(db)
    published = _payments(db)
    _support(db, published)
    _donor_proof(db, published, {"141": {"status": "disagrees", "row_numbers": []}})
    assert (
        _person(_get(client, "lobbyists?year=2025"))["donation_state"] == "unavailable"
    )


def test_missing_known_report_donor_withholds_instead_of_claiming_no_records(
    client, db
):
    _pair(db)
    published = _payments(db)
    _support(db, published)
    _donor_proof(db, published, {"9865": {"status": "disagrees", "row_numbers": []}})
    assert (
        _person(_get(client, "lobbyists?year=2025"), "9865")["donation_state"]
        == "unavailable"
    )


def test_superseded_recipient_pass_cannot_survive_failed_new_report_read(client, db):
    _pair(db)
    published = _payments(db)
    _support(db, published)
    _donor_proof(
        db, published, {}, withheld=[{"registration_number": "17868", "year": 2025}]
    )
    assert (
        _person(_get(client, "lobbyists?year=2025"))["donation_state"] == "unavailable"
    )


def test_pruned_source_withholds_profile_and_directory_proof(client, db):
    _pair(db)
    published = _payments(db)
    _support(db, published)
    _donor_proof(db, published, {"141": {"status": "agrees", "row_numbers": [367605]}})
    db.execute(text("DELETE FROM cf_contribution_row WHERE row_number=367605"))
    db.commit()
    assert _get(client, "lobbyists?year=2025")["donations"]["state"] == "unavailable"
    assert _get(client, "lobbyists/141")["contributions"]["state"] == "unavailable"


def test_old_proof_version_is_not_applied(client, db):
    _pair(db)
    published = _payments(db)
    _support(db, published)
    run = _donor_proof(
        db, published, {"141": {"status": "disagrees", "row_numbers": []}}
    )
    run.proof_version = 0
    db.commit()
    assert _person(_get(client, "lobbyists?year=2025"))["donation_state"] == "reported"


@pytest.mark.parametrize("donor", ["141", "9865"])
def test_failed_second_proof_run_cannot_forget_missing_id_only_recipient(
    client, db, donor
):
    from alethical.pipeline.lobbyist_evidence_publication import (
        inherited_unresolved_donors,
    )

    _pair(db)
    published = _payments(db)
    _gift(
        db,
        published,
        None,
        Decimal("500"),
        recipient_reg_num="20006",
        contrib_type="Individual",
        contributor="Report proved donor",
    )
    _support(db, published)
    number = db.scalar(
        select(schema.CampaignFinanceContributionRow.row_number).where(
            schema.CampaignFinanceContributionRow.contributor == "Report proved donor"
        )
    )
    first = _donor_proof(
        db,
        published,
        {donor: {"status": "agrees", "row_numbers": [number]}},
        recipient="20006",
    )
    assert (
        _person(_get(client, "lobbyists?year=2025"), donor)["donation_state"]
        == "reported"
    )
    unresolved = inherited_unresolved_donors(
        {
            "recipients": [],
            "failures": [{"registration_number": "20006", "year": 2025}],
        },
        first.evidence,
        str(first.id),
    )
    db.execute(text("DELETE FROM lobbyist_donation_evidence_current"))
    db.commit()
    second = _donor_proof(db, published, {}, recipient="20006")
    second.evidence = {**second.evidence, "unresolved_donors": unresolved}
    db.commit()
    person = _person(_get(client, "lobbyists?year=2025"), donor)
    assert person["donation_state"] == "unavailable"
    assert person["donation_amount"] is None
    profile = _get(client, f"lobbyists/{donor}")["contributions"]
    assert profile["state"] == "unavailable"
    assert profile["payment_count"] is None
    assert profile["years"] == []


def _replace_filing_source(db):
    now = datetime.now(UTC)
    fresh = schema.CampaignFinanceFilingSnapshot(
        fetch_started_at=now,
        fetch_completed_at=now,
        status=schema.CampaignFinanceSnapshotStatus.loaded,
    )
    db.add(fresh)
    db.flush()
    db.execute(text("UPDATE cf_filing_current SET snapshot_id=:id"), {"id": fresh.id})
    db.commit()
    return fresh


@pytest.mark.parametrize("donor", ["141", "9865"])
@pytest.mark.parametrize("missing_filings", [False, True])
def test_filing_change_keeps_known_missing_id_donor_unavailable_until_new_proof(
    client, db, donor, missing_filings
):
    from alethical.api.services.lobbyist_donation_evidence import (
        active_evidence,
        matched_row_numbers,
    )

    _pair(db)
    published = _payments(db)
    _gift(
        db,
        published,
        None,
        Decimal("500"),
        recipient_reg_num="20006",
        contrib_type="Individual",
        contributor="Report proved donor",
    )
    _support(db, published)
    number = db.scalar(
        select(schema.CampaignFinanceContributionRow.row_number).where(
            schema.CampaignFinanceContributionRow.contributor == "Report proved donor"
        )
    )
    first = _donor_proof(
        db,
        published,
        {donor: {"status": "agrees", "row_numbers": [number]}},
        recipient="20006",
    )
    assert (
        _person(_get(client, "lobbyists?year=2025"), donor)["donation_state"]
        == "reported"
    )
    assert _get(client, f"lobbyists/{donor}")["contributions"]["state"] == "reported"
    if missing_filings:
        db.execute(text("UPDATE cf_filing_current SET snapshot_id=NULL"))
        db.commit()
    else:
        _replace_filing_source(db)
    stale = active_evidence(
        db, published.contributions.id, published.contributions.row_count
    )
    assert stale["proof_state"] == "stale_filings"
    assert stale["recipients"] == []
    assert matched_row_numbers(stale) == {}
    assert stale["unresolved_donors"] == [
        {
            "donor_registration_number": donor,
            "recipient_registration_number": "20006",
            "year": 2025,
            "previous_evidence_id": str(first.id),
        }
    ]
    person = _person(_get(client, "lobbyists?year=2025"), donor)
    assert person["donation_state"] == "unavailable"
    assert person["donation_amount"] is None
    profile = _get(client, f"lobbyists/{donor}")["contributions"]
    assert profile["state"] == "unavailable"
    assert profile["payment_count"] is None
    assert profile["years"] == []
    if donor == "9865":
        assert _get(client, "lobbyists/141")["contributions"]["state"] == "reported"
    # Fresh proof restores positive row association. Existing source rows remain unchanged.
    if missing_filings:
        _replace_filing_source(db)
    db.execute(text("DELETE FROM lobbyist_donation_evidence_current"))
    db.commit()
    _donor_proof(
        db,
        published,
        {donor: {"status": "agrees", "row_numbers": [number]}},
        recipient="20006",
    )
    fresh = active_evidence(
        db, published.contributions.id, published.contributions.row_count
    )
    assert fresh["proof_state"] == "current"
    assert matched_row_numbers(fresh) == {number: donor}
    assert _get(client, f"lobbyists/{donor}")["contributions"]["state"] == "reported"


def test_stale_filings_negative_evidence_keeps_source_count_and_version_gates(db):
    from uuid import uuid4
    from alethical.api.services.lobbyist_donation_evidence import active_evidence

    _pair(db)
    published = _payments(db)
    run = _donor_proof(
        db, published, {"9865": {"status": "disagrees", "row_numbers": []}}
    )
    _replace_filing_source(db)
    assert active_evidence(db, uuid4(), published.contributions.row_count) is None
    assert (
        active_evidence(
            db, published.contributions.id, published.contributions.row_count + 1
        )
        is None
    )
    run.proof_version = 0
    db.commit()
    assert (
        active_evidence(
            db, published.contributions.id, published.contributions.row_count
        )
        is None
    )


def test_stale_filings_retains_existing_unresolved_origin_without_positive_rows(db):
    from alethical.api.services.lobbyist_donation_evidence import active_evidence

    _pair(db)
    published = _payments(db)
    run = _donor_proof(
        db, published, {"141": {"status": "agrees", "row_numbers": [367605]}}
    )
    inherited = {
        "donor_registration_number": "9865",
        "recipient_registration_number": "20006",
        "year": 2024,
        "previous_evidence_id": "original-proof-id",
    }
    run.evidence = {**run.evidence, "unresolved_donors": [inherited]}
    db.commit()
    _replace_filing_source(db)
    evidence = active_evidence(
        db, published.contributions.id, published.contributions.row_count
    )
    assert inherited in evidence["unresolved_donors"]
    assert len(evidence["unresolved_donors"]) == 2
    assert evidence["recipients"] == []
