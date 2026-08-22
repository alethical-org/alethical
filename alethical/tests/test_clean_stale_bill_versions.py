from __future__ import annotations

import hashlib

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from alethical.db import models as schema
from alethical.db.session import get_engine
from scripts import clean_stale_bill_versions


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def test_stale_version_backup_round_trip_includes_every_appendix_reference(
    seed_database: None,
) -> None:
    with Session(get_engine()) as db:
        session_id = db.scalar(select(schema.LegislativeSession.id))
        chamber_id = db.scalar(select(schema.Chamber.id))
        assert session_id is not None and chamber_id is not None
        bill = schema.Bill(
            session_id=session_id,
            chamber_id=chamber_id,
            bill_key="test-2025-HF457108",
            file_type="HF",
            file_number=457108,
            title="Cleanup backup appendix fixture",
        )
        db.add(bill)
        db.flush()
        version = schema.BillVersion(
            bill_id=bill.id,
            version_code="stale-cleanup-test",
            sequence_number=1,
            is_current=False,
        )
        db.add(version)
        db.flush()
        section_text = "Old session law reference text."
        section = schema.BillVersionSection(
            bill_version_id=version.id,
            section_id_text="laws.0.1.0",
            source_order=1,
            raw_text=section_text,
            source_hash=_hash(section_text),
        )
        db.add(section)
        db.flush()
        statute_text = "Old statute reference text."
        db.add_all(
            [
                schema.BillVersionAppendixReference(
                    bill_version_id=version.id,
                    source_order=1,
                    reference_kind="repealed_statute",
                    official_reference="Minnesota Statutes, section 1.01",
                    raw_text=statute_text,
                    body_blocks=[],
                    source_hash=_hash(statute_text),
                ),
                schema.BillVersionAppendixReference(
                    bill_version_id=version.id,
                    source_order=2,
                    reference_kind="repealed_session_law",
                    official_reference="Laws 2025, chapter 1, section 1",
                    source_hash=_hash(section_text),
                    bill_version_section_id=section.id,
                ),
            ]
        )
        db.flush()
        version_ids = [str(version.id)]

        candidate_counts = clean_stale_bill_versions._counts_batch(db, [version.id])
        before = clean_stale_bill_versions._row_counts(db, version_ids)
        backup = clean_stale_bill_versions._back_up(db, version_ids)

        assert candidate_counts[str(version.id)]["appendix_references"] == 2
        assert before["bill_version_appendix_reference"] == 2
        assert backup["bill_version_appendix_reference"]

        clean_stale_bill_versions._delete_subtree(db, version_ids)
        assert (
            db.scalar(
                select(func.count(schema.BillVersionAppendixReference.id)).where(
                    schema.BillVersionAppendixReference.bill_version_id == version.id
                )
            )
            == 0
        )

        clean_stale_bill_versions._restore(db, backup)
        assert clean_stale_bill_versions._row_counts(db, version_ids) == before
        assert clean_stale_bill_versions._differences(db, backup, version_ids) == 0
        db.rollback()
