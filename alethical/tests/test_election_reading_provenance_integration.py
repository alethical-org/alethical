"""Real source-review chains gate reading, generation membership and public facts."""

# ruff: noqa: F811, F401
from copy import deepcopy
from datetime import date
import hashlib
import json
import csv
import io

import pytest

from alethical.pipeline import election_source_readings as r
from alethical.pipeline import election_source_provenance as p
from alethical.pipeline import election_local_context as c
from alethical.pipeline import election_local_sources as local
from alethical.pipeline import election_external_finance as finance
from alethical.pipeline.election_comparison import archive_source, ComparisonImportError
from alethical.pipeline.election_source_files import SourceFileLimitError
from alethical.db import models as m
from alethical.tests.test_election_comparison_storage import MemoryStore
from alethical.tests.test_election_local_reading_integration import (
    db,
    local_generation,
    publish,
    reads,
)
from alethical.tests.test_election_source_review_concurrency import isolated_engine
from alethical.tests.test_election_local_sources import packet
from sqlalchemy.orm import Session


def provenance_chain(
    db,
    store,
    body,
    receipt,
    *,
    election_date="2026-11-03",
    cover_page=1,
    document_media_type="application/pdf",
):
    """Invented documents and collector observations, never real source approval."""
    entry = "https://www.crowwing.gov/synthetic-reports"
    document = entry + "/report.pdf"
    county_url = (
        "https://electionresultsfiles.sos.mn.gov/"
        + election_date.replace("-", "")
        + "/Cntytbl.txt"
    )
    county = b"18;Crow Wing;62\n"
    directory = (
        '<div class="link-list"><h2>County</h2><ul class="link-list">'
        f'<li class="link-item"><a href="{entry}">Crow Wing</a></li></ul></div>'
    ).encode()
    catalogue = b'<a href="/synthetic-reports/report.pdf">Report</a>'
    originals = {
        hashlib.sha256(b).hexdigest(): b for b in (county, directory, catalogue, body)
    }
    for original in originals.values():
        archive_source(db, store, original)

    def capture(value, url, media):
        evidence = json.dumps(
            {
                "requested_url": url,
                "final_url": url,
                "state": "captured",
                "redirects": [],
                "sha256": hashlib.sha256(value).hexdigest(),
                "bytes": len(value),
                "fetched_at": "2026-11-12T00:00:00+00:00",
                "content_type": media,
            }
        ).encode()
        proposed = p.prepare_acquisition(evidence)
        row = p.record_provenance(
            db,
            store,
            receipt=proposed,
            evidence_body=evidence,
            decision="checked",
            reviewed_by="PRIVATE_TEST_REVIEWER",
            reason="PRIVATE_TEST_CAPTURE",
            expected_previous_id=None,
        )
        return row, proposed

    directory_row, _ = capture(
        directory, c.DIRECTORIES["mn_cfb_local_directory"], "text/html"
    )
    county_row, _ = capture(
        county,
        county_url,
        "text/plain",
    )
    catalogue_row, catalogue_receipt = capture(catalogue, entry, "text/html")
    document_row, _ = capture(body, document, document_media_type)
    root = {
        "schema": p.RECIPIENT,
        "original_routing_group": "mn-local:county:18",
        "election_date": election_date,
        "recipient": {
            "namespace": "county",
            "source_id": "18",
            "county_ids": ["18"],
            "district_type": None,
            "municipality_type": None,
        },
        "sos_rows": [
            {
                "source_sha256": hashlib.sha256(county).hexdigest(),
                "line": 1,
                "literal": county.decode().strip(),
                "kind": "county",
                "acquisition_receipt_id": county_row.receipt_sha256,
            }
        ],
        "directory": {
            "family": "mn_cfb_local_directory",
            "source_sha256": hashlib.sha256(directory).hexdigest(),
            "source_url": c.DIRECTORIES["mn_cfb_local_directory"],
            "acquisition_receipt_id": directory_row.receipt_sha256,
            "anchor_index": 1,
            "line": 1,
            "label": "Crow Wing",
            "category": "County",
            "href": entry,
            "base_href": None,
            "shared_target_entries": [],
        },
        "publisher_namespace": "synthetic-county",
        "entry_url": entry,
        "claim_scope": "official_publisher_for_typed_recipient",
    }
    root_row = p.record_provenance(
        db,
        store,
        receipt=root,
        decision="checked",
        reviewed_by="PRIVATE_TEST_REVIEWER",
        reason="PRIVATE_TEST_ROOT",
        expected_previous_id=None,
    )
    context = {
        "kind": c.CONTEXT_KIND,
        "root_receipt_id": root_row.receipt_sha256,
        "recipient_binding": None,
        "edges": [
            {"kind": "acquisition", "receipt_id": catalogue_row.receipt_sha256},
            {
                "kind": "html_anchor",
                "source_sha256": hashlib.sha256(catalogue).hexdigest(),
                "anchor_index": 1,
                "line": 1,
                "href": "/synthetic-reports/report.pdf",
                "label": "Report",
                "base_href": None,
                "target_url": document,
            },
            {"kind": "acquisition", "receipt_id": document_row.receipt_sha256},
        ],
        "publisher_account": {
            "kind": c.PHYSICAL_SECTION,
            "namespace": "synthetic-county",
            "issued_id": False,
            "account_id": None,
            "name_as_source": None,
            "location": None,
            "office": None,
            "district": None,
        },
        "document_role": "primary",
        "fields": {**receipt["source_context"]["fields"], "candidate_name": None},
    }
    receipt = deepcopy(receipt)
    receipt.update(
        schema=r.SECTION_SCHEMA,
        source_context=context,
        reading_scope={
            "cover": {"page": cover_page, "bounds": [0, 0, 612, 792]},
            "regions": [
                {"page": cover_page, "bounds": [0, 0, 612, 792], "role": "cover"}
            ],
        },
    )
    return {
        "receipt": receipt,
        "originals": originals,
        "store": store,
        "body": body,
        "catalogue_row": catalogue_row,
        "catalogue_receipt": catalogue_receipt,
        "source": {
            "sha256": receipt["original_sha256"],
            "authority": "local:county:18",
            "url": document,
            "media_type": document_media_type,
            "copied_at": "2026-11-12T00:00:00+00:00",
        },
        "transitive_hash": hashlib.sha256(directory).hexdigest(),
        "urls": {
            hashlib.sha256(directory).hexdigest(): c.DIRECTORIES[
                "mn_cfb_local_directory"
            ],
            hashlib.sha256(county).hexdigest(): county_url,
            hashlib.sha256(catalogue).hexdigest(): entry,
            hashlib.sha256(body).hexdigest(): document,
        },
    }


@pytest.fixture
def held(db):
    body, _, receipt, _ = packet(office="County Commissioner District 3")
    item = provenance_chain(db, MemoryStore(), body, receipt)
    item["decision"] = r.record_reading(
        db,
        item["store"],
        receipt=item["receipt"],
        decision="checked",
        reviewed_by="PRIVATE_TEST_REVIEWER",
        reason="PRIVATE_TEST_READING",
        expected_previous_id=None,
    )
    return item


def proof(db, item, **kwargs):
    return r.load_verified_reading_context(
        db,
        item["store"],
        [item["decision"].receipt_sha256],
        allowed_source_hashes=set(item["originals"]),
        **kwargs,
    )


def test_full_chain_retains_transitive_originals_and_private_reviews(held, db):
    rid = held["decision"].receipt_sha256
    checked = proof(db, held, lock=True)
    requirements = r.reading_requirements(db, [rid])[rid]
    assert set(requirements["original_hashes"]) == set(held["originals"])
    assert len(requirements["provenance_heads"]) == 5
    assert not requirements["provenance_gaps"]
    assert checked.original_hashes == set(held["originals"])
    for kind in ("authority", "account", "report"):
        actual = local.extract_local_reading(
            held["body"],
            held["source"],
            {"kind": kind, "receipt_sha256": rid},
            context=checked,
        )
        assert "PRIVATE_" not in actual.quote
        assert "evidence_body" not in actual.quote
        if kind == "report":
            assert actual.facts["period_end"] == "2026-10-19"
            assert actual.facts["effective"] is None
            assert actual.facts["amendment_status"] == "not_established"


def test_generation_requires_transitive_directory_even_when_not_directly_named(
    held, db
):
    rid = held["decision"].receipt_sha256
    assert held["transitive_hash"] not in r.source_dependencies(held["receipt"])
    with pytest.raises(ComparisonImportError, match="exact generation"):
        r.load_verified_reading_context(
            db,
            held["store"],
            [rid],
            allowed_source_hashes=set(held["originals"]) - {held["transitive_hash"]},
        )


def test_withdrawn_acquisition_invalidates_reading_and_current_generation(held, db):
    rid = held["decision"].receipt_sha256
    before = proof(db, held)
    p.record_provenance(
        db,
        held["store"],
        receipt=held["catalogue_receipt"],
        decision="withdrawn",
        reviewed_by="PRIVATE_TEST_REVIEWER",
        reason="PRIVATE_TEST_WITHDRAWAL",
        expected_previous_id=held["catalogue_row"].id,
    )
    with pytest.raises(ComparisonImportError):
        proof(db, held, lock=True)
    after = proof(db, held, partial=True)
    assert after.proof_outcomes == {rid: False}
    assert after.version != before.version
    g = {
        "id": "synthetic",
        "sources": [{"sha256": h} for h in held["originals"]],
        "accounts": [],
        "authorities": [],
        "reports": [],
        "coverage": [],
    }
    cache = {
        ("local_reading_requirements", "synthetic"): r.reading_requirements(db, [rid])
    }
    assert not finance._current_readings(g, {rid}, cache)
    assert any(
        h["decision"] == "withdrawn"
        for h in finance.reading_state(g, cache)[rid]["provenance_heads"].values()
    )


@pytest.mark.parametrize("change", ["authority", "url"])
def test_source_metadata_cannot_borrow_a_verified_section(held, db, change):
    source = deepcopy(held["source"])
    source[change] = (
        "local:county:27" if change == "authority" else source["url"] + "?other=1"
    )
    with pytest.raises(ComparisonImportError, match="metadata differs"):
        local.extract_local_reading(
            held["body"],
            source,
            {"kind": "account", "receipt_sha256": held["decision"].receipt_sha256},
            context=proof(db, held),
        )


@pytest.mark.parametrize(
    "copied_at", ["1999-01-01T00:00:00+00:00", None, "2026-11-12T00:00:00", "invalid"]
)
def test_source_copy_time_must_match_the_reviewed_capture(held, db, copied_at):
    source = {**held["source"], "copied_at": copied_at}
    with pytest.raises(ComparisonImportError, match="copy time"):
        local.extract_local_reading(
            held["body"],
            source,
            {"kind": "report", "receipt_sha256": held["decision"].receipt_sha256},
            context=proof(db, held),
        )


def test_source_copy_time_accepts_the_same_instant_in_another_zone(held, db):
    source = {**held["source"], "copied_at": "2026-11-11T19:00:00-05:00"}
    actual = local.extract_local_reading(
        held["body"],
        source,
        {"kind": "report", "receipt_sha256": held["decision"].receipt_sha256},
        context=proof(db, held),
    )
    assert actual.facts["period_end"] == "2026-10-19"


@pytest.mark.parametrize("media_type", ["text/plain", None, ""])
def test_source_media_type_must_match_the_reviewed_capture(held, db, media_type):
    with pytest.raises(ComparisonImportError, match="media type"):
        local.extract_local_reading(
            held["body"],
            {**held["source"], "media_type": media_type},
            {"kind": "report", "receipt_sha256": held["decision"].receipt_sha256},
            context=proof(db, held),
        )


def test_source_media_type_accepts_equivalent_case_and_parameters(held, db):
    actual = local.extract_local_reading(
        held["body"],
        {**held["source"], "media_type": "Application/PDF; version=1.7"},
        {"kind": "report", "receipt_sha256": held["decision"].receipt_sha256},
        context=proof(db, held),
    )
    assert actual.facts["period_end"] == "2026-10-19"


def test_transitive_source_loss_and_recovery_change_proof_without_new_reading(held, db):
    rid = held["decision"].receipt_sha256
    before = proof(db, held)
    source = db.get(m.ElectionResultSource, held["transitive_hash"])
    original = held["store"].objects[source.object_key]
    held["store"].objects[source.object_key] = b"corrupt"
    unavailable = proof(db, held, partial=True)
    assert unavailable.proof_outcomes == {rid: False}
    assert unavailable.version != before.version
    with pytest.raises(ComparisonImportError):
        proof(db, held, lock=True)
    held["store"].objects[source.object_key] = original
    assert proof(db, held).version == before.version


def test_provenance_capacity_is_retryable_and_never_a_missing_source(
    held, db, monkeypatch
):
    before = proof(db, held)

    def exhausted(*args, **kwargs):
        raise SourceFileLimitError("Synthetic temporary process capacity")

    with monkeypatch.context() as patch:
        patch.setattr(r, "verified_source_files", exhausted)
        with pytest.raises(SourceFileLimitError):
            proof(db, held, partial=True)
    assert proof(db, held).version == before.version


@pytest.fixture
def chained_generation(db, local_generation):
    return _chained_generation(db, local_generation)


def _chained_generation(db, local_generation, *, cover_page=1):
    ctx = local_generation
    r.record_reading(
        db,
        ctx.store,
        receipt=ctx.receipt,
        decision="withdrawn",
        reviewed_by="PRIVATE_TEST",
        reason="Replace synthetic whole-document reading with section",
        expected_previous_id=ctx.reading.id,
    )
    body, receipt = ctx.originals[ctx.receipt["original_sha256"]], ctx.receipt
    if cover_page != 1:
        from io import BytesIO
        from pypdf import PdfReader, PdfWriter

        writer = PdfWriter()
        original = PdfReader(BytesIO(body)).pages[0]
        for _ in range(cover_page):
            writer.add_page(original)
        output = BytesIO()
        writer.write(output)
        body = output.getvalue()
        fields = deepcopy(receipt["fields"])
        for field in fields:
            field["page"] = cover_page
        receipt = r.prepare_receipt(
            body, fields=fields, document_kind=receipt["document_kind"]
        ) | {"source_context": ctx.receipt["source_context"]}
    item = provenance_chain(db, ctx.store, body, receipt, cover_page=cover_page)
    item["receipt"]["source_context"]["fields"]["candidate_name"] = "cover.name"
    item["decision"] = r.record_reading(
        db,
        ctx.store,
        receipt=item["receipt"],
        decision="checked",
        reviewed_by="PRIVATE_TEST",
        reason="Synthetic reviewed section and chain",
        expected_previous_id=None,
    )
    rid = item["decision"].receipt_sha256
    checked = proof(db, item)
    values = checked.local_values(rid)
    ctx.originals.update(item["originals"])
    sources = {s["sha256"]: deepcopy(s) for s in ctx.g["sources"]}
    for h, url in item["urls"].items():
        sources[h] = dict(
            sha256=h,
            url=url,
            file=h,
            copied_at="2026-11-12T00:00:00+00:00",
            authority=None if url.endswith("Cntytbl.txt") else "local:county:18",
            media_type="application/pdf"
            if h == item["receipt"]["original_sha256"]
            else "text/html",
        )

    def binding(kind, field=None):
        locator = {"kind": kind, "receipt_sha256": rid}
        if field is not None:
            locator["field_id"] = field
        extracted = local.extract_local_reading(
            item["body"], item["source"], locator, context=checked
        )
        return dict(
            source_sha256=item["source"]["sha256"],
            adapter="local_checked_reading:v1",
            locator=locator,
            quote=extracted.quote,
            facts=extracted.facts,
        )

    authority = values["authority"] | dict(
        status="checked", binding=binding("authority")
    )
    account = values["account"] | dict(status="checked", binding=binding("account"))
    figure_binding = binding("figure", "cover.total_received")
    figure = {
        k: v
        for k, v in figure_binding["facts"].items()
        if k not in {"authority", "account_id", "source_report_id"}
    } | dict(binding=figure_binding)
    report = values["report"] | dict(
        report_key=ctx.report["report_key"],
        source_sha256=item["source"]["sha256"],
        check_status="checked",
        binding=binding("report"),
        figures=[figure],
    )
    ctx.g = finance.prepare_generation(
        {k: v for k, v in ctx.g.items() if k != "id"}
        | dict(
            sources=list(sources.values()),
            authorities=[authority],
            accounts=[account],
            reports=[report],
        )
    )
    ctx.args["registration_number"] = account["account_id"]
    for evidence in ctx.args["evidence"]:
        if evidence["kind"] == "ballot":
            continue
        bound = {
            "authority": authority,
            "committee_register": account,
            "report_cover": report,
        }[evidence["kind"]]["binding"]
        evidence.update(
            sha256=bound["source_sha256"], generation_id=ctx.g["id"], binding=bound
        )
    ctx.reading, ctx.receipt, ctx.report = item["decision"], item["receipt"], report
    ctx.chain = item
    return ctx


@pytest.fixture(params=["2022-11-08", "2026-08-11"])
def other_election_generation(db, local_generation, monkeypatch, request):
    original = provenance_chain

    def different_election(*args, **kwargs):
        return original(*args, **kwargs, election_date=request.param)

    monkeypatch.setitem(globals(), "provenance_chain", different_election)
    ctx = chained_generation.__wrapped__(db, local_generation)
    assert (
        proof(db, ctx.chain).local_values(ctx.reading.receipt_sha256)["election_date"]
        == request.param
    )
    assert db.get(
        m.ElectionComparisonSnapshot, ctx.g["snapshot_id"]
    ).election_date == date(2026, 11, 3)
    return ctx


def test_stage_refuses_recipient_root_from_another_election(
    db, other_election_generation
):
    ctx = other_election_generation
    with pytest.raises(ComparisonImportError, match="another election"):
        finance.stage_generation(db, ctx.store, ctx.g, ctx.originals)


def test_previously_admitted_wrong_election_is_withheld_on_public_and_history_reads(
    db, other_election_generation, monkeypatch
):
    from fastapi import HTTPException

    ctx = other_election_generation
    query = dict(
        election_key=ctx.g["election_key"],
        race_id=ctx.race.id,
        candidate_id=ctx.candidate["candidate_id"],
        store=ctx.store,
    )
    # Simulate an immutable generation admitted before the election-date gate.
    # All other publication and source-review checks remain real fixture paths.
    with monkeypatch.context() as prior:
        prior.setattr(r, "_reading_election_matches", lambda *args: True, raising=False)
        publish(db, ctx)
        before = reads.candidate_finance(db, **query)
        assert before["reports"][0]["figures"][0]["value"] == "1482.11"
    with pytest.raises(ComparisonImportError, match="another election"):
        finance.publish_generation(
            db, ctx.store, ctx.g["id"], expected_previous=ctx.g["id"]
        )
    with pytest.raises(ComparisonImportError, match="another election"):
        finance.validate_account_review(
            db,
            ctx.store,
            snapshot=db.get(m.ElectionComparisonSnapshot, ctx.g["snapshot_id"]),
            race=ctx.race,
            candidate=ctx.candidate,
            **{
                k: ctx.args[k]
                for k in (
                    "registration_number",
                    "authority",
                    "period_start",
                    "period_end",
                    "evidence",
                    "decision",
                )
            },
        )
    with pytest.raises(HTTPException) as stale:
        reads.candidate_finance(db, **query, version=before["version"])
    assert stale.value.status_code == 409
    for selection in ({}, {"generation_id": ctx.g["id"]}):
        data = reads.candidate_finance(db, **query, **selection)
        assert not data["accounts"] and not data["reports"]


def test_source_election_check_keeps_a_historical_report_period(db, monkeypatch):
    # The checked root date identifies the ballot geography; report dates are
    # separate source facts and can legitimately precede that election.
    from alethical.tests import test_election_local_sources as source_fixtures

    native = source_fixtures.native_pdf
    monkeypatch.setattr(
        source_fixtures,
        "native_pdf",
        lambda changes: native(changes | {"period": "From 08/29/22 to 10/19/22"}),
    )
    body, _, original, _ = packet(office="County Commissioner District 3")
    dates = {"cover.period_start": "08/29/22", "cover.period_end": "10/19/22"}
    for field in original["fields"]:
        if field["field_id"] in dates:
            field["literal"] = dates[field["field_id"]]
            field["normalized"] = r.normalize_field(field["literal"], "date", "value")
    for page in original["pages"]:
        page["transcript"] = "\n".join(
            f"{field['field_id']} | {field['label']} | {field['literal']} | {field['state']}"
            for field in original["fields"]
            if field["page"] == page["page"]
        )
    held = provenance_chain(db, MemoryStore(), body, original)
    held["decision"] = r.record_reading(
        db,
        held["store"],
        receipt=held["receipt"],
        decision="checked",
        reviewed_by="PRIVATE_TEST",
        reason="Historical report dates in fixture",
        expected_previous_id=None,
    )
    checked = proof(db, held, election_date=date(2026, 11, 3))
    values = checked.local_values(held["decision"].receipt_sha256)
    assert values["election_date"] == "2026-11-03"
    assert values["report"]["period_end"] == "2022-10-19"


def test_published_chain_withdrawal_changes_public_pin_and_hides_figures(
    db, chained_generation
):
    from fastapi import HTTPException

    ctx = chained_generation
    publish(db, ctx)
    query = dict(
        election_key=ctx.g["election_key"],
        race_id=ctx.race.id,
        candidate_id=ctx.candidate["candidate_id"],
        store=ctx.store,
    )
    before = reads.candidate_finance(db, **query)
    assert (
        before["accounts"] and before["reports"][0]["figures"][0]["value"] == "1482.11"
    )
    assert before["reports"][0]["source_report_id"] is None
    serialized = json.dumps(before)
    assert (
        "PRIVATE_" not in serialized
        and ctx.chain["catalogue_row"].receipt_sha256 not in serialized
    )
    p.record_provenance(
        db,
        ctx.store,
        receipt=ctx.chain["catalogue_receipt"],
        decision="withdrawn",
        reviewed_by="PRIVATE_TEST",
        reason="Synthetic capture withdrawn",
        expected_previous_id=ctx.chain["catalogue_row"].id,
    )
    with pytest.raises(HTTPException) as error:
        reads.candidate_finance(db, **query, version=before["version"])
    assert error.value.status_code == 409
    after = reads.candidate_finance(db, **query)
    assert not after["accounts"] and not after["reports"]


def test_physical_section_identity_and_pages_survive_public_reads(db, local_generation):
    ctx = _chained_generation(db, local_generation, cover_page=2)
    publish(db, ctx)
    answer = reads.candidate_finance(
        db,
        election_key=ctx.g["election_key"],
        race_id=ctx.race.id,
        candidate_id=ctx.candidate["candidate_id"],
        store=ctx.store,
    )
    account = answer["accounts"][0]
    assert account["issued_id"] is False
    assert account["account_id_kind"] == "physical_section"
    assert account["source_section"] == {
        "source_sha256": ctx.receipt["original_sha256"],
        "page": 2,
    }
    report = answer["reports"][0]
    assert report["source_report_id"] is None
    assert report["sources"][0]["locator"]["page"] == 2
    assert report["figures"][0]["sources"][0]["locator"]["page"] == 2
    assert "PRIVATE_" not in json.dumps(answer)
    assert "bounds" not in json.dumps(account)
    field_binding = ctx.report["figures"][0]["binding"]
    # The checked field's page wins even when the optional cover fallback differs.
    projected = reads._binding(
        field_binding,
        reading_context=proof(db, ctx.chain),
        source_section={"source_sha256": ctx.receipt["original_sha256"], "page": 7},
    )[0]
    assert projected["locator"]["page"] == 2
    assert "page" not in field_binding["locator"]  # The stored binding stays exact.
    unrelated = deepcopy(field_binding)
    unrelated["source_sha256"] = "f" * 64
    assert (
        "page"
        not in reads._binding(
            unrelated,
            reading_context=proof(db, ctx.chain),
            source_section=account["source_section"],
        )[0]["locator"]
    )


@pytest.mark.parametrize("select_report", [False, True])
def test_physical_section_comparison_csv_preserves_identity(
    db, local_generation, monkeypatch, select_report
):
    from alethical.api.services import election_comparison_export as export
    from alethical.api.services import election_comparison_reads as results

    ctx = _chained_generation(db, local_generation, cover_page=2)
    publish(db, ctx)
    snapshot = db.get(m.ElectionComparisonSnapshot, ctx.g["snapshot_id"])
    snapshot.first_published_at = snapshot.fetched_at
    db.add(
        m.ElectionComparisonCurrent(
            election_key=ctx.g["election_key"], snapshot_id=snapshot.id
        )
    )
    monkeypatch.setattr(results, "raw_file_store_from_env", lambda: ctx.store)
    monkeypatch.setattr(reads, "raw_file_store_from_env", lambda: ctx.store)
    db.commit()
    with (
        db.get_bind()
        .connect()
        .execution_options(isolation_level="REPEATABLE READ") as connection
    ):
        with Session(connection) as reader:
            body = export.export_csv(
                reader,
                election_key=ctx.g["election_key"],
                race_id=ctx.race.id,
                snapshot_id=ctx.g["snapshot_id"],
                report_keys=[ctx.report["report_key"]] if select_report else [],
            )
    rows = list(csv.DictReader(io.StringIO(body.decode("utf-8-sig"))))
    section_rows = [
        row
        for row in rows
        if row["Row type"] in {"Account association", "Report", "Figure", "Gap"}
        and row["Authority"] == ctx.report["authority"]
        and row["Internal account key"]
    ]
    assert section_rows
    assert all(not row["Account ID"] for row in section_rows)
    assert all(row["Account kind"] == "Report section" for row in section_rows)
    assert all(
        row["Internal account key"] == ctx.report["account_id"] for row in section_rows
    )
    assert not any(row["Account ID"] == ctx.report["account_id"] for row in rows)
    if select_report:
        assert {"Report", "Figure"} <= {row["Row type"] for row in section_rows}
        assert any(row["Source page"] == "2" for row in rows)
    else:
        assert any(row["Row type"] == "Gap" for row in section_rows)
