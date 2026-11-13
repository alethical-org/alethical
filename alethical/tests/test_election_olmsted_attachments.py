"""Closed two-reading attachment source proof, never account-name inheritance."""

from copy import deepcopy
from typing import Any
from alethical.pipeline import election_olmsted_attachments as attachments
from alethical.pipeline import election_source_readings as readings
from alethical.pipeline.election_comparison import ComparisonImportError

import pytest

from alethical.pipeline import election_external_finance as storage


def attachment_locator():
    return {
        "kind": "attachment_payment",
        "profile": "olmsted_period_expense_attachment:v1",
        "receipt_sha256": "a" * 64,
        "parent_receipt_sha256": "b" * 64,
        "reference_section": {
            "page": 1,
            "item_bounds": [10, 30, 90, 70],
            "heading_field_id": "disbursements.heading",
            "reference_field_id": "attachment.reference_cell",
            "item_area_field_id": "disbursements.item_area",
            "blank_field_ids": ["disbursements.blank"],
        },
        "page": 1,
        "row": 1,
    }


def test_attachment_binding_requires_both_readings():
    binding = {
        "adapter": "local_checked_reading:v1",
        "locator": attachment_locator(),
    }
    assert storage.local_reading_ids(binding) == {"a" * 64, "b" * 64}


def receipt():
    def field(name, bounds, literal, state="value"):
        return dict(
            field_id=name,
            page=1,
            bounds=bounds,
            label=name,
            literal=literal,
            normalized=literal if state == "value" else None,
            state=state,
            value_type="text",
            currency=None,
            record_type="cover",
            row=None,
        )

    fields = [
        field("cover.name", [10, 1, 30, 5], "Invented Candidate"),
        field("disbursements.heading", [10, 20, 45, 25], "Disbursements"),
        field("attachment.reference_cell", [10, 30, 50, 70], "See attached"),
        field("disbursements.blank", [50, 30, 90, 70], "", "blank"),
    ]
    area = deepcopy(fields[2])
    area.update(
        field_id="disbursements.item_area",
        bounds=[10, 30, 90, 70],
        label="Disbursements item area",
    )
    fields.append(area)
    value = dict(
        schema=readings.SECTION_SCHEMA,
        verification_basis="visual_source_check",
        original_sha256="c" * 64,
        document_kind="financial_report",
        pages=[
            dict(
                page=1,
                width=100,
                height=100,
                image_sha256="d" * 64,
                render_profile=readings.RENDER_PROFILE,
                transcript="",
            )
        ],
        fields=fields,
        dependencies=[],
        source_context=None,
        reading_scope=dict(
            cover=dict(page=1, bounds=[10, 1, 30, 5]),
            regions=[dict(page=1, bounds=[0, 0, 100, 100], role="cover")],
        ),
    )
    return checked(value)


def checked(value):
    for page in value["pages"]:
        page["transcript"] = "\n".join(
            f"{f['field_id']} | {f['label']} | {f['literal']} | {f['state']}"
            for f in value["fields"]
            if f["page"] == page["page"]
        )
    return readings.validate_receipt(value)


def test_checked_item_rectangle_is_exactly_covered():
    result = attachments.reference_section(
        receipt(), attachment_locator()["reference_section"]
    )
    assert result["reference"]["literal"] == "See attached"
    assert len(result["blank_fields"]) == 1


@pytest.mark.parametrize(
    "attack",
    [
        "same_ids",
        "nested_id",
        "unknown_key",
        "bad_profile",
        "string_row",
        "unbounded_blanks",
    ],
)
def test_closed_two_reading_locator_refuses_ambiguity(attack):
    locator = attachment_locator()
    if attack == "same_ids":
        locator["parent_receipt_sha256"] = locator["receipt_sha256"]
    elif attack == "nested_id":
        locator["parent_receipt_sha256"] = {"receipt_sha256": "b" * 64}
    elif attack == "unknown_key":
        locator["another"] = "b" * 64
    elif attack == "bad_profile":
        locator["profile"] = "generic"
    elif attack == "string_row":
        locator["row"] = "1"
    else:
        locator["reference_section"]["blank_field_ids"] *= 33
    with pytest.raises(ComparisonImportError):
        attachments.validate_locator(locator)


@pytest.mark.parametrize(
    "attack",
    [
        "contributions",
        "heading_below",
        "heading_other_page",
        "sliver",
        "overlap",
        "uncertain_blank",
        "shifted_item",
        "competing_value",
        "competing_blank",
        "partial_reference",
        "total_in_area",
    ],
)
def test_geometry_attacks_are_valid_receipts_but_not_attachment_proof(attack):
    value = receipt()
    section = deepcopy(attachment_locator()["reference_section"])
    heading, reference, blank = value["fields"][1:4]
    if attack == "contributions":
        heading.update(literal="Contributions", normalized="Contributions")
    elif attack == "heading_below":
        heading["bounds"] = [10, 75, 45, 80]
    elif attack == "heading_other_page":
        value["pages"].append({**value["pages"][0], "page": 2, "transcript": ""})
        heading["page"] = 2
        heading["record_type"] = "other"
        value["reading_scope"]["regions"].append(
            dict(page=2, bounds=[0, 0, 100, 100], role="continuation")
        )
    elif attack == "sliver":
        blank["bounds"][0] += 0.001
    elif attack == "overlap":
        blank["bounds"][0] -= 1
    elif attack == "uncertain_blank":
        blank.update(state="unreadable")
    elif attack == "shifted_item":
        section["item_bounds"][0] += 1
    elif attack == "partial_reference":
        reference["bounds"][3] -= 1
    else:
        extra = deepcopy(blank)
        extra.update(field_id="other.cell", bounds=[55, 40, 60, 45])
        if attack != "competing_blank":
            extra.update(state="value", literal="10.00", normalized="10.00")
        if attack == "total_in_area":
            extra["label"] = "Total"
        value["fields"].append(extra)
    # The shape is possible under the normal source receipt validator.
    checked(value)
    with pytest.raises(ComparisonImportError):
        attachments.reference_section(value, section)


def test_same_phrase_corroboration_and_total_outside_item_rectangle():
    value = receipt()
    extra = deepcopy(value["fields"][2])
    extra.update(field_id="reference.words", bounds=[15, 40, 40, 50])
    value["fields"].append(extra)
    total = deepcopy(extra)
    total.update(
        field_id="cover.disbursements",
        bounds=[70, 80, 90, 85],
        literal="10.00",
        normalized="10.00",
    )
    value["fields"].append(total)
    assert attachments.reference_section(
        checked(value), attachment_locator()["reference_section"]
    )


def relationship_inputs():
    parent_receipt = receipt()
    parent_receipt["source_context"] = {"root_receipt_id": "c" * 64}
    child_receipt = {
        "document_kind": "supplement",
        "original_sha256": "e" * 64,
        "source_context": {
            "root_receipt_id": "c" * 64,
            "fields": dict(
                name=None,
                office=None,
                candidate_name=None,
                candidate_mark=None,
                period_start=None,
                period_end=None,
                report_type=[],
            ),
        },
        "fields": [
            dict(
                field_id="expense.heading",
                label="Expenditures",
                state="value",
                value_type="text",
                literal="Expenditures",
                record_type="other",
            )
        ],
    }
    members = [
        dict(
            url="https://example.gov/parent",
            label="Invented Candidate Pre-Primary Campaign Finance Report 4-7-26 to 7-31-26",
            period=["2026-04-07", "2026-07-31"],
        ),
        dict(
            url="https://example.gov/expense",
            label="Invented Candidate Primary Spending Report - Sheet1 4-7-26 to 7-31-26",
            period=["2026-04-07", "2026-07-31"],
        ),
    ]
    catalogue = dict(
        profile=attachments.PROFILE,
        election_date="2026-11-03",
        catalogue_sha256="f" * 64,
        group_scope=dict(
            person_as_source="Invented Candidate",
            office_as_source="County Attorney",
            district_as_source=None,
        ),
        members=members,
    )
    parent: dict[str, Any] = dict(
        document_role="primary",
        election_date="2026-11-03",
        authority={"key": "local:county:55"},
        recipient_rows=["55;Olmsted;111"],
        account={"name": "Invented Candidate"},
        document_url="https://example.gov/parent",
        office_literal="Olmsted County Attorney",
        attachment_catalogue=catalogue,
        source_chain=[
            dict(kind="acquisition", receipt_id="1" * 64, source_sha256="f" * 64)
        ],
        report=dict(
            period_start="2026-04-07",
            period_end="2026-07-31",
            report_type="Pre-primary",
            effective=None,
            version_scope="exact_document",
            amendment_status="not_established",
        ),
    )
    child: dict[str, Any] = {
        **deepcopy(parent),
        "document_role": "supplement",
        "document_url": "https://example.gov/expense",
    }
    parent["source_chain"].append(
        dict(
            kind="acquisition",
            receipt_id="3" * 64,
            source_sha256="c" * 64,
            requested_url=parent["document_url"],
            final_url=parent["document_url"],
        )
    )
    child["source_chain"].append(
        dict(
            kind="acquisition",
            receipt_id="4" * 64,
            source_sha256="e" * 64,
            requested_url=child["document_url"],
            final_url=child["document_url"],
        )
    )
    return (
        parent,
        child,
        parent_receipt,
        child_receipt,
        attachment_locator()["reference_section"],
    )


def test_exact_publisher_period_relationship_does_not_change_raw_child():
    args = relationship_inputs()
    before = deepcopy(args[3])
    result = attachments.relationship(*args)
    assert result["parent_reference"]["reference"]["literal"] == "See attached"
    assert args[3] == before and args[3]["source_context"]["fields"]["name"] is None


@pytest.mark.parametrize(
    "attack",
    [
        "parent_supplement",
        "same_original",
        "own_name",
        "other_root",
        "other_election",
        "other_capture",
        "wrong_office",
        "wrong_person",
        "unknown_version",
        "amended",
        "unmatched_period",
        "competing_primary",
        "competing_expense",
        "unknown_member",
        "donation_heading",
        "contrary_own_person",
    ],
)
def test_exact_relationship_holds_conflicting_source_facts(attack):
    args = relationship_inputs()
    parent, child, pr, cr, section = args
    if attack == "parent_supplement":
        parent["document_role"] = "supplement"
    elif attack == "same_original":
        cr["original_sha256"] = pr["original_sha256"]
    elif attack == "own_name":
        cr["source_context"]["fields"]["name"] = "invented"
    elif attack == "other_root":
        cr["source_context"]["root_receipt_id"] = "2" * 64
    elif attack == "other_election":
        child["election_date"] = "2025-11-03"
    elif attack == "other_capture":
        child["source_chain"][0]["receipt_id"] = "2" * 64
    elif attack == "wrong_office":
        parent["office_literal"] = "Olmsted County Sheriff"
    elif attack == "wrong_person":
        parent["account"]["name"] = "Different Candidate"
    elif attack == "unknown_version":
        parent["report"]["version_scope"] = "series"
    elif attack == "amended":
        parent["report"]["report_type"] = "Amended + Pre-primary"
    elif attack == "unmatched_period":
        parent["report"]["period_end"] = "2026-08-01"
    elif attack in {"competing_primary", "competing_expense", "unknown_member"}:
        member = deepcopy(
            parent["attachment_catalogue"]["members"][
                int(attack == "competing_expense")
            ]
        )
        member["url"] = "https://example.gov/another"
        if attack == "unknown_member":
            member["label"] = "Invented Candidate corrected 4-7-26 to 7-31-26"
        parent["attachment_catalogue"]["members"].append(member)
        child["attachment_catalogue"] = deepcopy(parent["attachment_catalogue"])
    elif attack == "donation_heading":
        cr["fields"][0]["literal"] = "Donations"
    else:
        cr["fields"].append(
            dict(
                label="Name of candidate or committee",
                state="value",
                literal="Other person",
            )
        )
    with pytest.raises(ComparisonImportError):
        attachments.relationship(*args)


def test_county_office_wording_is_closed_to_the_exact_typed_race():
    from types import SimpleNamespace

    publisher = dict(
        key="local:county:55",
        name="Olmsted County",
        jurisdiction=dict(
            recipient_type="county", recipient_id="55", county_ids=["55"]
        ),
    )
    race = SimpleNamespace(
        payload=dict(
            jurisdiction_kind="county",
            jurisdiction_id="55",
            county_ids=["55"],
            office_name="County Attorney",
        )
    )
    assert attachments.county_office_matches(publisher, race, "Olmsted County Attorney")
    for wrong in [
        dict(county_ids=["18"], office_name="County Attorney"),
        dict(county_ids=["55", "18"], office_name="County Attorney"),
        dict(county_ids=["55"], office_name="County Sheriff"),
    ]:
        assert not attachments.county_office_matches(
            publisher, SimpleNamespace(payload=wrong), "Olmsted County Attorney"
        )
    assert not attachments.county_office_matches(
        {**publisher, "name": "Other County"}, race, "Olmsted County Attorney"
    )
    assert not attachments.county_office_matches(publisher, race, "Olmsted Attorney")


def catalogue():
    return b"""<html><body><div class="node-content"><h4>2026 campaign finance reports by candidate</h4>
<p>County Attorney</p><p><strong>Invented Candidate</strong></p>
<article class="media media--type-file media--view-mode-default" aria-label="Inside this element is a link to download Invented Candidate Pre-Primary Campaign Finance Report 4-7-26 to 7-31-26 file"><a class="file" href="/parent.pdf">Invented Candidate Pre-Primary Campaign Finance Report 4-7-26 to 7-31-26</a></article>
<article class="media media--type-file media--view-mode-default" aria-label="Inside this element is a link to download Invented Candidate Primary Spending Report - Sheet1 4-7-26 to 7-31-26 file"><a class="file" href="/expense.pdf">Invented Candidate Primary Spending Report - Sheet1 4-7-26 to 7-31-26</a></article>
</div></body></html>"""


def catalogue_inputs(body):
    import hashlib
    from urllib.parse import urljoin
    from alethical.pipeline import election_local_context as context

    doc = context._HTML(body)
    anchor = doc.all("a")[0]
    edge = dict(
        kind="html_anchor",
        source_sha256=hashlib.sha256(body).hexdigest(),
        anchor_index=1,
        line=anchor.line,
        href=anchor.attrs["href"],
        label=context._text(anchor),
        base_href=None,
        target_url=urljoin(attachments.CATALOGUE_URL, anchor.attrs["href"]),
    )
    root = dict(
        recipient=dict(namespace="county", source_id="55", county_ids=["55"]),
        election_date="2026-11-03",
    )
    return body, attachments.CATALOGUE_URL, edge, root


def test_complete_literal_article_group():
    group = attachments.catalogue_group(*catalogue_inputs(catalogue()))
    assert group["group_scope"]["person_as_source"] == "Invented Candidate"
    assert len(group["members"]) == 2
    assert group["members"][0]["period"] == ["2026-04-07", "2026-07-31"]


@pytest.mark.parametrize(
    "attack",
    [
        "hidden",
        "malformed",
        "heading_anchor",
        "outside_disclaimer",
        "reused_url",
        "wire_alias",
        "case_person",
        "extra_text",
        "asset",
        "aria_disagreement",
        "district_without_office",
        "other_year",
        "wrong_recipient",
    ],
)
def test_catalogue_closure_refuses_unobserved_or_ambiguous_structure(attack):
    body = catalogue()
    if attack == "hidden":
        body = body.replace(b"<article ", b"<article hidden ")
    elif attack == "malformed":
        body = body.replace(b"</article>", b"", 1)
    elif attack == "heading_anchor":
        body = body.replace(b"<h4>2026", b'<h4><a href="/another">2026').replace(
            b"by candidate</h4>", b"by candidate</a></h4>"
        )
    elif attack == "outside_disclaimer":
        body = body.replace(
            b"</body>", b"<p>Later corrected reports continue elsewhere</p></body>"
        )
    elif attack == "reused_url":
        body = body.replace(b"/expense.pdf", b"/parent.pdf")
    elif attack == "wire_alias":
        body = body.replace(b"/parent.pdf", b"/same file.pdf").replace(
            b"/expense.pdf", b"/same%20file.pdf"
        )
    elif attack == "case_person":
        body = body.replace(
            b"</div>",
            b'<p>invented candidate</p><article class="media media--type-file media--view-mode-default" aria-label="Inside this element is a link to download Other file"><a href="/other">Other</a></article></div>',
        )
    elif attack == "extra_text":
        body = body.replace(b"</article>", b"Additional reports elsewhere</article>", 1)
    elif attack == "asset":
        body = body.replace(
            b"<body>", b'<body><script src="https://example.com/change.js"></script>'
        )
    elif attack == "aria_disagreement":
        body = body.replace(b'aria-label="Inside this', b'aria-label="Other this', 1)
    elif attack == "district_without_office":
        body = body.replace(b"<p>County Attorney</p>", b"<h5>District 3</h5>")
    elif attack == "other_year":
        body = body.replace(
            b"2026 campaign finance reports by candidate",
            b"2025 campaign finance reports by candidate",
        )
    args = list(catalogue_inputs(body))
    if attack == "wrong_recipient":
        args[3]["recipient"]["source_id"] = "18"
    with pytest.raises(ComparisonImportError):
        attachments.catalogue_group(*args)


def test_parent_is_the_exact_containing_report_identity_not_a_null_report_id():
    locator = attachment_locator()
    report: dict[str, Any] = dict(
        source_sha256="c" * 64,
        source_report_id=None,
        authority="local:county:55",
        account_id="same",
        binding=dict(
            adapter="local_checked_reading:v1",
            source_sha256="c" * 64,
            locator=dict(kind="report", receipt_sha256="b" * 64),
        ),
    )
    attachments.report_binding_matches(locator, report, parent_original="c" * 64)
    other = deepcopy(report)
    other["binding"]["locator"]["receipt_sha256"] = "d" * 64
    with pytest.raises(ComparisonImportError):
        attachments.report_binding_matches(locator, other, parent_original="c" * 64)
    other = deepcopy(report)
    other["binding"]["adapter"] = "local_native_form:v1"
    with pytest.raises(ComparisonImportError):
        attachments.report_binding_matches(locator, other, parent_original="c" * 64)
    other = deepcopy(report)
    other["binding"] = [
        other["binding"],
        {
            **deepcopy(other["binding"]),
            "locator": dict(kind="report", receipt_sha256="e" * 64),
        },
    ]
    with pytest.raises(ComparisonImportError):
        attachments.report_binding_matches(locator, other, parent_original="c" * 64)


def test_native_adapter_and_generic_nested_ids_do_not_invent_attachment_proofs():
    binding = dict(adapter="local_native_form:v1", locator=attachment_locator())
    with pytest.raises(ComparisonImportError):
        storage.local_reading_ids(binding)
    generic = dict(
        adapter="local_checked_reading:v1",
        locator=dict(
            kind="field",
            receipt_sha256="a" * 64,
            field_id="cover.name",
            extra={"parent_receipt_sha256": "b" * 64},
        ),
    )
    assert storage.local_reading_ids(generic) == {"a" * 64}
    address = dict(
        adapter="local_checked_reading:v1",
        locator={**attachment_locator(), "kind": "attachment_payment_address"},
    )
    assert storage.local_reading_ids(address) == {"a" * 64, "b" * 64}


def test_partial_item_rectangle_cannot_hide_a_checked_second_item():
    value = receipt()
    value["fields"][2]["bounds"] = [10, 30, 50, 50]
    value["fields"][3]["bounds"] = [50, 30, 90, 50]
    other = deepcopy(value["fields"][2])
    other.update(
        field_id="other.purpose",
        label="Purpose",
        bounds=[10, 50, 90, 70],
        literal="Printing",
        normalized="Printing",
    )
    value["fields"].append(other)
    checked(value)
    section = deepcopy(attachment_locator()["reference_section"])
    section["item_bounds"] = [10, 30, 90, 50]
    with pytest.raises(ComparisonImportError):
        attachments.reference_section(value, section)


@pytest.mark.parametrize(
    "attack",
    [
        "label",
        "state",
        "type",
        "bounds",
        "alias_reference",
        "missing",
        "duplicate_area",
        "parent_item_elsewhere",
    ],
)
def test_full_item_area_is_a_checked_immutable_source_scope(attack):
    value = receipt()
    section = deepcopy(attachment_locator()["reference_section"])
    area = value["fields"][-1]
    if attack == "label":
        area["label"] = "Purpose"
    elif attack == "state":
        area.update(state="ambiguous", normalized=None)
    elif attack == "type":
        area.update(value_type="mark", literal="X", normalized="marked")
    elif attack == "bounds":
        section["item_bounds"] = [10, 30, 90, 50]
    elif attack == "alias_reference":
        section["item_area_field_id"] = section["reference_field_id"]
    elif attack == "missing":
        section["item_area_field_id"] = "absent.area"
    elif attack == "duplicate_area":
        other = deepcopy(area)
        other.update(field_id="other.area", bounds=[10, 75, 90, 90])
        value["fields"].append(other)
    else:
        other = deepcopy(value["fields"][0])
        other.update(
            field_id="expense.r1.purpose",
            bounds=[10, 75, 90, 90],
            literal="Printing",
            normalized="Printing",
            record_type="disbursement",
            row=1,
        )
        value["fields"].append(other)
    checked(value)
    with pytest.raises(ComparisonImportError):
        attachments.reference_section(value, section)


def test_verified_exact_acquisition_redirect_does_not_change_offered_member():
    args = relationship_inputs()
    parent, child, *_ = args
    parent["document_url"] = "https://cdn.example.gov/parent.pdf"
    parent["source_chain"][-1]["final_url"] = parent["document_url"]
    child["document_url"] = "https://cdn.example.gov/expense.pdf"
    child["source_chain"][-1]["final_url"] = child["document_url"]
    assert attachments.relationship(*args)
    child["source_chain"][-1]["requested_url"] = "https://example.gov/unoffered"
    with pytest.raises(ComparisonImportError):
        attachments.relationship(*args)
