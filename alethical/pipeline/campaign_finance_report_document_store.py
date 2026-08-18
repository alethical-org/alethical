"""Keep the bytes of one report document, so a figure can be traced to them (#1501).

Net: #1433's check reads each committee's own filed report to find money Minnesota named
that our bulk download left out -- 14 committee-years disagree by $4,098,534 -- and it
kept only each document's sha256. A hash of bytes nobody holds proves nothing. This
module stores the document itself, the same way
``docs/architecture/campaign-finance-system-design.md`` §4.5 (where the downloaded files
live, and for how long) stores a bulk download.

**Why a document read today may be unreachable tomorrow, which is what makes this
urgent rather than tidy.** §9.4 (report PDFs are a fallback, not a route) measured a
random 110-report sample of a 1,005-report catalogue: 27 returned a document and 83
returned an HTML page carrying HTTP 200 and no error status, and almost nothing before
2023 is served at all. The Board publishes no archive and never promised this route
exists. So the copy we take at the moment of reading is the only copy there will be.

Three properties, each load-bearing and none of them new -- this deliberately reuses the
pattern ``campaign_finance.py`` established rather than inventing a second one:

* **The key is a content address.** A re-run that fetches an unchanged document writes
  nothing, and an amendment that changes the bytes is a new object rather than an
  overwrite of the old one.
* **gzip with ``mtime=0`` and ``filename=""``.** Both arguments matter and ``mtime=0``
  alone is not enough: ``GzipFile`` writes the output file's own basename into the
  header, so identical input under two temporary names would compress to two different
  hashes. A document is already compressed, so the saving here is small and the point is
  not the saving -- it is that every stored body in this system decompresses the same
  way.
* **Read back and hash before the row exists.** An orphaned object is recoverable; a row
  pointing at a missing object destroys the evidence it claims to have, and nothing else
  would notice until someone asked to see the source of a published figure.

**A failure to store never withholds the verdict.** The verdict was read from bytes we
genuinely received and it records their hash, so refusing it would throw away a real
finding over a storage fault. Failures are counted and reported instead, and a run that
could not store everything exits non-zero -- the same choice ``raw_file_mirror.py``
makes, for the same reason: a store that quietly stops is worse than none, because it is
trusted.
"""

from __future__ import annotations

import gzip
import os
from dataclasses import dataclass, field
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from alethical.db import models as schema
from alethical.pipeline.raw_file_store import sha256_of_file

# What a document ended a run as. ``already_stored`` is not a weaker ``stored``: the key
# is a content address, so an existing row means these exact bytes are already kept.
STORED = "stored"
ALREADY_STORED = "already-stored"
FAILED = "failed"


def object_key(document_hash: str) -> str:
    """Where one document's bytes live, addressed by their own hash.

    The prefix sits beside ``campaign-finance/<dataset>/`` and
    ``campaign-finance/filings/``, so one listing of the bucket tells the three kinds of
    stored body apart without consulting the database.
    """
    return f"campaign-finance/report-document/{document_hash}.pdf.gz"


def gzip_bytes_to(body: bytes, destination_path: str) -> tuple[str, int]:
    """Compress ``body`` so identical input always yields identical stored bytes.

    ``mtime=0`` and ``filename=""`` for the reason ``campaign_finance.py``'s ``gzip_to``
    documents: without the first the gzip header carries a new timestamp every run, and
    without the second it carries the output file's own basename, which is a property of
    a temporary path and not of the document.
    """
    with (
        open(destination_path, "wb") as raw,
        gzip.GzipFile(fileobj=raw, mode="wb", mtime=0, filename="") as compressed,
    ):
        compressed.write(body)
    return sha256_of_file(destination_path), os.path.getsize(destination_path)


def read_document(store: Any, row: Any, directory: str) -> bytes:
    """The original document bytes back out of the store, proved on the way.

    Raises rather than returning something plausible when the object no longer hashes to
    what the row records: a body that changed under us must never be handed to a reader
    as though it were the file a figure was published from.
    """
    compressed_path = os.path.join(directory, "report-document.pdf.gz")
    try:
        store.get(row.object_key, compressed_path)
        stored_hash = sha256_of_file(compressed_path)
        if stored_hash != row.compressed_hash:
            raise RuntimeError(
                f"the kept document {row.object_key} hashes to {stored_hash} and its row "
                f"records {row.compressed_hash}, so the stored bytes are not the ones "
                "this row vouches for. Nothing has been decompressed."
            )
        with gzip.open(compressed_path, "rb") as compressed:
            return compressed.read()
    finally:
        if os.path.exists(compressed_path):
            os.remove(compressed_path)


@dataclass
class DocumentStoreReport:
    """What one run stored, and what it could not."""

    stored: int = 0
    already_stored: int = 0
    bytes_stored: int = 0
    failures: list[str] = field(default_factory=list)

    def note(self, action: str, byte_size: int = 0, detail: str = "") -> None:
        if action == STORED:
            self.stored += 1
            self.bytes_stored += byte_size
        elif action == ALREADY_STORED:
            self.already_stored += 1
        else:
            self.failures.append(detail)

    def summary(self) -> str:
        lines = [
            f"documents stored now:  {self.stored:>5}  ({self.bytes_stored:,} bytes)",
            f"already stored:        {self.already_stored:>5}",
            f"failed to store:       {len(self.failures):>5}",
        ]
        if self.failures:
            lines.append("\nCould not be stored:")
            lines.extend(f"  {detail}" for detail in self.failures)
        return "\n".join(lines)


@dataclass
class DocumentKeeper:
    """Stores each document a run reads, and remembers what happened.

    Passed into the check rather than reached for inside it, so a dry run and every test
    keep working with no store at all: ``None`` in place of one means read the document
    and keep nothing, which is exactly what the check did before this existed.
    """

    db: Session
    store: Any
    directory: str
    report: DocumentStoreReport = field(default_factory=DocumentStoreReport)

    def keep(
        self,
        *,
        document_hash: str,
        body: bytes,
        registration_number: str,
        filing_year: int,
        report_type: Optional[str],
        amendment_index: Optional[int],
    ) -> str:
        try:
            action = store_document(
                self.db,
                self.store,
                self.directory,
                document_hash=document_hash,
                body=body,
                registration_number=registration_number,
                filing_year=filing_year,
                report_type=report_type,
                amendment_index=amendment_index,
            )
        except Exception as error:  # noqa: BLE001 - reported, never swallowed
            self.db.rollback()
            detail = (
                f"{registration_number}:{filing_year} document {document_hash[:12]} "
                f"({len(body):,} bytes): {error}"
            )
            self.report.note(FAILED, detail=detail)
            return FAILED
        self.report.note(action, byte_size=len(body))
        return action


def store_document(
    db: Session,
    store: Any,
    directory: str,
    *,
    document_hash: str,
    body: bytes,
    registration_number: str,
    filing_year: int,
    report_type: Optional[str],
    amendment_index: Optional[int],
) -> str:
    """Keep one document's bytes and record where they are. Returns what it did.

    Committed per document, so a run that dies at document 900 keeps the 899 before it.
    A 20-minute pass over a year makes about 1,300 requests, and the Board's documents
    are not re-fetchable, so batching the writes would risk exactly the bytes this
    module exists to hold.
    """
    existing = db.get(schema.CampaignFinanceReportDocument, document_hash)
    if existing is not None:
        return ALREADY_STORED

    key = object_key(document_hash)
    compressed_path = os.path.join(directory, f"{document_hash}.pdf.gz")
    try:
        compressed_hash, compressed_size = gzip_bytes_to(body, compressed_path)
        # Read back and verify before the row exists (§4.5). ``put_and_verify`` uploads
        # only when the object is absent and reads it back either way, so re-running this
        # on an object an earlier crashed run already uploaded costs one read.
        store.put_and_verify(key, compressed_path, compressed_hash)
    finally:
        if os.path.exists(compressed_path):
            os.remove(compressed_path)

    db.add(
        schema.CampaignFinanceReportDocument(
            document_hash=document_hash,
            object_key=key,
            byte_size=len(body),
            compressed_hash=compressed_hash,
            compressed_byte_size=compressed_size,
            compression="gzip",
            registration_number=registration_number,
            filing_year=filing_year,
            report_type=report_type,
            amendment_index=amendment_index,
        )
    )
    try:
        db.commit()
    except IntegrityError:
        # Two runs can fetch the same document and both find no row. The primary key
        # decides, and the loser has nothing to do: the object it uploaded is the same
        # object, because the key is a hash of the bytes.
        db.rollback()
        return ALREADY_STORED
    return STORED


def stored_document_hashes(db: Session) -> set[str]:
    """Every document hash whose bytes we already hold."""
    return set(
        db.scalars(select(schema.CampaignFinanceReportDocument.document_hash)).all()
    )


__all__ = [
    "ALREADY_STORED",
    "FAILED",
    "STORED",
    "DocumentKeeper",
    "DocumentStoreReport",
    "gzip_bytes_to",
    "object_key",
    "read_document",
    "store_document",
    "stored_document_hashes",
]
