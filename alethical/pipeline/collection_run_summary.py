"""Let a campaign-money collection run describe what it did, for the failure review.

Net: the failure review (``.github/workflows/collection-failure-review.yml``,
[#2350](https://github.com/alethical-org/alethical/issues/2350)) closes an incident only
when a later run's **own record** says every stage finished, never on a green tick alone.
This is how a collection run writes that record: 1 line of JSON per stage, appended to the
file named by ``COLLECTION_RUN_SUMMARY``. The workflow uploads the file as the
``collection-run-summary`` artifact on every run, failed or not.

Outside a workflow the variable is unset and every call does nothing, so a laptop run is
unchanged. A write that fails prints a warning and never stops the collection: a missing
record makes the review keep the incident open, which is the safe direction.

Statuses: ``published`` (new records went live), ``unchanged`` (the stage finished and
nothing was new), ``failed`` (the stage did not finish, or a check refused its records),
``skipped`` (not due this run) and ``dry_run``.
"""

from __future__ import annotations

import json
import os
import sys
from datetime import UTC, datetime
from typing import Callable, Iterable, Mapping, Optional

ENV = "COLLECTION_RUN_SUMMARY"
STATUSES = ("published", "unchanged", "failed", "skipped", "dry_run")
_recorded: set[str] = set()


def record_stage(
    stage: str,
    status: str,
    *,
    failed_checks: Iterable[str] = (),
    source_hashes: Optional[Mapping[str, str]] = None,
    details: Iterable[str] = (),
    affected_years: Iterable[int] = (),
    affected_committees: Iterable[str] = (),
    drill: bool = False,
    counts: Optional[Mapping[str, int]] = None,
    path: Optional[str] = None,
) -> None:
    """Append 1 stage record. Does nothing when no summary file is named.

    ``counts`` names how many things the stage stored or handled, such as
    ``{"statements listed": 1307, "PDFs kept": 738}``. Record it on failure too: it is
    how the incident says what a failed stage stored before it stopped, instead of
    guessing that nothing was published.
    """
    target = path or os.environ.get(ENV)
    if not target:
        return
    if status not in STATUSES:
        raise ValueError(f"unknown stage status {status!r}")
    _recorded.add(stage)
    record = {
        "stage": stage,
        "status": status,
        "failed_checks": sorted(set(failed_checks)),
        "source_hashes": dict(sorted((source_hashes or {}).items())),
        "details": [str(line) for line in details],
        "affected_years": sorted({int(year) for year in affected_years}),
        "affected_committees": sorted({str(c) for c in affected_committees}),
        "drill": bool(drill),
        "counts": {str(name): int(value) for name, value in (counts or {}).items()},
        "recorded_at": datetime.now(UTC).isoformat(),
    }
    try:
        with open(target, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    except OSError as error:
        print(f"warning: could not write the run summary ({error})", file=sys.stderr)


def run_script(stage: str, main: Callable[[], int]) -> int:
    """Run a collection script's ``main``, and record ``stage`` if ``main`` recorded nothing.

    A script records its own detailed stages at its normal end. An early refusal, a crash
    or a script that returns without recording still leaves a line, so the review never
    mistakes a run that said nothing for one that finished. Each script runs in its own
    process, so "recorded nothing" means nothing in this run of this script.
    """
    try:
        code = main()
    except BaseException as error:
        if not _recorded:
            record_stage(
                stage, "failed", details=[f"stopped: {type(error).__name__}: {error}"]
            )
        raise
    if not _recorded:
        record_stage(stage, "failed" if code else "unchanged")
    return code


def record_refresh_report(report: object) -> None:
    """Record the daily refresh's stages from its own report (``RefreshReport``).

    Read by attribute rather than imported, so this module stays free of the refresh's
    database dependencies. Stages: ``lists`` (the Board's 6 small lists and their content
    hashes), ``totals``, ``payments`` (with each file's content hash and every check that
    refused it), ``rechecks`` and, only when it failed, ``clearing saved pages``. A
    failure line the mapping does not recognise is recorded under ``refresh`` rather than
    dropped.
    """
    failures = list(getattr(report, "failures", []) or [])
    claimed: set[int] = set()

    def take(marker: str) -> list[str]:
        found = []
        for index, line in enumerate(failures):
            if index not in claimed and marker in line:
                claimed.add(index)
                found.append(line)
        return found

    dry = bool(getattr(report, "dry_run", False))
    readings = list(getattr(report, "readings", []) or [])
    lists_failed = take("lists could not be read")
    record_stage(
        "lists",
        "failed" if lists_failed else "dry_run" if dry else "unchanged",
        failed_checks=["lists unreadable"] if lists_failed else [],
        source_hashes={
            f"list:{r.action}": r.content_hash
            for r in readings
            if getattr(r, "content_hash", None)
        },
        details=lists_failed
        + [f"{r.action}: {r.error}" for r in readings if getattr(r, "error", None)],
    )

    plan = getattr(report, "plan", None)
    totals = getattr(report, "totals", None)
    totals_failed = take("totals refresh")
    if totals_failed:
        record_stage(
            "totals",
            "failed",
            failed_checks=[c.name for c in getattr(totals, "blocked", None) or []]
            or ["totals refused"],
            details=totals_failed,
        )
    elif plan is None or not getattr(plan, "totals_due", False):
        record_stage("totals", "skipped")
    elif dry:
        record_stage("totals", "dry_run")
    else:
        published = getattr(report, "published_totals", None)
        if published is None:
            published = getattr(totals, "published", False)
        record_stage("totals", "published" if published else "unchanged")

    payments = getattr(report, "payments", None)
    outcomes = list(getattr(payments, "outcomes", None) or [])
    hashes = {}
    for outcome in outcomes:
        spec = getattr(outcome, "spec", None)
        fetched = getattr(outcome, "fetched", None)
        name = getattr(getattr(spec, "dataset", None), "value", None) or str(
            getattr(spec, "dataset", "file")
        )
        if getattr(fetched, "content_hash", None):
            hashes[str(name)] = fetched.content_hash
    blocked = [
        check for outcome in outcomes for check in getattr(outcome, "blocked", []) or []
    ]
    filer_years = [
        fy for check in blocked for fy in getattr(check, "filer_years", ()) or ()
    ]
    payments_failed = take("payments refresh")
    if payments_failed:
        record_stage(
            "payments",
            "failed",
            failed_checks=[check.name for check in blocked] or ["payments refused"],
            source_hashes=hashes,
            details=payments_failed,
            affected_years=[
                int(fy.split(":")[1])
                for fy in filer_years
                if fy.count(":") == 1 and fy.split(":")[1].isdigit()
            ],
            affected_committees=[fy.split(":")[0] for fy in filer_years],
        )
    elif dry:
        record_stage("payments", "dry_run", source_hashes=hashes)
    elif payments is not None:
        published = getattr(report, "published_payments", None)
        if published is None:
            published = getattr(payments, "published", False)
        record_stage(
            "payments", "published" if published else "unchanged", source_hashes=hashes
        )

    recheck_failed = take("re-check")
    if recheck_failed:
        record_stage(
            "rechecks",
            "failed",
            failed_checks=["re-check did not finish"],
            details=recheck_failed,
        )
    elif getattr(report, "recheck", None) is not None:
        record_stage("rechecks", "unchanged")

    clearing_failed = take("clearing saved pages") + take("clearing_pending")
    if clearing_failed:
        record_stage(
            "clearing saved pages",
            "failed",
            failed_checks=["clearing saved pages"],
            details=clearing_failed,
        )
    elif not dry:
        # Recorded when it did not fail, so an incident about it can see it finish.
        record_stage("clearing saved pages", "unchanged")

    rest = [line for index, line in enumerate(failures) if index not in claimed]
    if rest:
        record_stage(
            "refresh", "failed", failed_checks=["unrecognised failure"], details=rest
        )
    elif not dry:
        record_stage("refresh", "unchanged")
