"""Profile media files require held links, never matching names."""

# ruff: noqa: F811
from datetime import date, timedelta

import pytest
from sqlalchemy import select

from alethical.api.services import identity_confirmations as identities
from alethical.api.services.person_records import candidate_identity
from alethical.db import models as m
from alethical.tests.test_finance_media_buys import (  # noqa: F401
    BASE,
    _connection,
    finance_api,
    finance_db,
    held,
    listed,
    page_count,
    review,
    source,
)
from alethical.tests.test_finance_media_buys import reader, pdf
from alethical.pipeline import fcc_archive


def entity(db, kind="person", name="Same printed name"):
    row = m.IdentityEntity(kind=kind, name=name, made_by_alethical_team=False)
    db.add(row)
    db.flush()
    return row


def claim(db, owner, kind, key):
    row = m.IdentityConfirmation(
        entity_id=owner.id,
        record_kind=kind,
        record_key=str(key),
        relation="Held profile connection",
        evidence_source="official_page",
        evidence_url="https://example.test/held",
        evidence_quote="Synthetic source record",
        basis="Synthetic reviewed identity",
        made_by_alethical_team=False,
    )
    db.add(row)
    db.flush()
    return row


def read(api, kind, target):
    response = api.get(
        BASE + "/connections", params={"kind": kind, "target": str(target)}
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


@pytest.fixture
def person(listed, held):
    person = m.PublicPerson(
        name="Same printed name", identity_evidence={"source": "fixture"}
    )
    listed.add(person)
    profile = {
        "candidate": {"id": "media-profile-candidate", "name": person.name},
        "election": {"id": "fixture", "date": "2026-11-03", "type": "general"},
        "office": "State Representative",
        "votingArea": "7A",
    }
    candidate = m.CandidateRecord(
        id="media-profile-candidate",
        election_id="fixture",
        election_date=date(2026, 11, 3),
        public_payload=profile,
        source_sha256="a" * 64,
        checked_at=review.now(),
    )
    listed.add(candidate)
    listed.flush()
    listed.add(
        m.PersonCandidacy(
            person_id=person.id,
            candidate_id=candidate.id,
            identity=candidate_identity(profile),
            evidence={"source": "fixture"},
        )
    )
    copy = listed.scalar(
        select(m.TVAdPublication).where(
            m.TVAdPublication.file_id == held["document"].file_id
        )
    )
    connection = _connection(
        listed, copy, "candidate", candidate.id, {"label": person.name, "role": "named"}
    )
    return person, candidate, connection


def test_person_groups_deduplicate_file_but_keep_committee_and_candidate(
    listed, held, person, finance_api
):
    public, candidate, connection = person
    owner = entity(listed)
    claim(listed, owner, "public_person", public.id)
    committee = claim(listed, owner, "committee", "19002")
    data = read(finance_api, "person", public.id)
    assert data["total"] == 1
    assert [g["kind"] for g in data["groups"]] == ["committee", "named"]
    assert all(g["files"][0]["key"] == held["key"] for g in data["groups"])
    assert all(g["files"][0]["page"] == 1 for g in data["groups"])
    assert read(finance_api, "person", owner.id)["total"] == 1
    identities.withdraw(listed, committee.id, {"reason": "Wrong person"}, team=False)
    assert [g["kind"] for g in read(finance_api, "person", public.id)["groups"]] == [
        "named"
    ]
    # A revised candidate record invalidates the held person/candidacy link.
    candidate.public_payload = {**candidate.public_payload, "votingArea": "8B"}
    listed.flush()
    assert read(finance_api, "person", public.id)["total"] == 0


def test_legislator_uses_only_confirmed_committee_links(listed, held, finance_api):
    member = listed.scalar(select(m.Legislator))
    link = m.LegislatorCampaignCommittee(
        legislator_id=member.id,
        registration_number="19002",
        decision=m.CommitteeLinkReviewDecision.confirmed,
        committee_name_as_reviewed="Example Lakes Committee",
        reviewed_by="Fixture",
    )
    listed.add(link)
    listed.flush()
    assert read(finance_api, "legislator", member.slug)["total"] == 1
    link.decision = m.CommitteeLinkReviewDecision.rejected
    listed.flush()
    assert read(finance_api, "legislator", member.id)["total"] == 0


def test_organization_follows_merges_splits_and_withdrawals_without_name_inference(
    listed, held, finance_api
):
    one, two = entity(listed, "organization"), entity(listed, "organization")
    first = claim(listed, one, "committee", "19002")
    second = claim(listed, two, "principal", "fixture-principal")
    assert read(finance_api, "organization", one.id)["total"] == 1
    assert read(finance_api, "organization", two.id)["total"] == 0
    identities.merge(
        listed,
        one.id,
        {"into": str(two.id), "reason": "Same held organization"},
        team=False,
    )
    assert read(finance_api, "organization", one.id)["total"] == 1
    parts = identities.split(
        listed,
        two.id,
        {
            "reason": "Separate held records",
            "parts": [
                {"name": "First", "confirmations": [str(first.id)]},
                {"name": "Second", "confirmations": [str(second.id)]},
            ],
        },
        team=False,
    )
    assert read(finance_api, "organization", one.id)["total"] == 0
    assert read(finance_api, "organization", parts[0].id)["total"] == 1
    assert read(finance_api, "organization", parts[1].id)["total"] == 0
    replacement = identities._standing(listed, "committee", "19002")
    identities.withdraw(
        listed, replacement.id, {"reason": "Wrong organization"}, team=False
    )
    assert read(finance_api, "organization", parts[0].id)["total"] == 0


def test_profile_groups_keep_their_own_exact_version_and_scan_once(
    listed, held, source, person, finance_api, monkeypatch
):
    public, candidate, _ = person
    owner = entity(listed)
    claim(listed, owner, "public_person", public.id)
    claim(listed, owner, "committee", "19002")
    document, store = source
    newer = m.FCCDocument(
        facility_id=document.facility_id,
        file_id=document.file_id,
        content_hash=fcc_archive.archive_body(
            listed, store, pdf() + b"\n% newer profile file"
        ),
        call_sign=document.call_sign,
        folder_id=document.folder_id,
        folder_path=document.folder_path,
        name="Newer profile file",
        url=document.url,
        year=2026,
        last_seen_at=document.last_seen_at + timedelta(days=1),
        last_downloaded_at=document.last_downloaded_at + timedelta(days=1),
    )
    listed.add(newer)
    listed.flush()
    check = m.FinanceTVConnection(
        facility_id=newer.facility_id,
        file_id=newer.file_id,
        content_hash=newer.content_hash,
        kind="candidate",
        target_id=candidate.id,
        target_snapshot={"label": public.name, "role": "named"},
        page=1,
        quote="Synthetic candidate quote",
        evidence="Synthetic check",
        made_by_alethical_team=False,
    )
    listed.add(check)
    listed.flush()
    scans = []
    original = reader._latest_copies

    def counted(*args, **kwargs):
        scans.append(1)
        return original(*args, **kwargs)

    monkeypatch.setattr(reader, "_latest_copies", counted)
    result = read(finance_api, "person", public.id)
    assert len(scans) == 1
    assert result["total"] == 1
    assert result["files"][0]["version_id"] == newer.content_hash
    grouped = {group["kind"]: group["files"][0] for group in result["groups"]}
    assert grouped["committee"]["version_id"] == document.content_hash
    assert grouped["named"]["version_id"] == newer.content_hash
    assert grouped["named"]["page"] == 1
    withdrawn = finance_api.post(
        BASE + f"/connections/{check.id}/withdraw", json={"reason": "No longer stands"}
    )
    assert withdrawn.status_code == 200, withdrawn.text
    result = read(finance_api, "person", public.id)
    assert result["files"][0]["version_id"] == document.content_hash
    assert all(
        group["files"][0]["version_id"] == document.content_hash
        for group in result["groups"]
    )


def test_principal_links_work_but_payee_identity_never_becomes_an_agency(
    listed, held, finance_api
):
    owner = entity(listed, "organization", "Example Media")
    claim(listed, owner, "payee_name", "Example Media")
    assert read(finance_api, "organization", owner.id)["total"] == 0
    principal = claim(listed, owner, "principal", "held-principal")
    copy = listed.scalar(
        select(m.TVAdPublication).where(
            m.TVAdPublication.file_id == held["document"].file_id
        )
    )
    _connection(
        listed,
        copy,
        "principal",
        "held-principal",
        {"label": "Held principal", "role": "buyer"},
    )
    assert read(finance_api, "organization", owner.id)["total"] == 1
    identities.withdraw(
        listed, principal.id, {"reason": "Wrong organization"}, team=False
    )
    assert read(finance_api, "organization", owner.id)["total"] == 0


@pytest.mark.parametrize("kind", ["person", "legislator", "organization"])
def test_profile_connections_keep_finance_access_gate(client, kind):
    response = client.get(
        BASE + "/connections", params={"kind": kind, "target": "not-a-record"}
    )
    assert response.status_code in {401, 403}


def test_empty_profile_has_no_station_scan_and_unknown_profile_is_not_empty(
    listed, finance_api, monkeypatch
):
    owner = entity(listed)

    def unexpected(*args, **kwargs):
        raise AssertionError("No station scan is needed without any held targets")

    monkeypatch.setattr(reader, "connected", unexpected)
    assert read(finance_api, "person", owner.id)["total"] == 0
    missing = finance_api.get(
        BASE + "/connections", params={"kind": "person", "target": "unknown"}
    )
    assert missing.status_code == 404
