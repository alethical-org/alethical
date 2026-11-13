"""Source arithmetic, exact evidence retention and transactional publication checks."""

from copy import deepcopy
from datetime import UTC, date, datetime, timedelta
import io
import json
from decimal import Decimal

from pypdf import PdfReader, PdfWriter
import pytest
from sqlalchemy import delete, select
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError

from alethical.db import models as m
from alethical.db.session import get_engine
from alethical.pipeline import election_finance_collection as s
from alethical.pipeline import campaign_finance_filings as f
from alethical.pipeline import campaign_finance_report_documents as d
from alethical.tests.test_campaign_finance_stated_split import pdf_of
from alethical.tests.test_election_comparison_storage import MemoryStore
from alethical.tests.test_election_comparison_storage import (  # noqa: F401
    prepared as comparison_prepared,
    source_set,
)

prepared_results = comparison_prepared

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


@pytest.mark.parametrize("amount", ["300.00", "0.00"])
def test_public_subsidy_is_separate_checked_receipt(amount):
    summary = [line.replace("300.00", amount) for line in SUMMARY]
    result = s.json_value(
        s.extract_report_evidence(
            pdf(summary=summary),
            "19399",
            filing(),
            d.ReportDocument(),
            f.FinancialTab(),
            include_public_subsidy=True,
        )
    )
    assert result["figures"]["public_subsidy_payments"] == {
        "cash": amount,
        "total": amount,
        "source_page": 2,
        "source_lines": [7],
    }
    assert result["figures"]["contributions_received"]["total"] == "225.00"
    assert result["figures"]["campaign_expenditures"]["total"] == "127.00"
    assert result["public_subsidy_gap"] is None


@pytest.mark.parametrize(
    "replacement",
    [
        "7 Public Subsidy",
        "7 Public Subsidy 300.00 301.00",
        "7 Other income 300.00 300.00",
        "7 Public Subsidy 300.00 300.00\n7 Public Subsidy 300.00 300.00",
    ],
)
def test_unreadable_subsidy_does_not_hide_checked_campaign_spending(replacement):
    summary = [replacement if line.startswith("7 ") else line for line in SUMMARY]
    result = s.extract_report_evidence(
        pdf(summary=summary),
        "19399",
        filing(),
        d.ReportDocument(),
        f.FinancialTab(),
        include_public_subsidy=True,
    )
    assert result["status"] == "parsed_with_arithmetic_checks"
    assert "public_subsidy_payments" not in result["figures"]
    assert result["public_subsidy_gap"]
    assert result["figures"]["campaign_expenditures"]["total"] == "127.00"


@pytest.mark.parametrize("same_period", [False, True])
def test_subsidy_overview_comparison_requires_matching_period(same_period):
    financial = f.FinancialTab(
        years={
            2026: f.YearFigures(
                year=2026,
                heading="2026",
                reported_through=date(2026, 10, 19)
                if same_period
                else date(2026, 3, 31),
                amounts={"public_subsidy_payments": Decimal("0.00")},
            )
        }
    )
    result = s.extract_report_evidence(
        pdf(),
        "19399",
        filing(),
        d.ReportDocument(),
        financial,
        include_public_subsidy=True,
    )
    assert ("public_subsidy_payments" in result["figures"]) is not same_period
    assert bool(result["public_subsidy_gap"]) is same_period
    assert result["status"] == "parsed_with_arithmetic_checks"


@pytest.mark.parametrize("same_period", [False, True])
def test_official_overview_conflict_is_kept_only_for_matching_period(same_period):
    financial = f.FinancialTab(
        years={
            2026: f.YearFigures(
                year=2026,
                heading="2026",
                reported_through=date(2026, 10, 19)
                if same_period
                else date(2026, 7, 20),
                amounts={"campaign_expenditures": Decimal("79.00")},
            )
        }
    )
    result = s.extract_report_evidence(
        pdf(), "19399", filing(), d.ReportDocument(), financial
    )
    assert result["figures"]["campaign_expenditures"]["cash"] == "80.00"
    if same_period:
        assert result["status"] == "requires_review"
        assert result["errors"] == [
            "Official financial tab cash differs for campaign_expenditures"
        ]
        assert result["summary_cash_check"]["results"]["campaign_expenditures"] is False
    else:
        assert result["status"] == "parsed_with_arithmetic_checks"
        assert result["summary_cash_check"]["status"] == "not_same_period"


def test_same_end_different_start_preserves_checked_pdf_figures():
    financial = f.FinancialTab(
        years={
            2026: f.YearFigures(
                year=2026,
                heading="2026",
                reported_through=date(2026, 10, 19),
                amounts={
                    "campaign_expenditures": Decimal("500.00"),
                    "public_subsidy_payments": Decimal("500.00"),
                },
            )
        }
    )
    cover = [line.replace("01/01/2026", "07/01/2026") for line in COVER]
    result = s.extract_report_evidence(
        pdf(cover=cover),
        "19399",
        filing(),
        d.ReportDocument(),
        financial,
        include_public_subsidy=True,
    )
    assert result["status"] == "parsed_with_arithmetic_checks"
    assert result["summary_cash_check"]["status"] == "not_same_period"
    assert result["figures"]["public_subsidy_payments"]["total"] == "300.00"
    assert result["public_subsidy_gap"] is None


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
def db(seed_database, monkeypatch):
    store = MemoryStore()
    monkeypatch.setattr(s, "raw_file_store_from_env", lambda: store)
    with get_engine().connect() as connection:
        transaction = connection.begin()
        with Session(
            bind=connection, join_transaction_mode="create_savepoint"
        ) as session:
            session.info["board_test_store"] = store
            yield session
        transaction.rollback()


def retain(db, prepared):
    store = db.info["board_test_store"]
    s.retain_collection_sources(db, store, *prepared)
    return store


def with_candidate_records(collection):
    value = deepcopy(collection)
    value["format"] = 2
    value["candidate_records"] = {
        "schema": "mn-cfb-candidate-records:v1",
        "election_key": value["election_key"],
        "snapshot_id": "a" * 64,
        "records": [],
    }
    value["id"] = s.collection_digest(value)
    return value


def test_candidate_record_section_changes_digest_without_changing_pcc_reports(prepared):
    legacy = prepared[0]
    value = with_candidate_records(legacy)
    s.validate_collection(value)
    assert value["id"] != legacy["id"]
    assert value["reports"] == legacy["reports"]
    assert value["coverage"] == legacy["coverage"]
    changed = deepcopy(value)
    changed["candidate_records"]["snapshot_id"] = "b" * 64
    assert s.collection_digest(changed) != value["id"]
    with pytest.raises(s.FinanceCollectionError, match="fingerprint"):
        s.validate_collection(changed)


@pytest.mark.parametrize("version", [True, 1.0, "1", False, 0, 3])
def test_collection_format_requires_supported_exact_integer(prepared, version):
    value = deepcopy(prepared[0])
    value["format"] = version
    value["id"] = s.collection_digest(value)
    with pytest.raises(s.FinanceCollectionError):
        s.validate_collection(value)


@pytest.mark.parametrize("section", [None, {}, {"records": []}])
def test_legacy_format_cannot_hide_candidate_record_section(prepared, section):
    value = deepcopy(prepared[0])
    value["candidate_records"] = section
    value["id"] = s.collection_digest(value)
    with pytest.raises(s.FinanceCollectionError):
        s.validate_collection(value)


@pytest.mark.parametrize("change", ["absent", "null", "wrong_election", "unknown_key"])
def test_candidate_record_section_must_be_complete_and_election_bound(prepared, change):
    value = with_candidate_records(prepared[0])
    if change == "absent":
        del value["candidate_records"]
    elif change == "null":
        value["candidate_records"] = None
    elif change == "wrong_election":
        value["candidate_records"]["election_key"] = "mn-2024-11-05-general"
    else:
        value["candidate_records"]["caller_amount"] = "999.00"
    value["id"] = s.collection_digest(value)
    with pytest.raises(s.FinanceCollectionError):
        s.validate_collection(value)


def test_candidate_record_collection_round_trip_publish_and_legacy_restore(
    db, prepared, prepared_results
):
    from alethical.pipeline import election_comparison as results

    store = retain(db, prepared)
    generation, originals = prepared_results
    for body in originals.values():
        results.archive_source(db, store, body)
    results.stage_generation(db, generation)
    legacy = s.stage_collection(db, prepared[0], store=store)
    s.publish_collection(db, legacy, expected_previous=None, store=store)
    value = with_candidate_records(prepared[0])
    value["candidate_records"]["snapshot_id"] = generation["id"]
    value["id"] = s.collection_digest(value)
    current = s.stage_collection(db, value, store=store)
    assert s._stored_collection(db, current) == value
    assert s._stored_collection(db, legacy) == prepared[0]
    assert (
        db.scalar(
            select(m.ElectionFinanceCollection.id).where(
                m.ElectionFinanceCollection.id == legacy,
                m.ElectionFinanceCollection.candidate_records.is_(None),
            )
        )
        == legacy
    )
    s.publish_collection(db, current, expected_previous=legacy, store=store)
    s.publish_collection(
        db, legacy, expected_previous=current, restore=True, store=store
    )
    s.publish_collection(
        db, current, expected_previous=legacy, restore=True, store=store
    )
    assert (
        db.get(m.ElectionFinanceCurrent, value["election_key"]).collection_id == current
    )
    assert s._stored_collection(db, current)["reports"] == prepared[0]["reports"]


def test_candidate_record_collection_requires_retained_snapshot(db, prepared):
    store = retain(db, prepared)
    value = with_candidate_records(prepared[0])
    with pytest.raises(s.FinanceCollectionError, match="unavailable or changed"):
        s.stage_collection(db, value, store=store)
    assert db.get(m.ElectionFinanceCollection, value["id"]) is None


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
    with pytest.raises(SQLAlchemyError):
        with db.begin_nested():
            row.payload = payload
            db.flush()


def test_removed_report_prevents_publication(db, prepared):
    retain(db, prepared)
    identifier = s.stage_collection(db, prepared[0])
    with pytest.raises(SQLAlchemyError):
        with db.begin_nested():
            db.execute(
                delete(m.ElectionFinanceReport).where(
                    m.ElectionFinanceReport.collection_id == identifier
                )
            )


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


@pytest.mark.parametrize("command", ["prepare", "stage"])
def test_cli_expenses_rebuild_originals_without_changing_legacy_default(
    recovery_bundle, tmp_path, capsys, command
):
    from scripts import stage_election_finance as cli

    directory, kwargs = recovery_bundle
    inputs = [command, "--directory", str(directory)]
    for key, value in kwargs.items():
        inputs.extend(["--" + key.replace("_", "-"), str(value)])
    legacy, _, _ = s.prepare_collection(directory, **kwargs)
    values = []
    for enabled in (False, True):
        output = tmp_path / f"{command}-{enabled}.json"
        args = [*inputs, "--output", str(output)]
        if enabled:
            args.append("--include-campaign-expenses")
        assert cli.main(args) == 0
        receipt = json.loads(capsys.readouterr().out)
        assert receipt["executed"] is False
        value = json.loads(output.read_text())
        assert receipt["collection_id"] == value["id"]
        payload = value["reports"][0]["payload"]
        # The recovery JSON contains forged money; the original PDF governs.
        assert payload["figures"]["contributions_received"]["total"] == "225.00"
        assert payload["identity_confirmation"] is False
        values.append(value)
    assert values[0] == legacy
    assert values[1]["id"] != legacy["id"]
    payload = values[1]["reports"][0]["payload"]
    assert payload["campaign_expenses"]["status"] == "unavailable"
    assert payload["campaign_expenses"]["rows"] == []
    assert values[1]["sources"] == legacy["sources"]
    payload_without_detail = dict(payload)
    payload_without_detail.pop("campaign_expenses")
    assert payload_without_detail == legacy["reports"][0]["payload"]


@pytest.mark.parametrize("command", ["prepare", "stage"])
def test_cli_expense_opt_in_still_refuses_changed_original(recovery_bundle, command):
    from scripts import stage_election_finance as cli

    directory, kwargs = recovery_bundle
    (directory / "19399-2026-E-0.pdf").write_bytes(pdf(summary=SUMMARY + ["changed"]))
    args = [command, "--directory", str(directory), "--include-campaign-expenses"]
    for key, value in kwargs.items():
        args.extend(["--" + key.replace("_", "-"), str(value)])
    with pytest.raises(s.FinanceCollectionError, match="fingerprint"):
        cli.main(args)


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


@pytest.fixture
def multi_period_bundle(recovery_bundle):
    """2 overlapping cumulative periods and a distinct same-cutoff series."""
    directory, kwargs = recovery_bundle
    manifest = json.loads((directory / "recovery-manifest.json").read_text())
    entries, bodies = s._read_archive(directory, manifest)
    catalogue = json.loads(bodies[entries[1]["sha256"]])
    rows = catalogue["data"]["pdfs"]
    rows["C"] = {
        **rows["E"],
        "ReportType": "C",
        "ReportName": "2026 Pre-Primary Report",
        "CutOffDate": "2026-07-20 00:00:00",
        "amendments": ["0", "1", "0"],
    }
    rows["H"] = {
        **rows["E"],
        "ReportType": "H",
        "ReportName": "Distinct report",
        "amendments": ["0", "3", "1"],
    }
    now = datetime.fromisoformat(manifest["completed_at"])
    archive = f.ResponseArchive(str(directory / "responses.jsonl.gz"))
    body = json.dumps(catalogue).encode()
    response = f.Response(
        f.viewer_url(f.FilerKind.candidate_committee),
        entries[1]["form"],
        200,
        body,
        s.file_hash(body),
        now,
        now,
    )
    cat_line = archive.write("catalogue", response, registration_number="19399")
    item = {
        "registration_number": "19399",
        "catalogue_source": {"archive_line": cat_line, "sha256": response.content_hash},
        "documents": {},
    }
    reports, errors = f.parse_catalogue_payload(catalogue, "19399")
    assert not errors
    for report in reports:
        cover = [
            line.replace("10/19/2026", report.cut_off_date.strftime("%m/%d/%Y"))
            for line in COVER
        ]
        body = pdf(cover=cover)
        form = d.document_form(
            registration_number="19399",
            filing_year=2026,
            kind=f.FilerKind.candidate_committee,
            report_type=report.report_type,
            amendment_index=report.effective_amendment_index,
            special_election=False,
        )
        response = f.Response(
            d.document_url(), form, 200, body, s.file_hash(body), now, now
        )
        line = archive.write("report_document", response, registration_number="19399")
        filename = f"19399-{report.report_type}.pdf"
        (directory / filename).write_bytes(body)
        item["documents"][s.catalogue_report_key(report)] = {
            "filing": s.json_value(s.asdict(report)),
            "sha256": response.content_hash,
            "outcome": "served",
            "origin": "official_live",
            "archive_line": line,
            "local_file": filename,
        }
    h, size, count = archive.close()
    manifest["archive"] = {
        "compressed_sha256": h,
        "compressed_bytes": size,
        "response_count": count,
    }
    (directory / "recovery-manifest.json").write_text(json.dumps(manifest))
    (directory / "recovered-evidence.json").write_text(json.dumps([item]))
    return directory, kwargs


def test_exact_documents_keep_all_periods_and_same_cutoff_series(multi_period_bundle):
    directory, kwargs = multi_period_bundle
    collection, _, documents = s.prepare_collection(directory, **kwargs)
    reports = collection["reports"]
    assert len(reports) == collection["coverage"]["reports_with_figures"] == 3
    by_type = {r["payload"]["filing"]["report_type"]: r["payload"] for r in reports}
    assert by_type["C"]["filing"]["effective_amendment_index"] == 1
    assert by_type["C"]["filing"]["amendment_count"] == 2
    assert by_type["H"]["filing"]["effective_amendment_index"] == 3
    assert by_type["E"]["filing"]["effective_amendment_index"] == 0
    assert by_type["C"]["period_end"] == "2026-07-20"
    assert by_type["E"]["period_end"] == by_type["H"]["period_end"] == "2026-10-19"
    for payload in by_type.values():
        assert payload["period_start"] == "2026-01-01"
        assert payload["period_basis"] == "calendar_year_to_date"
        # No aggregation of overlapping cumulative periods, versions, or metrics.
        assert payload["figures"]["contributions_received"]["total"] == "225.00"
        assert payload["figures"]["campaign_expenditures"]["total"] == "127.00"
        assert payload["figures"]["total_expenditures"]["total"] == "177.00"
    assert {r["document_hash"] for r in reports} == set(documents)


@pytest.mark.parametrize(
    "change", ["cutoff", "amendment", "key", "request", "request_metadata", "bytes"]
)
def test_exact_report_documents_reject_tampering(multi_period_bundle, change):
    directory, kwargs = multi_period_bundle
    path = directory / "recovered-evidence.json"
    recovery = json.loads(path.read_text())
    docs = recovery[0]["documents"]
    key = next(iter(docs))
    doc = docs[key]
    if change == "cutoff":
        doc["filing"]["cut_off_date"] = "2026-07-20"
    elif change == "amendment":
        doc["filing"]["effective_amendment_index"] = 9
    elif change == "key":
        docs["a" * 64] = docs.pop(key)
    elif change == "request":
        # Another retained request/PDF cannot stand in for this exact series.
        doc["archive_line"] += 1
    elif change == "request_metadata":
        doc["request_form"] = {"regnum": "a different committee"}
    else:
        (directory / doc["local_file"]).write_bytes(pdf(summary=SUMMARY + ["changed"]))
    path.write_text(json.dumps(recovery))
    with pytest.raises(s.FinanceCollectionError):
        s.prepare_collection(directory, **kwargs)


def test_exact_request_failure_remains_an_explained_gap(multi_period_bundle):
    directory, kwargs = multi_period_bundle
    path = directory / "recovered-evidence.json"
    recovery = json.loads(path.read_text())
    doc = next(iter(recovery[0]["documents"].values()))
    doc.update(outcome="request_failed", error="Network response not received")
    path.write_text(json.dumps(recovery))
    collection, _, _ = s.prepare_collection(directory, **kwargs)
    assert collection["coverage"]["reports_with_figures"] == 2
    gap = next(r for r in collection["reports"] if r["payload"]["figures"] is None)
    assert gap["payload"]["unavailable_reason"] == "Network response not received"
    assert gap["document_hash"] is None


def test_missing_report_plan_uses_effective_versions_and_no_network(
    multi_period_bundle, monkeypatch
):
    from scripts import collect_election_finance_reports as collector

    directory, _ = multi_period_bundle
    path = directory / "recovered-evidence.json"
    recovery = json.loads(path.read_text())
    recovery[0]["documents"] = {}
    path.write_text(json.dumps(recovery))
    monkeypatch.setattr(
        d, "fetch_document", lambda *a, **kw: pytest.fail("dry run fetched")
    )
    result = collector.collect(directory, None, available_on=date(2026, 11, 11))
    assert result["executed"] is False
    assert result["report_count"] == 3
    assert {
        r["filing"]["report_type"]: r["filing"]["effective_amendment_index"]
        for r in result["requests"]
    } == {"E": 0, "C": 1, "H": 3}
    assert all(
        r["report_key"]
        == s.digest(
            [
                "19399",
                2026,
                r["filing"]["report_type"],
                r["filing"]["effective_amendment_index"],
                False,
                None,
            ]
        )
        for r in result["requests"]
    )


@pytest.mark.parametrize("failed", [False, True])
def test_collector_retains_prior_evidence_and_exact_download_result(
    multi_period_bundle, monkeypatch, tmp_path, failed
):
    from scripts import collect_election_finance_reports as collector

    directory, kwargs = multi_period_bundle
    path = directory / "recovered-evidence.json"
    recovery = json.loads(path.read_text())
    missing_key = next(iter(recovery[0]["documents"]))
    removed = recovery[0]["documents"].pop(missing_key)
    path.write_text(json.dumps(recovery))
    manifest = json.loads((directory / "recovery-manifest.json").read_text())
    old_entries, _ = s._read_archive(directory, manifest)
    body = (directory / removed["local_file"]).read_bytes()
    now = datetime.fromisoformat(manifest["completed_at"])
    calls = []

    def fetch(request, *, courtesy_seconds):
        calls.append(request["report_key"])
        assert courtesy_seconds >= 0.25
        if failed:
            return request, None, {"outcome": "request_failed", "error": "No response"}
        form = old_entries[removed["archive_line"]]["form"]
        response = f.Response(
            d.document_url(), form, 200, body, s.file_hash(body), now, now
        )
        return (
            request,
            response,
            {"outcome": "served", "note": "Retained test response"},
        )

    monkeypatch.setattr(collector, "fetch_report", fetch)
    output = tmp_path / "complete"
    result = collector.collect(
        directory, output, available_on=date(2026, 11, 11), execute=True
    )
    assert calls == [missing_key]
    assert result["report_count"] == 1
    complete_manifest = json.loads((output / "recovery-manifest.json").read_text())
    new_entries, _ = s._read_archive(output, complete_manifest)
    assert all(new_entries[line] == entry for line, entry in old_entries.items())
    assert len(new_entries) == len(old_entries) + (0 if failed else 1)
    copied = json.loads((output / "recovered-evidence.json").read_text())[0]
    for key, doc in recovery[0]["documents"].items():
        assert copied["documents"][key] == doc
        assert (output / doc["local_file"]).read_bytes() == (
            directory / doc["local_file"]
        ).read_bytes()
    collection, _, _ = s.prepare_collection(output, **kwargs)
    assert collection["coverage"]["reports_with_figures"] == (2 if failed else 3)


def test_collector_refuses_changed_plan_before_download(
    multi_period_bundle, monkeypatch, tmp_path
):
    from scripts import collect_election_finance_reports as collector

    directory, _ = multi_period_bundle
    plan = tmp_path / "wrong-plan.json"
    plan.write_text('[{"report_key": "wrong"}]')
    output = tmp_path / "unused"
    monkeypatch.setattr(
        d, "fetch_document", lambda *a, **kw: pytest.fail("unexpected fetch")
    )
    with pytest.raises(s.FinanceCollectionError, match="differs"):
        collector.collect(
            directory,
            output,
            available_on=date(2026, 11, 11),
            plan_file=plan,
            execute=True,
        )
    assert not output.exists()


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


def test_optional_expenses_preserve_legacy_input_and_fingerprint(prepared):
    before = deepcopy(prepared[0])
    value = s.add_campaign_expenses(*prepared)
    assert prepared[0] == before
    assert value["format"] == 1 and value["id"] != before["id"]
    assert "campaign_expenses" not in before["reports"][0]["payload"]
    # This synthetic PDF has summary figures but no expense detail schedule.
    expense = value["reports"][0]["payload"]["campaign_expenses"]
    assert expense["status"] == "unavailable" and expense["rows"] == []
    assert (
        value["reports"][0]["payload"]["figures"]
        == before["reports"][0]["payload"]["figures"]
    )
    s.validate_collection(before)


@pytest.mark.parametrize("version", ["b1-ce-2026-v1", "b1-ce-2026-v2"])
def test_expense_address_versions_replay_original_rules(monkeypatch, version):
    from alethical.pipeline import election_campaign_expenses as parser
    from alethical.tests.test_election_campaign_expenses import (
        HEADER,
        totals,
        transaction,
    )

    pages = [
        "Period Covered: 01/01/2026 through 10/19/2026",
        "  B  Disbursements    Cash    Unpaid Bills    In-kind    Total\n"
        " 11 Campaign expenditures  Sch. B1 - CE    10.00    0.00    0.00    10.00",
        "   Schedule B1 - CE   Campaign Expenditures\n"
        "                    Example Candidate Committee\nExample Print\n      Sample City, MN 55101 1234\n"
        + HEADER
        + "\n"
        + transaction()
        + "\n"
        + totals(),
    ]
    monkeypatch.setattr(parser, "_pdf_pages", lambda body: iter(pages))
    payload = {
        "figure_status": "source_verified",
        "period_start": "2026-01-01",
        "period_end": "2026-10-19",
        "figures": {
            "campaign_expenditures": {
                "paid": "10.00",
                "unpaid": "0.00",
                "in_kind": "0.00",
                "total": "10.00",
            }
        },
    }
    value = s._campaign_expense_payload(
        b"%PDF-version-fixture", payload, extraction_version=version
    )
    assert value["status"] == "checked"
    assert value["extraction_version"] == version
    row = value["rows"][0]
    assert row["payee"]["address"]["lines"] == ["Sample City, MN 55101 1234"]
    assert row["payee"]["address"]["state"] == (
        None if version.endswith("v1") else "MN"
    )
    assert row["amounts"]["total"] == "10.00"


def test_expense_upgrade_keeps_saved_legacy_generation_reproducible(prepared):
    legacy = s.add_campaign_expenses(*prepared)
    row = legacy["reports"][0]
    body = prepared[2][row["document_hash"]]
    row["payload"]["campaign_expenses"] = s._campaign_expense_payload(
        body, row["payload"], extraction_version="b1-ce-2026-v1"
    )
    legacy["id"] = s.collection_digest(legacy)
    before = deepcopy(legacy)
    s.validate_collection(legacy)
    assert (
        s.reproduce_campaign_expenses(row, body, None)
        == row["payload"]["campaign_expenses"]
    )
    upgraded = s.add_campaign_expenses(legacy, prepared[1], prepared[2])
    assert upgraded["id"] != legacy["id"]
    assert (
        upgraded["reports"][0]["payload"]["campaign_expenses"]["extraction_version"]
        == "b1-ce-2026-v2"
    )
    assert legacy == before
    s._require_expense_reproduction(
        legacy["reports"], prepared[1], prepared[2], "Legacy replay changed"
    )


@pytest.mark.parametrize("version", [None, "b1-ce-2026-v3", 2])
def test_unknown_expense_version_cannot_select_latest_parser(prepared, version):
    value = s.add_campaign_expenses(*prepared)
    row = value["reports"][0]
    row["payload"]["campaign_expenses"]["extraction_version"] = version
    value["id"] = s.collection_digest(value)
    with pytest.raises(
        s.FinanceCollectionError, match="Unknown expense evidence version"
    ):
        s.validate_collection(value)
    with pytest.raises(
        s.FinanceCollectionError, match="Unknown expense evidence version"
    ):
        s.reproduce_campaign_expenses(row, prepared[2][row["document_hash"]], None)


def test_expense_version_upgrade_and_restore_keep_both_generations(db, prepared):
    legacy = s.add_campaign_expenses(*prepared)
    row = legacy["reports"][0]
    row["payload"]["campaign_expenses"] = s._campaign_expense_payload(
        prepared[2][row["document_hash"]],
        row["payload"],
        extraction_version="b1-ce-2026-v1",
    )
    legacy["id"] = s.collection_digest(legacy)
    current = s.add_campaign_expenses(legacy, prepared[1], prepared[2])
    store = MemoryStore()
    previous = None
    for collection in (legacy, current):
        s.retain_collection_sources(db, store, collection, prepared[1], prepared[2])
        s.stage_collection(db, collection, store=store)
        s.publish_collection(
            db, collection["id"], expected_previous=previous, store=store
        )
        previous = collection["id"]
    s.publish_collection(
        db, legacy["id"], expected_previous=current["id"], restore=True, store=store
    )
    assert (
        db.get(m.ElectionFinanceCurrent, legacy["election_key"]).collection_id
        == legacy["id"]
    )
    for collection in (legacy, current):
        saved = db.get(m.ElectionFinanceCollection, collection["id"])
        assert saved is not None and saved.sealed_at is not None
        s.verify_retained_campaign_expenses(db, collection, store=store)


def test_typed_expense_json_cannot_borrow_an_original_pdf_hash(db, prepared):
    value = s.add_campaign_expenses(*prepared)
    expense = value["reports"][0]["payload"]["campaign_expenses"]
    expense.update(
        status="checked",
        errors=[],
        gaps=[],
        rows=[
            {
                "amounts": {
                    "paid": "80.00",
                    "unpaid": "7.00",
                    "in_kind": "40.00",
                    "total": "127.00",
                },
                "payee": {"name": "Invented typed payee"},
            }
        ],
        proposals=[],
    )
    value["id"] = s.collection_digest(value)
    # A correct generation hash and syntactically valid typed amounts are not proof.
    s.validate_collection(value)
    with pytest.raises(s.FinanceCollectionError, match="reproduce before retention"):
        s.retain_collection_sources(db, MemoryStore(), value, prepared[1], prepared[2])
    assert (
        db.get(m.CampaignFinanceReportDocument, value["reports"][0]["document_hash"])
        is None
    )


def test_expense_stage_and_publish_reproduce_and_refuse_source_loss(db, prepared):
    value = s.add_campaign_expenses(*prepared)
    store = MemoryStore()
    s.retain_collection_sources(db, store, value, prepared[1], prepared[2])
    identifier = s.stage_collection(db, value, store=store)
    db.flush()
    doc = db.get(m.CampaignFinanceReportDocument, value["reports"][0]["document_hash"])
    store.objects.pop(doc.object_key)
    with pytest.raises(s.FinanceCollectionError, match="original"):
        s.publish_collection(db, identifier, expected_previous=None, store=store)
    assert db.get(m.ElectionFinanceCurrent, value["election_key"]) is None


def test_optional_expenses_need_exact_financial_original(prepared):
    value = deepcopy(prepared[0])
    row = value["reports"][0]
    row["payload"]["financial_source"] = {"sha256": "a" * 64}
    value["id"] = s.collection_digest(value)
    with pytest.raises(s.FinanceCollectionError, match="financial original missing"):
        s.add_campaign_expenses(value, prepared[1], prepared[2])


def test_parent_report_hold_remains_binding_for_expense_payload(prepared):
    value = deepcopy(prepared[0])
    row = value["reports"][0]
    body = pdf(summary=[line.replace("127.00", "128.00") for line in SUMMARY])
    fingerprint = s.file_hash(body)
    row["document_hash"] = fingerprint
    row["payload"]["document"]["sha256"] = fingerprint
    row["report_key"] = s.digest(["19399", 2026, "E", 0, False, fingerprint])
    row["payload"].update(
        extraction=extracted(body),
        figures=None,
        figure_status="unavailable",
        unavailable_reason="Summary arithmetic mismatch",
    )
    value["coverage"]["reports_with_figures"] = 0
    value["coverage"]["report_status_counts"] = {"unavailable": 1}
    value["id"] = s.collection_digest(value)
    checked = s.add_campaign_expenses(value, prepared[1], {fingerprint: body})
    expense = checked["reports"][0]["payload"]["campaign_expenses"]
    assert expense["status"] == "unavailable" and expense["rows"] == []
    assert expense["errors"] == ["report_figures_unavailable"]


@pytest.mark.parametrize("forge_total", [False, True])
def test_removing_last_optional_field_never_bypasses_generation_integrity(
    db, prepared, forge_total
):
    from alethical.api.services.election_finance_reads import expense_report_rows

    collection = s.add_campaign_expenses(*prepared)
    store = MemoryStore()
    s.retain_collection_sources(db, store, collection, prepared[1], prepared[2])
    s.stage_collection(db, collection, store=store)
    s.publish_collection(db, collection["id"], expected_previous=None, store=store)
    parent = db.get(m.ElectionFinanceCollection, collection["id"])
    row = expense_report_rows(db, parent)[0]
    payload = deepcopy(row.payload)
    payload.pop("campaign_expenses")
    if forge_total:
        payload["figures"]["campaign_expenditures"].update(
            cash="999000.00", total="999047.00"
        )
    with pytest.raises(SQLAlchemyError):
        with db.begin_nested():
            row.payload = payload
            db.flush()
    assert (
        expense_report_rows(db, parent)[0].payload["figures"]["campaign_expenditures"][
            "total"
        ]
        == "127.00"
    )


@pytest.mark.parametrize("forged", [False, True])
def test_unsealed_legacy_requires_original_digest_and_preserves_genuine_id(
    db, prepared, forged
):
    from fastapi import HTTPException
    from alethical.api.services.election_finance_reads import expense_report_rows

    store = retain(db, prepared)
    value = prepared[0]
    parent = m.ElectionFinanceCollection(
        id=value["id"],
        election_key=value["election_key"],
        copied_at=datetime.fromisoformat(value["copied_at"]),
        sources=value["sources"],
        coverage=value["coverage"],
    )
    db.add(parent)
    db.flush()
    rows = deepcopy(value["reports"])
    if forged:
        rows[0]["payload"]["figures"]["campaign_expenditures"].update(
            cash="999000.00", total="999047.00"
        )
    for row in rows:
        db.add(m.ElectionFinanceReport(collection_id=value["id"], **row))
    db.flush()
    if forged:
        with pytest.raises(HTTPException):
            expense_report_rows(db, parent)
        with pytest.raises(s.FinanceCollectionError, match="fingerprint"):
            s.seal_collection(db, parent.id, store=store)
        assert parent.sealed_at is None
    else:
        assert len(expense_report_rows(db, parent)) == 1
        assert s.seal_collection(db, parent.id, store=store).id == value["id"]
        assert parent.report_index["version"] == 1 and parent.sealed_at


@pytest.mark.parametrize(
    "operation",
    [
        "header_update",
        "header_delete",
        "index_update",
        "seal_update",
        "child_insert",
        "child_update",
        "child_delete",
    ],
)
def test_sealed_board_generation_rejects_all_mutations(db, prepared, operation):
    from sqlalchemy import text

    store = retain(db, prepared)
    identifier = s.stage_collection(db, prepared[0], store=store)
    commands = {
        "header_update": "UPDATE election_finance_collection SET copied_at=copied_at+interval '1 second' WHERE id=:id",
        "header_delete": "DELETE FROM election_finance_collection WHERE id=:id",
        "index_update": "UPDATE election_finance_collection SET report_index='{}'::jsonb WHERE id=:id",
        "seal_update": "UPDATE election_finance_collection SET sealed_at=sealed_at+interval '1 second' WHERE id=:id",
        "child_insert": "INSERT INTO election_finance_report SELECT collection_id,registration_number,repeat('b',64),document_hash,payload FROM election_finance_report WHERE collection_id=:id",
        "child_update": "UPDATE election_finance_report SET payload=payload-'campaign_expenses' WHERE collection_id=:id",
        "child_delete": "DELETE FROM election_finance_report WHERE collection_id=:id",
    }
    for published in (False, True):
        if published:
            s.publish_collection(db, identifier, expected_previous=None, store=store)
        with pytest.raises(SQLAlchemyError):
            with db.begin_nested():
                db.execute(text(commands[operation]), {"id": identifier})
    row = db.get(m.ElectionFinanceCollection, identifier)
    receipt = (row.sealed_at, row.first_published_at)
    assert s.stage_collection(db, deepcopy(prepared[0]), store=store) == identifier
    assert (
        s.publish_collection(db, identifier, expected_previous=None, store=store)[
            "already_current"
        ]
        is True
    )
    assert (row.sealed_at, row.first_published_at) == receipt


def test_real_board_stage_publication_and_restore_serialize_late_insert(prepared):
    from concurrent.futures import ThreadPoolExecutor
    import os
    import subprocess
    import sys
    import time
    from pathlib import Path
    from sqlalchemy import create_engine, text
    from scripts.local_checks import disposable_postgres

    root = Path(__file__).resolve().parents[2]
    with disposable_postgres(root) as url:
        result = subprocess.run(
            [sys.executable, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head"],
            cwd=root,
            env={**os.environ, "DATABASE_URL": url},
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, result.stderr
        engine = create_engine(url)
        store = MemoryStore()
        previous = None

        def variant(label):
            value = deepcopy(prepared[0])
            value["coverage"]["scope_note"] = label
            value["id"] = s.collection_digest(value)
            return value

        try:
            for phase in ("stage", "publication"):
                value = variant(phase)
                with Session(engine) as setup:
                    s.retain_collection_sources(
                        setup, store, value, prepared[1], prepared[2]
                    )
                    if phase == "publication":
                        s.stage_collection(setup, value, store=store)
                    else:
                        setup.add(
                            m.ElectionFinanceCollection(
                                id=value["id"],
                                election_key=value["election_key"],
                                copied_at=datetime.fromisoformat(value["copied_at"]),
                                sources=value["sources"],
                                coverage=value["coverage"],
                            )
                        )
                        setup.flush()
                        for row in value["reports"]:
                            setup.add(
                                m.ElectionFinanceReport(
                                    collection_id=value["id"], **row
                                )
                            )
                    setup.commit()
                pids = []

                def late_insert():
                    with Session(engine) as writer:
                        writer.execute(text("SET LOCAL lock_timeout='8s'"))
                        pids.append(writer.scalar(text("SELECT pg_backend_pid()")))
                        extra = deepcopy(value["reports"][0])
                        extra["report_key"] = "b" * 64
                        writer.add(
                            m.ElectionFinanceReport(collection_id=value["id"], **extra)
                        )
                        writer.commit()

                with ThreadPoolExecutor(max_workers=1) as pool:
                    with Session(engine) as owner:
                        if phase == "stage":
                            s.stage_collection(owner, value, store=store)
                        else:
                            s.publish_collection(
                                owner, value["id"], expected_previous=None, store=store
                            )
                        future = pool.submit(late_insert)
                        deadline = time.monotonic() + 5
                        blocked = False
                        while time.monotonic() < deadline and not future.done():
                            if pids:
                                with engine.connect() as observer:
                                    blocked = observer.scalar(
                                        text(
                                            "SELECT wait_event_type='Lock' FROM pg_stat_activity WHERE pid=:pid"
                                        ),
                                        {"pid": pids[0]},
                                    )
                                if blocked:
                                    break
                            time.sleep(0.01)
                        assert blocked, (
                            "Late child INSERT did not wait on the parent lock"
                        )
                        owner.commit()
                    with pytest.raises(SQLAlchemyError):
                        future.result(timeout=8)
                with Session(engine) as verify:
                    assert (
                        s.collection_digest(s._stored_collection(verify, value["id"]))
                        == value["id"]
                    )
                    assert (
                        len(s._stored_collection(verify, value["id"])["reports"]) == 1
                    )
                if phase == "publication":
                    previous = value["id"]
            # Independent stage callers serialize on the same ID and keep one child.
            concurrent = variant("concurrent-stage")
            with Session(engine) as setup:
                s.retain_collection_sources(
                    setup, store, concurrent, prepared[1], prepared[2]
                )

            def stage_once():
                with Session(engine) as worker:
                    result = s.stage_collection(worker, concurrent, store=store)
                    worker.commit()
                    return result

            with ThreadPoolExecutor(max_workers=2) as pool:
                assert (
                    list(pool.map(lambda _: stage_once(), range(2)))
                    == [concurrent["id"]] * 2
                )
            # Publication compare-and-set has one winner; restore keeps old receipts.
            other = variant("concurrent-publish")
            with Session(engine) as setup:
                s.retain_collection_sources(
                    setup, store, other, prepared[1], prepared[2]
                )
                s.stage_collection(setup, other, store=store)
                setup.commit()

            def publish_once(identifier):
                with Session(engine) as worker:
                    try:
                        s.publish_collection(
                            worker, identifier, expected_previous=previous, store=store
                        )
                        worker.commit()
                        return identifier
                    except s.FinanceCollectionError:
                        worker.rollback()
                        return None

            with ThreadPoolExecutor(max_workers=2) as pool:
                winners = list(pool.map(publish_once, [concurrent["id"], other["id"]]))
            assert sum(v is not None for v in winners) == 1
            with Session(engine) as restore:
                old = restore.get(m.ElectionFinanceCollection, previous)
                receipt = (old.sealed_at, old.first_published_at)
                s.publish_collection(
                    restore,
                    previous,
                    expected_previous=next(v for v in winners if v),
                    restore=True,
                    store=store,
                )
                restore.commit()
                restore.refresh(old)
                assert (old.sealed_at, old.first_published_at) == receipt
        finally:
            engine.dispose()


def test_sealed_index_reads_only_selected_bytes_despite_large_unrelated_report(
    db, prepared
):
    import tracemalloc
    from sqlalchemy import event
    from alethical.api.services.election_finance_reads import expense_report_rows

    value = deepcopy(prepared[0])
    extra = deepcopy(value["reports"][0])
    body = pdf(cover=[line.replace("19399", "19400") for line in COVER])
    fingerprint = s.file_hash(body)
    extra.update(
        registration_number="19400",
        document_hash=fingerprint,
        report_key=s.digest(["19400", 2026, "E", 0, False, fingerprint]),
    )
    extra["payload"].update(
        registration_number="19400",
        document={"sha256": fingerprint},
        figures=None,
        figure_status="unavailable",
        unavailable_reason="Synthetic unrelated report",
        probe_blob="x" * (8 * 1024 * 1024),
    )
    extra["payload"]["filing"]["registration_number"] = "19400"
    value["reports"].append(extra)
    value["coverage"].update(
        reports=2, report_status_counts={"source_verified": 1, "unavailable": 1}
    )
    value["id"] = s.collection_digest(value)
    documents = {**prepared[2], fingerprint: body}
    store = db.info["board_test_store"]
    s.retain_collection_sources(db, store, value, prepared[1], documents)
    s.stage_collection(db, value, store=store)
    selected = value["reports"][0]["report_key"]
    db.expunge_all()
    statements = []

    def record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(db.get_bind(), "before_cursor_execute", record)
    tracemalloc.start()
    try:
        parent = db.get(m.ElectionFinanceCollection, value["id"])
        rows = expense_report_rows(db, parent, report_keys={selected})
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
        event.remove(db.get_bind(), "before_cursor_execute", record)
    assert [r.report_key for r in rows] == [selected]
    assert "probe_blob" not in rows[0].payload
    assert sum(len(json.dumps(r.payload).encode()) for r in rows) < 10000
    assert peak < 4 * 1024 * 1024
    payload_queries = [q for q in statements if "election_finance_report.payload" in q]
    assert len(payload_queries) == 1 and "report_key IN" in payload_queries[0]
    assert len(parent.report_index["reports"]) == 2


def subsidy_pdf(*, receipt_amount="300.00", row_amount="300.00", cover=COVER):
    writer = PdfWriter()
    for lines in [
        cover,
        SUMMARY,
        [
            "Schedule A2 - PS Receipts from Public Subsidy Payment",
            "Example, Candidate House District 10A Committee",
            "Date Total",
            f"08/26/2026 Public subsidy payment from State of Minnesota {row_amount}",
            f"Amount Received {receipt_amount}",
            "Campaign Finance Reporter Online 1.0.4439 XSD Version: 2.6 Printed 10/26/2026",
            "Page 3",
        ],
    ]:
        writer.add_page(PdfReader(io.BytesIO(pdf_of(lines))).pages[0])
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


def subsidy_financial(amount="0.00"):
    return f.FinancialTab(
        years={
            2026: f.YearFigures(
                year=2026,
                heading="2026",
                reported_through=date(2026, 10, 19),
                amounts={"public_subsidy_payments": Decimal(amount)},
            )
        }
    )


def test_filed_subsidy_v2_preserves_disagreement_with_literal_figure():
    body = subsidy_pdf()
    legacy = s.extract_report_evidence(
        body,
        "19399",
        filing(),
        d.ReportDocument(),
        subsidy_financial(),
        include_public_subsidy=True,
    )
    assert "public_subsidy_payments" not in legacy["figures"]
    result = s.extract_report_evidence(
        body,
        "19399",
        filing(),
        d.ReportDocument(),
        subsidy_financial(),
        include_public_subsidy=True,
        public_subsidy_source_method_version=2,
    )
    assert result["figures"]["public_subsidy_payments"]["total"] == "300.00"
    assert result["public_subsidy_gap"] is None
    comparison = result["public_subsidy_comparison"]
    assert comparison["status"] == "sources_disagree"
    assert comparison["overview"] == {
        "amount": "0.00",
        "period_start": "2026-01-01",
        "period_end": "2026-10-19",
    }
    assert comparison["filed"]["source_sha256"] == s.file_hash(body)
    assert comparison["receipts"]["status"] == "checked"
    assert comparison["receipts"]["total"] == Decimal("300.00")


@pytest.mark.parametrize("version", [None, True, False, 0, 3, "2", 2.0, [], {}])
def test_subsidy_method_rejects_unknown_explicit_versions(version):
    with pytest.raises(s.FinanceCollectionError, match="subsidy source method"):
        s.extract_report_evidence(
            pdf(),
            "19399",
            filing(),
            d.ReportDocument(),
            subsidy_financial(),
            include_public_subsidy=True,
            public_subsidy_source_method_version=version,
        )


@pytest.mark.parametrize("version", [1, 2])
@pytest.mark.parametrize("overview", ["300.00", "0.00"])
def test_subsidy_method_keeps_matching_and_legacy_paths_scan_free(
    monkeypatch, version, overview
):
    def forbidden(*args, **kwargs):
        pytest.fail("Unexpected extra receipt scan")

    if version == 1 or overview == "300.00":
        monkeypatch.setattr(s, "extract_subsidy_receipts", forbidden)
        result = s.extract_report_evidence(
            subsidy_pdf(),
            "19399",
            filing(),
            d.ReportDocument(),
            subsidy_financial(overview),
            include_public_subsidy=True,
            public_subsidy_source_method_version=version,
        )
        assert "public_subsidy_comparison" not in result
        assert ("public_subsidy_payments" in result["figures"]) is (
            overview == "300.00"
        )
    else:
        result = s.extract_report_evidence(
            subsidy_pdf(),
            "19399",
            filing(),
            d.ReportDocument(),
            subsidy_financial(overview),
            include_public_subsidy=True,
            public_subsidy_source_method_version=version,
        )
        assert result["public_subsidy_comparison"]["receipts"]["status"] == "checked"
        assert result["figures"]["public_subsidy_payments"]["total"] == "300.00"


@pytest.mark.parametrize(
    "body",
    [pdf(), subsidy_pdf(receipt_amount="301.00"), subsidy_pdf(row_amount="299.00")],
)
def test_qualified_subsidy_missing_or_contradictory_detail_stays_unknown(body):
    result = s.extract_report_evidence(
        body,
        "19399",
        filing(),
        d.ReportDocument(),
        subsidy_financial(),
        include_public_subsidy=True,
        public_subsidy_source_method_version=2,
    )
    assert result["public_subsidy_gap"]
    assert "public_subsidy_payments" not in result["figures"]
    assert result["public_subsidy_comparison"]["receipts"]["status"] == "unavailable"
    assert result["public_subsidy_comparison"]["overview"]["amount"] == "0.00"
    assert result["figures"]["campaign_expenditures"]["total"] == "127.00"


@pytest.mark.parametrize(
    "cover",
    [
        [
            line.replace("Candidate", "Different")
            if line.startswith("Candidate Name:")
            else line
            for line in COVER
        ],
        [line.replace("House District 10A", "House District 10B") for line in COVER],
        [line.replace("10/19/2026", "08/25/2026") for line in COVER],
        [line.replace("19399", "19400") for line in COVER],
    ],
)
def test_subsidy_wrong_identity_registration_period_does_not_qualify(cover):
    result = s.extract_report_evidence(
        subsidy_pdf(cover=cover),
        "19399",
        filing(),
        d.ReportDocument(),
        subsidy_financial(),
        include_public_subsidy=True,
        public_subsidy_source_method_version=2,
    )
    assert (
        result["status"] == "requires_review"
        or "public_subsidy_payments" not in result["figures"]
    )
    assert (
        "public_subsidy_comparison" not in result
        or result["public_subsidy_comparison"]["receipts"]["status"] == "unavailable"
    )
    assert result["public_subsidy_gap"] or result["status"] == "requires_review"


def test_subsidy_summary_cannot_be_filled_from_receipt_or_overview_remainder():
    summary = [
        "7 Public Subsidy" if line.startswith("7 ") else line for line in SUMMARY
    ]
    body = pdf(summary=summary)
    result = s.extract_report_evidence(
        body,
        "19399",
        filing(),
        d.ReportDocument(),
        subsidy_financial(),
        include_public_subsidy=True,
        public_subsidy_source_method_version=2,
    )
    assert "public_subsidy_payments" not in result["figures"]
    assert result["public_subsidy_gap"]


def test_subsidy_upgrade_is_immutable_preserves_expenses_and_source_dates(
    recovery_bundle,
):
    directory, kwargs = recovery_bundle
    prepared = s.prepare_collection(
        directory, **kwargs, public_subsidy_source_method_version=1
    )
    legacy = s.add_campaign_expenses(*prepared)
    before = deepcopy(legacy)
    upgraded = s.add_filed_public_subsidy(legacy, prepared[1], prepared[2])
    assert legacy == before
    assert upgraded["id"] != before["id"]
    for key in ("sources", "copied_at", "coverage"):
        assert upgraded[key] == before[key]
    for old, new in zip(before["reports"], upgraded["reports"]):
        assert (
            new["payload"]["campaign_expenses"] == old["payload"]["campaign_expenses"]
        )
        assert new["payload"]["public_subsidy_source_method_version"] == 2
        assert new["payload"]["financial_source"] == old["payload"]["financial_source"]
        allowed = {
            "public_subsidy_source_method_version",
            "extraction",
            "figures",
            "public_subsidy_gap",
            "public_subsidy_comparison",
        }
        assert {
            key: value for key, value in new["payload"].items() if key not in allowed
        } == {key: value for key, value in old["payload"].items() if key not in allowed}
    assert s.add_filed_public_subsidy(upgraded, prepared[1], prepared[2]) == upgraded
    s._require_expense_reproduction(
        upgraded["reports"], prepared[1], prepared[2], "changed"
    )


@pytest.mark.parametrize("version", [None, False, "2", 3])
def test_subsidy_stored_unknown_method_refuses_even_with_recomputed_id(
    prepared, version
):
    collection = deepcopy(prepared[0])
    collection["reports"][0]["payload"]["public_subsidy_source_method_version"] = (
        version
    )
    collection["id"] = s.collection_digest(collection)
    with pytest.raises(s.FinanceCollectionError, match="subsidy source method"):
        s.validate_collection(collection)


def test_subsidy_legacy_and_v2_publish_restore_keep_distinct_generations(
    db, recovery_bundle
):
    directory, kwargs = recovery_bundle
    prepared = s.prepare_collection(
        directory, **kwargs, public_subsidy_source_method_version=1
    )
    upgraded = s.add_filed_public_subsidy(*prepared)
    store = retain(db, prepared)
    first = s.stage_collection(db, prepared[0], store=store)
    s.publish_collection(db, first, expected_previous=None)
    second = s.stage_collection(db, upgraded, store=store)
    s.publish_collection(db, second, expected_previous=first)
    s.publish_collection(db, first, expected_previous=second, restore=True)
    assert (
        s._stored_collection(db, first)["reports"][0]["payload"].get(
            "public_subsidy_source_method_version", 1
        )
        == 1
    )
    assert (
        s._stored_collection(db, second)["reports"][0]["payload"][
            "public_subsidy_source_method_version"
        ]
        == 2
    )


def test_subsidy_reproduction_without_expenses_does_not_add_detail_scan(
    recovery_bundle, monkeypatch
):
    directory, kwargs = recovery_bundle
    prepared = s.prepare_collection(directory, **kwargs)
    upgraded = s.add_filed_public_subsidy(*prepared)

    def forbidden(*args, **kwargs):
        pytest.fail("Subsidy reproduction must not add an expense layout scan")

    monkeypatch.setattr(s, "extract_campaign_expenses", forbidden)
    s._require_expense_reproduction(
        upgraded["reports"], prepared[1], prepared[2], "changed"
    )


@pytest.mark.parametrize("changed", ["amendment", "period", "registration"])
def test_subsidy_catalogue_binding_rejects_changed_selected_report(
    recovery_bundle, changed
):
    directory, kwargs = recovery_bundle
    collection, originals, _ = s.prepare_collection(directory, **kwargs)
    row = deepcopy(collection["reports"][0])
    row["payload"]["public_subsidy_comparison"] = {"status": "sources_disagree"}
    if changed == "amendment":
        row["payload"]["filing"]["effective_amendment_index"] = 1
    elif changed == "period":
        row["payload"]["filing"]["cut_off_date"] = "2026-07-20"
    else:
        row["payload"]["filing"]["registration_number"] = "19400"
    with pytest.raises(s.FinanceCollectionError, match="catalogue report or amendment"):
        s._require_subsidy_catalogue(row, originals)


def test_subsidy_upgrade_checks_original_extraction_before_changing_method(prepared):
    collection = deepcopy(prepared[0])
    row = collection["reports"][0]
    # A recomputed generation ID cannot approve invented source values.
    row["payload"]["extraction"]["page_count"] = 999
    collection["id"] = s.collection_digest(collection)
    with pytest.raises(s.FinanceCollectionError, match="does not reproduce"):
        s.add_filed_public_subsidy(collection, prepared[1], prepared[2])


def test_subsidy_upgrade_reproduces_preserved_expense_evidence(recovery_bundle):
    directory, kwargs = recovery_bundle
    prepared = s.prepare_collection(directory, **kwargs)
    collection = s.add_campaign_expenses(*prepared)
    collection["reports"][0]["payload"]["campaign_expenses"]["errors"].append(
        "Invented gap"
    )
    collection["id"] = s.collection_digest(collection)
    s.validate_collection(collection)
    with pytest.raises(
        s.FinanceCollectionError, match="Original expense evidence does not reproduce"
    ):
        s.add_filed_public_subsidy(collection, prepared[1], prepared[2])


@pytest.fixture
def conflicting_subsidy_bundle(recovery_bundle):
    from alethical.tests.test_campaign_finance_filings import FakeBoard

    directory, kwargs = recovery_bundle
    manifest = json.loads((directory / "recovery-manifest.json").read_text())
    recovery = json.loads((directory / "recovered-evidence.json").read_text())
    entries, bodies = s._read_archive(directory, manifest)
    now = datetime.fromisoformat(manifest["completed_at"])
    archive = f.ResponseArchive(str(directory / "responses.jsonl.gz"))
    catalogue_hash = recovery[0]["catalogue_source"]["sha256"]
    catalogue_entry = next(
        entry for entry in entries.values() if entry["sha256"] == catalogue_hash
    )
    catalogue_response = f.Response(
        catalogue_entry["url"],
        catalogue_entry["form"],
        200,
        bodies[catalogue_hash],
        catalogue_hash,
        now,
        now,
    )
    catalogue_line = archive.write(
        "catalogue", catalogue_response, registration_number="19399"
    )
    recovery[0]["catalogue_source"]["archive_line"] = catalogue_line
    body = subsidy_pdf()
    doc_response = f.Response(
        d.document_url(), entries[2]["form"], 200, body, s.file_hash(body), now, now
    )
    doc_line = archive.write(
        "report_document", doc_response, registration_number="19399"
    )
    (directory / "19399-2026-E-0.pdf").write_bytes(body)
    recovery[0]["document"].update(
        sha256=doc_response.content_hash, archive_line=doc_line
    )
    board = FakeBoard()
    board.reported_through[("15667", 2026)] = "10/19/2026"
    board.amount_overrides[("15667", 2026)] = {
        "Campaign expenditures": "$80.00",
        "Total expenditures": "$130.00",
        "Public subsidy payments": "$0.00",
    }
    financial_body = json.dumps(board.financial_payload("15667", (2026, 2027))).encode()
    form = f.viewer_form("19399", (2026, 2027), "financial")
    response = f.Response(
        f.viewer_url(f.FilerKind.candidate_committee),
        form,
        200,
        financial_body,
        s.file_hash(financial_body),
        now,
        now,
    )
    line = archive.write("financial", response, registration_number="19399")
    recovery[0]["financial_source"] = {
        "archive_line": line,
        "sha256": response.content_hash,
    }
    h, size, count = archive.close()
    manifest["archive"] = {
        "compressed_sha256": h,
        "compressed_bytes": size,
        "response_count": count,
    }
    (directory / "recovery-manifest.json").write_text(json.dumps(manifest))
    (directory / "recovered-evidence.json").write_text(json.dumps(recovery))
    return directory, kwargs


def test_qualified_subsidy_generation_stage_reproduces_conflict_and_restores(
    db, conflicting_subsidy_bundle
):
    directory, kwargs = conflicting_subsidy_bundle
    legacy, originals, documents = s.prepare_collection(
        directory, **kwargs, public_subsidy_source_method_version=1
    )
    old = legacy["reports"][0]["payload"]
    assert old["public_subsidy_gap"] and "public_subsidy_payments" not in old["figures"]
    upgraded = s.add_filed_public_subsidy(legacy, originals, documents)
    new = upgraded["reports"][0]["payload"]
    assert new["figures"]["public_subsidy_payments"]["total"] == "300.00"
    assert (
        new["public_subsidy_comparison"]
        == new["extraction"]["public_subsidy_comparison"]
    )
    assert new["public_subsidy_comparison"]["status"] == "sources_disagree"
    assert new["financial_source"] == old["financial_source"]
    store = retain(db, (legacy, originals, documents))
    first = s.stage_collection(db, legacy, store=store)
    s.publish_collection(db, first, expected_previous=None)
    second = s.stage_collection(db, upgraded, store=store)
    s.publish_collection(db, second, expected_previous=first)
    assert (
        s._stored_collection(db, second)["reports"][0]["payload"]["figures"][
            "public_subsidy_payments"
        ]["total"]
        == "300.00"
    )
    s.publish_collection(db, first, expected_previous=second, restore=True)
    restored = s._stored_collection(db, first)["reports"][0]["payload"]
    assert (
        "public_subsidy_payments" not in restored["figures"]
        and restored["public_subsidy_gap"]
    )


def test_prepare_collection_opt_in_dispatches_subsidy_method(
    conflicting_subsidy_bundle,
):
    directory, kwargs = conflicting_subsidy_bundle
    value, _, _ = s.prepare_collection(
        directory, public_subsidy_source_method_version=2, **kwargs
    )
    payload = value["reports"][0]["payload"]
    assert payload["public_subsidy_source_method_version"] == 2
    assert payload["figures"]["public_subsidy_payments"]["total"] == "300.00"
    assert payload["public_subsidy_comparison"]["status"] == "sources_disagree"


def test_qualified_subsidy_rejects_unconsumed_ps_marker_with_malformed_purpose():
    writer = PdfWriter()
    for page in PdfReader(io.BytesIO(subsidy_pdf())).pages:
        writer.add_page(page)
    extra = [
        "Schedule A2 - PS",
        "Example, Candidate House District 10A Committee",
        "Date Total",
        "08/27/2026 Public subsidy payment from State of Minnes0ta 100.00",
        "Amount Received 100.00",
        "Campaign Finance Reporter Online 1.0.4439 XSD Version: 2.6 Printed 10/26/2026",
        "Page 4",
    ]
    writer.add_page(PdfReader(io.BytesIO(pdf_of(extra))).pages[0])
    output = io.BytesIO()
    writer.write(output)
    result = s.extract_report_evidence(
        output.getvalue(),
        "19399",
        filing(),
        d.ReportDocument(),
        subsidy_financial(),
        include_public_subsidy=True,
        public_subsidy_source_method_version=2,
    )
    assert "public_subsidy_payments" not in result["figures"]
    assert (
        result["public_subsidy_comparison"]["receipts"]["reason"]
        == "orphan_subsidy_content"
    )
    assert result["public_subsidy_gap"]


def test_qualified_subsidy_zero_needs_a_dated_receipt_row():
    writer = PdfWriter()
    summary = [
        line.replace("300.00", "0.00")
        .replace("897.00", "597.00")
        .replace("937.00", "637.00")
        for line in SUMMARY
    ]
    for lines in [
        COVER,
        summary,
        [
            "Schedule A2 - PS Receipts from Public Subsidy Payment",
            "Example, Candidate House District 10A Committee",
            "Date Total",
            "Amount Received 0.00",
            "Campaign Finance Reporter Online 1.0.4439 XSD Version: 2.6 Printed 10/26/2026",
            "Page 3",
        ],
    ]:
        writer.add_page(PdfReader(io.BytesIO(pdf_of(lines))).pages[0])
    output = io.BytesIO()
    writer.write(output)
    result = s.extract_report_evidence(
        output.getvalue(),
        "19399",
        filing(),
        d.ReportDocument(),
        subsidy_financial("300.00"),
        include_public_subsidy=True,
        public_subsidy_source_method_version=2,
    )
    assert "public_subsidy_payments" not in result["figures"]
    assert result["public_subsidy_comparison"]["receipts"]["rows"] == []
    assert (
        result["public_subsidy_gap"]
        == "Public subsidy receipt schedule has no dated payment rows"
    )


def test_new_subsidy_preparation_defaults_current_but_legacy_is_explicit(
    conflicting_subsidy_bundle,
):
    directory, kwargs = conflicting_subsidy_bundle
    default = s.prepare_collection(directory, **kwargs)[0]
    current = s.prepare_collection(
        directory, public_subsidy_source_method_version=2, **kwargs
    )[0]
    legacy = s.prepare_collection(
        directory, public_subsidy_source_method_version=1, **kwargs
    )[0]
    assert default == current
    assert (
        default["reports"][0]["payload"]["figures"]["public_subsidy_payments"]["total"]
        == "300.00"
    )
    assert (
        legacy["reports"][0]["payload"].get("public_subsidy_source_method_version", 1)
        == 1
    )
    assert "public_subsidy_payments" not in legacy["reports"][0]["payload"]["figures"]


@pytest.mark.parametrize("command", ["prepare", "stage"])
@pytest.mark.parametrize("version", [None, 1, 2])
def test_subsidy_cli_forwards_new_default_and_explicit_method(
    prepared, tmp_path, monkeypatch, command, version
):
    from scripts import stage_election_finance as cli

    observed = []

    def prepare(*args, **kwargs):
        observed.append(kwargs)
        return prepared

    monkeypatch.setattr(cli.storage, "prepare_collection", prepare)
    argv = [
        command,
        "--directory",
        str(tmp_path),
        "--roster-directory",
        str(tmp_path),
        "--directory-file",
        str(tmp_path / "register.json"),
        "--directory-metadata",
        str(tmp_path / "metadata.json"),
    ]
    if version is not None:
        argv += ["--public-subsidy-source-method-version", str(version)]
    assert cli.main(argv) == 0
    assert observed[0]["public_subsidy_source_method_version"] == (
        2 if version is None else version
    )
