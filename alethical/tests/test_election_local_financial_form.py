"""Native source facts only, with no authority, identity or amount approval."""

from io import BytesIO
from decimal import localcontext
import hashlib
import json

import pytest
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject

from alethical.pipeline import election_local_financial_form as r


def native_pdf(changes=None, *, second_page=False, size=(612, 792)):
    # Coordinates are the single inspected letter form's fixed fields.
    items = {
        "title": (135, 30, 12, "Campaign Financial Report"),
        "subtitle": (135, 50, 10, "All information in this report is public."),
        "information": (30, 87, 10, "Report Information"),
        "name_label": (34, 112, 10, "Name of candidate or committee"),
        "office_label": (34, 135, 10, "Office sought"),
        "name": (201, 111, 10, "Synthetic Candidate"),
        "office": (100, 133, 10, "Synthetic School Board"),
        "period": (395, 184, 10, "From 08/29/26 to 10/19/26"),
        "contributions_label": (30, 214, 12, "Contributions Received"),
        "during_label": (40, 307, 10, "DURING REPORTING PERIOD"),
        "monetary_label": (40, 325, 10, "MONETARY CONTRIBUTIONS"),
        "inkind_label": (40, 342, 10, "IN-KIND CONTRIBUTIONS VALUE"),
        "received_label": (40, 359, 10, "TOTAL AMOUNT RECEIVED"),
        "onhand_label": (310, 325, 10, "CURRENT TOTAL AMOUNT ON HAND"),
        "monetary": (260, 324, 10, "1482.11"),
        "inkind": (260, 341, 10, "0"),
        "received": (260, 358, 10, "1482.11"),
        "onhand": (534, 324, 10, "1437.04"),
        "disbursements_label": (30, 391, 12, "Disbursements"),
        "date_label": (40, 439, 10, "Date"),
        "purpose_label": (120, 439, 10, "Purpose"),
        "amount_label": (480, 439, 10, "Amount"),
        "row1_date": (44, 459, 10, "9/4/26"),
        "row1_purpose": (123, 459, 10, "Campaign Signs"),
        "row1_amount": (484, 459, 10, "$536.46"),
        "row2_date": (44, 480, 10, "9/4/26"),
        "row2_purpose": (123, 480, 10, "Campaign Literature"),
        "row2_amount": (484, 480, 10, "$179.84"),
        "row3_date": (44, 501, 10, "9/22/26"),
        "row3_purpose": (123, 501, 10, "Shared Literature Cost"),
        "row3_amount": (484, 501, 10, "$198.16"),
        "total_label": (237, 632, 12, "Total"),
        "disbursements": (484, 633, 10, "1101.75"),
        "private_footer": (50, 720, 10, "Private address phone signature not a payee"),
    }
    for key, value in (changes or {}).items():
        if value is None:
            items.pop(key, None)
        elif isinstance(value, tuple):
            items[key] = value
        else:
            items[key] = (*items[key][:3], value)
    writer = PdfWriter()
    page = writer.add_blank_page(width=size[0], height=size[1])
    page[NameObject("/Resources")] = DictionaryObject(
        {
            NameObject("/Font"): DictionaryObject(
                {
                    NameObject("/F1"): DictionaryObject(
                        {
                            NameObject("/Type"): NameObject("/Font"),
                            NameObject("/Subtype"): NameObject("/Type1"),
                            NameObject("/BaseFont"): NameObject("/Helvetica"),
                        }
                    ),
                }
            ),
        }
    )
    commands = []
    for x, y, font, text in items.values():
        escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        commands.append(
            f"BT /F1 {font} Tf 1 0 0 1 {x} {size[1] - y} Tm ({escaped}) Tj ET"
        )
    stream = DecodedStreamObject()
    stream.set_data("\n".join(commands).encode("ascii"))
    page[NameObject("/Contents")] = writer._add_object(stream)
    if second_page:
        writer.add_blank_page(width=612, height=792)
    out = BytesIO()
    writer.write(out)
    return out.getvalue()


def no_rows():
    return {
        f"row{n}_{field}": None
        for n in (1, 2, 3)
        for field in ("date", "purpose", "amount")
    }


def test_native_source_facts_preserve_unresolved_difference_and_no_identity_inference():
    body = native_pdf()
    result = r.read_native_local_report(body)
    assert result["source_sha256"] == hashlib.sha256(body).hexdigest()
    assert (
        result["period_start"] == "2026-08-29" and result["period_end"] == "2026-10-19"
    )
    assert result["figures"]["monetary_contributions"]["amount"] == "1482.11"
    assert result["figures"]["in_kind_contributions"]["amount"] == "0.00"
    assert result["listed_disbursement_total"] == "914.46"
    assert result["listed_minus_reported"] == "-187.29"
    assert result["listed_disbursements_reconcile"] is False
    assert result["receipts_reconcile"] is True
    assert all(
        row["payee"] is None and row["payee_address"] is None
        for row in result["listed_disbursements"]
    )
    assert result["report_kind"] is None and result["reporting_kind"] is None
    assert not result["identity_or_authority_approved"]
    assert "Private address" not in json.dumps(result)


def test_blank_table_is_not_a_fabricated_zero_subtotal():
    result = r.read_native_local_report(native_pdf(no_rows() | {"disbursements": None}))
    assert result["listed_disbursements"] == []
    assert result["listed_disbursement_total"] is None
    assert (
        result["listed_minus_reported"] is None
        and result["listed_disbursements_reconcile"] is None
    )


def test_scalar_fields_are_one_unambiguous_line():
    with pytest.raises(r.LocalFinancialFormError):
        r.read_native_local_report(
            native_pdf({"extra_name": (201, 105, 5, "Another Candidate")})
        )


def test_amount_shifted_into_value_gutter_is_refused_instead_of_claimed_blank():
    with pytest.raises(r.LocalFinancialFormError):
        r.read_native_local_report(native_pdf({"monetary": (232, 324, 4, "10.00")}))


def test_decimal_arithmetic_does_not_follow_a_callers_low_precision():
    with localcontext() as ctx:
        ctx.prec = 3
        result = r.read_native_local_report(native_pdf())
    assert (
        result["listed_disbursement_total"] == "914.46"
        and result["listed_minus_reported"] == "-187.29"
    )
    assert result["receipts_reconcile"] is True


@pytest.mark.parametrize(
    "changes",
    [
        {"title": "Certification of Filing"},
        {"name": None},
        {"office": None},
        {"period": None},
        {"period": "From 10/19/26 to 08/29/26"},
        {"period": "From 02/30/26 to 10/19/26"},
        {"period": "From 8/29 to 10/19"},
        {"period": "From 8/29/24 to 10/19/26"},
        {"period": "From 8/29/26 to 10/19/26 extra"},
        {"row1_date": "8/28/26"},
        {"row1_date": "10/20/26"},
        {"row1_date": None},
        {"row1_purpose": None},
        {"row1_amount": None},
        {"row1_amount": "1.00 2.00"},
        {"monetary": "1,00.00"},
        {"monetary": "-10.00"},
        {"monetary": "$"},
        {"monetary": (300, 324, 10, "1482.11")},
        {"row1_amount": (460, 459, 10, "536.46")},
        {"row1_date": (44, 466, 10, "9/4/26")},
    ],
)
def test_missing_shifted_ambiguous_or_wrong_period_fields_fail_closed(changes):
    with pytest.raises(r.LocalFinancialFormError):
        r.read_native_local_report(native_pdf(changes))


@pytest.mark.parametrize(
    "field", ["monetary", "inkind", "received", "onhand", "disbursements"]
)
def test_blank_summary_field_is_missing_while_literal_zero_stays_zero(field):
    measure = {
        "monetary": "monetary_contributions",
        "inkind": "in_kind_contributions",
        "received": "total_received",
        "onhand": "amount_on_hand",
        "disbursements": "disbursements",
    }[field]
    assert (
        r.read_native_local_report(native_pdf({field: None}))["figures"][measure][
            "amount"
        ]
        is None
    )
    assert (
        r.read_native_local_report(native_pdf({field: "0"}))["figures"][measure][
            "amount"
        ]
        == "0.00"
    )


def test_receipts_and_first_page_rows_have_distinct_reconciliation_gaps():
    result = r.read_native_local_report(native_pdf({"received": "1482.12"}))
    assert result["receipts_reconcile"] is False
    assert "receipt_totals_do_not_reconcile" in result["gaps"]
    assert "first_page_rows_do_not_sum_to_printed_disbursements" in result["gaps"]


def test_first_page_only_does_not_establish_attachment_coverage():
    result = r.read_native_local_report(native_pdf(second_page=True))
    assert result["source_page"] == 1 and result["attachment_coverage"] == "not_checked"
    assert result["listed_minus_reported"] == "-187.29"


@pytest.mark.parametrize(
    "body", [b"", b"not PDF", b"%PDF-broken", b"%PDF-" + b"x" * (r.MAX_BYTES)]
)
def test_bad_or_oversized_pdf_is_refused(body):
    with pytest.raises(r.LocalFinancialFormError):
        r.read_native_local_report(body)


def test_wrong_page_geometry_and_scan_without_native_fields_are_refused():
    with pytest.raises(r.LocalFinancialFormError):
        r.read_native_local_report(native_pdf(size=(600, 800)))
    out = BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    writer.write(out)
    with pytest.raises(r.LocalFinancialFormError):
        r.read_native_local_report(out.getvalue())


def test_reader_reuses_bounded_native_processing_and_refuses_native_failure(
    monkeypatch,
):
    def fail(_body):
        raise r.FecPaperIdentityError("native process output or time bound")

    monkeypatch.setattr(r, "_native_words", fail)
    with pytest.raises(r.LocalFinancialFormError, match="Unsupported or unreadable"):
        r.read_native_local_report(b"%PDF-synthetic")


def test_explicit_zero_row_and_total_remain_distinct_from_blank_rows():
    changes = no_rows() | {
        "row1_date": (44, 459, 10, "9/4/26"),
        "row1_purpose": (123, 459, 10, "Explicit zero entry"),
        "row1_amount": (484, 459, 10, "0"),
        "disbursements": "0",
    }
    result = r.read_native_local_report(native_pdf(changes))
    assert result["listed_disbursement_total"] == "0.00"
    assert (
        result["listed_minus_reported"] == "0.00"
        and result["listed_disbursements_reconcile"] is True
    )
    assert not result["financial_figures_approved"]
    blank = r.read_native_local_report(native_pdf(no_rows() | {"disbursements": "0"}))
    assert blank["figures"]["disbursements"]["amount"] == "0.00"
    assert (
        blank["listed_disbursement_total"] is None
        and blank["listed_disbursements_reconcile"] is None
    )


def test_literal_dollar_and_grouping_format_keeps_exact_amount():
    result = r.read_native_local_report(
        native_pdf({"monetary": (260, 324, 8, "$1,482.11")})
    )
    assert result["figures"]["monetary_contributions"]["amount"] == "1482.11"
    assert result["figures"]["monetary_contributions"]["source"]["text"] == "$1,482.11"


def test_unbounded_numeric_token_and_overlapping_identity_are_refused():
    with pytest.raises(r.LocalFinancialFormError):
        r.read_native_local_report(native_pdf({"monetary": (260, 324, 0.1, "1" * 65)}))
    with pytest.raises(r.LocalFinancialFormError):
        r.read_native_local_report(
            native_pdf({"extra_name": (201, 111, 10, "Second Name")})
        )


def test_caller_cannot_mutate_cached_native_evidence_or_register_an_adapter():
    from alethical.pipeline import election_external_finance as storage

    before = dict(storage.ADAPTERS)
    body = native_pdf()
    first = r.read_native_local_report(body)
    first["identity_sources"]["name"]["words"][0]["text"] = "Changed"
    first["listed_disbursements"][0]["source"]["amount"]["words"].clear()
    second = r.read_native_local_report(body)
    assert second["name"] == "Synthetic Candidate"
    assert second["listed_disbursements"][0]["source"]["amount"]["words"]
    assert storage.ADAPTERS == before
    assert "authority" not in second and "candidate_id" not in second


@pytest.mark.parametrize("year", ["0025", "0026"])
@pytest.mark.parametrize("field", ["period", "row1_date"])
def test_four_digit_source_year_is_not_expanded_as_a_two_digit_year(year, field):
    value = f"From 08/29/{year} to 10/19/2026" if field == "period" else f"9/4/{year}"
    changes = {"period": "From 08/29/2025 to 10/19/2026", field: value}
    with pytest.raises(r.LocalFinancialFormError, match="outside the supported"):
        r.read_native_local_report(native_pdf(changes))


def test_two_digit_and_four_digit_dates_keep_their_actual_source_year():
    changes = {"period": "From 08/29/2025 to 10/19/2026", "row1_date": "9/4/25"}
    result = r.read_native_local_report(native_pdf(changes))
    assert (
        result["period_start"] == "2025-08-29"
        and result["listed_disbursements"][0]["date"] == "2025-09-04"
    )
