#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any
import importlib.util
import sys

from sqlalchemy import create_engine, delete, select
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "prototypes" / "alethical_schema_sqlalchemy.py"

def load_schema_module():
    spec = importlib.util.spec_from_file_location("alethical_schema_sqlalchemy", SCHEMA_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


schema = load_schema_module()
ArtifactType = schema.ArtifactType
AuthIdentity = schema.AuthIdentity
Bill = schema.Bill
BillAction = schema.BillAction
BillStats = schema.BillStats
BillVersion = schema.BillVersion
BillVersionSection = schema.BillVersionSection
Chamber = schema.Chamber
ChamberType = schema.ChamberType
ChatMessage = schema.ChatMessage
ChatRole = schema.ChatRole
ChatSession = schema.ChatSession
District = schema.District
IngestionRun = schema.IngestionRun
IngestionStatus = schema.IngestionStatus
Jurisdiction = schema.Jurisdiction
LegislativeSession = schema.LegislativeSession
Legislator = schema.Legislator
LegislatorServicePeriod = schema.LegislatorServicePeriod
LegislatorStats = schema.LegislatorStats
NotificationChannel = schema.NotificationChannel
NotificationEndpoint = schema.NotificationEndpoint
NotificationEvent = schema.NotificationEvent
NotificationFrequency = schema.NotificationFrequency
NotificationPreference = schema.NotificationPreference
RagChunk = schema.RagChunk
RagChunkEmbedding = schema.RagChunkEmbedding
RagSectionDocument = schema.RagSectionDocument
SavedPlace = schema.SavedPlace
SessionType = schema.SessionType
SourceArtifact = schema.SourceArtifact
Sponsorship = schema.Sponsorship
SponsorshipRole = schema.SponsorshipRole
TrackedBill = schema.TrackedBill
UserAccount = schema.UserAccount


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def slugify(value: str) -> str:
    return "-".join("".join(ch.lower() if ch.isalnum() else " " for ch in value).split())


def deterministic_embedding(text: str, dimensions: int = 1536) -> list[float]:
    values: list[float] = []
    seed = text.encode("utf-8")
    counter = 0
    while len(values) < dimensions:
        digest = hashlib.sha256(seed + counter.to_bytes(4, "big")).digest()
        for offset in range(0, len(digest), 4):
            chunk = digest[offset : offset + 4]
            scaled = (int.from_bytes(chunk, "big") / 0xFFFFFFFF) * 2.0 - 1.0
            values.append(scaled)
            if len(values) == dimensions:
                break
        counter += 1
    norm = sum(value * value for value in values) ** 0.5 or 1.0
    return [value / norm for value in values]


def seed_reference_data(session: Session) -> dict[str, Any]:
    minnesota = session.scalar(select(Jurisdiction).where(Jurisdiction.slug == "minnesota"))
    if minnesota is None:
        minnesota = Jurisdiction(
            slug="minnesota",
            name="Minnesota",
            country_code="US",
            subdivision_code="MN",
        )
        session.add(minnesota)
        session.flush()

    chambers: dict[str, Any] = {}
    for chamber_type, slug, name, short_name, order in [
        (ChamberType.house, "house", "Minnesota House of Representatives", "House", 1),
        (ChamberType.senate, "senate", "Minnesota Senate", "Senate", 2),
        (ChamberType.joint, "joint", "Joint", "Joint", 3),
    ]:
        chamber = session.scalar(
            select(Chamber).where(Chamber.jurisdiction_id == minnesota.id, Chamber.slug == slug)
        )
        if chamber is None:
            chamber = Chamber(
                jurisdiction_id=minnesota.id,
                chamber_type=chamber_type,
                slug=slug,
                name=name,
                short_name=short_name,
                display_order=order,
            )
            session.add(chamber)
            session.flush()
        chambers[slug] = chamber

    current_session = session.scalar(
        select(LegislativeSession).where(LegislativeSession.jurisdiction_id == minnesota.id, LegislativeSession.slug == "94-2025-regular")
    )
    if current_session is None:
        current_session = LegislativeSession(
            jurisdiction_id=minnesota.id,
            slug="94-2025-regular",
            session_number=94,
            session_type=SessionType.regular,
            year_start=2025,
            year_end=2026,
            name="94th Legislature (2025 - 2026) Regular Session",
            is_current=True,
        )
        session.add(current_session)
        session.flush()

    return {"jurisdiction": minnesota, "chambers": chambers, "session": current_session}


def upsert_district(session: Session, jurisdiction_id: Any, chamber_id: Any, code: str) -> Any:
    district = session.scalar(
        select(District).where(
            District.jurisdiction_id == jurisdiction_id,
            District.chamber_id == chamber_id,
            District.code == code,
        )
    )
    if district is None:
        district = District(
            jurisdiction_id=jurisdiction_id,
            chamber_id=chamber_id,
            code=code,
            label=f"District {code}",
        )
        session.add(district)
        session.flush()
    return district


def upsert_legislator(
    session: Session,
    jurisdiction_id: Any,
    full_name: str,
    profile_url: str | None = None,
) -> Any:
    external_key = profile_url or full_name
    legislator = session.scalar(
        select(Legislator).where(
            Legislator.jurisdiction_id == jurisdiction_id,
            Legislator.external_key == external_key,
        )
    )
    if legislator is None:
        legislator = Legislator(
            jurisdiction_id=jurisdiction_id,
            slug=slugify(full_name),
            external_key=external_key,
            full_name=full_name,
            sort_name=full_name,
        )
        session.add(legislator)
        session.flush()
    return legislator


def upsert_service_period(
    session: Session,
    legislator: Any,
    current_session: Any,
    chamber: Any,
    district: Any,
    *,
    party: str | None = None,
    title: str | None = None,
    email: str | None = None,
    phone: str | None = None,
    profile_url: str | None = None,
    photo_url: str | None = None,
    office_address: str | None = None,
) -> Any:
    service_period = session.scalar(
        select(LegislatorServicePeriod).where(
            LegislatorServicePeriod.legislator_id == legislator.id,
            LegislatorServicePeriod.session_id == current_session.id,
            LegislatorServicePeriod.is_current.is_(True),
        )
    )
    if service_period is None:
        service_period = LegislatorServicePeriod(
            legislator_id=legislator.id,
            session_id=current_session.id,
            chamber_id=chamber.id,
            district_id=district.id,
            period_sequence=1,
            is_current=True,
        )
        session.add(service_period)
        session.flush()
    service_period.party = party
    service_period.title = title
    service_period.email = email
    service_period.phone = phone
    service_period.profile_url = profile_url
    service_period.photo_url = photo_url
    service_period.office_address = office_address
    return service_period


def ingest_member_profiles(session: Session, refs: dict[str, Any]) -> list[Any]:
    outputs = [
        read_json(ROOT / "prototype-output" / "house-member-15518.json"),
        read_json(ROOT / "prototype-output" / "senate-member-10002.json"),
    ]
    created: list[Any] = []
    for payload in outputs:
        chamber = refs["chambers"][payload["chamber"]]
        district = upsert_district(session, refs["jurisdiction"].id, chamber.id, payload["district"])
        legislator = upsert_legislator(
            session,
            refs["jurisdiction"].id,
            payload["name"],
            profile_url=payload.get("source_url"),
        )
        office_block = payload.get("office_block")
        upsert_service_period(
            session,
            legislator,
            refs["session"],
            chamber,
            district,
            party=payload.get("party"),
            email=payload.get("email") or payload.get("email_form_url"),
            phone=payload.get("office_phone"),
            profile_url=payload.get("source_url"),
            office_address=office_block,
        )
        created.append(legislator)
    return created


def ingest_bill_payload(session: Session, refs: dict[str, Any], bill_payload: dict[str, Any], rag_payload: dict[str, Any]) -> Any:
    canonical = bill_payload["canonical_bill"]
    bill_text = bill_payload["bill_text"]
    chamber = refs["chambers"]["house" if canonical["file_type"] == "HF" else "senate"]
    all_actions = [
        action
        for actions in canonical.get("actions", {}).values()
        for action in actions
    ]
    latest_action = max(
        all_actions,
        key=lambda action: int(action.get("action_number") or 0),
        default=None,
    )

    run = IngestionRun(
        adapter="prototype_bill_ingest",
        target_type="bill",
        target_key=canonical["bill_key"],
        status=IngestionStatus.succeeded,
        stats={"source": "prototype-output"},
    )
    session.add(run)
    session.flush()

    content_hash = rag_payload["rag_sections"][0]["source_hash"] if rag_payload["rag_sections"] else canonical["bill_key"]
    artifact = session.scalar(
        select(SourceArtifact).where(
            SourceArtifact.adapter == "prototype_bill_ingest",
            SourceArtifact.source_url == bill_text["source_url"],
            SourceArtifact.content_hash == content_hash,
        )
    )
    if artifact is None:
        artifact = SourceArtifact(
            run_id=run.id,
            adapter="prototype_bill_ingest",
            artifact_type=ArtifactType.json,
            source_key=canonical["bill_key"],
            source_url=bill_text["source_url"],
            storage_path=f"prototype-output/{canonical['bill_key']}.json",
            content_hash=content_hash,
            is_current=True,
            metadata_json={"page_title": bill_text["page_title"]},
        )
        session.add(artifact)
        session.flush()
    else:
        artifact.run_id = run.id
        artifact.source_key = canonical["bill_key"]
        artifact.storage_path = f"prototype-output/{canonical['bill_key']}.json"
        artifact.is_current = True
        artifact.metadata_json = {"page_title": bill_text["page_title"]}

    bill = session.scalar(select(Bill).where(Bill.bill_key == canonical["bill_key"]))
    if bill is None:
        bill = Bill(
            session_id=refs["session"].id,
            chamber_id=chamber.id,
            bill_key=canonical["bill_key"],
            file_type=canonical["file_type"],
            file_number=int(canonical["file_number"]),
            revisor_number=canonical.get("revisor_number"),
            title=bill_text["bill_title_text"],
            description=canonical.get("description"),
            current_status=latest_action["action_text"] if latest_action else None,
            official_url=bill_text["source_url"],
            is_omnibus=len(bill_text.get("articles", [])) > 1,
            ingestion_run_id=run.id,
        )
        session.add(bill)
        session.flush()
    else:
        bill.title = bill_text["bill_title_text"]
        bill.description = canonical.get("description")
        bill.official_url = bill_text["source_url"]

    latest_version = session.scalar(
        select(BillVersion).where(BillVersion.bill_id == bill.id, BillVersion.is_current.is_(True))
    )
    if latest_version is None:
        latest_version = BillVersion(
            bill_id=bill.id,
            version_code="current",
            version_name=bill_text["page_title"],
            sequence_number=1,
            html_url=bill_text["source_url"],
            source_artifact_id=artifact.id,
            is_current=True,
        )
        session.add(latest_version)
        session.flush()

    session.execute(delete(BillAction).where(BillAction.bill_id == bill.id))
    session.execute(delete(Sponsorship).where(Sponsorship.bill_id == bill.id))
    session.execute(
        delete(RagChunkEmbedding).where(
            RagChunkEmbedding.rag_chunk_id.in_(
                select(RagChunk.id).join(
                    RagSectionDocument,
                    RagSectionDocument.id == RagChunk.rag_section_document_id,
                ).where(RagSectionDocument.bill_id == bill.id)
            )
        )
    )
    session.execute(delete(RagChunk).where(RagChunk.rag_section_document_id.in_(
        select(RagSectionDocument.id).where(RagSectionDocument.bill_id == bill.id)
    )))
    session.execute(delete(RagSectionDocument).where(RagSectionDocument.bill_id == bill.id))
    session.execute(delete(BillVersionSection).where(BillVersionSection.bill_version_id == latest_version.id))

    section_lookup: dict[str, Any] = {}
    for source_order, section in enumerate(bill_text["sections"], start=1):
        row = BillVersionSection(
            bill_version_id=latest_version.id,
            section_id_text=section["section_id"],
            source_order=source_order,
            article_id_text=next(
                (
                    article["article_id"]
                    for article in bill_text.get("articles", [])
                    if any(sec["section_id"] == section["section_id"] for sec in article.get("sections", []))
                ),
                None,
            ),
            article_number=next(
                (
                    article["article_number"]
                    for article in bill_text.get("articles", [])
                    if any(sec["section_id"] == section["section_id"] for sec in article.get("sections", []))
                ),
                None,
            ),
            article_heading=next(
                (
                    article["article_heading"]
                    for article in bill_text.get("articles", [])
                    if any(sec["section_id"] == section["section_id"] for sec in article.get("sections", []))
                ),
                None,
            ),
            section_heading=section.get("heading"),
            statute_heading=section.get("statute_heading"),
            cite_heading=section.get("cite_heading"),
            effective_date_heading=section.get("effective_date_heading"),
            raw_text=section["text"],
            source_hash=next(
                (
                    doc["source_hash"]
                    for doc in rag_payload["rag_sections"]
                    if doc["section_id"] == section["section_id"]
                ),
                None,
            ),
        )
        session.add(row)
        session.flush()
        section_lookup[section["section_id"]] = row

    for chamber_name, actions in canonical["actions"].items():
        action_chamber = refs["chambers"].get(chamber_name)
        for action in actions:
            session.add(
                BillAction(
                    bill_id=bill.id,
                    chamber_id=action_chamber.id if action_chamber else None,
                    action_number=int(action["action_number"]),
                    action_group=action.get("action_group"),
                    action_text=action["action_text"],
                    action_description=action.get("action_description"),
                    journal_page=action.get("journal_page"),
                    roll_call_text=action.get("roll_call"),
                )
            )

    for chamber_name, authors in canonical["authors"].items():
        author_chamber = refs["chambers"].get(chamber_name)
        if author_chamber is None:
            continue
        for index, author in enumerate(authors, start=1):
            legislator = upsert_legislator(
                session,
                refs["jurisdiction"].id,
                author["member_name"],
            )
            district = upsert_district(session, refs["jurisdiction"].id, author_chamber.id, f"{chamber_name[:1].upper()}{index}")
            upsert_service_period(
                session,
                legislator,
                refs["session"],
                author_chamber,
                district,
            )
            session.add(
                Sponsorship(
                    bill_id=bill.id,
                    legislator_id=legislator.id,
                    role=SponsorshipRole.chief_author if index == 1 else SponsorshipRole.co_author,
                    source_order=index,
                    source_chamber=chamber_name,
                )
            )

    for section_doc in rag_payload["rag_sections"]:
        rag_section = RagSectionDocument(
            bill_id=bill.id,
            bill_version_id=latest_version.id,
            bill_version_section_id=section_lookup[section_doc["section_id"]].id,
            citation_label=section_doc["citation_label"],
            clean_text=section_doc["clean_text"],
            search_text=section_doc["search_text"],
            cleaning_version=section_doc["cleaning_version"],
            source_hash=section_doc["source_hash"],
            word_count=len(section_doc["clean_text"].split()),
        )
        session.add(rag_section)
        session.flush()

        for chunk in [chunk for chunk in rag_payload["rag_chunks"] if chunk["section_id"] == section_doc["section_id"]]:
            chunk_row = RagChunk(
                rag_section_document_id=rag_section.id,
                chunk_index=chunk["chunk_index"],
                citation_label=chunk["citation_label"],
                chunk_text=chunk["chunk_text"],
                search_text=chunk["chunk_text"],
                chunking_version=chunk["chunking_version"],
                word_count=chunk["word_count"],
            )
            session.add(chunk_row)
            session.flush()
            session.add(
                RagChunkEmbedding(
                    rag_chunk_id=chunk_row.id,
                    embedding_model="demo-minilm-1536",
                    embedding=deterministic_embedding(chunk["chunk_text"]),
                )
            )

    sponsor_count = sum(len(authors) for authors in canonical.get("authors", {}).values())
    action_count = sum(len(actions) for actions in canonical.get("actions", {}).values())
    version_count = max(1, len(canonical["text_versions"]))
    stats = session.scalar(select(BillStats).where(BillStats.bill_id == bill.id))
    if stats is None:
        stats = BillStats(bill_id=bill.id)
        session.add(stats)
    stats.sponsor_count = sponsor_count
    stats.action_count = action_count
    stats.version_count = version_count
    stats.vote_event_count = 0
    return bill


def seed_user_features(session: Session, bills: list[Any], refs: dict[str, Any]) -> Any:
    user = session.scalar(select(UserAccount).where(UserAccount.primary_email == "ada@example.com"))
    if user is None:
        user = UserAccount(display_name="Ada", primary_email="ada@example.com", is_active=True)
        session.add(user)
        session.flush()

    identity = session.scalar(select(AuthIdentity).where(AuthIdentity.provider == "demo", AuthIdentity.provider_subject == "ada-demo"))
    if identity is None:
        session.add(
            AuthIdentity(
                user_id=user.id,
                provider="demo",
                provider_subject="ada-demo",
                email="ada@example.com",
            )
        )

    if session.scalar(select(NotificationPreference).where(NotificationPreference.user_id == user.id, NotificationPreference.channel == NotificationChannel.email)) is None:
        session.add(
            NotificationPreference(
                user_id=user.id,
                channel=NotificationChannel.email,
                frequency=NotificationFrequency.daily_digest,
                is_enabled=True,
            )
        )

    if session.scalar(select(NotificationEndpoint).where(NotificationEndpoint.user_id == user.id, NotificationEndpoint.channel == NotificationChannel.email)) is None:
        session.add(
            NotificationEndpoint(
                user_id=user.id,
                channel=NotificationChannel.email,
                endpoint_value="ada@example.com",
                is_verified=True,
            )
        )

    house_district = session.scalar(
        select(District).where(District.jurisdiction_id == refs["jurisdiction"].id, District.code == "64B")
    )
    senate_district = session.scalar(
        select(District).where(District.jurisdiction_id == refs["jurisdiction"].id, District.code == "64")
    )
    if session.scalar(select(SavedPlace).where(SavedPlace.user_id == user.id, SavedPlace.label == "Home")) is None:
        session.add(
            SavedPlace(
                user_id=user.id,
                label="Home",
                address_text="Saint Paul, MN",
                city="Saint Paul",
                state_code="MN",
                house_district_id=house_district.id if house_district else None,
                senate_district_id=senate_district.id if senate_district else None,
                is_default=True,
            )
        )

    for bill in bills:
        if session.scalar(select(TrackedBill).where(TrackedBill.user_id == user.id, TrackedBill.bill_id == bill.id)) is None:
            session.add(TrackedBill(user_id=user.id, bill_id=bill.id, alerts_enabled=True))

    chat_session = session.scalar(select(ChatSession).where(ChatSession.user_id == user.id, ChatSession.title == "Demo Session"))
    if chat_session is None:
        chat_session = ChatSession(user_id=user.id, title="Demo Session", subject_bill_id=bills[0].id)
        session.add(chat_session)
        session.flush()
        session.add_all(
            [
                ChatMessage(session_id=chat_session.id, role=ChatRole.user, content="What does this bill do?"),
                ChatMessage(
                    session_id=chat_session.id,
                    role=ChatRole.assistant,
                    content="This bill establishes a jobs and workforce budget package.",
                    citation_payload={"bill_key": bills[0].bill_key},
                ),
            ]
        )
    return user


def refresh_legislator_stats(session: Session, refs: dict[str, Any]) -> None:
    legislators = session.scalars(select(Legislator)).all()
    for legislator in legislators:
        stats = session.scalar(
            select(LegislatorStats).where(
                LegislatorStats.legislator_id == legislator.id,
                LegislatorStats.session_id == refs["session"].id,
            )
        )
        if stats is None:
            stats = LegislatorStats(legislator_id=legislator.id, session_id=refs["session"].id)
            session.add(stats)
        sponsorships = session.scalars(select(Sponsorship).where(Sponsorship.legislator_id == legislator.id)).all()
        stats.total_bill_count = len(sponsorships)
        stats.chief_bill_count = len([s for s in sponsorships if s.role == SponsorshipRole.chief_author])
        stats.vote_record_count = 0
        stats.committee_count = 0


def main() -> None:
    database_url = os.environ.get(
        "DATABASE_URL", "postgresql+psycopg://alethical:alethical@localhost:54329/alethical"
    )
    engine = create_engine(database_url, echo=False)
    with Session(engine) as session:
        refs = seed_reference_data(session)
        ingest_member_profiles(session, refs)

        bill_files = [
            (ROOT / "prototype-output" / "bill-sf1832.json", ROOT / "prototype-output" / "rag-bill-sf1832.json"),
            (ROOT / "prototype-output" / "bill-sf2483.json", ROOT / "prototype-output" / "rag-bill-sf2483.json"),
        ]
        bills = []
        for bill_path, rag_path in bill_files:
            bill = ingest_bill_payload(session, refs, read_json(bill_path), read_json(rag_path))
            bills.append(bill)

        user = seed_user_features(session, bills, refs)
        refresh_legislator_stats(session, refs)
        session.commit()
        print("loaded_bills", len(bills))
        print("loaded_user", user.primary_email)


if __name__ == "__main__":
    main()
