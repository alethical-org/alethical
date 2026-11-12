"""Section reading uses owned files without weakening proof or memory bounds."""

# ruff: noqa: F811
from io import BytesIO
import hashlib
import json
from pathlib import Path
import sys

from pypdf import PdfReader, PdfWriter
import pytest

from alethical.pipeline import election_source_files as files
from alethical.pipeline import election_source_readings as r
from alethical.pipeline import election_external_finance as storage
from alethical.pipeline import election_local_sources as local
from alethical.api.services import election_external_finance_reads as reads
from alethical.pipeline.election_comparison import ComparisonImportError
from alethical.pipeline.election_fec_paper_identity import _run_native_reader
from alethical.tests.test_election_source_files import Store, source
from alethical.tests.test_election_source_reading_sections import section
from alethical.tests.test_election_source_readings import db, retain, check  # noqa: F401
from scripts import review_election_source_reading as command


def test_owned_file_native_input_and_render_match_original_bytes():
    body, receipt = section()
    store = Store()
    metadata = source(store, body)
    with files.verified_source_files(store, [metadata]) as proved:
        original = proved[metadata["content_hash"]]
        actual = r.prepare_receipt(
            original,
            fields=receipt["fields"],
            document_kind=receipt["document_kind"],
            reading_scope=receipt["reading_scope"],
        )
        assert actual == receipt
        assert (
            _run_native_reader(
                original,
                command=[
                    sys.executable,
                    "-c",
                    "import hashlib,sys; h=hashlib.sha256(); "
                    "[h.update(b) for b in iter(lambda:sys.stdin.buffer.read(65536),b'')]; "
                    "print(h.hexdigest())",
                ],
            )
            .strip()
            .decode()
            == hashlib.sha256(body).hexdigest()
        )
        r.verify_receipt_sources(receipt, proved, render=True)
    with pytest.raises(files.SourceFileError, match="owning context"):
        _run_native_reader(original)
    with pytest.raises((ComparisonImportError, TypeError, ValueError)):
        r.prepare_receipt(
            Path("unverified.pdf"),
            fields=receipt["fields"],
            document_kind="financial_report",
        )


def test_large_section_survives_review_read_and_source_loss(db, monkeypatch):
    body, receipt = section()
    writer = PdfWriter(PdfReader(BytesIO(body)))
    writer.add_attachment("synthetic-padding.bin", b"x" * (16 * 1024 * 1024))
    out = BytesIO()
    writer.write(out)
    body = out.getvalue()
    assert len(body) > r.MAX_ORIGINAL_BYTES
    receipt["original_sha256"] = hashlib.sha256(body).hexdigest()
    store = retain(db, body)
    # Neither review nor subsequent section reads may use the old whole-byte path.
    monkeypatch.setattr(r, "read_source", lambda *a, **k: pytest.fail("whole read"))
    accepted = check(db, store, receipt)
    current = r.load_verified_reading_context(
        db,
        store,
        [accepted.receipt_sha256],
        allowed_source_hashes={receipt["original_sha256"]},
    )
    assert current.receipt(accepted.receipt_sha256) == receipt
    assert current.proof_outcomes == {accepted.receipt_sha256: True}
    h = receipt["original_sha256"]
    metadata = {
        "sha256": h,
        "authority": "local:county:18",
        "media_type": "application/pdf",
        "url": "https://example.gov/bundle.pdf",
    }
    generation = {"sources": [metadata]}
    monkeypatch.setattr(
        storage, "read_source", lambda *a, **k: pytest.fail("whole read")
    )
    monkeypatch.setattr(reads, "read_source", lambda *a, **k: pytest.fail("whole read"))
    originals = storage.source_bodies(db, store, generation)
    assert originals[h] is None  # No whole PDF is held in the byte dictionary.
    originals.reading_context = current
    locator = {
        "kind": "field",
        "receipt_sha256": accepted.receipt_sha256,
        "field_id": "cover.total_received",
        "page": 1,
    }
    with originals.original(h) as proved:
        extraction = local.extract_local_reading(
            proved, metadata, locator, context=current
        )
    monkeypatch.setitem(
        storage.ADAPTERS, "local_checked_reading:v1", local.extract_local_reading
    )
    binding = dict(
        source_sha256=h,
        adapter="local_checked_reading:v1",
        locator=locator,
        quote=extraction.quote,
        facts=extraction.facts,
    )
    storage._validate_binding(generation, originals, binding, extraction.facts)
    review_originals = storage.retained_bodies(
        db,
        store,
        generation,
        {h},
        reading_ids=[accepted.receipt_sha256],
        reading_context=current,
        reading_context_planned=True,
    )
    storage._validate_binding(generation, review_originals, binding, extraction.facts)
    assert reads._availability(db, store, {h}) == ({}, {h: True})
    monkeypatch.setattr(files, "_BUDGET", files._Budget(workers=0))
    with pytest.raises(files.SourceFileLimitError):
        r.load_verified_reading_context(
            db, store, [accepted.receipt_sha256], partial=True
        )
    with pytest.raises(files.SourceFileLimitError):
        check(db, store, receipt)
    with pytest.raises(files.SourceFileLimitError):
        reads._availability(db, store, {h})
    with pytest.raises(files.SourceFileLimitError):
        storage._validate_binding(generation, originals, binding, extraction.facts)
    monkeypatch.setattr(files, "_BUDGET", files._Budget())
    key = next(iter(store.objects))
    original = store.objects[key]
    store.objects[key] = b"changed"
    assert reads._availability(db, store, {h}) == ({}, {h: False})
    with pytest.raises(ComparisonImportError):
        storage._validate_binding(generation, originals, binding, extraction.facts)
    missing = r.load_verified_reading_context(
        db, store, [accepted.receipt_sha256], partial=True
    )
    assert missing.proof_outcomes == {accepted.receipt_sha256: False}
    assert missing.version != current.version
    store.objects[key] = original
    recovered = r.load_verified_reading_context(db, store, [accepted.receipt_sha256])
    assert recovered.proof_outcomes == current.proof_outcomes


def test_file_dependency_literal_crosses_chunk_boundary():
    body, receipt = section()
    store = Store()
    pdf = source(store, body)
    literal = "exact-cross-chunk-quotation"
    dependency = source(
        store,
        b"x" * (files.CHUNK_BYTES - 4) + literal.encode() + b"tail",
        media_type="text/plain",
    )
    receipt["dependencies"] = [
        {"sha256": dependency["content_hash"], "role": "catalogue", "literal": literal}
    ]
    with files.verified_source_files(store, [pdf, dependency]) as proved:
        r.verify_receipt_sources(receipt, proved)
        receipt["dependencies"][0]["literal"] = "not-in-source"
        with pytest.raises(ComparisonImportError, match="quotation"):
            r.verify_receipt_sources(receipt, proved)


def test_prepare_command_section_streams_input_and_keeps_proposal_unapproved(
    tmp_path, monkeypatch, capsys
):
    body, receipt = section()
    pdf = tmp_path / "bundle.pdf"
    pdf.write_bytes(body)
    proposal = tmp_path / "observations.json"
    proposal.write_text(
        json.dumps(
            {
                k: receipt[k]
                for k in (
                    "fields",
                    "document_kind",
                    "dependencies",
                    "source_context",
                    "reading_scope",
                )
            }
        )
    )
    target = tmp_path / "receipt.json"
    monkeypatch.setattr(Path, "read_bytes", lambda *a: pytest.fail("whole read"))
    assert (
        command.main(
            [
                "prepare",
                "--pdf",
                str(pdf),
                "--observations",
                str(proposal),
                "--output",
                str(target),
            ]
        )
        == 0
    )
    assert json.loads(target.read_text()) == receipt
    result = json.loads(capsys.readouterr().out)
    assert result["source_validation"] == "not_approved"
    assert result["publication"] == "not_changed"
