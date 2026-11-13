"""Normal checked source admission for a nameless standalone expense supplement."""

# ruff: noqa: F811, F401
from datetime import date
from copy import deepcopy
from functools import wraps
from io import BytesIO
import hashlib
import json
from types import SimpleNamespace
from typing import Any
from urllib.parse import urljoin

from pypdf import PdfWriter
from pypdf.generic import NameObject, DictionaryObject, DecodedStreamObject
from alethical.db import models as m
from alethical.pipeline import election_external_finance as storage
from alethical.pipeline import election_source_provenance as provenance
from alethical.pipeline import election_local_context as context
from alethical.pipeline import election_olmsted_attachments as attachments
from alethical.pipeline import election_account_reviews as reviews
from alethical.pipeline.election_comparison import digest
from alethical.pipeline.election_external_adapters import register_external_adapters
from alethical.api.services import election_external_finance_reads as reads
from alethical.tests.test_election_local_reading_integration import db, isolated_engine
from alethical.tests.test_election_olmsted_attachments import catalogue


import pytest

from alethical.pipeline import election_source_readings as readings
from alethical.pipeline import election_local_sources as local
from alethical.pipeline.election_comparison import ComparisonImportError, archive_source
from alethical.tests.test_election_comparison_storage import MemoryStore
from alethical.tests.test_election_local_sources import packet


def test_ordinary_nameless_supplement_remains_refused(db):
    body, bodies, receipt, source = packet(checked_rows=True)
    receipt["document_kind"] = "supplement"
    context = receipt["source_context"]
    context.update(
        document_role="supplement",
        parent_document_url=context["document_url"],
        document_url="https://www.crowwing.gov/DocumentCenter/View/2/Addition",
    )
    context["fields"] = {
        **{key: None for key in context["fields"] if key != "report_type"},
        "report_type": [],
    }
    source["url"] = context["document_url"]
    store = MemoryStore()
    for value in bodies.values():
        archive_source(db, store, value)
    row = readings.record_reading(
        db,
        store,
        receipt=receipt,
        decision="checked",
        reviewed_by="private",
        reason="Invented nameless supplement source observations",
        expected_previous_id=None,
    )
    proof = readings.load_verified_reading_context(
        db, store, [row.receipt_sha256], allowed_source_hashes=set(bodies)
    )
    with pytest.raises(
        ComparisonImportError, match="Local account name is not checked"
    ) as error:
        local.extract_local_reading(
            body,
            source,
            {"kind": "report", "receipt_sha256": row.receipt_sha256},
            context=proof,
        )
    print(
        f"Normal checked nameless supplement refuses ordinary financial identity: {error.value}"
    )


def field(
    name,
    bounds,
    literal,
    *,
    kind="text",
    state="value",
    record="cover",
    row=None,
    label=None,
):
    return dict(
        field_id=name,
        page=1,
        bounds=bounds,
        label=label or name,
        literal=literal,
        state=state,
        value_type=kind,
        normalized=readings.normalize_field(literal, kind, state),
        currency="USD" if kind == "money" else None,
        record_type=record,
        row=row,
    )


def pdf(fields):
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
    for f in fields:
        if f["field_id"] == "disbursements.item_area":
            continue  # A scope observation of the existing reference, not new printed text.
        text = (
            f["literal"].replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        )
        x, y = f["bounds"][:2]
        commands.append(f"BT /F1 4 Tf 1 0 0 1 {x} {792 - y - 7} Tm ({text}) Tj ET")
    stream = DecodedStreamObject()
    stream.set_data("\n".join(commands).encode("ascii"))
    page[NameObject("/Contents")] = writer._add_object(stream)
    out = BytesIO()
    writer.write(out)
    return out.getvalue()


@pytest.fixture
def attachment_generation(db, monkeypatch, tmp_path, request):
    monkeypatch.setattr(storage, "ADAPTERS", {})
    register_external_adapters()
    options = getattr(request, "param", {})
    store = MemoryStore()
    originals = {}
    metadata = {}
    copied = "2026-11-12T00:00:00+00:00"
    name = "Synthetic Candidate"
    catalogue_body = catalogue().replace(b"Invented Candidate", name.encode())
    county = b"55;Olmsted;1\n"
    county_url = "https://electionresultsfiles.sos.mn.gov/20261103/Cntytbl.txt"
    directory_url = context.DIRECTORIES["mn_cfb_local_directory"]
    directory = f'<div class="link-list"><h2>County</h2><ul class="link-list"><li class="link-item"><a href="{attachments.CATALOGUE_URL}">Olmsted</a></li></ul></div>'.encode()

    def capture(body, url, media, *, file=None):
        h = hashlib.sha256(body).hexdigest()
        archive_source(db, store, body)
        originals[h] = body
        metadata[h] = dict(
            sha256=h,
            url=url,
            media_type=media,
            copied_at=copied,
            authority=None if url == county_url or file else "local:county:55",
            file=file or h,
        )
        evidence = json.dumps(
            dict(
                requested_url=url,
                final_url=url,
                state="captured",
                redirects=[],
                sha256=h,
                bytes=len(body),
                fetched_at=copied,
                content_type=media,
            )
        ).encode()
        row = provenance.record_provenance(
            db,
            store,
            receipt=provenance.prepare_acquisition(evidence),
            evidence_body=evidence,
            decision="checked",
            reviewed_by="PRIVATE_TEST",
            reason="Invented source acquisition",
            expected_previous_id=None,
        )
        return row

    directory_row = capture(directory, directory_url, "text/html")
    county_row = capture(county, county_url, "text/plain")
    catalogue_row = capture(catalogue_body, attachments.CATALOGUE_URL, "text/html")
    root = dict(
        schema=provenance.RECIPIENT,
        original_routing_group="mn-local:county:55",
        election_date="2026-11-03",
        recipient=dict(
            namespace="county",
            source_id="55",
            county_ids=["55"],
            district_type=None,
            municipality_type=None,
        ),
        sos_rows=[
            dict(
                source_sha256=hashlib.sha256(county).hexdigest(),
                line=1,
                literal=county.decode().strip(),
                kind="county",
                acquisition_receipt_id=county_row.receipt_sha256,
            )
        ],
        directory=dict(
            family="mn_cfb_local_directory",
            source_sha256=hashlib.sha256(directory).hexdigest(),
            source_url=directory_url,
            acquisition_receipt_id=directory_row.receipt_sha256,
            anchor_index=1,
            line=1,
            label="Olmsted",
            category="County",
            href=attachments.CATALOGUE_URL,
            base_href=None,
            shared_target_entries=[],
        ),
        publisher_namespace="synthetic-olmsted",
        entry_url=attachments.CATALOGUE_URL,
        claim_scope="official_publisher_for_typed_recipient",
    )
    root_row = provenance.record_provenance(
        db,
        store,
        receipt=root,
        decision="checked",
        reviewed_by="PRIVATE_TEST",
        reason="Invented exact county root",
        expected_previous_id=None,
    )
    parent_fields = [
        field(
            "cover.name",
            [20, 30, 250, 50],
            name,
            label="Name of candidate or committee",
        ),
        field(
            "cover.office",
            [20, 55, 280, 75],
            "Olmsted County Attorney",
            label="Office sought",
        ),
        field(
            "cover.period_start",
            [20, 80, 100, 95],
            "04/07/26",
            kind="date",
            label="From",
        ),
        field(
            "cover.period_end", [120, 80, 200, 95], "07/31/26", kind="date", label="To"
        ),
        field(
            "cover.candidate",
            [20, 100, 40, 115],
            "?",
            kind="mark",
            state="ambiguous",
            label="Candidate",
        ),
        field(
            "cover.report_type.preprimary",
            [20, 125, 40, 140],
            "X",
            kind="mark",
            label="Pre-primary",
        ),
        field(
            "cover.total_received",
            [300, 150, 400, 165],
            "100.00",
            kind="money",
            label="TOTAL AMOUNT RECEIVED",
        ),
        field(
            "cover.disbursements",
            [450, 315, 580, 330],
            "",
            kind="money",
            state="blank",
            label="Total",
        ),
        field(
            "disbursements.heading",
            [20, 170, 180, 190],
            "Disbursements",
            label="Disbursements",
        ),
        field(
            "attachment.reference_cell",
            [20, 210, 300, 300],
            "See attached",
            label="Purpose",
        ),
        field(
            "disbursements.blank",
            [300, 210, 580, 300],
            "",
            state="blank",
            label="Remaining item cells",
        ),
    ]
    parent_fields.append(
        field(
            "disbursements.item_area",
            [20, 210, 580, 300],
            "See attached",
            label="Disbursements item area",
        )
    )
    if options.get("association_mark"):
        parent_fields.append(
            field(
                "cover.association",
                [60, 100, 80, 115],
                "X",
                kind="mark",
                label="Association",
            )
        )
    if options.get("amended_mark"):
        parent_fields.append(
            field(
                "cover.report_type.amended",
                [60, 125, 80, 140],
                "X",
                kind="mark",
                label="Amended",
            )
        )
    child_fields = [
        field(
            "expense.heading",
            [20, 20, 160, 40],
            "Expenditures",
            record="other",
            label="Expenditures",
        )
    ]
    for i in range(1, 36):
        y = 50 + (i - 1) * 20
        for key, bounds, literal, kind, label in [
            (
                "date",
                [20, y, 95, y + 15],
                f"05/{(i - 1) % 28 + 1:02}/26",
                "date",
                "Date",
            ),
            ("payee", [100, y, 200, y + 15], f"Vendor {i}", "text", "Recipient"),
            (
                "payee_address",
                [205, y, 390, y + 15],
                "1 Main St, Rochester, MN 55901",
                "text",
                "Address",
            ),
            ("purpose", [395, y, 480, y + 15], "Expense", "text", "Purpose"),
            ("amount", [485, y, 575, y + 15], f"{i}.00", "money", "Amount"),
        ]:
            child_fields.append(
                field(
                    f"expense.r{i}.{key}",
                    bounds,
                    literal,
                    kind=kind,
                    label=label,
                    record="disbursement",
                    row=i,
                )
            )
    if options.get("first_date"):
        cell = next(f for f in child_fields if f["field_id"] == "expense.r1.date")
        cell.update(
            literal=options["first_date"],
            normalized=readings.normalize_field(options["first_date"], "date", "value"),
        )
    if options.get("unchecked_address"):
        cell = next(
            f for f in child_fields if f["field_id"] == "expense.r1.payee_address"
        )
        cell.update(literal="", state="not_checked", normalized=None)
    parsed = context._HTML(catalogue_body)
    documents = []
    for index, (kind, fields) in enumerate(
        [("financial_report", parent_fields), ("supplement", child_fields)]
    ):
        body = pdf(fields)
        anchor = parsed.all("a")[index]
        url = urljoin(attachments.CATALOGUE_URL, anchor.attrs["href"])
        acquisition = capture(body, url, "application/pdf")
        edge = dict(
            kind="html_anchor",
            source_sha256=hashlib.sha256(catalogue_body).hexdigest(),
            anchor_index=index + 1,
            line=anchor.line,
            href=anchor.attrs["href"],
            label=context._text(anchor),
            base_href=None,
            target_url=url,
        )
        mapping = (
            dict(
                name="cover.name",
                office="cover.office",
                candidate_name=None,
                candidate_mark=None,
                period_start="cover.period_start",
                period_end="cover.period_end",
                report_type=["cover.report_type.preprimary"],
            )
            if index == 0
            else dict(
                name=None,
                office=None,
                candidate_name=None,
                candidate_mark=None,
                period_start=None,
                period_end=None,
                report_type=[],
            )
        )
        source_context = dict(
            kind=context.CONTEXT_KIND,
            root_receipt_id=root_row.receipt_sha256,
            edges=[
                dict(kind="acquisition", receipt_id=catalogue_row.receipt_sha256),
                edge,
                dict(kind="acquisition", receipt_id=acquisition.receipt_sha256),
            ],
            publisher_account=dict(
                kind="physical_section",
                namespace="synthetic-olmsted",
                issued_id=False,
                account_id=None,
                name_as_source=None,
                location=None,
                office=None,
                district=None,
            ),
            document_role="primary" if index == 0 else "supplement",
            fields=mapping,
            recipient_binding=None,
        )
        receipt = readings.prepare_receipt(
            body,
            fields=fields,
            document_kind=kind,
            source_context=source_context,
            reading_scope=dict(
                cover=dict(
                    page=1,
                    bounds=[20, 30, 280, 75] if index == 0 else [20, 20, 160, 40],
                ),
                regions=[dict(page=1, bounds=[0, 0, 612, 792], role="cover")],
            ),
        )
        row = readings.record_reading(
            db,
            store,
            receipt=receipt,
            decision="checked",
            reviewed_by="PRIVATE_TEST",
            reason="Invented checked attachment source",
            expected_previous_id=None,
        )
        documents.append(
            SimpleNamespace(
                body=body,
                receipt=receipt,
                row=row,
                source=metadata[receipt["original_sha256"]],
            )
        )
    proof = readings.load_verified_reading_context(
        db,
        store,
        [x.row.receipt_sha256 for x in documents],
        allowed_source_hashes=set(originals),
        election_date=date(2026, 11, 3),
    )
    section = dict(
        page=1,
        item_bounds=[20, 210, 580, 300],
        heading_field_id="disbursements.heading",
        reference_field_id="attachment.reference_cell",
        item_area_field_id="disbursements.item_area",
        blank_field_ids=["disbursements.blank"],
    )

    def binding(kind, *, row=None, field_id=None):
        d = documents[1 if kind.startswith("attachment_") else 0]
        locator = dict(kind=kind, receipt_sha256=d.row.receipt_sha256)
        if kind.startswith("attachment_"):
            locator.update(
                profile=attachments.PROFILE,
                parent_receipt_sha256=documents[0].row.receipt_sha256,
                reference_section=deepcopy(section),
                page=1,
                row=row,
            )
        if field_id:
            locator["field_id"] = field_id
        if kind == "candidate_relationship":
            locator["relationship"] = "publisher_lists_report_for_person"
        actual = local.extract_local_reading(d.body, d.source, locator, context=proof)
        return dict(
            source_sha256=d.receipt["original_sha256"],
            adapter="local_checked_reading:v1",
            locator=locator,
            quote=actual.quote,
            facts=actual.facts,
        )

    values = proof.local_values(documents[0].row.receipt_sha256)
    authority = values["authority"] | dict(
        status="checked", binding=binding("authority")
    )
    account = values["account"] | dict(status="checked", binding=binding("account"))
    report = values["report"] | dict(
        report_key=digest(["Olmsted report", documents[0].receipt["original_sha256"]]),
        source_sha256=documents[0].receipt["original_sha256"],
        check_status="checked",
        binding=binding("report"),
        figures=[],
    )
    fb = binding("figure", field_id="cover.total_received")
    report["figures"] = [
        {
            k: v
            for k, v in fb["facts"].items()
            if k not in {"authority", "account_id", "source_report_id"}
        }
        | dict(binding=fb)
    ]
    payments = []
    for i in [] if options.get("defer_payments") else range(1, 36):
        amount = binding("attachment_payment", row=i)
        address = binding("attachment_payment_address", row=i)
        payments.append(
            amount["facts"]
            | dict(
                payee_address=address["facts"]["payee_address"],
                payment_key=digest(["Olmsted row", i]),
                report_key=report["report_key"],
                source_sha256=documents[1].receipt["original_sha256"],
                check_status="checked",
                binding=[amount, address],
            )
        )
    ballot = b"05309001;Synthetic Candidate;0530;County Attorney;55;90;NP\n"
    roster = b"0000000000001;Other Local;1000;Mayor;01;00001;\n"
    for file, body in [("cand.txt", ballot), ("LocalCandTbl.txt", roster)]:
        capture(
            body,
            "https://electionresultsfiles.sos.mn.gov/20261103/" + file,
            "text/plain",
            file=file,
        )
    snapshot, race, candidate = publish_result_baseline(
        db, store, tmp_path, ballot, roster, county, originals, metadata
    )
    bh = hashlib.sha256(ballot).hexdigest()
    coverage = [
        r | dict(authority=None, status="unmatched", next_action="Exact account review")
        for r in storage.expected_coverage(snapshot, [race], originals)
    ]
    generation = storage.prepare_generation(
        dict(
            format=1,
            election_key=snapshot.election_key,
            snapshot_id=snapshot.id,
            copied_at=copied,
            sources=list(metadata.values()),
            authorities=[authority],
            accounts=[account],
            reports=[report],
            payments=payments,
            coverage=coverage,
        )
    )
    return SimpleNamespace(
        g=generation,
        store=store,
        originals=originals,
        documents=documents,
        proof=proof,
        values=values,
        account=account,
        report=report,
        payments=payments,
        snapshot=snapshot,
        race=race,
        candidate=candidate,
        binding=binding,
        ballot=ballot,
        ballot_hash=bh,
    )


def test_normal_two_reading_generation_preserves_35_rows(attachment_generation, db):
    held = attachment_generation
    storage.stage_generation(db, held.store, held.g, held.originals)
    assert len(held.g["payments"]) == 35
    assert len({p["source_row_id"] for p in held.g["payments"]}) == 35
    assert held.g["reports"][0]["effective"] is None
    assert held.g["reports"][0]["amendment_status"] == "not_established"
    assert all(
        p["payee_address"]["as_filed"] == "1 Main St, Rochester, MN 55901"
        for p in held.g["payments"]
    )
    assert held.documents[1].receipt["source_context"]["fields"]["name"] is None


def publish_and_review(db, held, monkeypatch):
    storage.stage_generation(db, held.store, held.g, held.originals)
    storage.publish_generation(db, held.store, held.g["id"], expected_previous=None)
    evidence = [
        dict(
            kind="ballot",
            sha256=held.ballot_hash,
            row_number=1,
            literal_row=held.ballot.decode().strip(),
        )
    ]
    for kind, bind in [
        ("authority", held.binding("authority")),
        ("committee_register", held.binding("account")),
        ("report_cover", held.binding("report")),
        ("local_candidate_relationship", held.binding("candidate_relationship")),
    ]:
        evidence.append(
            dict(
                kind=kind,
                sha256=bind["source_sha256"],
                generation_id=held.g["id"],
                binding=bind,
                **(
                    dict(report_key=held.report["report_key"])
                    if kind in {"report_cover", "local_candidate_relationship"}
                    else {}
                ),
                **(
                    dict(
                        reason="Exact invented county publisher person/office/report source statement"
                    )
                    if kind == "local_candidate_relationship"
                    else {}
                ),
            )
        )
    args: dict[str, Any] = dict(
        snapshot_id=held.snapshot.id,
        race_id=held.race.id,
        candidate_id=held.candidate["candidate_id"],
        registration_number=held.account["account_id"],
        authority=held.account["authority"],
        decision="confirmed",
        identity=reviews.candidate_identity(held.race, held.candidate),
        period_start=date(2026, 4, 7),
        period_end=date(2026, 7, 31),
        reason="PRIVATE_TEST checked exact source relationship",
        reviewed_by="PRIVATE_TEST",
        expected_previous_id=None,
        evidence=evidence,
    )
    monkeypatch.setattr(reviews, "raw_file_store_from_env", lambda: held.store)
    held.review = reviews.record_decision(db, **args)
    held.review_args = args
    real_read = reads.candidate_finance
    held.ordinary_render_attempts = []

    @wraps(real_read)
    def no_render_read(*args, **kwargs):
        def refuse(*a, **k):
            held.ordinary_render_attempts.append(1)
            raise AssertionError("Ordinary attachment reads never render")

        with monkeypatch.context() as guard:
            guard.setattr(readings, "render_page", refuse)
            try:
                return real_read(*args, **kwargs)
            finally:
                assert held.ordinary_render_attempts == []

    monkeypatch.setattr(reads, "candidate_finance", no_render_read)
    return dict(
        election_key=held.g["election_key"],
        race_id=held.race.id,
        candidate_id=held.candidate["candidate_id"],
        store=held.store,
    )


def assert_detail(data, held):
    assert len(data["own_payments"]) == 35 and data["payments"] == []
    assert len({p["source_row_id"] for p in data["own_payments"]}) == 35
    assert sorted(p["amount"] for p in data["own_payments"]) == sorted(
        f"{i}.00" for i in range(1, 36)
    )
    assert all(
        p["effective"] is None
        and p["direction"] == "unknown"
        and p.get("target_source_candidate_id") is None
        for p in data["own_payments"]
    )
    for payment in data["own_payments"]:
        row = int(payment["source_row_id"].rsplit(":", 1)[-1])
        assert payment["amount"] == f"{row}.00" and payment["payee"] == f"Vendor {row}"
        assert payment["date"] == f"2026-05-{(row - 1) % 28 + 1:02}"
    assert all(
        p["payee_address"]["as_filed"] == "1 Main St, Rochester, MN 55901"
        for p in data["own_payments"]
    )
    sources = data["own_payments"][0]["sources"]
    parent = held.documents[0].receipt["original_sha256"]
    child = held.documents[1].receipt["original_sha256"]
    cat = hashlib.sha256(
        catalogue().replace(b"Invented Candidate", b"Synthetic Candidate")
    ).hexdigest()
    assert {s["source_sha256"] for s in sources} == {parent, child, cat}
    assert all("page" not in s["locator"] for s in sources if s["source_sha256"] == cat)
    assert any(
        s["source_sha256"] == parent and s["locator"]["bounds"] == [20, 210, 580, 300]
        for s in sources
    )
    assert any(
        s["source_sha256"] == child and s["locator"] == {"page": 1, "row": 1}
        for s in sources
    ) or any(
        s["source_sha256"] == child and set(s["locator"]) == {"page", "row"}
        for s in sources
    )
    text = json.dumps(data)
    assert (
        "PRIVATE_" not in text
        and "receipt_sha256" not in text
        and "parent_receipt" not in text
    )
    assert all(d.row.receipt_sha256 not in text for d in held.documents)
    assert data["reports"][0]["figures"][0]["value"] == "100.00"
    assert all(f["measure"] != "disbursements" for f in data["reports"][0]["figures"])


def test_normal_review_current_pinned_public_source_and_no_ordinary_render(
    attachment_generation, db, monkeypatch, tmp_path
):
    from sqlalchemy.orm import Session

    held = attachment_generation
    query = publish_and_review(db, held, monkeypatch)
    attempts = []

    def refuse(*args, **kwargs):
        attempts.append(1)
        raise AssertionError("Ordinary reads never render")

    monkeypatch.setattr(readings, "render_page", refuse)
    current = reads.candidate_finance(db, **query)
    assert_detail(current, held)
    evidence_path = tmp_path / "healthy-own-detail.json"
    evidence_path.write_text(json.dumps(current, indent=2) + "\n")
    print(f"Saved synthetic healthy own-detail response: {evidence_path}")
    pinned = reads.candidate_finance(
        db, **query, generation_id=held.g["id"], version=current["version"]
    )
    assert_detail(pinned, held)
    db.commit()
    with db.bind.connect().execution_options(
        isolation_level="REPEATABLE READ"
    ) as connection:
        with Session(connection) as reader:
            for document in held.documents:
                body, metadata, headers = reads.source_body(
                    reader,
                    election_key=held.g["election_key"],
                    generation_id=held.g["id"],
                    source_hash=document.receipt["original_sha256"],
                    store=held.store,
                )
                assert (
                    body == document.body
                    and hashlib.sha256(body).hexdigest()
                    == document.receipt["original_sha256"]
                )
                assert (
                    metadata["url"] == document.source["url"]
                    and metadata["copied_at"] == document.source["copied_at"]
                    and metadata["media_type"] == "application/pdf"
                )
                assert headers["X-Content-Type-Options"] == "nosniff"
    assert attempts == []


def test_required_attachment_withdraw_restore_keeps_healthy_parent_figure(
    attachment_generation, db, monkeypatch
):
    from fastapi import HTTPException

    held = attachment_generation
    query = publish_and_review(db, held, monkeypatch)
    first = reads.candidate_finance(db, **query)
    assert_detail(first, held)
    child = held.documents[1]
    withdrawn = readings.record_reading(
        db,
        held.store,
        receipt=child.receipt,
        decision="withdrawn",
        reviewed_by="PRIVATE_TEST",
        reason="Invented attachment withdrawal",
        expected_previous_id=child.row.id,
    )
    with pytest.raises(HTTPException) as error:
        reads.candidate_finance(db, **query, version=first["version"])
    assert error.value.status_code == 409
    fresh = reads.candidate_finance(db, **query)
    assert fresh["own_payments"] == []
    assert (
        fresh["reports"][0]["figures"][0]["value"] == "100.00"
        and fresh["version"] != first["version"]
    )
    historical = reads.candidate_finance(db, **query, generation_id=held.g["id"])
    assert historical["own_payments"] == []
    child.row = readings.record_reading(
        db,
        held.store,
        receipt=child.receipt,
        decision="checked",
        reviewed_by="PRIVATE_TEST",
        reason="Invented checked attachment restored",
        expected_previous_id=withdrawn.id,
    )
    restored = reads.candidate_finance(db, **query)
    assert_detail(restored, held)
    assert restored["version"] != fresh["version"]
    parent = held.documents[0]
    withdrawn = readings.record_reading(
        db,
        held.store,
        receipt=parent.receipt,
        decision="withdrawn",
        reviewed_by="PRIVATE_TEST",
        reason="Invented primary withdrawal",
        expected_previous_id=parent.row.id,
    )
    missing = reads.candidate_finance(db, **query)
    assert missing["own_payments"] == [] and missing["accounts"] == []
    parent.row = readings.record_reading(
        db,
        held.store,
        receipt=parent.receipt,
        decision="checked",
        reviewed_by="PRIVATE_TEST",
        reason="Invented checked primary restored",
        expected_previous_id=withdrawn.id,
    )
    assert_detail(reads.candidate_finance(db, **query), held)


def test_required_original_loss_and_tamper_recover_on_fresh_requests(
    attachment_generation, db, monkeypatch
):
    from fastapi import HTTPException

    held = attachment_generation
    query = publish_and_review(db, held, monkeypatch)
    first = reads.candidate_finance(db, **query)
    assert_detail(first, held)
    for index in [1, 0]:
        document = held.documents[index]
        row = db.get(m.ElectionResultSource, document.receipt["original_sha256"])
        original = held.store.objects.pop(row.object_key)
        with pytest.raises(HTTPException) as error:
            reads.candidate_finance(db, **query, version=first["version"])
        assert error.value.status_code == 409
        fresh = reads.candidate_finance(db, **query)
        assert fresh["own_payments"] == []
        if index == 1:
            assert fresh["reports"][0]["figures"][0]["value"] == "100.00"
        held.store.objects[row.object_key] = b"changed original"
        assert reads.candidate_finance(db, **query)["own_payments"] == []
        held.store.objects[row.object_key] = original
        recovered = reads.candidate_finance(db, **query)
        assert_detail(recovered, held)
        assert recovered["version"] == first["version"]


def test_checked_reading_capacity_is_retryable_not_missing(
    attachment_generation, db, monkeypatch
):
    from fastapi import HTTPException
    from alethical.pipeline.election_source_files import SourceFileLimitError

    held = attachment_generation
    query = publish_and_review(db, held, monkeypatch)
    real = readings.load_verified_reading_context

    def capacity(*args, **kwargs):
        raise SourceFileLimitError("Invented checked-reading capacity")

    monkeypatch.setattr(readings, "load_verified_reading_context", capacity)
    with pytest.raises(HTTPException) as error:
        reads.candidate_finance(db, **query)
    assert error.value.headers is not None
    assert error.value.status_code == 503 and error.value.headers["Retry-After"] == "1"
    monkeypatch.setattr(readings, "load_verified_reading_context", real)
    assert_detail(reads.candidate_finance(db, **query), held)


@pytest.mark.parametrize("which", [0, 1])
def test_original_loss_after_initial_availability_never_leaks_attribution(
    attachment_generation, db, monkeypatch, which
):
    from alethical.api.services.election_source_io import FreshReadStore

    held = attachment_generation
    query = publish_and_review(db, held, monkeypatch)
    good = reads.candidate_finance(db, **query)
    assert_detail(good, held)
    original = db.get(
        m.ElectionResultSource, held.documents[which].receipt["original_sha256"]
    )
    original_key = original.object_key
    calls = []

    class Flaky:
        def get(self, key, destination, *, max_bytes):
            if key == original_key:
                calls.append(key)
                if len(calls) > 1:
                    raise KeyError("Invented loss after initial source availability")
            return held.store.get(key, destination, max_bytes=max_bytes)

    query["store"] = FreshReadStore(Flaky(), limit=0)
    missing = reads.candidate_finance(db, **query)
    assert (
        len(calls) > 1
        and missing["own_payments"] == []
        and missing["version"] != good["version"]
    )
    if which == 1:
        assert missing["reports"][0]["figures"][0]["value"] == "100.00"
    query["store"] = held.store
    assert_detail(reads.candidate_finance(db, **query), held)


@pytest.mark.parametrize(
    "attack",
    [
        "parent_url",
        "parent_copy",
        "parent_mime",
        "child_url",
        "child_copy",
        "child_mime",
    ],
)
def test_both_generation_source_metadata_records_are_exact(
    attachment_generation, db, attack
):
    held = attachment_generation
    payload = {k: deepcopy(v) for k, v in held.g.items() if k != "id"}
    index = 0 if attack.startswith("parent") else 1
    h = held.documents[index].receipt["original_sha256"]
    source = next(s for s in payload["sources"] if s["sha256"] == h)
    if attack.endswith("url"):
        source["url"] = "https://www.olmstedcounty.gov/another.pdf"
    elif attack.endswith("copy"):
        source["copied_at"] = "2026-11-13T00:00:00+00:00"
    else:
        source["media_type"] = "text/plain"
    generation = storage.prepare_generation(payload)
    with pytest.raises(ComparisonImportError):
        storage.stage_generation(db, held.store, generation, held.originals)


def test_normal_candidate_review_rejects_other_county_and_office(
    attachment_generation, db, monkeypatch
):
    held = attachment_generation
    publish_and_review(db, held, monkeypatch)
    for bad in [
        {"county_ids": ["18"], "office_name": "County Attorney"},
        {"county_ids": ["55"], "office_name": "County Sheriff"},
    ]:
        old = held.race.payload
        held.race.payload = {**old, **bad}
        db.flush()
        args = deepcopy(held.review_args)
        args["identity"] = reviews.candidate_identity(held.race, held.candidate)
        args["expected_previous_id"] = held.review.id
        with pytest.raises(ComparisonImportError):
            reviews.record_decision(db, **args)
        held.race.payload = old
        db.flush()


def test_unknown_attachment_report_stays_out_of_expense_totals_and_csv(
    attachment_generation, db, monkeypatch
):
    import csv
    from fastapi import HTTPException
    from sqlalchemy.orm import Session
    from alethical.api.services import election_expense_analytics as expenses

    held = attachment_generation
    query = publish_and_review(db, held, monkeypatch)
    assert_detail(reads.candidate_finance(db, **query), held)
    monkeypatch.setattr(expenses, "raw_file_store_from_env", lambda: held.store)
    # The reused candidate fixture opens reader transactions for independent
    # public calls. Here bulk_finance is nested in the already pinned expense
    # request, so use its unchanged normal function in that same transaction.
    with monkeypatch.context() as request_patch:
        request_patch.setattr(
            reads, "bulk_finance", getattr(reads.bulk_finance, "__wrapped__")
        )
        db.commit()
        with db.bind.connect().execution_options(
            isolation_level="REPEATABLE READ"
        ) as connection:
            with Session(connection) as reader:
                result = expenses.report(reader, election_key=held.g["election_key"])
                assert result["authority_reports"] == []
                assert result["summary"]["source_report_totals"]["amounts"] is None
                assert result["summary"]["public_subsidy_receipts"]["amount"] is None
                body, _ = expenses.export(
                    reader, election_key=held.g["election_key"], format="csv"
                )
                rows = list(csv.DictReader(body.splitlines()))
                assert all(
                    r.get("Payee") not in {f"Vendor {i}" for i in range(1, 36)}
                    for r in rows
                )
                with pytest.raises(HTTPException) as error:
                    expenses.report(
                        reader,
                        election_key=held.g["election_key"],
                        report_keys=[held.report["report_key"]],
                    )
                assert error.value.status_code == 422
    assert_detail(reads.candidate_finance(db, **query), held)


def publish_result_baseline(
    db, store, directory, ballot, roster, county, originals, metadata
):
    """One tiny normal result publication, with actual source parser/fingerprints."""
    from argparse import Namespace
    from sqlalchemy import select
    from alethical.tests.test_election_comparison_command import command
    from alethical.pipeline import election_comparison as results

    precinct = (
        b"MN;55;0001;0530;County Attorney;;9001;Synthetic Candidate;;;NP;1;1;1;100.00;1\n"
        b"MN;55;0001;0530;County Attorney;;9901;WRITE-IN;;;WI;1;1;0;0.00;1\n"
    )
    files = {
        "cand.txt": ballot,
        "LocalCandTbl.txt": roster,
        "allracesbyprecinct.txt": precinct,
        "allracesbycounty.txt": precinct.replace(b";0001;", b";;"),
        "PrctTbl.txt": b"55;0001;ROCHESTER;1;10A;01;09;3001;00460;\n",
        "Cntytbl.txt": county,
        "pctstats.txt": b"MN;55;0001;ROCHESTER;1;10;0;1;0;0;0;1\n",
        "home.html": b'<h1>State General Election</h1><p>Tuesday, November 3, 2026</p><p>Results are unofficial until canvassing</p><a href="/Results?ersElectionId=201&amp;scenario=state">Results</a>',
    }
    manifest = []
    for name, body in files.items():
        (directory / name).write_bytes(body)
        manifest.append(
            dict(
                file=name,
                url="https://electionresults.sos.mn.gov/20261103"
                if name == "home.html"
                else "https://electionresultsfiles.sos.mn.gov/20261103/" + name,
                sha256=hashlib.sha256(body).hexdigest(),
                bytes=len(body),
                fetched_at="2026-11-12T00:00:00+00:00",
            )
        )
    path = directory / "manifest.json"
    path.write_text(json.dumps(manifest))
    generation, bodies = command.prepare_from_files(
        Namespace(
            directory=directory,
            manifest=path,
            election_date=date(2026, 11, 3),
            election_id="201",
            stage="general",
            status_file="home.html",
        )
    )
    by_hash = {hashlib.sha256(body).hexdigest(): body for body in bodies.values()}
    for source in generation["sources"]:
        body = by_hash[source["sha256"]]
        archive_source(db, store, body)
        originals[source["sha256"]] = body
        metadata.setdefault(
            source["sha256"],
            dict(
                sha256=source["sha256"],
                authority=None,
                url=source["url"],
                media_type="text/html"
                if source.get("file") == "home.html"
                else "text/plain",
                copied_at=source["fetched_at"],
                file=source["file"],
            ),
        )
    sid = results.stage_generation(db, generation)
    results.publish_generation(db, sid, expected_previous=None)
    snapshot = db.get(m.ElectionComparisonSnapshot, sid)
    races = list(
        db.scalars(
            select(m.ElectionComparisonRace).where(
                m.ElectionComparisonRace.snapshot_id == sid
            )
        )
    )
    race = next(r for r in races if r.payload["office_name"] == "County Attorney")
    candidate = next(
        c for c in race.payload["candidates"] if c["name"] == "Synthetic Candidate"
    )
    assert candidate["votes"] == 1 and candidate["candidate_id"] == "05309001"
    return snapshot, race, candidate


def test_explicit_old_generation_keeps_both_required_current_reading_heads(
    attachment_generation, db, monkeypatch
):
    from fastapi import HTTPException

    held = attachment_generation
    query = publish_and_review(db, held, monkeypatch)
    original = reads.candidate_finance(db, **query)
    assert_detail(original, held)
    payload = {k: deepcopy(v) for k, v in held.g.items() if k != "id"}
    payload["coverage"][0]["next_action"] = (
        "Same source scope, second normal generation"
    )
    newer = storage.prepare_generation(payload)
    storage.stage_generation(db, held.store, newer, held.originals)
    storage.publish_generation(
        db, held.store, newer["id"], expected_previous=held.g["id"]
    )
    assert_detail(reads.candidate_finance(db, **query), held)
    pinned = reads.candidate_finance(db, **query, generation_id=held.g["id"])
    assert_detail(pinned, held)
    child = held.documents[1]
    withdrawn = readings.record_reading(
        db,
        held.store,
        receipt=child.receipt,
        decision="withdrawn",
        reviewed_by="PRIVATE_TEST",
        reason="Invented historical required attachment withdrawal",
        expected_previous_id=child.row.id,
    )
    with pytest.raises(HTTPException) as error:
        reads.candidate_finance(
            db, **query, generation_id=held.g["id"], version=pinned["version"]
        )
    assert error.value.status_code == 409
    assert reads.candidate_finance(db, **query)["own_payments"] == []
    old = reads.candidate_finance(db, **query, generation_id=held.g["id"])
    assert old["own_payments"] == []
    assert old["reports"][0]["figures"][0]["value"] == "100.00"
    child.row = readings.record_reading(
        db,
        held.store,
        receipt=child.receipt,
        decision="checked",
        reviewed_by="PRIVATE_TEST",
        reason="Invented current and historical exact attachment restoration",
        expected_previous_id=withdrawn.id,
    )
    assert_detail(reads.candidate_finance(db, **query), held)
    assert_detail(
        reads.candidate_finance(db, **query, generation_id=held.g["id"]), held
    )


def test_normal_closed_attachment_locator_cannot_borrow_another_section(
    attachment_generation,
):
    held = attachment_generation
    good = held.binding("attachment_payment", row=1)
    for attack in [
        "contributions",
        "partial",
        "uncertain_total",
        "other_page",
        "same_id",
        "extra_id",
    ]:
        locator = deepcopy(good["locator"])
        section = locator["reference_section"]
        if attack == "contributions":
            section["heading_field_id"] = "cover.office"
        elif attack == "partial":
            section["item_bounds"][2] -= 0.001
        elif attack == "uncertain_total":
            section["blank_field_ids"] = ["cover.disbursements"]
        elif attack == "other_page":
            section["page"] = 2
        elif attack == "same_id":
            locator["parent_receipt_sha256"] = locator["receipt_sha256"]
        else:
            locator["another_parent_receipt"] = "f" * 64
        with pytest.raises(ComparisonImportError):
            local.extract_local_reading(
                held.documents[1].body,
                held.documents[1].source,
                locator,
                context=held.proof,
            )
    assert held.binding("attachment_payment", row=1) == good


@pytest.mark.parametrize(
    "attachment_generation",
    [
        dict(first_date="08/01/26", defer_payments=True),
        dict(amended_mark=True, defer_payments=True),
    ],
    indirect=True,
)
def test_checked_source_conflict_never_creates_an_attributed_payment(
    attachment_generation,
):
    held = attachment_generation
    with pytest.raises(ComparisonImportError):
        held.binding("attachment_payment", row=1)
    assert held.documents[1].receipt["source_context"]["fields"]["period_start"] is None


@pytest.mark.parametrize(
    "attachment_generation",
    [dict(unchecked_address=True, defer_payments=True)],
    indirect=True,
)
def test_unchecked_address_cannot_become_a_checked_all_null_address(
    attachment_generation,
):
    held = attachment_generation
    assert held.binding("attachment_payment", row=1)["facts"]["amount"] == "1.00"
    with pytest.raises(ComparisonImportError):
        held.binding("attachment_payment_address", row=1)


@pytest.mark.parametrize(
    "attachment_generation", [dict(association_mark=True)], indirect=True
)
def test_contrary_mark_remains_an_unapproved_candidate_relationship(
    attachment_generation, db, monkeypatch
):
    held = attachment_generation
    storage.stage_generation(db, held.store, held.g, held.originals)
    with pytest.raises(
        ComparisonImportError, match="publisher person/report relationship"
    ):
        held.binding("candidate_relationship")
    # Normal operator-review proposal still cannot bypass that exact source gate.
    binder = held.binding

    def proposed(kind, **kwargs):
        if kind != "candidate_relationship":
            return binder(kind, **kwargs)
        base = binder("report")
        base["locator"] = dict(
            kind="candidate_relationship",
            receipt_sha256=held.documents[0].row.receipt_sha256,
            relationship="publisher_lists_report_for_person",
        )
        base["facts"] = {
            k: held.report[k]
            for k in (
                "authority",
                "account_id",
                "source_report_id",
                "period_start",
                "period_end",
            )
        } | dict(
            account_name="Synthetic Candidate",
            person_name="Synthetic Candidate",
            office_literal="County Attorney",
            cover_office_literal="Olmsted County Attorney",
            relationship="publisher_lists_report_for_person",
        )
        base["quote"] = "Unapproved invented relationship proposal"
        return base

    held.binding = proposed
    with pytest.raises(ComparisonImportError):
        publish_and_review(db, held, monkeypatch)
    assert all(
        f["state"] == "value" and f["literal"] == "X"
        for f in held.documents[0].receipt["fields"]
        if f["field_id"] == "cover.association"
    )
