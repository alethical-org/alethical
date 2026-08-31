"""What keeping a report document has to guarantee (#1501).

Minnesota's Campaign Finance Board publishes no archive, refuses most report documents
older than 2023, and answers HTTP 200 with an HTML page for the ones it will not serve.
So the copy taken at the moment of reading is the only copy there will ever be, and every
test here stands in for one way it could turn out to be worthless without anybody
noticing.

The two that carry the most weight:

* **The bytes come back out identical.** A store nobody has read from is a store nobody
  knows is empty. Proved by decompressing what the store holds and comparing it to the
  document, not by trusting that the upload succeeded.
* **No row is ever written for bytes the store cannot vouch for.** A row pointing at a
  missing or altered object destroys the evidence it claims to have, and nothing else in
  this system would notice until someone asked to see the source of a published figure.

Needs the local Postgres on port 54329.
"""

from __future__ import annotations

import gzip
import hashlib
from pathlib import Path
from typing import Iterator, Optional

import pytest
from sqlalchemy import text

from alethical.db import models as schema
from alethical.db.session import get_session_factory
from alethical.pipeline import campaign_finance_report_document_store as store_module
from alethical.pipeline.campaign_finance_report_document_store import (
    ALREADY_STORED,
    STORED,
    DocumentKeeper,
    gzip_bytes_to,
    object_key,
    read_document,
    store_document,
)

DOCUMENT = b"%PDF-1.4\nnot a real filing, but real bytes\n%%EOF\n"


class MemoryStore:
    """Stands in for the private bucket, with the real store's read-back contract."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.uploads: list[str] = []
        self.corrupt_on_write = False

    def exists(self, key: str) -> bool:
        return key in self.objects

    def size(self, key: str) -> Optional[int]:
        stored = self.objects.get(key)
        return None if stored is None else len(stored)

    def put_and_verify(self, key: str, path: str, expected_sha256: str) -> None:
        if key not in self.objects:
            data = Path(path).read_bytes()
            self.objects[key] = b"wrong bytes" if self.corrupt_on_write else data
            self.uploads.append(key)
        stored = hashlib.sha256(self.objects[key]).hexdigest()
        if stored != expected_sha256:
            raise RuntimeError(
                f"{key} read back as {stored} but the bytes uploaded hash to "
                f"{expected_sha256}"
            )

    def get(self, key: str, destination: str) -> None:
        Path(destination).write_bytes(self.objects[key])


@pytest.fixture()
def db(seed_database: None) -> Iterator:
    session = get_session_factory()()
    _clear(session)
    try:
        yield session
    finally:
        _clear(session)
        session.close()


def _clear(session) -> None:
    session.rollback()
    session.execute(text("DELETE FROM cf_report_document"))
    session.commit()


def keep(db, store, tmp_path, body: bytes = DOCUMENT, **overrides) -> str:
    fields = dict(
        document_hash=hashlib.sha256(body).hexdigest(),
        body=body,
        registration_number="19043",
        filing_year=2025,
        report_type="B",
        amendment_index=0,
    )
    fields.update(overrides)
    return store_document(db, store, str(tmp_path), **fields)


def test_the_stored_document_reads_back_as_the_document_we_were_served(
    db, tmp_path
) -> None:
    """The whole point, and the only way to know a store is worth having.

    Read back through the same path a person tracing a published figure would use, so a
    change that makes the object unreadable fails here rather than the first time
    somebody needs it.
    """
    store = MemoryStore()

    action = keep(db, store, tmp_path)

    assert action == STORED
    row = db.query(schema.CampaignFinanceReportDocument).one()
    assert read_document(store, row, str(tmp_path)) == DOCUMENT
    assert row.byte_size == len(DOCUMENT)
    assert row.compression == "gzip"


def test_identical_bytes_always_compress_to_the_identical_object(tmp_path) -> None:
    """``mtime=0`` alone is not enough, and the second argument is the easy one to lose.

    ``GzipFile`` writes the output file's own basename into its header, so the same
    document written to 2 different temporary names would otherwise store under 2
    different hashes -- making the compressed hash a property of a local path rather than
    of the document. Measured on the bulk path before this was fixed there.
    """
    first, first_size = gzip_bytes_to(DOCUMENT, str(tmp_path / "a.pdf.gz"))
    second, second_size = gzip_bytes_to(DOCUMENT, str(tmp_path / "b.pdf.gz"))

    assert first == second
    assert first_size == second_size


def test_keeping_the_same_document_twice_uploads_once(db, tmp_path) -> None:
    """The key is a content address, so a re-run has nothing to do.

    Checked on the uploads the store received rather than on the objects it holds: a
    re-upload of identical bytes is invisible in the result and paid for on every run.
    """
    store = MemoryStore()

    assert keep(db, store, tmp_path) == STORED
    assert keep(db, store, tmp_path) == ALREADY_STORED
    assert store.uploads == [object_key(hashlib.sha256(DOCUMENT).hexdigest())]
    assert db.query(schema.CampaignFinanceReportDocument).count() == 1


def test_a_second_filing_serving_other_bytes_is_a_second_object(db, tmp_path) -> None:
    """An amendment filed since we last looked is a new document, never an overwrite.

    Both are kept, because §4.5 keeps every body indefinitely and the older one is what
    an already-published figure was read from.
    """
    store = MemoryStore()
    amended = DOCUMENT + b"amended\n"

    keep(db, store, tmp_path)
    keep(db, store, tmp_path, body=amended, amendment_index=1)

    assert len(store.objects) == 2
    assert db.query(schema.CampaignFinanceReportDocument).count() == 2


def test_no_row_is_written_when_the_store_cannot_vouch_for_the_bytes(
    db, tmp_path
) -> None:
    """An orphaned object is recoverable; a row pointing at wrong bytes is not.

    It would read as evidence forever, and the only thing that could contradict it is
    somebody fetching the object by hand.
    """
    store = MemoryStore()
    store.corrupt_on_write = True

    with pytest.raises(RuntimeError):
        keep(db, store, tmp_path)

    assert db.query(schema.CampaignFinanceReportDocument).count() == 0


def test_a_stored_body_that_changed_under_us_is_refused_rather_than_returned(
    db, tmp_path
) -> None:
    """Handing back a document that no longer matches its row would be the worst outcome.

    It looks exactly like the file a figure was published from, and it is not.
    """
    store = MemoryStore()
    keep(db, store, tmp_path)
    row = db.query(schema.CampaignFinanceReportDocument).one()
    store.objects[row.object_key] = gzip.compress(b"different document entirely")

    with pytest.raises(RuntimeError, match="not the ones this row vouches for"):
        read_document(store, row, str(tmp_path))


def test_the_temporary_copy_is_removed_even_when_the_upload_fails(db, tmp_path) -> None:
    """A long run that fills its own disk fails in a way nobody links back to this.

    1,277 documents are 156 MB of PDF, so one leaked copy per failure is a real amount.
    """
    store = MemoryStore()
    store.corrupt_on_write = True

    with pytest.raises(RuntimeError):
        keep(db, store, tmp_path)

    assert list(tmp_path.iterdir()) == []


def test_the_keeper_counts_a_failure_and_names_the_committee_year(db, tmp_path) -> None:
    """A failure has to say which document was lost, or it cannot be chased.

    The keeper swallows the error on purpose -- the verdict it belongs to is a real
    finding about real money and must still be written -- so this counted line is the
    only trace left.
    """
    store = MemoryStore()
    store.corrupt_on_write = True
    keeper = DocumentKeeper(db=db, store=store, directory=str(tmp_path))

    action = keeper.keep(
        document_hash=hashlib.sha256(DOCUMENT).hexdigest(),
        body=DOCUMENT,
        registration_number="20010",
        filing_year=2024,
        report_type="A",
        amendment_index=2,
    )

    assert action == store_module.FAILED
    assert len(keeper.report.failures) == 1
    assert "20010:2024" in keeper.report.failures[0]
    assert "failed to store:           1" in keeper.report.summary()


def test_a_kept_document_is_addressed_by_its_own_hash(db, tmp_path) -> None:
    """The key names the raw document, not the compressed object.

    That is what lets ``cf_stated_split.document_hash`` resolve to a body with no foreign
    key and no lookup, including for a verdict whose payment rows have since been
    replaced.
    """
    store = MemoryStore()
    raw_hash = hashlib.sha256(DOCUMENT).hexdigest()

    keep(db, store, tmp_path)

    row = db.query(schema.CampaignFinanceReportDocument).one()
    assert row.object_key == f"campaign-finance/report-document/{raw_hash}.pdf.gz"
    assert row.document_hash == raw_hash
    assert row.compressed_hash != raw_hash
