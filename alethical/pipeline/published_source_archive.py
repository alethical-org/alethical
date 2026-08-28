"""Keep our own copy of every source Alethical's published writing cites (#1798, #1802).

Every research piece and guide ends in a sources block whose whole promise is that a
reader can go and check the record themselves. *The Money Only Goes One Way* says it
outright: "Nothing here requires trusting us. It requires looking." Minnesota can take
that away with nothing looking wrong, and did so twice on 27 August 2026:

* the Board replaced its *Political Party Unit Handbook* in place 4 hours after a guide
  quoting it posted, and 2 quoted sentences vanished from the served copy
  ([#1798](https://github.com/alethical-org/alethical/issues/1798));
* the lobbying page behind our largest published figure, $886 million, started answering
  **HTTP 200** with a page whose only heading reads "This page is not available"
  ([#1802](https://github.com/alethical-org/alethical/issues/1802)).

Minnesota's 2025 filing calendars went the same way: 4 addresses, all answering 200 with
that page, found while checking something else.

**This is the store, not a second store.** The bucket, the content addressing, the
``mtime=0`` compression, the read-back-before-the-row rule and the second copy on
Cloudflare R2 are all settled by
``docs/architecture/campaign-finance-system-design.md`` §4.5 (where the downloaded files
live, and for how long) and implemented in ``raw_file_store.py``. This module adds a
fourth kind of stored body to that store and nothing else. Naming the 3 columns
``object_key``, ``compressed_hash`` and ``mirrored_at`` on ``published_source_copy`` is
the whole contract: the second-copy job reads which tables hold a body out of the schema
rather than from a list (#1501), so it protects this from the day it ships.

**What a check compares, and why bytes.** Measured 28 August 2026: every one of the 18
addresses in this test set was fetched twice, and all 18 returned byte-identical
responses both times, so no session id, nonce or rendering timestamp makes a plain byte
comparison noisy. The bytes are also the only thing that can catch #1798, where the
address, the status and the page's own look were all unchanged and 2 sentences were
gone.

**A body that is not the document is never stored.** An address that answers with an
error page or with a web page where we cited a PDF is reported and stored nowhere:
writing those bytes down would make them the baseline, and the run after it would call
the failure "unchanged".
"""

from __future__ import annotations

import gzip
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from alethical.db import models as schema
from alethical.pipeline.raw_file_store import sha256_of_file

# What one address ended a check in. Only GONE and CHANGED are worth a person's
# attention; NEW is the first archive of something and UNCHANGED is a quiet week.
NEW = "new"
UNCHANGED = "unchanged"
# What ``--classify-only`` reports: the address served a document, and nothing was
# compared against a stored copy because that mode holds none. A separate word from
# ``unchanged`` on purpose -- calling it unchanged would claim a comparison nobody made.
DOCUMENT = "document"
CHANGED = "changed"
GONE = "gone"
UNREACHABLE = "unreachable"
FAILED = "failed"

# Extensions whose bytes announce their own format, so an address ending in one can be
# held to serving that format rather than to answering at all. Kept to the formats
# Minnesota actually serves us.
DOCUMENT_MAGIC = {
    ".pdf": b"%PDF",
    ".zip": b"PK\x03\x04",
    ".xlsx": b"PK\x03\x04",
}


def looks_like_html(body: bytes) -> bool:
    """Whether these bytes are a web page rather than a document.

    The same test ``scripts/check_published_piece_links.py`` uses, for the same reason:
    a PDF or a CSV cannot carry an HTML error page, so the shape of the body is what
    separates "here is the document" from "here is a page explaining nothing is here".
    """
    return body.lstrip()[:1] == b"<"


def expected_magic(url: str) -> Optional[bytes]:
    """The bytes a document at this address must start with, if its name promises one."""
    path = urlsplit(url).path.lower()
    for extension, magic in DOCUMENT_MAGIC.items():
        if path.endswith(extension):
            return magic
    return None


def stored_extension(url: str, body: bytes) -> str:
    """What to call the stored object, decided by the bytes and not by the address.

    An address ending ``.pdf`` that serves a web page is a failure and never reaches
    here, so this only ever names a body we are willing to keep.
    """
    if body[:4] == b"%PDF":
        return "pdf"
    if looks_like_html(body):
        return "html"
    path = urlsplit(url).path.lower()
    for extension in DOCUMENT_MAGIC:
        if path.endswith(extension):
            return extension.lstrip(".")
    if path.endswith(".csv"):
        return "csv"
    return "bin"


def object_key(content_hash: str, extension: str) -> str:
    """Where one cited document's bytes live, addressed by their own hash.

    The prefix sits beside ``campaign-finance/<dataset>/``,
    ``campaign-finance/filings/`` and ``campaign-finance/report-document/``, so one
    listing of the bucket tells the kinds of stored body apart without consulting the
    database (§4.5). Not under ``campaign-finance/`` because what our published writing
    cites is not only campaign finance: 3 of the 16 addresses today are Minnesota
    statutes at revisor.mn.gov.
    """
    return f"published-sources/{content_hash}.{extension}.gz"


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


def read_copy(store: Any, row: Any, directory: str) -> bytes:
    """Our copy of one cited document, back out of the store and proved on the way.

    Raises rather than returning something plausible when the object no longer hashes to
    what the row records: a body that changed under us must never be handed to anybody
    as though it were the document a published figure was checked against.
    """
    compressed_path = os.path.join(directory, "published-source.gz")
    try:
        store.get(row.object_key, compressed_path)
        stored_hash = sha256_of_file(compressed_path)
        if stored_hash != row.compressed_hash:
            raise RuntimeError(
                f"the kept copy {row.object_key} hashes to {stored_hash} and its row "
                f"records {row.compressed_hash}, so the stored bytes are not the ones "
                "this row vouches for. Nothing has been decompressed."
            )
        with gzip.open(compressed_path, "rb") as compressed:
            return compressed.read()
    finally:
        if os.path.exists(compressed_path):
            os.remove(compressed_path)


def known_versions(db: Session) -> dict[str, set[str]]:
    """Every content hash we already hold, per cited address."""
    versions: dict[str, set[str]] = {}
    for url, content_hash in db.execute(
        select(schema.PublishedSourceCopy.url, schema.PublishedSourceCopy.content_hash)
    ):
        versions.setdefault(url, set()).add(content_hash)
    return versions


def store_copy(
    db: Session,
    store: Any,
    directory: str,
    *,
    url: str,
    content_hash: str,
    body: bytes,
    media_type: str,
    cited_by: str,
) -> str:
    """Keep one cited document's bytes and record where they are. Returns what it did.

    Committed per document so a run that dies partway keeps what it already stored, and
    idempotent because the key is a content address: a re-run that fetches an unchanged
    document uploads nothing and reads the object back once.
    """
    existing = db.get(schema.PublishedSourceCopy, (url, content_hash))
    if existing is not None:
        return confirm_copy(db, existing, cited_by=cited_by)

    key = object_key(content_hash, stored_extension(url, body))
    compressed_path = os.path.join(directory, f"{content_hash}.gz")
    try:
        compressed_hash, compressed_size = gzip_bytes_to(body, compressed_path)
        # Read back and verify before the row exists (§4.5). ``put_and_verify`` uploads
        # only when the object is absent and reads it back either way, so re-running
        # this over an object an earlier crashed run uploaded costs one read.
        store.put_and_verify(key, compressed_path, compressed_hash)
    finally:
        if os.path.exists(compressed_path):
            os.remove(compressed_path)

    db.add(
        schema.PublishedSourceCopy(
            url=url,
            content_hash=content_hash,
            object_key=key,
            byte_size=len(body),
            compressed_hash=compressed_hash,
            compressed_byte_size=compressed_size,
            compression="gzip",
            media_type=media_type[:120] or None,
            cited_by=cited_by,
            last_confirmed_at=datetime.now(timezone.utc),
        )
    )
    try:
        db.commit()
    except IntegrityError:
        # Two runs can fetch the same document and both find no row. The primary key
        # decides, and the loser has nothing to do: the object it uploaded is the same
        # object, because the key is a hash of the bytes.
        db.rollback()
        return UNCHANGED
    return NEW


def confirm_copy(db: Session, row: Any, *, cited_by: str) -> str:
    """Record that Minnesota's copy still hashes to this row, and who cites it now."""
    row.last_confirmed_at = datetime.now(timezone.utc)
    if cited_by and row.cited_by != cited_by:
        # Which pieces cite an address changes as we publish. Keeping it current is what
        # lets a person told "this document changed" see which published page is
        # affected without going and grepping for the address.
        row.cited_by = cited_by
    db.commit()
    return UNCHANGED


@dataclass
class SourceOutcome:
    url: str
    action: str
    detail: str = ""
    byte_size: int = 0
    cited_by: str = ""


@dataclass
class ArchiveReport:
    """What one check found, in the shape a person can act on."""

    outcomes: list[SourceOutcome] = field(default_factory=list)

    def of(self, action: str) -> list[SourceOutcome]:
        return [outcome for outcome in self.outcomes if outcome.action == action]

    @property
    def needs_attention(self) -> list[SourceOutcome]:
        """The 2 things worth a person's Monday: a source gone, and a source changed.

        A failure to store is here too. It means we read a document we now hold no copy
        of, and the next run cannot tell that from never having seen it.
        """
        return self.of(GONE) + self.of(CHANGED) + self.of(FAILED)


def classify(
    url: str, status: int, body: bytes, error_wording: Optional[str]
) -> tuple[str, str]:
    """Whether this response is the document we cited. Returns an action and a reason.

    A status code decides nothing. Every soft failure this repository has measured
    against ``cfb.mn.gov`` answers 200: a dead viewer page answers 200 with "This page
    is not available", and a missing PDF answers 200 with the site's HTML shell
    (``docs/architecture/campaign-finance-system-design.md`` §2.1, §2.2 and §9.4).
    """
    magic = expected_magic(url)
    if magic and looks_like_html(body):
        return (
            GONE,
            f"answers HTTP {status} with a web page of {len(body):,} bytes where we "
            "cited a document. The document is not there, and nothing about the "
            "response says so.",
        )
    if magic and not body.startswith(magic):
        return (
            GONE,
            f"answers HTTP {status} with {len(body):,} bytes that are not the format "
            f"its own address promises ({magic.decode('latin-1')!r} expected).",
        )
    if error_wording:
        return (
            GONE,
            f"answers HTTP {status} and says {error_wording!r}. A reader following it "
            "finds nothing.",
        )
    if not body:
        return GONE, f"answers HTTP {status} with an empty body."
    return "", ""


def format_report(report: ArchiveReport) -> str:
    """A summary for a job log or an issue comment."""
    lines = [
        f"first copy kept:   {len(report.of(NEW)):>4}",
        f"still matches:     {len(report.of(UNCHANGED)):>4}",
        f"serves a document: {len(report.of(DOCUMENT)):>4}",
        f"CHANGED:           {len(report.of(CHANGED)):>4}",
        f"GONE:              {len(report.of(GONE)):>4}",
        f"could not reach:   {len(report.of(UNREACHABLE)):>4}",
        f"could not store:   {len(report.of(FAILED)):>4}",
    ]
    unreachable = report.of(UNREACHABLE)
    if unreachable:
        lines.append(
            "\nCould not be reached, so they are not treated as gone (a timeout or a "
            "5xx is the site having a bad minute, not our link being wrong):"
        )
        lines.extend(f"  - {o.url}\n      {o.detail}" for o in unreachable)
    for action, heading in (
        (
            GONE,
            "These cited addresses no longer serve the document. A reader who goes to "
            "check a figure finds nothing:",
        ),
        (
            CHANGED,
            "Minnesota is now serving a different document at these cited addresses. "
            "Our own copy of what we cited is kept, and the new version is kept beside "
            "it:",
        ),
        (
            FAILED,
            "These were read but could not be stored, so no copy of them exists:",
        ),
    ):
        found = report.of(action)
        if found:
            lines.append(f"\n{heading}")
            for o in found:
                where = f"  ({o.cited_by})" if o.cited_by else ""
                lines.append(f"  - {o.url}{where}\n      {o.detail}")
    return "\n".join(lines)


__all__ = [
    "CHANGED",
    "DOCUMENT",
    "FAILED",
    "GONE",
    "NEW",
    "UNCHANGED",
    "UNREACHABLE",
    "ArchiveReport",
    "SourceOutcome",
    "classify",
    "confirm_copy",
    "expected_magic",
    "format_report",
    "gzip_bytes_to",
    "known_versions",
    "looks_like_html",
    "object_key",
    "read_copy",
    "store_copy",
    "stored_extension",
]
