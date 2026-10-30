"""A directory of held public people, candidacies and legislative service records.

Record kinds stay separate, even when their names are equal. Service dates are
those held for the person, never legislative-session dates. No private claims,
addresses, emails or account records are read.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import (
    Integer,
    String,
    case,
    cast,
    extract,
    func,
    literal,
    or_,
    select,
    union_all,
)
from sqlalchemy.orm import Session, selectinload

from alethical.api.services.campaign_finance_search import name_contains
from alethical.db import models as m

PeopleType = Literal["all", "candidates", "legislators", "persons"]
PeopleScope = Literal["all", "past"]
PeopleSort = Literal["name", "election_year"]
Service = Literal["current", "former"]


def directory(
    db: Session,
    *,
    query: str = "",
    type: PeopleType = "all",
    scope: PeopleScope = "all",
    year: int | None = None,
    service: Service | None = None,
    sort: PeopleSort = "name",
    limit: int = 50,
    offset: int = 0,
) -> dict:
    now = datetime.now(UTC)
    today = now.astimezone(ZoneInfo("America/Chicago")).date()
    candidate, person, member, period, session = (
        m.CandidateRecord,
        m.PublicPerson,
        m.Legislator,
        m.LegislatorServicePeriod,
        m.LegislativeSession,
    )
    current = (
        select(1)
        .select_from(period)
        .join(session, session.id == period.session_id)
        .where(
            period.legislator_id == member.id,
            period.is_current,
            session.is_current,
            session.year_start <= today.year,
            session.year_end >= today.year,
            or_(period.start_date.is_(None), period.start_date <= today),
            or_(period.end_date.is_(None), period.end_date >= today),
        )
        .exists()
    )
    ended = (
        select(1)
        .where(period.legislator_id == member.id, period.end_date < today)
        .exists()
    )
    status = case((current, "current"), (ended, "former"), else_="unknown")
    # Every branch has the same small sort/filter shape; full payloads are read
    # only for the selected page, so a directory never loads all profile details.
    candidates = select(
        literal("candidate").label("kind"),
        candidate.id.label("id"),
        candidate.public_payload["candidate"]["name"].astext.label("name"),
        cast(extract("year", candidate.election_date), Integer).label("year"),
        candidate.election_date.label("election_date"),
        literal(None, String).label("service_status"),
    )
    people = select(
        literal("person"),
        cast(person.id, String),
        person.name,
        literal(None, Integer),
        literal(None, candidate.election_date.type),
        literal(None, String),
    )
    members = select(
        literal("legislator"),
        cast(member.id, String),
        member.full_name,
        literal(None, Integer),
        literal(None, candidate.election_date.type),
        status,
    )
    rows = union_all(candidates, people, members).subquery()
    where = []
    if query.strip():
        where.append(name_contains(rows.c.name, query.strip()))
    if type != "all":
        where.append(
            rows.c.kind
            == {
                "candidates": "candidate",
                "persons": "person",
                "legislators": "legislator",
            }[type]
        )
    if type == "candidates":
        if scope == "past":
            where.append(rows.c.election_date < today)
        if year is not None:
            where.append(rows.c.year == year)
    if type == "legislators" and service is not None:
        where.append(rows.c.service_status == service)
    counts = {"person": 0, "candidate": 0, "legislator": 0}
    counts.update(
        {
            kind: count
            for kind, count in db.execute(
                select(rows.c.kind, func.count()).where(*where).group_by(rows.c.kind)
            )
        }
    )
    total = sum(counts.values())
    order = (
        (rows.c.year.desc().nulls_last(),)
        if type == "candidates" and sort == "election_year"
        else ()
    )
    selected = db.execute(
        select(rows)
        .where(*where)
        .order_by(
            *order, rows.c.name, rows.c.kind, rows.c.year.desc().nulls_last(), rows.c.id
        )
        .limit(limit)
        .offset(offset)
    ).all()
    candidate_ids = [row.id for row in selected if row.kind == "candidate"]
    member_ids = [UUID(row.id) for row in selected if row.kind == "legislator"]
    profiles = (
        {
            row.id: row
            for row in db.scalars(
                select(candidate).where(candidate.id.in_(candidate_ids))
            )
        }
        if candidate_ids
        else {}
    )
    legislators = (
        {
            str(row.id): row
            for row in db.scalars(
                select(member)
                .where(member.id.in_(member_ids))
                .options(
                    selectinload(member.service_periods).selectinload(period.chamber),
                    selectinload(member.service_periods).selectinload(period.district),
                    selectinload(member.service_periods).selectinload(period.session),
                )
            )
        }
        if member_ids
        else {}
    )
    result = []
    for row in selected:
        item = {"kind": row.kind, "id": row.id, "name": row.name}
        if row.kind == "candidate":
            held = profiles[row.id]
            profile = held.public_payload
            source = dict(profile.get("source") or {})
            if not source.get("retained") and now - held.checked_at > timedelta(
                hours=24
            ):
                source["stale"] = True
            item.update(
                year=row.year,
                election=profile.get("election"),
                office=profile.get("office"),
                voting_area=profile.get("votingArea"),
                source=source,
            )
        elif row.kind == "legislator":
            held = legislators[row.id]
            item.update(
                slug=held.slug,
                service_status=row.service_status,
                periods=[
                    {
                        "chamber": p.chamber.chamber_type.value,
                        "district": p.district.code,
                        "party": p.party,
                        "start_date": p.start_date,
                        "end_date": p.end_date,
                        "session": p.session.slug,
                        "source_url": p.profile_url,
                    }
                    for p in sorted(
                        held.service_periods,
                        key=lambda p: (p.session.year_start, p.period_sequence),
                        reverse=True,
                    )
                ],
            )
        result.append(item)
    years = list(
        db.scalars(
            select(cast(extract("year", candidate.election_date), Integer))
            .distinct()
            .order_by(cast(extract("year", candidate.election_date), Integer).desc())
        )
    )
    return {
        "state": "reported" if total else "not_reported",
        "rows": result,
        "total": total,
        "counts": counts,
        "has_more": offset + len(result) < total,
        "limit": limit,
        "offset": offset,
        "years": years,
        "q": query,
        "type": type,
        "scope": scope,
        "year": year,
        "service": service,
        "sort": sort,
    }
