"""Older report layouts must prove their totals before any money is published.

Shapes follow held 2022 reports 17868, 11880 and 20008: compact codes, repeated
page headings, colon-ended totals, and amounts drawn before their row labels.
Amounts here are small examples, not assertions about those filers.
"""

from __future__ import annotations

import io
from decimal import Decimal

import pytest
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from alethical.db.models import CampaignFinanceFilerKind as Kind
from alethical.pipeline import campaign_finance_report_documents as documents


def legacy_pdf() -> bytes:
    """Draw the numbers first but put them beside labels in the printed table."""
    writer = PdfWriter()
    page = writer.add_blank_page(width=900, height=792)
    page[NameObject("/Resources")] = DictionaryObject(
        {
            NameObject("/Font"): DictionaryObject(
                {
                    NameObject("/F1"): DictionaryObject(
                        {
                            NameObject("/Type"): NameObject("/Font"),
                            NameObject("/Subtype"): NameObject("/Type1"),
                            NameObject("/BaseFont"): NameObject("/Courier"),
                        }
                    )
                }
            ),
        }
    )
    cells = [
        (40, 750, "Schedule A1-IND     Individual Contributions Received"),
        (400, 700, "300.00  20.00  320.00"),
        (400, 680, "50.00  0.00  50.00"),
        (40, 700, "Total of itemized"),
        (40, 680, "Total of non-itemized"),
        (40, 650, "Schedule A1-IND     Individual Contributions Received"),
    ]
    stream = DecodedStreamObject()
    stream.set_data(
        "\n".join(
            f"BT /F1 10 Tf 1 0 0 1 {x} {y} Tm ({value}) Tj ET" for x, y, value in cells
        ).encode("ascii")
    )
    page[NameObject("/Contents")] = writer._add_object(stream)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def read(lines: list[str]) -> documents.ReportDocument:
    return documents.schedules_from_lines(
        documents.normalize_legacy_schedule_lines(lines)
    )


def test_legacy_pdf_restores_rows_from_drawing_order() -> None:
    body = legacy_pdf()
    raw, _ = documents.extract_lines(body)
    # This is the actual failure: the ordinary reader sees headings but no totals.
    old, _ = documents.stated_contributions(
        documents.schedules_from_lines(raw),
        Kind.candidate_committee,
        {"individuals_contributions": Decimal("350")},
    )
    assert old is not None and old.self_test == documents.SelfTest.failed
    parsed = documents.parse_report_document(body)
    result, errors = documents.stated_contributions(
        parsed,
        Kind.candidate_committee,
        {"individuals_contributions": Decimal("350")},
    )
    assert errors == []
    assert result is not None and result.self_test == documents.SelfTest.passed
    assert (result.itemized_cash, result.itemized, result.non_itemized) == (
        Decimal("300"),
        Decimal("320"),
        Decimal("50"),
    )


@pytest.mark.parametrize(
    ("source", "canonical"),
    [
        ("A1-LB", "A1 - LOB"),
        ("A1-PTY", "A1 - PTY/TERM PCC"),
        ("A1-PCF", "A1 - PCF"),
        ("A1-CR", "A1 - CR"),
    ],
)
def test_compact_codes_and_repeated_page_headers_keep_one_total(
    source: str, canonical: str
) -> None:
    parsed = read(
        [
            f"Schedule {source}     Contributions Received",
            f"Schedule {source}     Contributions Received     Printed June 13, 2023",
            f"Schedule {source}     Contributions Received",
            "Total of itemized: 100.00 25.00 125.00",
            "Total of non-itemized: 20.00 0.00 20.00",
            f"Schedule {source}     Contributions Received     Printed June 13, 2023",
        ]
    )
    assert parsed.errors == []
    assert set(parsed.schedules) == {canonical}
    assert parsed.schedules[canonical].itemized == (
        Decimal("100"),
        Decimal("25"),
        Decimal("125"),
    )


@pytest.mark.parametrize(
    "heading", ["Schedule B1     Expenditures", "Schedule B1-EXP     Expenditures"]
)
def test_legacy_spending_excludes_independent_payments_from_ordinary_total(
    heading: str,
) -> None:
    parsed = read(
        [
            heading,
            "Total Itemized Expenditures: 100.00 10.00 5.00 115.00",
            "Total Unitemized Expenditures: 20.00 0.00 0.00 20.00",
            "Schedule B3     Independent Expenditures",
            "Total Itemized Expenditures: 80.00 0.00 0.00 80.00",
            "Total Unitemized Expenditures: 0.00 0.00 0.00 0.00",
        ]
    )
    result, errors = documents.stated_spending(
        parsed,
        Kind.party_unit,
        {
            "general_expenditures": Decimal("120"),
            "independent_expenditure": Decimal("80"),
            "total_expenditures": Decimal("200"),
        },
    )
    assert errors == []
    assert result is not None and result.self_test == documents.SelfTest.passed
    assert (result.itemized, result.itemized_paid, result.independent_itemized) == (
        Decimal("115"),
        Decimal("100"),
        Decimal("80"),
    )


def test_repeated_legacy_totals_are_refused_not_silently_discarded() -> None:
    pair = [
        "Total of itemized: 100.00 0.00 100.00",
        "Total of non-itemized: 0.00 0.00 0.00",
    ]
    parsed = read(
        [
            "Schedule A1-IND     Contributions",
            *pair,
            "Schedule A1-IND     Contributions",
            *pair,
        ]
    )
    result, errors = documents.stated_contributions(
        parsed,
        Kind.candidate_committee,
        {"individuals_contributions": Decimal("100")},
    )
    assert result is None
    assert any("more than once" in error for error in errors)


@pytest.mark.parametrize("heading", ["A1-UNKNOWN", "A1-IND"])
def test_unknown_or_missing_totals_cannot_pass_as_zero(heading: str) -> None:
    parsed = read(
        [
            f"Schedule {heading}     Contributions",
            "Total of itemized: 100.00 0.00 100.00",
        ]
    )
    result, errors = documents.stated_contributions(
        parsed,
        Kind.candidate_committee,
        {"individuals_contributions": Decimal("100")},
    )
    assert errors == []
    assert result is not None and result.self_test == documents.SelfTest.failed


def test_negative_cash_is_kept_signed_and_still_tested_against_the_source() -> None:
    parsed = read(
        [
            "Schedule A1-IND     Contributions",
            "Total of itemized: (100.00) 0.00 (100.00)",
            "Total of non-itemized: 0.00 0.00 0.00",
        ]
    )
    result, _ = documents.stated_contributions(
        parsed,
        Kind.candidate_committee,
        {"individuals_contributions": Decimal("100")},
    )
    assert result is not None and result.itemized_cash == Decimal("-100")
    assert result.self_test == documents.SelfTest.failed


def test_legacy_column_shift_is_refused_even_when_cash_matches_the_route() -> None:
    parsed = read(
        [
            "Schedule A1-IND     Contributions",
            "Total of itemized: 100.00 25.00 999.00",
            "Total of non-itemized: 0.00 0.00 0.00",
        ]
    )
    result, errors = documents.stated_contributions(
        parsed, Kind.candidate_committee, {"individuals_contributions": Decimal("100")}
    )
    assert result is None
    assert any("does not add up" in error for error in errors)


def test_readable_legacy_totals_without_proving_figures_are_not_a_pass() -> None:
    parsed = documents.parse_report_document(legacy_pdf())
    result, errors = documents.stated_contributions(
        parsed, Kind.candidate_committee, {}
    )
    assert errors == []
    assert result is not None
    assert result.self_test == documents.SelfTest.not_available


def test_layout_extraction_failure_is_unreadable_not_an_exception(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from pypdf._page import PageObject

    original = PageObject.extract_text

    def fail_layout(self, *args, **kwargs):
        if kwargs.get("extraction_mode") == "layout":
            raise ValueError("unreadable layout")
        return original(self, *args, **kwargs)

    monkeypatch.setattr(PageObject, "extract_text", fail_layout)
    parsed = documents.parse_report_document(legacy_pdf())
    assert parsed.schedules == {}
    assert parsed.errors
