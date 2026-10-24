from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import delete, text
from sqlalchemy.orm import Session

from alethical.db import models as schema
from alethical.db.session import get_engine
from alethical.pipeline import record_refresh as runner
from alethical.pipeline.campaign_finance_report_documents import DocumentOutcome
from scripts import backfill_campaign_finance_filed_dates as dates

JOB = runner.RefreshJob(
    "filing-dates-recent",
    timedelta(hours=1),
    timedelta(minutes=5),
    ("unused",),
    "https://cfb.mn.gov/",
    "test",
    lane="filing-dates",
)


def wanted(row_number, year=2026):
    return dates.Wanted(
        registration_number=f"{10000 + row_number}",
        filing_year=year,
        report_type="YE",
        special_election=False,
        amendment_index=0,
        row_number=row_number,
        kind=schema.CampaignFinanceFilerKind.candidate_committee,
    )


@pytest.fixture
def engine(seed_database):
    engine = get_engine()
    with Session(engine) as db:
        db.execute(delete(schema.SourceRefreshAttempt))
        db.execute(delete(schema.SourceRefreshState))
        db.commit()
    yield engine
    with Session(engine) as db:
        db.execute(delete(schema.SourceRefreshAttempt))
        db.execute(delete(schema.SourceRefreshState))
        db.commit()


@pytest.fixture
def live_snapshot(engine):
    """Publish a filings snapshot for the pass, restoring the previous pointer after."""
    with Session(engine) as db:
        current = db.get(schema.CampaignFinanceFilingCurrentSnapshot, True)
        previous = current.snapshot_id if current else None

    def publish():
        with Session(engine) as db:
            now = datetime.now(UTC)
            snapshot = schema.CampaignFinanceFilingSnapshot(
                fetch_started_at=now,
                fetch_completed_at=now,
                status=schema.CampaignFinanceSnapshotStatus.loaded,
            )
            db.add(snapshot)
            db.flush()
            pointer = db.get(schema.CampaignFinanceFilingCurrentSnapshot, True)
            if pointer is None:
                pointer = schema.CampaignFinanceFilingCurrentSnapshot(id=True)
                db.add(pointer)
            pointer.snapshot_id = snapshot.id
            db.commit()
            return str(snapshot.id)

    yield publish
    with Session(engine) as db:
        db.execute(
            text("UPDATE cf_filing_current SET snapshot_id=:previous"),
            {"previous": previous},
        )
        db.commit()


@pytest.fixture
def source(monkeypatch):
    """Board answers by row number; every stored date is recorded, not written."""
    answers = {}
    asked = []
    stored = []

    def fetch(http, *, registration_number, **kwargs):
        row = int(registration_number) - 10000
        asked.append(row)
        outcome = answers.get(row, DocumentOutcome.served)
        return SimpleNamespace(body=b"pdf"), outcome, None

    def store(db, snapshot_id, item, filed_date):
        stored.append(item.row_number)
        return True

    monkeypatch.setattr(dates, "fetch_document", fetch)
    monkeypatch.setattr(dates, "extract_lines", lambda body: (["stamp"], 1))
    monkeypatch.setattr(
        dates, "filed_date_from_lines", lambda lines: (date(2026, 10, 1), [])
    )
    monkeypatch.setattr(dates, "_store", store)
    monkeypatch.setattr(dates, "REQUEST_SPACING_SECONDS", 0)
    monkeypatch.setattr(dates, "http_session", lambda: SimpleNamespace(close=lambda: 0))
    monkeypatch.setattr(dates, "DatabaseRequestLimiter", lambda engine: None)
    monkeypatch.setattr(dates, "RateLimitedSession", lambda session, limiter: session)
    return SimpleNamespace(answers=answers, asked=asked, stored=stored)


def claim(engine):
    with Session(engine) as db:
        result = runner.claim_job(db, JOB, force=True)
    assert result is not None
    return str(result.token)


def turn(engine, token, *, limit=2, seconds=120):
    return dates.run_batch(
        engine,
        name=JOB.name,
        token=token,
        year_from=2025,
        limit=limit,
        max_seconds=seconds,
        carry_forward=False,
        progress=lambda message: None,
    )


def test_unavailable_reports_do_not_stop_later_reports_being_dated(
    engine, live_snapshot, source, monkeypatch
):
    snapshot_id = live_snapshot()
    items = [wanted(1), wanted(2), wanted(3)]
    # Undated reports stay wanted; only the saved position moves past them.
    monkeypatch.setattr(dates, "_wanted", lambda db, snapshot, year: list(items))
    source.answers[1] = DocumentOutcome.not_found
    token = claim(engine)

    first = turn(engine, token)
    assert first.exit_code == 75
    assert source.asked == [1, 2]
    assert source.stored == [2]

    second = turn(engine, token)
    assert source.asked == [1, 2, 3]
    assert source.stored == [2, 3]
    # The finished pass reports what the whole pass did, then starts over next time.
    assert second.asked == 3 and second.dated == 2
    assert second.finding()["filings_snapshot_id"] == snapshot_id
    assert second.exit_code == 2
    assert "filing_date_pass" not in runner.load_progress(engine, JOB.name, token)


def test_a_newly_published_register_restarts_the_pass(
    engine, live_snapshot, source, monkeypatch
):
    live_snapshot()
    monkeypatch.setattr(
        dates, "_wanted", lambda db, snapshot, year: [wanted(1), wanted(2), wanted(3)]
    )
    token = claim(engine)
    turn(engine, token)
    assert source.asked == [1, 2]

    live_snapshot()
    result = turn(engine, token)
    # Saved position belonged to the older register, so the new one starts at row 1.
    assert source.asked == [1, 2, 1, 2]
    assert result.asked == 2
    assert result.exit_code == 75


def test_deadline_saves_position_without_claiming_completion(
    engine, live_snapshot, source, monkeypatch
):
    live_snapshot()
    monkeypatch.setattr(
        dates, "_wanted", lambda db, snapshot, year: [wanted(1), wanted(2)]
    )
    clock = iter([0.0, 0.0])
    monkeypatch.setattr(
        dates,
        "time",
        SimpleNamespace(monotonic=lambda: next(clock, 500.0), sleep=lambda s: None),
    )
    token = claim(engine)
    result = turn(engine, token, limit=25, seconds=120)
    assert source.asked == [1]
    assert result.exit_code == 75 and result.incomplete
    saved = runner.load_progress(engine, JOB.name, token)["filing_date_pass"]
    assert saved["after_key"] == [-2026, "10001", 1]


def test_a_turn_that_lost_its_owner_writes_no_date(
    engine, live_snapshot, source, monkeypatch
):
    live_snapshot()
    monkeypatch.setattr(dates, "_wanted", lambda db, snapshot, year: [wanted(1)])
    token = claim(engine)

    def expire(*args, **kwargs):
        with Session(engine) as db:
            db.execute(
                text(
                    "UPDATE source_refresh_state SET lease_expires_at=clock_timestamp()"
                    " WHERE name=:name"
                ),
                {"name": JOB.name},
            )
            db.commit()
        return SimpleNamespace(body=b"pdf"), DocumentOutcome.served, None

    monkeypatch.setattr(dates, "fetch_document", expire)
    with pytest.raises(RuntimeError, match="lost its owner"):
        turn(engine, token)
    assert source.stored == []
