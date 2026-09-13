"""Copy current lobbying registrations and expenditures in one checked release.

The active-list response is read only in memory. Its contact columns are discarded
while parsing; only names and registered organisations can be retained. The
existing expenditures loader owns its validation, retained bytes and row loading.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import re
import tempfile
import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import requests
from sqlalchemy import delete, insert, select, text
from sqlalchemy.orm import Session

from alethical.db import models as schema
from alethical.pipeline import lobbying_expenditures as spending
from alethical.pipeline.campaign_finance import Band, _record_fingerprint

HEADER = (
    "Reg num",
    "Name",
    "Formatted Name",
    "Associations",
    "First Name",
    "Middle Initial",
    "Last Name",
    "Suffix",
    "Street",
    "City",
    "State",
    "Zip Code",
    "Telephone",
    "Email Address",
)
# The precise records an operator approves contain no contact data, including
# suffix: the accepted storage contract names only the three name parts.
SAFE_COLUMNS = {
    "Reg num": "registration_number",
    "Name": "name",
    "Formatted Name": "formatted_name",
    "First Name": "first_name",
    "Middle Initial": "middle_initial",
    "Last Name": "last_name",
}
ASSOCIATION = re.compile(r"^\s*\(([0-9]+)\)\s+(.+?)\s*$")
REGISTRATION = re.compile(r"^[0-9]+$")
# Assumed operational band, not a source fact. It refuses both truncated and
# doubled lists; a reviewed safe record hash can waive this comparison only.
ROW_COUNT_BAND = Band(shrink=0.02, growth=0.10)


@dataclass
class ActiveList:
    source_url: str
    download_id: str
    content_hash: str
    byte_size: int
    started_at: datetime
    completed_at: datetime
    row_count: int = 0
    lobbyists: list[dict] = field(default_factory=list)
    associations: list[dict] = field(default_factory=list)
    unparsed_association_count: int = 0
    duplicate_registration_count: int = 0
    errors: list[str] = field(default_factory=list)
    record_set_hash: str = ""

    def safe_json(self) -> dict:
        """The evidence export has no original CSV records or contact fields."""
        return {
            "source_url": self.source_url,
            "download_id": self.download_id,
            "content_hash": self.content_hash,
            "record_set_hash": self.record_set_hash,
            "byte_size": self.byte_size,
            "row_count": self.row_count,
            "copied_at": self.completed_at.isoformat(),
            "unparsed_association_count": self.unparsed_association_count,
            "lobbyists": self.lobbyists,
            "associations": self.associations,
        }


def parse_active_list(
    body: bytes,
    *,
    source_url: str = "",
    download_id: str = "",
    started_at: datetime | None = None,
    completed_at: datetime | None = None,
) -> ActiveList:
    """Whitelist each field as the CSV is parsed; errors never repeat a raw row."""
    active = ActiveList(
        source_url,
        download_id,
        hashlib.sha256(body).hexdigest(),
        len(body),
        started_at or datetime.now(UTC),
        completed_at or datetime.now(UTC),
    )
    try:
        reader = csv.reader(
            io.StringIO(body.decode("utf-8-sig"), newline=""), strict=True
        )
        if tuple(next(reader, ())) != HEADER:
            active.errors.append(
                "The active-list header does not match the expected columns"
            )
            return active
        registrations: set[str] = set()
        fingerprints = []
        for number, raw in enumerate(reader, 1):
            active.row_count += 1
            if len(raw) != len(HEADER):
                active.errors.append(
                    f"Record {number} has {len(raw)} fields; expected {len(HEADER)}"
                )
                continue
            # Never put the full raw dictionary on a result, in a log or in a file.
            safe = {
                attribute: raw[HEADER.index(source)] or None
                for source, attribute in SAFE_COLUMNS.items()
            }
            reg = safe["registration_number"] or ""
            if not REGISTRATION.fullmatch(reg) or len(reg) > 20 or int(reg) <= 0:
                active.errors.append(
                    f"Record {number} has no positive registration number"
                )
            if reg in registrations:
                active.duplicate_registration_count += 1
            registrations.add(reg)
            if (
                not (safe["name"] or "").strip()
                or not (safe["formatted_name"] or "").strip()
            ):
                active.errors.append(f"Record {number} is missing its name")
            active.lobbyists.append(safe)
            entries = raw[HEADER.index("Associations")].split(";")
            # The source ends each list with one semicolon; blank middle entries
            # are malformed and must not silently disappear.
            if entries and not entries[-1].strip():
                entries.pop()
            parsed = []
            if not entries:
                active.unparsed_association_count += 1
            for position, entry in enumerate(entries, 1):
                match = ASSOCIATION.fullmatch(entry)
                if match is None or not (0 < int(match[1]) <= 2147483647):
                    active.unparsed_association_count += 1
                    continue
                association = {
                    "registration_number": reg,
                    "position": position,
                    "entity_id": int(match[1]),
                    "principal_name": match[2],
                }
                active.associations.append(association)
                parsed.append(association)
            fingerprints.append(
                _record_fingerprint(
                    [
                        json.dumps(safe, ensure_ascii=False, sort_keys=True),
                        json.dumps(parsed, ensure_ascii=False, sort_keys=True),
                    ]
                )
            )
        active.record_set_hash = hashlib.sha256(
            b"".join(sorted(fingerprints))
        ).hexdigest()
    except (UnicodeDecodeError, csv.Error):
        active.errors.append("The active-list CSV could not be read completely")
    return active


def fetch_active_list(http: requests.Session, landing_page: str) -> ActiveList:
    resolved = spending.resolve_download(
        http, landing_page, heading="lobbyist information", row_label="active lobbyists"
    )
    for attempt in range(1, spending.MAX_ATTEMPTS + 1):
        started = datetime.now(UTC)
        try:
            response = http.get(resolved.url, timeout=spending.DOWNLOAD_TIMEOUT_SECONDS)
            response.raise_for_status()
            body = response.content
            finished = datetime.now(UTC)
            filename = spending._disposition_filename(dict(response.headers)) or ""
            response.close()
            active = parse_active_list(
                body,
                source_url=resolved.url,
                download_id=resolved.download_id,
                started_at=started,
                completed_at=finished,
            )
            del body
            if "Active Lobbyists" not in filename:
                active.errors.append(
                    "The download did not name the Active Lobbyists file"
                )
            return active
        except requests.RequestException as error:
            if attempt == spending.MAX_ATTEMPTS:
                raise spending.LobbyingRefusal(
                    "Could not download the active lobbyist list"
                ) from error
            time.sleep(spending.RETRY_PAUSE_SECONDS)
    raise AssertionError("download attempts exhausted")  # pragma: no cover


def validate_active(
    active: ActiveList, baseline: Any, approved_hash: str | None
) -> list[spending.Check]:
    approved = bool(active.record_set_hash and active.record_set_hash == approved_hash)
    checks = [
        spending.Check(
            "active_list_parses_completely",
            "failed" if active.errors else "passed",
            "; ".join(active.errors[:5]) or f"{active.row_count} records parsed",
        ),
        spending.Check(
            "active_registrations_unique",
            "failed" if active.duplicate_registration_count else "passed",
            f"{active.duplicate_registration_count} duplicate registration numbers",
        ),
        spending.Check(
            "active_associations_parse_completely",
            "failed" if active.unparsed_association_count else "passed",
            f"{active.unparsed_association_count} unparsed association entries",
        ),
        spending.Check(
            "active_list_is_not_empty",
            "passed" if active.row_count else "failed",
            f"{active.row_count} active-list records",
        ),
    ]
    in_band = baseline is not None and ROW_COUNT_BAND.contains(
        active.row_count, baseline.row_count
    )
    checks.append(
        spending.Check(
            "active_row_count_within_band",
            "passed" if in_band else ("overridden" if approved else "failed"),
            f"{active.row_count} rows against {baseline.row_count} published"
            if baseline is not None
            else "No previous active list; review the safe records and name their hash",
        )
    )
    return checks


def live_release(db: Session):
    pointer = db.get(schema.LobbyingCurrentRelease, True, populate_existing=True)
    return (
        db.get(schema.LobbyingRelease, pointer.release_id, populate_existing=True)
        if pointer and pointer.release_id
        else None
    )


@dataclass
class LobbyingLoadReport:
    active: ActiveList
    expenditure: spending.Outcome
    checks: list[spending.Check]
    dry_run: bool
    release_id: uuid.UUID | None = None
    refusal: str | None = None
    copied_at: datetime | None = None

    @property
    def published(self) -> bool:
        return self.release_id is not None

    def summary(self) -> str:
        measured = self.expenditure.measurements
        lines = [
            f"active lobbyists: {self.active.row_count} rows, {len(self.active.associations)} associations",
            f"active safe records {self.active.record_set_hash}",
            f"expenditure records {measured.record_set_hash if measured else '(not parsed)'}",
        ]
        lines.extend(
            f"{c.status}: {c.name}: {c.detail}"
            for c in self.checks
            if c.status != "passed"
        )
        lines.append(
            self.refusal
            or (
                "dry run: nothing was written"
                if self.dry_run
                else f"published lobbying release {self.release_id}"
            )
        )
        return "\n".join(lines)


def _store_active(db: Session, active: ActiveList, checks: list[spending.Check]):
    snapshot = schema.LobbyistSnapshot(
        source_url=active.source_url,
        download_id=active.download_id,
        content_hash=active.content_hash,
        byte_size=active.byte_size,
        record_set_hash=active.record_set_hash or None,
        fetch_started_at=active.started_at,
        fetch_completed_at=active.completed_at,
        row_count=active.row_count,
        association_count=len(active.associations),
        unparsed_association_count=active.unparsed_association_count,
        status=schema.CampaignFinanceSnapshotStatus.quarantined,
        validation_json={"checks": [c.as_json() for c in checks]},
    )
    db.add(snapshot)
    db.commit()
    return snapshot


def _publish_pair(
    db: Session,
    active: ActiveList,
    active_snapshot: Any,
    outcome: spending.Outcome,
    store: Any,
    directory: str,
    approved_spending_hash: str | None,
    approved_active_hash: str | None,
    started: datetime,
    copied: datetime,
):
    # Same lock as spending-only publication and pruning: neither path can move
    # or delete half a release during this transaction.
    db.execute(
        text("SELECT pg_advisory_xact_lock(:key)"), {"key": spending.PUBLISH_LOCK_KEY}
    )
    db.execute(
        text(
            "SELECT release_id FROM lobbying_current_release WHERE id = true FOR UPDATE"
        )
    )
    current = live_release(db)
    if current and current.fetch_started_at > started:
        raise spending.LobbyingRefusal(
            "A newer paired lobbying copy is already published"
        )
    baseline = (
        db.get(schema.LobbyistSnapshot, current.lobbyist_snapshot_id)
        if current
        else None
    )
    checks = validate_active(active, baseline, approved_active_hash)
    if any(c.blocks_publication for c in checks):
        raise spending.LobbyingRefusal(
            "The active list failed validation against the current release"
        )
    expenditure_id = spending.publish(
        db,
        outcome,
        approved_hash=approved_spending_hash,
        store=store,
        directory=directory,
        commit=False,
    )
    db.execute(
        insert(schema.LobbyistRow),
        [{"snapshot_id": active_snapshot.id, **row} for row in active.lobbyists],
    )
    db.execute(
        insert(schema.LobbyistAssociation),
        [{"snapshot_id": active_snapshot.id, **row} for row in active.associations],
    )
    active_snapshot.status = schema.CampaignFinanceSnapshotStatus.loaded
    active_snapshot.validation_json = {"checks": [c.as_json() for c in checks]}
    release = schema.LobbyingRelease(
        previous_release_id=current.id if current else None,
        expenditure_snapshot_id=expenditure_id,
        lobbyist_snapshot_id=active_snapshot.id,
        fetch_started_at=started,
        copied_at=copied,
    )
    db.add(release)
    db.flush()
    db.execute(
        text("UPDATE lobbying_current_release SET release_id = :id WHERE id = true"),
        {"id": release.id},
    )
    db.commit()
    return release


def _prune_active(db: Session):
    db.execute(
        text("SELECT pg_advisory_xact_lock(:key)"), {"key": spending.PUBLISH_LOCK_KEY}
    )
    current = live_release(db)
    kept = {current.lobbyist_snapshot_id} if current else set()
    if current and current.previous_release_id:
        previous = db.get(schema.LobbyingRelease, current.previous_release_id)
        if previous:
            kept.add(previous.lobbyist_snapshot_id)
    for snapshot in db.scalars(
        select(schema.LobbyistSnapshot).where(
            schema.LobbyistSnapshot.status
            == schema.CampaignFinanceSnapshotStatus.loaded
        )
    ).all():
        if snapshot.id not in kept:
            db.execute(
                delete(schema.LobbyistRow).where(
                    schema.LobbyistRow.snapshot_id == snapshot.id
                )
            )
            snapshot.status = schema.CampaignFinanceSnapshotStatus.pruned
    db.commit()


def load_lobbying(
    db: Session,
    *,
    http: requests.Session | None = None,
    store: Any = None,
    dry_run: bool = False,
    publish_hash: str | None = None,
    publish_lobbyist_hash: str | None = None,
    landing_page: str = spending.LANDING_PAGE,
    log=print,
) -> LobbyingLoadReport:
    """Stage both sources, check both, and change both live pointers atomically."""
    http = http or spending._http_session()
    started = datetime.now(UTC)
    approved_spending = (publish_hash or "").strip().lower() or None
    approved_active = (publish_lobbyist_hash or "").strip().lower() or None
    with tempfile.TemporaryDirectory(prefix="alethical-lobbying-pair-") as directory:
        active = fetch_active_list(http, landing_page)
        resolved = spending.resolve_download(http, landing_page)
        fetched = spending.fetch_download(http, resolved, directory)
        outcome = spending.Outcome(fetched=fetched)
        if fetched.content_error is None:
            outcome.copy_path = os.path.join(directory, "spending-copy.csv")
            outcome.measurements = spending.parse_and_measure(
                fetched.path, outcome.candidate_snapshot_id, outcome.copy_path
            )
        copied = max(active.completed_at, fetched.completed_at)
        current = live_release(db)
        baseline = (
            db.get(schema.LobbyistSnapshot, current.lobbyist_snapshot_id)
            if current
            else None
        )
        active_checks = validate_active(active, baseline, approved_active)
        measured = outcome.measurements
        outcome.checks = spending.validate(
            fetched,
            measured,
            spending.live_snapshot(db),
            operator_approved=bool(
                measured and measured.record_set_hash == approved_spending
            ),
        )
        report = LobbyingLoadReport(
            active, outcome, active_checks + outcome.checks, dry_run, copied_at=copied
        )
        if dry_run:
            if any(c.blocks_publication for c in report.checks):
                report.refusal = "Validation failed; neither copy would publish"
            return report
        spending.ensure_pointer_row(db)
        db.execute(
            text(
                "INSERT INTO lobbying_current_release (id, release_id) VALUES (true, NULL) ON CONFLICT (id) DO NOTHING"
            )
        )
        run = schema.IngestionRun(
            adapter="minnesota_lobbying_pair",
            target_type="lobbying_release",
            status=schema.IngestionStatus.running,
            stats={},
        )
        db.add(run)
        db.commit()
        store = store or spending._store_from_env()
        active_snapshot = _store_active(db, active, active_checks)
        try:
            outcome.snapshot_id, _ = spending.record_fetch(
                db, outcome, store, directory, run.id
            )
            if any(c.blocks_publication for c in report.checks):
                spending.quarantine(db, outcome)
                report.refusal = (
                    "Validation failed; the published lobbying copies were preserved"
                )
            else:
                release = _publish_pair(
                    db,
                    active,
                    active_snapshot,
                    outcome,
                    store,
                    directory,
                    approved_spending,
                    approved_active,
                    started,
                    copied,
                )
                report.release_id = release.id
                spending.prune(db)
                _prune_active(db)
        except Exception:
            db.rollback()
            run.status = schema.IngestionStatus.failed
            run.finished_at = datetime.now(UTC)
            run.stats = {
                "published": report.published,
                "unparsed_association_count": active.unparsed_association_count,
            }
            db.commit()
            raise
        run.status = (
            schema.IngestionStatus.failed
            if report.refusal
            else schema.IngestionStatus.succeeded
        )
        run.finished_at = datetime.now(UTC)
        run.stats = {
            "published": report.published,
            "release_id": str(report.release_id) if report.release_id else None,
            "active_rows": active.row_count,
            "association_rows": len(active.associations),
            "unparsed_association_count": active.unparsed_association_count,
            "copied_at": copied.isoformat(),
        }
        db.commit()
        log(report.summary())
        return report


def restore_release(db: Session, release_id: uuid.UUID):
    """Restore a retained pair and its original copy date, never manufacture freshness.

    The caller must have reviewed this specific saved release. Both complete row
    sets must remain available; a pruned release cannot be restored by a pointer.
    """
    from sqlalchemy import func

    db.execute(
        text("SELECT pg_advisory_xact_lock(:key)"), {"key": spending.PUBLISH_LOCK_KEY}
    )
    release = db.get(schema.LobbyingRelease, release_id)
    if release is None:
        raise spending.LobbyingRefusal("The named lobbying release does not exist")
    active = db.get(schema.LobbyistSnapshot, release.lobbyist_snapshot_id)
    expenses = db.get(
        schema.LobbyingExpenditureSnapshot, release.expenditure_snapshot_id
    )
    active_count = db.scalar(
        select(func.count())
        .select_from(schema.LobbyistRow)
        .where(schema.LobbyistRow.snapshot_id == release.lobbyist_snapshot_id)
    )
    associations = db.scalar(
        select(func.count())
        .select_from(schema.LobbyistAssociation)
        .where(schema.LobbyistAssociation.snapshot_id == release.lobbyist_snapshot_id)
    )
    if (
        active is None
        or expenses is None
        or active.status != schema.CampaignFinanceSnapshotStatus.loaded
        or expenses.status != schema.CampaignFinanceSnapshotStatus.loaded
        or active_count != active.row_count
        or associations != active.association_count
        or spending.rows_present(db, expenses.id) != expenses.row_count
    ):
        raise spending.LobbyingRefusal(
            "The named release no longer has both complete row sets"
        )
    db.execute(
        text(
            "UPDATE lobbying_expenditure_current SET snapshot_id = :id WHERE id = true"
        ),
        {"id": release.expenditure_snapshot_id},
    )
    db.execute(
        text("UPDATE lobbying_current_release SET release_id = :id WHERE id = true"),
        {"id": release.id},
    )
    db.commit()
    return release
