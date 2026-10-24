#!/usr/bin/env python3
"""Private FCC evidence collection, local text reading, search, and recovery.

Default commands use the database on this machine. Production must be named with
``--target prod``. Collection traverses every political-folder type and year for
the configured stations. It creates no public website or approved money figures.

Examples::

    python scripts/fcc_political_files.py collect --target prod --dry-run
    python scripts/fcc_political_files.py collect --max-files 100 --workers 2
    python scripts/fcc_political_files.py extract --limit 25 --workers 2
    python scripts/fcc_political_files.py search 'Lisa Demuth' --year 2026
    python scripts/fcc_political_files.py status
    python scripts/fcc_political_files.py mirror --limit 200
    python scripts/fcc_political_files.py export <sha256> /private/path/source.pdf
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import uuid
from dataclasses import asdict
from pathlib import Path

from sqlalchemy import create_engine, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from alethical.db import models as models  # noqa: E402
from alethical.db.session import (  # noqa: E402
    NO_PREPARED_STATEMENTS,
    database_url_for_target,
)
from alethical.pipeline import fcc_archive as archive  # noqa: E402
from alethical.pipeline import fcc_expense_links as links  # noqa: E402
from alethical.pipeline import fcc_refresh  # noqa: E402
from alethical.pipeline.fcc_document_text import EXTRACTOR_VERSION  # noqa: E402
from alethical.pipeline.fcc_public_files import DEFAULT_STATIONS  # noqa: E402
from alethical.pipeline.raw_file_store import (  # noqa: E402
    mirror_file_store_from_env,
    raw_file_store_from_env,
)


class CLIError(ValueError):
    """A fixed operator-facing input message with no service response data."""


def emit(row: dict) -> None:
    print(json.dumps(row, default=str, ensure_ascii=False), flush=True)


def positive(value: str) -> int:
    parsed = int(value)
    if parsed < 1:
        raise argparse.ArgumentTypeError("Use a positive number")
    return parsed


def stations_for(value: str):
    """'all' means the configured 3 stations, never an unseen national scope."""
    if value.lower() in {"all", "default3"}:
        return DEFAULT_STATIONS
    aliases = {
        name.lower(): station
        for station in DEFAULT_STATIONS
        for name in (station.slug, station.call_sign)
    }
    selected = []
    for name in value.split(","):
        station = aliases.get(name.strip().lower())
        if station is None:
            raise CLIError("Unknown station; use kstp-tv, kare, or kmsp-tv")
        if station not in selected:
            selected.append(station)
    return tuple(selected)


def parser_for_commands() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=("dev", "prod"), default="dev")
    commands = parser.add_subparsers(dest="command", required=True)
    collect = commands.add_parser(
        "collect", help="Keep source listings and public files"
    )
    collect.add_argument(
        "--stations",
        default="all",
        help="all/default3 or comma-separated kstp-tv,kare,kmsp-tv; covers all years and political folders",
    )
    collect.add_argument("--workers", type=int, choices=range(1, 5), default=3)
    collect.add_argument("--max-files", type=positive)
    collect.add_argument(
        "--refresh-existing",
        action="store_true",
        help="Download existing files again, retaining changed versions",
    )
    collect.add_argument(
        "--dry-run",
        action="store_true",
        help="Describe full source scope and limits; no connections, downloads, or writes",
    )
    refresh = commands.add_parser(
        "refresh",
        help="Check all 3 stations, archive changes, copy and read bounded batches",
    )
    refresh.add_argument("--max-files", type=positive, default=1000)
    refresh.add_argument("--extract-limit", type=positive, default=1000)
    refresh.add_argument("--mirror-limit", type=positive, default=2500)
    refresh.add_argument("--workers", type=int, choices=range(1, 5), default=3)
    refresh.add_argument("--dry-run", action="store_true")
    refresh.add_argument(
        "--summary", type=Path, help="Save the sanitized run report as JSON"
    )
    extract = commands.add_parser(
        "extract", help="Read archived PDFs with local software"
    )
    extract.add_argument("--limit", type=positive, default=100)
    extract.add_argument("--workers", type=int, choices=range(1, 5), default=2)
    extract.add_argument(
        "--retry-failed",
        action="store_true",
        help="Retry saved incomplete readings without discarding earlier attempts",
    )
    search = commands.add_parser(
        "search", help="Find text with its source page and draft reading"
    )
    search.add_argument("query", nargs="?", default="")
    search.add_argument("--kind", help="Source document kind, such as invoice or order")
    search.add_argument("--field", help="Explicit source field to match exactly")
    search.add_argument("--value", help="Exact source value; requires --field")
    search.add_argument("--station", help="Known station slug or call sign")
    search.add_argument("--year", type=int)
    search.add_argument("--limit", type=positive, default=50)
    commands.add_parser("status", help="Show saved coverage and remaining gaps")
    gaps = commands.add_parser(
        "gaps", help="List source failures and missing or unreadable evidence"
    )
    gaps.add_argument("--limit", type=positive, default=100)
    mirror = commands.add_parser(
        "mirror", help="Keep a verified second copy in Cloudflare R2"
    )
    mirror.add_argument("--limit", type=positive, default=200)
    export = commands.add_parser(
        "export", help="Restore verified exact source bytes to a new local file"
    )
    export.add_argument("content_hash")
    export.add_argument("destination", type=Path)
    suggestions = commands.add_parser(
        "suggest-links", help="Find expense clues without accepting or saving a match"
    )
    suggestions.add_argument("content_hash")
    suggestions.add_argument("--version", default=EXTRACTOR_VERSION)
    suggestions.add_argument("--limit", type=positive, default=20)
    link = commands.add_parser(
        "link-expense", help="Keep a suggested expense link with copied source evidence"
    )
    link.add_argument("content_hash")
    link.add_argument("--version", default=EXTRACTOR_VERSION)
    link.add_argument(
        "--dataset", choices=("expenditures", "independent_expenditures"), required=True
    )
    link.add_argument("--snapshot", type=uuid.UUID, required=True)
    link.add_argument("--row", type=positive, required=True)
    link.add_argument("--evidence", required=True)
    review = commands.add_parser(
        "review-link",
        help="Record an explicit reviewer decision without adding financial totals",
    )
    review.add_argument("link_id", type=uuid.UUID)
    review.add_argument("--status", choices=("accepted", "rejected"), required=True)
    review.add_argument("--reviewer", required=True)
    review.add_argument("--evidence", required=True)
    listed_links = commands.add_parser(
        "links",
        help="Show retained expense links and whether their source is still current",
    )
    listed_links.add_argument("--content-hash")
    listed_links.add_argument("--limit", type=positive, default=100)
    # Both '--target prod collect' and 'collect --target prod' are explicit.
    for command in commands.choices.values():
        command.add_argument(
            "--target", choices=("dev", "prod"), default=argparse.SUPPRESS
        )
    return parser


def run(args: argparse.Namespace) -> int:
    selected = stations_for(args.stations) if args.command == "collect" else ()
    if args.command == "refresh":
        selected = DEFAULT_STATIONS
        if (
            args.max_files > 2000
            or args.extract_limit > 2000
            or args.mirror_limit > 5000
        ):
            raise CLIError(
                "Refresh permits up to 2000 downloads, 2000 readings and 5000 second copies"
            )
    station = None
    if args.command == "search":
        if (
            not args.query.strip() and not (args.field and args.value)
        ) or args.limit > 250:
            raise CLIError(
                "Search needs text or a field/value pair, and a limit from 1 to 250"
            )
        if bool(args.field) != bool(args.value):
            raise CLIError("Supply --field and --value together")
        if args.station:
            stations = stations_for(args.station)
            if len(stations) != 1:
                raise CLIError("Search accepts 1 station")
            station = stations[0].call_sign
    if args.command == "gaps" and args.limit > 1000:
        raise CLIError("Use a gap limit from 1 to 1000")
    if (
        args.command == "export"
        and re.fullmatch(r"[0-9a-f]{64}", args.content_hash) is None
    ):
        raise CLIError("Export needs a lowercase SHA-256 content hash")
    if args.command in {"collect", "refresh"} and args.dry_run:
        emit(
            {
                "command": args.command,
                "target": args.target,
                "status": "dry_run",
                "writes": 0,
                "network_requests": 0,
                "stations": [dict(asdict(s), root_url=s.root_url) for s in selected],
                "scope": "Every available year and every political folder, including federal, state, local, non-candidate, and terms/disclosures",
                "workers": args.workers,
                "max_files": args.max_files,
                "refresh_existing": getattr(args, "refresh_existing", False),
                "incremental": args.command == "refresh",
                "extract_limit": getattr(args, "extract_limit", None),
                "mirror_limit": getattr(args, "mirror_limit", None),
                "public_feature": False,
                "paid_ai": False,
            }
        )
        return 0
    target = "production" if args.target == "prod" else "local"
    database_url = database_url_for_target(target)
    if args.target == "dev" and (make_url(database_url).host or "").lower() not in {
        "localhost",
        "127.0.0.1",
        "::1",
        "db",
        "",
    }:
        raise CLIError(
            "Development target expects a local database; a remote database requires explicit --target prod"
        )
    engine = create_engine(
        database_url, connect_args=NO_PREPARED_STATEMENTS, pool_pre_ping=True
    )
    try:
        with Session(engine) as db:
            if args.command == "refresh":
                result = fcc_refresh.refresh(
                    db,
                    raw_file_store_from_env(),
                    mirror_file_store_from_env(),
                    max_files=args.max_files,
                    extract_limit=args.extract_limit,
                    mirror_limit=args.mirror_limit,
                    workers=args.workers,
                    log=emit,
                )
                emit({"command": "refresh", "target": args.target, **result})
                if args.summary:
                    args.summary.write_text(
                        json.dumps(result, indent=2, default=str) + "\n"
                    )
                return 1 if result["needs_attention"] else 0
            if args.command == "collect":
                result = archive.collect(
                    db,
                    raw_file_store_from_env(),
                    stations=selected,
                    workers=args.workers,
                    max_files=args.max_files,
                    refresh_existing=args.refresh_existing,
                    log=emit,
                )
                emit({"command": "collect", "target": args.target, **result})
                return 0 if result["status"] == "complete" else 1
            if args.command == "extract":
                result = archive.extract_pending(
                    db,
                    raw_file_store_from_env(),
                    limit=args.limit,
                    workers=args.workers,
                    retry_failed=args.retry_failed,
                    log=emit,
                )
                emit({"command": "extract", "target": args.target, "counts": result})
                # Partial/unreadable documents are retained gaps, not completed reads.
                return (
                    1
                    if any(
                        total
                        for state, total in result.items()
                        if state not in {"pending_review", "already_read"}
                    )
                    else 0
                )
            if args.command == "search":
                result = archive.search(
                    db,
                    args.query,
                    station=station,
                    year=args.year,
                    kind=args.kind,
                    field=args.field,
                    value=args.value,
                    limit=args.limit,
                )
                emit({"command": "search", "target": args.target, "results": result})
            elif args.command == "status":
                emit({"command": "status", "target": args.target, **archive.status(db)})
            elif args.command == "suggest-links":
                emit(
                    {
                        "command": args.command,
                        **links.suggest_links(
                            db,
                            args.content_hash,
                            args.limit,
                            extraction_version=args.version,
                        ),
                    }
                )
            elif args.command == "link-expense":
                link = links.write_link(
                    db,
                    args.content_hash,
                    args.version,
                    args.dataset,
                    args.snapshot,
                    args.row,
                    args.evidence,
                )
                db.commit()
                emit(
                    {
                        "command": args.command,
                        "link_id": str(link.id),
                        "status": link.status,
                        **links.link_state(db, link),
                    }
                )
            elif args.command == "review-link":
                link = links.review_link(
                    db, args.link_id, args.status, args.reviewer, args.evidence
                )
                db.commit()
                emit(
                    {
                        "command": args.command,
                        "link_id": str(link.id),
                        "status": link.status,
                        **links.link_state(db, link),
                    }
                )
            elif args.command == "links":
                if args.limit > 1000:
                    raise CLIError("Use a link limit from 1 to 1000")
                stmt = (
                    select(models.FCCExpenseLink)
                    .order_by(models.FCCExpenseLink.created_at.desc())
                    .limit(args.limit)
                )
                if args.content_hash:
                    stmt = stmt.where(
                        models.FCCExpenseLink.content_hash == args.content_hash
                    )
                emit(
                    {
                        "command": args.command,
                        "links": [
                            dict(
                                id=str(link.id),
                                content_hash=link.content_hash,
                                extraction_version=link.extraction_version,
                                source_dataset=link.source_dataset,
                                source_snapshot_id=str(link.source_snapshot_id),
                                source_content_hash=link.source_content_hash,
                                source_row_number=link.source_row_number,
                                source_row=link.source_row,
                                status=link.status,
                                evidence=link.evidence,
                                reviewed_by=link.reviewed_by,
                                **links.link_state(db, link),
                            )
                            for link in db.scalars(stmt)
                        ],
                    }
                )
            elif args.command == "gaps":
                emit(
                    {
                        "command": "gaps",
                        "target": args.target,
                        **archive.gaps(db, limit=args.limit),
                    }
                )
            elif args.command == "mirror":
                result = archive.mirror_bodies(
                    db,
                    raw_file_store_from_env(),
                    mirror_file_store_from_env(),
                    limit=args.limit,
                )
                emit({"command": "mirror", "target": args.target, "counts": result})
                return 1 if result.get("failed", 0) else 0
            elif args.command == "export":
                row = db.get(models.FCCSourceBody, args.content_hash)
                if row is None:
                    raise CLIError(
                        "The requested source hash is absent from this archive"
                    )
                body = archive.read_body(raw_file_store_from_env(), row)
                destination = args.destination.expanduser().absolute()
                # The whole body is verified before creating the destination. Exclusive
                # creation preserves existing files, including symlinks, and stays private.
                fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                try:
                    with os.fdopen(fd, "wb") as handle:
                        handle.write(body)
                except BaseException:
                    destination.unlink(missing_ok=True)
                    raise
                emit(
                    {
                        "command": "export",
                        "target": args.target,
                        "content_hash": args.content_hash,
                        "byte_size": len(body),
                        "destination": str(destination),
                    }
                )
    finally:
        engine.dispose()
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = parser_for_commands()
    args = parser.parse_args(argv)
    try:
        return run(args)
    except CLIError as error:
        # Only our input checks are shown. Connection and service exceptions below
        # are never printed because they can carry credentials or signed URLs.
        emit(
            {
                "command": args.command,
                "target": args.target,
                "status": "failed",
                "error": str(error),
            }
        )
        return 1
    except Exception as error:
        emit(
            {
                "command": args.command,
                "target": args.target,
                "status": "failed",
                "error": type(error).__name__,
                "next": "Check the selected database, source availability, and private storage settings",
            }
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
