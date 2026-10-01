"""A portrait or current-office label must never come from a name-only match."""

from copy import deepcopy
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import select

from alethical.api.services import candidate_legislators as links
from alethical.api.services.candidate_lookup import load_profile
from alethical.db.models import CandidateRecord, LegislatorServicePeriod
from alethical.db.session import get_session_factory

TODAY = date(2026, 10, 1)
NOW = datetime(2026, 10, 1, 15, tzinfo=UTC)
CANDIDATE_ID = "c" * 64


@pytest.fixture()
def subject(seed_database, monkeypatch):
    with get_session_factory()() as db:
        period = db.scalar(
            select(LegislatorServicePeriod).where(
                LegislatorServicePeriod.is_current.is_(True)
            )
        )
        member = period.legislator
        chamber = period.chamber.chamber_type.value
        title = "State Senator" if chamber == "senate" else "State Representative"
        period.profile_url = (
            "https://www.senate.mn/members/member_bio.html?leg_id=99999"
        )
        period.photo_url = "https://www.lrl.mn.gov/legdb/MemberPhotos/example.jpg"
        period.party = "DFL"
        evidence = {
            "candidate_id": CANDIDATE_ID,
            "candidate_name": member.full_name,
            "election_id": "8334",
            "election_date": "2026-11-03",
            "office": f"{title} District {period.district.code}",
            "party": "DEMOCRATIC-FARMER-LABOR",
            "legislator_slug": member.slug,
            "legislator_name": member.full_name,
            "member_source_url": period.profile_url,
            "chamber": chamber,
            "district": period.district.code,
            "member_party": period.party,
        }
        monkeypatch.setattr(links, "reviewed_links", lambda: {CANDIDATE_ID: evidence})
        profile = {
            "candidate": {
                "id": CANDIDATE_ID,
                "name": member.full_name,
                "party": evidence["party"],
            },
            "election": {"id": "8334", "date": "2026-11-03"},
            "office": evidence["office"],
            "source": {
                "authority": "Minnesota Secretary of State",
                "url": "https://myballotmn.sos.mn.gov/",
            },
        }
        yield db, profile, period, evidence
        db.rollback()


def test_reviewed_member_reuses_official_photo_and_returns_truthful_reelection(subject):
    db, profile, period, _ = subject
    db.add(
        CandidateRecord(
            id=CANDIDATE_ID,
            election_id="8334",
            election_date=date(2026, 11, 3),
            checked_at=NOW,
            source_sha256="e" * 64,
            public_payload=profile,
        )
    )
    db.flush()
    result = load_profile(db, CANDIDATE_ID, now=NOW)
    assert result["photo"] == {"url": period.photo_url}
    connection = result["legislator"]
    assert connection["profileUrl"] == f"/legislators/{period.legislator.slug}"
    assert connection["serviceStatus"] == "current"
    assert connection["isReelection"] is True
    assert connection["source"]["url"] == period.profile_url
    assert "checkedDate" not in connection["source"]
    assert "startDate" not in connection


@pytest.mark.parametrize("field", ["id", "name", "party", "office", "election"])
def test_changed_or_unreviewed_ballot_identity_gets_no_connection(subject, field):
    db, profile, _, _ = subject
    changed = deepcopy(profile)
    if field in {"id", "name", "party"}:
        changed["candidate"][field] = "other"
    elif field == "election":
        changed["election"]["id"] = "another-election"
    else:
        changed[field] = "Attorney General"
    assert links.confirmed_legislator(db, changed, today=TODAY) is None


@pytest.mark.parametrize("field", ["profile_url", "party", "district"])
def test_matching_name_alone_does_not_attach_another_source_identity(subject, field):
    db, profile, period, evidence = subject
    if field == "district":
        evidence["district"] = "999"
    elif field == "profile_url":
        period.profile_url = "https://www.senate.mn/members/member_bio.html?leg_id=123"
    else:
        period.party = "R"
    assert links.confirmed_legislator(db, profile, today=TODAY) is None


def test_missing_current_service_is_unknown_not_former(subject):
    db, profile, period, _ = subject
    period.is_current = False
    result = links.confirmed_legislator(db, profile, today=TODAY)
    assert result["serviceStatus"] == "unknown"
    assert result["isReelection"] is False
    assert "office" not in result


def test_expired_session_never_claims_current_service(subject):
    db, profile, _, _ = subject
    result = links.confirmed_legislator(db, profile, today=date(2027, 1, 1))
    assert result["serviceStatus"] == "unknown"
    assert result["isReelection"] is False


def test_confirmed_actual_end_date_can_show_former_service(subject):
    db, profile, period, _ = subject
    period.end_date = date(2026, 9, 1)
    result = links.confirmed_legislator(db, profile, today=TODAY)
    assert result["serviceStatus"] == "former"
    assert result["isReelection"] is False


def test_running_for_different_office_does_not_claim_reelection(subject):
    db, profile, period, evidence = subject
    profile["office"] = evidence["office"] = "Attorney General"
    result = links.confirmed_legislator(db, profile, today=TODAY)
    assert result["serviceStatus"] == "current"
    assert result["isReelection"] is False
    assert period.district.code in result["votingArea"]


@pytest.mark.parametrize(
    ("office", "chamber", "district", "same"),
    [
        ("State Representative District 6B", "house", "06B", True),
        ("State Senator District 6", "senate", "06", True),
        ("State Representative District 49B", "house", "49B", True),
        ("State Representative District 6A", "house", "06B", False),
        ("State Senator District 6", "house", "06B", False),
        ("State Representative District 6B", "senate", "06", False),
        ("County Attorney", "house", "43A", False),
        ("Governor & Lt Governor", "house", "13A", False),
        ("State Senator District 6B", "senate", "06B", False),
        ("State Representative District 6", "house", "06", False),
    ],
)
def test_reelection_compares_chamber_and_canonical_district(
    office, chamber, district, same
):
    assert links._same_legislative_seat(office, chamber, district) is same


def test_ticket_portrait_belongs_to_the_confirmed_individual_not_joint_heading(subject):
    db, profile, period, evidence = subject
    profile["office"] = evidence["office"] = "Governor & Lt Governor"
    profile["candidate"]["name"] = evidence["candidate_name"] = (
        "Example Person and Running Mate"
    )
    db.add(
        CandidateRecord(
            id=CANDIDATE_ID,
            election_id="8334",
            election_date=date(2026, 11, 3),
            checked_at=NOW,
            source_sha256="e" * 64,
            public_payload=profile,
        )
    )
    db.flush()
    result = load_profile(db, CANDIDATE_ID, now=NOW)
    assert result["isJointTicket"] is True
    assert "photo" not in result
    assert result["legislator"]["name"] == period.legislator.full_name
    assert result["legislator"]["photoUrl"] == period.photo_url


@pytest.mark.parametrize(
    "photo", [None, "https://untrusted.example/person.jpg", "javascript:alert(1)"]
)
def test_missing_or_untrusted_photo_keeps_the_confirmed_profile_link(subject, photo):
    db, profile, period, _ = subject
    period.photo_url = photo
    result = links.confirmed_legislator(db, profile, today=TODAY)
    assert result["profileUrl"]
    assert "photoUrl" not in result


def test_packaged_real_connections_are_election_and_source_scoped():
    entries = links.reviewed_links()
    assert len(entries) >= 7
    assert {entry["legislator_slug"] for entry in entries.values()} >= {
        "mohamud-noor",
        "doron-clark",
        "josh-heintzeman",
        "keri-heintzeman",
        "carlie-kotyza-witthuhn",
        "cedrick-frazier",
        "lisa-demuth",
    }
    for identity, entry in entries.items():
        assert len(identity) == 64
        assert entry["election_id"] == "8334"
        assert entry["office"] and entry["district"] and entry["member_party"]
        assert links._official_url(entry["member_source_url"])


def test_reviewed_cross_office_and_ticket_links_retain_positive_identity_evidence():
    entries = {
        entry["legislator_slug"]: entry for entry in links.reviewed_links().values()
    }
    attorney = entries["cedrick-frazier"]
    assert attorney["office"] == "County Attorney"
    assert attorney["party"] == "NONPARTISAN"
    assert attorney["member_party"] == "DFL"
    assert (
        attorney["identity_evidence"]["biography_url"]
        == "https://www.cedrickfrazier.org/about"
    )
    ticket = entries["lisa-demuth"]
    assert ticket["candidate_name"] == "Lisa Demuth and Ryan Wilson"
    assert ticket["legislator_name"] == "Lisa Demuth"
    assert ticket["identity_evidence"]["candidate_website"] == "http://LisaforMN.com"
