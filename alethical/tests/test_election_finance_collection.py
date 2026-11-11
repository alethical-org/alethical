"""Source arithmetic, exact evidence retention and transactional publication checks."""

from copy import deepcopy
from datetime import UTC, date, datetime, timedelta
import io

from pypdf import PdfReader, PdfWriter
import pytest
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from alethical.db import models as m
from alethical.db.session import get_engine
from alethical.pipeline import election_finance_collection as s
from alethical.pipeline import campaign_finance_filings as f
from alethical.pipeline import campaign_finance_report_documents as d
from alethical.tests.test_campaign_finance_stated_split import pdf_of
from alethical.tests.test_election_comparison_storage import MemoryStore

COVER = [
    "Period Covered: 01/01/2026 through 10/19/2026",
    "Registration Number: 19399",
    "Committee Name: Synthetic Committee",
    "Candidate Name: Example, Candidate",
    "Office and District: House District 10A",
    "Received by the Board October 26, 2026",
]
SUMMARY = [
    "Committee Transaction Summary",
    "Cash Unpaid Bills In-kind Total",
    "2 Individual Contributions Sch. A1 - IND 100.00 20.00 120.00",
    "3 Lobbyist Contributions Sch. A1 - LOB 10.00 0.00 10.00",
    "4 Political committee contributions Sch. A1 - PCF 30.00 5.00 35.00",
    "5 Party and terminating PCC contributions Sch. A1 - PTY 40.00 15.00 55.00",
    "6 Other contributions Sch. A1 - OTH 5.00 0.00 5.00",
    "7 Public Subsidy 300.00 300.00",
    "8 Loans 400.00 400.00",
    "9 Miscellaneous 12.00 12.00",
    "10 Total Receipts 897.00 40.00 937.00",
    "11 Campaign expenditures Sch. B1 - CE 80.00 7.00 40.00 127.00",
    "12 Ballot Question 0.00 0.00 0.00 0.00",
    "19 Total Expenditures and Disbursements 130.00 7.00 40.00 177.00",
    "20 Ending cash 767.00",
    "Loans and Unpaid Obligations Summary",
]


def pdf(cover=COVER, summary=SUMMARY, *, intervening=False):
    writer = PdfWriter()
    pages = [cover, *([["Unrelated page"]] if intervening else []), summary]
    for lines in pages:
        writer.add_page(PdfReader(io.BytesIO(pdf_of(lines))).pages[0])
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


def filing():
    return f.CatalogueReport(
        registration_number="19399",
        filing_year=2026,
        report_type="E",
        report_name="2026 Pre-General Report",
        cut_off_date=date(2026, 10, 19),
        special_election=False,
        effective_amendment_index=0,
        amendment_count=1,
        termination_date=None,
    )


def extracted(body):
    return s.json_value(
        s.extract_report_evidence(
            body, "19399", filing(), d.ReportDocument(), f.FinancialTab()
        )
    )


def test_report_summary_keeps_contributions_separate_from_other_receipts():
    result = extracted(pdf())
    assert result["status"] == "parsed_with_arithmetic_checks"
    assert result["figures"]["contributions_received"] == {
        "cash": "185.00",
        "in_kind": "40.00",
        "total": "225.00",
        "source_page": 2,
        "source_lines": [2, 3, 4, 5, 6],
    }
    assert result["figures"]["campaign_expenditures"]["unpaid"] == "7.00"
    assert result["figures"]["campaign_expenditures"]["total"] == "127.00"
    assert result["figures"]["total_expenditures"]["total"] == "177.00"
    assert result["cover"]["period_end"] == "2026-10-19"
    assert result["identity_confirmation"] is False
    assert result["complete_election_spending"] is False


@pytest.mark.parametrize(
    "body",
    [
        pdf(summary=[line.replace("127.00", "127.01") for line in SUMMARY]),
        pdf(summary=[line for line in SUMMARY if not line.startswith("11 ")]),
        pdf(cover=[line.replace("19399", "19430") for line in COVER]),
        pdf(cover=[line.replace("10/19/2026", "07/20/2026") for line in COVER]),
        pdf(intervening=True),
        b"%PDF-1.4\nnot a usable document",
    ],
)
def test_unreadable_mismatched_or_wrong_page_reports_remain_unverified(body):
    result = extracted(body)
    assert result["status"] == "requires_review"
    assert result["errors"]


@pytest.fixture
def prepared():
    body = pdf()
    h = s.file_hash(body)
    source = b'{"synthetic":"catalogue evidence for storage tests"}'
    source_hash = s.file_hash(source)
    extraction = extracted(body)
    entry = s.json_value(s.asdict(filing()))
    payload = {
        "schema_version": 1,
        "registration_number": "19399",
        "filing": entry,
        "catalogue_source": {"sha256": source_hash},
        "currency": "USD",
        "figures": extraction["figures"],
        "figure_status": "source_verified",
        "unavailable_reason": None,
        "identity_confirmation": False,
        "complete_election_spending": False,
        "document": {"sha256": h},
        "extraction": extraction,
        "period_start": "2026-01-01",
        "period_end": "2026-10-19",
        "period_basis": "calendar_year_to_date",
    }
    report = {
        "registration_number": "19399",
        "report_key": s.digest(["19399", 2026, "E", 0, False, h]),
        "document_hash": h,
        "payload": payload,
    }
    result = {
        "format": 1,
        "election_key": "mn-2026-11-03-general",
        "copied_at": "2026-11-11T15:00:00+00:00",
        "sources": [{"sha256": source_hash, "url": "https://cfb.mn.gov/reports/api/"}],
        "reports": [report],
        "coverage": {
            "named_candidacies": 1,
            "authority_counts": {"board": 1},
            "candidates": [
                {
                    "stable_id": "synthetic-candidate",
                    "authority": "board",
                    "link_state": "not_confirmed_by_collection",
                    "gap": "Candidate confirmation is separate",
                }
            ],
            "candidate_attribution": False,
            "complete_election_spending": False,
            "reports": 1,
            "reports_with_figures": 1,
            "report_status_counts": {"source_verified": 1},
        },
    }
    result["id"] = s.collection_digest(result)
    return result, {source_hash: source}, {h: body}


@pytest.fixture
def db(seed_database):
    with get_engine().connect() as connection:
        transaction = connection.begin()
        with Session(
            bind=connection, join_transaction_mode="create_savepoint"
        ) as session:
            yield session
        transaction.rollback()


def retain(db, prepared):
    store = MemoryStore()
    s.retain_collection_sources(db, store, *prepared)
    return store


def test_no_source_or_pdf_means_no_staged_figures(db, prepared):
    with pytest.raises(s.FinanceCollectionError, match="Retain"):
        s.stage_collection(db, prepared[0])
    assert db.get(m.ElectionFinanceCollection, prepared[0]["id"]) is None
    for body in prepared[1].values():
        s.archive_source(db, MemoryStore(), body)
    with pytest.raises(s.FinanceCollectionError, match="different report"):
        s.stage_collection(db, prepared[0])


def test_retention_hash_failure_writes_no_evidence(db, prepared):
    collection, originals, documents = prepared
    documents[next(iter(documents))] += b"changed"
    with pytest.raises(s.FinanceCollectionError, match="fingerprint"):
        s.retain_collection_sources(db, MemoryStore(), collection, originals, documents)
    assert db.get(m.ElectionFinanceCollection, collection["id"]) is None


def test_atomic_stage_repeat_publication_cas_and_explicit_restore(db, prepared):
    retain(db, prepared)
    first = s.stage_collection(db, prepared[0])
    assert s.stage_collection(db, deepcopy(prepared[0])) == first
    assert db.get(m.ElectionFinanceCurrent, prepared[0]["election_key"]) is None
    db.commit()
    assert s.publish_collection(db, first, expected_previous=None)["previous"] is None
    db.commit()
    later = deepcopy(prepared[0])
    later["coverage"]["observation_note"] = "Synthetic new observation"
    later["copied_at"] = (
        datetime.fromisoformat(later["copied_at"]) + timedelta(days=1)
    ).isoformat()
    later["id"] = s.collection_digest(later)
    second = s.stage_collection(db, later)
    with pytest.raises(s.FinanceCollectionError, match="changed"):
        s.publish_collection(db, second, expected_previous=None)
    s.publish_collection(db, second, expected_previous=first)
    db.commit()
    with pytest.raises(s.FinanceCollectionError, match="explicit restore"):
        s.publish_collection(db, first, expected_previous=second)
    s.publish_collection(db, first, expected_previous=second, restore=True)
    db.commit()
    assert (
        db.get(
            m.ElectionFinanceCurrent, later["election_key"], populate_existing=True
        ).collection_id
        == first
    )


def test_staged_amount_mutation_cannot_be_published(db, prepared):
    retain(db, prepared)
    identifier = s.stage_collection(db, prepared[0])
    db.commit()
    row = db.scalars(
        select(m.ElectionFinanceReport).where(
            m.ElectionFinanceReport.collection_id == identifier
        )
    ).one()
    payload = deepcopy(row.payload)
    payload["figures"]["campaign_expenditures"]["cash"] = "99.00"
    row.payload = payload
    db.flush()
    with pytest.raises(s.FinanceCollectionError, match="fingerprint"):
        s.publish_collection(db, identifier, expected_previous=None)
    assert db.get(m.ElectionFinanceCurrent, prepared[0]["election_key"]) is None


def test_removed_report_prevents_publication(db, prepared):
    retain(db, prepared)
    identifier = s.stage_collection(db, prepared[0])
    db.execute(
        delete(m.ElectionFinanceReport).where(
            m.ElectionFinanceReport.collection_id == identifier
        )
    )
    with pytest.raises(s.FinanceCollectionError):
        s.publish_collection(db, identifier, expected_previous=None)


@pytest.mark.parametrize(
    "change", ["unknown_period", "bad_parse", "missing_pdf", "identity_confirmation"]
)
def test_recomputed_fingerprint_does_not_override_semantic_checks(prepared, change):
    collection = prepared[0]
    row = collection["reports"][0]
    if change == "unknown_period":
        row["payload"]["period_start"] = None
    elif change == "bad_parse":
        row["payload"]["extraction"]["errors"] = ["unreadable"]
    elif change == "missing_pdf":
        row["document_hash"] = None
    else:
        row["payload"]["identity_confirmation"] = True
    collection["id"] = s.collection_digest(collection)
    with pytest.raises(s.FinanceCollectionError):
        s.validate_collection(collection)


@pytest.fixture
def recovery_bundle(tmp_path):
    """Synthetic source bytes through the real existing catalogue/PDF parsers."""
    import json
    from alethical.tests.test_campaign_finance_filings import FakeBoard

    directory = tmp_path / "recovery"
    roster_dir = tmp_path / "roster"
    directory.mkdir()
    roster_dir.mkdir()
    now = datetime(2026, 11, 11, 15, tzinfo=UTC)
    catalogue = {
        "data": {
            "pdfs": {
                "E": {
                    "RegisteredEntityID": "19399",
                    "ReportType": "E",
                    "FilingYear": "2026",
                    "ReportName": "2026 Pre-General Report",
                    "CutOffDate": "2026-10-19 00:00:00",
                    "SpecialElectionindicator": "0",
                    "amendments": ["0"],
                }
            }
        }
    }
    archive = f.ResponseArchive(str(directory / "responses.jsonl.gz"))
    catalog_body = json.dumps(catalogue).encode()
    cat_form = f.viewer_form("19399", (2026, 2027), "reports_data")
    cat_response = f.Response(
        "https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/candidates/api",
        cat_form,
        200,
        catalog_body,
        s.file_hash(catalog_body),
        now,
        now,
    )
    cat_line = archive.write("catalogue", cat_response, registration_number="19399")
    body = pdf()
    form = d.document_form(
        registration_number="19399",
        filing_year=2026,
        kind=f.FilerKind.candidate_committee,
        report_type="E",
        amendment_index=0,
        special_election=False,
    )
    doc_response = f.Response(
        d.document_url(), form, 200, body, s.file_hash(body), now, now
    )
    doc_line = archive.write(
        "report_document", doc_response, registration_number="19399"
    )
    archive_hash, size, count = archive.close()
    filename = "19399-2026-E-0.pdf"
    (directory / filename).write_bytes(body)
    item = {
        "registration_number": "19399",
        "catalogue_source": {
            "sha256": cat_response.content_hash,
            "archive_line": cat_line,
        },
        "document": {
            "sha256": doc_response.content_hash,
            "outcome": "served",
            "origin": "official_live",
            "archive_line": doc_line,
            "local_file": filename,
        },
        "extraction": {"figures": {"contributions_received": {"total": "99999999.00"}}},
    }
    (directory / "recovered-evidence.json").write_text(json.dumps([item]))
    manifest = {
        "election_key": "mn-2026-11-03-general",
        "completed_at": now.isoformat(),
        "registration_numbers": ["19399"],
        "archive": {
            "compressed_sha256": archive_hash,
            "compressed_bytes": size,
            "response_count": count,
        },
    }
    (directory / "recovery-manifest.json").write_text(json.dumps(manifest))
    roster_body = (
        b"02530301;Candidate Example;0253;State Representative District 10A;88;03;R\n"
    )
    (roster_dir / "cand.txt").write_bytes(roster_body)
    (roster_dir / "source-manifest.json").write_text(
        json.dumps(
            [
                {
                    "file": "cand.txt",
                    "url": "https://electionresultsfiles.sos.mn.gov/20261103/cand.txt",
                    "sha256": s.file_hash(roster_body),
                    "fetched_at": now.isoformat(),
                }
            ]
        )
    )
    register_body = json.dumps(
        FakeBoard().directory_payload(f.FilerKind.candidate_committee)
    ).encode()
    register_file = tmp_path / "directory.json"
    register_file.write_bytes(register_body)
    metadata_file = tmp_path / "directory-meta.json"
    metadata_file.write_text(
        json.dumps(
            {
                "source_hash": s.file_hash(register_body),
                "url": "https://cfb.mn.gov/reports/api/",
                "form": f.directory_form(f.FilerKind.candidate_committee),
                "copied_at": now.isoformat(),
            }
        )
    )
    return directory, {
        "roster_directory": roster_dir,
        "directory_file": register_file,
        "directory_metadata": metadata_file,
    }


def test_prepare_reparses_sources_and_ignores_recovery_money(recovery_bundle):
    directory, kwargs = recovery_bundle
    collection, originals, documents = s.prepare_collection(directory, **kwargs)
    assert collection["coverage"]["authority_counts"] == {"board": 1}
    report = collection["reports"][0]
    assert report["payload"]["figures"]["contributions_received"]["total"] == "225.00"
    assert report["payload"]["identity_confirmation"] is False
    assert report["document_hash"] in documents
    assert {r["sha256"] for r in collection["sources"]} == set(originals)


def test_prepare_rejects_replaced_pdf(recovery_bundle):
    directory, kwargs = recovery_bundle
    (directory / "19399-2026-E-0.pdf").write_bytes(pdf(summary=SUMMARY + ["changed"]))
    with pytest.raises(s.FinanceCollectionError, match="fingerprint"):
        s.prepare_collection(directory, **kwargs)


def test_non_january_report_start_is_preserved(prepared):
    collection = prepared[0]
    payload = collection["reports"][0]["payload"]
    payload["period_start"] = "2026-02-12"
    payload["period_basis"] = "reported_period"
    payload["extraction"]["cover"]["period_start"] = "2026-02-12"
    collection["id"] = s.collection_digest(collection)
    s.validate_collection(collection)


def test_same_cutoff_different_report_types_do_not_select_by_amendment(
    recovery_bundle, monkeypatch
):
    from dataclasses import replace

    original = f.parse_catalogue_payload

    def catalogue_with_distinct_series(*args, **kwargs):
        reports, errors = original(*args, **kwargs)
        # Amendments belong to their own report series. Neither a tie nor a
        # larger amendment number makes a different report type authoritative.
        reports.append(
            replace(reports[0], report_type="H", effective_amendment_index=3)
        )
        return reports, errors

    monkeypatch.setattr(f, "parse_catalogue_payload", catalogue_with_distinct_series)
    directory, kwargs = recovery_bundle
    collection, _, documents = s.prepare_collection(directory, **kwargs)
    assert len(collection["reports"]) == 2
    assert not documents
    for report in collection["reports"]:
        assert report["payload"]["figures"] is None
        assert report["payload"]["unavailable_reason"] == "ambiguous_latest_report"


def test_local_candidates_extend_coverage_without_acquiring_board_accounts(
    recovery_bundle,
):
    import json

    directory, kwargs = recovery_bundle
    roster_dir = kwargs["roster_directory"]
    source_path = roster_dir / "source-manifest.json"
    manifest = json.loads(source_path.read_text())
    body = b"1234501029001;Local Candidate;0102;Mayor (Courtland);01;12345;\n"
    (roster_dir / "LocalCandTbl.txt").write_bytes(body)
    manifest.append(
        {
            "url": "https://electionresultsfiles.sos.mn.gov/20261103/LocalCandTbl.txt",
            "sha256": s.file_hash(body),
            "fetched_at": manifest[0]["fetched_at"],
        }
    )
    source_path.write_text(json.dumps(manifest))
    collection, originals, _ = s.prepare_collection(directory, **kwargs)
    assert collection["coverage"]["named_candidacies"] == 2
    assert collection["coverage"]["authority_counts"] == {"board": 1, "county_local": 1}
    local = next(
        c
        for c in collection["coverage"]["candidates"]
        if c["name"] == "Local Candidate"
    )
    assert local["stable_id"].startswith("local_cand:")
    assert local["municipal_fips_code"] == "12345"
    assert local["party"] is None
    assert local["link_state"] == "not_confirmed_by_collection"
    assert originals[s.file_hash(body)] == body


def identity_manifest(directory, *, response_registration="19399"):
    import json

    body = json.dumps(
        {
            "data": [
                {
                    "RegisteredEntityID": response_registration,
                    "CandidateFullName": "Example, Candidate",
                    "LTGCFormattedName": "Example Partner",
                }
            ]
        }
    ).encode()
    (directory / "identity.json").write_bytes(body)
    entry = {
        "registration_number": "19399",
        "url": f.viewer_url(f.FilerKind.candidate_committee),
        "request_method": "POST",
        "request_form": f.viewer_form("19399", (2025, 2026), "information"),
        "sha256": s.file_hash(body),
        "local_file": "identity.json",
        "copied_at": "2026-11-11T17:00:00+00:00",
    }
    path = directory / "identity-manifest.json"
    path.write_text(json.dumps([entry]))
    return path, entry, body


def test_identity_response_is_retained_without_confirming_candidate(
    recovery_bundle, db
):
    directory, kwargs = recovery_bundle
    path, entry, body = identity_manifest(directory)
    collection, originals, documents = s.prepare_collection(
        directory, identity_manifest=path, **kwargs
    )
    source = next(x for x in collection["sources"] if x["kind"] == "candidate_identity")
    assert source["registration_number"] == "19399"
    assert source["sha256"] == entry["sha256"]
    assert originals[entry["sha256"]] == body
    assert collection["copied_at"] == entry["copied_at"]
    assert collection["coverage"]["candidate_attribution"] is False
    store = MemoryStore()
    s.retain_collection_sources(db, store, collection, originals, documents)
    retained = db.get(m.ElectionResultSource, entry["sha256"])
    assert retained is not None
    assert retained.byte_size == len(body)


def test_identity_response_wrong_committee_is_rejected(recovery_bundle):
    directory, kwargs = recovery_bundle
    path, _, _ = identity_manifest(directory, response_registration="19999")
    with pytest.raises(s.FinanceCollectionError, match="registration differs"):
        s.prepare_collection(directory, identity_manifest=path, **kwargs)


def test_identity_response_changed_bytes_is_rejected(recovery_bundle):
    directory, kwargs = recovery_bundle
    path, _, body = identity_manifest(directory)
    (directory / "identity.json").write_bytes(body + b" ")
    with pytest.raises(s.FinanceCollectionError, match="fingerprint"):
        s.prepare_collection(directory, identity_manifest=path, **kwargs)


def test_registered_site_requires_exact_link_and_committee_in_retained_parent(
    recovery_bundle,
):
    import json

    directory, kwargs = recovery_bundle
    path, parent, _ = identity_manifest(directory)
    parent_body = json.dumps(
        {"tabcontent": '<a href="https://example.org/campaign">Campaign website</a>'}
    ).encode()
    (directory / "identity.json").write_bytes(parent_body)
    parent["sha256"] = s.file_hash(parent_body)
    parent["request_form"]["tabname"] = "officers"
    site_body = b"<h1>Candidate Example for House 10A</h1>"
    (directory / "site.html").write_bytes(site_body)
    site = {
        "kind": "candidate_identity",
        "subtype": "registered_site",
        "registration_number": "19399",
        "parent_sha256": parent["sha256"],
        "parent_locator": "/tabcontent",
        "requested_url": "https://example.org/campaign",
        "url": "https://example.org/campaign/",
        "request_method": "GET",
        "copied_at": parent["copied_at"],
        "sha256": s.file_hash(site_body),
        "local_file": "site.html",
    }
    path.write_text(json.dumps([site, parent]))
    collection, originals, _ = s.prepare_collection(
        directory, identity_manifest=path, **kwargs
    )
    assert originals[site["sha256"]] == site_body
    assert any(x.get("subtype") == "registered_site" for x in collection["sources"])
    site["requested_url"] = "https://different.example/campaign"
    path.write_text(json.dumps([parent, site]))
    with pytest.raises(s.FinanceCollectionError, match="URL is not"):
        s.prepare_collection(directory, identity_manifest=path, **kwargs)
    site["requested_url"] = "https://example.org/campaign"
    site["registration_number"] = "19999"
    path.write_text(json.dumps([parent, site]))
    with pytest.raises(s.FinanceCollectionError, match="retained Board parent"):
        s.prepare_collection(directory, identity_manifest=path, **kwargs)
