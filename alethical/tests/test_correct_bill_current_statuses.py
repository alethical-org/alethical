from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy.orm import Session

from alethical.db.models import Bill, BillAction
from alethical.db.session import get_engine
from alethical.pipeline.minnesota import MinnesotaIngestionPipeline
from scripts.correct_bill_current_statuses import (
    apply_changes,
    derive_status_changes,
    restore_snapshot,
    write_snapshot,
)


def _seed_wrong_cross_chamber_status(session: Session) -> Bill:
    refs = MinnesotaIngestionPipeline(session).seed_reference_data()
    bill = Bill(
        session_id=refs["session"].id,
        chamber_id=refs["chambers"]["house"].id,
        bill_key="94-2026-HF7990",
        file_type="HF",
        file_number=7990,
        title="Cross-chamber status repair test",
        current_status="Author added",
    )
    session.add(bill)
    session.flush()
    session.add_all(
        [
            BillAction(
                bill_id=bill.id,
                chamber_id=refs["chambers"]["house"].id,
                action_number=25,
                action_text="Author added",
                action_at=datetime(2026, 5, 12, tzinfo=UTC),
            ),
            BillAction(
                bill_id=bill.id,
                chamber_id=refs["chambers"]["senate"].id,
                action_number=7,
                action_text="Third reading Passed as amended",
                action_at=datetime(2026, 5, 15, tzinfo=UTC),
            ),
        ]
    )
    session.flush()
    session.refresh(bill)
    return bill


def test_status_correction_can_be_applied_verified_and_restored(
    seed_database: None, tmp_path
) -> None:
    with Session(get_engine()) as session:
        bill = _seed_wrong_cross_chamber_status(session)
        before_status_key = bill.status_key
        changes = derive_status_changes(session, bill_key=bill.bill_key)

        assert len(changes) == 1
        assert changes[0].after_current_status == "Third reading Passed as amended"
        assert changes[0].selected_chamber == "senate"
        assert changes[0].selected_action_number == 7

        snapshot = tmp_path / "bill-statuses.json"
        write_snapshot(snapshot, changes)
        apply_changes(session, changes)
        assert bill.current_status == "Third reading Passed as amended"

        assert restore_snapshot(session, snapshot) == 1
        assert bill.current_status == "Author added"
        assert bill.status_key == before_status_key

        session.rollback()


def test_status_correction_refuses_a_row_that_changed_after_the_dry_run(
    seed_database: None,
) -> None:
    with Session(get_engine()) as session:
        bill = _seed_wrong_cross_chamber_status(session)
        changes = derive_status_changes(session, bill_key=bill.bill_key)
        bill.current_status = "A newer status arrived"
        session.flush()

        with pytest.raises(RuntimeError, match="changed after the dry run"):
            apply_changes(session, changes)

        session.rollback()
