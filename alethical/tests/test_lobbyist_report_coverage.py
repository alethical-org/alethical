"""Late starts require every effective report period, not just held payment dates."""

from dataclasses import replace
from datetime import date
import hashlib
import io
import json

from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
import pytest

from alethical.pipeline.campaign_finance_filings import CatalogueReport
from alethical.pipeline.lobbyist_report_coverage import (
    ReportCoverageError,
    read_known_report_coverage,
)

CATALOGUE_HASH = "c" * 64


def _pdf(registration, start, end):
    writer = PdfWriter()
    page = writer.add_blank_page(width=700, height=700)
    font = writer._add_object(
        DictionaryObject(
            {
                NameObject("/Type"): NameObject("/Font"),
                NameObject("/Subtype"): NameObject("/Type1"),
                NameObject("/BaseFont"): NameObject("/Courier"),
            }
        )
    )
    page[NameObject("/Resources")] = DictionaryObject(
        {NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})}
    )
    content = (
        "BT /F1 10 Tf 12 TL 20 650 Td "
        f"(Registration Number: {registration}) Tj T* "
        f"(Period Covered: {start:%m/%d/%Y} through {end:%m/%d/%Y}) Tj ET"
    )
    stream = DecodedStreamObject()
    stream.set_data(content.encode())
    page[NameObject("/Contents")] = writer._add_object(stream)
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


def _entry(report_type, cutoff, special, amendment=0):
    return CatalogueReport(
        registration_number="19229",
        filing_year=2025,
        report_type=report_type,
        report_name="Example report",
        cut_off_date=cutoff,
        special_election=special,
        effective_amendment_index=amendment,
        amendment_count=amendment + 1,
        termination_date=None,
    )


def _document(tmp_path, entry, start, *, header_registration="19229", header_end=None):
    body = _pdf(header_registration, start, header_end or entry.cut_off_date)
    digest = hashlib.sha256(body).hexdigest()
    (tmp_path / f"{digest}.pdf").write_bytes(body)
    return {
        "document_hash": digest,
        "registration_number": "19229",
        "filing_year": 2025,
        "report_type": entry.report_type,
        "amendment_index": entry.effective_amendment_index,
        "special_election": entry.special_election,
        "period_start": str(start),
        "period_end": str(entry.cut_off_date),
    }


def _manifest(tmp_path, documents, **changes):
    manifest = {
        "registration_number": "19229",
        "year": 2025,
        "catalogue_hash": CATALOGUE_HASH,
        "documents": documents,
        **changes,
    }
    (tmp_path / "19229-2025-coverage.json").write_text(json.dumps(manifest))


def _case(
    tmp_path, *, earlier_start=date(2025, 7, 29), regular_start=date(2025, 11, 20)
):
    earlier = _entry("C", date(2025, 8, 12), True, 1)
    special = _entry("YE", date(2025, 11, 19), True, 4)
    regular = _entry("YE", date(2025, 12, 31), False, 1)
    extra = [_document(tmp_path, earlier, earlier_start)]
    selected = [
        _document(tmp_path, special, date(2025, 7, 29)),
        _document(tmp_path, regular, regular_start),
    ]
    _manifest(tmp_path, extra)
    return [earlier, special, regular], selected, extra


def _check(tmp_path, entries, selected):
    return read_known_report_coverage(
        tmp_path, "19229", 2025, entries, selected, CATALOGUE_HASH
    )


def test_all_effective_headers_establish_late_start_and_retain_audit_hashes(tmp_path):
    entries, selected, extra = _case(tmp_path)
    result = _check(tmp_path, entries, selected)
    assert result["coverage_start"] == date(2025, 7, 29)
    assert result["coverage_end"] == date(2025, 12, 31)
    assert len(result["documents"]) == 3
    assert {d["document_hash"] for d in result["documents"]} == {
        d["document_hash"] for d in selected + extra
    }
    assert sum(d["purpose"] == "period_only" for d in result["documents"]) == 1


def test_missing_earlier_period_cannot_be_assumed_from_its_cutoff(tmp_path):
    entries, selected, _ = _case(tmp_path)
    (tmp_path / "19229-2025-coverage.json").unlink()
    with pytest.raises(ReportCoverageError, match="coverage_manifest"):
        _check(tmp_path, entries, selected)


def test_earlier_report_start_before_latest_period_refuses_late_start(tmp_path):
    entries, selected, _ = _case(tmp_path, earlier_start=date(2025, 7, 1))
    with pytest.raises(ReportCoverageError, match="earlier_report_extends"):
        _check(tmp_path, entries, selected)


@pytest.mark.parametrize("start", [date(2025, 11, 19), date(2025, 11, 21)])
def test_selected_series_must_not_overlap_or_have_a_gap(tmp_path, start):
    entries, selected, _ = _case(tmp_path, regular_start=start)
    with pytest.raises(ReportCoverageError, match="gap_overlap"):
        _check(tmp_path, entries, selected)


def test_cross_year_final_report_covers_only_source_year_in_return(tmp_path):
    earlier = _entry("C", date(2025, 12, 2), True, 2)
    final = _entry("YE", date(2026, 2, 11), True)
    start = date(2025, 11, 17)
    selected = [_document(tmp_path, final, start)]
    _manifest(tmp_path, [_document(tmp_path, earlier, start)])
    result = _check(tmp_path, [earlier, final], selected)
    assert result["coverage_start"] == start
    assert result["coverage_end"] == date(2025, 12, 31)


def test_latest_final_report_ending_before_dec31_is_not_annual_coverage(tmp_path):
    final = _entry("YE", date(2025, 11, 19), True)
    selected = [_document(tmp_path, final, date(2025, 7, 29))]
    with pytest.raises(ReportCoverageError, match="early_end"):
        _check(tmp_path, [final], selected)


@pytest.mark.parametrize("mutation", ["missing", "changed"])
def test_missing_or_changed_earlier_pdf_fails(tmp_path, mutation):
    entries, selected, extra = _case(tmp_path)
    path = tmp_path / f"{extra[0]['document_hash']}.pdf"
    if mutation == "missing":
        path.unlink()
    else:
        path.write_bytes(path.read_bytes() + b"changed")
    with pytest.raises(
        ReportCoverageError, match="missing_coverage_document|hash_changed"
    ):
        _check(tmp_path, entries, selected)


@pytest.mark.parametrize("wrong", ["registration", "cutoff"])
def test_earlier_header_must_match_catalogue_identity(tmp_path, wrong):
    entries, selected, _ = _case(tmp_path)
    extra = _document(
        tmp_path,
        entries[0],
        date(2025, 7, 29),
        header_registration="999" if wrong == "registration" else "19229",
        header_end=date(2025, 8, 11) if wrong == "cutoff" else None,
    )
    _manifest(tmp_path, [extra])
    with pytest.raises(
        ReportCoverageError, match="registration_mismatch|cutoff_mismatch"
    ):
        _check(tmp_path, entries, selected)


def test_old_amendment_cannot_stand_in_for_effective_report(tmp_path):
    entries, selected, extra = _case(tmp_path)
    extra[0]["amendment_index"] = 0
    _manifest(tmp_path, extra)
    with pytest.raises(ReportCoverageError, match="document_set_incomplete"):
        _check(tmp_path, entries, selected)


def test_coverage_manifest_is_bound_to_the_same_catalogue(tmp_path):
    entries, selected, extra = _case(tmp_path)
    _manifest(tmp_path, extra, catalogue_hash="d" * 64)
    with pytest.raises(ReportCoverageError, match="manifest_identity_mismatch"):
        _check(tmp_path, entries, selected)


@pytest.mark.parametrize(
    "field,value", [("special_election", 2), ("effective_amendment_index", None)]
)
def test_unknown_series_or_amendment_refuses_coverage(tmp_path, field, value):
    entries, selected, _ = _case(tmp_path)
    entries[0] = replace(entries[0], **{field: value})
    with pytest.raises(ReportCoverageError, match="unknown_report"):
        _check(tmp_path, entries, selected)


def test_duplicate_identical_catalogue_rows_are_not_duplicate_periods(tmp_path):
    entries, selected, _ = _case(tmp_path)
    result = _check(tmp_path, entries + [entries[0]], selected)
    assert len(result["documents"]) == 3


def test_conflicting_effective_versions_fail_instead_of_choosing_one(tmp_path):
    entries, selected, _ = _case(tmp_path)
    conflicting = replace(entries[0], effective_amendment_index=3)
    with pytest.raises(ReportCoverageError, match="conflicting_effective"):
        _check(tmp_path, entries + [conflicting], selected)


def test_omitted_catalogue_series_cannot_pass(tmp_path):
    entries, selected, _ = _case(tmp_path)
    with pytest.raises(ReportCoverageError, match="selected_series"):
        _check(tmp_path, entries, selected[:1])


def test_hash_matching_non_pdf_response_does_not_establish_coverage(tmp_path):
    entries, selected, extra = _case(tmp_path)
    body = b"The requested file has not been released"
    digest = hashlib.sha256(body).hexdigest()
    (tmp_path / f"{digest}.pdf").write_bytes(body)
    extra[0]["document_hash"] = digest
    _manifest(tmp_path, extra)
    with pytest.raises(ReportCoverageError, match="not_pdf"):
        _check(tmp_path, entries, selected)


def test_malformed_manifest_document_list_has_a_deterministic_refusal(tmp_path):
    entries, selected, _ = _case(tmp_path)
    _manifest(tmp_path, {"wrong": "shape"})
    with pytest.raises(ReportCoverageError, match="malformed_coverage_document"):
        _check(tmp_path, entries, selected)
