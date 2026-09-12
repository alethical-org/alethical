"""Refund source evidence survives failed reads and metadata-only enrichment."""

from __future__ import annotations

import gzip
import hashlib
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast

import pytest
from sqlalchemy import select

from alethical.api.services.committee_refunds import refunds_for_committee
from alethical.db import models
from alethical.pipeline import campaign_finance_refunds as refunds
from alethical.tests.test_legislator_refunds_block import (
    _abeler,
    _refunds,
)

from alethical.tests import test_legislator_refunds_block as refund_fixtures

db = refund_fixtures.db

NOTE = "Contributions from a married couple filing jointly are reported as one contribution"
PAGES = [
    f"2025 Contribution Refund Summary for Candidate Committees\nNote: {NOTE}\nRPM\nAbeler, Jim Senate - 35 180 $14,216.47 RPM"
]
INDEX_URL = "https://cfb.mn.gov/example/program-page"
PDF_URL = "https://cfb.mn.gov/pdf/publications/public_subsidy/historical/2025_refunds_cand.pdf"
INDEX = f'<a href="{PDF_URL}">2025</a>'


class Store:
    def __init__(self):
        self.objects = {}

    def put_and_verify(self, key, path, expected_hash):
        body = Path(path).read_bytes()
        assert hashlib.sha256(body).hexdigest() == expected_hash
        self.objects[key] = body

    def get(self, key, destination, *, max_bytes=None):
        body = self.objects[key]
        assert max_bytes is None or len(body) <= max_bytes
        Path(destination).write_bytes(body)


class Http:
    def __init__(self, status=200, body=b"%PDF-test"):
        self.status = status
        self.body = body

    def get(self, url, **kwargs):
        return SimpleNamespace(
            status_code=self.status,
            content=self.body,
            headers={"Content-Type": "application/pdf"},
        )


def load(
    db, monkeypatch, *, http=None, store=None, index=INDEX, years=None, probe=False
):
    monkeypatch.setattr(refunds, "extract_pages", lambda _: PAGES)
    monkeypatch.setattr(refunds, "validate", lambda *a, **kw: [])
    monkeypatch.setattr(refunds.time, "sleep", lambda _: None)
    return refunds.load_refund_summaries(
        db,
        http=cast(Any, http or Http()),
        store=store or Store(),
        index_html=index,
        index_url=INDEX_URL,
        years=years,
        probe_unlinked_years=probe,
        log=lambda _: None,
    )


@pytest.mark.parametrize(
    ("pages", "expected"),
    [
        (PAGES, True),
        (
            [
                "2013 Contribution Refund Summary for Principal Campaign Committees\nNote: "
                + NOTE.replace("reported", "re ported").replace(" ", chr(160))
            ],
            True,
        ),
        (
            [
                f"2024 Contribution Refund Summary for Candidate Committees\nNote: {NOTE.replace(' ', chr(160))}"
            ],
            True,
        ),
        (
            ["2013 Contribution Refund Summary for Principal Campaign Committees\nDFL"],
            False,
        ),
        (["2025 Contribution Refund Summary for Candidate Committees", ""], None),
        (
            [
                "2025 Contribution Refund Summary for Candidate Committees\nMarried couples: see guidance"
            ],
            None,
        ),
        ([], None),
    ],
)
def test_note_presence_is_read_from_complete_source_text(pages, expected):
    assert refunds.source_note_metadata(pages)["joint_filing_counts_as_one"] is expected


def test_reusing_bytes_adds_metadata_without_changing_copy_date(db, monkeypatch):
    store = Store()
    load(db, monkeypatch, store=store)
    summary = db.scalars(select(models.CampaignFinanceRefundSummary)).one()
    summary.fetched_on = date(2025, 12, 31)
    summary.validation_json = {"keep": "existing checks"}
    db.commit()
    original = (
        summary.fetch_started_at,
        summary.fetch_completed_at,
        summary.object_key,
    )

    report = load(db, monkeypatch, store=store)

    assert report.outcomes[0].reused
    assert summary.fetched_on == date(2025, 12, 31)
    assert (
        summary.fetch_started_at,
        summary.fetch_completed_at,
        summary.object_key,
    ) == original
    assert summary.validation_json["keep"] == "existing checks"
    assert (
        cast(dict, summary.validation_json)["source_metadata"]["source_url"]
        == INDEX_URL
    )
    assert (
        cast(dict, summary.validation_json)["source_metadata"][
            "joint_filing_counts_as_one"
        ]
        is True
    )


@pytest.mark.parametrize("status", [200, 403, 500])
def test_failed_linked_read_is_unavailable_and_keeps_published_copy(
    db, monkeypatch, status
):
    load(db, monkeypatch)
    held = db.scalars(select(models.CampaignFinanceRefundSummary)).one()
    report = load(db, monkeypatch, http=Http(status, b"<html>try later</html>"))
    assert report.errors
    assert report.outcomes[0].unavailable_reason
    assert report.outcomes[0].not_published_reason is None
    assert db.scalars(select(models.CampaignFinanceRefundNotPublished)).all() == []
    assert held.status == models.CampaignFinanceRefundStatus.published
    assert (
        refunds_for_committee(db, registration_number="unknown").years[0].state
        == "not_matched"
    )


@pytest.mark.parametrize(
    ("status", "body"),
    [
        (200, b"%PDF-valid-but-unlinked"),
        (403, b"<h1>This page is not available</h1>"),
        (500, b"temporary error"),
        (200, b"<html>temporary error</html>"),
    ],
)
def test_unlinked_read_does_not_invent_nonpublication(db, monkeypatch, status, body):
    index = INDEX + INDEX.replace("2025", "2015")
    report = load(
        db, monkeypatch, http=Http(status, body), index=index, years=[2016], probe=True
    )
    assert not report.not_published
    assert report.errors
    assert db.scalars(select(models.CampaignFinanceRefundNotPublished)).all() == []


def test_confirmed_missing_board_page_can_record_no_file(db, monkeypatch):
    index = INDEX + INDEX.replace("2025", "2015")
    report = load(
        db,
        monkeypatch,
        http=Http(200, b"<h1>This page is not available</h1>"),
        index=index,
        years=[2016],
        probe=True,
    )
    assert len(report.not_published) == 2


def test_new_known_year_failed_to_copy_is_unavailable_not_absent(db, monkeypatch):
    load(db, monkeypatch)
    index = INDEX + INDEX.replace("2025", "2026")
    load(db, monkeypatch, http=Http(503, b"retry"), index=index, years=[2026])
    block = refunds_for_committee(db, registration_number="unknown")
    assert [(row.year, row.state) for row in block.years] == [
        (2026, "unavailable"),
        (2025, "not_matched"),
    ]
    assert block.years[0].amount_refunded is None
    assert block.years[0].copied_on is None


def test_empty_card_gets_stored_source_url_and_newest_actual_copy_date(db, client):
    legislator = _abeler(db)
    summaries = db.scalars(select(models.CampaignFinanceRefundSummary)).all()
    for summary in summaries:
        summary.validation_json = {"source_metadata": {"source_url": INDEX_URL}}
        summary.fetched_on = date(2026, 9, 1 if summary.year == 2025 else 2)
    for row in db.scalars(select(models.CampaignFinanceRefundRow)).all():
        row.matched_registration_number = None
    db.commit()
    block = _refunds(client, legislator)
    assert block["state"] == "not_matched"
    assert block["source_url"] == INDEX_URL
    assert block["copied_on"] == "2026-09-02"
    assert all(row["joint_filing_counts_as_one"] is None for row in block["years"])


@pytest.mark.parametrize("outside_selected_year", [False, True])
@pytest.mark.parametrize("has_matched_rows", [False, True])
def test_missing_copy_stays_visible_when_other_years_have_no_match(
    db, client, outside_selected_year, has_matched_rows
):
    legislator = _abeler(db)
    link = db.scalars(select(models.LegislatorCampaignCommittee)).one()
    link.first_year_as_reviewed = "2024"
    link.last_year_as_reviewed = "2025"
    for summary in db.scalars(select(models.CampaignFinanceRefundSummary)).all():
        summary.validation_json = {
            "source_metadata": {"source_url": INDEX_URL},
            "source_index": {"candidate_years": [2024, 2025, 2026]},
        }
    if not has_matched_rows:
        for row in db.scalars(select(models.CampaignFinanceRefundRow)).all():
            row.matched_registration_number = None
    db.commit()

    response = client.get(
        f"/api/v1/legislators/{legislator}/campaign-finance",
        params={"year": 2023 if outside_selected_year else 2025},
    )
    assert response.status_code == 200
    payload = response.json()["data"]
    key = "committees_outside_this_year" if outside_selected_year else "committees"
    block = payload[key][0]["refunds"]
    assert block["state"] == ("reported" if has_matched_rows else "unavailable")
    assert block["source_url"] == INDEX_URL
    assert block["copied_on"] == "2026-09-12"
    missing = block["years"][0]
    assert missing["year"] == 2026
    assert missing["state"] == "unavailable"
    assert missing["amount_refunded"] is None
    assert missing["contributions_refunded"] is None
    assert missing["copied_on"] is None
    assert next(row for row in block["years"] if row["year"] == 2025)["state"] == (
        "reported" if has_matched_rows else "not_matched"
    )


@pytest.mark.parametrize("note", [True, False, None])
def test_api_uses_per_file_note_metadata_and_old_fixtures_remain_compatible(
    db, client, note
):
    legislator = _abeler(db)
    summary = db.scalars(
        select(models.CampaignFinanceRefundSummary).where(
            models.CampaignFinanceRefundSummary.year == 2025
        )
    ).one()
    summary.validation_json = {"source_metadata": {"joint_filing_counts_as_one": note}}
    db.commit()
    block = _refunds(client, legislator)
    assert block["source_url"] is None
    assert block["years"][0]["joint_filing_counts_as_one"] is note


def test_metadata_enrichment_is_hash_checked_dry_run_and_leaves_raw_facts_alone(
    db, monkeypatch
):
    store = Store()
    load(db, monkeypatch, store=store)
    summary = db.scalars(select(models.CampaignFinanceRefundSummary)).one()
    summary.validation_json = {"checks": ["retained"]}
    db.commit()
    original = (
        summary.fetched_on,
        summary.fetch_started_at,
        summary.fetch_completed_at,
        summary.status,
        summary.content_hash,
        summary.object_key,
    )
    rows_before = [
        (r.printed_name, r.refunded_amount, r.matched_registration_number, r.matched_at)
        for r in db.scalars(select(models.CampaignFinanceRefundRow)).all()
    ]
    proposals = refunds.enrich_refund_source_metadata(
        db, store=store, index_html=INDEX, index_url=INDEX_URL
    )
    assert proposals[0]["changed"]
    assert summary.validation_json == {"checks": ["retained"]}
    refunds.enrich_refund_source_metadata(
        db, store=store, index_html=INDEX, index_url=INDEX_URL, dry_run=False
    )
    db.commit()
    assert (
        cast(dict, summary.validation_json)["source_metadata"][
            "joint_filing_counts_as_one"
        ]
        is True
    )
    assert (
        summary.fetched_on,
        summary.fetch_started_at,
        summary.fetch_completed_at,
        summary.status,
        summary.content_hash,
        summary.object_key,
    ) == original
    assert [
        (r.printed_name, r.refunded_amount, r.matched_registration_number, r.matched_at)
        for r in db.scalars(select(models.CampaignFinanceRefundRow)).all()
    ] == rows_before
    store.objects[summary.object_key] = gzip.compress(b"%PDF-different")
    with pytest.raises((ValueError, AssertionError)):
        refunds.enrich_refund_source_metadata(
            db, store=store, index_html=INDEX, index_url=INDEX_URL, dry_run=False
        )


@pytest.mark.parametrize("office", ["Senate", "Attorney General"])
def test_refund_history_survives_an_outside_year_only_for_legislative_committees(
    db, client, office
):
    legislator = _abeler(db)
    link = db.scalars(select(models.LegislatorCampaignCommittee)).one()
    link.first_year_as_reviewed = "2024"
    link.last_year_as_reviewed = "2025"
    link.office_as_reviewed = office
    db.commit()
    response = client.get(
        f"/api/v1/legislators/{legislator}/campaign-finance", params={"year": 2023}
    )
    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["committees"] == []
    outside = payload["committees_outside_this_year"]
    if office == "Senate":
        assert len(outside) == 1
        assert outside[0]["registration_number"] == link.registration_number
        assert outside[0]["refunds"]["state"] == "reported"
        assert outside[0]["refunds"]["years"][0]["amount_refunded"] == "14216.47"
        assert outside[0]["refunds"]["years"][0]["year"] == 2025
    else:
        assert outside == []


def test_outside_year_refunds_keep_multiple_committee_identities(db, client):
    legislator = _abeler(db)
    first = db.scalars(select(models.LegislatorCampaignCommittee)).one()
    first.first_year_as_reviewed = "2024"
    first.last_year_as_reviewed = "2025"
    db.add(
        models.LegislatorCampaignCommittee(
            legislator_id=first.legislator_id,
            registration_number="19999",
            decision=models.CommitteeLinkReviewDecision.confirmed,
            committee_name_as_reviewed="Separate committee",
            office_as_reviewed="House",
            first_year_as_reviewed="2024",
            last_year_as_reviewed="2025",
            reviewed_by="Test reviewer",
        )
    )
    db.commit()
    response = client.get(
        f"/api/v1/legislators/{legislator}/campaign-finance", params={"year": 2023}
    )
    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["committees"] == []
    outside = {
        entry["registration_number"]: entry
        for entry in payload["committees_outside_this_year"]
    }
    assert set(outside) == {first.registration_number, "19999"}
    assert outside[first.registration_number]["refunds"]["state"] == "reported"
    assert outside["19999"]["refunds"]["state"] == "not_matched"
    assert all(
        year["amount_refunded"] is None for year in outside["19999"]["refunds"]["years"]
    )


def test_failed_enrichment_does_not_partly_update_other_summaries(db, monkeypatch):
    store = Store()
    load(db, monkeypatch, store=store)
    load(
        db,
        monkeypatch,
        store=store,
        http=Http(body=b"%PDF-2024"),
        index=INDEX.replace("2025", "2024"),
    )
    summaries = db.scalars(
        select(models.CampaignFinanceRefundSummary).order_by(
            models.CampaignFinanceRefundSummary.year
        )
    ).all()
    for summary in summaries:
        summary.validation_json = {"keep": "before"}
    db.commit()
    # The first file passes, the second has changed bytes under its saved object key.
    store.objects[summaries[1].object_key] = b"bad"
    with pytest.raises(ValueError, match="compressed hash mismatch"):
        refunds.enrich_refund_source_metadata(
            db,
            store=store,
            index_html=INDEX + INDEX.replace("2025", "2024"),
            index_url=INDEX_URL,
            dry_run=False,
        )
    db.flush()
    assert all(summary.validation_json == {"keep": "before"} for summary in summaries)


@pytest.mark.parametrize("excluded", ["quarantined", "superseded", "party_unit"])
def test_enrichment_and_index_updates_leave_noncurrent_candidate_copies_alone(
    db, monkeypatch, excluded
):
    store = Store()
    load(db, monkeypatch, store=store)
    old = db.scalars(select(models.CampaignFinanceRefundSummary)).one()
    if excluded == "party_unit":
        old.kind = models.CampaignFinanceRefundKind.party_unit
    else:
        old.status = getattr(models.CampaignFinanceRefundStatus, excluded)
    old.validation_json = {"keep": "historical evidence"}
    db.commit()
    load(db, monkeypatch, store=store, http=Http(body=b"%PDF-new-copy"))
    assert old.validation_json == {"keep": "historical evidence"}
    proposals = refunds.enrich_refund_source_metadata(
        db, store=store, index_html=INDEX, index_url=INDEX_URL, dry_run=False
    )
    assert len(proposals) == 1
    assert proposals[0]["summary_id"] != str(old.id)
    assert old.validation_json == {"keep": "historical evidence"}
