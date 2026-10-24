"""Confirmed person connections, independent of candidacy and account ownership.

The small reviewed register is shipped with the application, so existing saved
candidate profiles gain the connection without a production write or migration.
Names alone never create a link. Unreviewed candidates remain fully usable.
"""

from __future__ import annotations

import json
import re
from datetime import date
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from alethical.api.serializers import normalize_legislator_profile_url
from alethical.db.models import Jurisdiction, Legislator, LegislatorServicePeriod


@lru_cache(maxsize=1)
def reviewed_links() -> dict[str, dict]:
    path = Path(__file__).resolve().parents[1] / "data/candidate_legislator_links.json"
    entries = json.loads(path.read_text())["links"]
    return {entry["candidate_id"]: entry for entry in entries}


def _official_url(value: str | None) -> str | None:
    if not value:
        return None
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https"
        or parsed.username
        or parsed.password
        or parsed.hostname
        not in {"www.house.mn.gov", "www.senate.mn", "www.lrl.mn.gov"}
    ):
        return None
    return value


def _same_legislative_seat(office: str, chamber: str, district: str) -> bool:
    """Compare only source office/district codes after identity is confirmed.

    The government roster pads district 6 as 06 while MyBallot uses 6. This
    normalization never identifies a person or equates House and Senate seats.
    """
    title = "State Representative" if chamber == "house" else "State Senator"
    suffix = "[AB]" if chamber == "house" else ""
    recorded = re.fullmatch(rf"0*([1-9][0-9]*)({suffix})", district)
    sought = re.fullmatch(rf"{title} District 0*([1-9][0-9]*)({suffix})", office)
    return bool(recorded and sought and recorded.groups() == sought.groups())


def confirmed_legislator(db: Session, profile: dict, *, today: date) -> dict | None:
    candidate = profile.get("candidate", {})
    election = profile.get("election", {})
    evidence = reviewed_links().get(candidate.get("id"))
    if not evidence or any(
        actual != expected
        for actual, expected in (
            (candidate.get("name"), evidence["candidate_name"]),
            (candidate.get("party"), evidence["party"]),
            (election.get("id"), evidence["election_id"]),
            (election.get("date"), evidence["election_date"]),
            (profile.get("office"), evidence["office"]),
        )
    ):
        return None
    member = (
        db.execute(
            select(Legislator)
            .where(
                Legislator.slug == evidence["legislator_slug"],
                Legislator.full_name == evidence["legislator_name"],
                Legislator.jurisdiction.has(Jurisdiction.slug == "minnesota"),
            )
            .options(
                joinedload(Legislator.service_periods).options(
                    joinedload(LegislatorServicePeriod.chamber),
                    joinedload(LegislatorServicePeriod.district),
                    joinedload(LegislatorServicePeriod.session),
                )
            )
        )
        .unique()
        .scalar_one_or_none()
    )
    if member is None:
        return None
    # Bind the saved person to the reviewed government member ID as well as the
    # independently reviewed office, district and party. A slug/name collision
    # in another source cannot attach another person's portrait or record.
    confirmed_periods = [
        period
        for period in member.service_periods
        if normalize_legislator_profile_url(period.profile_url)
        == evidence["member_source_url"]
        and period.chamber.chamber_type.value == evidence["chamber"]
        and period.district.code == evidence["district"]
        and period.party == evidence["member_party"]
    ]
    if not confirmed_periods:
        return None
    current = [
        period
        for period in member.service_periods
        if period.is_current
        and period.session.is_current
        and period.session.year_start <= today.year <= period.session.year_end
        and (period.start_date is None or period.start_date <= today)
        and (period.end_date is None or period.end_date >= today)
    ]
    # Absence from a current roster does not prove former service. Ambiguous or
    # expired current-service evidence leaves the confirmed identity link alone.
    service = current[0] if len(current) == 1 else None
    period = service or max(confirmed_periods, key=lambda item: item.session.year_end)
    former = not current and period.end_date is not None and period.end_date < today
    result = {
        "id": str(member.id),
        "slug": member.slug,
        "name": member.full_name,
        "profileUrl": f"/legislators/{member.slug}",
        "serviceStatus": "current" if service else "former" if former else "unknown",
        "isReelection": False,
    }
    source_url = _official_url(normalize_legislator_profile_url(period.profile_url))
    if source_url:
        result["source"] = {
            "authority": "Minnesota House of Representatives"
            if period.chamber.chamber_type.value == "house"
            else "Minnesota Senate",
            "url": source_url,
        }
    photo = _official_url(period.photo_url)
    if photo:
        result["photoUrl"] = photo
    if service or former:
        chamber = period.chamber.chamber_type.value
        office = "State Representative" if chamber == "house" else "State Senator"
        area = "House District" if chamber == "house" else "Senate District"
        result["office"] = office
        result["votingArea"] = f"{area} {period.district.code}"
        if period.start_date:
            result["startDate"] = period.start_date.isoformat()
        if period.end_date:
            result["endDate"] = period.end_date.isoformat()
        result["isReelection"] = (
            service is not None
            and _same_legislative_seat(profile["office"], chamber, period.district.code)
            and date.fromisoformat(election["date"]) >= today
        )
    return result
