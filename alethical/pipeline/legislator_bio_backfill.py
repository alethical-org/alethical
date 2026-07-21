#!/usr/bin/env python3
"""Backfill legislator elected/term and biography from official member pages.

For each CURRENT legislator service period, fetch its stored ``profile_url``
(the official House ``.../members/profile/{id}`` or Senate
``member_bio.php?leg_id={id}`` page) and parse:

* ``elected`` -- verbatim value after "Elected:" (e.g. "2020, re-elected 2022").
* ``term`` -- verbatim value after "Term:" (e.g. "2nd").
* biography -- House: a clean prose bio assembled from the VERBATIM
  Occupation / Education / Family biographical fields. Senate: the page's
  descriptive Biographical Details prose if present. Grounded-answers: only
  what the page states -- no facts are invented, and missing content stays null.

``elected`` / ``term`` are written onto the current LegislatorServicePeriod;
``biography`` onto the Legislator. Per-record commit, idempotent, robust to a
member page missing any field. Mirrors the flags/structure of
``alethical/pipeline/votes.py``.

Run money-free (no LLM / paid APIs) against production with:

    ALETHICAL_DATABASE_TARGET=production \\
        uv run python -m alethical.pipeline.legislator_bio_backfill --write
"""

from __future__ import annotations

import argparse
import html as htmllib
import os
import re
import time
from dataclasses import dataclass

import requests
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from alethical.db import models as schema
from alethical.db.session import (
    NO_PREPARED_STATEMENTS,
    database_url_for_target,
    normalize_database_url,
)

Chamber = schema.Chamber
Legislator = schema.Legislator
LegislatorServicePeriod = schema.LegislatorServicePeriod

TIMEOUT_SECONDS = 30
MAX_RETRIES = 3
USER_AGENT = "Alethical Bio Backfill/0.1"

# Ordered set of House "Biographical Information" fields folded into the prose
# bio (Elected/Term are captured separately into their own columns). Kept
# explicit and small so the bio is predictable and stays grounded.
HOUSE_BIO_FIELDS = ("Occupation", "Education", "Family")


@dataclass(frozen=True)
class ParsedBio:
    elected: str | None
    term: str | None
    biography: str | None


@dataclass
class BackfillStats:
    service_periods_seen: int = 0
    profiles_fetched: int = 0
    elected_parsed: int = 0
    term_parsed: int = 0
    biography_parsed: int = 0
    no_profile_url: int = 0
    fetch_errors: int = 0
    written: int = 0


def normalize_space(value: str) -> str:
    value = htmllib.unescape(value)
    value = re.sub(r"<br\s*/?>", " ", value, flags=re.I)
    value = re.sub(r"<[^>]+>", " ", value)
    return re.sub(r"\s+", " ", value.replace("\xa0", " ")).strip()


def strip_comments(html_text: str) -> str:
    """Drop HTML comments so we never parse commented-out markup as content.

    The Senate member pages frequently ship their "Biographical Details" block
    commented out (``<!-- <h4>Biographical Details:</h4> -->``); without this a
    naive match captures comment artifacts (``--> <!--``) as a bogus bio."""
    return re.sub(r"<!--.*?-->", "", html_text, flags=re.S)


def fetch_text(sess: requests.Session, url: str) -> str:
    last_error: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = sess.get(url, timeout=TIMEOUT_SECONDS)
            if (
                response.status_code in {429, 500, 502, 503, 504}
                and attempt < MAX_RETRIES
            ):
                time.sleep(0.5 * attempt)
                continue
            response.raise_for_status()
            return response.text
        except requests.RequestException as exc:
            last_error = exc
            if attempt == MAX_RETRIES:
                break
            time.sleep(0.5 * attempt)
    raise RuntimeError(f"Failed to fetch {url}: {last_error}")


def extract_labeled(html_text: str, label: str) -> str | None:
    """Verbatim value after ``<strong>Label:</strong>`` up to the next tag.

    Both the House "Biographical Information" list and the Senate "Legislative
    Service" table use this ``<strong>Elected:</strong> value`` /
    ``<strong>Term:</strong> value`` shape, so one extractor serves both."""
    match = re.search(
        r"<strong>\s*" + re.escape(label) + r"\s*:\s*</strong>\s*([^<]*)",
        html_text,
        flags=re.I,
    )
    if not match:
        return None
    value = normalize_space(match.group(1))
    return value or None


def bio_sentence(label: str, value: str) -> str:
    """Turn a verbatim ``<Label>: value`` field into one label-free sentence.

    Handles two source quirks seen on House member pages without inventing any
    content (grounded-neutrality — only case and punctuation are touched):

    * A redundant leading label embedded in the value itself. Ned Carroll's
      Family ``<li>`` renders as ``<strong>Family:</strong> Family: married, 3
      children.`` -- the ``Family:`` prefix would be duplicated once we drop the
      visible labels, so strip it and capitalize the now-leading word so the
      value still reads as a sentence. This fires only for the abnormal
      embedded-label case, leaving cleanly-authored values (which start with a
      capital already) untouched.
    * A value that already ends in a period; collapse so appending our own
      cannot produce ``..``.
    """
    stripped = re.sub(rf"^{re.escape(label)}\s*:\s*", "", value, flags=re.I)
    if stripped and stripped != value:
        stripped = stripped[0].upper() + stripped[1:]
    return re.sub(r"\.+$", ".", f"{stripped.strip()}.")


def parse_house_bio(html_text: str) -> ParsedBio:
    elected = extract_labeled(html_text, "Elected")
    term = extract_labeled(html_text, "Term")

    block_match = re.search(
        r"<h4>\s*Biographical Information:\s*</h4>\s*<ul[^>]*>(.*?)</ul>",
        html_text,
        flags=re.I | re.S,
    )
    fields: dict[str, str] = {}
    if block_match:
        for li_match in re.finditer(
            r"<li[^>]*>(.*?)</li>", block_match.group(1), flags=re.I | re.S
        ):
            label_match = re.search(
                r"<strong>\s*(.*?)\s*:\s*</strong>\s*(.*)",
                li_match.group(1),
                flags=re.I | re.S,
            )
            if label_match:
                key = normalize_space(label_match.group(1))
                value = normalize_space(label_match.group(2))
                if value:
                    fields[key] = value

    # Label-free prose to match the profile design (e.g. "Business owner. B.A.,
    # …. Married, spouse Doug, 6 children."), not "Occupation: … Education: …".
    # Values stay VERBATIM from the source — only the field labels are dropped,
    # so nothing is fabricated (grounded-neutrality).
    sentences = [
        bio_sentence(field, fields[field])
        for field in HOUSE_BIO_FIELDS
        if fields.get(field)
    ]
    biography = " ".join(sentences) or None
    return ParsedBio(elected=elected, term=term, biography=biography)


def parse_senate_bio(html_text: str) -> ParsedBio:
    elected = extract_labeled(html_text, "Elected")
    term = extract_labeled(html_text, "Term")

    # The Senate "Biographical Details" prose is frequently commented out or
    # absent; parse it only when the section is genuinely present and carries
    # text (grounded-answers: never fabricate a bio the page does not show).
    biography = None
    detail_match = re.search(
        r"<h4>\s*Biographical Details:\s*</h4>\s*(.*?)</div>",
        html_text,
        flags=re.I | re.S,
    )
    if detail_match:
        text = normalize_space(detail_match.group(1))
        if text:
            biography = text
    return ParsedBio(elected=elected, term=term, biography=biography)


def parse_bio(html_text: str, profile_url: str, chamber_slug: str) -> ParsedBio:
    cleaned = strip_comments(html_text)
    if chamber_slug == "house" or "house.mn.gov" in profile_url:
        return parse_house_bio(cleaned)
    return parse_senate_bio(cleaned)


def current_service_rows(
    db: Session, *, only_missing: bool, legislator: str | None
) -> list[tuple[LegislatorServicePeriod, Legislator, str]]:
    stmt = (
        select(LegislatorServicePeriod, Legislator, Chamber.slug)
        .join(Legislator, Legislator.id == LegislatorServicePeriod.legislator_id)
        .join(Chamber, Chamber.id == LegislatorServicePeriod.chamber_id)
        .where(
            LegislatorServicePeriod.is_current.is_(True),
            LegislatorServicePeriod.profile_url.is_not(None),
        )
        .order_by(Chamber.slug, Legislator.sort_name)
    )
    if only_missing:
        stmt = stmt.where(
            LegislatorServicePeriod.elected.is_(None),
            LegislatorServicePeriod.term.is_(None),
        )
    if legislator:
        stmt = stmt.where(_legislator_filter(legislator))
    return [
        (period, leg, str(chamber_slug))
        for period, leg, chamber_slug in db.execute(stmt).all()
    ]


def _legislator_filter(legislator: str):
    """Match --legislator against the legislator id (UUID) or a name substring."""
    if re.fullmatch(
        r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
        legislator,
        flags=re.I,
    ):
        return Legislator.id == legislator
    return Legislator.full_name.ilike(f"%{legislator}%")


def backfill(
    db: Session,
    *,
    dry_run: bool,
    only_missing: bool,
    limit: int | None,
    legislator: str | None,
) -> BackfillStats:
    stats = BackfillStats()
    rows = current_service_rows(db, only_missing=only_missing, legislator=legislator)
    if limit is not None:
        rows = rows[:limit]

    sess = requests.Session()
    sess.headers.update({"User-Agent": USER_AGENT})

    for period, legislator_row, chamber_slug in rows:
        stats.service_periods_seen += 1
        profile_url = period.profile_url
        if not profile_url:
            stats.no_profile_url += 1
            continue
        try:
            html_text = fetch_text(sess, profile_url)
        except Exception as exc:  # noqa: BLE001
            stats.fetch_errors += 1
            print(f"fetch error: {legislator_row.full_name} {profile_url}: {exc}")
            continue
        stats.profiles_fetched += 1

        parsed = parse_bio(html_text, profile_url, chamber_slug)
        if parsed.elected:
            stats.elected_parsed += 1
        if parsed.term:
            stats.term_parsed += 1
        if parsed.biography:
            stats.biography_parsed += 1

        print(
            f"[{chamber_slug}] {legislator_row.full_name}: "
            f"elected={parsed.elected!r} term={parsed.term!r}"
        )
        if parsed.biography:
            print(f"    bio: {parsed.biography}")

        if dry_run:
            continue

        # Per-record commit isolates a write failure to its own row (leaving it
        # to be retried on a re-run) rather than crashing the whole backfill.
        try:
            period.elected = parsed.elected
            period.term = parsed.term
            if parsed.biography:
                legislator_row.biography = parsed.biography
            db.commit()
            stats.written += 1
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            print(f"write error: {legislator_row.full_name}: {exc}")

    return stats


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Backfill legislator elected/term and biography from official "
            "member pages (money-free, idempotent)."
        )
    )
    parser.add_argument(
        "--database-url",
        default=None,
        help="Explicit DB URL; otherwise ALETHICAL_DATABASE_TARGET selects it.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Parse + print only.")
    parser.add_argument("--write", action="store_true", help="Commit parsed values.")
    parser.add_argument(
        "--only-missing",
        action="store_true",
        help="Only service periods whose elected AND term are still null.",
    )
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument(
        "--legislator",
        default=None,
        help="Restrict to one legislator by id (UUID) or name substring.",
    )
    args = parser.parse_args()

    if not args.dry_run and not args.write:
        raise SystemExit("Pass --dry-run to preview or --write to commit.")

    url = database_url_for_target(
        os.environ.get("ALETHICAL_DATABASE_TARGET"), args.database_url
    )
    engine = create_engine(
        normalize_database_url(url),
        pool_pre_ping=True,
        connect_args=NO_PREPARED_STATEMENTS,
    )
    with Session(engine) as db:
        stats = backfill(
            db,
            dry_run=args.dry_run,
            only_missing=args.only_missing,
            limit=args.limit,
            legislator=args.legislator,
        )
    print(stats)


if __name__ == "__main__":
    main()
