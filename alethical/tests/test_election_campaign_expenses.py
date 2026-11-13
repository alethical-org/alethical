"""Pure parser checks; original filed people and documents stay in private probes."""

import hashlib

import pytest

from alethical.pipeline import election_campaign_expenses as e

BODY = b"%PDF-test-fixture"
HEADER = "Date            Specific purpose of expenditure                      Paid     Unpaid    In Kind      Total"
TOTAL_HEADER = "                                                                     Paid     Unpaid    In Kind      Total"


def transaction(
    day="02/03/2026",
    purpose="Printing: signs",
    amounts=("10.00", "0.00", "0.00", "10.00"),
):
    return f"{day}      {purpose}    " + "    ".join(amounts)


def totals(itemized=("10.00", "0.00", "0.00", "10.00"), non=("0.00",) * 4):
    from decimal import Decimal

    total = tuple(format(Decimal(a) + Decimal(b), ".2f") for a, b in zip(itemized, non))
    return "\n".join(
        [
            TOTAL_HEADER,
            "   Total of itemized    " + "    ".join(itemized),
            "   Total of non-itemized    " + "    ".join(non),
            TOTAL_HEADER,
            "   Totals    " + "    ".join(total),
        ]
    )


def read(
    monkeypatch,
    detail=None,
    *,
    amounts=("10.00", "0.00", "0.00", "10.00"),
    pages=None,
    **kwargs,
):
    cover = "Period Covered: 01/01/2026 through 10/19/2026"
    summary = (
        "  B  Disbursements    Cash    Unpaid Bills    In-kind    Total\n 11 Campaign expenditures  Sch. B1 - CE    "
        + "    ".join(amounts)
    )
    if pages is None:
        pages = [
            "   Schedule B1 - CE   Campaign Expenditures\n                    Example Candidate Committee\n"
            + (
                detail
                if detail is not None
                else "Example Print\n      Sample City, MN 55101\n"
                + HEADER
                + "\n"
                + transaction()
                + "\n"
                + totals()
            )
        ]
    monkeypatch.setattr(e, "_pdf_pages", lambda body: iter([cover, summary, *pages]))
    return e.extract_campaign_expenses(
        BODY,
        period_start=kwargs.pop("period_start", "2026-01-01"),
        period_end="2026-10-19",
        **kwargs,
    )


def test_checked_rows_keep_source_date_money_and_missing_street(monkeypatch):
    value = read(monkeypatch)
    assert value["status"] == "checked"
    row = value["rows"][0]
    assert row["payee"]["name"] == "Example Print"
    assert row["payee"]["address"]["street"] is None
    assert row["payee"]["address"]["city"] == "Sample City"
    assert row["date"] == "2026-02-03"
    assert row["amounts"]["paid"] == "10.00"
    assert row["source"][0]["text"] == transaction()
    assert row["source"][0]["page"] == 3
    assert row["source"][0]["source_sha256"] == hashlib.sha256(BODY).hexdigest()
    assert "payee_street_not_filed" in row["uncertainties"]


def test_checked_zero_from_exact_pdf_summary_only(monkeypatch):
    value = read(monkeypatch, amounts=("0.00",) * 4, pages=[])
    assert value["status"] == "checked" and value["rows"] == []
    assert value["itemized_totals"] == dict.fromkeys(e._COLUMNS, "0.00")
    assert value["gaps"] == ["schedule_absent_explicit_zero_summary"]


def test_missing_schedule_is_not_zero(monkeypatch):
    value = read(monkeypatch, pages=[])
    assert value["status"] == "unavailable"
    assert "campaign_expense_schedule_missing" in value["errors"]


def test_missing_address_is_retained_without_inference(monkeypatch):
    value = read(
        monkeypatch, "Example Print\n" + HEADER + "\n" + transaction() + "\n" + totals()
    )
    assert value["status"] == "checked"
    assert value["rows"][0]["payee"]["address"]["lines"] == []
    assert "payee_address_missing" in value["rows"][0]["uncertainties"]


def test_duplicate_same_value_rows_remain_distinct(monkeypatch):
    amounts = ("20.00", "0.00", "0.00", "20.00")
    value = read(
        monkeypatch,
        "Example Print\n      Sample City, MN 55101\n"
        + HEADER
        + "\n"
        + transaction()
        + "\n"
        + transaction()
        + "\n"
        + totals(amounts),
        amounts=amounts,
    )
    assert value["status"] == "checked"
    assert len(value["rows"]) == 2
    assert len({r["source_row_id"] for r in value["rows"]}) == 2


@pytest.mark.parametrize(
    "prefix,relationship",
    [("Reimbursement:", "reimbursement"), ("Credit card:", "credit_card")],
)
def test_grouped_payee_and_each_underlying_vendor_stay_separate(
    monkeypatch, prefix, relationship
):
    amounts = ("20.00", "0.00", "0.00", "20.00")
    detail = (
        f"{prefix} Example Person\n      Sample City, MN 55101\nVendor: First Print\n      First City, WI 53001\n"
        + HEADER
        + "\n"
        + transaction()
        + "\nVendor: Second Print\n      Second City, IA 50001\n"
        + HEADER
        + "\n"
        + transaction()
        + "\n   Total reimbursement for Example Person    20.00    0.00    0.00    20.00\n"
        + totals(amounts)
    )
    value = read(monkeypatch, detail, amounts=amounts)
    assert value["status"] == "checked", value["errors"]
    assert {r["payee"]["name"] for r in value["rows"]} == {"Example Person"}
    assert [r["underlying_vendor"]["name"] for r in value["rows"]] == [
        "First Print",
        "Second Print",
    ]
    assert {r["relationship"] for r in value["rows"]} == {relationship}


def test_wrapped_purpose_that_starts_with_date_is_not_new_payment(monkeypatch):
    detail = (
        "Example Print\n      Sample City, MN 55101\n"
        + HEADER
        + "\n"
        + transaction()
        + "\n                01/01/2026-02/01/2026 work\n"
        + totals()
    )
    value = read(monkeypatch, detail)
    assert value["status"] == "checked", value["errors"]
    assert value["rows"][0]["purpose"].endswith("01/01/2026-02/01/2026 work")


def test_continuation_page_repeats_explicit_payee(monkeypatch):
    title = "   Schedule B1 - CE   Campaign Expenditures\n                    Example Candidate Committee\n"
    amounts = ("20.00", "0.00", "0.00", "20.00")
    pages = [
        title
        + "Example Print\n      Sample City, MN 55101\n"
        + HEADER
        + "\n"
        + transaction()
        + "\nReporter    XSD Version: 2.6    Printed 10/19/2026\n   Page 3",
        "Example Print\n      Sample City, MN 55101\n"
        + HEADER
        + "\n"
        + transaction()
        + "\n"
        + totals(amounts),
    ]
    value = read(monkeypatch, pages=pages, amounts=amounts)
    assert value["status"] == "checked", value["errors"]
    assert [r["source"][0]["page"] for r in value["rows"]] == [3, 4]


def test_negative_unpaid_and_in_kind_columns_remain_separate(monkeypatch):
    amounts = ("-10.00", "25.00", "3.00", "18.00")
    value = read(
        monkeypatch,
        "Example Print\n      Sample City, MN 55101\n"
        + HEADER
        + "\n"
        + transaction(amounts=amounts)
        + "\n"
        + totals(amounts),
        amounts=amounts,
    )
    assert value["status"] == "checked"
    assert value["rows"][0]["amounts"] == dict(zip(e._COLUMNS, amounts))


def test_outside_period_date_is_flagged_not_dropped(monkeypatch):
    value = read(
        monkeypatch,
        "Example Print\n      Sample City, MN 55101\n"
        + HEADER
        + "\n"
        + transaction(day="12/01/2025")
        + "\n"
        + totals(),
    )
    assert value["status"] == "checked"
    assert value["rows"][0]["date"] == "2025-12-01"
    assert "date_outside_report_period" in value["rows"][0]["uncertainties"]


@pytest.mark.parametrize(
    "changed",
    [
        lambda d: d.replace("02/03/2026", "02/30/2026"),
        lambda d: d.replace(
            "10.00    0.00    0.00    10.00", "word    0.00    0.00    10.00", 1
        ),
        lambda d: d.replace("Paid     Unpaid    In Kind", "Unpaid     Paid    In Kind"),
        lambda d: d.replace("Total of itemized    10.00", "Total of itemized    11.00"),
        lambda d: d.replace(
            "Example Print\n",
            "Example Print\n      First City, MN 55101\nDifferent Print\n",
        ),
        lambda d: d.replace(
            HEADER + "\n" + transaction(),
            HEADER + "\n" + transaction() + "\nDifferent Print\n" + transaction(),
        ),
    ],
)
def test_bad_date_money_columns_totals_or_shifted_payee_never_checked(
    monkeypatch, changed
):
    detail = (
        "Example Print\n      Sample City, MN 55101\n"
        + HEADER
        + "\n"
        + transaction()
        + "\n"
        + totals()
    )
    value = read(monkeypatch, changed(detail))
    assert value["status"] == "unavailable" and value["rows"] == []
    assert value["errors"]


def test_wrong_cover_period_withholds_rows(monkeypatch):
    value = read(monkeypatch, period_start="2026-02-01")
    assert value["status"] == "unavailable" and not value["rows"]
    assert "cover_period_mismatch" in value["errors"]
    assert value["proposals"]


def test_parent_expected_total_is_comparison_not_source(monkeypatch):
    value = read(monkeypatch, expected_totals=dict.fromkeys(e._COLUMNS, "0.00"))
    assert (
        value["status"] == "unavailable"
        and "expected_summary_mismatch:paid" in value["errors"]
    )


def test_invalid_pdf_is_unavailable():
    value = e.extract_campaign_expenses(
        b"%PDF-invalid", period_start="2026-01-01", period_end="2026-10-19"
    )
    assert value["status"] == "unavailable" and value["rows"] == []


def test_visibly_blank_payee_table_keeps_amount_without_prior_identity(monkeypatch):
    amounts = ("20.00", "0.00", "0.00", "20.00")
    detail = (
        "Example Print\n      Sample City, MN 55101\n"
        + HEADER
        + "\n"
        + transaction()
        + "\n  Total    10.00    0.00    0.00    10.00\n\n"
        + HEADER
        + "\n"
        + transaction()
        + "\n"
        + totals(amounts)
    )
    value = read(monkeypatch, detail, amounts=amounts)
    assert value["status"] == "checked", value["errors"]
    assert value["rows"][0]["payee"]["name"] == "Example Print"
    assert value["rows"][1]["payee"] is None
    assert value["rows"][1]["underlying_vendor"] is None
    assert "payee_not_filed" in value["rows"][1]["uncertainties"]
    assert value["rows"][1]["payee_header_source"]["text"] == HEADER


def test_non_itemized_money_never_gets_a_payee(monkeypatch):
    summary = ("17.00", "0.00", "0.00", "17.00")
    detail = (
        "Example Print\n      Sample City, MN 55101\n"
        + HEADER
        + "\n"
        + transaction()
        + "\n"
        + totals(non=("7.00", "0.00", "0.00", "7.00"))
    )
    value = read(monkeypatch, detail, amounts=summary)
    assert value["status"] == "checked"
    assert len(value["rows"]) == 1
    assert value["non_itemized_totals"]["paid"] == "7.00"
    assert value["rows"][0]["amounts"]["paid"] == "10.00"


@pytest.mark.parametrize(
    "locality,status",
    [("Some City, ZZ 55101", "unknown_state"), ("Somewhere, ON K1A 0B1", "unknown")],
)
def test_unknown_or_foreign_address_stays_as_filed(monkeypatch, locality, status):
    detail = (
        "Example Print\n      "
        + locality
        + "\n"
        + HEADER
        + "\n"
        + transaction()
        + "\n"
        + totals()
    )
    value = read(monkeypatch, detail)
    assert value["status"] == "checked"
    address = value["rows"][0]["payee"]["address"]
    assert address["lines"] == [locality]
    assert address["geography_status"] == status
    assert address["state"] != "MN"


def test_registered_group_total_can_omit_reprinted_name(monkeypatch):
    detail = (
        "Reimbursement: Example Committee (Registered Id: 12345)\n      Sample City, MN 55101\nVendor: Example Print\n      Sample City, MN 55101\n"
        + HEADER
        + "\n"
        + transaction()
        + "\n  Total reimbursement for    10.00    0.00    0.00    10.00\n"
        + totals()
    )
    value = read(monkeypatch, detail)
    assert value["status"] == "checked", value["errors"]
    assert (
        value["rows"][0]["payee"]["name"] == "Example Committee (Registered Id: 12345)"
    )
    assert (
        value["source_totals_locators"]["groups"][0]["label"]
        == "Total reimbursement for"
    )


def test_blank_header_on_next_page_never_inherits_previous_payee(monkeypatch):
    title = "   Schedule B1 - CE   Campaign Expenditures\n                    Example Candidate Committee\n"
    amounts = ("20.00", "0.00", "0.00", "20.00")
    pages = [
        title
        + "Example Print\n      Sample City, MN 55101\n"
        + HEADER
        + "\n"
        + transaction(),
        HEADER + "\n" + transaction() + "\n" + totals(amounts),
    ]
    value = read(monkeypatch, pages=pages, amounts=amounts)
    assert value["status"] == "checked", value["errors"]
    assert value["rows"][1]["payee"] is None
    assert "payee_not_filed" in value["rows"][1]["uncertainties"]


def test_real_pdf_bytes_are_read_without_text_fixture(monkeypatch):
    import io
    from pypdf import PdfWriter
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

    captured = []
    read(monkeypatch)
    # Construct a small actual PDF, including its fonts/text geometry. This tests
    # the source-byte entry point, independently of the mock text unit fixtures.
    captured.extend(e._pdf_pages(BODY))
    monkeypatch.undo()
    writer = PdfWriter()
    for text in captured:
        page = writer.add_blank_page(width=1200, height=800)
        font = DictionaryObject(
            {
                NameObject("/Type"): NameObject("/Font"),
                NameObject("/Subtype"): NameObject("/Type1"),
                NameObject("/BaseFont"): NameObject("/Courier"),
            }
        )
        page[NameObject("/Resources")] = DictionaryObject(
            {
                NameObject("/Font"): DictionaryObject(
                    {NameObject("/F1"): writer._add_object(font)}
                )
            }
        )
        stream = DecodedStreamObject()
        commands = ["BT /F1 8 Tf 12 TL 20 760 Td"]
        for line in text.splitlines():
            escaped = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
            commands.extend([f"({escaped}) Tj", "T*"])
        commands.append("ET")
        stream.set_data("\n".join(commands).encode())
        page[NameObject("/Contents")] = writer._add_object(stream)
    output = io.BytesIO()
    writer.write(output)
    value = e.extract_campaign_expenses(
        output.getvalue(), period_start="2026-01-01", period_end="2026-10-19"
    )
    assert value["status"] == "checked", value["errors"]
    assert value["rows"][0]["payee"]["name"] == "Example Print"
    assert value["source_sha256"] == hashlib.sha256(output.getvalue()).hexdigest()


def test_wrapped_name_and_purpose_across_page_keep_original_text(monkeypatch):
    title = "   Schedule B1 - CE   Campaign Expenditures\n                    Example Candidate Committee\n"
    pages = [
        title
        + "Example Print and\nCopy Services\n      Sample City, MN 55101\n"
        + HEADER
        + "\n"
        + transaction()
        + "\nReporter    XSD Version: 2.6    Printed 10/19/2026\nPage 3",
        "                continued purpose on next page\n" + totals(),
    ]
    value = read(monkeypatch, pages=pages)
    assert value["status"] == "checked", value["errors"]
    row = value["rows"][0]
    assert row["payee"]["name"] == "Example Print and\nCopy Services"
    assert row["purpose"] == "Printing: signs\ncontinued purpose on next page"
    assert [part["page"] for part in row["source"]] == [3, 4]


def test_balanced_total_cannot_mask_swapped_payment_columns(monkeypatch):
    detail = (
        "Example Print\n      Sample City, MN 55101\n"
        + HEADER
        + "\n"
        + transaction(amounts=("0.00", "10.00", "0.00", "10.00"))
        + "\n"
        + totals()
    )
    value = read(monkeypatch, detail)
    assert value["status"] == "unavailable" and value["rows"] == []
    assert "itemized_rows_mismatch:paid" in value["errors"]
    assert "itemized_rows_mismatch:unpaid" in value["errors"]


def test_parent_totals_cannot_rescue_unreadable_pdf_summary(monkeypatch):
    value = read(
        monkeypatch,
        amounts=("word", "0.00", "0.00", "10.00"),
        expected_totals=dict(zip(e._COLUMNS, ("10.00", "0.00", "0.00", "10.00"))),
    )
    assert value["status"] == "unavailable"
    assert value["rows"] == []
    assert "unreadable_summary_columns" in value["errors"]


@pytest.mark.parametrize(
    "locality,city,state,postal_code",
    [
        ("Minneapolis, MN 55414 2500", "Minneapolis", "MN", "55414-2500"),
        ("Saint Paul, MN 55101 0800", "Saint Paul", "MN", "55101-0800"),
        ("Amsterdam, NY 12010,", "Amsterdam", "NY", "12010"),
        ("Seattle, WA 98109,", "Seattle", "WA", "98109"),
    ],
)
def test_filed_address_spacing_and_terminal_comma_keep_source_and_payment(
    monkeypatch, locality, city, state, postal_code
):
    # Exact locality patterns from the retained reports; no vendor lookup.
    value = read(
        monkeypatch,
        "Example Print\n      "
        + locality
        + "\n"
        + HEADER
        + "\n"
        + transaction()
        + "\n"
        + totals(),
    )
    assert value["status"] == "checked", value["errors"]
    row = value["rows"][0]
    assert row["payee"]["address"] == {
        "lines": [locality],
        "street": None,
        "city": city,
        "state": state,
        "postal_code": postal_code,
        "geography_status": "filed_us",
    }
    assert row["payee"]["name"] == "Example Print"
    assert row["payee"]["source"][1]["text"] == "      " + locality
    assert (
        row["payee"]["source"][1]["source_sha256"] == hashlib.sha256(BODY).hexdigest()
    )
    assert row["amounts"] == dict(zip(e._COLUMNS, ("10.00", "0.00", "0.00", "10.00")))
    assert row["date"] == "2026-02-03"
    assert row["source"][0]["text"] == transaction()
    assert row["underlying_vendor"] is None
    assert "payee_geography_unknown_or_foreign" not in row["uncertainties"]


@pytest.mark.parametrize(
    "locality",
    [
        "Preston, MN 5965",
        "London, MN EC2A 3JF",
        "Seattle, WA Seattle",
        "Ashland, WI 7158587330",
        "SAINT PAUL, MN 55105-",
        "Belderville, WI 54003q",
        "Brooklyn Park, MN 5545",
        "Seattle, WA 98109,,",
        "Seattle, WA 98109 extra",
        "Seattle, WA 98109 1234,",
        "Seattle, WA 98109-1234,",
        "Seattle, WA 981091234,",
        "Seattle, WA 98109  1234",
        "Seattle, WA 98109\t1234",
        "Seattle, WA 98109\u00a01234",
        "Seattle, WA 98109 123",
        "Seattle, WA 98109 12345",
        "Seattle, WA 98109, extra",
        "Seattle, WA 98109 ,",
        "Seattle, wa 98109 1234",
        "Seattle, XX 98109 1234",
        "Seattle, wa 98109,",
        "Seattle, XX 98109,",
        "Seattle, WA",
        "WA",
        "",
    ],
)
def test_other_unrecognised_filed_addresses_stay_unknown(locality):
    assert e._address([locality]) == {
        "lines": [locality],
        "street": None,
        "city": None,
        "state": None,
        "postal_code": None,
        "geography_status": "unknown",
    }


@pytest.mark.parametrize(
    "locality,postal_code,status",
    [
        ("Sample City, MN 55101", "55101", "filed_us"),
        ("Sample City, MN 551011234", "551011234", "filed_us"),
        ("Sample City, MN 55101-1234", "55101-1234", "filed_us"),
        ("Sample City, mn 55101", "55101", "unknown_state"),
        ("Sample City, XX 55101", "55101", "unknown_state"),
    ],
)
@pytest.mark.parametrize("version", [1, 2])
def test_existing_address_grammar_keeps_exact_lines_and_state_case(
    locality, postal_code, status, version
):
    lines = ["123 Filed Street", locality]
    result = e._address(lines, address_format_version=version)
    assert result["lines"] == lines
    assert result["street"] == "123 Filed Street"
    assert result["city"] == "Sample City"
    assert result["state"] == locality.split(", ")[1].split()[0]
    assert result["postal_code"] == postal_code
    assert result["geography_status"] == status
    assert e._address([])["geography_status"] == "missing"


@pytest.mark.parametrize(
    "locality",
    [
        "Minneapolis, MN 55414 2500",
        "Saint Paul, MN 55101 0800",
        "Amsterdam, NY 12010,",
        "Seattle, WA 98109,",
    ],
)
def test_legacy_address_version_keeps_original_unknown_rows(monkeypatch, locality):
    detail = (
        "Example Print\n      "
        + locality
        + "\n"
        + HEADER
        + "\n"
        + transaction()
        + "\n"
        + totals()
    )
    legacy = read(monkeypatch, detail, address_format_version=1)
    current = read(monkeypatch, detail, address_format_version=2)
    assert legacy["status"] == current["status"] == "checked"
    assert legacy["schema_version"] == current["schema_version"] == 1
    old, new = legacy["rows"][0], current["rows"][0]
    assert old["payee"]["address"] == {
        "lines": [locality],
        "street": None,
        "city": None,
        "state": None,
        "postal_code": None,
        "geography_status": "unknown",
    }
    assert "payee_geography_unknown_or_foreign" in old["uncertainties"]
    assert new["payee"]["address"]["geography_status"] == "filed_us"
    # Only parsed geography and its uncertainty flag may change.
    new["payee"]["address"] = old["payee"]["address"]
    new["uncertainties"] = old["uncertainties"]
    assert legacy == current


@pytest.mark.parametrize("version", [None, 0, 3, "1", "2", True, 1.0, 2.0])
def test_unsupported_address_version_never_reads_or_checks_pdf(monkeypatch, version):
    def forbidden(body):
        raise AssertionError("Unsupported version must not read the PDF")

    monkeypatch.setattr(e, "_pdf_pages", forbidden)
    result = e.extract_campaign_expenses(
        BODY,
        period_start="2026-01-01",
        period_end="2026-10-19",
        address_format_version=version,
    )
    assert result["schema_version"] == 1
    assert result["status"] == "unavailable"
    assert result["errors"] == ["unsupported_address_format_version"]
    assert result["rows"] == result["proposals"] == []


@pytest.mark.parametrize("prefix", ["Reimbursement:", "Credit card:"])
@pytest.mark.parametrize("version,status", [(1, "unknown"), (2, "filed_us")])
def test_address_version_reaches_grouped_payee_and_underlying_vendor(
    monkeypatch, prefix, version, status
):
    detail = (
        f"{prefix} Example Person\n      Saint Paul, MN 55101 0800\n"
        "Vendor: Example Print\n      Seattle, WA 98109,\n"
        + HEADER
        + "\n"
        + transaction()
        + "\n   Total reimbursement for Example Person    10.00    0.00    0.00    10.00\n"
        + totals()
    )
    result = read(monkeypatch, detail, address_format_version=version)
    assert result["status"] == "checked", result["errors"]
    row = result["rows"][0]
    assert row["payee"]["name"] == "Example Person"
    assert row["underlying_vendor"]["name"] == "Example Print"
    assert row["relationship"] == (
        "reimbursement" if prefix == "Reimbursement:" else "credit_card"
    )
    assert row["payee"]["address"]["geography_status"] == status
    assert row["underlying_vendor"]["address"]["geography_status"] == status
    assert row["payee"]["address"]["lines"] == ["Saint Paul, MN 55101 0800"]
    assert row["underlying_vendor"]["address"]["lines"] == ["Seattle, WA 98109,"]
