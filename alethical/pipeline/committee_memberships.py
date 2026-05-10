#!/usr/bin/env python3
from __future__ import annotations

import argparse
import html
import os
import re
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urljoin

import requests
from sqlalchemy import create_engine, delete, func, select
from sqlalchemy.orm import Session

from alethical.db import models as schema
from alethical.db.session import get_database_url, normalize_database_url


Chamber = schema.Chamber
Committee = schema.Committee
CommitteeMembership = schema.CommitteeMembership
LegislativeSession = schema.LegislativeSession
Legislator = schema.Legislator
LegislatorServicePeriod = schema.LegislatorServicePeriod
LegislatorStats = schema.LegislatorStats
Sponsorship = schema.Sponsorship
VoteRecord = schema.VoteRecord

TIMEOUT_SECONDS = 30
MAX_RETRIES = 3
USER_AGENT = "Alethical Committee Backfill/0.1"


@dataclass(frozen=True)
class CommitteeAssignment:
    name: str
    role: str | None
    code: str | None
    profile_url: str | None


@dataclass
class BackfillStats:
    legislators_seen: int = 0
    profiles_fetched: int = 0
    committees_upserted: int = 0
    memberships_upserted: int = 0
    profiles_without_assignments: int = 0
    orphan_legislators_deleted: int = 0


def supabase_database_url() -> str | None:
    project_url = os.environ.get("SUPABASE_PROJECT_URL")
    password = os.environ.get("SUPABASE_DB_PASSWORD")
    if not project_url or not password:
        return None
    project_ref = re.sub(r"^https?://([^.]+).*$", r"\1", project_url)
    return f"postgresql+psycopg://postgres:{password}@db.{project_ref}.supabase.co:5432/postgres?sslmode=require"


def normalize_space(value: str) -> str:
    value = html.unescape(value)
    value = re.sub(r"<br\s*/?>", " ", value, flags=re.I)
    value = re.sub(r"<[^>]+>", " ", value)
    return re.sub(r"\s+", " ", value.replace("\xa0", " ")).strip()


def fetch_text(sess: requests.Session, url: str) -> str:
    last_error: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = sess.get(url, timeout=TIMEOUT_SECONDS)
            if response.status_code in {429, 500, 502, 503, 504} and attempt < MAX_RETRIES:
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


def assignment_block(html_text: str) -> str:
    match = re.search(r"<h4>\s*Committee Assignments:\s*</h4>\s*<ul\b[^>]*>(.*?)</ul>", html_text, flags=re.I | re.S)
    return match.group(1) if match else ""


def parse_committee_assignments(html_text: str, source_url: str, chamber_slug: str) -> list[CommitteeAssignment]:
    block = assignment_block(html_text)
    if not block:
        return []

    assignments: list[CommitteeAssignment] = []
    seen: set[tuple[str, str | None]] = set()
    for li_match in re.finditer(r"<li\b[^>]*>(.*?)</li>", block, flags=re.I | re.S):
        li_html = li_match.group(1)
        role = normalize_space(role_match.group(1)) if (role_match := re.search(r"<strong[^>]*>(.*?)</strong>", li_html, flags=re.I | re.S)) else None
        link_match = re.search(r"<a\b[^>]*href=['\"]([^'\"]+)['\"][^>]*>(.*?)</a>", li_html, flags=re.I | re.S)
        if not link_match:
            continue

        href, label_html = link_match.groups()
        name = normalize_space(label_html)
        if not name:
            continue

        profile_url = urljoin(source_url, href)
        code = None
        if chamber_slug == "house":
            code_match = re.search(r"[?&]comm=(\d+)", profile_url)
        else:
            code_match = re.search(r"[?&]cmte_id=(\d+)", profile_url)
        if code_match:
            code = code_match.group(1)

        key = (name, role)
        if key in seen:
            continue
        seen.add(key)
        assignments.append(CommitteeAssignment(name=name, role=role, code=code, profile_url=profile_url))
    return assignments


def current_legislator_rows(db: Session, session_id: Any) -> list[tuple[Any, Any, str]]:
    rows = db.execute(
        select(Legislator, Chamber, LegislatorServicePeriod.profile_url)
        .join(LegislatorServicePeriod, LegislatorServicePeriod.legislator_id == Legislator.id)
        .join(Chamber, Chamber.id == LegislatorServicePeriod.chamber_id)
        .where(
            LegislatorServicePeriod.session_id == session_id,
            LegislatorServicePeriod.is_current.is_(True),
            LegislatorServicePeriod.profile_url.is_not(None),
        )
        .order_by(Chamber.slug, Legislator.sort_name)
    ).all()

    deduped: dict[tuple[Any, str], tuple[Any, Any, str]] = {}
    for legislator, chamber, profile_url in rows:
        if not profile_url:
            continue
        deduped[(legislator.id, chamber.slug)] = (legislator, chamber, str(profile_url))
    return list(deduped.values())


def clear_current_memberships(db: Session, session_id: Any) -> None:
    committee_ids = db.scalars(select(Committee.id).where(Committee.session_id == session_id)).all()
    if committee_ids:
        db.execute(delete(CommitteeMembership).where(CommitteeMembership.committee_id.in_(committee_ids)))


def cleanup_orphan_legislators(db: Session) -> int:
    orphan_ids = db.scalars(
        select(Legislator.id).where(
            ~select(Sponsorship.id).where(Sponsorship.legislator_id == Legislator.id).exists(),
            ~select(VoteRecord.id).where(VoteRecord.legislator_id == Legislator.id).exists(),
            ~select(CommitteeMembership.id).where(CommitteeMembership.legislator_id == Legislator.id).exists(),
        )
    ).all()
    if not orphan_ids:
        return 0
    db.execute(delete(LegislatorStats).where(LegislatorStats.legislator_id.in_(orphan_ids)))
    db.execute(delete(LegislatorServicePeriod).where(LegislatorServicePeriod.legislator_id.in_(orphan_ids)))
    db.execute(delete(Legislator).where(Legislator.id.in_(orphan_ids)))
    return len(orphan_ids)


def upsert_assignment(db: Session, session_id: Any, chamber: Any, legislator: Any, assignment: CommitteeAssignment) -> bool:
    committee = db.scalar(
        select(Committee).where(
            Committee.session_id == session_id,
            Committee.chamber_id == chamber.id,
            Committee.name == assignment.name,
        )
    )
    created_committee = False
    if committee is None:
        committee = Committee(
            session_id=session_id,
            chamber_id=chamber.id,
            name=assignment.name,
            code=assignment.code,
            profile_url=assignment.profile_url,
        )
        db.add(committee)
        db.flush()
        created_committee = True
    else:
        committee.code = committee.code or assignment.code
        committee.profile_url = committee.profile_url or assignment.profile_url

    membership = db.scalar(
        select(CommitteeMembership).where(
            CommitteeMembership.committee_id == committee.id,
            CommitteeMembership.legislator_id == legislator.id,
            CommitteeMembership.role == assignment.role if assignment.role is not None else CommitteeMembership.role.is_(None),
        )
    )
    if membership is None:
        membership = CommitteeMembership(
            committee_id=committee.id,
            legislator_id=legislator.id,
            role=assignment.role,
            is_current=True,
        )
        db.add(membership)
    else:
        membership.is_current = True
    return created_committee


def refresh_committee_stats(db: Session, session_id: Any) -> None:
    legislators = db.scalars(select(Legislator)).all()
    for legislator in legislators:
        stats = db.scalar(
            select(LegislatorStats).where(
                LegislatorStats.legislator_id == legislator.id,
                LegislatorStats.session_id == session_id,
            )
        )
        if stats is None:
            stats = LegislatorStats(legislator_id=legislator.id, session_id=session_id)
            db.add(stats)
        stats.committee_count = db.scalar(
            select(func.count(CommitteeMembership.id)).where(
                CommitteeMembership.legislator_id == legislator.id,
                CommitteeMembership.is_current.is_(True),
            )
        ) or 0


def backfill(db: Session, *, dry_run: bool, cleanup_orphans: bool) -> BackfillStats:
    current_session = db.scalar(select(LegislativeSession).where(LegislativeSession.is_current.is_(True)))
    if current_session is None:
        raise RuntimeError("No current legislative session found")

    stats = BackfillStats()
    if cleanup_orphans:
        stats.orphan_legislators_deleted = cleanup_orphan_legislators(db)

    clear_current_memberships(db, current_session.id)

    sess = requests.Session()
    sess.headers.update({"User-Agent": USER_AGENT})
    for legislator, chamber, profile_url in current_legislator_rows(db, current_session.id):
        if chamber.slug not in {"house", "senate"}:
            continue
        stats.legislators_seen += 1
        html_text = fetch_text(sess, profile_url)
        stats.profiles_fetched += 1
        assignments = parse_committee_assignments(html_text, profile_url, chamber.slug)
        if not assignments:
            stats.profiles_without_assignments += 1
            continue
        for assignment in assignments:
            if upsert_assignment(db, current_session.id, chamber, legislator, assignment):
                stats.committees_upserted += 1
            stats.memberships_upserted += 1

    refresh_committee_stats(db, current_session.id)

    if dry_run:
        db.rollback()
    else:
        db.commit()
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill current Minnesota committee memberships from member profile pages.")
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL") or supabase_database_url() or get_database_url())
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--cleanup-orphans", action="store_true", help="Delete duplicate legislators with no sponsorship, vote, or committee references.")
    args = parser.parse_args()

    if not args.database_url:
        raise SystemExit("DATABASE_URL or Supabase env vars are required")

    engine = create_engine(normalize_database_url(args.database_url), pool_pre_ping=True)
    with Session(engine) as db:
        stats = backfill(db, dry_run=args.dry_run, cleanup_orphans=args.cleanup_orphans)
    print(stats)


if __name__ == "__main__":
    main()
