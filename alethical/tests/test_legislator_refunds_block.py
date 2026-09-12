"""What a legislator's page is told about the state's refunds to their donors (#2147).

Minnesota refunds a resident's gift to a state candidate, up to $75 a year for one person
and $150 for a married couple, and publishes what it paid back once a year as a PDF. The
block these tests pin exists so a card can show that history **without ever turning one of
3 different silences into a zero** (``.claude/rules/grounded-answers.md`` rule 12).

The figures are Jim Abeler's own, read from the Board's files on 12 September 2026:

* his Senate committee is registration **17868**, which the Board's registered-candidate
  directory names "Abeler, Jim", RPM, Senate, district 35;
* the 2025 summary prints ``Abeler, Jim Senate - 35 180 $14,216.47 RPM``;
* the 2024 summary prints ``Abeler, Jim Senate - 35 $10,508.22 RPM`` -- **an amount and
  no count**, which is true of every row in that year's file;
* the 2013 summary prints ``Abeler II, Jim House - 35A 19 $1,450.00``, which is his
  earlier House committee and must never land on the Senate committee's card;
* the Board publishes **no 2016 summary at all**.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import text

ABELER_SENATE = "17868"
ABELER_NAME = "Abeler, Jim"


def _clear(session) -> None:
    session.rollback()
    session.execute(text("UPDATE cf_current_release SET release_id = NULL"))
    session.execute(text("DELETE FROM cf_release"))
    session.execute(text("DELETE FROM cf_snapshot"))
    session.execute(text("DELETE FROM cf_refund_row"))
    session.execute(text("DELETE FROM cf_refund_summary"))
    session.execute(text("DELETE FROM cf_refund_not_published"))
    session.execute(text("DELETE FROM legislator_campaign_committee"))
    session.execute(text("DELETE FROM cf_filer"))
    session.execute(text("UPDATE cf_filing_current SET snapshot_id = NULL"))
    session.execute(text("DELETE FROM cf_filing_snapshot"))
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


def _release(db) -> None:
    """A published release, so the endpoint answers at all rather than 503."""
    from alethical.db import models

    snapshots = {}
    for name in ("contributions", "expenditures", "independent_expenditures"):
        marker = f"{name}-{uuid.uuid4()}"
        snapshot = models.CampaignFinanceSnapshot(
            dataset=getattr(models.CampaignFinanceDataset, name),
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
        fetch_started_at=datetime(2026, 9, 12, 2, 52, tzinfo=UTC),
        fetch_completed_at=datetime(2026, 9, 12, 2, 54, tzinfo=UTC),
        published_at=datetime(2026, 9, 12, 2, 56, tzinfo=UTC),
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


def _summary(db, year: int, *, rows):
    """One published candidate summary and the lines under it."""
    from alethical.db import models

    summary = models.CampaignFinanceRefundSummary(
        year=year,
        kind=models.CampaignFinanceRefundKind.candidate,
        source_url=(
            "https://cfb.mn.gov/pdf/publications/public_subsidy/historical/"
            f"{year}_refunds_cand.pdf"
        ),
        content_hash=hashlib.sha256(f"{year}".encode()).hexdigest(),
        byte_size=92725,
        object_key=f"campaign-finance/refund-summary/candidate/{year}.pdf.gz",
        compressed_hash=hashlib.sha256(f"gz-{year}".encode()).hexdigest(),
        compressed_byte_size=80000,
        fetched_on=date(2026, 9, 12),
        fetch_started_at=datetime(2026, 9, 12, 1, 0, tzinfo=UTC),
        fetch_completed_at=datetime(2026, 9, 12, 1, 1, tzinfo=UTC),
        page_count=10,
        row_count=len(rows),
        prints_cents=True,
        status=models.CampaignFinanceRefundStatus.published,
        validation_json={},
    )
    db.add(summary)
    db.flush()
    for number, row in enumerate(rows, start=1):
        name, office, district, count, amount, matched = row
        db.add(
            models.CampaignFinanceRefundRow(
                summary_id=summary.id,
                row_number=number,
                page_number=1,
                printed_name=name,
                printed_line=f"{name} {office} - {district}",
                office_sought=f"{office} - {district}",
                office=office,
                district=district,
                party="RPM",
                section_heading="RPM",
                contribution_count=count,
                refunded_amount=Decimal(amount),
                matched_registration_number=matched,
            )
        )
    db.flush()
    return summary


def _abeler(db) -> str:
    """Abeler's confirmed Senate committee, his register row, and 4 years of summaries."""
    from alethical.db import models

    _release(db)
    snapshot = models.CampaignFinanceFilingSnapshot(
        status=models.CampaignFinanceSnapshotStatus.fetched,
        fetch_started_at=datetime(2026, 9, 12, tzinfo=UTC),
        fetch_completed_at=datetime(2026, 9, 12, tzinfo=UTC),
        validation_json={},
    )
    db.add(snapshot)
    db.flush()
    db.add(
        models.CampaignFinanceFiler(
            snapshot_id=snapshot.id,
            registration_number=ABELER_SENATE,
            kind=models.CampaignFinanceFilerKind.candidate_committee,
            name="Abeler, Jim Senate Committee",
            candidate_name=ABELER_NAME,
            party="RPM",
            office="Senate",
            district="35",
            registration_date=date(2015, 8, 11),
        )
    )
    legislator_id = db.execute(text("SELECT id FROM legislator LIMIT 1")).scalar_one()
    db.add(
        models.LegislatorCampaignCommittee(
            legislator_id=legislator_id,
            registration_number=ABELER_SENATE,
            decision=models.CommitteeLinkReviewDecision.confirmed,
            committee_name_as_reviewed="Abeler, Jim Senate Committee",
            office_as_reviewed="Senate",
            reviewed_by="Alethical, LLC",
        )
    )
    # 2025 carries a count; 2024 does not, because that whole file publishes none.
    _summary(
        db,
        2025,
        rows=[(ABELER_NAME, "Senate", "35", 180, "14216.47", ABELER_SENATE)],
    )
    _summary(
        db,
        2024,
        rows=[(ABELER_NAME, "Senate", "35", None, "10508.22", ABELER_SENATE)],
    )
    # 2017 names him nowhere, so the summary exists and nothing attaches.
    _summary(
        db,
        2017,
        rows=[("Someone, Else", "House", "1A", 3, "150.00", None)],
    )
    db.add(
        models.CampaignFinanceRefundNotPublished(
            year=2016,
            kind=models.CampaignFinanceRefundKind.candidate,
            url=(
                "https://cfb.mn.gov/pdf/publications/public_subsidy/historical/"
                "2016_refunds_cand.pdf"
            ),
            observed_on=date(2026, 9, 12),
            http_status=200,
            served_media_type="text/html; charset=UTF-8",
            byte_size=30113,
            reason=(
                "the Board's page links no file for 2016, and its address answered "
                "HTTP 200 with 30113 bytes that are not a PDF"
            ),
        )
    )
    db.commit()
    return str(legislator_id)


def _refunds(client, legislator_id):
    response = client.get(
        f"/api/v1/legislators/{legislator_id}/campaign-finance", params={"year": 2025}
    )
    assert response.status_code == 200
    committees = response.json()["data"]["committees"]
    assert len(committees) == 1
    return committees[0]["refunds"]


def test_the_card_is_told_what_the_state_refunded_and_which_file_says_so(db, client):
    block = _refunds(client, _abeler(db))

    assert block["state"] == "reported"
    by_year = {row["year"]: row for row in block["years"]}
    assert by_year[2025]["state"] == "reported"
    assert by_year[2025]["contributions_refunded"] == 180
    assert by_year[2025]["amount_refunded"] == "14216.47"
    # The source here is a PDF, so the citation is the file and the day we copied it.
    assert by_year[2025]["source_file_name"] == "2025_refunds_cand.pdf"
    assert by_year[2025]["copied_on"] == "2026-09-12"


def test_a_year_minnesota_published_nothing_for_is_never_a_zero(db, client):
    block = _refunds(client, _abeler(db))

    year = next(row for row in block["years"] if row["year"] == 2016)
    assert year["state"] == "not_published"
    assert year["amount_refunded"] is None
    assert year["contributions_refunded"] is None
    # Nothing to cite, because nothing was published.
    assert year["source_file_name"] is None


def test_a_count_minnesota_did_not_publish_is_never_a_zero(db, client):
    block = _refunds(client, _abeler(db))

    year = next(row for row in block["years"] if row["year"] == 2024)
    # The money is real and the count is genuinely absent from the file. A page says the
    # count was not published; it may not print 0 contributions beside $10,508.22.
    assert year["state"] == "reported"
    assert year["amount_refunded"] == "10508.22"
    assert year["contributions_refunded"] is None


def test_a_published_year_that_names_nobody_matching_says_so_rather_than_zero(
    db, client
):
    block = _refunds(client, _abeler(db))

    year = next(row for row in block["years"] if row["year"] == 2017)
    assert year["state"] == "not_matched"
    assert year["amount_refunded"] is None
    # The file itself is still named, so a reader can go and look at what we read.
    assert year["source_file_name"] == "2017_refunds_cand.pdf"


def test_the_years_run_wider_than_the_year_the_request_asked_for(db, client):
    block = _refunds(client, _abeler(db))

    # The card shows a history. A single year could not say whether a gap is a quiet
    # year or a year Minnesota published nothing.
    assert [row["year"] for row in block["years"]] == [2025, 2024, 2017, 2016]


def test_years_before_the_committee_registered_are_left_out(db, client):
    legislator_id = _abeler(db)
    # His earlier House committee's line, in a year his Senate committee did not exist.
    _summary(
        db,
        2013,
        rows=[("Abeler II, Jim", "House", "35A", 19, "1450.00", None)],
    )
    db.commit()

    block = _refunds(client, legislator_id)

    assert 2013 not in [row["year"] for row in block["years"]]
    # And that line is on no committee's card at all: it attached to nothing.
    unattached = db.execute(
        text(
            "SELECT count(*) FROM cf_refund_row "
            "WHERE printed_name = 'Abeler II, Jim' "
            "AND matched_registration_number IS NULL"
        )
    ).scalar_one()
    assert unattached == 1


def test_holding_no_summaries_at_all_is_a_fact_about_us(db, client):
    legislator_id = _abeler(db)
    db.execute(text("DELETE FROM cf_refund_row"))
    db.execute(text("DELETE FROM cf_refund_summary"))
    db.commit()

    block = _refunds(client, legislator_id)

    assert block["state"] == "unavailable"
    assert block["years"] == []
