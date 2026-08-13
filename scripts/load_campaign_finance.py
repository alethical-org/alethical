#!/usr/bin/env python3
"""Load Minnesota's 3 campaign-finance downloads as one dated, replaceable set (#1328).

Net: this fetches the Board's 3 "All" files, keeps each download's exact bytes,
checks the new set against the one already published, and publishes it by replacing
the previous set entirely. Running it twice on unchanged files changes nothing.

    # what would happen, writing nothing to the database or the file store
    uv run python scripts/load_campaign_finance.py --dry-run

    # the real thing, locally
    uv run python scripts/load_campaign_finance.py --target local

    # the real thing, against production
    uv run python scripts/load_campaign_finance.py --target production

**A set that fails its checks is quarantined, not published**, and the command
exits non-zero. Its bytes are kept either way, so the download can be examined.
That includes the very first import, which has nothing to compare against: read
the measurements it printed, then publish it by naming the exact 3 record hashes
you reviewed. They are the "records" lines in its output, in full.

    uv run python scripts/load_campaign_finance.py --target local \\
        --publish-hashes <contributions> <expenditures> <independent>

Those are hashes of the **records**, not of the downloaded bytes, and that matters
in practice: the Board's export shuffles its rows, so the same data arrives with a
different byte hash every single time, while the record hash stays the same for as
long as the data does. A byte hash read off one run would already be gone by the
next one.

Naming hashes waives only the **comparison** checks — row count, byte size, total,
repeat share, per-year rows, new blanks. It never waives a structural one: a header
that does not match the pinned contract, a record with the wrong number of fields, a
date that is not a date, or an amount that would have to be rounded stop the run
whatever you pass.

Which database, and what it needs: ``--target production`` needs
``SUPABASE_PROJECT_URL`` and ``SUPABASE_DB_PASSWORD``, and a real (non-dry) run of
either target needs the 4 ``SUPABASE_STORAGE_S3_*`` credentials, because the
downloaded bytes are kept in a private Supabase Storage bucket. All of them live in
the gitignored ``.env`` at the repository root. A dry run needs neither.

Design: ``docs/architecture/campaign-finance-system-design.md`` §4 (Ingestion:
snapshot and replace). Plain-English walkthrough:
``docs/product-onboarding/data-ingestion-onboarding.md`` § "H — Campaign finance".

**Every run also re-checks every person-confirmed legislator-committee link (#1354)
against this run's own data** — see ``verify_confirmed_committee_links`` in
``alethical/pipeline/campaign_finance.py`` (#1398). A contradiction never blocks
publication and is never repaired automatically; it is printed loudly in the summary
below and, on a real (non-dry) run, filed or updated as a GitHub issue via ``gh`` —
the same alerting idiom ``.github/workflows/mirror-raw-files.yml`` uses, reusing
whatever ``gh`` login already runs this command by hand, since this load carries no
schedule of its own to attach a token to.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from alethical.db.session import (  # noqa: E402
    NO_PREPARED_STATEMENTS,
    database_url_for_target,
    normalize_database_url,
)
from alethical.pipeline.campaign_finance import (  # noqa: E402
    CampaignFinanceRefusal,
    load_campaign_finance,
)

COMMITTEE_LINK_ALERT_TITLE = (
    "Confirmed legislator-committee link(s) now contradict the Board's own data"
)


def _file_committee_link_alert(contradictions: list[str]) -> None:
    """Make a stale confirmed link (#1354) reach a person, the way the sibling
    ingestion jobs already do.

    Searches for an already-open issue by title and comments on it; files a new one
    otherwise — the same idiom ``.github/workflows/mirror-raw-files.yml`` uses, so a
    contradiction that persists across several loads is one issue growing a comment
    thread rather than several duplicates. Uses the ``gh`` CLI already authenticated on
    whatever machine runs this load, because this load has no schedule of its own to
    carry a ``GITHUB_TOKEN`` on.

    Never raises. A contradiction not reaching GitHub must not be read as this load
    having failed — the report already printed it loudly above, and this is a second,
    more durable channel on top of that, not the only one.
    """
    if shutil.which("gh") is None:
        print(
            "note: 'gh' is not installed here, so no GitHub issue was filed for the "
            "committee-link contradiction(s) printed above. Install it "
            "(https://cli.github.com) or file one by hand.",
            file=sys.stderr,
        )
        return
    report_block = "\n".join(contradictions)
    try:
        existing = subprocess.run(
            [
                "gh",
                "issue",
                "list",
                "--state",
                "open",
                "--search",
                f"{COMMITTEE_LINK_ALERT_TITLE} in:title",
                "--json",
                "number",
                "--jq",
                ".[0].number // empty",
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if existing.returncode != 0:
            print(
                "note: could not check for an existing GitHub alert issue "
                f"(gh issue list exited {existing.returncode}): "
                f"{existing.stderr.strip()}",
                file=sys.stderr,
            )
            return
        number = existing.stdout.strip()
        if number:
            commented = subprocess.run(
                [
                    "gh",
                    "issue",
                    "comment",
                    number,
                    "--body",
                    f"Still contradicting as of this run:\n\n```\n{report_block}\n```",
                ],
                capture_output=True,
                text=True,
                timeout=30,
            )
            if commented.returncode != 0:
                print(
                    f"note: could not comment on alert issue #{number} "
                    f"(gh issue comment exited {commented.returncode}): "
                    f"{commented.stderr.strip()}",
                    file=sys.stderr,
                )
                return
            print(f"note: commented on existing alert issue #{number}", file=sys.stderr)
            return
        body = (
            "**Net:** A campaign-finance load just re-checked every person-confirmed "
            "legislator-to-committee link against Minnesota's own records, and "
            f"{len(contradictions)} no longer agree. Until a person looks again, money "
            "may be rendering on the wrong legislator's page.\n\n"
            f"```\n{report_block}\n```\n\n"
            "Each line is the legislator, the committee, what changed, and who "
            "confirmed the link originally. A rename or a closed committee is a "
            "legitimate event and not necessarily a mistake — re-check it with:\n\n"
            "```\nPYTHONPATH=. uv run python "
            "scripts/review_legislator_campaign_committees.py review "
            '--contributions /path/to/contributions.csv --reviewer "Your Name"\n```\n\n'
            "Background: `docs/architecture/campaign-finance-system-design.md` §5.1. "
            "Auto-filed by `scripts/load_campaign_finance.py` (#1398)."
        )
        created = subprocess.run(
            [
                "gh",
                "issue",
                "create",
                "--title",
                f"🚨 {COMMITTEE_LINK_ALERT_TITLE}",
                "--label",
                "backend",
                "--body",
                body,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if created.returncode != 0:
            print(
                "note: could not file a new GitHub alert issue "
                f"(gh issue create exited {created.returncode}): "
                f"{created.stderr.strip()}",
                file=sys.stderr,
            )
            return
        print(
            f"note: filed a new alert issue: {created.stdout.strip()}", file=sys.stderr
        )
    except (subprocess.SubprocessError, OSError) as error:
        print(
            f"note: could not file/update the GitHub alert issue: {error}",
            file=sys.stderr,
        )


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Fetch Minnesota's 3 campaign-finance downloads, check them, and publish "
            "them as one dated set that replaces the previous one."
        )
    )
    parser.add_argument(
        "--target",
        default=os.environ.get("ALETHICAL_DATABASE_TARGET") or "local",
        choices=("local", "production"),
        help="Which database the set is published to. Default local.",
    )
    parser.add_argument("--database-url", default=None)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch, parse and run every check, then report and write nothing — not "
        "to the database and not to the file store. Needs no storage credentials.",
    )
    parser.add_argument(
        "--publish-hashes",
        nargs="+",
        default=None,
        metavar="SHA256",
        help="Publish a set the comparison checks quarantined, by naming all 3 of its "
        "record hashes (the 'records' lines this command prints, in full). This is "
        "the intended path for a first import. Structural checks are never waived.",
    )
    args = parser.parse_args()

    if args.publish_hashes is not None and len(args.publish_hashes) != 3:
        parser.error(
            "--publish-hashes takes all 3 record hashes, one per file, so a set "
            f"cannot be waved through by accident. Got {len(args.publish_hashes)}."
        )

    database_url = normalize_database_url(
        args.database_url or database_url_for_target(args.target)
    )
    engine = create_engine(
        database_url, echo=False, connect_args=NO_PREPARED_STATEMENTS
    )
    with Session(engine) as session:
        try:
            report = load_campaign_finance(
                session,
                dry_run=args.dry_run,
                publish_hashes=args.publish_hashes,
                log=lambda message: print(message, file=sys.stderr),
            )
        except CampaignFinanceRefusal as refusal:
            print(f"refused: {refusal}", file=sys.stderr)
            return 1

    print(report.summary())
    # Never on --dry-run: a dry run's whole point is to write nothing, and filing a
    # real GitHub issue is a write. A real run files or updates one regardless of
    # whether the money data itself published, was unchanged, or was quarantined —
    # a stale committee link is a separate question from whether this run's
    # payment rows are correct (#1398).
    if report.committee_link_contradictions and not args.dry_run:
        _file_committee_link_alert(report.committee_link_contradictions)
    if report.refusal:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
