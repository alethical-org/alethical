"""Tests for keeping our own copy of every source our published writing cites (#1798).

The failure this guards against is not a broken link. It is a document that changes
under a published quotation while the address, the status code and the page's own look
all stay the same, and a document that vanishes behind a page answering HTTP 200. Both
happened on 27 August 2026, hours apart.

So these pin the 2 things a status-code checker cannot do: reading the bytes to tell a
document from a page saying nothing is there, and telling a version we already hold from
one we have never seen.
"""

from __future__ import annotations

import gzip
import hashlib
import importlib.util
import os
import tempfile
from pathlib import Path

import pytest

from alethical.pipeline import published_source_archive as archive

SCRIPT = (
    Path(__file__).resolve().parents[2] / "scripts" / "archive_published_sources.py"
)
_spec = importlib.util.spec_from_file_location("archive_published_sources", SCRIPT)
runner = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(runner)

# The real HTML shell cfb.mn.gov serves at a PDF address whose file is gone, reduced to
# the parts a check reads. Measured 28 August 2026 against
# https://cfb.mn.gov/pdf/calendars/2025_senate_house_district_court.pdf, which answered
# HTTP 200 with 30,085 bytes of text/html.
DEAD_PDF_SHELL = (
    b"\n<html><head><title>Campaign Finance Disclosure Board</title></head>"
    b"<body><h1>Self Help</h1><h1>This page is not available</h1></body></html>\n"
)

# The first bytes of the real PDF the 2026 equivalent served, 172,586 bytes of
# application/pdf on the same day.
LIVE_PDF = b"%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n"

CALENDAR_2025 = "https://cfb.mn.gov/pdf/calendars/2025_senate_house_district_court.pdf"
CALENDAR_2026 = "https://cfb.mn.gov/pdf/calendars/2026_senate_house_district_court.pdf"


# --- Reading the bytes, which is the whole check -----------------------------------


def test_a_pdf_address_serving_a_web_page_is_gone_even_at_http_200():
    """The exact case that made this necessary: a 200 that is not the document."""
    action, detail = archive.classify(CALENDAR_2025, 200, DEAD_PDF_SHELL, None)
    assert action == archive.GONE
    assert "web page" in detail


def test_a_pdf_address_serving_a_pdf_is_the_document():
    assert archive.classify(CALENDAR_2026, 200, LIVE_PDF, None) == ("", "")


def test_a_pdf_address_serving_neither_a_pdf_nor_a_page_is_gone():
    """Bytes that are not the promised format are not the document, whatever they are."""
    action, detail = archive.classify(CALENDAR_2026, 200, b"\x00\x01not a pdf", None)
    assert action == archive.GONE
    assert "not the format" in detail


def test_an_error_page_at_an_html_address_is_gone():
    action, detail = archive.classify(
        "https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/candidate/",
        200,
        b"<html><h1>This page is not available</h1></html>",
        "This page is not available",
    )
    assert action == archive.GONE
    assert "finds nothing" in detail


def test_a_real_page_is_the_document():
    assert archive.classify(
        "https://www.revisor.mn.gov/statutes/cite/10A.20",
        200,
        b"<html><h1>10A.20 CAMPAIGN REPORTS</h1></html>",
        None,
    ) == ("", "")


def test_an_empty_body_is_gone():
    action, _ = archive.classify(CALENDAR_2026, 200, b"", None)
    assert action == archive.GONE


def test_a_pdf_is_held_to_being_a_pdf_and_a_page_is_not():
    assert archive.expected_magic(CALENDAR_2025) == b"%PDF"
    assert (
        archive.expected_magic("https://cfb.mn.gov/reports-and-data/viewers/") is None
    )


def test_the_fragment_in_a_cited_address_does_not_hide_its_extension():
    """One cited address carries a ``#/...`` fragment, so the path is what decides."""
    assert archive.expected_magic("https://cfb.mn.gov/x/y.pdf#page=4") == b"%PDF"


# --- What the stored object is called ----------------------------------------------


def test_the_stored_name_comes_from_the_bytes_not_the_address():
    assert archive.stored_extension("https://x/y", LIVE_PDF) == "pdf"
    assert archive.stored_extension("https://x/y.pdf", b"<html></html>") == "html"


def test_the_key_sits_beside_the_other_kinds_of_stored_body():
    key = archive.object_key("a" * 64, "pdf")
    assert key == f"published-sources/{'a' * 64}.pdf.gz"


# --- Compressing the same document twice gives the same bytes ----------------------


def test_the_same_document_compresses_to_the_same_bytes_twice():
    """Otherwise an unchanged document would look like a new one every single run."""
    with tempfile.TemporaryDirectory() as directory:
        first = os.path.join(directory, "one-name.gz")
        second = os.path.join(directory, "a-completely-different-name.gz")
        one_hash, one_size = archive.gzip_bytes_to(LIVE_PDF, first)
        two_hash, two_size = archive.gzip_bytes_to(LIVE_PDF, second)
    assert one_hash == two_hash
    assert one_size == two_size


def test_the_stored_bytes_decompress_to_the_document():
    with tempfile.TemporaryDirectory() as directory:
        path = os.path.join(directory, "body.gz")
        archive.gzip_bytes_to(DEAD_PDF_SHELL, path)
        with gzip.open(path, "rb") as compressed:
            assert compressed.read() == DEAD_PDF_SHELL


# --- Reading a copy back out of the store ------------------------------------------


class FakeStore:
    """A store in a dict, with the read-back check the real one performs."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def exists(self, key: str) -> bool:
        return key in self.objects

    def put_and_verify(self, key: str, path: str, expected_sha256: str) -> None:
        with open(path, "rb") as handle:
            body = handle.read()
        if hashlib.sha256(body).hexdigest() != expected_sha256:
            raise RuntimeError("the bytes read back are not the bytes uploaded")
        self.objects.setdefault(key, body)

    def get(self, key: str, destination: str) -> None:
        with open(destination, "wb") as handle:
            handle.write(self.objects[key])


class Row:
    def __init__(self, object_key: str, compressed_hash: str) -> None:
        self.object_key = object_key
        self.compressed_hash = compressed_hash


def test_a_kept_copy_reads_back_as_the_document_it_records():
    store = FakeStore()
    with tempfile.TemporaryDirectory() as directory:
        path = os.path.join(directory, "body.gz")
        compressed_hash, _ = archive.gzip_bytes_to(LIVE_PDF, path)
        store.put_and_verify("published-sources/x.pdf.gz", path, compressed_hash)
        row = Row("published-sources/x.pdf.gz", compressed_hash)
        assert archive.read_copy(store, row, directory) == LIVE_PDF


def test_a_kept_copy_that_no_longer_hashes_right_refuses_to_decompress():
    """A body that changed under us is never handed over as the one we cited."""
    store = FakeStore()
    with tempfile.TemporaryDirectory() as directory:
        path = os.path.join(directory, "body.gz")
        compressed_hash, _ = archive.gzip_bytes_to(LIVE_PDF, path)
        store.put_and_verify("published-sources/x.pdf.gz", path, compressed_hash)
        row = Row("published-sources/x.pdf.gz", "0" * 64)
        with pytest.raises(RuntimeError, match="not the ones"):
            archive.read_copy(store, row, directory)


# --- What the report says -----------------------------------------------------------


def test_a_quiet_week_needs_nobody_and_says_so():
    report = archive.ArchiveReport(
        outcomes=[
            archive.SourceOutcome("https://x/a", archive.UNCHANGED),
            archive.SourceOutcome("https://x/b", archive.NEW),
            archive.SourceOutcome("https://x/c", archive.UNREACHABLE, "timed out"),
        ]
    )
    assert report.needs_attention == []
    assert "not treated as gone" in archive.format_report(report)


def test_a_gone_source_and_a_changed_one_both_need_attention():
    report = archive.ArchiveReport(
        outcomes=[
            archive.SourceOutcome("https://x/a", archive.GONE, "answers 200"),
            archive.SourceOutcome("https://x/b", archive.CHANGED, "different bytes"),
            archive.SourceOutcome("https://x/c", archive.FAILED, "could not store"),
        ]
    )
    assert len(report.needs_attention) == 3
    text = archive.format_report(report)
    assert "no longer serve the document" in text
    assert "a different document" in text
    assert "no copy of them exists" in text


# --- The runner's own reading of one address ----------------------------------------


class FakeLinks:
    """Stands in for the link check module the runner loads for the shared pieces."""

    USER_AGENT = "test"
    REQUEST_SPACING_SECONDS = 0.0

    @staticmethod
    def page_says_it_is_missing(body: str):
        return "This page is not available" if "not available" in body else None


def test_the_runner_calls_a_dead_pdf_address_gone(monkeypatch):
    monkeypatch.setattr(
        runner, "fetch", lambda url, timeout, links: (200, "text/html", DEAD_PDF_SHELL)
    )
    action, detail, _status, _type, _body = runner.read_one(CALENDAR_2025, 5, FakeLinks)
    assert action == archive.GONE
    assert "web page" in detail


def test_the_runner_calls_a_live_pdf_address_the_document(monkeypatch):
    monkeypatch.setattr(
        runner, "fetch", lambda url, timeout, links: (200, "application/pdf", LIVE_PDF)
    )
    action, _detail, _status, media_type, body = runner.read_one(
        CALENDAR_2026, 5, FakeLinks
    )
    assert action == ""
    assert media_type == "application/pdf"
    assert body == LIVE_PDF


def test_an_unreachable_host_is_not_reported_as_gone(monkeypatch):
    """A timeout is the site having a bad minute. Reporting it teaches everyone to
    ignore this check."""
    import urllib.error

    def boom(url, timeout, links):
        raise urllib.error.URLError("connection refused")

    monkeypatch.setattr(runner, "fetch", boom)
    action, _detail, _status, _type, _body = runner.read_one(
        CALENDAR_2026, 5, FakeLinks
    )
    assert action == archive.UNREACHABLE


def test_a_404_is_reported_as_gone(monkeypatch):
    import urllib.error

    def gone(url, timeout, links):
        raise urllib.error.HTTPError(url, 404, "Not Found", {}, None)

    monkeypatch.setattr(runner, "fetch", gone)
    action, detail, _status, _type, _body = runner.read_one(CALENDAR_2026, 5, FakeLinks)
    assert action == archive.GONE
    assert "404" in detail


def test_a_500_is_not_reported_as_gone(monkeypatch):
    import urllib.error

    def server_error(url, timeout, links):
        raise urllib.error.HTTPError(url, 503, "Service Unavailable", {}, None)

    monkeypatch.setattr(runner, "fetch", server_error)
    action, _detail, _status, _type, _body = runner.read_one(
        CALENDAR_2026, 5, FakeLinks
    )
    assert action == archive.UNREACHABLE


# --- Which addresses get checked ----------------------------------------------------


def test_the_addresses_come_from_the_published_pieces_and_include_no_github_links():
    """The 4 github.com addresses in the pieces are comments to the next builder rather
    than anything a reader can click, so nothing here should archive them."""
    links = runner._link_check()
    addresses = runner.cited_addresses(links)
    assert addresses, "the published pieces yielded no outward addresses at all"
    assert not [url for url in addresses if "github.com" in url]
    assert all(url.startswith("http") for url in addresses)
    assert any("cfb.mn.gov" in url for url in addresses)
    assert any("revisor.mn.gov" in url for url in addresses)


def test_every_cited_address_names_the_pieces_that_cite_it():
    links = runner._link_check()
    for url, pieces in runner.cited_addresses(links).items():
        assert pieces, f"{url} is cited by no piece, which cannot be true"
        assert all(name.endswith(".ts") for name in pieces)


# --- Storing, comparing and reading back, against a real database -------------------


@pytest.fixture()
def db(seed_database: None):
    from sqlalchemy import text

    from alethical.db.session import get_session_factory

    session = get_session_factory()()
    session.execute(text("DELETE FROM published_source_copy"))
    session.commit()
    try:
        yield session
    finally:
        session.rollback()
        session.execute(text("DELETE FROM published_source_copy"))
        session.commit()
        session.close()


HANDBOOK = "https://cfb.mn.gov/pdf/publications/handbooks/PTU_handbook.pdf"


def row_for(db, url: str, body: bytes):
    """The kept row for exactly these bytes at this address."""
    from alethical.db import models as schema

    return db.get(schema.PublishedSourceCopy, (url, hashlib.sha256(body).hexdigest()))


def keep(db, store, directory, url, body, cited_by="whatTheRecordsName.ts"):
    return archive.store_copy(
        db,
        store,
        directory,
        url=url,
        content_hash=hashlib.sha256(body).hexdigest(),
        body=body,
        media_type="application/pdf",
        cited_by=cited_by,
    )


def test_the_first_copy_of_a_source_is_kept_and_reads_back_identical(db, tmp_path):
    store = FakeStore()
    body = LIVE_PDF + b"Last Revised 3/7/2022"

    assert keep(db, store, str(tmp_path), HANDBOOK, body) == archive.NEW

    row = row_for(db, HANDBOOK, body)
    assert row.byte_size == len(body)
    assert row.cited_by == "whatTheRecordsName.ts"
    assert row.last_confirmed_at is not None
    # Nothing has copied it to the second place yet, which is what the copy job reads.
    assert row.mirrored_at is None
    assert archive.read_copy(store, row, str(tmp_path)) == body


def test_reading_the_same_document_again_is_quiet_and_moves_no_bytes(db, tmp_path):
    """A quiet week has to cost nothing and report nothing."""
    store = FakeStore()
    body = LIVE_PDF + b"Last Revised 3/7/2022"
    keep(db, store, str(tmp_path), HANDBOOK, body)
    objects_after_first = dict(store.objects)

    assert keep(db, store, str(tmp_path), HANDBOOK, body) == archive.UNCHANGED
    assert store.objects == objects_after_first
    assert len(archive.known_versions(db)[HANDBOOK]) == 1


def test_a_replaced_document_is_kept_beside_the_one_we_cited(db, tmp_path):
    """#1798 exactly: same address, same status, different document.

    The copy a published guide quoted must survive the replacement, or the quotation is
    unverifiable for good.
    """
    store = FakeStore()
    cited = LIVE_PDF + b"Contributions from donors who each gave $200 or less"
    replaced = LIVE_PDF + b"Last Revised 8/22/2026"

    keep(db, store, str(tmp_path), HANDBOOK, cited)
    assert keep(db, store, str(tmp_path), HANDBOOK, replaced) == archive.NEW

    versions = archive.known_versions(db)[HANDBOOK]
    assert len(versions) == 2
    assert hashlib.sha256(cited).hexdigest() in versions
    # The words the guide put in quotation marks are still readable out of our copy.
    old_row = row_for(db, HANDBOOK, cited)
    assert b"gave $200 or less" in archive.read_copy(store, old_row, str(tmp_path))


def test_who_cites_a_source_is_kept_current(db, tmp_path):
    """A person told a document changed needs to know which published page is affected."""
    store = FakeStore()
    body = LIVE_PDF + b"body"
    keep(db, store, str(tmp_path), HANDBOOK, body, cited_by="whatTheRecordsName.ts")
    keep(
        db,
        store,
        str(tmp_path),
        HANDBOOK,
        body,
        cited_by="whatTheRecordsName.ts, whoHasToReportTheirMoney.ts",
    )
    row = row_for(db, HANDBOOK, body)
    assert row.cited_by == "whatTheRecordsName.ts, whoHasToReportTheirMoney.ts"


def test_two_addresses_serving_the_same_document_share_one_object(db, tmp_path):
    """The key is a hash of the bytes, so sharing it is honest, and 2 rows is right."""
    store = FakeStore()
    body = LIVE_PDF + b"one document, cited twice"
    keep(db, store, str(tmp_path), "https://cfb.mn.gov/a.pdf", body)
    keep(db, store, str(tmp_path), "https://cfb.mn.gov/b.pdf", body)
    assert len(store.objects) == 1
    assert len(archive.known_versions(db)) == 2


def test_a_store_that_cannot_verify_writes_no_row(db, tmp_path):
    """A row pointing at bytes we cannot vouch for destroys the evidence it claims."""

    class RefusingStore(FakeStore):
        def put_and_verify(self, key, path, expected_sha256):
            raise RuntimeError("the object read back as something else")

    with pytest.raises(RuntimeError):
        keep(db, RefusingStore(), str(tmp_path), HANDBOOK, LIVE_PDF)
    db.rollback()
    assert archive.known_versions(db) == {}
