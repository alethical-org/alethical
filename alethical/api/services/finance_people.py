"""A directory of held public people, candidacies and legislative service records.

Record kinds stay separate, even when their names are equal. Service dates are
those held for the person, never legislative-session dates. No private claims,
addresses, emails or account records are read.
"""

from __future__ import annotations

import re
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
from alethical.api.services.finance_name_matching import discovery_match
from alethical.db import models as m

PeopleType = Literal["all", "candidates", "legislators", "persons"]
PeopleScope = Literal["all", "past"]
PeopleSort = Literal["name", "election_year"]
Service = Literal["current", "former"]
Chamber = Literal["house", "senate"]


def read_time() -> datetime:
    """One clock reading shared by the page and its membership version."""
    return datetime.now(UTC)


def directory(
    db: Session,
    *,
    query: str = "",
    type: PeopleType = "all",
    scope: PeopleScope = "all",
    year: int | None = None,
    service: Service | None = None,
    party: str | None = None,
    office: str | None = None,
    chamber: Chamber | None = None,
    sort: PeopleSort = "name",
    limit: int = 50,
    offset: int = 0,
    now: datetime | None = None,
) -> dict:
    now = now or read_time()
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
    # A previous term ending cannot establish that a later term also ended.
    # Use the latest held personal period; missing dates remain unknown.
    held_periods = (
        select(
            period.legislator_id,
            period.end_date,
            session.year_start,
            func.max(session.year_start)
            .over(partition_by=period.legislator_id)
            .label("latest_year"),
            func.row_number()
            .over(
                partition_by=(period.legislator_id, period.session_id),
                order_by=period.period_sequence.desc(),
            )
            .label("session_position"),
        )
        .join(session, session.id == period.session_id)
        .subquery()
    )
    ended = (
        select(func.bool_and(func.coalesce(held_periods.c.end_date < today, False)))
        .where(
            held_periods.c.legislator_id == member.id,
            held_periods.c.year_start == held_periods.c.latest_year,
            held_periods.c.session_position == 1,
        )
        .correlate(member)
        .scalar_subquery()
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
    typed = query.strip()
    # Only a complete district expression changes interpretation. Ordinary name
    # queries retain their literal spelling, including the word "District".
    district_query = re.fullmatch(
        r"(?:(house|senate)\s+)?district\s*(\d{1,3}[ab]?)", typed, re.IGNORECASE
    )
    district_chamber = (
        district_query[1].lower() if district_query and district_query[1] else None
    )
    district_code = district_query[2].upper() if district_query else None
    candidate_party = candidate.public_payload["candidate"]["party"].astext
    candidate_office = candidate.public_payload["office"].astext
    if district_query:
        area = func.upper(func.btrim(candidate.public_payload["votingArea"].astext))
        area_code = func.regexp_replace(
            area, r"^((HOUSE|SENATE)[[:space:]]+)?DISTRICT[[:space:]]*", ""
        )
        candidates = candidates.where(area_code == district_code)
        if district_chamber:
            # An unqualified area cannot prove a candidate's chamber. Do not
            # infer it from a linked legislator or a similar office name.
            candidates = candidates.where(
                area.op("~")(district_chamber.upper() + r"[[:space:]]+DISTRICT")
            )
        people = people.where(False)
    elif typed:
        candidates = candidates.where(
            or_(
                discovery_match(
                    candidate.public_payload["candidate"]["name"].astext, typed
                ),
                name_contains(candidate.public_payload["votingArea"].astext, typed),
            )
        )
        people = people.where(discovery_match(person.name, typed))
    if party is not None:
        candidates = candidates.where(candidate_party == party)
    if office is not None:
        candidates = candidates.where(candidate_office == office)
    if chamber is not None:
        # Candidate offices do not have a held chamber field. Never derive one
        # from the office's wording, or lend a linked person's chamber to a filing.
        candidates = candidates.where(False)
    if party is not None or office is not None or chamber is not None:
        # Public-person names alone establish none of these source facts.
        people = people.where(False)
    if office is not None:
        members = members.where(False)
    period_filters = [period.legislator_id == member.id]
    if party is not None:
        period_filters.append(period.party == party)
    if chamber is not None:
        period_filters.append(m.Chamber.chamber_type == m.ChamberType(chamber))
    if district_query:
        period_filters.append(func.upper(func.btrim(m.District.code)) == district_code)
        if district_chamber:
            period_filters.append(
                m.Chamber.chamber_type == m.ChamberType(district_chamber)
            )
    elif typed:
        period_filters.append(
            or_(
                discovery_match(member.full_name, typed),
                name_contains(m.District.code, typed),
            )
        )
    matching_period = (
        select(1)
        .select_from(period)
        .join(m.District, m.District.id == period.district_id)
        .join(m.Chamber, m.Chamber.id == period.chamber_id)
        .where(*period_filters)
        .correlate(member)
        .exists()
    )
    if party is not None or chamber is not None:
        # One held service period must satisfy every filter, not a district from
        # one term and a party from another. This is not a claim of current service.
        members = members.where(matching_period)
    elif typed:
        members = members.where(
            matching_period
            if district_query
            else or_(discovery_match(member.full_name, typed), matching_period)
        )
    rows = union_all(candidates, people, members).subquery()
    where = []
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
    matching_ids = set()
    if member_ids and (typed or party is not None or chamber is not None):
        matching_ids = set(
            db.scalars(
                select(period.id)
                .select_from(period)
                .join(member, member.id == period.legislator_id)
                .join(m.District, m.District.id == period.district_id)
                .join(m.Chamber, m.Chamber.id == period.chamber_id)
                .where(member.id.in_(member_ids), *period_filters)
            )
        )
    from alethical.api.services import person_records

    record_counts, candidate_people, legislator_people, record_notes = (
        person_records.directory_record_cues(
            db,
            person_ids=[UUID(row.id) for row in selected if row.kind == "person"],
            candidate_ids=[row.id for row in selected if row.kind == "candidate"],
            legislator_ids=[
                UUID(row.id) for row in selected if row.kind == "legislator"
            ],
            today=today,
        )
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
                party=(profile.get("candidate") or {}).get("party"),
                voting_area=profile.get("votingArea"),
                source=source,
                person_links=candidate_people[row.id],
            )
        elif row.kind == "legislator":
            held = legislators[row.id]
            periods = sorted(
                held.service_periods,
                key=lambda p: (p.session.year_start, p.period_sequence),
                reverse=True,
            )
            item.update(
                slug=held.slug,
                person_links=legislator_people[row.id],
                service_status=row.service_status,
                periods=[_period(p) for p in periods],
                matching_periods=[_period(p) for p in periods if p.id in matching_ids],
            )
        elif row.kind == "person":
            item["confirmed_record_count"] = record_counts[row.id]
            item["record_notes"] = record_notes[row.id]
        result.append(item)
    years = list(
        db.scalars(
            select(cast(extract("year", candidate.election_date), Integer))
            .distinct()
            .order_by(cast(extract("year", candidate.election_date), Integer).desc())
        )
    )
    options = {"party": [], "office": [], "chamber": []}
    option_reads = []
    if type in {"all", "candidates"}:
        option_reads.extend(
            [
                select(literal("party").label("kind"), candidate_party.label("value")),
                select(
                    literal("office").label("kind"), candidate_office.label("value")
                ),
            ]
        )
    if type in {"all", "legislators"}:
        option_reads.extend(
            [
                select(literal("party").label("kind"), period.party.label("value")),
                select(
                    literal("chamber").label("kind"),
                    cast(m.Chamber.chamber_type, String).label("value"),
                )
                .select_from(period)
                .join(m.Chamber, m.Chamber.id == period.chamber_id),
            ]
        )
    if option_reads:
        held_options = union_all(*option_reads).subquery()
        for kind, value in db.execute(
            select(held_options)
            .distinct()
            .order_by(held_options.c.kind, held_options.c.value)
        ):
            if value:
                options[kind].append(value)
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
        "party": party,
        "office": office,
        "chamber": chamber,
        "parties": options["party"],
        "offices": options["office"],
        "chambers": options["chamber"],
        "sort": sort,
    }


def _period(period) -> dict:
    return {
        "chamber": period.chamber.chamber_type.value,
        "district": period.district.code,
        "party": period.party,
        "start_date": period.start_date,
        "end_date": period.end_date,
        "session": period.session.slug,
        "source_url": period.profile_url,
    }
