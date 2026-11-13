"""Local source association is checked independently of any ballot identity."""

# ruff: noqa: F811, F401
from copy import deepcopy
import hashlib

import pytest

from alethical.pipeline import election_local_sources as local
from alethical.pipeline import election_source_readings as readings
from alethical.pipeline import election_external_finance as storage
from alethical.pipeline.election_comparison import ComparisonImportError, archive_source
from alethical.tests.test_election_comparison_storage import db, MemoryStore
from alethical.tests.test_election_local_financial_form import native_pdf


def packet(
    office="Synthetic School Board",
    blank_inkind=False,
    checked_rows=False,
    report_type="Pre-general",
    account_name="Synthetic Candidate",
    candidate_mark_state="value",
    candidate_name=True,
    outside_report=False,
):
    body = native_pdf(
        {
            "office": office,
            "name": (
                201,
                111,
                10 if account_name == "Synthetic Candidate" else 7,
                account_name,
            ),
            "inkind": None if blank_inkind else "0",
            "report_mark": (330, 155, 10, "X") if report_type else None,
            "report_type": (345, 155, 10, report_type or "Pre-general"),
            "candidate_mark": (
                30,
                157,
                10,
                "X Candidate" if candidate_mark_state == "value" else "? Candidate",
            ),
            "outside_mark": (30, 70, 10, "X Independent expenditure report")
            if outside_report
            else None,
        }
    )
    county = b"18;Crow Wing;62\n"
    publisher = b'<html><title>Campaign Finance | Crow Wing County</title><a href="/catalogue">2026 reports</a></html>'
    catalogue = b'<p><strong>SYNTHETIC CANDIDATE</strong><a href="/DocumentCenter/View/1/Example">10/19/2026</a><a href="/DocumentCenter/View/2/Addition">Addition to Financial Report</a></p>'
    bodies = {
        hashlib.sha256(v).hexdigest(): v for v in (body, county, publisher, catalogue)
    }
    context = dict(
        kind=local.CONTEXT_KIND,
        county_source_sha256=hashlib.sha256(county).hexdigest(),
        publisher_source_sha256=hashlib.sha256(publisher).hexdigest(),
        catalogue_source_sha256=hashlib.sha256(catalogue).hexdigest(),
        county_row=1,
        publisher_url="https://www.crowwing.gov/publisher",
        catalogue_url="https://www.crowwing.gov/catalogue",
        document_url="https://www.crowwing.gov/DocumentCenter/View/1/Example",
        group_label="SYNTHETIC CANDIDATE",
        document_role="primary",
        parent_document_url=None,
        version_basis="catalogued_document",
        fields=dict(
            name="cover.name",
            office="cover.office",
            candidate_name="cover.name" if candidate_name else None,
            candidate_mark="cover.candidate_mark",
            period_start="cover.period_start",
            period_end="cover.period_end",
            report_type=["cover.type"] if report_type else [],
        ),
    )
    specs = [
        (
            "candidate_mark",
            "Candidate",
            "X" if candidate_mark_state == "value" else "",
            "mark",
            [20, 145, 45, 165],
        ),
        (
            "name",
            "Name of candidate or committee",
            account_name,
            "text",
            [197, 98, 585, 115],
        ),
        (
            "office",
            "Office sought",
            office,
            "text",
            [97, 121, 585, 137],
        ),
        ("period_start", "From", "08/29/26", "date", [420, 170, 470, 188]),
        ("period_end", "To", "10/19/26", "date", [500, 170, 585, 188]),
        (
            "type",
            report_type or "Pre-general",
            "X" if report_type else "",
            "mark",
            [320, 145, 340, 165],
        ),
        (
            "total_received",
            "TOTAL AMOUNT RECEIVED",
            "1482.11",
            "money",
            [258, 347, 305, 364],
        ),
    ]
    fields = [
        readings.field_proposal(
            "cover." + key,
            page=1,
            bounds=bounds,
            label=label,
            literal=literal,
            state=candidate_mark_state
            if key == "candidate_mark"
            else "blank"
            if key == "type" and not report_type
            else "value",
            value_type=kind,
            currency="USD" if kind == "money" else None,
        )
        for key, label, literal, kind, bounds in specs
    ]
    fields.extend(
        [
            readings.field_proposal(
                "cover.in_kind_contributions",
                page=1,
                bounds=[258, 330, 305, 347],
                label="IN-KIND CONTRIBUTIONS VALUE",
                literal="" if blank_inkind else "0",
                state="blank" if blank_inkind else "value",
                value_type="money",
                currency="USD",
            ),
            readings.field_proposal(
                "cover.disbursements",
                page=1,
                bounds=[480, 617, 580, 638],
                label="Total",
                literal="1101.75",
                value_type="money",
                currency="USD",
            ),
        ]
    )
    if outside_report:
        fields.append(
            readings.field_proposal(
                "cover.independent_expenditure",
                page=1,
                bounds=[20, 58, 45, 77],
                label="Independent expenditure report",
                literal="X",
                value_type="mark",
            )
        )
    if checked_rows:
        native = local.read_native_local_report(body)
        for row in native["listed_disbursements"]:
            ordinal = int(row["source_row_id"].rsplit(":", 1)[-1])
            for name, source_field in row["source"].items():
                fields.append(
                    readings.field_proposal(
                        f"disbursements.{ordinal}.{name}",
                        page=1,
                        bounds=source_field["bounds"],
                        label=name,
                        literal=source_field["text"],
                        value_type="date"
                        if name == "date"
                        else "money"
                        if name == "amount"
                        else "text",
                        currency="USD" if name == "amount" else None,
                        record_type="disbursement",
                        row=ordinal,
                    )
                )
    receipt = readings.prepare_receipt(
        body, fields=fields, document_kind="financial_report", source_context=context
    )
    source = dict(
        sha256=receipt["original_sha256"],
        authority="local:county:18",
        url=context["document_url"],
        media_type="application/pdf",
    )
    return body, bodies, receipt, source


@pytest.fixture
def held(db, request):
    return checked_packet(db, checked_rows=getattr(request, "param", False))


def checked_packet(db, *, context_gap=None, **packet_args):
    body, bodies, receipt, source = packet(**packet_args)
    if context_gap == "supplement":
        receipt["document_kind"] = "supplement"
        context = receipt["source_context"]
        context.update(
            document_role="supplement",
            parent_document_url=context["document_url"],
            document_url="https://www.crowwing.gov/DocumentCenter/View/2/Addition",
        )
        source["url"] = context["document_url"]
    elif context_gap:
        receipt["source_context"]["fields"][context_gap] = None
    store = MemoryStore()
    for value in bodies.values():
        archive_source(db, store, value)
    row = readings.record_reading(
        db,
        store,
        receipt=receipt,
        decision="checked",
        reviewed_by="private",
        reason="Synthetic source observations and association checked",
        expected_previous_id=None,
    )
    proof = readings.load_verified_reading_context(
        db, store, [row.receipt_sha256], allowed_source_hashes=set(bodies)
    )
    return body, bodies, receipt, source, row, proof, store


@pytest.mark.parametrize("report_type", [None, "Amended pre-primary"])
def test_checked_primary_report_type_does_not_infer_an_effective_version(
    db, report_type
):
    from alethical.api.services.election_comparison_export import _latest_external

    body, _, receipt, source, row, proof, _ = checked_packet(
        db, report_type=report_type
    )
    report = local.extract_local_reading(
        body,
        source,
        {"kind": "report", "receipt_sha256": row.receipt_sha256},
        context=proof,
    )
    assert report.facts["report_type"] == report_type
    assert report.facts["period_start"] == "2026-08-29"
    assert report.facts["period_end"] == "2026-10-19"
    assert report.facts["effective"] is None
    assert report.facts["predecessor_report_key"] is None
    assert report.facts["version_scope"] == "exact_document"
    assert report.facts["amendment_status"] == "not_established"
    assert _latest_external([report.facts]) is None
    type_field = next(f for f in receipt["fields"] if f["field_id"] == "cover.type")
    assert type_field["literal"] == ("X" if report_type else "")
    assert type_field["state"] == ("value" if report_type else "blank")
    figure = local.extract_local_reading(
        body,
        source,
        {
            "kind": "figure",
            "receipt_sha256": row.receipt_sha256,
            "field_id": "cover.total_received",
        },
        context=proof,
    )
    native = local.extract_local_native(
        body,
        source,
        {
            "kind": "figure",
            "receipt_sha256": row.receipt_sha256,
            "field": "total_received",
        },
        context=proof,
    )
    assert figure.facts["value"] == native.facts["value"] == "1482.11"


@pytest.mark.parametrize("gap", ["name", "period_start", "period_end", "supplement"])
def test_exact_document_still_requires_primary_name_and_complete_period(db, gap):
    body, _, _, source, row, proof, _ = checked_packet(
        db, report_type=None, context_gap=gap
    )
    for kind in ("report", "figure"):
        locator = {"kind": kind, "receipt_sha256": row.receipt_sha256}
        if kind == "figure":
            locator["field_id"] = "cover.total_received"
        with pytest.raises(ComparisonImportError):
            local.extract_local_reading(body, source, locator, context=proof)


@pytest.mark.parametrize(
    ("relationship", "account_name", "mark_state"),
    [
        (
            "named_candidate_campaign",
            "Synthetic Candidate for Synthetic School Board",
            "value",
        ),
        (
            "campaign_fund_of_person",
            "Synthetic Candidate( Campaign Fund of Synthetic Candidate )",
            "ambiguous",
        ),
    ],
)
def test_checked_campaign_statement_keeps_complete_account_and_mark(
    db, relationship, account_name, mark_state
):
    body, _, receipt, source, row, proof, _ = checked_packet(
        db,
        account_name=account_name,
        candidate_name=False,
        candidate_mark_state=mark_state,
    )
    result = local.extract_local_reading(
        body,
        source,
        {
            "kind": "candidate_relationship",
            "receipt_sha256": row.receipt_sha256,
            "relationship": relationship,
        },
        context=proof,
    )
    assert result.facts["account_name"] == account_name
    assert result.facts["person_name"] == "Synthetic Candidate"
    assert result.facts["office_literal"] == "Synthetic School Board"
    assert result.facts["relationship"] == relationship
    assert account_name in result.quote
    account = local.verified_local_context(proof, row.receipt_sha256).values()[
        "account"
    ]
    assert account["name"] == account_name and account["candidate_name"] is None
    assert account["issued_id"] is False and account["source_candidate_id"] is None
    mark = next(f for f in receipt["fields"] if f["field_id"] == "cover.candidate_mark")
    assert mark["state"] == mark_state


@pytest.mark.parametrize(
    ("relationship", "name", "mark"),
    [
        (
            "campaign_fund_of_person",
            "Synthetic Candidate( Campaign Fund of Other Person )",
            "value",
        ),
        (
            "campaign_fund_of_person",
            "Association in support of Synthetic Candidate",
            "value",
        ),
        ("campaign_fund_of_person", "Treasurer: Synthetic Candidate", "value"),
        ("named_candidate_campaign", "Synthetic Candidate for Another Office", "value"),
        (
            "named_candidate_campaign",
            "Synthetic Candidate for Synthetic School Board",
            "ambiguous",
        ),
        ("campaign_fund_of_person", "Musgrove4Ramsey", "value"),
    ],
)
def test_campaign_relationship_does_not_invent_a_person_or_source_role(
    db, relationship, name, mark
):
    body, _, _, source, row, proof, _ = checked_packet(
        db, account_name=name, candidate_name=False, candidate_mark_state=mark
    )
    with pytest.raises(ComparisonImportError):
        local.extract_local_reading(
            body,
            source,
            {
                "kind": "candidate_relationship",
                "receipt_sha256": row.receipt_sha256,
                "relationship": relationship,
            },
            context=proof,
        )


def test_explicit_outside_report_does_not_become_own_campaign(db):
    body, _, _, source, row, proof, _ = checked_packet(
        db,
        account_name="Synthetic Candidate( Campaign Fund of Synthetic Candidate )",
        candidate_name=False,
        candidate_mark_state="ambiguous",
        outside_report=True,
    )
    with pytest.raises(ComparisonImportError, match="Outside expenditure"):
        local.extract_local_reading(
            body,
            source,
            {
                "kind": "candidate_relationship",
                "receipt_sha256": row.receipt_sha256,
                "relationship": "campaign_fund_of_person",
            },
            context=proof,
        )


def test_checked_context_derives_nonissued_group_and_keeps_literal_identity(held):
    body, _, _, source, row, proof, _ = held
    locator = {"kind": "account", "receipt_sha256": row.receipt_sha256}
    actual = local.extract_local_reading(body, source, locator, context=proof)
    assert actual.facts["issued_id"] is False
    assert actual.facts["account_id"].startswith("group:")
    assert actual.facts["reviewed_key_basis"]["group_label"] == "SYNTHETIC CANDIDATE"
    assert actual.facts["name"] == "Synthetic Candidate"
    assert actual.facts["source_candidate_id"] is None
    assert "ballot" not in actual.facts and "candidate_id" not in actual.facts
    report = local.extract_local_reading(
        body,
        source,
        {"kind": "report", "receipt_sha256": row.receipt_sha256},
        context=proof,
    )
    assert (
        report.facts["period_start"] == "2026-08-29"
        and report.facts["period_end"] == "2026-10-19"
    )
    assert report.facts["source_report_id"] == "1"
    assert report.facts["received_date"] is None


@pytest.mark.parametrize(
    "attack",
    ["county", "publisher", "group", "pdf", "duplicate", "supplement", "field"],
)
def test_replayed_source_chain_refuses_crossed_context(attack):
    _, bodies, receipt, _ = packet()
    if attack == "county":
        value = b"19;Dakota;62\n"
        h = hashlib.sha256(value).hexdigest()
        bodies[h] = value
        receipt["source_context"]["county_source_sha256"] = h
    elif attack == "publisher":
        value = b'<title>Crow Wing County</title><a href="/other">other</a>'
        h = hashlib.sha256(value).hexdigest()
        bodies[h] = value
        receipt["source_context"]["publisher_source_sha256"] = h
    elif attack == "group":
        receipt["source_context"]["group_label"] = "OTHER PERSON"
    elif attack == "pdf":
        receipt["source_context"]["document_url"] = (
            "https://www.crowwing.gov/DocumentCenter/View/99/Wrong"
        )
    elif attack == "duplicate":
        h = receipt["source_context"]["catalogue_source_sha256"]
        value = bodies[h] * 2
        h = hashlib.sha256(value).hexdigest()
        bodies[h] = value
        receipt["source_context"]["catalogue_source_sha256"] = h
    elif attack == "supplement":
        receipt["source_context"].update(
            document_role="supplement",
            parent_document_url="https://www.crowwing.gov/DocumentCenter/View/99/Wrong",
        )
    else:
        receipt["source_context"]["fields"]["name"] = "unlisted.field"
    with pytest.raises(ComparisonImportError):
        local.replay_source_context(receipt, bodies)


@pytest.mark.parametrize(
    "fake", [None, True, {"checked": True}, {"source_accepted": True}]
)
def test_input_boolean_or_json_cannot_mint_verified_context(fake):
    body, _, receipt, source = packet()
    with pytest.raises(ComparisonImportError):
        local.extract_local_reading(
            body,
            source,
            {
                "kind": "figure",
                "receipt_sha256": readings.receipt_digest(receipt),
                "field_id": "cover.total_received",
            },
            context=fake,
        )
    with pytest.raises(ComparisonImportError):
        readings.VerifiedReadingContext({}, {}, {})
    with pytest.raises(ComparisonImportError):
        local.VerifiedLocalContext({}, {})


@pytest.mark.parametrize("held", [True], indirect=True)
def test_native_replays_exact_amounts_purpose_and_unreconciled_source_total(held):
    body, _, _, source, row, proof, _ = held
    locator = {
        "kind": "figure",
        "receipt_sha256": row.receipt_sha256,
        "field": "disbursements",
    }
    actual = local.extract_local_native(body, source, locator, context=proof)
    assert actual.facts["value"] == "1101.75"
    payment = local.extract_local_native(
        body,
        source,
        {"kind": "payment", "receipt_sha256": row.receipt_sha256, "field": 1},
        context=proof,
    )
    assert payment.facts["amount"] == "536.46" and payment.facts["payee"] is None
    assert payment.facts["purpose"] == "Campaign Signs"
    assert (
        payment.facts["direction"] == "unknown"
        and payment.facts["target_source_candidate_id"] is None
    )
    assert payment.facts["memo"] == {}


def test_current_dispatch_stays_closed_and_generic_joins_stay_strict(held, monkeypatch):
    body, bodies, _, source, row, proof, _ = held
    locator = {
        "kind": "figure",
        "receipt_sha256": row.receipt_sha256,
        "field_id": "cover.total_received",
    }
    actual = local.extract_local_reading(body, source, locator, context=proof)
    binding = dict(
        source_sha256=source["sha256"],
        adapter="local_checked_reading:v1",
        locator=locator,
        quote=actual.quote,
        facts=actual.facts,
    )
    generation = {
        "sources": [
            source,
            *(
                {"sha256": h, "authority": None}
                for h in bodies
                if h != source["sha256"]
            ),
        ]
    }
    monkeypatch.setitem(
        storage.ADAPTERS, "local_checked_reading:v1", local.extract_local_reading
    )
    with pytest.raises(ComparisonImportError, match="adapter could not"):
        storage.validate_binding(
            generation,
            bodies,
            binding,
            actual.facts,
            authority=source["authority"],
            joins=("authority", "account_id", "source_report_id"),
        )
    # Only the server-created verified source-body container carries context.
    verified = storage._VerifiedBodies(
        {row["sha256"]: row for row in generation["sources"]}
    )
    verified.update(bodies)
    verified.reading_context = proof
    storage.validate_binding(
        generation,
        verified,
        binding,
        actual.facts,
        authority=source["authority"],
        joins=("authority", "account_id", "source_report_id"),
    )
    raw = local.extract_local_reading(
        body,
        source,
        {
            "kind": "field",
            "receipt_sha256": row.receipt_sha256,
            "field_id": "cover.total_received",
        },
        context=proof,
    )
    binding.update(
        locator={
            "kind": "field",
            "receipt_sha256": row.receipt_sha256,
            "field_id": "cover.total_received",
        },
        quote=raw.quote,
        facts=raw.facts,
    )
    with pytest.raises(ComparisonImportError, match="identify this exact entity"):
        storage.validate_binding(
            generation,
            verified,
            binding,
            raw.facts,
            joins=("authority", "account_id", "source_report_id"),
        )


def test_private_receipt_and_decision_info_never_enters_public_locator():
    _, _, receipt, _ = packet()
    locator = local.public_locator(
        {
            "kind": "field",
            "receipt_sha256": "a" * 64,
            "field_id": "cover.total_received",
        },
        receipt,
    )
    assert set(locator) == {"page", "bounds", "field"}


def test_authority_opens_actual_publisher_and_scope_cannot_escape_generation(held, db):
    body, bodies, receipt, source, row, proof, store = held
    with pytest.raises(ComparisonImportError, match="outside this exact generation"):
        readings.load_verified_reading_context(
            db, store, [row.receipt_sha256], allowed_source_hashes={source["sha256"]}
        )
    h = receipt["source_context"]["publisher_source_sha256"]
    publisher = dict(
        sha256=h,
        authority=source["authority"],
        url=receipt["source_context"]["publisher_url"],
    )
    authority = local.extract_local_reading(
        bodies[h],
        publisher,
        {"kind": "authority", "receipt_sha256": row.receipt_sha256},
        context=proof,
    )
    assert authority.facts["key"] == "local:county:18"
    assert "Crow Wing County" in authority.quote
    with pytest.raises(ComparisonImportError):
        local.extract_local_reading(
            body,
            source,
            {"kind": "authority", "receipt_sha256": row.receipt_sha256},
            context=proof,
        )
    requirements = readings.reading_requirements(db, [row.receipt_sha256])
    assert set(requirements[row.receipt_sha256]["original_hashes"]) == set(bodies)
    assert "reviewed_by" not in str(requirements)


@pytest.mark.parametrize(
    "kind",
    [
        "blank_period",
        "missing_candidate_mark",
        "wrong_name_native",
        "wrong_source_url",
        "bank_as_payment",
    ],
)
def test_unchecked_context_or_detail_cannot_become_normalized_finance(db, kind):
    body, bodies, receipt, source = packet()
    if kind == "blank_period":
        receipt["source_context"]["fields"]["period_start"] = None
    elif kind == "missing_candidate_mark":
        receipt["source_context"]["fields"]["candidate_mark"] = None
        with pytest.raises(ComparisonImportError, match="candidate form mark"):
            local.replay_source_context(receipt, bodies)
        return
    elif kind == "wrong_name_native":
        field = next(f for f in receipt["fields"] if f["field_id"] == "cover.name")
        field["literal"] = field["normalized"] = "Other printed name"
        receipt["pages"][0]["transcript"] = "\n".join(
            f"{f['field_id']} | {f['label']} | {f['literal']} | {f['state']}"
            for f in receipt["fields"]
        )
    store = MemoryStore()
    for value in bodies.values():
        archive_source(db, store, value)
    row = readings.record_reading(
        db,
        store,
        receipt=receipt,
        decision="checked",
        reviewed_by="private",
        reason="Synthetic explicit reading",
        expected_previous_id=None,
    )
    proof = readings.load_verified_reading_context(
        db, store, [row.receipt_sha256], allowed_source_hashes=set(bodies)
    )
    if kind == "wrong_source_url":
        source["url"] = "https://www.crowwing.gov/DocumentCenter/View/99/Wrong"
    with pytest.raises(ComparisonImportError):
        if kind == "wrong_name_native":
            local.extract_local_native(
                body,
                source,
                {
                    "kind": "figure",
                    "receipt_sha256": row.receipt_sha256,
                    "field": "total_received",
                },
                context=proof,
            )
        elif kind == "bank_as_payment":
            local.extract_local_reading(
                body,
                source,
                {
                    "kind": "payment",
                    "receipt_sha256": row.receipt_sha256,
                    "page": 1,
                    "row": 1,
                },
                context=proof,
            )
        else:
            local.extract_local_reading(
                body,
                source,
                {
                    "kind": "figure",
                    "receipt_sha256": row.receipt_sha256,
                    "field_id": "cover.total_received",
                },
                context=proof,
            )


def test_field_selector_preserves_actual_page_and_rejects_forged_page(held):
    body, _, receipt, source, row, proof, _ = held
    locator = local.field_locator(
        row.receipt_sha256, receipt, "figure", "cover.total_received"
    )
    assert locator["page"] == 1
    actual = local.extract_local_reading(body, source, locator, context=proof)
    assert actual.facts["value"] == "1482.11"
    for page in [2, True]:
        with pytest.raises(ComparisonImportError, match="another source page"):
            local.extract_local_reading(
                body, source, locator | {"page": page}, context=proof
            )
    zero = local.extract_local_native(
        body,
        source,
        {
            "kind": "figure",
            "receipt_sha256": row.receipt_sha256,
            "field": "in_kind_contributions",
        },
        context=proof,
    )
    assert zero.facts["value"] == "0.00"


def test_unlisted_native_row_cannot_escape_visible_receipt_scope(held):
    body, _, _, source, row, proof, _ = held
    with pytest.raises(ComparisonImportError, match="individually checked as visible"):
        local.extract_local_native(
            body,
            source,
            {"kind": "payment", "receipt_sha256": row.receipt_sha256, "field": 1},
            context=proof,
        )


def test_black_overlay_native_purpose_is_not_recovered_into_public_fields_or_quote(db):
    from io import BytesIO
    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import ContentStream

    body, bodies, receipt, source = packet(checked_rows=True)
    writer = PdfWriter()
    reader = PdfReader(BytesIO(body))
    writer.append_pages_from_reader(reader)
    page = writer.pages[0]
    # Preserve text beneath a visible black overlay, as in the retained failure.
    contents = page.get_contents()
    assert contents is not None
    stream = ContentStream(None, writer)
    stream.set_data(contents.get_data() + b"\nq 0 0 0 rg 106 327.5 362 21 re f Q\n")
    page.replace_contents(stream)
    output = BytesIO()
    writer.write(output)
    changed = output.getvalue()
    assert (
        local.read_native_local_report(changed)["listed_disbursements"][0]["purpose"]
        == "Campaign Signs"
    )
    fields = deepcopy(receipt["fields"])
    purpose = next(f for f in fields if f["field_id"] == "disbursements.1.purpose")
    purpose.update(state="redacted", literal="", normalized=None)
    proposal = readings.prepare_receipt(
        changed,
        fields=fields,
        document_kind="financial_report",
        source_context=receipt["source_context"],
    )
    store = MemoryStore()
    for value in [*bodies.values(), changed]:
        archive_source(db, store, value)
    row = readings.record_reading(
        db,
        store,
        receipt=proposal,
        decision="checked",
        reviewed_by="private",
        reason="Synthetic visible cells and redacted purpose checked",
        expected_previous_id=None,
    )
    source = source | {"sha256": proposal["original_sha256"]}
    proof = readings.load_verified_reading_context(
        db,
        store,
        [row.receipt_sha256],
        allowed_source_hashes=set(bodies) | {source["sha256"]},
    )
    payment = local.extract_local_native(
        changed,
        source,
        {"kind": "payment", "receipt_sha256": row.receipt_sha256, "field": 1},
        context=proof,
    )
    assert payment.facts["purpose"] is None and payment.facts["amount"] == "536.46"
    assert "Campaign Signs" not in payment.quote and "purpose" not in payment.quote
    bad = deepcopy(proposal)
    next(f for f in bad["fields"] if f["field_id"] == "disbursements.1.purpose")[
        "literal"
    ] = "Campaign Signs"
    with pytest.raises(ComparisonImportError):
        readings.validate_receipt(bad)
