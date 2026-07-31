#!/usr/bin/env python3
"""Repair text that was stored after being decoded with the wrong character set (#849).

Why this exists (one-time data fix, no money, no re-ingest): two of the pages we
scrape answer ``Content-Type: text/xml`` / ``text/html`` with no charset, so
``requests`` fell back to ISO-8859-1 (RFC 2616 §3.7.1) while the bytes were UTF-8.
Every UTF-8 byte became its own Latin-1 character on the way in, which is why
production holds "PÃ©rez-Vega" where it should hold "Pérez-Vega". The reader is
fixed at source (``alethical/pipeline/http_text.py``); this repairs what is already
stored.

The repair is the exact inverse of the damage: encode back to ISO-8859-1 to recover
the original bytes, then decode them as the UTF-8 they always were. Nothing is
guessed and no network call is made.

Safe + idempotent by construction:
  * a row is only touched when it BOTH carries a mojibake marker AND round-trips
    cleanly — either test alone would be enough, and requiring both means a value
    that merely happens to survive the round-trip is left alone;
  * a repaired value no longer round-trips, so re-running is a no-op;
  * verified against all 72,426 rows of the five columns scanned: the round-trip
    changes exactly the 45 rows carrying a marker and no others.

Deliberately NOT covered: ``evidence_document`` (62 mangled rows). Its ``content``
is generated text copied from ``bill.description``, so string surgery there would
patch a derivative rather than the record; several of its rows mix correct UTF-8
with mangled UTF-8 in one string and cannot be repaired by a whole-string
round-trip at all. It is tracked separately.

Usage (run from the repo root; PYTHONPATH=. so `alethical` imports):
    # dry run (default) — reports every row it would change, writes nothing
    ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. uv run \
        python scripts/repair_mojibake_text.py

    # scoped live check — one table/column first, then read it back
    ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. uv run \
        python scripts/repair_mojibake_text.py --apply --only bill.description

    # full apply
    ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. uv run \
        python scripts/repair_mojibake_text.py --apply
"""

from __future__ import annotations

import argparse
import os

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from alethical.db.session import (
    NO_PREPARED_STATEMENTS,
    database_url_for_target,
    normalize_database_url,
)

# The columns that hold a value scraped straight from a source page, in the order
# a reader would check them. Anything derived from these is regenerated, not
# string-repaired.
TARGETS: tuple[tuple[str, str], ...] = (
    ("bill_action", "action_description"),
    ("bill", "description"),
    ("legislator_service_period", "office_address"),
)

# The tell-tale characters a UTF-8 byte turns into when read as Latin-1: the lead
# bytes of a 2- and 3-byte sequence (0xC3, 0xC2) and the 0xE2 0x80 pair behind
# curly quotes and dashes.
MARKERS = ("Ã", "Â", "â€")


def repaired(value: str) -> str | None:
    """The value as it was before the wrong-charset decode, or None if unaffected.

    Returns None both for a value that is already correct and for one the
    round-trip cannot recover — neither is safe to write.
    """
    try:
        original = value.encode("iso-8859-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return None
    return original if original != value else None


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Repair text stored after a wrong-charset decode (#849)."
    )
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write the changes. Without this flag the script only reports (dry run).",
    )
    parser.add_argument(
        "--only",
        default=None,
        help="Limit to one 'table.column' (e.g. bill.description) for a scoped check.",
    )
    args = parser.parse_args()

    targets = TARGETS
    if args.only:
        wanted = tuple(args.only.split(".", 1))
        targets = tuple(t for t in TARGETS if t == wanted)
        if not targets:
            raise SystemExit(
                f"--only {args.only!r} is not one of: "
                + ", ".join(f"{t}.{c}" for t, c in TARGETS)
            )

    database_url = normalize_database_url(
        args.database_url
        or database_url_for_target(os.environ.get("ALETHICAL_DATABASE_TARGET"))
    )
    engine = create_engine(
        database_url, echo=False, connect_args=NO_PREPARED_STATEMENTS
    )

    total = 0
    with Session(engine) as session:
        for table, column in targets:
            # Only rows carrying a marker are read back, so the scan stays cheap on
            # a 10k-bill corpus; the round-trip is the second gate below.
            rows = session.execute(
                text(
                    f'select id, "{column}" as value from "{table}" '
                    f'where "{column}" is not null and ('
                    + " or ".join(f'"{column}" like :m{i}' for i in range(len(MARKERS)))
                    + ") order by id"
                ),
                {f"m{i}": f"%{m}%" for i, m in enumerate(MARKERS)},
            ).all()

            changed = unrecoverable = 0
            for row in rows:
                fixed = repaired(row.value)
                if fixed is None:
                    unrecoverable += 1
                    print(f"  ~ {table}.{column} {row.id}: marker but no clean repair")
                    continue
                changed += 1
                print(f"  {table}.{column} {row.id}:")
                print(f"      {row.value[:90]!r}")
                print(f"   -> {fixed[:90]!r}")
                if args.apply:
                    session.execute(
                        text(f'update "{table}" set "{column}" = :v where id = :id'),
                        {"v": fixed, "id": row.id},
                    )

            verb = "repaired" if args.apply else "would repair"
            print(
                f"{table}.{column}: {len(rows)} row(s) carry a marker, {verb} {changed}."
            )
            if unrecoverable:
                print(
                    f"  {unrecoverable} row(s) left untouched — a whole-string "
                    "round-trip cannot recover them (mixed encodings)."
                )
            total += changed

        if args.apply:
            session.commit()

    verb = "repaired" if args.apply else "would repair"
    print(f"\n{verb}: {total} row(s).")
    if not args.apply:
        print("dry run — no changes written. Re-run with --apply to write.")


if __name__ == "__main__":
    main()
