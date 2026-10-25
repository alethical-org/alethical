"""Check a bounded set of exact committee-years, then release the money writer lease.

Publication and checks use the same lease. A turn never scans new source files and
never claims whole-file completion from its partial verdicts. A stopped turn replays
its last item safely: verdicts replace the same source-keyed row before cursor commit.
"""

from __future__ import annotations

import hashlib
import json
import signal
import time
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from typing import Any, Callable

from sqlalchemy import text
from sqlalchemy.orm import Session

from alethical.pipeline import campaign_finance_reader as reader
from alethical.pipeline import campaign_finance_refresh as refresh
from alethical.pipeline import campaign_finance_stated_spending as spending
from alethical.pipeline import campaign_finance_stated_split as split
from alethical.pipeline.campaign_finance_check_identity import (
    reader_identity,
    stage_reader_identity,
)
from alethical.pipeline.campaign_finance_recheck import recheck_years
from alethical.pipeline.campaign_finance_report_document_store import (
    DocumentKeeper,
    DocumentLibrary,
)
from alethical.pipeline.raw_file_store import raw_file_store_from_env
from alethical.pipeline.cache_purge import (
    clear_after_publish,
    when_the_money_checks_finish,
)


class BatchBudgetExhausted(BaseException):
    """An unfinished target is left for the next bounded turn."""


def work_owed(db: Session) -> bool:
    """Whether a bounded turn has anything it can do now.

    Owed page clearing, or an owed check on a file paired with the live totals. A
    held file waiting for a complete accepted source read is not checkable, so it
    alone owes no turn; its obligation stays recorded either way.
    """
    if refresh.state_get(db, refresh.CLEARING_PENDING_KEY):
        return True
    marker = refresh.state_get(db, refresh.RECHECK_PENDING_KEY)
    if not marker:
        return False
    live = refresh.live_versions(db)
    if not refresh.recheck_still_owed(marker, live):
        return True  # the turn removes the rolled-back obligation
    slots = (
        refresh.owed_payment_files(marker, live)
        if "pending_files" in marker
        else {"contributions": {}, "expenditures": {}}
    )
    if not slots:
        return True  # the turn removes the finished obligation
    release = reader.live_release(db)
    return any(
        str(release.paired_filings(reader.Dataset(name)) or "")
        == live.filings_snapshot_id
        for name in slots
    )


@dataclass
class BatchReport:
    dataset: str | None = None
    checked: int = 0
    total: int = 0
    completed: int = 0
    requests: int = 0
    unfinished: bool = False
    failures: list[str] = field(default_factory=list)
    lines: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.failures

    def summary(self) -> str:
        return "\n".join(
            [
                f"money checks: {self.dataset or 'no file owed'}; {self.checked} committee-years this turn; "
                f"{self.completed}/{self.total} committed for these exact inputs; {self.requests} source requests",
                *self.lines,
                *self.failures,
            ]
        )


class BudgetSession:
    """Cap every document request, including retries, before it reaches the source."""

    def __init__(self, session, deadline: float, maximum: int):
        self.session, self.deadline, self.maximum = session, deadline, maximum
        self.requests = 0

    def post(self, url, **kwargs):
        remaining = self.deadline - time.monotonic()
        if self.requests >= self.maximum or remaining <= 0:
            raise BatchBudgetExhausted("source request or elapsed-time budget reached")
        self.requests += 1
        kwargs["timeout"] = min(float(kwargs.get("timeout", remaining)), remaining)
        return self.session.post(url, **kwargs)


@contextmanager
def elapsed_budget(seconds: float):
    """Interrupt a slow request, parser or commit; replay keeps the same source key."""
    previous = signal.getsignal(signal.SIGALRM)
    timer = signal.getitimer(signal.ITIMER_REAL)

    def expired(signum, frame):
        raise BatchBudgetExhausted("elapsed-time budget reached")

    signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, *timer)
        signal.signal(signal.SIGALRM, previous)


def inputs_still_current(db: Session, dataset: str, snapshot_id, totals_id) -> bool:
    column = {
        "contributions": "contributions_snapshot_id",
        "expenditures": "expenditures_snapshot_id",
    }[dataset]
    return bool(
        db.scalar(
            text(
                f"SELECT r.{column} = :snapshot AND f.snapshot_id = :totals "
                "FROM cf_current_release p JOIN cf_release r ON r.id = p.release_id "
                "CROSS JOIN cf_filing_current f WHERE p.id IS TRUE AND f.id IS TRUE"
            ),
            {"snapshot": snapshot_id, "totals": totals_id},
        )
    )


def run_recheck_batch(
    db: Session,
    *,
    lease,
    limit: int = 10,
    max_seconds: float = 120,
    max_requests: int = 10,
    store_factory=raw_file_store_from_env,
    http_factory: Callable[[], Any] | None = None,
    clear=clear_after_publish,
    fingerprint: Callable[[], str] = reader_identity,
    log=print,
) -> BatchReport:
    """Resume one file's exact ordered population while holding the shared lease."""
    if limit < 1 or max_seconds <= 0 or max_requests < 0:
        raise ValueError(
            "a batch needs a positive item/time limit and nonnegative request limit"
        )
    if lease is None or not lease.held or lease.refusal():
        raise RuntimeError("a bounded check needs the current money writer lease")
    report = BatchReport()
    proof = fingerprint()
    stage_reader_identity(db, proof, record_verdict=False)
    db.commit()
    retry = refresh.RefreshReport(started_at=datetime.now(UTC), dry_run=False)
    refresh._retry_pending_clearing(db, retry, clear=clear, log=log)
    report.failures.extend(retry.failures)
    marker = refresh.state_get(db, refresh.RECHECK_PENDING_KEY)
    if not marker:
        return report
    live = refresh.live_versions(db)
    if not refresh.recheck_still_owed(marker, live):
        refresh.state_delete(db, refresh.RECHECK_PENDING_KEY)
        report.lines.append(
            "the pending inputs were rolled back; their obligation was removed"
        )
        return report
    slots = (
        refresh.owed_payment_files(marker, live)
        if "pending_files" in marker
        else {
            name: live.payment_files.get(name, {})
            for name in ("contributions", "expenditures")
        }
    )
    marker = {**marker, **live.as_marker(), "pending_files": slots}
    # A waiting mismatched slot cannot starve a sibling that can be checked now.
    names = sorted(
        slots,
        key=lambda name: (
            slots[name].get("filing_snapshot_id") != live.filings_snapshot_id,
            name,
        ),
    )
    if not names:
        refresh.state_delete(db, refresh.RECHECK_PENDING_KEY)
        return report
    dataset = names[0]
    report.dataset = dataset
    report.unfinished = True
    release = reader.live_release(db)
    source = release.file_for(reader.Dataset(dataset))
    if (
        release.paired_filings(reader.Dataset(dataset)) is None
        or str(release.paired_filings(reader.Dataset(dataset)))
        != live.filings_snapshot_id
    ):
        refresh.state_set(db, refresh.RECHECK_PENDING_KEY, marker)
        report.failures.append(
            f"{dataset} remains pending: its accepted file is not paired with the current totals; no documents were requested"
        )
        return report
    totals_id = refresh.live_filings_snapshot(db).id
    module = split if dataset == "contributions" else spending
    years = recheck_years()
    population = sorted(
        module.targets(db, release, totals_id, years),
        key=lambda target: (target.registration_number, target.filing_year),
    )
    report.total = len(population)
    if not population:
        report.failures.append(
            "no complete target population was established; checks remain pending"
        )
        return report
    identity = {
        "snapshot_id": str(source.snapshot_id),
        "filings_snapshot_id": str(totals_id),
        "paired_filings_snapshot_id": str(source.filing_snapshot_id)
        if source.filing_snapshot_id
        else None,
        "reader_identity": proof,
        "population_hash": hashlib.sha256(
            json.dumps(
                [asdict(item) for item in population], sort_keys=True, default=str
            ).encode()
        ).hexdigest(),
        "years": list(years),
    }
    key = f"money_recheck_progress:{dataset}"
    saved = refresh.state_get(db, key) or {}
    cursor = int(saved.get("completed", 0)) if saved.get("identity") == identity else 0
    if cursor < 0 or cursor > len(population):
        raise RuntimeError("saved check progress is outside its exact population")
    stage_reader_identity(db, proof, record_verdict=False)
    refresh._stage_state_update(
        db,
        set_values={
            refresh.RECHECK_PENDING_KEY: marker,
            key: {"identity": identity, "completed": cursor, "total": len(population)},
        },
    )
    db.commit()
    report.completed = cursor
    http = None
    budget = None
    try:
        with elapsed_budget(max_seconds):
            store = store_factory()
            import tempfile

            with tempfile.TemporaryDirectory(prefix="cf-check-batch-") as directory:
                library = DocumentLibrary(db=db, store=store, directory=directory)
                keeper = DocumentKeeper(db=db, store=store, directory=directory)
                if dataset == "contributions":
                    if http_factory is None:
                        from alethical.pipeline.request_limits import (
                            DatabaseRequestLimiter,
                            RateLimitedSession,
                        )

                        http = RateLimitedSession(
                            split.http_session(), DatabaseRequestLimiter(db.get_bind())
                        )
                    else:
                        http = http_factory()
                budget = BudgetSession(
                    http, time.monotonic() + max_seconds, max_requests
                )
                for target in population[cursor : cursor + limit]:
                    if lease.refusal():
                        raise RuntimeError(
                            "the money writer lease was lost during this batch"
                        )
                    prior_keep_failures = len(keeper.report.failures)
                    if dataset == "contributions":
                        verdict, _ = split.check_one(
                            db,
                            budget,
                            release,
                            totals_id,
                            target,
                            keeper=keeper,
                            library=library,
                        )
                    else:
                        verdict, _ = spending.check_one(
                            db, library, release, totals_id, target
                        )
                    if not inputs_still_current(
                        db, dataset, source.snapshot_id, totals_id
                    ):
                        raise RuntimeError(
                            "source inputs changed during the check; the old cursor cannot complete the replacement"
                        )
                    # These idempotent writes commit first. A stop before cursor
                    # commit repeats this one item, never skips an uncommitted one.
                    module.store_verdicts(db, source.snapshot_id, totals_id, [verdict])
                    if len(keeper.report.failures) > prior_keep_failures:
                        report.checked += 1
                        raise RuntimeError(
                            "the valid comparison was saved but its source document could not be kept; this item remains pending"
                        )
                    cursor += 1
                    report.checked += 1
                    report.completed = cursor
                    refresh.state_set(
                        db,
                        key,
                        {
                            "identity": identity,
                            "completed": cursor,
                            "total": len(population),
                        },
                    )
                report.requests = budget.requests
    except BatchBudgetExhausted as error:
        db.rollback()
        report.lines.append(str(error) + "; remaining targets resume next turn")
    except Exception as error:
        db.rollback()
        report.failures.append(f"{dataset} checks remain pending: {error}")
    finally:
        if budget is not None:
            report.requests = budget.requests
        if http is not None:
            http.close()
    if cursor == len(population) and not report.failures:
        latest = db.scalar(
            text("SELECT value FROM cf_refresh_state WHERE key = :key FOR UPDATE"),
            {"key": refresh.RECHECK_PENDING_KEY},
        )
        if latest is None or not inputs_still_current(
            db, dataset, source.snapshot_id, totals_id
        ):
            db.rollback()
            report.failures.append(
                "the source obligation changed before completion; it remains pending"
            )
            return report
        marker = latest
        slots = dict(latest.get("pending_files") or {})
        # Re-read the durable cursor: a deadline during commit cannot manufacture
        # completion, and a lost lease cannot complete somebody else's generation.
        saved = refresh.state_get(db, key) or {}
        if (
            saved.get("identity") == identity
            and saved.get("completed") == len(population)
            and not lease.refusal()
        ):
            slots.pop(dataset, None)
            refresh.state_update(
                db,
                set_values={
                    refresh.RECHECK_PENDING_KEY: {**marker, "pending_files": slots}
                }
                if slots
                else {},
                delete_keys=[key] + ([] if slots else [refresh.RECHECK_PENDING_KEY]),
            )
            report.unfinished = bool(slots)
            report.lines.append(
                f"{dataset}: every target finished for the exact file, totals and reader"
            )
    if report.checked:
        # Persist before the external clear. A crash here still owes cache recovery.
        refresh._clear_and_mark(
            db, retry, when_the_money_checks_finish(), clear=clear, log=log
        )
        report.failures.extend(retry.failures)
    return report
