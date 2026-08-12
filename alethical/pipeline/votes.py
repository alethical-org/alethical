#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import tempfile
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Sequence
from urllib.parse import urlencode

import requests
from sqlalchemy import create_engine, delete, func, select
from sqlalchemy.orm import Session

from alethical.pipeline.http_text import response_text
from alethical.db import models as schema
from alethical.db.session import (
    NO_PREPARED_STATEMENTS,
    database_url_for_target,
    get_database_url,
    normalize_database_url,
)
from alethical.db.session import supabase_database_url as _supabase_database_url


Bill = schema.Bill
BillAction = schema.BillAction
BillStats = schema.BillStats
Chamber = schema.Chamber
Legislator = schema.Legislator
LegislativeSession = schema.LegislativeSession
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
    cross_chamber_mirror: int = 0


@dataclass(frozen=True)
class VoteReconciliationItem:
    bill_key: str
    vote_event_id: str | None
    action_number: int | None
    outcome: str
    reason: str | None = None


@dataclass(frozen=True)
class VoteReconciliationReport:
    updated: tuple[VoteReconciliationItem, ...] = ()
    unchanged: tuple[VoteReconciliationItem, ...] = ()
    rejected: tuple[VoteReconciliationItem, ...] = ()
    failed: tuple[VoteReconciliationItem, ...] = ()

    @property
    def items(self) -> tuple[VoteReconciliationItem, ...]:
        return self.updated + self.unchanged + self.rejected + self.failed

    def to_dict(self) -> dict[str, Any]:
        def item_dict(item: VoteReconciliationItem) -> dict[str, Any]:
            return {
                "bill_key": item.bill_key,
                "vote_event_id": item.vote_event_id,
                "action_number": item.action_number,
                "outcome": item.outcome,
                "reason": item.reason,
            }

        return {
            "counts": {
                "updated": len(self.updated),
                "unchanged": len(self.unchanged),
                "rejected": len(self.rejected),
                "failed": len(self.failed),
            },
            "updated": [item_dict(item) for item in self.updated],
            "unchanged": [item_dict(item) for item in self.unchanged],
            "rejected": [item_dict(item) for item in self.rejected],
            "failed": [item_dict(item) for item in self.failed],
        }


def supabase_database_url() -> str | None:
    return _supabase_database_url()


def rate_limited_source_session(engine: Any, *, target: str) -> Any:
    """Use the shared production source pace when the scheduler has shipped it."""
    try:
        from alethical.pipeline.request_limits import (
            DEFAULT_SOURCE_REQUEST_INTERVAL_SECONDS,
            DatabaseRequestLimiter,
            RateLimitedSession,
        )
        from alethical.pipeline.minnesota import http_session
    except ImportError:
        # #1446 lands before #1323 by design. The workflow that enables the
        # bounded sweep is held until #1323 rebases, supplies this shared limiter,
        # and removes this temporary release-order fallback.
        if target == "production":
            raise RuntimeError(
                "production vote reconciliation waits for the shared database "
                "source limiter from #1323"
            )
        return requests.Session()
    return RateLimitedSession(
        http_session(),
        DatabaseRequestLimiter(
            engine,
            interval_seconds=DEFAULT_SOURCE_REQUEST_INTERVAL_SECONDS,
        ),
    )


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


def looks_like_bill_number(value: str) -> bool:
    """True when a heading is itself a bill file number (e.g. 'H.F. NO. 2115'),
    as opposed to a motion label ('TO CONSIDER FIRST FOR CALENDAR')."""
    cleaned = value.replace(".", " ")
    return bool(re.search(r"\b[HS]\s*F(?:\s*NO\s*)?\s*0*\d+\b", cleaned, flags=re.I))


def leading_chamber(action_text: str | None) -> str | None:
    """The chamber named as the acting body at the start of an action, e.g.
    'Senate adopted conference committee report, bill repassed' -> 'senate'.
    Returns None when the text does not open with a chamber name."""
    if not action_text:
        return None
    match = re.match(r"\s*(House|Senate)\b", action_text, flags=re.I)
    return match.group(1).lower() if match else None


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
        # The page is fetched per bill number, so every block belongs to this
        # bill -- including motion votes (e.g. "TO CONSIDER FIRST FOR CALENDAR")
        # whose H3 heading is the motion label rather than the bill number. Skip
        # a block only when its heading is a *different* bill number.
        if (
            looks_like_bill_number(heading)
            and compact_bill_number(heading) != compact_expected
        ):
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


def get_text(
    url: str,
    *,
    retries: int = 4,
    backoff: float = 2.0,
    source_session: Any | None = None,
) -> str:
    # The MN House votes endpoint returns intermittent 500s under rapid requests,
    # so retry transient (5xx / connection) failures with exponential backoff;
    # a 4xx still fails fast.
    last_exc: Exception | None = None
    for attempt in range(retries):
        try:
            source = source_session or requests
            response = source.get(
                url, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT_SECONDS
            )
            response.raise_for_status()
            return response_text(response)
        except requests.RequestException as exc:
            status = getattr(exc.response, "status_code", None)
            if status is not None and status < 500:
                raise
            last_exc = exc
            if attempt < retries - 1:
                time.sleep(backoff * (2**attempt))
    assert last_exc is not None
    raise last_exc


def senate_pdf_for_page(
    journal_page: str, *, source_session: Any | None = None
) -> tuple[str, int]:
    page = journal_page.lower().replace("a", "").replace("c", "")
    source = source_session or requests
    payload = source.get(
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


def pdf_pages_text(
    pdf_url: str,
    first_page: int,
    last_page: int,
    *,
    source_session: Any | None = None,
) -> str:
    with tempfile.TemporaryDirectory() as temp_dir:
        pdf_path = Path(temp_dir) / "journal.pdf"
        source = source_session or requests
        response = source.get(
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


SENATE_JOURNAL_LIST_URL = (
    "https://www.senate.mn/journals/journal_list.php?display_ls_year=94"
)


def senate_journal_index(*, source_session: Any | None = None) -> dict[str, str]:
    """Map each session day 'YYYYMMDD' to its Senate journal PDF URL.

    Used to recover the journal for a roll-call action whose JOURNAL_PAGE is
    empty at the Revisor source: the day's journal is located by the action
    date instead.
    """
    html_text = get_text(SENATE_JOURNAL_LIST_URL, source_session=source_session)
    index: dict[str, str] = {}
    for href in re.findall(r'href="([^"]*\.pdf)"', html_text, flags=re.I):
        name = href.rsplit("/", 1)[-1]
        match = re.match(r"(\d{8})", name)
        if not match:
            continue
        path = re.sub(r"/{2,}", "/", href)
        url = path if path.startswith("http") else f"https://www.senate.mn{path}"
        index.setdefault(match.group(1), url)
    return index


def senate_pdf_for_date(
    action_at: datetime | None, *, journal_index: dict[str, str]
) -> str | None:
    if action_at is None:
        return None
    return journal_index.get(action_at.strftime("%Y%m%d"))


def pdf_full_text(pdf_url: str, *, source_session: Any | None = None) -> str:
    with tempfile.TemporaryDirectory() as temp_dir:
        pdf_path = Path(temp_dir) / "journal.pdf"
        source = source_session or requests
        response = source.get(
            pdf_url, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT_SECONDS
        )
        response.raise_for_status()
        pdf_path.write_bytes(response.content)
        result = subprocess.run(
            ["pdftotext", str(pdf_path), "-"],
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


def _parse_senate_vote_at(
    text: str,
    count_match: re.Match[str],
    yes_count: int,
    no_count: int,
    journal_page: str | None,
    official_url: str,
) -> ParsedVote | None:
    prefix = text[: count_match.start()]
    motion_lines = [
        normalize_space(line)
        for line in prefix.splitlines()[-8:]
        if normalize_space(line)
    ]
    # The "The question was taken on <X>." line right before the roll call names
    # what this vote decided (e.g. "the final passage of S.F. No. 856"). Prefer
    # it: falling back to an earlier line can quote a *prior* vote's outcome
    # ("The motion did not prevail.") as this vote's motion.
    motion_text: str | None = None
    for line in reversed(motion_lines):
        if re.search(r"question was taken on", line, flags=re.I):
            stripped = (
                re.sub(r"^.*question was taken on(?:\s+the)?\s+", "", line, flags=re.I)
                .strip()
                .rstrip(".")
            )
            motion_text = (stripped[:1].upper() + stripped[1:]) if stripped else line
            break
    if motion_text is None and motion_lines:
        motion_text = motion_lines[-1]

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


SENATE_ROLL_CALL_PATTERN = re.compile(
    r"The roll was called, and there were yeas\s+(\d+)\s+and nays\s+(\d+)\b",
    flags=re.I,
)


def parse_senate_vote_from_pdf(
    text: str,
    yes_count: int,
    no_count: int,
    journal_page: str | None,
    official_url: str,
) -> ParsedVote | None:
    count_pattern = re.compile(
        rf"The roll was called, and there were yeas\s+{yes_count}\s+and nays\s+{no_count}\b",
        flags=re.I,
    )
    count_match = count_pattern.search(text)
    if count_match is None:
        return None
    return _parse_senate_vote_at(
        text, count_match, yes_count, no_count, journal_page, official_url
    )


def parse_senate_votes_from_pdf(
    text: str, journal_page: str | None, official_url: str
) -> list[ParsedVote]:
    """Parse every complete roll call in a Senate journal slice."""
    votes: list[ParsedVote] = []
    for count_match in SENATE_ROLL_CALL_PATTERN.finditer(text):
        vote = _parse_senate_vote_at(
            text,
            count_match,
            int(count_match.group(1)),
            int(count_match.group(2)),
            journal_page,
            official_url,
        )
        if vote is not None:
            votes.append(vote)
    return votes


def parse_senate_votes_scoped(
    text: str,
    file_type: str,
    file_number: int,
    official_url: str,
) -> list[ParsedVote]:
    """Parse this bill's complete roll calls from a full-day Senate journal."""
    letter = file_type[0].upper()
    wanted_bill = re.compile(
        rf"{letter}\.?\s*F\.?\s*No\.?\s*0*{file_number}\b", flags=re.I
    )
    any_bill = re.compile(r"[HS]\.?\s*F\.?\s*No\.?\s*0*\d+\b", flags=re.I)
    all_bill_hits = list(any_bill.finditer(text))
    votes: list[ParsedVote] = []
    for bill_hit in wanted_bill.finditer(text):
        end = next(
            (
                other.start()
                for other in all_bill_hits
                if other.start() > bill_hit.start()
            ),
            len(text),
        )
        votes.extend(
            parse_senate_votes_from_pdf(
                text[bill_hit.start() : end], None, official_url
            )
        )
    return votes


def parse_senate_vote_scoped(
    text: str,
    file_type: str,
    file_number: int,
    yes_count: int,
    no_count: int,
    official_url: str,
) -> ParsedVote | None:
    """Find one bill's roll call inside a full-day Senate journal.

    A full day's journal holds many roll calls, so match the count line whose
    preceding text references this bill (e.g. 'H.F. No. 3615'), then hand the
    slice from there to the standard per-page parser.
    """
    matches = [
        vote
        for vote in parse_senate_votes_scoped(
            text, file_type, file_number, official_url
        )
        if vote.yes_count == yes_count and vote.no_count == no_count
    ]
    return matches[0] if len(matches) == 1 else None


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
    db: Session, chamber_id: Any, session_id: Any
) -> dict[tuple[str, tuple[str, ...]], list[Any]]:
    # Scope by the vote's session, not is_current: roll calls are historical, so
    # a member who served this session and later departed (resigned, died, lost
    # the seat) still cast real votes that must resolve. Filtering on is_current
    # dropped Hortman, Vang Her, and Schomacker, losing ~1 in 8 House records.
    rows = db.scalars(
        select(Legislator)
        .join(
            LegislatorServicePeriod,
            LegislatorServicePeriod.legislator_id == Legislator.id,
        )
        .where(
            LegislatorServicePeriod.chamber_id == chamber_id,
            LegislatorServicePeriod.session_id == session_id,
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
    votes: list[ParsedVote],
    action: Any,
    yes_count: int,
    no_count: int,
    saved_event: Any | None = None,
) -> ParsedVote | None:
    def unique(items: list[ParsedVote]) -> ParsedVote | None:
        return items[0] if len(items) == 1 else None

    # Stable identity fields come before the tally. That lets the safety sweep
    # find a roll call after the government corrects its count, which is exactly
    # when matching only the old count would lose the vote we need to repair.
    if saved_event is not None and action.journal_page:
        page_match = unique(
            [vote for vote in votes if vote.journal_page == action.journal_page]
        )
        if page_match is not None:
            return page_match

    expected_date = (
        action.action_at or getattr(saved_event, "occurred_at", None)
        if saved_event is not None
        else None
    )
    if expected_date is not None:
        date_matches = [
            vote
            for vote in votes
            if vote.occurred_at is not None
            and vote.occurred_at.date() == expected_date.date()
        ]
        date_match = unique(date_matches)
        if date_match is not None:
            return date_match

    saved_motion = normalize_space(getattr(saved_event, "motion_text", "") or "")
    if saved_motion:
        motion_match = unique(
            [
                vote
                for vote in votes
                if normalize_space(vote.motion_text or "").casefold()
                == saved_motion.casefold()
            ]
        )
        if motion_match is not None:
            return motion_match

    tally_matches = [
        vote
        for vote in votes
        if vote.yes_count == yes_count and vote.no_count == no_count
    ]
    # A unique yes/no tally already identifies the roll call, so accept it even
    # when the action's journal-page label differs from the vote's (the House
    # source often records it a page off). Only fall back to the journal page to
    # break a genuine tie when several votes share the same tally.
    if len(tally_matches) == 1:
        return tally_matches[0]
    if len(votes) == 1:
        return votes[0]
    return None


def _source_vote_for_action(
    action: Any,
    bill: Any,
    chamber: Any,
    *,
    source_session: Any | None,
    house_cache: dict[str, list[ParsedVote]],
    senate_cache: dict[str, Any],
    saved_event: Any | None = None,
) -> ParsedVote | None:
    # The House and Senate endpoints below are the current 94th Legislature
    # sources. Refuse another session instead of silently attaching a same-number
    # current vote to an older bill.
    if not str(bill.bill_key).startswith("94-"):
        return None
    counts = parse_roll_call(action.roll_call_text)
    if counts is None:
        return None
    yes_count, no_count = counts
    if chamber.slug == "house":
        bill_number = house_bill_number(bill.file_type, bill.file_number)
        url = (
            "https://www.house.mn.gov/votes/Details?"
            f"{urlencode({'BillNumber': bill_number, 'SessionKey': '302'})}"
        )
        if url not in house_cache:
            house_cache[url] = parse_house_votes(
                get_text(url, source_session=source_session), bill_number, url
            )
        return find_matching_vote(
            house_cache[url], action, yes_count, no_count, saved_event
        )
    if chamber.slug == "senate" and action.journal_page:
        pdf_url, internal_page = senate_pdf_for_page(
            action.journal_page, source_session=source_session
        )
        for first_page in (internal_page, max(1, internal_page - 1)):
            text_key = f"{pdf_url}#{first_page}-{internal_page + 1}"
            if text_key not in senate_cache:
                senate_cache[text_key] = pdf_pages_text(
                    pdf_url,
                    first_page,
                    internal_page + 1,
                    source_session=source_session,
                )
            vote = find_matching_vote(
                parse_senate_votes_from_pdf(
                    senate_cache[text_key],
                    action.journal_page,
                    f"{pdf_url}#page={internal_page}",
                ),
                action,
                yes_count,
                no_count,
                saved_event,
            )
            if vote is not None:
                return vote
        return None
    if chamber.slug == "senate":
        index_key = "__journal_index__"
        if index_key not in senate_cache:
            senate_cache[index_key] = senate_journal_index(
                source_session=source_session
            )
        pdf_url = senate_pdf_for_date(
            action.action_at, journal_index=senate_cache[index_key]
        )
        if not pdf_url:
            return None
        if pdf_url not in senate_cache:
            senate_cache[pdf_url] = pdf_full_text(
                pdf_url, source_session=source_session
            )
        return find_matching_vote(
            parse_senate_votes_scoped(
                senate_cache[pdf_url], bill.file_type, bill.file_number, pdf_url
            ),
            action,
            yes_count,
            no_count,
            saved_event,
        )
    return None


@dataclass(frozen=True)
class _ValidatedVote:
    motion_text: str | None
    result_text: str | None
    occurred_at: datetime | None
    official_url: str
    yes_count: int
    no_count: int
    records: tuple[tuple[Any, VoteValue, int], ...]


def _validate_complete_vote(
    db: Session,
    *,
    parsed_vote: ParsedVote,
    action: Any,
    bill: Any,
    chamber: Any,
    legislator_indexes: dict[
        tuple[Any, Any], dict[tuple[str, tuple[str, ...]], list[Any]]
    ],
) -> tuple[_ValidatedVote | None, str | None]:
    if parsed_vote.yes_count != len(parsed_vote.affirmative_names):
        return None, "affirmative member list does not equal the official tally"
    if parsed_vote.no_count != len(parsed_vote.negative_names):
        return None, "negative member list does not equal the official tally"
    all_names = parsed_vote.affirmative_names + parsed_vote.negative_names
    normalized_names = [normalize_space(name).casefold() for name in all_names]
    if any(not name for name in normalized_names):
        return None, "official member list contains a blank name"
    if len(set(normalized_names)) != len(normalized_names):
        return None, "official member list contains a duplicate name"

    index_key = (chamber.id, bill.session_id)
    if index_key not in legislator_indexes:
        legislator_indexes[index_key] = build_legislator_index(
            db, chamber.id, bill.session_id
        )
    index = legislator_indexes[index_key]
    records: list[tuple[Any, VoteValue, int]] = []
    seen_legislators: set[Any] = set()
    sort_order = 0
    for value, names in (
        (VoteValue.yes, parsed_vote.affirmative_names),
        (VoteValue.no, parsed_vote.negative_names),
    ):
        for name in names:
            legislator = resolve_name(name, index)
            if legislator is None:
                return None, f"official member name did not resolve: {name}"
            if legislator.id in seen_legislators:
                return None, f"official member resolved more than once: {name}"
            seen_legislators.add(legislator.id)
            sort_order += 1
            records.append((legislator.id, value, sort_order))

    return (
        _ValidatedVote(
            motion_text=parsed_vote.motion_text or action.action_text,
            result_text=action.action_text,
            occurred_at=parsed_vote.occurred_at or action.action_at,
            official_url=parsed_vote.official_url,
            yes_count=parsed_vote.yes_count,
            no_count=parsed_vote.no_count,
            records=tuple(records),
        ),
        None,
    )


def _saved_vote_signature(event: Any, records: Sequence[Any]) -> tuple[Any, ...]:
    return (
        event.yes_count,
        event.no_count,
        event.result_text,
        event.occurred_at,
        event.motion_text,
        event.official_url,
        tuple(
            (record.legislator_id, record.vote_value)
            for record in sorted(records, key=lambda item: item.sort_order)
        ),
    )


def _validated_vote_signature(vote: _ValidatedVote) -> tuple[Any, ...]:
    return (
        vote.yes_count,
        vote.no_count,
        vote.result_text,
        vote.occurred_at,
        vote.motion_text,
        vote.official_url,
        tuple((legislator_id, value) for legislator_id, value, _order in vote.records),
    )


def _replace_vote_records(
    db: Session, event: Any, records: Sequence[tuple[Any, VoteValue, int]]
) -> None:
    db.execute(delete(VoteRecord).where(VoteRecord.vote_event_id == event.id))
    for legislator_id, value, sort_order in records:
        db.add(
            VoteRecord(
                vote_event_id=event.id,
                legislator_id=legislator_id,
                vote_value=value,
                sort_order=sort_order,
            )
        )


def _refresh_vote_counts(
    db: Session,
    *,
    bill_id: Any,
    session_id: Any,
    affected_legislator_ids: set[Any],
) -> None:
    bill_stats = db.scalar(select(BillStats).where(BillStats.bill_id == bill_id))
    if bill_stats is not None:
        bill_stats.vote_event_count = int(
            db.scalar(
                select(func.count())
                .select_from(VoteEvent)
                .where(VoteEvent.bill_id == bill_id)
            )
            or 0
        )
    for legislator_id in affected_legislator_ids:
        stats = db.scalar(
            select(schema.LegislatorStats).where(
                schema.LegislatorStats.legislator_id == legislator_id,
                schema.LegislatorStats.session_id == session_id,
            )
        )
        if stats is not None:
            stats.vote_record_count = int(
                db.scalar(
                    select(func.count())
                    .select_from(VoteRecord)
                    .join(VoteEvent, VoteEvent.id == VoteRecord.vote_event_id)
                    .join(Bill, Bill.id == VoteEvent.bill_id)
                    .where(
                        VoteRecord.legislator_id == legislator_id,
                        Bill.session_id == session_id,
                    )
                )
                or 0
            )


def _sweep_event_ids(db: Session, *, limit: int, now: datetime) -> list[Any]:
    if limit <= 0:
        return []
    event_ids = list(
        db.scalars(
            select(VoteEvent.id)
            .join(Bill, Bill.id == VoteEvent.bill_id)
            .join(LegislativeSession, LegislativeSession.id == Bill.session_id)
            .where(VoteEvent.bill_action_id.is_not(None))
            .where(LegislativeSession.is_current.is_(True))
            .order_by(VoteEvent.id.asc())
        ).all()
    )
    if not event_ids:
        return []
    # A deterministic daily rotation needs no cursor write. Each day moves by the
    # requested window width, and a retry on the same day selects the same events.
    day_number = (now.astimezone(UTC).date() - datetime(1970, 1, 1).date()).days
    offset = (day_number * limit) % len(event_ids)
    return [
        event_ids[(offset + index) % len(event_ids)]
        for index in range(min(limit, len(event_ids)))
    ]


def reconcile_saved_votes(
    db: Session,
    *,
    bill_keys: Sequence[str] = (),
    safety_sweep_limit: int = 0,
    dry_run: bool,
    source_session: Any | None = None,
    now: datetime | None = None,
) -> VoteReconciliationReport:
    """Recheck saved roll calls and replace only complete, changed official records."""
    now = now or datetime.now(UTC)
    groups: dict[str, list[VoteReconciliationItem]] = {
        "updated": [],
        "unchanged": [],
        "rejected": [],
        "failed": [],
    }
    selected_work: list[tuple[Any, Any, Any, Any | None]] = []
    seen_event_ids: set[Any] = set()
    seen_action_ids: set[Any] = set()

    for bill_key in dict.fromkeys(bill_keys):
        bill = db.scalar(select(Bill).where(Bill.bill_key == bill_key))
        if bill is None:
            groups["failed"].append(
                VoteReconciliationItem(
                    bill_key, None, None, "failed", "bill key not found"
                )
            )
            continue
        actions = list(
            db.scalars(
                select(BillAction)
                .where(
                    BillAction.bill_id == bill.id,
                    BillAction.roll_call_text.op("~")(r"^\s*\d+\s*-\s*\d+\s*$"),
                )
                .order_by(BillAction.action_number.asc())
            ).all()
        )
        if not actions:
            groups["unchanged"].append(
                VoteReconciliationItem(
                    bill_key,
                    None,
                    None,
                    "unchanged",
                    "no current roll-call action",
                )
            )
            continue
        for action in actions:
            chamber = db.get(Chamber, action.chamber_id) if action.chamber_id else None
            if chamber is None:
                groups["rejected"].append(
                    VoteReconciliationItem(
                        bill_key,
                        None,
                        action.action_number,
                        "rejected",
                        "roll-call action has no chamber",
                    )
                )
                continue
            if leading_chamber(action.action_text) not in (None, chamber.slug):
                groups["unchanged"].append(
                    VoteReconciliationItem(
                        bill_key,
                        None,
                        action.action_number,
                        "unchanged",
                        "cross-chamber copy is preserved without a second vote",
                    )
                )
                continue
            events = list(
                db.scalars(
                    select(VoteEvent)
                    .where(VoteEvent.bill_action_id == action.id)
                    .order_by(VoteEvent.id.asc())
                ).all()
            )
            if len(events) > 1:
                groups["rejected"].append(
                    VoteReconciliationItem(
                        bill_key,
                        None,
                        action.action_number,
                        "rejected",
                        f"bill action has {len(events)} saved roll calls",
                    )
                )
                continue
            event = events[0] if events else None
            selected_work.append((bill, action, chamber, event))
            seen_action_ids.add(action.id)
            if event is not None:
                seen_event_ids.add(event.id)

    for event_id in _sweep_event_ids(db, limit=safety_sweep_limit, now=now):
        if event_id not in seen_event_ids:
            event = db.get(VoteEvent, event_id)
            if event is None or event.bill_action_id in seen_action_ids:
                continue
            bill = db.get(Bill, event.bill_id)
            action = db.get(BillAction, event.bill_action_id)
            chamber = db.get(Chamber, event.chamber_id)
            if bill is None or action is None or chamber is None:
                groups["rejected"].append(
                    VoteReconciliationItem(
                        getattr(bill, "bill_key", str(event.bill_id)),
                        str(event.id),
                        getattr(action, "action_number", None),
                        "rejected",
                        "saved roll call is not linked to a complete bill action",
                    )
                )
                continue
            selected_work.append((bill, action, chamber, event))
            seen_event_ids.add(event_id)
            seen_action_ids.add(action.id)

    house_cache: dict[str, list[ParsedVote]] = {}
    senate_cache: dict[str, Any] = {}
    legislator_indexes: dict[
        tuple[Any, Any], dict[tuple[str, tuple[str, ...]], list[Any]]
    ] = {}

    for bill, action, chamber, event in selected_work:
        item_args = (
            bill.bill_key,
            str(event.id) if event is not None else None,
            action.action_number,
        )
        try:
            parsed_vote = _source_vote_for_action(
                action,
                bill,
                chamber,
                source_session=source_session,
                house_cache=house_cache,
                senate_cache=senate_cache,
                saved_event=event,
            )
        except Exception as exc:  # noqa: BLE001
            groups["failed"].append(
                VoteReconciliationItem(
                    *item_args,
                    "failed",
                    f"source read failed: {type(exc).__name__}: {exc}",
                )
            )
            continue
        if parsed_vote is None:
            groups["rejected"].append(
                VoteReconciliationItem(
                    *item_args, "rejected", "official roll call did not match uniquely"
                )
            )
            continue
        validated, rejection = _validate_complete_vote(
            db,
            parsed_vote=parsed_vote,
            action=action,
            bill=bill,
            chamber=chamber,
            legislator_indexes=legislator_indexes,
        )
        if validated is None:
            groups["rejected"].append(
                VoteReconciliationItem(*item_args, "rejected", rejection)
            )
            continue
        saved_records = (
            list(
                db.scalars(
                    select(VoteRecord)
                    .where(VoteRecord.vote_event_id == event.id)
                    .order_by(VoteRecord.sort_order.asc())
                ).all()
            )
            if event is not None
            else []
        )
        if event is not None and _saved_vote_signature(
            event, saved_records
        ) == _validated_vote_signature(validated):
            groups["unchanged"].append(VoteReconciliationItem(*item_args, "unchanged"))
            continue
        if dry_run:
            groups["updated"].append(
                VoteReconciliationItem(
                    *item_args, "updated", "dry run; no rows written"
                )
            )
            continue

        old_legislator_ids = {record.legislator_id for record in saved_records}
        new_legislator_ids = {record[0] for record in validated.records}
        try:
            with db.begin_nested():
                if event is None:
                    event = VoteEvent(
                        bill_id=bill.id,
                        bill_action_id=action.id,
                        chamber_id=chamber.id,
                        yes_count=validated.yes_count,
                        no_count=validated.no_count,
                    )
                    db.add(event)
                    db.flush()
                event.motion_text = validated.motion_text
                event.result_text = validated.result_text
                event.occurred_at = validated.occurred_at
                event.official_url = validated.official_url
                event.yes_count = validated.yes_count
                event.no_count = validated.no_count
                _replace_vote_records(db, event, validated.records)
                db.flush()
                _refresh_vote_counts(
                    db,
                    bill_id=bill.id,
                    session_id=bill.session_id,
                    affected_legislator_ids=old_legislator_ids | new_legislator_ids,
                )
            db.commit()
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            groups["failed"].append(
                VoteReconciliationItem(
                    *item_args,
                    "failed",
                    f"atomic replacement failed: {type(exc).__name__}: {exc}",
                )
            )
            continue
        groups["updated"].append(
            VoteReconciliationItem(
                bill.bill_key,
                str(event.id),
                action.action_number,
                "updated",
            )
        )

    return VoteReconciliationReport(
        updated=tuple(groups["updated"]),
        unchanged=tuple(groups["unchanged"]),
        rejected=tuple(groups["rejected"]),
        failed=tuple(groups["failed"]),
    )


def backfill_votes(
    db: Session,
    *,
    limit: int | None,
    dry_run: bool,
    only_missing: bool = False,
    bill: str | None = None,
    source_session: Any | None = None,
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
        "cross_chamber_mirror": 0,
    }
    house_cache: dict[str, list[ParsedVote]] = {}
    senate_cache: dict[str, Any] = {}
    legislator_indexes: dict[
        tuple[Any, Any], dict[tuple[str, tuple[str, ...]], list[Any]]
    ] = {}

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

            # Cross-chamber mirror: one chamber's journal records the other
            # chamber's conference-committee repassage as an action on this bill
            # (e.g. "Senate adopted conference committee report, bill repassed"
            # under the House side). The member-level roll call is ingested from
            # the acting chamber's own action, so skip the mirror -- ingesting it
            # would double-count an already-recorded roll call.
            if leading_chamber(action.action_text) not in (None, chamber.slug):
                stats["cross_chamber_mirror"] += 1
                continue

            parsed_vote = _source_vote_for_action(
                action,
                bill,
                chamber,
                source_session=source_session,
                house_cache=house_cache,
                senate_cache=senate_cache,
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

            index_key = (chamber.id, bill.session_id)
            if index_key not in legislator_indexes:
                legislator_indexes[index_key] = build_legislator_index(
                    db, chamber.id, bill.session_id
                )
            index = legislator_indexes[index_key]
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


def write_json_report(path: Path, payload: dict[str, Any]) -> None:
    """Replace a machine-readable report only after its full JSON is ready."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
        delete=False,
    ) as handle:
        temporary = Path(handle.name)
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")
    temporary.replace(path)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Backfill structured vote events and vote records from official roll-call sources."
    )
    parser.add_argument(
        "--database-url",
        default=os.environ.get("DATABASE_URL"),
    )
    parser.add_argument(
        "--target",
        choices=("local", "production"),
        default=None,
        help="Name the database for a saved-vote check: local or production.",
    )
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--write",
        action="store_true",
        help="Write saved-vote corrections. Without this, reconciliation is read-only.",
    )
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
    parser.add_argument(
        "--bill-key",
        action="append",
        default=[],
        help=(
            "Recheck saved roll calls for one exact stored bill key. Repeat for "
            "several keys, e.g. --bill-key 94-2025-HF1141."
        ),
    )
    parser.add_argument(
        "--safety-sweep-limit",
        type=int,
        default=0,
        help="Recheck this many saved roll calls in the deterministic daily sweep.",
    )
    parser.add_argument(
        "--report-path",
        type=Path,
        default=None,
        help="Atomically save the reconciliation report as JSON.",
    )
    args = parser.parse_args(argv)
    reconciliation_requested = bool(args.bill_key or args.safety_sweep_limit)
    if reconciliation_requested and args.target is None:
        parser.error("saved-vote reconciliation requires --target local or production")
    if args.write and args.dry_run:
        parser.error("--write and --dry-run cannot be combined")
    if args.write and not reconciliation_requested:
        parser.error("--write is only used by saved-vote reconciliation")
    database_url = (
        database_url_for_target(args.target, args.database_url)
        if args.target is not None
        else normalize_database_url(
            args.database_url or supabase_database_url() or get_database_url()
        )
    )
    engine = create_engine(
        database_url,
        pool_pre_ping=True,
        connect_args=NO_PREPARED_STATEMENTS,
    )
    with Session(engine) as db:
        if reconciliation_requested:
            if args.only_missing or args.bill:
                raise SystemExit(
                    "saved-vote reconciliation cannot be combined with --only-missing or --bill"
                )
            if args.safety_sweep_limit < 0:
                raise SystemExit("--safety-sweep-limit cannot be negative")
            report = reconcile_saved_votes(
                db,
                bill_keys=args.bill_key,
                safety_sweep_limit=args.safety_sweep_limit,
                dry_run=not args.write,
                source_session=rate_limited_source_session(engine, target=args.target),
            )
            payload = {
                "target": args.target,
                "write": args.write,
                **report.to_dict(),
            }
            print(json.dumps(payload, indent=2, sort_keys=True))
            if args.report_path is not None:
                write_json_report(args.report_path, payload)
            if report.rejected or report.failed:
                return 1
        else:
            if args.report_path is not None:
                parser.error("--report-path is only used by saved-vote reconciliation")
            stats = backfill_votes(
                db,
                limit=args.limit,
                dry_run=args.dry_run,
                only_missing=args.only_missing,
                bill=args.bill,
            )
            print(stats)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
