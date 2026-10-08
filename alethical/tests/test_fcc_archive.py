"""Private FCC archive: retained versions, honest gaps, and checked evidence."""

from __future__ import annotations

import gzip
import hashlib
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import timedelta
from threading import Barrier
from uuid import uuid4

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from alethical.db import models as m
from alethical.db.session import get_session_factory
from alethical.pipeline import fcc_archive as archive
from alethical.pipeline.fcc_document_text import Extraction, Fact, PageText
from alethical.pipeline.fcc_public_files import (
    FCCFetchError,
    FileListing,
    FolderListing,
    Station,
)
from alethical.tests.test_raw_file_mirror import MemoryStore

STATION = Station("28010", "KSTP-TV", "kstp-tv")
ROOT = STATION.root_url
PATH = "political-files/2026/state/example"
PDF = b"%PDF-1.3\nfirst public FCC document"
FILE = FileListing(
    "record-1",
    "folder-1",
    PATH,
    "Example invoice",
    "https://publicfiles.fcc.gov/api/manager/download/folder-1/pdf-1.pdf",
    "10/08/2026 9:00 AM",
)


@pytest.fixture()
def db(seed_database):
    session = get_session_factory()()

    def clear():
        session.rollback()
        for model in (
            m.FCCExpenseLink,
            m.FCCPage,
            m.FCCExtraction,
            m.FCCDocument,
            m.FCCObservation,
            m.FCCScan,
            m.FCCSourceBody,
        ):
            session.execute(delete(model))
        session.commit()

    clear()
    try:
        yield session
    finally:
        clear()
        session.close()


def count(db, model):
    return db.scalar(select(func.count()).select_from(model))


def digest(body):
    return hashlib.sha256(body).hexdigest()


def factory(
    files=(FILE,),
    *,
    bodies=None,
    children=(),
    folder_failure=None,
    download_failure=None,
    downloaded=None,
):
    """Deterministic source with separately visible listing/download failures."""
    bodies = bodies or {file.file_id: PDF for file in files}

    class Client:
        last_download_url = None

        def read_folder(self, url, path):
            if folder_failure and url == folder_failure:
                raise RuntimeError("source folder unavailable")
            if url == ROOT:
                return FolderListing(
                    url,
                    path,
                    b"FCC listing " + repr(files).encode(),
                    list(files),
                    list(children),
                )
            return FolderListing(url, path, b"empty child", [], [])

        def download(self, file):
            if downloaded is not None:
                downloaded.append(file.file_id)
            if file.file_id == download_failure:
                raise RuntimeError("source PDF unavailable")
            self.last_download_url = "https://files.fcc.gov/download/example.pdf"
            return bodies[file.file_id]

        def close(self):
            pass

    return Client


def collect(db, store, client_factory, **kwargs):
    return archive.collect(
        db,
        store,
        stations=(STATION,),
        workers=1,
        client_factory=client_factory,
        **kwargs,
    )


def test_immutable_body_round_trip_and_stable_gzip(db):
    store = MemoryStore()
    key = archive.archive_body(db, store, PDF)
    db.commit()
    row = db.get(m.FCCSourceBody, key)
    assert row.content_hash == digest(PDF)
    assert row.byte_size == len(PDF)
    assert row.object_key == f"fcc/political-files/{digest(PDF)}.gz"
    compressed = store.objects[row.object_key]
    assert compressed[3] == 0  # No filename is embedded in the gzip header.
    assert compressed[4:8] == bytes(4)  # No clock-dependent timestamp.
    assert compressed[9] == 255  # Stable across Mac and Linux.
    assert gzip.decompress(compressed) == PDF
    assert row.compressed_hash == digest(store.objects[row.object_key])
    assert archive.read_body(store, row) == PDF
    assert archive.archive_body(db, store, PDF) == key
    db.commit()
    assert count(db, m.FCCSourceBody) == 1
    assert store.uploads == [row.object_key]


def test_storage_must_succeed_before_body_reference_exists(db):
    class RefusingStore(MemoryStore):
        def put_and_verify(self, key, path, expected_sha256):
            assert count(db, m.FCCSourceBody) == 0
            raise RuntimeError("upload failed")

    with pytest.raises(RuntimeError, match="upload failed"):
        archive.archive_body(db, RefusingStore(), PDF)
    db.rollback()
    assert count(db, m.FCCSourceBody) == 0


def test_same_content_download_restores_missing_stored_object(db):
    store = MemoryStore()
    key = archive.archive_body(db, store, PDF)
    db.commit()
    row = db.get(m.FCCSourceBody, key)
    del store.objects[row.object_key]
    assert archive.archive_body(db, store, PDF) == key
    db.commit()
    assert archive.read_body(store, row) == PDF


def test_existing_corrupt_object_is_not_silently_replaced(db):
    store = MemoryStore()
    key = archive.archive_body(db, store, PDF)
    db.commit()
    row = db.get(m.FCCSourceBody, key)
    store.objects[row.object_key] = b"wrong body"
    with pytest.raises((RuntimeError, ValueError)):
        archive.archive_body(db, store, PDF)
    assert store.objects[row.object_key] == b"wrong body"


@pytest.mark.parametrize(
    "corruption", ["changed", "grew", "decompressed_hash", "decompressed_size"]
)
def test_restored_body_validates_both_fingerprints_and_bounded_size(db, corruption):
    store = MemoryStore()
    key = archive.archive_body(db, store, PDF)
    db.commit()
    row = db.get(m.FCCSourceBody, key)
    if corruption == "changed":
        original = store.objects[row.object_key]
        store.objects[row.object_key] = bytes([original[0] ^ 1]) + original[1:]
    elif corruption == "grew":
        store.objects[row.object_key] += b"extra"
    elif corruption == "decompressed_hash":
        row.content_hash = "a" * 64
    else:
        row.byte_size -= 1
    with pytest.raises((RuntimeError, ValueError)):
        archive.read_body(store, row)


def test_collect_replays_unchanged_listing_and_retains_changed_pdf_version(db):
    store = MemoryStore()
    downloaded = []
    source = factory(downloaded=downloaded)
    first = collect(db, store, source)
    second = collect(db, store, source)
    changed = collect(
        db,
        store,
        factory(bodies={FILE.file_id: PDF + b"changed"}),
        refresh_existing=True,
    )
    assert first["status"] == second["status"] == changed["status"] == "complete"
    assert first["files_stored"] == 1 and second["files_reused"] == 1
    assert downloaded == [FILE.file_id]
    documents = db.scalars(select(m.FCCDocument)).all()
    assert len(documents) == 2
    assert {row.content_hash for row in documents} == {
        digest(PDF),
        digest(PDF + b"changed"),
    }
    for document in documents:
        assert document.year == 2026
        assert archive.read_body(
            store, db.get(m.FCCSourceBody, document.content_hash)
        ).startswith(b"%PDF-")
    observations = db.scalars(
        select(m.FCCObservation).where(m.FCCObservation.kind == "file")
    ).all()
    assert len(observations) == 3
    assert any(row.details.get("effective_url") for row in observations)


def test_missing_cached_object_cannot_report_successful_reuse(db):
    store = MemoryStore()
    collect(db, store, factory())
    document = db.scalar(select(m.FCCDocument))
    row = db.get(m.FCCSourceBody, document.content_hash)
    del store.objects[row.object_key]
    result = collect(db, store, factory())
    # Either repair from source or record a failure. Metadata alone proves neither.
    assert result.get("files_reused", 0) == 0
    if result["status"] == "complete":
        assert archive.read_body(store, row) == PDF
    else:
        assert result["status"] == "incomplete" and result["files_failed"] == 1


def test_week_old_body_is_downloaded_again_even_when_label_did_not_change(db):
    store = MemoryStore()
    collect(db, store, factory())
    document = db.scalar(select(m.FCCDocument))
    document.last_downloaded_at = archive.now() - timedelta(days=8)
    db.commit()
    downloaded = []
    result = collect(db, store, factory(downloaded=downloaded))
    assert result["files_stored"] == 1
    assert downloaded == [FILE.file_id]


def test_removed_source_file_and_failed_folder_preserve_prior_evidence(db):
    store = MemoryStore()
    collect(db, store, factory())
    empty = collect(db, store, factory(files=()))
    assert empty["status"] == "complete" and empty["listed_files"] == 0
    child = ROOT + "/2026/missing"
    failed = collect(
        db,
        store,
        factory(
            children=((child, "political-files/2026/missing"),), folder_failure=child
        ),
    )
    assert failed["status"] == "incomplete" and failed["folders_failed"] == 1
    assert count(db, m.FCCDocument) == 1
    observation = db.scalar(
        select(m.FCCObservation).where(m.FCCObservation.url == child)
    )
    assert observation.status == "failed" and observation.content_hash is None


def test_duplicate_rows_dedupe_record_id_but_identical_urls_keep_distinct_records(db):
    second = replace(FILE, file_id="record-2")
    result = collect(db, MemoryStore(), factory(files=(FILE, FILE, second)))
    assert result["listed_rows"] == 3 and result["listed_files"] == 2
    assert result["files_stored"] == 2
    assert count(db, m.FCCDocument) == 2
    assert count(db, m.FCCSourceBody) == 2  # 1 listing and 1 shared PDF.
    observations = db.scalars(
        select(m.FCCObservation).where(m.FCCObservation.kind == "file")
    ).all()
    assert len(observations) == 2 and len({row.url for row in observations}) == 2


def test_file_limit_is_limited_and_download_failure_is_incomplete(db):
    second = replace(FILE, file_id="record-2")
    third = replace(FILE, file_id="record-3")
    source = factory(files=(FILE, second, third))
    limited = collect(db, MemoryStore(), source, max_files=1)
    assert limited["status"] == "limited"
    assert limited["listed_files"] == 3 and limited["files_stored"] == 1
    failed = collect(
        db, MemoryStore(), factory(files=(second,), download_failure=second.file_id)
    )
    assert failed["status"] == "incomplete" and failed["files_failed"] == 1
    observation = db.scalar(
        select(m.FCCObservation).where(
            m.FCCObservation.scan_id == failed["scan_id"],
            m.FCCObservation.kind == "file",
        )
    )
    assert observation.status == "failed" and observation.content_hash is None


def test_missing_download_link_keeps_siblings_and_explicit_source_gap(db):
    unavailable = replace(
        FILE,
        file_id="record-unavailable",
        url=None,
        source_folder_url=ROOT,
        unavailable_reason="FCC lists this record without a public download link",
    )
    downloaded = []
    store = MemoryStore()
    result = collect(
        db, store, factory(files=(FILE, unavailable), downloaded=downloaded)
    )
    assert result["status"] == "incomplete"
    assert result["listed_files"] == 2
    assert result["files_stored"] == result["files_unavailable"] == 1
    assert result.get("folders_failed", 0) == result.get("files_failed", 0) == 0
    assert downloaded == [FILE.file_id]
    assert count(db, m.FCCDocument) == 1
    source_gap = archive.gaps(db)["source_failures"]
    assert len(source_gap) == 1
    assert source_gap[0]["status"] == "unavailable"
    assert source_gap[0]["url"] == ROOT + "#fcc-file=record-unavailable"
    assert source_gap[0]["details"]["url"] is None
    assert source_gap[0]["details"]["name"] == unavailable.name
    assert source_gap[0]["error"] == unavailable.unavailable_reason

    # A later real download link resolves the current gap, preserving the old one.
    restored = replace(unavailable, url=FILE.url, unavailable_reason=None)
    rerun = collect(db, store, factory(files=(FILE, restored)))
    assert rerun["status"] == "complete"
    assert archive.gaps(db)["source_failures"] == []
    assert count(db, m.FCCDocument) == 2
    retained = db.scalar(
        select(m.FCCObservation).where(
            m.FCCObservation.scan_id == result["scan_id"],
            m.FCCObservation.status == "unavailable",
        )
    )
    assert retained is not None and retained.content_hash is None


def reading(text="Example committee bought 100% of unit_A", *, version=None):
    kwargs = {} if version is None else {"version": version}
    return Extraction(
        [PageText(1, text, "native", "read")],
        "invoice",
        [Fact("invoice_id", "510114", 1, "Invoice: 510114")],
        "pending_review",
        **kwargs,
    )


def test_saved_extraction_is_replayable_versioned_and_keeps_quotes(db):
    store = MemoryStore()
    key = archive.archive_body(db, store, PDF)
    extraction = reading()
    archive.save_extraction(db, key, extraction)
    db.commit()
    archive.save_extraction(db, key, extraction)
    archive.save_extraction(db, key, reading(version="next-reader"))
    db.commit()
    assert count(db, m.FCCExtraction) == count(db, m.FCCPage) == 2
    row = db.get(m.FCCExtraction, (key, extraction.version))
    assert row.facts[0]["quote"] == "Invoice: 510114" and row.facts[0]["page"] == 1


def test_search_quotes_source_page_and_escapes_pattern_characters(db):
    store = MemoryStore()
    collect(db, store, factory())
    archive.save_extraction(db, digest(PDF), reading(r"100% of unit_A at path\invoice"))
    db.commit()
    result = archive.search(db, "100%", station="KSTP-TV", year=2026)
    assert len(result) == 1
    assert result[0]["url"] == FILE.url and result[0]["page"] == 1
    assert result[0]["reading_status"] == "pending_review"
    assert result[0]["draft_facts"][0]["quote"] == "Invoice: 510114"
    assert archive.search(db, "unit_A")
    assert archive.search(db, "unitXA") == []
    assert archive.search(db, r"path\invoice")
    assert archive.search(db, "pathinvoice") == []
    assert archive.search(db, "100%", station="KARE") == []
    assert archive.search(db, "100%", year=2025) == []


def test_mirror_only_records_backed_up_after_read_back_and_replay_skips(db):
    store, mirror = MemoryStore(), MemoryStore()
    key = archive.archive_body(db, store, PDF)
    db.commit()
    assert archive.mirror_bodies(db, store, mirror) == {"copied": 1}
    row = db.get(m.FCCSourceBody, key)
    assert row.mirrored_at is not None
    assert archive.read_body(mirror, row) == PDF
    assert archive.mirror_bodies(db, store, mirror) == {}


@pytest.mark.parametrize(
    "failure", ["primary_missing", "primary_corrupt", "mirror_corrupt"]
)
def test_mirror_failure_keeps_backup_claim_unset(db, failure):
    store, mirror = MemoryStore(), MemoryStore()
    key = archive.archive_body(db, store, PDF)
    db.commit()
    row = db.get(m.FCCSourceBody, key)
    if failure == "primary_missing":
        del store.objects[row.object_key]
    elif failure == "primary_corrupt":
        store.objects[row.object_key] = b"corrupt"
    else:
        mirror.objects[row.object_key] = b"corrupt"
    assert archive.mirror_bodies(db, store, mirror) == {"failed": 1}
    assert db.get(m.FCCSourceBody, key).mirrored_at is None


def test_concurrent_documents_share_verified_body_without_losing_records(db):
    second = replace(FILE, file_id="record-2")
    store = MemoryStore()
    result = archive.collect(
        db,
        store,
        stations=(STATION,),
        workers=2,
        client_factory=factory(files=(FILE, second)),
    )
    assert result["status"] == "complete" and result["files_stored"] == 2
    assert count(db, m.FCCDocument) == 2
    assert count(db, m.FCCSourceBody) == 2
    assert archive.read_body(store, db.get(m.FCCSourceBody, digest(PDF))) == PDF


def test_unreadable_extraction_keeps_error_and_does_not_invent_page_text(db):
    store = MemoryStore()
    key = archive.archive_body(db, store, PDF)
    result = Extraction(
        [], "unknown", [], "unreadable", errors=["reader_process_failed"]
    )
    archive.save_extraction(db, key, result)
    db.commit()
    row = db.get(m.FCCExtraction, (key, result.version))
    assert row.status == "unreadable" and row.errors == ["reader_process_failed"]
    assert row.facts == [] and count(db, m.FCCPage) == 0


def test_historical_non_candidate_folder_is_traversed_without_name_filter(db):
    child_path = "political-files/2010/non-candidate-issue-ads/unknown-name"
    child_url = ROOT + "/2010/non-candidate-issue-ads/unknown-name/folder-2"
    historical = replace(FILE, folder_path=child_path, name="Unfamiliar advertiser")
    base = factory(files=(historical,))

    class HistoricalClient(base):
        def read_folder(self, url, path):
            if url == ROOT:
                return FolderListing(
                    url, path, b"historical root", [], [(child_url, child_path)]
                )
            assert url == child_url and path == child_path
            return FolderListing(
                url, path, b"historical file listing", [historical], []
            )

    result = collect(db, MemoryStore(), HistoricalClient)
    assert result["status"] == "complete" and result["folders_stored"] == 2
    document = db.scalar(select(m.FCCDocument))
    assert document.year == 2010 and document.folder_path == child_path


def test_bounded_scans_eventually_download_every_distinct_record(db):
    files = tuple(replace(FILE, file_id=f"record-{number}") for number in range(3))
    store, downloaded = MemoryStore(), []
    for _ in files:
        result = collect(db, store, factory(files, downloaded=downloaded), max_files=1)
        assert result["status"] == "limited" and result["files_stored"] == 1
    assert len(downloaded) == len(set(downloaded)) == 3
    assert {row.file_id for row in db.scalars(select(m.FCCDocument))} == {
        file.file_id for file in files
    }


def test_cross_category_folder_link_preserves_actual_path_and_stops_cycles(db):
    state_url, local_url = ROOT + "/2026/state/state-id", ROOT + "/2026/local/local-id"
    visited = []
    local_file = replace(FILE, folder_path="political-files/2026/local/example")
    Base = factory(files=(local_file,))

    class Client(Base):
        def read_folder(self, url, path):
            visited.append(url)
            if url == ROOT:
                children = [(state_url, "political-files/2026/state")]
            elif url == state_url:
                children = [(local_url, local_file.folder_path)]
            else:
                assert url == local_url and path == local_file.folder_path
                return FolderListing(
                    url,
                    path,
                    b"local source",
                    [local_file],
                    [(ROOT, "political-files")],
                )
            return FolderListing(url, path, url.encode(), [], children)

    result = collect(db, MemoryStore(), Client)
    assert result["status"] == "complete"
    assert visited == [ROOT, state_url, local_url]
    assert result["folders_stored"] == 3 and result["files_stored"] == 1
    assert db.scalar(select(m.FCCDocument)).folder_path == local_file.folder_path


def test_failed_first_record_does_not_starve_unseen_records(db):
    second = replace(FILE, file_id="record-2")
    store, downloaded = MemoryStore(), []
    source = factory(
        (FILE, second), download_failure=FILE.file_id, downloaded=downloaded
    )
    first = collect(db, store, source, max_files=1)
    second_run = collect(db, store, source, max_files=1)
    assert first["files_failed"] == 1
    assert second_run["files_stored"] == 1
    assert downloaded == [FILE.file_id, second.file_id]
    assert db.scalar(select(m.FCCDocument)).file_id == second.file_id


def test_changed_known_record_is_prioritized_over_fresh_cached_record(db):
    second = replace(FILE, file_id="record-2")
    store = MemoryStore()
    collect(db, store, factory((FILE, second)))
    changed = replace(second, uploaded_at="10/09/2026 9:00 AM")
    downloaded = []
    result = collect(
        db, store, factory((FILE, changed), downloaded=downloaded), max_files=1
    )
    assert result["files_stored"] == 1 and result.get("files_reused", 0) == 0
    assert downloaded == [changed.file_id]


def test_bounded_failed_downloads_rotate_by_oldest_attempt(db):
    second = replace(FILE, file_id="record-2")
    downloaded = []

    class RefusingClient(factory((FILE, second))):
        def download(self, file):
            downloaded.append(file.file_id)
            raise FCCFetchError(file.url, "HTTP 503", 503)

    store = MemoryStore()
    for _ in range(3):
        result = collect(db, store, RefusingClient, max_files=1)
        assert result["files_failed"] == 1
    assert downloaded == [FILE.file_id, second.file_id, FILE.file_id]


@pytest.mark.parametrize("old_status", ["needs_ocr", "partial"])
def test_retry_replaces_failed_reading_and_preserves_full_attempt(db, old_status):
    key = archive.archive_body(db, MemoryStore(), PDF)
    old = Extraction(
        [PageText(1, "Old invoice: 100", "native", "read", "old_page_error")],
        "order",
        [Fact("order_id", "100", 1, "Old invoice: 100")],
        old_status,
        errors=["old_reader_error"],
    )
    assert archive.save_extraction(db, key, old)
    db.commit()
    assert not archive.save_extraction(db, key, reading())
    assert archive.save_extraction(db, key, reading(), retry_failed=True)
    db.commit()
    row = db.get(m.FCCExtraction, (key, old.version))
    assert row.status == "pending_review" and row.document_kind == "invoice"
    assert row.errors == [] and row.facts[0]["value"] == "510114"
    assert len(row.attempts) == 1
    previous = row.attempts[0]
    assert previous["saved_at"]
    assert previous["status"] == old_status and previous["document_kind"] == "order"
    assert previous["errors"] == ["old_reader_error"]
    assert previous["facts"] == [
        {"field": "order_id", "value": "100", "page": 1, "quote": "Old invoice: 100"}
    ]
    assert previous["pages"] == [
        dict(
            page=1,
            text="Old invoice: 100",
            method="native",
            status="read",
            error="old_page_error",
        )
    ]
    assert count(db, m.FCCPage) == 1
    assert db.scalar(select(m.FCCPage)).text == reading().pages[0].text


def test_successful_reading_cannot_be_overwritten_by_retry(db):
    key = archive.archive_body(db, MemoryStore(), PDF)
    original = reading()
    archive.save_extraction(db, key, original)
    db.commit()
    assert not archive.save_extraction(
        db, key, reading("replacement"), retry_failed=True
    )
    db.commit()
    row = db.get(m.FCCExtraction, (key, original.version))
    assert row.status == "pending_review" and row.attempts == []
    assert db.scalar(select(m.FCCPage)).text == original.pages[0].text


def test_repeated_failed_reading_retries_keep_every_prior_attempt(db):
    key = archive.archive_body(db, MemoryStore(), PDF)
    for number, state in enumerate(("needs_ocr", "partial", "pending_review")):
        extraction = replace(reading(f"Attempt {number}"), status=state)
        assert archive.save_extraction(db, key, extraction, retry_failed=True)
        db.commit()
    row = db.get(m.FCCExtraction, (key, extraction.version))
    assert [attempt["status"] for attempt in row.attempts] == ["needs_ocr", "partial"]
    assert [attempt["pages"][0]["text"] for attempt in row.attempts] == [
        "Attempt 0",
        "Attempt 1",
    ]
    assert db.scalar(select(m.FCCPage)).text == "Attempt 2"


def test_expense_link_prevents_failed_reading_replacement(db):
    key = archive.archive_body(db, MemoryStore(), PDF)
    failed = replace(reading("Original partial text"), status="partial")
    archive.save_extraction(db, key, failed)
    db.flush()
    db.add(
        m.FCCExpenseLink(
            content_hash=key,
            extraction_version=failed.version,
            source_dataset="cfb",
            source_snapshot_id=uuid4(),
            source_content_hash="b" * 64,
            source_row_number=1,
            source_row={"vendor": "KSTP-TV"},
            status="suggested",
            evidence="The saved source row names KSTP-TV",
        )
    )
    db.commit()
    assert not archive.save_extraction(db, key, reading(), retry_failed=True)
    db.commit()
    row = db.get(m.FCCExtraction, (key, failed.version))
    assert row.status == "partial" and row.attempts == []
    assert db.scalar(select(m.FCCPage)).text == "Original partial text"


def test_concurrent_same_version_save_does_not_abort_or_duplicate_pages(db):
    key = archive.archive_body(db, MemoryStore(), PDF)
    db.commit()
    barrier = Barrier(2)
    engine = db.get_bind()

    def save():
        with Session(engine) as session:
            barrier.wait(timeout=10)
            saved = archive.save_extraction(session, key, reading())
            session.commit()
            # Losing the race must leave this transaction usable.
            assert (
                session.scalar(select(func.count()).select_from(m.FCCExtraction)) == 1
            )
            return saved

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(save) for _ in range(2)]
        assert sorted(future.result(timeout=20) for future in futures) == [False, True]
    assert count(db, m.FCCExtraction) == count(db, m.FCCPage) == 1


def test_search_exact_field_value_and_kind_filters_keep_literal_text(db):
    store = MemoryStore()
    collect(db, store, factory())
    archive.save_extraction(db, digest(PDF), reading())
    db.commit()
    filters = dict(kind="invoice", field="invoice_id", value="510114")
    assert len(archive.search(db, "", **filters)) == 1
    assert len(archive.search(db, "100%", **filters)) == 1
    assert archive.search(db, "unitXA", **filters) == []
    assert archive.search(db, "", **{**filters, "kind": "order"}) == []
    assert archive.search(db, "", **{**filters, "value": "510"}) == []
    assert archive.search(db, "", **{**filters, "field": "order_id"}) == []
    with pytest.raises(ValueError):
        archive.search(db, "invoice", field="invoice_id")
    with pytest.raises(ValueError):
        archive.search(db, "")


def test_source_failure_retains_http_reason_without_request_url(db):
    class RefusingClient(factory()):
        def download(self, file):
            raise FCCFetchError(file.url + "?private=never-log", "HTTP 403", 403)

    result = collect(db, MemoryStore(), RefusingClient)
    observation = db.scalar(
        select(m.FCCObservation).where(m.FCCObservation.kind == "file")
    )
    assert result["files_failed"] == 1
    assert observation.error == "FCCFetchError: HTTP 403"


def test_storage_failure_never_retains_credentials_in_observation_or_progress(db):
    class RefusingStore(MemoryStore):
        def put_and_verify(self, key, path, expected_sha256):
            if key == f"fcc/political-files/{digest(PDF)}.gz":
                raise RuntimeError(
                    "private-password and private-token are test-only failure markers"
                )
            return super().put_and_verify(key, path, expected_sha256)

    progress = []
    result = collect(db, RefusingStore(), factory(), log=progress.append)
    observation = db.scalar(
        select(m.FCCObservation).where(m.FCCObservation.kind == "file")
    )
    assert result["files_failed"] == 1 and observation.error == "RuntimeError"
    assert "private-password" not in repr([result, progress, observation.error])
    assert "private-token" not in repr([result, progress, observation.error])
