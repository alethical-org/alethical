"""Activity aggregation preserves its figures with a bounded number of reads."""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy import event, text
from sqlalchemy.orm import Session

from alethical.api.routers.site_metrics import (
    CREATION_RESPONSE_KEYS,
    EVENT_RESPONSE_KEYS,
    site_metric_data,
)
from scripts.check_schema_drift import ScratchDatabase, _local_base_url


NOW = datetime(2026, 3, 8, 10, 37, tzinfo=timezone.utc)
END = NOW.replace(minute=0)


@pytest.fixture(scope="module", autouse=True)
def seed_database():
    """This module uses its own randomly named local database."""


@pytest.fixture
def db(monkeypatch):
    for name in (
        "ALETHICAL_ADMIN_ACCOUNT_IDS",
        "ALETHICAL_TEST_ACCOUNT_IDS",
        "TRAFFIC_EXCLUDED_ACCOUNT_IDS",
    ):
        monkeypatch.delenv(name, raising=False)
    with ScratchDatabase(_local_base_url(), "site_metric_queries") as scratch:
        engine = scratch.engine()
        try:
            with engine.begin() as conn:
                for statement in (
                    "CREATE TABLE user_account (id uuid PRIMARY KEY, primary_email text, is_active boolean)",
                    "CREATE TABLE auth_identity (user_id uuid, email text, provider text, provider_subject text)",
                    "CREATE TABLE site_metric_event (id uuid PRIMARY KEY, event_kind text, created_at timestamptz)",
                    "CREATE TABLE site_metric_hourly_count (metric_kind text, bucket_started_at timestamptz, count bigint)",
                    "CREATE TABLE site_metric_coverage (metric_kind text PRIMARY KEY, recording_started_at timestamptz)",
                    "CREATE TABLE tracked_bill (id uuid PRIMARY KEY, user_id uuid, bill_id uuid, UNIQUE(user_id,bill_id))",
                    "CREATE TABLE tracked_committee (id uuid PRIMARY KEY, user_id uuid, registration_number text, UNIQUE(user_id,registration_number))",
                ):
                    conn.execute(text(statement))
                with Session(bind=conn, autoflush=False) as session:
                    yield session
        finally:
            engine.dispose()


def read_with_query_bound(db):
    statements = []

    def record(_conn, _cursor, statement, _parameters, _context, _many):
        statements.append(statement)

    connection = db.get_bind()
    event.listen(connection, "before_cursor_execute", record)
    try:
        result = site_metric_data(db, now=NOW)
    finally:
        event.remove(connection, "before_cursor_execute", record)
    assert len(statements) == 6
    assert all(
        statement.lstrip().upper().startswith("SELECT") for statement in statements
    )
    return result


def test_empty_activity_returns_zero_totals_and_unknown_past_coverage_in_six_reads(db):
    result = read_with_query_bound(db)
    assert all(value == 0 for value in result["actions7d"].values())
    assert all(value == 0 for value in result["actions30d"].values())
    assert all(value == 0 for value in result["totalsSinceStart"].values())
    assert all(value == 0 for value in result["readers"].values())
    assert all(value is None for value in result["previousActions7d"].values())
    assert all(value is None for value in result["previousActions30d"].values())


def test_all_event_and_creation_windows_keep_exact_utc_boundaries(db):
    # Include exact starts/ends, the unfinished hour, and lifetime-only history.
    dates = [
        END - timedelta(days=61),
        END - timedelta(days=60),
        END - timedelta(days=30, microseconds=1),
        END - timedelta(days=30),
        END - timedelta(days=14),
        END - timedelta(days=7, microseconds=1),
        END - timedelta(days=7),
        END - timedelta(microseconds=1),
        END,
        NOW,
    ]
    for kind in EVENT_RESPONSE_KEYS:
        db.execute(
            text("INSERT INTO site_metric_event VALUES (:id,:kind,:at)"),
            [{"id": uuid4(), "kind": kind, "at": at} for at in dates],
        )
    for kind in CREATION_RESPONSE_KEYS:
        db.execute(
            text("INSERT INTO site_metric_hourly_count VALUES (:kind,:at,:count)"),
            [
                {"kind": kind, "at": at, "count": index + 1}
                for index, at in enumerate(dates)
            ],
        )
    for kind in (*EVENT_RESPONSE_KEYS, *CREATION_RESPONSE_KEYS):
        db.execute(
            text("INSERT INTO site_metric_coverage VALUES (:kind,:at)"),
            {
                "kind": kind,
                "at": END - timedelta(days=60),
            },
        )

    result = read_with_query_bound(db)

    for key in EVENT_RESPONSE_KEYS.values():
        assert result["actions7d"][key] == 2
        assert result["actions30d"][key] == 5
        assert result["previousActions7d"][key] == 2
        assert result["previousActions30d"][key] == 2
    for key in CREATION_RESPONSE_KEYS.values():
        assert result["actions7d"][key] == 15
        assert result["actions30d"][key] == 30
        assert result["previousActions7d"][key] == 11
        assert result["previousActions30d"][key] == 5
        assert result["totalsSinceStart"][key] == 36
    assert result["periods7d"]["endsAt"] == END.isoformat()
    assert result["periods30d"]["endsAt"] == END.isoformat()
    assert result["fetchedAt"] == NOW.isoformat()

    db.execute(
        text(
            "UPDATE site_metric_coverage SET recording_started_at=:at WHERE metric_kind=:kind"
        ),
        {
            "kind": "bill_search_with_results",
            "at": END - timedelta(days=14) + timedelta(microseconds=1),
        },
    )
    partial = read_with_query_bound(db)
    assert partial["previousActions7d"]["billSearchesWithResults"] is None
    assert partial["previousActions30d"]["billSearchesWithResults"] is None
    assert partial["actions7d"] == result["actions7d"]
    assert partial["previousActions7d"]["moneySearchesWithResults"] == 2


def test_reader_and_follow_counts_deduplicate_people_and_omit_every_excluded_account(
    db, monkeypatch
):
    reader_a, reader_b, primary_team, linked_team, explicit_test, inactive = [
        uuid4() for _ in range(6)
    ]
    rows = [
        (reader_a, "a@reader.us", True),
        (reader_b, "b@reader.us", True),
        (primary_team, "elopinmisc+preview@gmail.com", True),
        (linked_team, "ordinary@reader.us", True),
        (explicit_test, "ordinary-test@reader.us", True),
        (inactive, "inactive@reader.us", False),
    ]
    db.execute(
        text("INSERT INTO user_account VALUES (:id,:email,:active)"),
        [
            {"id": ident, "email": email, "active": active}
            for ident, email, active in rows
        ],
    )
    monkeypatch.setenv("ALETHICAL_TEST_ACCOUNT_IDS", "configured-test")
    db.execute(
        text("INSERT INTO auth_identity VALUES (:id,:email,'supabase',:subject)"),
        [
            {
                "id": linked_team,
                "email": "r.o.h.a.n.m.i.s.h.r.a.1.9.9.7+preview@googlemail.com",
                "subject": "linked-team",
            },
            {
                "id": explicit_test,
                "email": "ordinary-test@reader.us",
                "subject": "configured-test",
            },
        ],
    )
    shared_bill, other_bill, hidden_bill = [uuid4() for _ in range(3)]
    for user_id, bill_id in (
        (reader_a, shared_bill),
        (reader_a, other_bill),
        (reader_b, shared_bill),
        *(
            (user_id, hidden_bill)
            for user_id in (primary_team, linked_team, explicit_test, inactive)
        ),
    ):
        db.execute(
            text("INSERT INTO tracked_bill VALUES (:id,:user_id,:bill_id)"),
            {
                "id": uuid4(),
                "user_id": user_id,
                "bill_id": bill_id,
            },
        )
    for user_id, registration in (
        (reader_a, "shared"),
        (reader_a, "other"),
        (reader_b, "shared"),
        *(
            (user_id, "hidden")
            for user_id in (primary_team, linked_team, explicit_test, inactive)
        ),
    ):
        db.execute(
            text("INSERT INTO tracked_committee VALUES (:id,:user_id,:registration)"),
            {
                "id": uuid4(),
                "user_id": user_id,
                "registration": registration,
            },
        )

    result = read_with_query_bound(db)

    assert result["readers"] == {
        "registeredReaders": 2,
        "currentReaderAccounts": 2,
        "currentBillWatches": 3,
        "differentBillsCurrentlyWatched": 2,
        "currentBillFollowingReaders": 2,
        "currentCommitteeFollowingReaders": 2,
        "currentCommitteeWatches": 3,
        "differentCommitteesCurrentlyWatched": 2,
    }
    assert all(value == 0 for value in result["totalsSinceStart"].values())
