#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import re
import subprocess
import tempfile
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import requests
from sqlalchemy import create_engine, delete, func, select
from sqlalchemy.orm import Session

from alethical.db import models as schema
from alethical.db.session import (
    NO_PREPARED_STATEMENTS,
    get_database_url,
    normalize_database_url,
)
from alethical.db.session import supabase_database_url as _supabase_database_url


Bill = schema.Bill
BillAction = schema.BillAction
BillStats = schema.BillStats
Chamber = schema.Chamber
Legislator = schema.Legislator
LegislatorServicePeriod = schema.LegislatorServicePeriod
VoteEvent = schema.VoteEvent
VoteRecord = schema.VoteRecord
VoteValue = schema.VoteValue

TIMEOUT_SECONDS = 30
USER_AGENT = "Alethical Vote Backfill/0.1"


@dataclass(frozen=True)
class ParsedVote:
    motion_text: str | None
    occurred_at: datetime | None
    journal_page: str | None
    yes_count: int
    no_count: int
    affirmative_names: list[str]
    negative_names: list[str]
    official_url: str


@dataclass(frozen=True)
class BackfillStats:
    actions_seen: int = 0
    events_created: int = 0
    records_created: int = 0
    no_source_match: int = 0
    ambiguous_or_missing_names: int = 0
    write_errors: int = 0


def supabase_database_url() -> str | None:
    return _supabase_database_url()


def parse_roll_call(value: str | None) -> tuple[int, int] | None:
    if not value:
        return None
    match = re.fullmatch(r"\s*(\d+)\s*-\s*(\d+)\s*", value)
    if not match:
        return None
    return int(match.group(1)), int(match.group(2))


def normalize_space(value: str) -> str:
    value = value.replace("\u200b", "").replace("\ufeff", "")
    return re.sub(r"\s+", " ", value.replace("\xa0", " ")).strip()


def strip_tags(value: str) -> str:
    return normalize_space(re.sub(r"<[^>]+>", " ", value))


def parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(value.strip(), fmt).replace(tzinfo=UTC)
        except ValueError:
            pass
    return None


def house_bill_number(file_type: str, file_number: int) -> str:
    return f"{file_type.upper()}{file_number:04d}"


def compact_bill_number(value: str) -> str:
    cleaned = value.replace(".", " ")
    match = re.search(r"\b([HS])\s*F(?:\s*NO\s*)?\.?\s*0*(\d+)\b", cleaned, flags=re.I)
    if not match:
        return re.sub(r"\s+", "", value).upper()
    return f"{match.group(1).upper()}F{int(match.group(2))}"


def extract_td_names(table_html: str) -> list[str]:
    names = [
        strip_tags(item)
        for item in re.findall(r"<td[^>]*>(.*?)<td", table_html, flags=re.I | re.S)
    ]
    if not names:
        names = [
            strip_tags(item)
            for item in re.findall(
                r"<td[^>]*>(.*?)</td>", table_html, flags=re.I | re.S
            )
        ]
    return [name for name in names if name]


def table_after_label(block: str, label: str) -> list[str]:
    label_index = block.lower().find(label.lower())
    if label_index < 0:
        return []
    table_match = re.search(
        r"<table[^>]*>(.*?)</table>", block[label_index:], flags=re.I | re.S
    )
    if not table_match:
        return []
    return extract_td_names(table_match.group(1))


def parse_house_votes(
    html_text: str, bill_number: str, official_url: str
) -> list[ParsedVote]:
    votes: list[ParsedVote] = []
    compact_expected = compact_bill_number(bill_number)
    blocks = re.findall(
        r"<div class=\"panel-content\">(.*?)(?=<div class=\"panel-content\">|</main>|</body>)",
        html_text,
        flags=re.I | re.S,
    )
    for block in blocks:
        heading = (
            strip_tags(re.search(r"<H3>(.*?)</H3>", block, flags=re.I | re.S).group(1))
            if re.search(r"<H3>.*?</H3>", block, flags=re.I | re.S)
            else ""
        )
        if compact_bill_number(heading) != compact_expected:
            continue
        count_match = re.search(
            r"<H3>\s*(\d+)\s+YEA\s+and\s+(\d+)\s+Nay\s*</H3>", block, flags=re.I
        )
        journal_match = re.search(
            r"Journal Page</b>\s*<a[^>]*>([^<]+)</a>", block, flags=re.I
        )
        date_match = re.search(r"<b>Date:</b>\s*([^<]+)</div>", block, flags=re.I)
        if not count_match:
            continue
        header_divs = [
            strip_tags(item)
            for item in re.findall(r"<div><b>(.*?)</b></div>", block, flags=re.I | re.S)
        ]
        motion_text = " - ".join(item for item in header_divs if item)
        votes.append(
            ParsedVote(
                motion_text=motion_text or None,
                occurred_at=parse_date(date_match.group(1) if date_match else None),
                journal_page=normalize_space(journal_match.group(1))
                if journal_match
                else None,
                yes_count=int(count_match.group(1)),
                no_count=int(count_match.group(2)),
                affirmative_names=table_after_label(
                    block, "Those who voted in the affirmative were:"
                ),
                negative_names=table_after_label(
                    block, "Those who voted in the negative were:"
                ),
                official_url=official_url,
            )
        )
    return votes


def get_text(url: str, *, retries: int = 4, backoff: float = 2.0) -> str:
    # The MN House votes endpoint returns intermittent 500s under rapid requests,
    # so retry transient (5xx / connection) failures with exponential backoff;
    # a 4xx still fails fast.
    last_exc: Exception | None = None
    for attempt in range(retries):
        try:
            response = requests.get(
                url, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT_SECONDS
            )
            response.raise_for_status()
            return response.text
        except requests.RequestException as exc:
            status = getattr(exc.response, "status_code", None)
            if status is not None and status < 500:
                raise
            last_exc = exc
            if attempt < retries - 1:
                time.sleep(backoff * (2**attempt))
    assert last_exc is not None
    raise last_exc


def senate_pdf_for_page(journal_page: str) -> tuple[str, int]:
    page = journal_page.lower().replace("a", "").replace("c", "")
    payload = requests.get(
        "https://www.senate.mn/api/journal/gotopage",
        params={"page": page, "ls": "94"},
        headers={"User-Agent": USER_AGENT},
        timeout=TIMEOUT_SECONDS,
    )
    payload.raise_for_status()
    data = payload.json()
    return (
        f"https://www.senate.mn/journals/{data['fileBiennium']}/{data['filename']}.pdf",
        int(data["internal_page"]),
    )


def pdf_pages_text(pdf_url: str, first_page: int, last_page: int) -> str:
    with tempfile.TemporaryDirectory() as temp_dir:
        pdf_path = Path(temp_dir) / "journal.pdf"
        response = requests.get(
            pdf_url, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT_SECONDS
        )
        response.raise_for_status()
        pdf_path.write_bytes(response.content)
        result = subprocess.run(
            [
                "pdftotext",
                "-f",
                str(first_page),
                "-l",
                str(last_page),
                str(pdf_path),
                "-",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        return result.stdout


def names_between(text: str, start: int, end_pattern: str) -> tuple[list[str], int]:
    end_match = re.search(end_pattern, text[start:], flags=re.I)
    end = start + end_match.start() if end_match else len(text)
    segment = text[start:end]
    segment = re.sub(
        r"Pursuant to Rule 40,.*?(?=Those who|The motion|So the|$)",
        " ",
        segment,
        flags=re.I | re.S,
    )
    names: list[str] = []
    for line in segment.splitlines():
        cleaned = normalize_space(line).strip(".,;")
        if not cleaned or len(cleaned) > 60:
            continue
        if re.search(
            r"\d|^\[|DAY|Journal|Rule|Senator|affirmative|negative|question|motion|bill|passed|title",
            cleaned,
            flags=re.I,
        ):
            continue
        cleaned = re.sub(r"\band\b", ",", cleaned)
        for piece in [part.strip(" .,;") for part in cleaned.split(",")]:
            if re.fullmatch(r"[A-Z][A-Za-z' -]+", piece):
                names.append(piece)
    return names, end


def parse_senate_vote_from_pdf(
    text: str, yes_count: int, no_count: int, journal_page: str, official_url: str
) -> ParsedVote | None:
    count_pattern = rf"The roll was called, and there were yeas\s+{yes_count}\s+and nays\s+{no_count}"
    count_match = re.search(count_pattern, text, flags=re.I)
    if not count_match:
        return None
    prefix = text[: count_match.start()]
    motion_lines = [
        normalize_space(line)
        for line in prefix.splitlines()[-8:]
        if normalize_space(line)
    ]
    motion_text = next(
        (
            line
            for line in reversed(motion_lines)
            if "question was taken" not in line.lower()
        ),
        None,
    )

    affirmative_marker = re.search(
        r"Those who voted in the affirmative were:",
        text[count_match.end() :],
        flags=re.I,
    )
    if not affirmative_marker:
        return None
    affirmative_start = count_match.end() + affirmative_marker.end()
    affirmative_names, affirmative_end = names_between(
        text, affirmative_start, r"Those who voted in the negative were:"
    )

    negative_marker = re.search(
        r"Those who voted in the negative were:", text[affirmative_end:], flags=re.I
    )
    if not negative_marker:
        negative_names = []
    else:
        negative_start = affirmative_end + negative_marker.end()
        negative_names, _ = names_between(
            text,
            negative_start,
            r"(So the|The motion|President|SPECIAL ORDER|S\.F\. No\.|H\.F\. No\.)",
        )

    return ParsedVote(
        motion_text=motion_text,
        occurred_at=None,
        journal_page=journal_page,
        yes_count=yes_count,
        no_count=no_count,
        affirmative_names=affirmative_names,
        negative_names=negative_names,
        official_url=official_url,
    )


def vote_name_key(name: str) -> tuple[str, tuple[str, ...]]:
    name = normalize_space(name).replace(".", "")
    if "," in name:
        last, rest = [part.strip() for part in name.split(",", 1)]
        return last.lower(), tuple(part.lower() for part in rest.split() if part)
    return name.split()[-1].lower(), ()


def legislator_keys(full_name: str, sort_name: str) -> set[tuple[str, tuple[str, ...]]]:
    clean_full = re.sub(
        r"^(Rep\.|Representative|Sen\.|Senator)\s+", "", full_name
    ).strip()
    parts = clean_full.split()
    last = parts[-1].lower()
    first = parts[0].lower() if parts else ""
    keys = {(last, ())}
    if first:
        keys.add((last, (first[0],)))
        keys.add((last, (first,)))
    if "," in sort_name:
        sort_last, sort_rest = [part.strip() for part in sort_name.split(",", 1)]
        rest_parts = [part.lower().strip(".") for part in sort_rest.split() if part]
        if rest_parts:
            keys.add((sort_last.lower(), tuple(part[0] for part in rest_parts)))
            keys.add((sort_last.lower(), tuple(rest_parts)))
    return keys


def build_legislator_index(
    db: Session, chamber_id: Any
) -> dict[tuple[str, tuple[str, ...]], list[Any]]:
    rows = db.scalars(
        select(Legislator)
        .join(
            LegislatorServicePeriod,
            LegislatorServicePeriod.legislator_id == Legislator.id,
        )
        .where(
            LegislatorServicePeriod.chamber_id == chamber_id,
            LegislatorServicePeriod.is_current.is_(True),
        )
    ).all()
    index: dict[tuple[str, tuple[str, ...]], list[Any]] = {}
    for row in rows:
        for key in legislator_keys(row.full_name, row.sort_name):
            index.setdefault(key, []).append(row)
    return index


def resolve_name(
    name: str, index: dict[tuple[str, tuple[str, ...]], list[Any]]
) -> Any | None:
    last, initials = vote_name_key(name)
    candidates = index.get((last, initials), [])
    if len(candidates) == 1:
        return candidates[0]
    if initials:
        return None
    candidates = index.get((last, ()), [])
    return candidates[0] if len(candidates) == 1 else None


def find_matching_vote(
    votes: list[ParsedVote], action: Any, yes_count: int, no_count: int
) -> ParsedVote | None:
    matches = [
        vote
        for vote in votes
        if vote.yes_count == yes_count
        and vote.no_count == no_count
        and (not action.journal_page or vote.journal_page == action.journal_page)
    ]
    if len(matches) == 1:
        return matches[0]
    return None


def backfill_votes(
    db: Session,
    *,
    limit: int | None,
    dry_run: bool,
    only_missing: bool = False,
    bill: str | None = None,
) -> BackfillStats:
    query = (
        select(BillAction)
        .join(Bill, Bill.id == BillAction.bill_id)
        .where(BillAction.roll_call_text.op("~")(r"^\s*\d+\s*-\s*\d+\s*$"))
    )
    # Single-bill filter (e.g. "HF1141") for targeted re-ingest / verification.
    if bill:
        match = re.match(r"^\s*([HS]F)\s*0*(\d+)\s*$", bill, flags=re.I)
        if not match:
            raise SystemExit(f"--bill must look like 'HF1141', got: {bill!r}")
        query = query.where(
            Bill.file_type == match.group(1).upper(),
            Bill.file_number == int(match.group(2)),
        )
    # Incremental mode: skip roll-call actions that already have a vote event, so
    # a re-run only fills the gap (keeps the corpus current without re-fetching
    # and rewriting the events that are already ingested).
    if only_missing:
        query = query.where(
            ~select(VoteEvent.id)
            .where(VoteEvent.bill_action_id == BillAction.id)
            .exists()
        )
    actions = db.scalars(
        query.order_by(
            Bill.file_type.asc(), Bill.file_number.asc(), BillAction.action_number.asc()
        ).limit(limit)
    ).all()
    stats = {
        "actions_seen": 0,
        "events_created": 0,
        "records_created": 0,
        "no_source_match": 0,
        "ambiguous_or_missing_names": 0,
        "write_errors": 0,
    }
    house_cache: dict[str, list[ParsedVote]] = {}
    senate_cache: dict[str, str] = {}
    legislator_indexes: dict[Any, dict[tuple[str, tuple[str, ...]], list[Any]]] = {}

    for action in actions:
        stats["actions_seen"] += 1
        try:
            bill = db.get(Bill, action.bill_id)
            chamber = db.get(Chamber, action.chamber_id) if action.chamber_id else None
            counts = parse_roll_call(action.roll_call_text)
            if bill is None or chamber is None or counts is None:
                stats["no_source_match"] += 1
                continue
            yes_count, no_count = counts

            parsed_vote: ParsedVote | None = None
            if chamber.slug == "house":
                bill_number = house_bill_number(bill.file_type, bill.file_number)
                url = f"https://www.house.mn.gov/votes/Details?{urlencode({'BillNumber': bill_number, 'SessionKey': '302'})}"
                if url not in house_cache:
                    house_cache[url] = parse_house_votes(
                        get_text(url), bill_number, url
                    )
                parsed_vote = find_matching_vote(
                    house_cache[url], action, yes_count, no_count
                )
            elif chamber.slug == "senate" and action.journal_page:
                pdf_url, internal_page = senate_pdf_for_page(action.journal_page)
                text_key = f"{pdf_url}#{internal_page}"
                if text_key not in senate_cache:
                    senate_cache[text_key] = pdf_pages_text(
                        pdf_url, internal_page, internal_page + 1
                    )
                parsed_vote = parse_senate_vote_from_pdf(
                    senate_cache[text_key],
                    yes_count,
                    no_count,
                    action.journal_page,
                    f"{pdf_url}#page={internal_page}",
                )
        except Exception as exc:  # noqa: BLE001
            stats["no_source_match"] += 1
            bill_key = getattr(
                db.get(Bill, action.bill_id), "bill_key", str(action.bill_id)
            )
            print(
                f"source error: {bill_key} action {action.action_number}: {type(exc).__name__}: {exc}"
            )
            continue

        if parsed_vote is None:
            stats["no_source_match"] += 1
            print(
                f"no match: {bill.bill_key} action {action.action_number} {chamber.slug} {action.roll_call_text} pg {action.journal_page}"
            )
            continue

        if dry_run:
            stats["events_created"] += 1
            stats["records_created"] += len(parsed_vote.affirmative_names) + len(
                parsed_vote.negative_names
            )
            continue

        action_exists = db.scalar(
            select(func.count())
            .select_from(BillAction)
            .where(BillAction.id == action.id)
        )
        if not action_exists:
            stats["no_source_match"] += 1
            print(
                f"stale action: {bill.bill_key} action {action.action_number} {chamber.slug} {action.id}"
            )
            continue

        # Commit per action and isolate write failures: one bad action rolls back
        # only itself (leaving it to be retried on a re-run) instead of crashing
        # the whole backfill and losing every event created so far.
        local_records = 0
        local_ambiguous = 0
        try:
            db.execute(
                delete(VoteRecord).where(
                    VoteRecord.vote_event_id.in_(
                        select(VoteEvent.id).where(
                            VoteEvent.bill_action_id == action.id
                        )
                    )
                )
            )
            db.execute(delete(VoteEvent).where(VoteEvent.bill_action_id == action.id))
            event = VoteEvent(
                bill_id=bill.id,
                bill_action_id=action.id,
                chamber_id=chamber.id,
                motion_text=parsed_vote.motion_text or action.action_text,
                result_text=action.action_text,
                occurred_at=parsed_vote.occurred_at or action.action_at,
                official_url=parsed_vote.official_url,
                yes_count=yes_count,
                no_count=no_count,
            )
            db.add(event)
            db.flush()

            if chamber.id not in legislator_indexes:
                legislator_indexes[chamber.id] = build_legislator_index(db, chamber.id)
            index = legislator_indexes[chamber.id]
            sort_order = 0
            seen_legislator_ids: set[Any] = set()
            for vote_value, names in [
                (VoteValue.yes, parsed_vote.affirmative_names),
                (VoteValue.no, parsed_vote.negative_names),
            ]:
                for name in names:
                    legislator = resolve_name(name, index)
                    if legislator is None or legislator.id in seen_legislator_ids:
                        local_ambiguous += 1
                        continue
                    seen_legislator_ids.add(legislator.id)
                    sort_order += 1
                    db.add(
                        VoteRecord(
                            vote_event_id=event.id,
                            legislator_id=legislator.id,
                            vote_value=vote_value,
                            sort_order=sort_order,
                        )
                    )
                    local_records += 1

            bill_stats = db.scalar(
                select(BillStats).where(BillStats.bill_id == bill.id)
            )
            if bill_stats is not None:
                bill_stats.vote_event_count = (
                    db.scalar(
                        select(func.count())
                        .select_from(VoteEvent)
                        .where(VoteEvent.bill_id == bill.id)
                    )
                    or 0
                )
            db.commit()
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            stats["write_errors"] += 1
            print(
                f"write error: {bill.bill_key} action {action.action_number}: {type(exc).__name__}: {exc}"
            )
            continue

        stats["events_created"] += 1
        stats["records_created"] += local_records
        stats["ambiguous_or_missing_names"] += local_ambiguous

    return BackfillStats(**stats)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Backfill structured vote events and vote records from official roll-call sources."
    )
    parser.add_argument(
        "--database-url",
        default=os.environ.get("DATABASE_URL")
        or supabase_database_url()
        or get_database_url(),
    )
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--only-missing",
        action="store_true",
        help="Only process roll-call actions that have no vote event yet.",
    )
    parser.add_argument(
        "--bill",
        default=None,
        help="Restrict to a single bill, e.g. 'HF1141' (for targeted re-ingest).",
    )
    args = parser.parse_args()
    if not args.database_url:
        raise SystemExit("DATABASE_URL or Supabase env vars are required")
    engine = create_engine(
        normalize_database_url(args.database_url),
        pool_pre_ping=True,
        connect_args=NO_PREPARED_STATEMENTS,
    )
    with Session(engine) as db:
        stats = backfill_votes(
            db,
            limit=args.limit,
            dry_run=args.dry_run,
            only_missing=args.only_missing,
            bill=args.bill,
        )
        print(stats)


if __name__ == "__main__":
    main()
