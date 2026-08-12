from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from oban import Oban
from oban.schema import install as install_oban_schema
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from alethical.db.models import IngestionRun, IngestionStatus
from alethical.db.session import get_database_url, get_engine
from alethical.pipeline import bill_refresh
from alethical.pipeline.bill_refresh import (
    CURRENT_SITTING_SCHEDULES,
    RefreshPlan,
    UnknownOfficialSessionError,
    accepted_fingerprint_baseline,
    classify_refresh_results,
    decide_session_refresh,
    parse_official_session_codes,
    scheduled_chunk_job,
    validate_official_session_codes,
)
from alethical.pipeline.minnesota import BillSearchResult, content_hash


def utc(year: int, month: int, day: int, hour: int = 12) -> datetime:
    return datetime(year, month, day, hour, tzinfo=UTC)


@pytest.mark.parametrize(
    ("now", "session_code", "phase", "interval"),
    [
        # The regular-session dates are local Minnesota calendar dates. Before
        # midnight in Minnesota is still the interim even though UTC has rolled
        # into the next date.
        (datetime(2025, 1, 14, 5, 59, tzinfo=UTC), "0942025", "interim", 168),
        (datetime(2025, 1, 14, 6, 0, tzinfo=UTC), "0942025", "regular", 4),
        (datetime(2025, 5, 20, 4, 59, tzinfo=UTC), "0942025", "regular", 4),
        (
            datetime(2025, 5, 20, 5, 0, tzinfo=UTC),
            "0942025",
            "post_adjournment",
            4,
        ),
        (datetime(2025, 6, 2, 23, 59, tzinfo=UTC), "0942025", "post_adjournment", 4),
        (datetime(2025, 6, 3, 12, 0, tzinfo=UTC), "0942025", "interim", 168),
        (datetime(2026, 2, 17, 6, 0, tzinfo=UTC), "0942025", "regular", 4),
        (datetime(2026, 5, 19, 5, 0, tzinfo=UTC), "0942025", "post_adjournment", 4),
        (datetime(2025, 6, 9, 5, 0, tzinfo=UTC), "1942025", "special", 2),
        (datetime(2025, 6, 11, 5, 0, tzinfo=UTC), "1942025", "post_adjournment", 4),
        (datetime(2025, 6, 25, 5, 0, tzinfo=UTC), "1942025", "interim", 168),
    ],
)
def test_cadence_uses_reviewed_minnesota_sitting_dates(
    now: datetime, session_code: str, phase: str, interval: int
) -> None:
    decision = decide_session_refresh(
        session_code,
        now=now,
        last_success_at=now - timedelta(days=8),
        recent_change_at=None,
    )

    assert decision.phase == phase
    assert decision.interval == timedelta(hours=interval)
    assert decision.due is True


def test_recent_interim_change_temporarily_restores_four_hour_checks() -> None:
    now = utc(2026, 8, 11)

    recent = decide_session_refresh(
        "0942025",
        now=now,
        last_success_at=now - timedelta(hours=5),
        recent_change_at=now - timedelta(days=1),
    )
    old = decide_session_refresh(
        "0942025",
        now=now,
        last_success_at=now - timedelta(days=2),
        recent_change_at=now - timedelta(days=15),
    )

    assert recent.phase == "recent_activity"
    assert recent.interval == timedelta(hours=4)
    assert recent.due is True
    assert old.phase == "interim"
    assert old.interval == timedelta(days=7)
    assert old.due is False


def test_newly_mapped_session_gets_an_immediate_catch_up() -> None:
    decision = decide_session_refresh(
        "0942025",
        now=utc(2026, 8, 11),
        last_success_at=None,
        recent_change_at=None,
    )

    assert decision.due is True
    assert decision.reason == "first_check"


def test_production_cannot_disable_the_shared_source_limit() -> None:
    args = bill_refresh.build_parser().parse_args(
        [
            "--run-key",
            "unsafe-speed",
            "--target",
            "production",
            "--allow-writes",
            "--include-rag",
            "--request-interval-seconds",
            "0",
        ]
    )

    with pytest.raises(ValueError, match="cannot run faster"):
        bill_refresh.run_scheduled_refresh(args)


def test_official_session_choices_are_parsed_and_unknown_codes_fail_closed() -> None:
    current_html = """
    <select id="session" name="session">
      <option value="0942025" selected>94th Legislature, 2025-2026</option>
      <option value="1942025">94th Legislature, 2025 1st Special Session</option>
      <option value="0932023">93rd Legislature, 2023-2024</option>
    </select>
    <select id="people"><option value="1234567">Not a session</option></select>
    """
    future_html = current_html.replace(
        "</select>",
        '<option value="2942025">94th Legislature, 2025 2nd Special Session</option></select>',
    )

    current = parse_official_session_codes(current_html)

    assert current == ("0942025", "1942025", "0932023")
    assert validate_official_session_codes(current) == ("0942025", "1942025")
    with pytest.raises(UnknownOfficialSessionError, match="2942025"):
        validate_official_session_codes(parse_official_session_codes(future_html))
    with pytest.raises(UnknownOfficialSessionError, match="omitted.*1942025"):
        validate_official_session_codes(("0942025",))
    with pytest.raises(UnknownOfficialSessionError, match="no session codes"):
        parse_official_session_codes("<html>changed page</html>")


def test_every_known_official_session_has_reviewed_sitting_intervals() -> None:
    assert set(CURRENT_SITTING_SCHEDULES) >= {"0942025", "0942026", "1942025"}


def test_plan_fetches_only_status_xml_for_unchanged_bills(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session_html = """
    <select id="session" name="session">
      <option value="0942025">94th Legislature, 2025-2026</option>
      <option value="1942025">94th Legislature, 2025 1st Special Session</option>
      <option value="0932023">93rd Legislature, 2023-2024</option>
    </select>
    """
    same_xml = "<BILL><FILE_NUMBER>1</FILE_NUMBER></BILL>"
    changed_xml = "<BILL><FILE_NUMBER>2</FILE_NUMBER></BILL>"
    results = [
        BillSearchResult(
            chamber="House",
            file_type="HF",
            file_number=1,
            description="One",
            status_xml_uri="https://api.revisor.mn.gov/bills/one.xml",
            latest_text_html_uri="https://www.revisor.mn.gov/bills/text-one.html",
            session_code="0942025",
        ),
        BillSearchResult(
            chamber="House",
            file_type="HF",
            file_number=2,
            description="Two",
            status_xml_uri="https://api.revisor.mn.gov/bills/two.xml",
            latest_text_html_uri="https://www.revisor.mn.gov/bills/text-two.html",
            session_code="0942025",
        ),
    ]
    fetched_urls: list[str] = []

    def fake_fetch(_session, url: str) -> str:  # noqa: ANN001
        fetched_urls.append(url)
        if url == bill_refresh.OFFICIAL_SESSION_PAGE:
            return session_html
        if url.endswith("one.xml"):
            return same_xml
        if url.endswith("two.xml"):
            return changed_xml
        raise AssertionError(f"unexpected full-text fetch: {url}")

    monkeypatch.setattr(bill_refresh, "fetch_text", fake_fetch)
    monkeypatch.setattr(
        bill_refresh,
        "discover_session_bills",
        lambda _session, *, session_code, **_kwargs: (
            results if session_code == "0942025" else []
        ),
    )
    monkeypatch.setattr(
        bill_refresh,
        "_session_history",
        lambda _db, codes, **_kwargs: (
            dict.fromkeys(codes),
            dict.fromkeys(codes),
            {code: set() for code in codes},
        ),
    )
    monkeypatch.setattr(
        bill_refresh,
        "_bill_fingerprint_baselines",
        lambda _db, keys: {
            "94-2025-HF1": content_hash(same_xml),
            "94-2025-HF2": "older-hash",
        },
    )
    monkeypatch.setattr(bill_refresh, "_stored_bill_keys", lambda *_args: set())
    monkeypatch.setattr(
        bill_refresh,
        "_bill_status_signatures",
        lambda _db, keys: dict.fromkeys(keys),
    )

    plan = bill_refresh.build_refresh_plan(
        object(),
        run_key="github-plan",
        now=utc(2026, 8, 11),
        request_interval_seconds=0,
        chunk_size=25,
    )

    assert plan.unchanged_bill_keys == ("94-2025-HF1",)
    assert plan.changed_bill_keys == ("94-2025-HF2",)
    assert plan.chunks == (
        {
            "chunk_index": 1,
            "bill_keys": ["94-2025-HF2"],
            "targets": [
                {
                    "chamber": "House",
                    "bill_number": "2",
                    "session_code": "0942025",
                }
            ],
        },
    )
    assert fetched_urls == [
        bill_refresh.OFFICIAL_SESSION_PAGE,
        "https://api.revisor.mn.gov/bills/one.xml",
        "https://api.revisor.mn.gov/bills/two.xml",
    ]
    assert "text-one.html" not in " ".join(fetched_urls)


def test_partial_failure_retries_only_unfinished_bills_on_the_next_wake(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session_html = """
    <select id="session" name="session">
      <option value="0942025">94th Legislature, 2025-2026</option>
      <option value="1942025">94th Legislature, 2025 1st Special Session</option>
    </select>
    """
    results = [
        BillSearchResult(
            chamber="House",
            file_type="HF",
            file_number=1,
            description="One",
            status_xml_uri="https://api.revisor.mn.gov/bills/one.xml",
            latest_text_html_uri="https://www.revisor.mn.gov/bills/text-one.html",
            session_code="0942025",
        ),
        BillSearchResult(
            chamber="House",
            file_type="HF",
            file_number=2,
            description="Two",
            status_xml_uri="https://api.revisor.mn.gov/bills/two.xml",
            latest_text_html_uri="https://www.revisor.mn.gov/bills/text-two.html",
            session_code="0942025",
        ),
    ]
    fetched_urls: list[str] = []

    def fake_fetch(_session, url: str) -> str:  # noqa: ANN001
        fetched_urls.append(url)
        if url == bill_refresh.OFFICIAL_SESSION_PAGE:
            return session_html
        return "<BILL><FILE_NUMBER>2</FILE_NUMBER></BILL>"

    now = utc(2026, 8, 11)
    monkeypatch.setattr(bill_refresh, "fetch_text", fake_fetch)
    monkeypatch.setattr(
        bill_refresh,
        "discover_session_bills",
        lambda _session, *, session_code, **_kwargs: (
            results if session_code == "0942025" else []
        ),
    )
    monkeypatch.setattr(
        bill_refresh,
        "_session_history",
        lambda _db, codes, **_kwargs: (
            {code: now for code in codes},
            dict.fromkeys(codes),
            {code: ({"94-2025-HF2"} if code == "0942025" else set()) for code in codes},
        ),
    )
    monkeypatch.setattr(
        bill_refresh,
        "_bill_fingerprint_baselines",
        lambda _db, _keys: {"94-2025-HF2": "older-hash"},
    )
    monkeypatch.setattr(
        bill_refresh,
        "_bill_status_signatures",
        lambda _db, keys: dict.fromkeys(keys),
    )

    plan = bill_refresh.build_refresh_plan(
        object(),
        run_key="github-retry",
        now=now,
        request_interval_seconds=0,
    )

    assert plan.session_codes == ("0942025",)
    assert plan.full_session_codes == ()
    assert plan.decisions["0942025"]["due"] is False
    assert plan.decisions["0942025"]["pending_retry_count"] == 1
    assert plan.changed_bill_keys == ("94-2025-HF2",)
    assert fetched_urls == [
        bill_refresh.OFFICIAL_SESSION_PAGE,
        "https://api.revisor.mn.gov/bills/two.xml",
    ]


def test_history_keeps_changes_and_retries_with_their_own_session(
    seed_database: None,
) -> None:
    now = utc(2998, 8, 11)
    checked_at = now - timedelta(days=1)
    regular_code = "0942998"
    special_code = "1942998"
    special_key = "94-2998s1-HF2"
    plan = RefreshPlan(
        run_key=f"history-{uuid4().hex}",
        created_at=checked_at,
        session_codes=(regular_code, special_code),
        decisions={},
        unchanged_bill_keys=(),
        changed_bill_keys=("94-2998-HF1", special_key),
        chunks=(
            {
                "chunk_index": 1,
                "bill_keys": ["94-2998-HF1"],
                "targets": [
                    {
                        "chamber": "House",
                        "bill_number": "1",
                        "session_code": regular_code,
                    }
                ],
            },
            {
                "chunk_index": 2,
                "bill_keys": [special_key],
                "targets": [
                    {
                        "chamber": "House",
                        "bill_number": "2",
                        "session_code": special_code,
                    }
                ],
            },
        ),
        full_session_codes=(regular_code, special_code),
    )
    with Session(get_engine()) as db:
        db.add(
            IngestionRun(
                adapter=bill_refresh.SCHEDULE_ADAPTER,
                target_type=bill_refresh.SCHEDULE_TARGET_TYPE,
                target_key=plan.run_key,
                status=IngestionStatus.failed,
                started_at=checked_at,
                finished_at=now - timedelta(hours=1),
                stats={
                    "session_codes": list(plan.session_codes),
                    "plan": plan.to_dict(),
                    "text_changed_bill_keys": ["94-2998-HF1"],
                    "status_only_bill_keys": [],
                    "metadata_only_bill_keys": [],
                    "failed_bill_keys": [special_key],
                    "rejected": [],
                },
            )
        )
        scoped = RefreshPlan(
            run_key=f"scoped-{uuid4().hex}",
            created_at=now - timedelta(minutes=10),
            session_codes=(regular_code, special_code),
            decisions={},
            unchanged_bill_keys=("94-2998s1-HF9",),
            changed_bill_keys=(),
            chunks=(),
            full_session_codes=(),
        )
        db.add(
            IngestionRun(
                adapter=bill_refresh.SCHEDULE_ADAPTER,
                target_type=bill_refresh.SCHEDULE_TARGET_TYPE,
                target_key=scoped.run_key,
                status=IngestionStatus.succeeded,
                started_at=scoped.created_at,
                finished_at=now - timedelta(minutes=9),
                stats={
                    "session_codes": list(scoped.session_codes),
                    "plan": scoped.to_dict(),
                    "text_changed_bill_keys": [],
                    "status_only_bill_keys": [],
                    "metadata_only_bill_keys": [],
                    "unchanged_bill_keys": list(scoped.unchanged_bill_keys),
                    "failed_bill_keys": [],
                    "rejected": [],
                },
            )
        )
        db.flush()

        last_check, recent_change, pending = bill_refresh._session_history(
            db,
            (regular_code, special_code),
            now=now,
        )

        assert last_check == {
            regular_code: checked_at,
            special_code: checked_at,
        }
        assert recent_change == {
            regular_code: checked_at,
            special_code: None,
        }
        assert pending == {
            regular_code: set(),
            special_code: {special_key},
        }
        db.rollback()


def test_late_resume_does_not_make_an_old_fingerprint_look_recent(
    seed_database: None,
) -> None:
    now = utc(2997, 8, 11)
    checked_at = now - timedelta(days=20)
    code = "0942997"
    bill_key = "94-2997-HF1"
    plan = RefreshPlan(
        run_key=f"late-{uuid4().hex}",
        created_at=checked_at,
        session_codes=(code,),
        decisions={},
        unchanged_bill_keys=(),
        changed_bill_keys=(bill_key,),
        chunks=(
            {
                "chunk_index": 1,
                "bill_keys": [bill_key],
                "targets": [
                    {
                        "chamber": "House",
                        "bill_number": "1",
                        "session_code": code,
                    }
                ],
            },
        ),
        full_session_codes=(code,),
    )
    with Session(get_engine()) as db:
        db.add(
            IngestionRun(
                adapter=bill_refresh.SCHEDULE_ADAPTER,
                target_type=bill_refresh.SCHEDULE_TARGET_TYPE,
                target_key=plan.run_key,
                status=IngestionStatus.succeeded,
                started_at=checked_at,
                finished_at=now - timedelta(hours=1),
                stats={
                    "session_codes": [code],
                    "plan": plan.to_dict(),
                    "text_changed_bill_keys": [],
                    "status_only_bill_keys": [],
                    "metadata_only_bill_keys": [bill_key],
                    "failed_bill_keys": [],
                    "rejected": [],
                },
            )
        )
        db.flush()

        last_check, recent_change, _pending = bill_refresh._session_history(
            db,
            (code,),
            now=now,
        )

        assert last_check[code] == checked_at
        assert recent_change[code] is None
        db.rollback()


def test_unknown_official_session_stops_before_bill_discovery(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session_html = """
    <select id="session" name="session">
      <option value="0942025">94th Legislature, 2025-2026</option>
      <option value="2942025">94th Legislature, 2025 2nd Special Session</option>
    </select>
    """
    discovery_calls: list[str] = []
    monkeypatch.setattr(
        bill_refresh,
        "fetch_text",
        lambda _session, _url: session_html,
    )
    monkeypatch.setattr(
        bill_refresh,
        "discover_session_bills",
        lambda _session, *, session_code, **_kwargs: discovery_calls.append(
            session_code
        ),
    )

    with pytest.raises(UnknownOfficialSessionError, match="2942025"):
        bill_refresh.build_refresh_plan(
            object(),
            run_key="github-unknown",
            now=utc(2026, 8, 11),
            request_interval_seconds=0,
        )

    assert discovery_calls == []


def test_saved_plan_round_trip_keeps_retry_chunks_and_exact_lists() -> None:
    plan = RefreshPlan(
        run_key="github-resume",
        created_at=utc(2026, 8, 11),
        session_codes=("0942025",),
        decisions={"0942025": {"phase": "interim", "due": True}},
        unchanged_bill_keys=("94-2025-HF1",),
        changed_bill_keys=("94-2025-HF2",),
        chunks=(
            {
                "chunk_index": 1,
                "bill_keys": ["94-2025-HF2"],
                "targets": [
                    {
                        "chamber": "House",
                        "bill_number": "2",
                        "session_code": "0942025",
                    }
                ],
            },
        ),
        source_fingerprints={"94-2025-HF2": "fingerprint"},
    )

    assert RefreshPlan.from_dict(plan.to_dict()) == plan


@pytest.mark.parametrize(
    ("run_hash", "action_hashes", "expected"),
    [
        ("run-hash", ("old-action-hash",), "run-hash"),
        (None, ("same-hash", "same-hash"), "same-hash"),
        (None, ("older", "newer"), None),
        (None, (), None),
    ],
)
def test_fingerprint_baseline_is_the_last_accepted_source_only(
    run_hash: str | None, action_hashes: tuple[str, ...], expected: str | None
) -> None:
    assert accepted_fingerprint_baseline(run_hash, action_hashes) == expected


def test_refresh_results_are_exact_disjoint_lists_including_partial_failure() -> None:
    plan = RefreshPlan(
        run_key="github-123",
        created_at=utc(2026, 8, 11),
        session_codes=("0942025",),
        decisions={},
        unchanged_bill_keys=("94-2025-HF1",),
        changed_bill_keys=(
            "94-2025-HF2",
            "94-2025-HF3",
            "94-2025-HF4",
            "94-2025-HF5",
        ),
        chunks=(),
        status_signatures_before={"94-2025-HF3": "before"},
    )
    completed = [
        {
            "bill_keys": ["94-2025-HF2", "94-2025-HF3", "94-2025-HF4"],
            "text_changed_bill_keys": ["94-2025-HF2", "94-2025-HF4"],
            "bill_refresh_rejections": [
                {
                    "bill_key": "94-2025-HF4",
                    "reason": "2 official responses were incomplete",
                    "needs_issue": True,
                }
            ],
        }
    ]

    report = classify_refresh_results(
        plan,
        completed,
        status_signatures_after={"94-2025-HF3": "after"},
    )

    assert report.text_changed_bill_keys == ("94-2025-HF2",)
    assert report.status_only_bill_keys == ("94-2025-HF3",)
    assert report.metadata_only_bill_keys == ()
    assert report.unchanged_bill_keys == ("94-2025-HF1",)
    assert tuple(item["bill_key"] for item in report.rejected) == ("94-2025-HF4",)
    assert report.failed_bill_keys == ("94-2025-HF5",)
    classified = (
        set(report.text_changed_bill_keys)
        | set(report.status_only_bill_keys)
        | set(report.metadata_only_bill_keys)
        | set(report.unchanged_bill_keys)
        | {str(item["bill_key"]) for item in report.rejected}
        | set(report.failed_bill_keys)
    )
    assert classified == {
        "94-2025-HF1",
        "94-2025-HF2",
        "94-2025-HF3",
        "94-2025-HF4",
        "94-2025-HF5",
    }


def test_rejected_bill_keeps_the_coordinator_run_failed() -> None:
    plan = RefreshPlan(
        run_key="github-rejected",
        created_at=utc(2026, 8, 11),
        session_codes=("0942025",),
        decisions={},
        unchanged_bill_keys=(),
        changed_bill_keys=("94-2025-HF4",),
        chunks=(),
    )
    report = classify_refresh_results(
        plan,
        [
            {
                "bill_keys": [],
                "text_changed_bill_keys": [],
                "bill_refresh_rejections": [
                    {
                        "bill_key": "94-2025-HF4",
                        "reason": "official source stayed incomplete",
                        "needs_issue": True,
                    }
                ],
            }
        ],
    )
    run = SimpleNamespace(stats={}, status=IngestionStatus.running)
    db = SimpleNamespace(commit=lambda: None)

    payload = bill_refresh._finish_run(db, run, plan, report)

    assert payload["status"] == "failed"
    assert run.status == IngestionStatus.failed
    assert run.error_text == "1 bill(s) did not finish"


def test_governor_action_after_the_fast_window_is_still_found_weekly() -> None:
    now = utc(2026, 6, 10)
    decision = decide_session_refresh(
        "0942025",
        now=now,
        last_success_at=now - timedelta(days=8),
        recent_change_at=None,
    )
    plan = RefreshPlan(
        run_key="github-governor",
        created_at=now,
        session_codes=("0942025",),
        decisions={},
        unchanged_bill_keys=(),
        changed_bill_keys=("94-2025-SF1943",),
        chunks=(),
        status_signatures_before={"94-2025-SF1943": "passed-both"},
    )
    report = classify_refresh_results(
        plan,
        [
            {
                "bill_keys": ["94-2025-SF1943"],
                "text_changed_bill_keys": [],
                "bill_refresh_rejections": [],
            }
        ],
        status_signatures_after={"94-2025-SF1943": "signed"},
    )

    assert decision.phase == "interim"
    assert decision.interval == timedelta(days=7)
    assert decision.due is True
    assert report.status_only_bill_keys == ("94-2025-SF1943",)


def test_source_change_without_public_status_change_is_metadata_only() -> None:
    plan = RefreshPlan(
        run_key="github-metadata",
        created_at=utc(2026, 8, 11),
        session_codes=("0942025",),
        decisions={},
        unchanged_bill_keys=(),
        changed_bill_keys=("94-2025-HF7",),
        chunks=(),
        status_signatures_before={"94-2025-HF7": "same-status"},
    )

    report = classify_refresh_results(
        plan,
        [
            {
                "bill_keys": ["94-2025-HF7"],
                "text_changed_bill_keys": [],
                "bill_refresh_rejections": [],
            }
        ],
        status_signatures_after={"94-2025-HF7": "same-status"},
    )

    assert report.status_only_bill_keys == ()
    assert report.metadata_only_bill_keys == ("94-2025-HF7",)


def test_chunk_jobs_use_an_isolated_queue_and_a_run_specific_retry_key() -> None:
    targets = [{"chamber": "House", "bill_number": "2", "session_code": "0942025"}]

    first = scheduled_chunk_job(
        run_key="github-123",
        chunk_index=1,
        bill_keys=["94-2025-HF2"],
        targets=targets,
        source_fingerprints={"94-2025-HF2": "source-a"},
        request_interval_seconds=0.25,
        database_target="production",
        include_rag=True,
    )
    same = scheduled_chunk_job(
        run_key="github-123",
        chunk_index=1,
        bill_keys=["94-2025-HF2"],
        targets=targets,
        source_fingerprints={"94-2025-HF2": "source-a"},
        request_interval_seconds=0.25,
        database_target="production",
        include_rag=True,
    )
    next_run = scheduled_chunk_job(
        run_key="github-124",
        chunk_index=1,
        bill_keys=["94-2025-HF2"],
        targets=targets,
        source_fingerprints={"94-2025-HF2": "source-a"},
        request_interval_seconds=0.25,
        database_target="production",
        include_rag=True,
    )
    reshaped = scheduled_chunk_job(
        run_key="github-123",
        chunk_index=1,
        bill_keys=["94-2025-HF3"],
        targets=[{"chamber": "House", "bill_number": "3", "session_code": "0942025"}],
        source_fingerprints={"94-2025-HF3": "source-b"},
        request_interval_seconds=0.25,
        database_target="production",
        include_rag=True,
    )

    assert first.queue.startswith("scheduled_bill_sync_")
    assert first.args["task_key"] == same.args["task_key"]
    assert first.args["task_key"] != next_run.args["task_key"]
    assert first.args["task_key"] != reshaped.args["task_key"]
    assert first.max_attempts == 1
    assert first.args["include_rag"] is True
    assert "ai" not in first.args


@pytest.mark.asyncio
async def test_same_run_resumes_completed_chunks_without_ingesting_twice(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    run_key = f"test-{uuid4().hex}"
    unrelated_run_key = f"unrelated-{uuid4().hex}"
    calls: list[list[str]] = []

    class RecordsCalls:
        def __init__(self, _db, sess=None):  # noqa: ANN001
            del sess

        def ingest_bills(self, targets):  # noqa: ANN001
            keys = [f"94-2025-HF{target.bill_number}" for target in targets]
            calls.append(keys)
            return {
                "bills_ingested": len(keys),
                "bill_keys": keys,
                "text_changed_bill_keys": [],
                "bill_refresh_rejections": [],
            }

    monkeypatch.setattr(
        "alethical.pipeline.minnesota.MinnesotaIngestionPipeline", RecordsCalls
    )
    plan = RefreshPlan(
        run_key=run_key,
        created_at=utc(2026, 8, 11),
        session_codes=("0942025",),
        decisions={},
        unchanged_bill_keys=(),
        changed_bill_keys=("94-2025-HF2",),
        chunks=(
            {
                "chunk_index": 1,
                "bill_keys": ["94-2025-HF2"],
                "targets": [
                    {
                        "chamber": "House",
                        "bill_number": "2",
                        "session_code": "0942025",
                    }
                ],
            },
        ),
    )
    database_url = get_database_url()
    pool = await bill_refresh.open_pool(bill_refresh.oban_dsn(database_url))
    try:
        await install_oban_schema(pool)
        unrelated = scheduled_chunk_job(
            run_key=unrelated_run_key,
            chunk_index=1,
            bill_keys=["94-2025-HF9"],
            targets=[
                {
                    "chamber": "House",
                    "bill_number": "9",
                    "session_code": "0942025",
                }
            ],
            source_fingerprints={"94-2025-HF9": "unrelated"},
            request_interval_seconds=0,
            database_target="local",
            include_rag=False,
        )
        unrelated_job = await Oban(pool=pool, queues={}).enqueue(unrelated)
    finally:
        await pool.close()

    try:
        first = await bill_refresh.execute_refresh_plan(
            plan,
            database_url=database_url,
            database_target="local",
            include_rag=False,
            request_interval_seconds=0,
            concurrency=2,
        )
        resumed = await bill_refresh.execute_refresh_plan(
            plan,
            database_url=database_url,
            database_target="local",
            include_rag=False,
            request_interval_seconds=0,
            concurrency=2,
        )

        assert first == resumed
        assert calls == [["94-2025-HF2"]]
        engine = create_engine(database_url)
        with engine.connect() as connection:
            assert (
                connection.scalar(
                    text("select state from oban_jobs where id = :job_id"),
                    {"job_id": unrelated_job.id},
                )
                == "available"
            )
    finally:
        engine = create_engine(database_url)
        with engine.begin() as connection:
            connection.execute(
                text(
                    """
                    delete from oban_jobs
                    where args->>'task_key' like :run_prefix
                       or args->>'task_key' like :unrelated_prefix
                    """
                ),
                {
                    "run_prefix": f"scheduled-bill-refresh:{run_key}:%",
                    "unrelated_prefix": (
                        f"scheduled-bill-refresh:{unrelated_run_key}:%"
                    ),
                },
            )


def test_free_schedule_wakes_every_two_hours_but_starts_disabled() -> None:
    workflow = (
        Path(__file__).parents[2] / ".github/workflows/bill-refresh.yml"
    ).read_text()

    assert 'cron: "17 */2 * * *"' in workflow
    assert "BILL_REFRESH_SCHEDULE_ENABLED" in workflow
    assert "alethical.pipeline.bill_refresh" in workflow
    assert "--include-rag" in workflow
    assert "ai-prepare" not in workflow
    assert "actions/upload-artifact" in workflow
