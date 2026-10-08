"""Bounded upkeep of the private, fixed three-station FCC archive."""

from __future__ import annotations

from typing import Any, Callable

from sqlalchemy.orm import Session

from alethical.pipeline import fcc_archive as archive
from alethical.pipeline.fcc_public_files import DEFAULT_STATIONS


def refresh(
    db: Session,
    store: Any,
    mirror: Any,
    *,
    max_files: int = 1000,
    extract_limit: int = 1000,
    mirror_limit: int = 2500,
    workers: int = 3,
    log: Callable[[dict], None] = lambda row: None,
) -> dict:
    """Keep every phase's evidence, including after another phase fails.

    Source access restrictions are coverage gaps, not proof that the job broke.
    They still keep the persistent problem report open. Unexpected failures and
    unfinished bounded work fail the run so capacity problems cannot stay hidden.
    """
    if not (
        1 <= max_files <= 2000
        and 1 <= extract_limit <= 2000
        and 1 <= mirror_limit <= 5000
        and 1 <= workers <= 4
    ):
        raise ValueError("FCC refresh limits exceed the bounded run settings")
    report: dict = {
        "stations": [station.call_sign for station in DEFAULT_STATIONS],
        "limits": dict(
            downloads=max_files, readings=extract_limit, second_copies=mirror_limit
        ),
        "errors": {},
    }
    phases = (
        (
            "collection",
            lambda: archive.collect(
                db,
                store,
                stations=DEFAULT_STATIONS,
                workers=workers,
                max_files=max_files,
                incremental=True,
                log=log,
            ),
        ),
        (
            "mirror",
            lambda: archive.mirror_bodies(db, store, mirror, limit=mirror_limit),
        ),
        (
            "extraction",
            lambda: archive.extract_pending(
                db,
                store,
                limit=extract_limit,
                workers=min(workers, 2),
                retry_operational=True,
                log=log,
            ),
        ),
        ("coverage", lambda: archive.status(db)),
        ("gaps", lambda: archive.gaps(db)),
    )
    for name, run in phases:
        try:
            report[name] = run()
        except Exception as error:
            db.rollback()
            # Do not put connection strings, provider replies or credentials in
            # reports. Previously committed evidence remains available to retry.
            report["errors"][name] = type(error).__name__
        log(
            {
                "phase": name,
                "result": report.get(name),
                "error": report["errors"].get(name),
            }
        )

    collection = report.get("collection", {})
    report["source_gaps"] = collection.get("files_unavailable", 0)
    coverage = report.get("coverage", {})
    report["reading_gaps"] = sum(
        count
        for state, count in coverage.get("readings", {}).items()
        if state != "pending_review"
    )
    report["reading_operational_failures"] = coverage.get(
        "reading_operational_failures", 0
    )
    report["backlog"] = {
        "downloads": collection.get("files_deferred", 0),
        "second_copies": report.get("coverage", {}).get(
            "bodies_without_second_copy", 0
        ),
        "readings": report.get("gaps", {}).get("unread_documents", 0),
    }
    failed = bool(
        report["errors"]
        or collection.get("folders_failed", 0)
        or collection.get("files_failed", 0)
        or report.get("mirror", {}).get("failed", 0)
        or report.get("extraction", {}).get("failed", 0)
        or report["reading_operational_failures"]
        or any(report["backlog"].values())
        or collection.get("status") not in {"complete", "incomplete", "limited"}
    )
    report["status"] = (
        "needs_attention"
        if failed
        else "current_with_gaps"
        if report["source_gaps"] or report["reading_gaps"]
        else "current"
    )
    report["needs_attention"] = failed
    return report
