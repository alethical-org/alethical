"""Source versions and complete report sets determine whether evidence can publish."""

from dataclasses import asdict
from datetime import date
import hashlib
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch
import json

import pytest

from alethical.pipeline.campaign_finance_filings import CatalogueReport
from alethical.pipeline.lobbyist_evidence_run import (
    selected_reports,
    superseded_comparisons,
    source_audit,
    build_run,
    read_recipient,
)
from alethical.pipeline.lobbyist_evidence_publication import runtime_evidence
from alethical.pipeline.lobbyist_report_collection import collect_one
from alethical.db.models import CampaignFinanceFilerKind as Kind
from alethical.pipeline.lobbyist_donor_proof import source_fingerprint


def entry(**changes):
    values: dict[str, Any] = dict(
        registration_number="20010",
        filing_year=2025,
        report_type="YE",
        report_name="Year end",
        cut_off_date=date(2025, 12, 31),
        special_election=False,
        effective_amendment_index=2,
        amendment_count=3,
        termination_date=None,
    )
    values.update(changes)
    return CatalogueReport(**values)


def test_effective_year_end_replaces_overlapping_reports_and_keeps_special_series():
    regular = entry()
    special = entry(special_election=True, cut_off_date=date(2025, 5, 14))
    earlier = entry(report_type="B", cut_off_date=date(2025, 6, 30))
    assert selected_reports([earlier, special, regular, regular], 2025) == [
        regular,
        special,
    ]


def test_unknown_version_or_ambiguous_last_report_fails_closed():
    with pytest.raises(ValueError, match="unknown_version"):
        selected_reports([entry(effective_amendment_index=None)], 2025)
    with pytest.raises(ValueError, match="ambiguous_latest"):
        selected_reports([entry(), entry(report_type="G")], 2025)


def catalogue_payload(amendment=2, special=False):
    report = {
        "RegisteredEntityID": "20010",
        "FilingYear": "2025",
        "ReportType": "YE",
        "ReportName": "Year end",
        "CutOffDate": "2025-12-31 00:00:00",
        "SpecialElectionindicator": "1" if special else "0",
        "amendments": [str(amendment)],
        "TerminationDate": None,
    }
    return {"data": {"pdfs": {"first": report}}}


def retained_source(tmp_path, *, amendment=2, body=None, legacy=False):
    catalogue = json.dumps(catalogue_payload(amendment)).encode()
    catalogue_hash = hashlib.sha256(catalogue).hexdigest()
    catalogue_path = f"{catalogue_hash}-catalogue.json"
    (tmp_path / catalogue_path).write_bytes(catalogue)
    ref = {
        "kind": "party_unit",
        "catalogue_hash": catalogue_hash,
        "catalogue_path": catalogue_path,
    }
    record = {
        "recipient": "20010",
        "year": 2025,
        "documents": [],
        "fetched_at": "2026-09-19T12:00:00+00:00",
    }
    if not legacy:
        record["catalogues"] = [
            {
                **ref,
                "selected_reports": [
                    asdict(entry(effective_amendment_index=amendment))
                ],
            }
        ]
    if body is not None:
        digest = hashlib.sha256(body).hexdigest()
        (tmp_path / f"{digest}.pdf").write_bytes(body)
        record["documents"].append(
            {
                **ref,
                "document_hash": digest,
                "path": f"{digest}.pdf",
                "report": asdict(entry(effective_amendment_index=amendment)),
            }
        )
    (tmp_path / "20010-2025.json").write_text(json.dumps(record, default=str))
    return record


def comparison(amendment=1, digest="a" * 64):
    return {
        ("20010", 2025): {
            "status": "agrees",
            "report_type": "YE",
            "amendment_index": amendment,
            "document_hash": digest,
            "cut_off_date": date(2025, 12, 31),
        }
    }


def test_new_catalogue_invalidates_earlier_pass_when_pdf_is_unavailable(tmp_path):
    retained_source(tmp_path, amendment=2)
    assert superseded_comparisons(tmp_path, [("20010", 2025)], comparison()) == [
        {
            "registration_number": "20010",
            "year": 2025,
            "reason": "recipient_comparison_uses_other_report_evidence",
        }
    ]


def test_changed_catalogue_cutoff_invalidates_same_amendment_without_pdf(tmp_path):
    retained_source(tmp_path, amendment=2)
    old = comparison(amendment=2)
    old[("20010", 2025)]["cut_off_date"] = date(2025, 12, 30)
    assert superseded_comparisons(tmp_path, [("20010", 2025)], old) == [
        {
            "registration_number": "20010",
            "year": 2025,
            "reason": "recipient_comparison_uses_other_report_evidence",
        }
    ]


def test_later_amendment_or_changed_bytes_invalidates_earlier_pass_even_without_parser(
    tmp_path,
):
    record = retained_source(tmp_path, body=b"%PDF served but parser unsupported")
    digest = record["documents"][0]["document_hash"]
    assert len(superseded_comparisons(tmp_path, [("20010", 2025)], comparison())) == 1
    assert (
        len(
            superseded_comparisons(tmp_path, [("20010", 2025)], comparison(amendment=2))
        )
        == 1
    )
    assert (
        superseded_comparisons(
            tmp_path, [("20010", 2025)], comparison(amendment=2, digest=digest)
        )
        == []
    )


def test_failure_retains_catalogue_body_documents_and_source_collection_time(tmp_path):
    record = retained_source(tmp_path, body=b"%PDF unavailable parser fixture")
    row = {
        "row_number": 1,
        "recipient_reg_num": "20010",
        "year": 2025,
        "amount": "25.00",
    }
    result = build_run(tmp_path, [row], [("20010", 2025)])
    assert result["recipients"] == []
    failure = result["failures"][0]
    assert failure["collected_at"] == record["fetched_at"]
    assert failure["source_fingerprint"] == source_fingerprint([row])
    assert failure["catalogues"][0]["payload"] == catalogue_payload()
    assert (
        failure["catalogues"][0]["selected_reports"][0]["effective_amendment_index"]
        == 2
    )
    assert failure["documents"] == [
        {
            "document_hash": record["documents"][0]["document_hash"],
            "registration_number": "20010",
            "filing_year": 2025,
            "report_type": "YE",
            "amendment_index": 2,
            "special_election": False,
        }
    ]
    assert failure["audit_errors"] == []


def test_invalid_catalogue_hash_cannot_invalidate_from_manifest_claim_alone(tmp_path):
    record = retained_source(tmp_path)
    path = tmp_path / record["catalogues"][0]["catalogue_path"]
    path.write_text("{}")
    assert superseded_comparisons(tmp_path, [("20010", 2025)], comparison()) == []
    audit = source_audit(tmp_path, "20010", 2025)
    assert audit["collected_at"] == record["fetched_at"]
    assert audit["catalogues"] == []
    assert "catalogue_hash_changed" in audit["audit_errors"]


def test_existing_successful_manifest_without_catalogues_list_remains_readable(
    tmp_path,
):
    record = retained_source(tmp_path, body=b"%PDF legacy fixture", legacy=True)
    report = SimpleNamespace(
        period_start=date(2025, 1, 1), period_end=date(2025, 12, 31)
    )
    with (
        patch(
            "alethical.pipeline.lobbyist_evidence_run.parse_lobbyist_report_evidence",
            return_value=report,
        ),
        patch(
            "alethical.pipeline.lobbyist_evidence_run.compare_donors",
            return_value={"state": "checked", "donors": {}},
        ),
    ):
        result = read_recipient(tmp_path, "20010", 2025, [])
    assert result["collected_at"] == record["fetched_at"]
    assert len(result["catalogues"]) == 1
    assert len(source_audit(tmp_path, "20010", 2025)["catalogues"]) == 1


def response(body, payload=None):
    result = MagicMock()
    result.content = body
    result.json.return_value = payload
    return result


def test_collection_retains_new_selection_even_when_pdf_not_served(tmp_path):
    payload = catalogue_payload()
    http = MagicMock()
    http.post.side_effect = [
        response(json.dumps(payload).encode(), payload),
        response(b"report not released"),
    ]
    context = MagicMock()
    context.__enter__.return_value = http
    with (
        patch(
            "alethical.pipeline.lobbyist_report_collection.http_session",
            return_value=context,
        ),
        patch("alethical.pipeline.lobbyist_report_collection.time.sleep"),
    ):
        assert collect_one(tmp_path, "20010", 2025, Kind.party_unit) == "unavailable"
    record = json.loads((tmp_path / "20010-2025.json").read_text())
    assert record["documents"] == []
    assert (
        record["catalogues"][0]["selected_reports"][0]["effective_amendment_index"] == 2
    )
    assert record["attempts"][0]["error"] == "document_not_served"
    assert len(superseded_comparisons(tmp_path, [("20010", 2025)], comparison())) == 1


def test_collection_default_refreshes_and_explicit_reuse_preserves_timestamp(tmp_path):
    retained_source(tmp_path, amendment=1)
    payload = catalogue_payload()
    http = MagicMock()
    http.post.side_effect = [
        response(json.dumps(payload).encode(), payload),
        response(b"%PDF new source"),
    ]
    context = MagicMock()
    context.__enter__.return_value = http
    with (
        patch(
            "alethical.pipeline.lobbyist_report_collection.http_session",
            return_value=context,
        ),
        patch("alethical.pipeline.lobbyist_report_collection.time.sleep"),
    ):
        assert collect_one(tmp_path, "20010", 2025, Kind.party_unit) == "collected"
        assert http.post.call_count == 2
        saved = (tmp_path / "20010-2025.json").read_bytes()
        assert (
            collect_one(tmp_path, "20010", 2025, Kind.party_unit, reuse_retained=True)
            == "retained"
        )
        assert (tmp_path / "20010-2025.json").read_bytes() == saved
        assert http.post.call_count == 2
    # Refresh does not overwrite the old catalogue's content-addressed bytes.
    assert len(list(tmp_path.glob("*-catalogue.json"))) == 2


def test_runtime_data_excludes_large_catalogue_bodies_but_keeps_proof():
    run = {
        "version": 1,
        "withheld_recipients": [],
        "recipients": [
            {
                "registration_number": "1",
                "year": 2025,
                "documents": [{"document_hash": "a" * 64}],
                "catalogues": ["large payload"],
                "donors": {"2": {"status": "agrees", "row_numbers": [3]}},
            }
        ],
    }
    runtime = runtime_evidence(run)
    assert "catalogues" not in runtime["recipients"][0]
    assert runtime["recipients"][0]["donors"] == run["recipients"][0]["donors"]


def test_collection_keeps_served_pdf_when_another_selected_pdf_fails(tmp_path):
    payload = catalogue_payload()
    special = catalogue_payload(special=True)["data"]["pdfs"]["first"]
    special["CutOffDate"] = "2025-05-14 00:00:00"
    payload["data"]["pdfs"]["second"] = special
    http = MagicMock()
    http.post.side_effect = [
        response(json.dumps(payload).encode(), payload),
        response(b"not served"),
        response(b"%PDF special served"),
    ]
    context = MagicMock()
    context.__enter__.return_value = http
    with (
        patch(
            "alethical.pipeline.lobbyist_report_collection.http_session",
            return_value=context,
        ),
        patch("alethical.pipeline.lobbyist_report_collection.time.sleep"),
    ):
        assert collect_one(tmp_path, "20010", 2025, Kind.party_unit) == "unavailable"
    record = json.loads((tmp_path / "20010-2025.json").read_text())
    assert len(record["catalogues"][0]["selected_reports"]) == 2
    assert len(record["documents"]) == 1
    assert record["documents"][0]["report"]["special_election"] is True
    failure = build_run(tmp_path, [], [("20010", 2025)])["failures"][0]
    assert len(failure["catalogues"]) == 1
    assert len(failure["documents"]) == 1
    assert failure["collected_at"] == record["fetched_at"]


def test_missing_manifest_exposes_failure_without_invented_collection_time(tmp_path):
    failure = build_run(tmp_path, [], [("20010", 2025)])["failures"][0]
    assert failure["collected_at"] is None
    assert failure["catalogues"] == []
    assert failure["documents"] == []
    assert failure["source_fingerprint"] == source_fingerprint([])


def retained_coverage_source(tmp_path):
    record = retained_source(tmp_path, body=b"%PDF selected unsupported fixture")
    payload = catalogue_payload()
    earlier = dict(payload["data"]["pdfs"]["first"])
    earlier.update(ReportType="B", CutOffDate="2025-06-30 00:00:00", amendments=["0"])
    payload["data"]["pdfs"]["earlier"] = earlier
    body = json.dumps(payload).encode()
    digest = hashlib.sha256(body).hexdigest()
    name = f"{digest}-catalogue.json"
    (tmp_path / name).write_bytes(body)
    for ref in [*record["catalogues"], *record["documents"]]:
        ref.update(catalogue_hash=digest, catalogue_path=name)
    (tmp_path / "20010-2025.json").write_text(json.dumps(record, default=str))
    pdf = b"%PDF earlier unsupported fixture"
    pdf_hash = hashlib.sha256(pdf).hexdigest()
    (tmp_path / f"{pdf_hash}.pdf").write_bytes(pdf)
    coverage = {
        "registration_number": "20010",
        "year": 2025,
        "catalogue_hash": digest,
        "documents": [
            {
                "document_hash": pdf_hash,
                "report_type": "B",
                "amendment_index": 0,
                "special_election": False,
                "cut_off_date": "2025-06-30",
            }
        ],
    }
    (tmp_path / "20010-2025-coverage.json").write_text(json.dumps(coverage))
    return record, coverage


def test_failure_audit_keeps_earlier_pdf_and_raw_coverage_manifest(tmp_path):
    record, coverage = retained_coverage_source(tmp_path)
    failure = build_run(tmp_path, [], [("20010", 2025)])["failures"][0]
    assert failure["coverage_manifest"] == coverage
    assert (
        failure["coverage_manifest_hash"]
        == hashlib.sha256(
            (tmp_path / "20010-2025-coverage.json").read_bytes()
        ).hexdigest()
    )
    assert failure["collected_at"] == record["fetched_at"]
    assert len(failure["documents"]) == 2
    assert failure["documents"][-1] == {
        "document_hash": coverage["documents"][0]["document_hash"],
        "registration_number": "20010",
        "filing_year": 2025,
        "report_type": "B",
        "amendment_index": 0,
        "special_election": False,
        "purpose": "period_only",
    }
    assert failure["audit_errors"] == []


@pytest.mark.parametrize(
    ("field", "value", "error"),
    [
        ("registration_number", "20011", "coverage_manifest_identity_mismatch"),
        ("year", 2024, "coverage_manifest_identity_mismatch"),
        ("catalogue_hash", "f" * 64, "coverage_catalogue_not_verified"),
    ],
)
def test_unlinked_coverage_claim_is_retained_but_its_pdf_is_not_accepted(
    tmp_path, field, value, error
):
    _, coverage = retained_coverage_source(tmp_path)
    coverage[field] = value
    (tmp_path / "20010-2025-coverage.json").write_text(json.dumps(coverage))
    audit = source_audit(tmp_path, "20010", 2025)
    assert audit["coverage_manifest"] == coverage
    assert len(audit["documents"]) == 1
    assert error in audit["audit_errors"]


def test_changed_coverage_pdf_is_not_added_to_durable_references(tmp_path):
    _, coverage = retained_coverage_source(tmp_path)
    (tmp_path / f"{coverage['documents'][0]['document_hash']}.pdf").write_bytes(
        b"%PDF altered"
    )
    audit = source_audit(tmp_path, "20010", 2025)
    assert audit["coverage_manifest"] == coverage
    assert len(audit["documents"]) == 1
    assert "coverage_document_hash_changed" in audit["audit_errors"]


def test_coverage_pdf_metadata_must_match_verified_catalogue_entry(tmp_path):
    _, coverage = retained_coverage_source(tmp_path)
    coverage["documents"][0]["amendment_index"] = 99
    (tmp_path / "20010-2025-coverage.json").write_text(json.dumps(coverage))
    audit = source_audit(tmp_path, "20010", 2025)
    assert len(audit["documents"]) == 1
    assert "coverage_document_not_in_verified_catalogue" in audit["audit_errors"]


@pytest.mark.parametrize("late_start", [False, True])
def test_collector_fetches_earlier_covers_only_for_incomplete_selected_periods(
    tmp_path, late_start
):
    payload = catalogue_payload()
    earlier = dict(payload["data"]["pdfs"]["first"])
    earlier.update(ReportType="B", CutOffDate="2025-09-30 00:00:00", amendments=["0"])
    payload["data"]["pdfs"]["earlier"] = earlier
    catalogue_bytes = json.dumps(payload).encode()
    http = MagicMock()
    http.post.side_effect = [
        response(catalogue_bytes, payload),
        response(b"%PDF selected cover"),
        response(b"%PDF earlier cover"),
    ]
    context = MagicMock()
    context.__enter__.return_value = http
    start = date(2025, 8, 1) if late_start else date(2025, 1, 1)
    with (
        patch(
            "alethical.pipeline.lobbyist_report_collection.http_session",
            return_value=context,
        ),
        patch("alethical.pipeline.lobbyist_report_collection.time.sleep"),
        patch(
            "alethical.pipeline.lobbyist_report_collection._read_header",
            side_effect=[(start, date(2025, 12, 31)), (start, date(2025, 9, 30))],
        ),
    ):
        assert collect_one(tmp_path, "20010", 2025, Kind.party_unit) == "collected"
    record = json.loads((tmp_path / "20010-2025.json").read_text())
    assert len(record["documents"]) == 1
    assert record["attempts"] == []
    assert http.post.call_count == (3 if late_start else 2)
    coverage_path = tmp_path / "20010-2025-coverage.json"
    if not late_start:
        assert not coverage_path.exists()
        return
    coverage = json.loads(coverage_path.read_text())
    assert coverage == {
        "registration_number": "20010",
        "year": 2025,
        "catalogue_hash": hashlib.sha256(catalogue_bytes).hexdigest(),
        "documents": [
            {
                "document_hash": hashlib.sha256(b"%PDF earlier cover").hexdigest(),
                "report_type": "B",
                "amendment_index": 0,
                "special_election": False,
                "cut_off_date": "2025-09-30",
            }
        ],
    }
    assert (
        tmp_path / f"{coverage['documents'][0]['document_hash']}.pdf"
    ).read_bytes() == b"%PDF earlier cover"


def test_coverage_fetch_failure_keeps_selected_report_and_partial_manifest(tmp_path):
    payload = catalogue_payload()
    earlier = dict(payload["data"]["pdfs"]["first"])
    earlier.update(ReportType="B", CutOffDate="2025-09-30 00:00:00", amendments=["0"])
    payload["data"]["pdfs"]["earlier"] = earlier
    http = MagicMock()
    http.post.side_effect = [
        response(json.dumps(payload).encode(), payload),
        response(b"%PDF selected cover"),
        response(b"not released"),
    ]
    context = MagicMock()
    context.__enter__.return_value = http
    with (
        patch(
            "alethical.pipeline.lobbyist_report_collection.http_session",
            return_value=context,
        ),
        patch("alethical.pipeline.lobbyist_report_collection.time.sleep"),
        patch(
            "alethical.pipeline.lobbyist_report_collection._read_header",
            return_value=(date(2025, 8, 1), date(2025, 12, 31)),
        ),
    ):
        assert collect_one(tmp_path, "20010", 2025, Kind.party_unit) == "collected"
    record = json.loads((tmp_path / "20010-2025.json").read_text())
    assert len(record["documents"]) == 1
    assert record["attempts"][0]["error"] == "coverage_document_not_served"
    assert record["attempts"][0]["purpose"] == "period_only"
    coverage = json.loads((tmp_path / "20010-2025-coverage.json").read_text())
    assert coverage["documents"] == []
    assert coverage["catalogue_hash"] == record["catalogues"][0]["catalogue_hash"]
