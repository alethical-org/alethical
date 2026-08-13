"""Copy every stored source file to a second place, and prove the copy arrived.

Minnesota's Campaign Finance Board publishes no archive: the download links never
change and the file behind each one is replaced as it grows, so a file we fail to
keep is not re-fetchable — asking again returns a different file. The primary store
(``raw_file_store.py``) is one private Supabase bucket, and Supabase's own
documentation says database backups "do not include objects you store via the
Storage API". So until this job runs, nothing at all protects those bytes.

What is at stake is bounded, which is worth stating so nobody over-builds this:
every parsed row and every file hash live in Postgres and ride the database
backups, so no *displayed* figure disappears. What disappears is the ability to
show the source bytes behind a figure and to examine a rejected download.

Design: ``docs/architecture/campaign-finance-system-design.md`` §4.5 (where the
downloaded files live, and for how long). Issue:
`#1402 <https://github.com/alethical-org/alethical/issues/1402>`_.

**The bucket is the work list, not the database.** One bucket serves every
database, so a local run's downloads land beside production's and production's rows
name only some of what is there. Measured 12 August 2026: 12 objects stored, 3 of
them named by a production row. Walking the rows instead would have left 9 real
downloads of dated Minnesota files with no second copy — and those 9 are exactly as
unrepeatable as the 3, because the Board has already replaced the files they came
from.

**What a run costs after the first one: one HEAD request per object, and no bytes.**
An object whose row already records a confirmed copy is skipped outright, and an
object with no row is skipped once its copy is present at the same size. That keeps
a daily run flat as the store grows past the 7 to 10 GB a year §4.5 projects,
instead of re-reading the whole store every night. Re-proving the *whole* store, and
proving a restore actually works, is
`#802 <https://github.com/alethical-org/alethical/issues/802>`_, not this job.

**Which tables hold a stored body is read out of the schema, never listed here
(#1501).** This job was written for ``cf_snapshot_body`` and named it directly, and
by the time anybody looked, two other tables held stored bodies: the totals
archives on ``cf_filing_snapshot`` had been copied to the second store by the
bucket walk above and had **0 of 2 rows recording it**, and #1433's report
documents were not being kept at all. Neither is a mistake anybody made twice --
they are what happens when covering a new kind of body depends on somebody
remembering that this file exists.

So the work list is every mapped table carrying all 3 of ``object_key``,
``compressed_hash`` and ``mirrored_at``. A future fourth kind of stored body is
covered the day its table ships, with no edit here, and
``test_raw_file_mirror.py`` fails if a table gains an ``object_key`` without the
other two columns -- which is the one way this discovery could silently miss
something.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from alethical.db import models as schema
from alethical.pipeline.raw_file_store import sha256_of_file

# Actions an object can end a run in. "copied" and "confirmed" both mean the bytes
# were read back out of the second copy and hashed during this run; the difference
# is only whether this run is the one that wrote them.
COPIED = "copied"
CONFIRMED = "confirmed"
ALREADY_MIRRORED = "already-mirrored"
ALREADY_PRESENT = "already-present"
FAILED = "failed"

# The 3 columns a table needs before this job can protect what it points at: where the
# object is, what it should hash to, and somewhere to record that a copy was proved.
BODY_COLUMNS = ("object_key", "compressed_hash", "mirrored_at")


def body_tables() -> list[Any]:
    """Every mapped class that records a stored object, read out of the schema.

    Deliberately discovery rather than a list. A list is a promise that whoever adds
    the next kind of stored body will also find and edit this file, and #1501 is the
    record of that promise failing twice in one week.
    """
    found = [
        mapper.class_
        for mapper in schema.Base.registry.mappers
        if all(column in mapper.class_.__table__.columns for column in BODY_COLUMNS)
    ]
    return sorted(found, key=lambda model: model.__tablename__)


def rows_by_object_key(db: Session) -> dict[str, list[Any]]:
    """Every row in every body-bearing table, keyed on the object it names.

    A list per key rather than one row, because two tables naming one object is
    storable even though the content-addressed prefixes make it unlikely, and the
    honest response is to stamp both rather than to pick one and leave the other
    reading "never copied" forever. A row whose ``object_key`` is NULL names nothing
    yet -- ``cf_filing_snapshot`` allows that for a run whose archive is still being
    written -- so it is skipped rather than treated as a gap.
    """
    rows: dict[str, list[Any]] = {}
    for model in body_tables():
        for row in db.scalars(select(model)):
            key = row.object_key
            if key:
                rows.setdefault(key, []).append(row)
    return rows


@dataclass
class ObjectOutcome:
    key: str
    action: str
    byte_size: int
    detail: str = ""


@dataclass
class MirrorReport:
    outcomes: list[ObjectOutcome] = field(default_factory=list)
    # Objects in the bucket that no row in this database names. Not an error — see
    # the module docstring — but a number worth surfacing, because it is the gap
    # between what the store holds and what the database can vouch for.
    unrecorded_keys: list[str] = field(default_factory=list)

    def of(self, action: str) -> list[ObjectOutcome]:
        return [outcome for outcome in self.outcomes if outcome.action == action]

    @property
    def failures(self) -> list[ObjectOutcome]:
        return self.of(FAILED)

    @property
    def bytes_copied(self) -> int:
        return sum(outcome.byte_size for outcome in self.of(COPIED))


def mirror_raw_files(
    db: Session,
    source: Any,
    mirror: Any,
    directory: str,
    log: Callable[[str], None] = print,
) -> MirrorReport:
    """Copy anything in ``source`` that is not already proven present in ``mirror``.

    One object's failure never stops the others: a store that quietly stops copying
    is worse than no store at all, because it is trusted. Every failure is collected
    and the caller exits non-zero on them.
    """
    bodies = rows_by_object_key(db)
    objects = source.list_objects()
    report = MirrorReport(
        unrecorded_keys=sorted(key for key in objects if key not in bodies)
    )
    log(
        f"{len(objects)} object(s) in the source store, "
        f"{len(objects) - len(report.unrecorded_keys)} named by a row in this database, "
        f"across {len(body_tables())} table(s) that hold a stored body"
    )

    for key in sorted(objects):
        size = objects[key]
        rows = bodies.get(key, [])
        if rows and all(row.mirrored_at is not None for row in rows):
            report.outcomes.append(ObjectOutcome(key, ALREADY_MIRRORED, size))
            continue
        try:
            action = _mirror_one(source, mirror, key, size, rows, directory)
        except Exception as error:  # noqa: BLE001 - reported, never swallowed
            report.outcomes.append(ObjectOutcome(key, FAILED, size, str(error)))
            log(f"  FAILED {key}: {error}")
            continue
        report.outcomes.append(ObjectOutcome(key, action, size))
        log(f"  {action} {key} ({size:,} bytes)")
        if rows and action != ALREADY_PRESENT:
            # Stamped only after the read-back above, so this column means "read
            # back out of the second copy and confirmed", never "the upload
            # returned 200". Committed per object so a later failure cannot undo
            # copies that genuinely happened.
            for row in rows:
                row.mirrored_at = datetime.now(timezone.utc)
            db.commit()
    return report


def _mirror_one(
    source: Any,
    mirror: Any,
    key: str,
    size: int,
    rows: list[Any],
    directory: str,
) -> str:
    """Copy one object, or confirm the copy already there. Returns what it did."""
    mirrored_size = mirror.size(key)
    if mirrored_size is not None and mirrored_size != size:
        # Keys are content addresses, so two different byte counts under one name
        # cannot both be right. Never resolve it by overwriting: the primary bucket
        # may hold the only record of what the Board published on a given date.
        raise RuntimeError(
            f"{key} is {size:,} bytes in the source store and {mirrored_size:,} bytes "
            "in the second copy. The key is a hash of the file's own contents, so one "
            "name is claiming two different files and one of them is wrong. Refusing "
            "to overwrite either: whichever is which, a stored body may be the only "
            "record of what the Board published that day. Compare the compression "
            "recorded on the snapshot row before removing anything."
        )
    if mirrored_size is not None and not rows:
        # Already copied by an earlier run, which verified it by hash at the time.
        # Nothing in this database claims anything about it, so there is nothing to
        # earn by re-reading it — see the module docstring on run cost.
        return ALREADY_PRESENT

    path = os.path.join(directory, "mirror-body.tmp")
    try:
        source.get(key, path)
        digest = sha256_of_file(path)
        for row in rows:
            # A row may name an object and record no hash for it: cf_filing_snapshot's
            # hash column is nullable. Nothing already-trusted can prove such an object,
            # so it is copied and verified against the bytes we just read rather than
            # being refused — the alternative leaves it with one copy forever.
            if row.compressed_hash and digest != row.compressed_hash:
                raise RuntimeError(
                    f"{key} came out of the source store hashing to {digest}, but its "
                    f"{row.__tablename__} row records {row.compressed_hash}. The primary "
                    "copy is not the file the database says it is, so copying it would "
                    "only make a second wrong copy. Nothing has been written to the "
                    "second store."
                )
        # Uploads when absent, and in every case reads the object back out of the
        # second store and hashes it before returning. That read-back is what the
        # word "verified" means here.
        mirror.put_and_verify(key, path, digest)
    finally:
        if os.path.exists(path):
            os.remove(path)
    return CONFIRMED if mirrored_size is not None else COPIED


def format_report(report: MirrorReport) -> str:
    """A summary a person can act on, for a job log or an alert issue."""
    lines = [
        f"copied now:        {len(report.of(COPIED)):>4}  "
        f"({report.bytes_copied:,} bytes)",
        f"confirmed now:     {len(report.of(CONFIRMED)):>4}",
        f"already confirmed: {len(report.of(ALREADY_MIRRORED)):>4}",
        f"already present:   {len(report.of(ALREADY_PRESENT)):>4}",
        f"failed:            {len(report.failures):>4}",
    ]
    if report.unrecorded_keys:
        lines.append(
            f"\n{len(report.unrecorded_keys)} object(s) are stored and copied but no "
            "row in this database names them, so the database cannot record that they "
            "have a second copy. Expected: one bucket serves every database, so a run "
            "against a local database writes here too."
        )
    if report.failures:
        lines.append("\nFailures:")
        lines.extend(f"  {f.key}\n    {f.detail}" for f in report.failures)
    return "\n".join(lines)
