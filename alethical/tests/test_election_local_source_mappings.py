"""Checked certificate cells and shared physical headings; synthetic PDFs only.

The five item values mirror retained Itasca document13142 for a regression of
its one/three/one row shape. These test PDFs are not official-source evidence.
"""

# ruff: noqa: F811, F401
from copy import deepcopy
from io import BytesIO
import json

import pytest
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject

from alethical.db import models as m
from alethical.pipeline import election_local_context as c
from alethical.pipeline import election_local_sources as local
from alethical.pipeline import election_source_readings as r
from alethical.pipeline.election_comparison import ComparisonImportError
from alethical.tests.test_election_comparison_storage import db, MemoryStore
from alethical.tests.test_election_reading_provenance_integration import (
    provenance_chain,
)


def packet(
    *,
    certificate=False,
    date_state="value",
    payee_state="value",
    row_date=None,
    row_payee=None,
    group_day=None,
    no_group_payee=False,
):
    fields = []

    def cell(
        fid,
        y,
        literal,
        kind="text",
        *,
        record="cover",
        row=None,
        state="value",
        x=30,
        right=420,
        label=None,
    ):
        fields.append(
            r.field_proposal(
                fid,
                page=1,
                bounds=[x, y, right, y + 14],
                label=label or fid,
                literal=literal,
                value_type=kind,
                state=state,
                record_type=record,
                row=row,
                currency="USD" if kind == "money" else None,
            )
        )

    record = "certification" if certificate else "cover"
    cell(
        "cover.name",
        30,
        "Synthetic Source Name",
        record=record,
        label="Name of candidate or committee",
    )
    cell(
        "cover.office",
        52,
        "County Attorney",
        record=record,
        label="Office sought by candidate (if applicable)"
        if certificate
        else "Office sought",
    )
    mapping = dict(
        name="cover.name",
        office="cover.office",
        candidate_name=None,
        candidate_mark=None,
        period_start=None,
        period_end=None,
        report_type=[],
    )
    groups = []
    if certificate:
        cell(
            "certification.statement",
            180,
            "All campaign contributions or disbursements did not exceed $750 in the calendar year.",
            record="certification",
            right=580,
        )
        cell("certification.mark", 205, "X", "mark", record="certification")
        cell("certification.date", 230, "7/5/2026", "date", record="certification")
    else:
        cell("cover.start", 80, "8/2/2026", "date")
        cell("cover.end", 100, "10/20/2026", "date")
        mapping.update(period_start="cover.start", period_end="cover.end")
        settings = [
            (
                1,
                160,
                "August 8, 2026",
                "Itasca County Agricultural Association",
                [(1, 205, "Fair Booth", "400.67")],
                230,
            ),
            (
                2,
                240,
                "August 10, 2026",
                "Earlybird Branding Co",
                [
                    (2, 285, "Signs with stakes", "686"),
                    (3, 310, "Stickers", "300"),
                    (4, 335, "Card fee and taxes", "109.72"),
                ],
                382,
            ),
            (
                3,
                400,
                "August 17, 2026",
                "Earlybird Branding Co",
                [(5, 445, "Postcards", "151.39")],
                470,
            ),
        ]
        for group, top, day, payee, members, bottom in settings:
            uncertain = group == 2
            cell(
                f"group{group}.date",
                top + 5,
                "8/?/2026"
                if uncertain and date_state == "ambiguous"
                else (group_day if uncertain and group_day else day),
                "date",
                record="other",
                state=date_state if uncertain else "value",
            )
            cell(
                f"group{group}.payee",
                top + 25,
                ("unclear vendor" if payee_state == "ambiguous" else "")
                if uncertain and payee_state != "value"
                else payee,
                record="other",
                state=payee_state if uncertain else "value",
            )
            for row, y, purpose, amount in members:
                cell(
                    f"expense.r{row}.purpose",
                    y,
                    purpose,
                    x=270 if row == 2 and (row_date or row_payee) else 30,
                    record="disbursement",
                    row=row,
                )
                cell(
                    f"expense.r{row}.amount",
                    y,
                    amount,
                    "money",
                    record="disbursement",
                    row=row,
                    x=440,
                    right=520,
                )
            if group == 2:
                if row_date is not None:
                    cell(
                        "expense.r2.date",
                        285,
                        row_date,
                        "date",
                        x=30,
                        right=110,
                        record="disbursement",
                        row=2,
                    )
                if row_payee is not None:
                    cell(
                        "expense.r2.payee",
                        285,
                        row_payee,
                        record="disbursement",
                        row=2,
                        x=115,
                        right=265,
                    )
            summary = []
            if group == 2:
                cell(
                    "group2.subtotal",
                    365,
                    "1095.72",
                    "money",
                    record="other",
                    label="Total",
                )
                summary = ["group2.subtotal"]
            groups.append(
                dict(
                    kind="same_page_heading_rows",
                    page=1,
                    bounds=[20, top, 550, bottom],
                    date_field=f"group{group}.date",
                    payee_field=None if no_group_payee else f"group{group}.payee",
                    rows=[m[0] for m in members],
                    summary_fields=summary,
                )
            )
        cell("attachment.total", 490, "1647.78", "money", record="other", label="Total")
    writer = PdfWriter()
    page = writer.add_blank_page(width=612, height=792)
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
                    )
                }
            )
        }
    )
    commands = []
    for field in fields:
        literal = (
            field["literal"]
            .replace("\\", "\\\\")
            .replace("(", "\\(")
            .replace(")", "\\)")
        )
        x, y = field["bounds"][:2]
        commands.append(f"BT /F1 7 Tf 1 0 0 1 {x} {792 - y - 10} Tm ({literal}) Tj ET")
    stream = DecodedStreamObject()
    stream.set_data("\n".join(commands).encode("ascii"))
    page[NameObject("/Contents")] = writer._add_object(stream)
    output = BytesIO()
    writer.write(output)
    body = output.getvalue()
    receipt = r.prepare_receipt(
        body,
        fields=fields,
        document_kind="certification" if certificate else "financial_report",
        reading_scope=dict(
            cover=dict(page=1, bounds=[20, 20, 550, 115]),
            regions=[dict(page=1, bounds=[0, 0, 612, 792], role="cover")],
        ),
    )
    return body, receipt, mapping, groups


def admitted(db, **options):
    body, receipt, mapping, groups = packet(**options)
    # The existing normal provenance fixture consumes just this field map,
    # then supplies its full checked source chain. No verifier seal is forged.
    receipt["source_context"] = {"fields": mapping}
    item = provenance_chain(db, MemoryStore(), body, receipt)
    item["receipt"]["source_context"]["document_role"] = (
        "certification" if options.get("certificate") else "primary"
    )
    if groups:
        item["receipt"]["source_context"]["payment_groups"] = groups
    item["decision"] = r.record_reading(
        db,
        item["store"],
        receipt=item["receipt"],
        decision="checked",
        reviewed_by="SYNTHETIC_TEST",
        reason="Synthetic grouping/source check",
        expected_previous_id=None,
    )
    return item


def proof(db, item):
    return r.load_verified_reading_context(
        db,
        item["store"],
        [item["decision"].receipt_sha256],
        allowed_source_hashes=set(item["originals"]),
    )


def extract(db, item, kind, **kwargs):
    return local.extract_local_reading(
        item["body"],
        item["source"],
        dict(kind=kind, receipt_sha256=item["decision"].receipt_sha256, **kwargs),
        context=proof(db, item),
    )


def test_certificate_name_office_are_source_facts_not_financial_report(db):
    item = admitted(db, certificate=True)
    account = extract(db, item, "account")
    assert account.facts["name"] == "Synthetic Source Name"
    assert account.facts["candidate_name"] is None
    assert "County Attorney" in account.quote
    for kind in ["report", "figure", "payment"]:
        with pytest.raises(ComparisonImportError, match="identity/period/version"):
            extract(db, item, kind)
    field = extract(db, item, "field", field_id="certification.date")
    assert field.facts["normalized"] == "2026-07-05"


def test_checked_shared_headings_produce_five_rows_without_totals(db):
    item = admitted(db)
    payments = [extract(db, item, "payment", page=1, row=n) for n in range(1, 6)]
    assert [p.facts["amount"] for p in payments] == [
        "400.67",
        "686.00",
        "300.00",
        "109.72",
        "151.39",
    ]
    assert [p.facts["date"] for p in payments] == [
        "2026-08-08",
        *["2026-08-10"] * 3,
        "2026-08-17",
    ]
    assert [p.facts["payee"] for p in payments[1:]] == ["Earlybird Branding Co"] * 4
    assert all(
        p.facts["direction"] == "unknown"
        and p.facts["transaction_type"] == "local_disbursement"
        for p in payments
    )
    assert all(
        "subtotal" not in p.quote and "payment_groups" not in p.quote for p in payments
    )
    with pytest.raises(ComparisonImportError):
        extract(db, item, "payment", page=1, row=6)


@pytest.mark.parametrize(
    "date_state,payee_state", [("ambiguous", "value"), ("value", "ambiguous")]
)
def test_heading_uncertainty_isolated_to_affected_derived_values(
    db, date_state, payee_state
):
    item = admitted(db, date_state=date_state, payee_state=payee_state)
    assert extract(db, item, "payment", page=1, row=1).facts["amount"] == "400.67"
    assert extract(db, item, "payment", page=1, row=5).facts["amount"] == "151.39"
    if date_state == "ambiguous":
        for row in (2, 3, 4):
            with pytest.raises(ComparisonImportError, match="Shared payment date"):
                extract(db, item, "payment", page=1, row=row)
    else:
        for row in (2, 3, 4):
            payment = extract(db, item, "payment", page=1, row=row)
            assert payment.facts["payee"] is None
            assert "unclear vendor" not in payment.quote


@pytest.mark.parametrize(
    "payee_state", ["blank", "ambiguous", "unreadable", "redacted", "not_checked"]
)
def test_row_payee_cannot_override_uncertain_mapped_heading(db, payee_state):
    item = admitted(db, payee_state=payee_state, row_payee="Another printed vendor")
    with pytest.raises(
        ComparisonImportError, match="conflicts with its shared heading"
    ):
        extract(db, item, "payment", page=1, row=2)
    for row in (3, 4):
        assert extract(db, item, "payment", page=1, row=row).facts["payee"] is None
    assert extract(db, item, "payment", page=1, row=1).facts["amount"] == "400.67"
    assert extract(db, item, "payment", page=1, row=5).facts["amount"] == "151.39"


def shape_context(receipt, mapping, groups):
    return dict(
        kind=c.CONTEXT_KIND,
        root_receipt_id="a" * 64,
        edges=[
            dict(kind="acquisition", receipt_id="b" * 64),
            dict(
                kind="html_anchor",
                source_sha256="c" * 64,
                anchor_index=1,
                line=1,
                href="/report.pdf",
                label="Report",
                base_href=None,
                target_url="https://example.org/report.pdf",
            ),
            dict(kind="acquisition", receipt_id="d" * 64),
        ],
        publisher_account=dict(
            kind=c.PHYSICAL_SECTION,
            namespace="synthetic",
            issued_id=False,
            account_id=None,
            name_as_source=None,
            location=None,
            office=None,
            district=None,
        ),
        document_role=c.DOCUMENT_ROLES[receipt["document_kind"]],
        fields=mapping,
        recipient_binding=None,
        payment_groups=groups,
    )


@pytest.fixture(scope="module")
def source_shapes():
    return packet(), packet(certificate=True)


@pytest.mark.parametrize(
    "case",
    [
        "unknown_key",
        "bad_bounds",
        "nan",
        "outside_region",
        "overlap",
        "duplicate_row",
        "missing_row",
        "bool_row",
        "empty_rows",
        "wrong_page",
        "wrong_heading_type",
        "heading_below_rows",
        "row_outside",
        "summary_as_row",
        "missing_summary",
        "unknown_summary",
        "heading_from_other_page",
        "heading_from_cover",
        "too_many",
        "malformed_summary",
        "cross_section",
        "overlapping_rows",
    ],
)
def test_group_structure_refuses_unsupported_source_relations(source_shapes, case):
    _, receipt, mapping, groups = deepcopy(source_shapes[0])
    context = shape_context(receipt, mapping, groups)
    g = groups[1]
    if case == "unknown_key":
        g["fallback_date"] = "2026-08-10"
    elif case == "bad_bounds":
        g["bounds"] = [1, 2, 3]
    elif case == "nan":
        g["bounds"][0] = float("nan")
    elif case == "outside_region":
        g["bounds"][2] = 700
    elif case == "overlap":
        g["bounds"][1] = 220
    elif case == "duplicate_row":
        g["rows"] = [2, 2, 3, 4]
    elif case == "missing_row":
        g["rows"].append(99)
    elif case == "bool_row":
        g["rows"][0] = True
    elif case == "empty_rows":
        g["rows"] = []
    elif case == "wrong_page":
        g["page"] = 2
    elif case == "wrong_heading_type":
        g["date_field"] = "group2.payee"
    elif case == "heading_below_rows":
        next(f for f in receipt["fields"] if f["field_id"] == "group2.date")[
            "bounds"
        ] = [30, 350, 420, 364]
    elif case == "row_outside":
        next(f for f in receipt["fields"] if f["field_id"] == "expense.r2.amount")[
            "bounds"
        ][2] = 560
    elif case == "summary_as_row":
        f = next(f for f in receipt["fields"] if f["field_id"] == "group2.subtotal")
        f["row"] = 6
        g["rows"].append(6)
    elif case == "missing_summary":
        g["summary_fields"] = []
    elif case == "unknown_summary":
        g["summary_fields"] = ["absent"]
    elif case == "heading_from_other_page":
        next(f for f in receipt["fields"] if f["field_id"] == "group2.date")["page"] = 2
    elif case == "heading_from_cover":
        g["date_field"] = "cover.start"
    elif case == "too_many":
        context["payment_groups"] = groups * 1000
    elif case == "malformed_summary":
        g["summary_fields"] = [False]
    elif case == "overlapping_rows":
        for f in receipt["fields"]:
            if f["row"] == 3:
                f["bounds"][1:4:2] = [290, 304]
    elif case == "cross_section":
        receipt["reading_scope"]["regions"][0]["bounds"] = [0, 0, 612, 300]
    with pytest.raises(ComparisonImportError):
        c.validate_context_shape(context, receipt)


@pytest.mark.parametrize(
    "case",
    [
        "candidate",
        "period",
        "report_type",
        "wrong_record",
        "wrong_label",
        "outside_cover",
        "group",
    ],
)
def test_certificate_variant_never_promotes_statement_to_finance(source_shapes, case):
    _, receipt, mapping, _ = deepcopy(source_shapes[1])
    context = shape_context(receipt, mapping, [])
    if case == "candidate":
        mapping["candidate_name"] = "cover.name"
    elif case == "period":
        mapping["period_start"] = "certification.date"
    elif case == "report_type":
        mapping["report_type"] = ["certification.mark"]
    elif case == "wrong_record":
        receipt["fields"][0]["record_type"] = "cover"
    elif case == "wrong_label":
        receipt["fields"][0]["label"] = "Certification"
    elif case == "outside_cover":
        receipt["fields"][0]["bounds"] = [30, 500, 420, 514]
    elif case == "group":
        context["payment_groups"] = deepcopy(source_shapes[0][3])
    with pytest.raises(ComparisonImportError):
        c.validate_context_shape(context, receipt)


def test_checked_group_loss_withdrawal_and_stale_head_change_fresh_proof(db):
    item = admitted(db)
    first = proof(db, item)
    key = db.get(m.ElectionResultSource, item["receipt"]["original_sha256"]).object_key
    original = item["store"].objects.pop(key)
    with pytest.raises(ComparisonImportError):
        proof(db, item)
    missing = r.load_verified_reading_context(
        db,
        item["store"],
        [item["decision"].receipt_sha256],
        allowed_source_hashes=set(item["originals"]),
        partial=True,
    )
    assert missing.version != first.version
    item["store"].objects[key] = original
    assert proof(db, item).version == first.version
    previous = item["decision"]
    withdrawn = r.record_reading(
        db,
        item["store"],
        receipt=item["receipt"],
        decision="withdrawn",
        reviewed_by="SYNTHETIC_TEST",
        reason="Synthetic withdrawal",
        expected_previous_id=previous.id,
    )
    with pytest.raises(ComparisonImportError, match="current checked"):
        proof(db, item)
    with pytest.raises(ComparisonImportError):
        r.record_reading(
            db,
            item["store"],
            receipt=item["receipt"],
            decision="checked",
            reviewed_by="SYNTHETIC_TEST",
            reason="Stale decision",
            expected_previous_id=previous.id,
        )
    current = r.record_reading(
        db,
        item["store"],
        receipt=item["receipt"],
        decision="checked",
        reviewed_by="SYNTHETIC_TEST",
        reason="Synthetic restore",
        expected_previous_id=withdrawn.id,
    )
    item["decision"] = current
    assert proof(db, item).version != first.version
    assert extract(db, item, "payment", page=1, row=3).facts["amount"] == "300.00"


def test_group_map_cannot_arrive_from_payment_locator(db):
    item = admitted(db)
    with pytest.raises(ComparisonImportError, match="locator"):
        extract(
            db,
            item,
            "payment",
            page=1,
            row=2,
            payment_groups=item["receipt"]["source_context"]["payment_groups"],
        )


@pytest.mark.parametrize(
    "options",
    [
        dict(row_date="August 11, 2026"),
        dict(row_payee="Another printed vendor"),
        dict(group_day="August 10, 2025"),
    ],
)
def test_conflicting_row_or_outside_period_refuses_only_affected_payment(db, options):
    item = admitted(db, **options)
    with pytest.raises(
        ComparisonImportError, match="conflicts|outside its actual period"
    ):
        extract(db, item, "payment", page=1, row=2)
    assert extract(db, item, "payment", page=1, row=1).facts["amount"] == "400.67"
    assert extract(db, item, "payment", page=1, row=5).facts["amount"] == "151.39"


@pytest.mark.parametrize("no_group_payee", [False, True])
def test_matching_explicit_cells_and_missing_optional_payee(db, no_group_payee):
    item = admitted(
        db,
        row_date="8/10/2026",
        row_payee="Earlybird Branding Co",
        no_group_payee=no_group_payee,
    )
    payment = extract(db, item, "payment", page=1, row=2)
    assert payment.facts["date"] == "2026-08-10"
    assert payment.facts["payee"] == "Earlybird Branding Co"
    assert extract(db, item, "payment", page=1, row=3).facts["payee"] == (
        None if no_group_payee else "Earlybird Branding Co"
    )


def test_source_purpose_does_not_reclassify_loan_or_invent_payee():
    report = dict(
        authority="local:county:31",
        account_id="section",
        source_report_id="section",
        period_start="2026-07-11",
        period_end="2026-07-31",
    )
    for amount in ("160.00", "150.00"):
        facts = local._payment_facts(
            report,
            "synthetic-row",
            "2026-07-20",
            amount,
            "USD",
            None,
            "loan to candidate",
        )
        assert facts["amount"] == amount
        assert facts["payee"] is None
        assert facts["purpose"] == "loan to candidate"
        assert facts["direction"] == "unknown"
        assert facts["transaction_type"] == "local_disbursement"
