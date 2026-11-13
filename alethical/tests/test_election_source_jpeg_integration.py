"""Normal checked JPEG lifecycle and public original links, synthetic sources."""

# ruff: noqa: F401,F811
from io import BytesIO, StringIO
import csv
import hashlib

from fastapi import HTTPException
from PIL import Image, ImageDraw
import pytest
from sqlalchemy.orm import Session

from alethical.db import models as m
from alethical.pipeline import election_source_readings as r
from alethical.pipeline import election_local_sources as local
from alethical.pipeline import election_source_provenance as provenance
from alethical.pipeline.election_comparison import ComparisonImportError
from alethical.api.services import election_comparison_export as export
from alethical.api.services import election_comparison_reads as results
from alethical.tests.test_election_local_reading_integration import (
    db,
    local_generation,
    publish,
    reads,
)
from alethical.tests.test_election_source_review_concurrency import isolated_engine
from alethical.tests.test_election_comparison_storage import MemoryStore
from alethical.tests.test_election_reading_provenance_integration import (
    provenance_chain,
)
from alethical.tests.test_election_local_source_mappings import packet


@pytest.mark.parametrize(
    "local_generation", [{"source_chain": True, "jpeg_source": True}], indirect=True
)
@pytest.mark.parametrize("failure", ["missing", "changed"])
def test_normal_jpeg_current_historical_loss_withdrawal_csv_and_download(
    db, local_generation, monkeypatch, failure
):
    ctx = local_generation
    publish(db, ctx)
    query = dict(
        election_key=ctx.g["election_key"],
        race_id=ctx.race.id,
        candidate_id=ctx.candidate["candidate_id"],
        store=ctx.store,
    )
    original_render = r.render_page
    renders = []

    def refuse(*args, **kwargs):
        renders.append(True)
        raise AssertionError("Ordinary JPEG access must not decode")

    monkeypatch.setattr(r, "render_page", refuse)
    current = reads.candidate_finance(db, **query)
    explicit = reads.candidate_finance(
        db, **query, generation_id=ctx.g["id"], version=current["version"]
    )
    assert explicit == current
    assert current["reports"][0]["effective"] is None
    assert current["reports"][0]["figures"][0]["value"] == "1482.11"
    assert current["reports"][0]["sources"][0]["locator"]["page"] == 1
    h = ctx.receipt["original_sha256"]
    body, metadata, headers = reads.source_body(
        db,
        election_key=ctx.g["election_key"],
        generation_id=ctx.g["id"],
        source_hash=h,
        store=ctx.store,
    )
    assert hashlib.sha256(body).hexdigest() == h and body == ctx.originals[h]
    expected_source = next(
        source for source in ctx.g["sources"] if source["sha256"] == h
    )
    assert {
        key: metadata[key]
        for key in ("sha256", "authority", "url", "media_type", "copied_at")
    } == {
        key: expected_source[key]
        for key in ("sha256", "authority", "url", "media_type", "copied_at")
    }
    assert metadata["media_type"] == "image/jpeg"
    assert headers["Content-Disposition"].endswith(f'{h}.jpg"')
    assert (
        headers["Content-Type"] == "application/octet-stream"
        and headers["X-Content-Type-Options"] == "nosniff"
    )
    with pytest.raises(HTTPException) as error:
        reads.source_body(
            db,
            election_key=ctx.g["election_key"],
            generation_id="0" * 64,
            source_hash=h,
            store=ctx.store,
        )
    assert error.value.status_code == 404

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
            output = export.export_csv(
                reader,
                election_key=ctx.g["election_key"],
                race_id=ctx.race.id,
                snapshot_id=ctx.g["snapshot_id"],
                report_keys=[ctx.report["report_key"]],
            )
    rows = list(csv.DictReader(StringIO(output.decode("utf-8-sig"))))
    assert any(
        row["Row type"] == "Figure"
        and row["Measure value"] == "1482.11"
        and row["Nonadditive"] == "Yes"
        for row in rows
    )
    assert any(
        row["Row type"] == "Evidence"
        and row["Source hash"] == h
        and row["Source page"] == "1"
        for row in rows
    )
    assert any(
        row["Source URL"].endswith(
            f"/sources/{h}?kind=external&generation_id={ctx.g['id']}"
        )
        for row in rows
    )
    assert "PRIVATE_" not in output.decode()

    stored = db.get(m.ElectionResultSource, h)
    retained = ctx.store.objects.pop(stored.object_key)
    if failure == "changed":
        ctx.store.objects[stored.object_key] = b"changed stored bytes"
    lost = reads.candidate_finance(db, **query, generation_id=ctx.g["id"])
    assert lost["version"] != current["version"] and lost["accounts"] == []
    with pytest.raises(HTTPException) as error:
        reads.candidate_finance(db, **query, version=current["version"])
    assert error.value.status_code == 409
    ctx.store.objects[stored.object_key] = retained
    assert reads.candidate_finance(db, **query)["accounts"]
    withdrawn = r.record_reading(
        db,
        ctx.store,
        receipt=ctx.receipt,
        decision="withdrawn",
        reviewed_by="SYNTHETIC",
        reason="Synthetic JPEG withdrawal",
        expected_previous_id=ctx.reading.id,
    )
    for generation in [None, ctx.g["id"]]:
        after = reads.candidate_finance(db, **query, generation_id=generation)
        assert after["accounts"] == [] and after["reports"] == []
        with pytest.raises(HTTPException) as error:
            reads.candidate_finance(
                db, **query, generation_id=generation, version=current["version"]
            )
        assert error.value.status_code == 409
    assert renders == []
    # A checked mutation must rerender; the ordinary refusal remains for every read above.
    monkeypatch.setattr(r, "render_page", original_render)
    r.record_reading(
        db,
        ctx.store,
        receipt=ctx.receipt,
        decision="checked",
        reviewed_by="SYNTHETIC",
        reason="Synthetic JPEG recheck",
        expected_previous_id=withdrawn.id,
    )
    proof = r.load_verified_reading_context(
        db, ctx.store, [r.receipt_digest(ctx.receipt)]
    )
    assert proof.receipt(r.receipt_digest(ctx.receipt)) == ctx.receipt


def certificate_chain(db, *, media="image/jpeg"):
    _, template, mapping, _ = packet(certificate=True)
    image = Image.new("RGB", (612, 792), "white")
    draw = ImageDraw.Draw(image)
    for field in template["fields"]:
        draw.text(tuple(field["bounds"][:2]), field["literal"], fill="black")
    output = BytesIO()
    image.save(output, "JPEG")
    body = output.getvalue()
    receipt = r.prepare_receipt(
        body,
        fields=template["fields"],
        document_kind="certification",
        reading_scope=template["reading_scope"],
    )
    receipt["source_context"] = {"fields": mapping}
    item = provenance_chain(db, MemoryStore(), body, receipt, document_media_type=media)
    item["receipt"]["source_context"]["document_role"] = "certification"
    return item


def test_certificate_jpeg_keeps_checked_name_and_office_without_financial_inference(db):
    item = certificate_chain(db)
    decision = r.record_reading(
        db,
        item["store"],
        receipt=item["receipt"],
        decision="checked",
        reviewed_by="SYNTHETIC",
        reason="Synthetic exact JPEG certificate",
        expected_previous_id=None,
    )
    proof = r.load_verified_reading_context(
        db,
        item["store"],
        [decision.receipt_sha256],
        allowed_source_hashes=set(item["originals"]),
    )
    locator = {"kind": "account", "receipt_sha256": decision.receipt_sha256}
    account = local.extract_local_reading(
        item["body"], item["source"], locator, context=proof
    )
    assert (
        account.facts["name"] == "Synthetic Source Name"
        and account.facts["candidate_name"] is None
    )
    for kind in ["report", "figure", "payment"]:
        with pytest.raises(ComparisonImportError, match="identity/period/version"):
            local.extract_local_reading(
                item["body"], item["source"], locator | {"kind": kind}, context=proof
            )
    assert (
        proof.local_values(decision.receipt_sha256)["document_role"] == "certification"
    )


@pytest.mark.parametrize("media", [None, "application/pdf", "text/html"])
def test_jpeg_normal_context_requires_exact_captured_mime(db, media):
    item = certificate_chain(db, media=media)
    with pytest.raises(ComparisonImportError, match="media type"):
        r.record_reading(
            db,
            item["store"],
            receipt=item["receipt"],
            decision="checked",
            reviewed_by="SYNTHETIC",
            reason="Must refuse conflicting JPEG capture",
            expected_previous_id=None,
        )


def test_certificate_jpeg_capture_withdrawal_invalidates_fresh_proof_without_decode(
    db, monkeypatch
):
    item = certificate_chain(db)
    decision = r.record_reading(
        db,
        item["store"],
        receipt=item["receipt"],
        decision="checked",
        reviewed_by="SYNTHETIC",
        reason="Synthetic JPEG chain",
        expected_previous_id=None,
    )
    kwargs = dict(allowed_source_hashes=set(item["originals"]))
    before = r.load_verified_reading_context(
        db, item["store"], [decision.receipt_sha256], **kwargs
    )
    attempts = []

    def refuse(*args, **kwargs):
        attempts.append(True)
        raise AssertionError("No ordinary decode")

    monkeypatch.setattr(r, "render_page", refuse)
    provenance.record_provenance(
        db,
        item["store"],
        receipt=item["catalogue_receipt"],
        decision="withdrawn",
        reviewed_by="SYNTHETIC",
        reason="Synthetic capture withdrawn",
        expected_previous_id=item["catalogue_row"].id,
    )
    after = r.load_verified_reading_context(
        db, item["store"], [decision.receipt_sha256], partial=True, **kwargs
    )
    assert (
        after.version != before.version
        and after.proof_outcomes[decision.receipt_sha256] is False
    )
    with pytest.raises(ComparisonImportError):
        r.load_verified_reading_context(
            db, item["store"], [decision.receipt_sha256], **kwargs
        )
    assert attempts == []
