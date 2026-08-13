from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from alethical.db.models import Legislator, LegislatorServicePeriod
from alethical.db.session import get_engine
from alethical.pipeline.minnesota import MinnesotaIngestionPipeline
from scripts.repair_vote_roster_identities import (
    backup_vote_roster_identities,
    repair_vote_roster_identities,
)


def test_repair_vote_roster_identities_is_dry_run_then_idempotent(
    seed_database: None,
) -> None:
    with Session(get_engine()) as db:
        pipeline = MinnesotaIngestionPipeline(db)
        refs = pipeline.seed_reference_data()
        aliases = {
            "15301": ("Paul Anderson", "Anderson, Paul", "12A"),
            "15610": ("Patti Anderson", "Anderson, Patti", "33A"),
            "15576": ("Liz Lee", "Lee, Liz", "67A"),
        }
        legislators: dict[str, Legislator] = {}
        for member_key, (full_name, sort_name, district_code) in aliases.items():
            legislator = pipeline.upsert_legislator(
                refs,
                full_name,
                external_key=f"https://www.house.mn.gov/members/profile/{member_key}",
            )
            legislator.sort_name = sort_name
            legislators[member_key] = legislator
            district = pipeline.upsert_district(
                refs, refs["chambers"]["house"], district_code
            )
            pipeline.upsert_service_period(
                refs, legislator, refs["chambers"]["house"], district, {}
            )

        amanda = pipeline.upsert_legislator(
            refs,
            "Senator Amanda H. Hemmingsen-Jaeger",
            external_key=(
                "http://www.senate.leg.state.mn.us/members/member_bio.php?leg_id=15620"
            ),
        )
        # Recreate the bad stored title because upsert now prevents new ones.
        amanda.full_name = "Senator Amanda H. Hemmingsen-Jaeger"
        amanda.sort_name = "Senator Amanda H. Hemmingsen-Jaeger"
        senate_district = pipeline.upsert_district(
            refs, refs["chambers"]["senate"], "47"
        )
        pipeline.upsert_district(refs, refs["chambers"]["house"], "47A")
        pipeline.upsert_service_period(
            refs, amanda, refs["chambers"]["senate"], senate_district, {}
        )
        db.flush()

        dry_run = repair_vote_roster_identities(db, dry_run=True)
        assert dry_run.title_names >= 1
        assert dry_run.official_sort_names == 3
        assert dry_run.house_service_periods == 1
        assert amanda.full_name.startswith("Senator ")
        backup = backup_vote_roster_identities(db)
        assert len(backup["amanda_service_periods"]) == 1
        assert any(
            row["full_name"] == "Senator Amanda H. Hemmingsen-Jaeger"
            for row in backup["legislators"]
        )

        applied = repair_vote_roster_identities(db, dry_run=False)
        assert applied == dry_run
        assert amanda.full_name == "Amanda H. Hemmingsen-Jaeger"
        assert legislators["15301"].sort_name == "Anderson, P. H."
        assert legislators["15610"].sort_name == "Anderson, P. E."
        assert legislators["15576"].sort_name == "Lee, K."
        periods = db.scalars(
            select(LegislatorServicePeriod)
            .where(LegislatorServicePeriod.legislator_id == amanda.id)
            .order_by(LegislatorServicePeriod.period_sequence)
        ).all()
        assert [(row.period_sequence, row.is_current) for row in periods] == [
            (1, False),
            (2, True),
        ]

        repeated = repair_vote_roster_identities(db, dry_run=False)
        assert repeated.title_names == 0
        assert repeated.official_sort_names == 0
        assert repeated.house_service_periods == 0
