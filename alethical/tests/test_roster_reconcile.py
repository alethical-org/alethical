from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from alethical.db.models import (
    Legislator,
    LegislativeSession,
    LegislatorServicePeriod,
    SessionType,
)
from alethical.db.session import get_engine
from alethical.pipeline.minnesota import MinnesotaIngestionPipeline
from alethical.pipeline.roster_pdf import RosterMember


def _make_session_slug() -> str:
    return f"test-{uuid.uuid4().hex[:12]}"


def _seed_member(
    pipeline: MinnesotaIngestionPipeline,
    refs: dict,
    session: LegislativeSession,
    *,
    chamber_slug: str,
    district_code: str,
    full_name: str,
) -> LegislatorServicePeriod:
    chamber = refs["chambers"][chamber_slug]
    district = pipeline.upsert_district(refs, chamber, district_code)
    legislator = Legislator(
        jurisdiction_id=refs["jurisdiction"].id,
        slug=f"{full_name.lower().replace(' ', '-')}-{uuid.uuid4().hex[:6]}",
        external_key=f"key-{uuid.uuid4().hex}",
        full_name=full_name,
        sort_name=full_name,
    )
    pipeline.db.add(legislator)
    pipeline.db.flush()
    service_period = LegislatorServicePeriod(
        legislator_id=legislator.id,
        session_id=session.id,
        chamber_id=chamber.id,
        district_id=district.id,
        period_sequence=1,
        is_current=True,
    )
    pipeline.db.add(service_period)
    pipeline.db.flush()
    return service_period


def _setup_scenario(pipeline: MinnesotaIngestionPipeline):
    """Seed a fresh session with four current members across three seats."""
    refs = pipeline.seed_reference_data()
    session = LegislativeSession(
        jurisdiction_id=refs["jurisdiction"].id,
        slug=_make_session_slug(),
        session_number=99,
        session_type=SessionType.regular,
        year_start=2099,
        year_end=2100,
        name="Reconcile test session",
        is_current=False,
    )
    pipeline.db.add(session)
    pipeline.db.flush()

    matched = _seed_member(
        pipeline,
        refs,
        session,
        chamber_slug="house",
        district_code="10A",
        full_name="Jane Match",
    )
    predecessor = _seed_member(
        pipeline,
        refs,
        session,
        chamber_slug="house",
        district_code="20B",
        full_name="Old Predecessor",
    )
    successor = _seed_member(
        pipeline,
        refs,
        session,
        chamber_slug="house",
        district_code="20B",
        full_name="New Successor",
    )
    vacated = _seed_member(
        pipeline,
        refs,
        session,
        chamber_slug="senate",
        district_code="30",
        full_name="Gone Member",
    )

    roster = [
        RosterMember("house", "10A", "Match", "Jane", "DFL"),
        RosterMember("house", "20B", "Successor", "New", "R"),
        # senate 30 absent -> vacated; senate 31 present but no DB row -> missing.
        RosterMember("senate", "31", "Newcomer", "Fresh", "DFL"),
    ]
    return (
        session,
        roster,
        {
            "matched": matched,
            "predecessor": predecessor,
            "successor": successor,
            "vacated": vacated,
        },
    )


def test_reconcile_deactivates_departed_and_keeps_current(
    seed_database: None,
) -> None:
    with Session(get_engine()) as db:
        pipeline = MinnesotaIngestionPipeline(db)
        session, roster, sp = _setup_scenario(pipeline)

        report = pipeline.reconcile_current_members(session.slug, roster_members=roster)

        assert report.kept == 2
        deactivated_names = {name for _, _, name in report.deactivated}
        assert deactivated_names == {"Old Predecessor", "Gone Member"}
        assert ("senate", "31", "Newcomer, Fresh") in report.missing

        db.refresh(sp["matched"])
        db.refresh(sp["successor"])
        db.refresh(sp["predecessor"])
        db.refresh(sp["vacated"])
        assert sp["matched"].is_current is True
        assert sp["successor"].is_current is True
        assert sp["predecessor"].is_current is False
        assert sp["vacated"].is_current is False


def test_reconcile_dry_run_writes_nothing(seed_database: None) -> None:
    with Session(get_engine()) as db:
        pipeline = MinnesotaIngestionPipeline(db)
        session, roster, sp = _setup_scenario(pipeline)

        report = pipeline.reconcile_current_members(
            session.slug, roster_members=roster, dry_run=True
        )

        assert report.dry_run is True
        assert {name for _, _, name in report.deactivated} == {
            "Old Predecessor",
            "Gone Member",
        }
        db.refresh(sp["predecessor"])
        db.refresh(sp["vacated"])
        # No writes under dry-run.
        assert sp["predecessor"].is_current is True
        assert sp["vacated"].is_current is True


def test_reconcile_is_idempotent(seed_database: None) -> None:
    with Session(get_engine()) as db:
        pipeline = MinnesotaIngestionPipeline(db)
        session, roster, _ = _setup_scenario(pipeline)

        first = pipeline.reconcile_current_members(session.slug, roster_members=roster)
        second = pipeline.reconcile_current_members(session.slug, roster_members=roster)

        assert len(first.deactivated) == 2
        assert second.deactivated == []
        assert second.kept == 2
