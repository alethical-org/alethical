"""Donor evidence is all-or-nothing and does not infer an identity from a name."""

import hashlib
import io
from datetime import date
from decimal import Decimal
from unittest.mock import patch

from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

import pytest

from alethical.pipeline.lobbyist_report_evidence import (
    ReportEvidenceError,
    parse_lobbyist_report_evidence,
)

SUMMARY = """Committee Transaction Summary
A Receipts Cash Blank In-kind Total
2 Total Contributions Received Sch. A1 - CR 1,395.00 110.00 1,505.00
B Disbursements Cash Unpaid Bills In-kind Total
"""
CANDIDATE_SUMMARY = """Committee Transaction Summary
A Receipts Cash Blank In-kind Total
2 Individual Contributions Sch. A1 - IND 0.00 0.00 0.00
3 Lobbyist Contributions Sch. A1 - LOB 500.00 0.00 500.00
4 Political committee contributions Sch. A1 - PCF 0.00 0.00 0.00
  Political party and terminating Sch. A1 - PTY/
5 principal campaign committee TERM PCC 0.00 0.00 0.00
6 Other contributions Sch. A1 - OTH 0.00 0.00 0.00
7 Public Subsidy Payment Sch. A1 - PS 0.00 0.00
B Disbursements Cash Unpaid Bills In-kind Total
"""

# Sanitized text follows the Board's layout; no real donor address is retained.
HEADER = (
    """Report of Receipts and Expenditures
Period Covered: 01/01/2025 through 12/31/2025
Registration Number: 20010
Committee Name: Example Committee
"""
    + SUMMARY
    + "Page 1\n"
)
SCHEDULE = """    Schedule A1 - CR   Contributions Received
    Example Committee
Lobbyist: Example, Alex (Registered Id: 580 )
    Employment: Example employer
Date                          Cash          In kind         Total
01/15/2025                  250.00              0.00        250.00
01/15/2025                  250.00              0.00        250.00
                        Total 500.00           0.00        500.00
Lobbyist: Example, Jordan (Registered Id: 8692 )
Date                          Cash          In kind         Total
02/01/2025   Donated food      0.00            100.00        100.00
03/01/2025                  -25.00              0.00        -25.00
                         Total -25.00        100.00         75.00
Example, Jordan
    Employment: Example employer
Date                          Cash          In kind         Total
04/01/2025                  600.00              0.00        600.00
Other Campaign (Registered Id: 8692)
Date                          Cash          In kind         Total
04/02/2025                  300.00              0.00        300.00
                             Cash           In kind         Total
Total of itemized          1,375.00           100.00      1,475.00
Total of non-itemized         20.00            10.00         30.00
Totals                    1,395.00           110.00      1,505.00
Page 2
"""
PDF_BYTES = b"%PDF-sanitized-parser-test"


def parse(pages: list[str] | None = None, **kwargs):
    with patch(
        "alethical.pipeline.lobbyist_report_evidence._extract_pages",
        return_value=pages or [HEADER, SCHEDULE],
    ):
        return parse_lobbyist_report_evidence(
            PDF_BYTES,
            registration_number=kwargs.get("registration_number", "20010"),
            filing_year=kwargs.get("filing_year", 2025),
        )


def test_exact_identity_signed_amounts_and_multiplicity():
    evidence = parse()
    assert evidence.registration_number == "20010"
    assert evidence.period_start == date(2025, 1, 1)
    assert evidence.period_end == date(2025, 12, 31)
    assert evidence.document_hash == hashlib.sha256(PDF_BYTES).hexdigest()
    assert len(evidence.transactions) == 6
    assert [r.total for r in evidence.transactions] == [
        Decimal("250"),
        Decimal("250"),
        Decimal("100"),
        Decimal("-25"),
        Decimal("600"),
        Decimal("300"),
    ]
    assert [r.lobbyist_registration_number for r in evidence.transactions] == [
        "580",
        "580",
        "8692",
        "8692",
        None,
        None,
    ]
    assert evidence.transactions[0].page == 2
    assert evidence.transactions[0].line == 6
    assert evidence.schedules[0].itemized_cash == Decimal("1375")
    assert evidence.schedules[0].itemized_in_kind == Decimal("100")
    assert evidence.schedules[0].non_itemized_cash == Decimal("20")


def test_parenthesized_negative_and_cross_page_continuation():
    first, second = SCHEDULE.split("03/01/2025", 1)
    first += "Page 2\n"
    second = (
        ("03/01/2025" + second).replace("-25.00", "(25.00)").replace("Page 2", "Page 3")
    )
    evidence = parse([HEADER, first, second])
    assert evidence.transactions[3].cash == Decimal("-25")
    assert evidence.transactions[3].lobbyist_registration_number == "8692"
    assert evidence.transactions[3].page == 3


def test_lobbyist_schedule_can_identify_number_without_redundant_prefix():
    schedule = SCHEDULE[: SCHEDULE.index("Lobbyist: Example, Jordan")]
    schedule = schedule.replace("A1 - CR", "A1 - LOB").replace("Lobbyist: ", "")
    schedule += "Total of itemized 500.00 0.00 500.00\nTotal of non-itemized 0.00 0.00 0.00\nTotals 500.00 0.00 500.00\nPage 2\n"
    assert (
        parse([HEADER.replace(SUMMARY, CANDIDATE_SUMMARY), schedule])
        .transactions[0]
        .lobbyist_registration_number
        == "580"
    )


def test_non_lobbyist_same_name_and_number_are_not_lobbyist_identity():
    evidence = parse()
    assert evidence.transactions[-2].donor_name == "Example, Jordan"
    assert evidence.transactions[-2].lobbyist_registration_number is None
    assert evidence.transactions[-1].lobbyist_registration_number is None


@pytest.mark.parametrize(
    ("old", "new", "error"),
    [
        ("1,375.00", "1,374.00", "row_arithmetic_mismatch"),
        (
            "1,375.00           100.00      1,475.00",
            "1,374.00           100.00      1,474.00",
            "schedule_total_mismatch",
        ),
        (
            "Totals                    1,395.00           110.00      1,505.00",
            "Totals 1,394.00 110.00 1,504.00",
            "schedule_total_mismatch",
        ),
        (
            "01/15/2025                  250.00              0.00        250.00",
            "01/15/2025                  225.00              0.00        225.00",
            "donor_total_mismatch",
        ),
        (
            "04/01/2025                  600.00              0.00        600.00",
            "04/01/2025                  599.00              0.00        599.00",
            "itemized_schedule_mismatch",
        ),
        ("04/01/2025", "04/01/2024", "transaction_outside_report_period"),
        ("04/01/2025", "04/99/2025", "invalid_date"),
        ("04/01/2025", "April 1 2025", "unfinished_donor"),
        ("600.00", "600.OO", "unsupported_money_columns"),
        ("Registered Id: 580", "Registered Id: missing", "unsupported_donor_identity"),
        (
            "Lobbyist: Example, Alex (Registered Id: 580 )",
            "Lobbyist: Example, Alex",
            "unsupported_donor_identity",
        ),
        (
            "Example, Jordan\n    Employment:",
            "\n    Employment:",
            "unrecognized_schedule_line",
        ),
        (
            "    Employment: Example employer",
            "Unexpected second heading",
            "ambiguous_donor_boundary",
        ),
        (
            "Total of non-itemized         20.00            10.00         30.00\n",
            "",
            "unexpected_schedule_total",
        ),
        (
            "Totals                    1,395.00           110.00      1,505.00\n",
            "",
            "incomplete_schedule_totals",
        ),
        ("A1 - CR", "A1 - NEW", "unknown_contribution_schedule"),
        (
            "Schedule A1 - CR   Contributions",
            "Schedule A1 - CR Contributions",
            "unsupported_schedule_heading",
        ),
        ("Page 2", "Page 3", "missing_or_out_of_order_page"),
    ],
)
def test_corruption_is_never_partial_evidence(old, new, error):
    with pytest.raises(ReportEvidenceError, match=f"^{error}$"):
        parse([HEADER, SCHEDULE.replace(old, new)])


@pytest.mark.parametrize(
    ("header", "error"),
    [
        (HEADER.replace("20010", "20011"), "report_registration_mismatch"),
        (HEADER + "Registration Number: 20010\n", "report_registration_mismatch"),
        (HEADER.replace("2025", "2024"), "report_year_or_period_mismatch"),
        (HEADER.replace("12/31/2025", "01/01/2024"), "report_year_or_period_mismatch"),
        (
            HEADER.replace("Period Covered:", "Period:"),
            "missing_or_ambiguous_report_period",
        ),
    ],
)
def test_wrong_report_identity_or_coverage_refuses(header, error):
    with pytest.raises(ReportEvidenceError, match=f"^{error}$"):
        parse([header, SCHEDULE])


def test_special_period_metadata_is_retained_without_assuming_full_year():
    header = HEADER.replace("01/01/2025", "01/10/2025")
    assert parse([header, SCHEDULE]).period_start == date(2025, 1, 10)


def test_repeated_schedule_refuses_instead_of_deduplicating():
    with pytest.raises(ReportEvidenceError, match="^repeated_schedule$"):
        parse([HEADER, SCHEDULE, SCHEDULE.replace("Page 2", "Page 3")])


def test_no_schedule_is_not_evidence_of_zero():
    with pytest.raises(ReportEvidenceError, match="^no_contribution_schedules$"):
        parse([HEADER])


def test_bad_bytes_do_not_become_empty_evidence():
    with pytest.raises(ReportEvidenceError, match="^not_pdf$"):
        parse_lobbyist_report_evidence(
            b"not a PDF", registration_number="20010", filing_year=2025
        )
    with pytest.raises(ReportEvidenceError, match="^unreadable_pdf$"):
        parse_lobbyist_report_evidence(
            PDF_BYTES, registration_number="20010", filing_year=2025
        )


def test_pdf_bytes_are_extracted_and_bound_to_evidence():
    writer = PdfWriter()
    font = writer._add_object(
        DictionaryObject(
            {
                NameObject("/Type"): NameObject("/Font"),
                NameObject("/Subtype"): NameObject("/Type1"),
                NameObject("/BaseFont"): NameObject("/Courier"),
            }
        )
    )
    for text in (HEADER, SCHEDULE):
        page = writer.add_blank_page(width=1400, height=1000)
        page[NameObject("/Resources")] = DictionaryObject(
            {NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})}
        )
        content = ["BT /F1 10 Tf 12 TL 20 970 Td"]
        for line in text.splitlines():
            escaped = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
            content.append(f"({escaped}) Tj T*")
        content.append("ET")
        stream = DecodedStreamObject()
        stream.set_data("\n".join(content).encode())
        page[NameObject("/Contents")] = writer._add_object(stream)
    output = io.BytesIO()
    writer.write(output)
    evidence = parse_lobbyist_report_evidence(
        output.getvalue(), registration_number="20010", filing_year=2025
    )
    assert len(evidence.transactions) == 6
    assert evidence.transactions[2].in_kind == Decimal("100")
    assert evidence.document_hash == hashlib.sha256(output.getvalue()).hexdigest()


def test_missing_money_columns_is_a_deterministic_refusal():
    with pytest.raises(ReportEvidenceError, match="^unsupported_money_columns$"):
        parse(
            [
                HEADER,
                SCHEDULE.replace(
                    "04/01/2025                  600.00              0.00        600.00",
                    "04/01/2025",
                ),
            ]
        )


def test_omitted_lobbyist_schedule_cannot_hide_behind_other_valid_schedules():
    summary = CANDIDATE_SUMMARY.replace(
        "IND 0.00 0.00 0.00", "IND 1,395.00 110.00 1,505.00"
    )
    # The complete IND schedule reconciles internally, but the summary also reports
    # 500 in LOB. Omitting that entire section must invalidate the document.
    with pytest.raises(
        ReportEvidenceError, match="^missing_nonzero_contribution_schedule$"
    ):
        parse(
            [HEADER.replace(SUMMARY, summary), SCHEDULE.replace("A1 - CR", "A1 - IND")]
        )


def test_missing_summary_refuses_otherwise_valid_schedule():
    with pytest.raises(
        ReportEvidenceError, match="^missing_or_ambiguous_contribution_summary$"
    ):
        parse([HEADER.replace(SUMMARY, ""), SCHEDULE])


def test_schedule_summary_comparison_includes_nonitemized_and_in_kind():
    # Move one dollar between cash and in-kind, preserving the summary's grand
    # total and its arithmetic. Category reconciliation still must reject it.
    summary = SUMMARY.replace("1,395.00 110.00 1,505.00", "1,394.00 111.00 1,505.00")
    with pytest.raises(ReportEvidenceError, match="^contribution_summary_mismatch$"):
        parse([HEADER.replace(SUMMARY, summary), SCHEDULE])


def test_missing_summary_category_refuses_even_if_zero():
    header = HEADER.replace(
        SUMMARY,
        CANDIDATE_SUMMARY.replace(
            "6 Other contributions Sch. A1 - OTH 0.00 0.00 0.00\n", ""
        ),
    )
    with pytest.raises(ReportEvidenceError, match="^incomplete_contribution_summary$"):
        parse([header, SCHEDULE])


def test_cross_calendar_special_report_retains_real_coverage():
    header = HEADER.replace("12/31/2025", "02/11/2026")
    schedule = SCHEDULE.replace("04/02/2025", "01/15/2026")
    evidence = parse([header, schedule])
    assert evidence.period_end == date(2026, 2, 11)
    assert evidence.transactions[-1].receipt_date == date(2026, 1, 15)


def test_previous_calendar_start_is_retained_without_inventing_january_one():
    header = HEADER.replace("01/01/2025", "11/17/2024")
    evidence = parse([header, SCHEDULE])
    assert evidence.period_start == date(2024, 11, 17)


@pytest.mark.parametrize(
    "address",
    [
        "    St Paul, MN",
        "    Needham, MA 2492",
        "    San Juan 907",
        "707 W. Example   Sampletown 73030",
        "    MN",
        "    Minneapolis",
        "    Plymouth, MN 55441``",
        "    Shakopee, MN 55379 - 8207",
        "    Minneapolis, MN 55410.",
    ],
)
def test_address_format_does_not_change_identity(address):
    evidence = parse(
        [HEADER, SCHEDULE.replace("    Employment: Example employer", address, 1)]
    )
    assert evidence.transactions[0].lobbyist_registration_number == "580"


def test_employment_lobbyist_word_does_not_establish_identity():
    schedule = SCHEDULE.replace(
        "Example, Jordan\n    Employment: Example employer",
        "Example, Jordan\n    Employment: Registered Lobbyist: Reg 8692",
    )
    assert (
        parse([HEADER, schedule]).transactions[-2].lobbyist_registration_number is None
    )


def test_one_character_name_indentation_and_numbered_organization():
    schedule = SCHEDULE.replace(
        "Lobbyist: Example, Alex", " Lobbyist: Example, Alex"
    ).replace("Other Campaign (Registered Id: 8692)", "314 ACTION EXAMPLE FUND")
    evidence = parse([HEADER, schedule])
    assert evidence.transactions[0].lobbyist_registration_number == "580"
    assert evidence.transactions[-1].donor_name == "314 ACTION EXAMPLE FUND"
    assert evidence.transactions[-1].lobbyist_registration_number is None


def test_wrapped_in_kind_description_keeps_single_transaction():
    schedule = SCHEDULE.replace(
        "02/01/2025   Donated food      0.00            100.00        100.00",
        "02/01/2025   Donated food      0.00            100.00        100.00\n             and supplies",
    )
    evidence = parse([HEADER, schedule])
    assert len(evidence.transactions) == 6
    assert evidence.transactions[2].in_kind == Decimal("100")


def test_wrapped_description_cannot_swallow_unknown_money_row():
    schedule = SCHEDULE.replace(
        "02/01/2025   Donated food      0.00            100.00        100.00",
        "02/01/2025   Donated food      0.00            100.00        100.00\n                             0.00             20.00         20.00",
    )
    with pytest.raises(ReportEvidenceError, match="^unrecognized_schedule_line$"):
        parse([HEADER, schedule])
