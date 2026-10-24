"""A partial or unrelated copy cannot make older legislative records look fresh."""

from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from alethical.api.services.legislative_freshness import legislative_copy_date
from alethical.api.services.legislative_sessions import current_legislature_scope
from alethical.db.models import Bill, IngestionRun, IngestionStatus
from alethical.db.session import get_session_factory

OLD = datetime(2026, 7, 1, tzinfo=UTC)
NEW = datetime(2026, 10, 1, tzinfo=UTC)


@pytest.fixture()
def corpus():
    with get_session_factory()() as db:
        scope = current_legislature_scope(db)
        bills = list(db.scalars(select(Bill).where(Bill.session_id.in_(scope.ids))))
        assert len(bills) >= 2
        for index, bill in enumerate(bills):
            run = IngestionRun(
                adapter="minnesota_live",
                target_type="bill",
                target_key=bill.bill_key,
                status=IngestionStatus.succeeded,
                finished_at=OLD,
            )
            db.add(run)
            db.flush()
            bill.ingestion_run_id = run.id
        db.flush()
        try:
            yield db, scope, bills
        finally:
            db.rollback()


def test_unrelated_money_copy_and_single_bill_refresh_do_not_date_whole_corpus(corpus):
    db, scope, bills = corpus
    db.add(
        IngestionRun(
            adapter="campaign_finance",
            target_type="payments",
            status=IngestionStatus.succeeded,
            finished_at=NEW,
        )
    )
    db.get(IngestionRun, bills[0].ingestion_run_id).finished_at = NEW
    db.flush()
    assert legislative_copy_date(db, scope.ids) == OLD
    assert legislative_copy_date(db, scope.ids, bill_ids=[bills[0].id]) == NEW


@pytest.mark.parametrize("missing", ["no_run", "failed", "unfinished", "wrong_source"])
def test_missing_evidence_cannot_be_ignored_in_shared_date(corpus, missing):
    db, scope, bills = corpus
    run = db.get(IngestionRun, bills[0].ingestion_run_id)
    if missing == "no_run":
        bills[0].ingestion_run_id = None
    elif missing == "failed":
        run.status = IngestionStatus.failed
    elif missing == "unfinished":
        run.finished_at = None
    else:
        run.target_type = "payments"
    db.flush()
    assert legislative_copy_date(db, scope.ids) is None
    assert legislative_copy_date(db, scope.ids, bill_ids=[bills[1].id]) == OLD


def test_roster_needs_own_completed_source_copy_for_current_session(corpus):
    db, scope, _ = corpus
    assert legislative_copy_date(db, scope.ids, roster_slug="unheld-session") is None
    roster = IngestionRun(
        adapter="minnesota_live",
        target_type="legislator_roster",
        target_key=scope.primary.slug,
        stats={"members_seen": 201, "members_ingested": 201},
        status=IngestionStatus.succeeded,
        finished_at=datetime(2026, 6, 1, tzinfo=UTC),
    )
    db.add(roster)
    db.flush()
    assert (
        legislative_copy_date(db, scope.ids, roster_slug=scope.primary.slug)
        == roster.finished_at
    )
    roster.finished_at = NEW
    db.flush()
    assert legislative_copy_date(db, scope.ids, roster_slug=scope.primary.slug) == OLD


def test_unheld_scope_and_empty_selection_stay_unknown(corpus):
    db, scope, _ = corpus
    assert legislative_copy_date(db, []) is None
    assert legislative_copy_date(db, scope.ids, bill_ids=[]) is None


def test_meta_and_ask_use_source_scoped_date(corpus, monkeypatch):
    from alethical.api.routers import ask, public

    db, scope, _ = corpus
    seen = []

    def dated(db, ids, **kwargs):
        seen.append((tuple(ids), kwargs))
        return OLD

    monkeypatch.setattr(public, "legislative_copy_date", dated)
    monkeypatch.setattr(ask, "legislative_copy_date", dated)
    assert public.latest_ingested_at(db) == OLD
    assert (
        ask._topic_bills_answer(db, "", session_ids=[scope.primary.id]).data_as_of
        == OLD
    )
    assert ask._topic_legislators_answer(db, "").data_as_of == OLD
    assert seen == [
        (scope.ids, {"roster_slug": scope.primary.slug}),
        ((scope.primary.id,), {}),
        (scope.ids, {"roster_slug": scope.primary.slug}),
    ]


def test_partial_or_empty_roster_does_not_supply_a_shared_date(corpus):
    db, scope, _ = corpus
    for stats in (
        {},
        {"members_seen": 201, "members_ingested": 1},
        {"members_seen": 0, "members_ingested": 0},
    ):
        db.add(
            IngestionRun(
                adapter="minnesota_live",
                target_type="legislator_roster",
                target_key=scope.primary.slug,
                status=IngestionStatus.succeeded,
                finished_at=NEW,
                stats=stats,
            )
        )
    db.flush()
    assert legislative_copy_date(db, scope.ids, roster_slug=scope.primary.slug) is None
    complete = IngestionRun(
        adapter="minnesota_live",
        target_type="legislator_roster",
        target_key=scope.primary.slug,
        status=IngestionStatus.succeeded,
        finished_at=OLD,
        stats={"members_seen": 201, "members_ingested": 201},
    )
    db.add(complete)
    db.flush()
    assert legislative_copy_date(db, scope.ids, roster_slug=scope.primary.slug) == OLD
