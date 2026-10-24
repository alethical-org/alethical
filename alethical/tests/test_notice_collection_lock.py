"""Shared notice amendments serialize short writes, independently of money."""

from datetime import UTC, datetime
import json
from types import SimpleNamespace

import pytest
from sqlalchemy import delete, select, text
from sqlalchemy.orm import Session

from alethical.db import models as schema
from alethical.db.session import get_engine
from alethical.pipeline import campaign_finance_notices as notices
from alethical.pipeline.notice_collection_lock import (
    hold_notice_writer,
    notice_commit,
    NoticeWriterBusy,
    NoticeWriterLost,
    KEY,
)


@pytest.fixture
def engine(seed_database):
    engine = get_engine()
    with Session(engine) as db:
        db.execute(delete(schema.CampaignFinanceRefreshState))
        db.commit()
    return engine


def test_money_and_distinct_collectors_can_start_but_same_collector_cannot(engine):
    with (
        Session(engine) as money,
        Session(engine) as notice,
        Session(engine) as statement,
    ):
        # The legacy money lease uses a different durable key.
        with hold_notice_writer(money, key="full_run_lease"):
            with hold_notice_writer(notice, key="notice_collector"):
                with hold_notice_writer(statement, key="statement_collector"):
                    with Session(engine) as other:
                        with pytest.raises(NoticeWriterBusy):
                            with hold_notice_writer(other, key="notice_collector"):
                                pass


def test_statement_amendment_and_notice_mutation_share_one_short_lock(engine):
    with Session(engine) as notice, Session(engine) as statement:
        with hold_notice_writer(notice, key="notice_collector"):
            with hold_notice_writer(statement, key="statement_collector"):
                with hold_notice_writer(statement):
                    with pytest.raises(NoticeWriterBusy):
                        with hold_notice_writer(notice):
                            pass
                # Notice work can begin before the full statement scan ends.
                with hold_notice_writer(notice):
                    notice_commit(notice)


def test_expired_owner_cannot_commit_or_delete_replacement_lock(engine):
    with Session(engine) as old, Session(engine) as replacement:
        with hold_notice_writer(old):
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "UPDATE cf_refresh_state SET value=value || CAST(:value AS jsonb) WHERE key=:key"
                    ),
                    {
                        "key": KEY,
                        "value": json.dumps({"expires_at": "2000-01-01T00:00:00Z"}),
                    },
                )
            with hold_notice_writer(replacement):
                old.add(
                    schema.CampaignFinanceNoticeListCopy(
                        fetched_at=datetime.now(UTC),
                        page_sha256="a" * 64,
                        notice_count=123456,
                        covered_years=[2026],
                        source_url="https://example.test",
                    )
                )
                with pytest.raises(NoticeWriterLost):
                    notice_commit(old)
                assert (
                    replacement.scalar(
                        select(schema.CampaignFinanceRefreshState).where(
                            schema.CampaignFinanceRefreshState.key == KEY
                        )
                    )
                    is not None
                )
        with Session(engine) as db:
            assert (
                db.scalar(
                    select(schema.CampaignFinanceNoticeListCopy).where(
                        schema.CampaignFinanceNoticeListCopy.notice_count == 123456
                    )
                )
                is None
            )


@pytest.mark.parametrize(
    "scope,current,not_served",
    [("all only 123", True, []), ("all", False, []), ("all", True, ["source refused"])],
)
def test_partial_or_stale_statement_scan_never_dates_the_full_copy(
    engine, monkeypatch, scope, current, not_served
):
    monkeypatch.setattr(
        notices.filings,
        "fetch_catalogue",
        lambda *a: (SimpleNamespace(status_code=200, json=lambda: {}), [], []),
    )
    monkeypatch.setattr(notices, "parse_catalogue_statements", lambda *a: ([], []))
    monkeypatch.setattr(notices, "record_catalogue_statements", lambda *a: (0, 0, None))
    monkeypatch.setattr(notices, "parse_catalogue_notice_amendments", lambda *a: {})
    monkeypatch.setattr(
        notices, "fetch_missing_statement_pdfs", lambda *a, **k: (0, [], not_served)
    )
    with Session(engine) as db:
        before = len(db.scalars(select(schema.CampaignFinanceStatementScan)).all())
        report = notices.scan_catalogues_for_statements(
            db,
            None,
            None,
            filers=[(schema.CampaignFinanceFilerKind.candidate_committee, "123")],
            segment=(2025, 2026),
            scope=scope,
            dry_run=False,
            spacing_seconds=0,
            completion_check=lambda: current,
        )
        assert (
            len(db.scalars(select(schema.CampaignFinanceStatementScan)).all()) == before
        )
        if not current:
            assert report.failures


def test_reference_materializes_rows_before_pruning_and_rejects_changed_pointer(engine):
    from alethical.pipeline.campaign_notice_reference import load_reference

    now = datetime.now(UTC)
    with Session(engine) as db:
        previous = db.get(schema.CampaignFinanceFilingCurrentSnapshot, True)
        previous_id = previous.snapshot_id if previous else None
        snapshot = schema.CampaignFinanceFilingSnapshot(
            fetch_started_at=now,
            fetch_completed_at=now,
            status=schema.CampaignFinanceSnapshotStatus.loaded,
            filer_count=2,
        )
        db.add(snapshot)
        db.flush()
        db.add(
            schema.CampaignFinanceFiler(
                snapshot_id=snapshot.id,
                registration_number="999998",
                name="Reference",
                kind=schema.CampaignFinanceFilerKind.candidate_committee,
                candidate_name="Source Name",
                office="House",
                district="1A",
            )
        )
        if previous is None:
            previous = schema.CampaignFinanceFilingCurrentSnapshot(id=True)
            db.add(previous)
        previous.snapshot_id = snapshot.id
        db.commit()
        with pytest.raises(ValueError, match="incomplete"):
            load_reference(engine)
        snapshot.filer_count = 1
        db.commit()
        db.add(
            schema.CampaignFinanceFiler(
                snapshot_id=snapshot.id,
                registration_number="999997",
                name="Retained source filer",
                kind=schema.CampaignFinanceFilerKind.party_unit,
                retained_from_snapshot_id=snapshot.id,
            )
        )
        db.commit()
        reference = load_reference(engine)
        db.execute(
            delete(schema.CampaignFinanceFiler).where(
                schema.CampaignFinanceFiler.snapshot_id == snapshot.id
            )
        )
        previous.snapshot_id = previous_id
        db.commit()
        assert (
            next(
                f for f in reference.filers if f.registration_number == "999998"
            ).candidate_name
            == "Source Name"
        )
        assert len(reference.filers) == 2
        assert not reference.still_current(db)
        db.rollback()
        db.delete(snapshot)
        db.commit()
