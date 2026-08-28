#!/usr/bin/env python3
"""Keep our own copy of every source Alethical's published writing cites, and check
weekly that Minnesota's copy still matches (#1798, #1802).

Net: every published research piece and guide ends in a sources block promising a reader
they can go and check the record themselves. Minnesota can take that away with nothing
looking wrong. On 27 August 2026 the Board replaced a handbook in place 4 hours after a
guide quoting it posted and 2 quoted sentences vanished; the same day the lobbying page
behind our largest published figure started answering HTTP 200 with a page reading "This
page is not available"; and its 2025 filing calendars turned out to be gone the same way.
This stores each cited document once, and re-reads them weekly to say which have gone or
changed.

**Why a status code decides nothing here.** Every soft failure this repository has
measured against ``cfb.mn.gov`` answers **200**: a dead viewer answers 200 with an error
page, and a missing PDF answers 200 with the site's HTML shell. So this reads the bytes.
Proven against 2 real addresses, both measured 28 August 2026 and both answering 200:

    # the site's HTML shell where a PDF should be -- reported as gone
    PYTHONPATH=. uv run python scripts/archive_published_sources.py --classify-only \\
        --url https://cfb.mn.gov/pdf/calendars/2025_senate_house_district_court.pdf

    # a real PDF at the same kind of address -- reported as the document
    PYTHONPATH=. uv run python scripts/archive_published_sources.py --classify-only \\
        --url https://cfb.mn.gov/pdf/calendars/2026_senate_house_district_court.pdf

The weekly run, which is what the schedule calls:

    ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. uv run \\
        python scripts/archive_published_sources.py --target production

    # what we hold and what a run would fetch, touching no network and writing nothing
    PYTHONPATH=. uv run python scripts/archive_published_sources.py \\
        --target production --dry-run

**Which addresses, read from one place.** The cited addresses and the error-page wording
both come from ``scripts/check_published_piece_links.py``, the weekly link check
(#1815), loaded here rather than copied. That check asks whether a reader can still
reach the page; this one asks whether the document is still the one we cited. Neither
answers the other's question, and there is one definition of "the addresses our
published writing cites".

Exits 1 when any cited source has gone or changed, or when a document was read and could
not be stored, so the scheduled job can report it. A store that quietly stops is worse
than none, because it is trusted.

Requests are spaced: a session tripped this site's bot protection with a fast loop on
27 August 2026, and there are 16 addresses, so spacing costs a run about a minute.

Design: ``docs/architecture/campaign-finance-system-design.md`` §4.5 (where the
downloaded files live, and for how long).
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import os
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from alethical.db.session import NO_PREPARED_STATEMENTS, database_url_for_target
from alethical.db import models as schema
from alethical.pipeline.published_source_archive import (
    CHANGED,
    DOCUMENT,
    FAILED,
    GONE,
    NEW,
    UNREACHABLE,
    ArchiveReport,
    SourceOutcome,
    classify,
    format_report,
    known_versions,
    read_copy,
    store_copy,
)
from alethical.pipeline.raw_file_store import raw_file_store_from_env

ROOT = Path(__file__).resolve().parents[1]


def _link_check():
    """The weekly link check's own module, loaded by path.

    Imported this way rather than copied so the list of cited addresses and the wording
    that marks an error page have one definition. ``scripts/`` is not a package, which
    is why this is a path load and not an ``import`` -- the same thing
    ``alethical/tests/test_check_published_piece_links.py`` does.
    """
    path = ROOT / "scripts" / "check_published_piece_links.py"
    spec = importlib.util.spec_from_file_location("check_published_piece_links", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def cited_addresses(links) -> dict[str, list[str]]:
    """Every outward address our published pieces cite, and which pieces cite it.

    Internal links (``/read/...``) are the link check's business, not ours: there is no
    outside copy of our own page to keep. The 4 ``github.com`` addresses in the pieces
    are in the source files' own comments to the next builder rather than in anything a
    reader can click, so ``links_in`` never yields them.
    """
    found: dict[str, list[str]] = {}
    for path in links.piece_files():
        for url in links.links_in(path):
            if url.startswith("http"):
                found.setdefault(url, []).append(path.name)
    return found


def fetch(url: str, timeout: int, links) -> tuple[int, str, bytes]:
    request = urllib.request.Request(url, headers={"User-Agent": links.USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return (
            response.status,
            response.headers.get("Content-Type", ""),
            response.read(),
        )


def read_one(url: str, timeout: int, links) -> tuple[str, str, int, str, bytes]:
    """Read one address and say what it served. Never raises.

    Returns ``(action, detail, status, media_type, body)``, where an empty action means
    the response is the document and the caller should go on to compare it.
    """
    try:
        status, media_type, body = fetch(url, timeout, links)
    except urllib.error.HTTPError as error:
        if error.code in (404, 410):
            return (
                GONE,
                f"answers HTTP {error.code}. The page is gone.",
                error.code,
                "",
                b"",
            )
        return UNREACHABLE, f"HTTP {error.code}", error.code, "", b""
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        # A timeout, a refused connection or a 5xx is the site having a bad minute, not
        # our link being wrong. Reporting it would train everyone to ignore this check.
        return UNREACHABLE, str(error), 0, "", b""

    wording = None
    if body.lstrip()[:1] == b"<":
        wording = links.page_says_it_is_missing(body.decode("utf-8", "replace"))
    action, detail = classify(url, status, body, wording)
    return action, detail, status, media_type, body


def check_sources(
    addresses: dict[str, list[str]],
    *,
    links,
    db: Session | None,
    store,
    directory: str | None,
    timeout: int,
    spacing: float,
    log=print,
) -> ArchiveReport:
    """Read every address once, and store or compare what it served.

    With no ``db``, this classifies and stores nothing -- what ``--classify-only`` runs,
    so the byte-reading half can be proved against a real address with no credentials.
    """
    report = ArchiveReport()
    held = known_versions(db) if db is not None else {}

    for index, url in enumerate(sorted(addresses)):
        if index:
            time.sleep(spacing)
        cited_by = ", ".join(sorted(set(addresses[url])))
        action, detail, _status, media_type, body = read_one(url, timeout, links)
        if action:
            report.outcomes.append(
                SourceOutcome(url, action, detail, cited_by=cited_by)
            )
            log(f"  {action.upper():<11} {url}\n      {detail}")
            continue

        content_hash = hashlib.sha256(body).hexdigest()
        versions = held.get(url, set())
        if db is None:
            report.outcomes.append(
                SourceOutcome(
                    url,
                    DOCUMENT,
                    f"serves {len(body):,} bytes of {media_type or 'unknown type'}, "
                    f"sha256 {content_hash[:16]}",
                    byte_size=len(body),
                    cited_by=cited_by,
                )
            )
            log(f"  document    {url}\n      {report.outcomes[-1].detail}")
            continue

        try:
            stored = store_copy(
                db,
                store,
                directory,
                url=url,
                content_hash=content_hash,
                body=body,
                media_type=media_type,
                cited_by=cited_by,
            )
        except Exception as error:  # noqa: BLE001 - reported, never swallowed
            db.rollback()
            report.outcomes.append(
                SourceOutcome(
                    url,
                    FAILED,
                    f"read {len(body):,} bytes and could not keep them: {error}",
                    cited_by=cited_by,
                )
            )
            log(f"  FAILED      {url}\n      {report.outcomes[-1].detail}")
            continue

        if stored == NEW and versions:
            # A version we have never held at an address we already hold copies of.
            # This is #1798: the address, the status and the page's own look are all
            # unchanged, and the document is a different document.
            report.outcomes.append(
                SourceOutcome(
                    url,
                    CHANGED,
                    f"now serves {len(body):,} bytes hashing to {content_hash[:16]}, "
                    f"and we already hold {len(versions)} other version(s) of this "
                    "address. Our copy of what we cited is kept, and this new version "
                    "is kept beside it.",
                    byte_size=len(body),
                    cited_by=cited_by,
                )
            )
            log(f"  CHANGED     {url}\n      {report.outcomes[-1].detail}")
            continue

        report.outcomes.append(
            SourceOutcome(url, stored, "", byte_size=len(body), cited_by=cited_by)
        )
        log(f"  {stored:<11} {url} ({len(body):,} bytes)")
    return report


def describe_only(db: Session, addresses: dict[str, list[str]]) -> int:
    """Say what we hold and what a real run would read. Fetches nothing, writes nothing."""
    held = known_versions(db)
    print(
        f"\n{len(addresses)} cited address(es); we hold a copy of "
        f"{sum(1 for url in addresses if held.get(url))}."
    )
    for url in sorted(addresses):
        versions = held.get(url, set())
        state = f"{len(versions)} version(s) kept" if versions else "NOTHING KEPT YET"
        print(f"  {state:<20} {url}")
    extra = sorted(set(held) - set(addresses))
    if extra:
        print(
            f"\n{len(extra)} address(es) we hold a copy of that no published piece "
            "cites any more. Kept: §4.5 retains every stored body indefinitely, and a "
            "figure published from one is still traceable to it."
        )
        for url in extra:
            print(f"  {url}")
    return 0


def verify_stored(db: Session, store, directory: str) -> int:
    """Read every copy we hold back out of the store and confirm it is the document.

    Not part of the weekly run: re-proving the whole store, and proving a restore
    actually works, is [#802](https://github.com/alethical-org/alethical/issues/802).
    This is the same question asked of this one table, on demand, so a person can answer
    "is our archive still the thing we published from" in one command.

    ``read_copy`` already refuses a body whose compressed bytes do not match the row.
    This goes one step further and hashes the *decompressed* bytes against
    ``content_hash``, which is what a reader would have downloaded.
    """
    rows = list(db.scalars(select(schema.PublishedSourceCopy)))
    print(f"{len(rows)} kept cop(ies) to read back.")
    bad: list[str] = []
    for row in rows:
        try:
            body = read_copy(store, row, directory)
        except Exception as error:  # noqa: BLE001 - reported, never swallowed
            bad.append(f"{row.url}\n      {error}")
            print(f"  UNREADABLE  {row.url}\n      {error}")
            continue
        digest = hashlib.sha256(body).hexdigest()
        if digest != row.content_hash:
            bad.append(
                f"{row.url}\n      reads back hashing to {digest}, and the row records "
                f"{row.content_hash}"
            )
            print(f"  WRONG BYTES {row.url}")
            continue
        print(f"  identical   {row.url} ({len(body):,} bytes)")
    if bad:
        print("\nThese kept copies are not the documents their rows vouch for:")
        for detail in bad:
            print(f"  - {detail}")
        return 1
    print("\nEvery kept copy read back byte-identical to the document it records.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", default=os.environ.get("ALETHICAL_DATABASE_TARGET"))
    parser.add_argument("--timeout", type=int, default=45)
    parser.add_argument(
        "--url",
        action="append",
        default=[],
        help="Check these addresses instead of the ones our published pieces cite.",
    )
    parser.add_argument(
        "--classify-only",
        action="store_true",
        help="Read each address and say what it serves. Stores nothing, writes nothing, "
        "needs no credentials and no database.",
    )
    parser.add_argument(
        "--verify-stored",
        action="store_true",
        help="Read every copy we already hold back out of the store and confirm it is "
        "byte-identical to the document its row records. Fetches nothing from Minnesota.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Say what we hold and what a run would read. Fetches nothing.",
    )
    parser.add_argument(
        "--spacing",
        type=float,
        default=None,
        help="Seconds between requests. Defaults to the link check's own spacing.",
    )
    args = parser.parse_args()

    links = _link_check()
    spacing = (
        args.spacing if args.spacing is not None else links.REQUEST_SPACING_SECONDS
    )

    if args.url:
        addresses = {url: [] for url in args.url}
    else:
        addresses = cited_addresses(links)
        if not addresses:
            print(
                "No outward addresses found in the published pieces. Either they lost "
                "their sources blocks, or this check has stopped being able to read "
                "them. Refusing to report a clean run on nothing."
            )
            return 1
    print(f"{len(addresses)} address(es) to read.")

    if args.classify_only:
        report = check_sources(
            addresses,
            links=links,
            db=None,
            store=None,
            directory=None,
            timeout=args.timeout,
            spacing=spacing,
        )
        print(f"\n{format_report(report)}")
        return 1 if report.needs_attention else 0

    engine = create_engine(
        database_url_for_target(args.target), connect_args=NO_PREPARED_STATEMENTS
    )
    with Session(engine) as db:
        if args.dry_run:
            return describe_only(db, addresses)
        store = raw_file_store_from_env()
        if args.verify_stored:
            with tempfile.TemporaryDirectory(prefix="published-sources-") as directory:
                return verify_stored(db, store, directory)
        print(f"store: {store.bucket}")
        with tempfile.TemporaryDirectory(prefix="published-sources-") as directory:
            report = check_sources(
                addresses,
                links=links,
                db=db,
                store=store,
                directory=directory,
                timeout=args.timeout,
                spacing=spacing,
            )
    print(f"\n{format_report(report)}")
    if report.needs_attention:
        print(
            "\nA change to a posted piece is the Alethical team's to direct "
            "(.claude/rules/grounded-answers.md rule 13), so report these rather than "
            "editing a piece. Resolve a replacement from the Board's own index and "
            "confirm it by reading the page, never by its status code."
        )
        return 1
    print("\nEvery cited source still serves the document we kept a copy of.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
