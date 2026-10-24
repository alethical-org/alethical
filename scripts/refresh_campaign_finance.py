"""Refresh Alethical's campaign-money records from the Board, once, start to finish.

Net: this is the command the daily GitHub Actions job runs, and the same one a person
runs by hand. It reads the Board's 6 small lists, refreshes the official totals for
every supported year when a list changed or a week has passed, downloads the 3 payment
files, publishes whatever passes every check, re-checks the published figures against
the filed reports, and clears the saved pages. Every publication route takes the same
run-wide lease first (a row in ``cf_refresh_state``, 4-hour expiry), so 2 starts at the
same minute produce 1 run, and a run whose lease is taken by another before it publishes
does not publish ([#2344](https://github.com/alethical-org/alethical/issues/2344), D3).

Exit codes: 0 when every step finished (including a no-op day); 1 when anything was
quarantined, refused, could not be read, could not re-check, or could not clear, with
the reasons printed. The printed summary says which payments release and which totals
snapshot are live at the end and whether this run published each. With
``--alert-issue`` a failed run also opens or updates one GitHub issue quoting that
summary, through the ``gh`` command already signed in; the workflow passes the flag and a
laptop run does not. Nothing here ever publishes over a failed check: a quarantine
leaves the previous set live and keeps the bytes.

A dry run writes nothing: not to the database (so it takes no lease), not to the file
store, and not to GitHub (no issue, whatever flags are set).

``--clear-pending-only`` retries known pending saved-page clearing under the same
lease without collecting, publishing or rechecking records. A busy lease or missing
clearing access fails this mode; unfinished and unknown events remain pending.

Freshness, stated honestly: payments are checked daily; totals are refreshed when a list
changes and weekly; a run whose lists could not be read is reported as incomplete.

Usage:

    PYTHONPATH=. uv run python scripts/refresh_campaign_finance.py --target production
    PYTHONPATH=. uv run python scripts/refresh_campaign_finance.py --dry-run
    PYTHONPATH=. uv run python scripts/refresh_campaign_finance.py --force-totals
    PYTHONPATH=. uv run python scripts/refresh_campaign_finance.py --clear-pending-only
    PYTHONPATH=. uv run python scripts/refresh_campaign_finance.py --alert-issue --prove-alerting
"""

from __future__ import annotations

import argparse
import os
import sys
from contextlib import nullcontext
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from alethical.db.session import (  # noqa: E402
    NO_PREPARED_STATEMENTS,
    database_url_for_target,
    normalize_database_url,
)
from alethical.pipeline.campaign_finance_refresh import (  # noqa: E402
    file_refresh_alert,
    github_run_url,
    hold_full_run_lease,
    refresh_campaign_money,
    retry_pending_campaign_clearing,
)
from alethical.pipeline.collection_run_summary import (  # noqa: E402
    record_refresh_report,
    record_stage,
    run_script,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--target",
        default=os.environ.get("ALETHICAL_DATABASE_TARGET") or "local",
        choices=("local", "production"),
    )
    parser.add_argument("--database-url", default=None)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Read the lists, print the plan, run the payment checks, write nothing: "
        "no lease, no database or file-store write, no GitHub issue.",
    )
    parser.add_argument(
        "--clear-pending-only",
        action="store_true",
        help="Retry only pending saved-page clearing, without source collection, "
        "publication or money checks. Missing access or a busy lease fails this mode.",
    )
    parser.add_argument(
        "--force-totals",
        action="store_true",
        help="Run the full totals refresh today whether or not a list changed.",
    )
    parser.add_argument(
        "--alert-issue",
        action="store_true",
        help="When the run does not finish, open or update the GitHub issue titled "
        "'The daily campaign-money refresh did not finish' with the printed summary, "
        "through the signed-in gh command. The workflow passes this; a laptop run "
        "leaves it off. Never files on a dry run.",
    )
    parser.add_argument(
        "--prove-alerting",
        action="store_true",
        help="Take the lease, then exit 1 on purpose without reading or publishing "
        "anything, so the alert issue (with --alert-issue) can be proven once "
        "without a real failure.",
    )
    args = parser.parse_args()
    if args.clear_pending_only and (args.force_totals or args.prove_alerting):
        parser.error(
            "--clear-pending-only cannot be combined with --force-totals or --prove-alerting"
        )

    def log(message: str) -> None:
        print(message, file=sys.stderr, flush=True)

    database_url = normalize_database_url(
        args.database_url or database_url_for_target(args.target)
    )
    engine = create_engine(
        database_url, echo=False, connect_args=NO_PREPARED_STATEMENTS
    )
    run_url = github_run_url()

    # A dry run takes no lease: the lease is a row written to the database, and a dry
    # run writes nothing. It publishes nothing either, so it cannot collide with a run
    # that is under way.
    lease_scope = (
        nullcontext(None)
        if args.dry_run
        else hold_full_run_lease(
            engine,
            purpose=(
                "retrying pending campaign-money saved-page clearing"
                if args.clear_pending_only
                else "the daily campaign-money refresh"
            ),
        )
    )
    with lease_scope as lease:
        if lease is not None and not lease.held:
            if args.clear_pending_only:
                message = "another campaign-money run holds the lease; saved-page clearing is still pending"
                log(message)
                record_stage("clearing saved pages", "failed", details=[message])
                return 1
            log(
                "another campaign-money refresh holds the run-wide lease, so this one "
                "does nothing; the running one covers today"
            )
            record_stage(
                "refresh", "skipped", details=["another refresh held the lease"]
            )
            return 76 if os.environ.get("ALETHICAL_REFRESH_JOB_NAME") else 0
        if args.prove_alerting:
            summary = (
                "PROVING ALERTING: this run exited 1 on purpose after taking the "
                "run-wide lease; nothing was read or published, and whatever was live "
                "before it is live now."
            )
            log(summary)
            if args.alert_issue:
                file_refresh_alert(summary, run_url, dry_run=args.dry_run)
            record_stage("drill", "failed", drill=True, details=[summary])
            return 1
        with Session(engine) as session:
            if args.clear_pending_only:
                report = retry_pending_campaign_clearing(
                    session, dry_run=args.dry_run, lease=lease, log=log
                )
            else:
                report = refresh_campaign_money(
                    session,
                    dry_run=args.dry_run,
                    force_totals=args.force_totals,
                    lease=lease,
                    log=log,
                )
    summary = report.summary()
    print(summary, flush=True)
    if not report.ok and args.alert_issue:
        file_refresh_alert(summary, run_url, dry_run=args.dry_run)
    # What each stage did, for .github/workflows/collection-failure-review.yml (#2350).
    if args.clear_pending_only:
        for stage in ("lists", "totals", "payments", "rechecks"):
            record_stage(stage, "skipped", details=["saved-page clearing only"])
        record_stage(
            "clearing saved pages",
            "failed" if not report.ok else "dry_run" if args.dry_run else "unchanged",
            details=report.failures + report.lines,
        )
    else:
        record_refresh_report(report)
    return 0 if report.ok else 1


if __name__ == "__main__":
    raise SystemExit(run_script("refresh", main))
