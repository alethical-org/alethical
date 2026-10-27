"""A filed report stays owed until its totals and its legislator's page catch up.

The failures these reproduce were found on October 27, 2026: the Board's summary lagged
its own report lists, and a successful copy of old figures consumed the change signal.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest
from sqlalchemy import delete, select, text
from sqlalchemy.orm import sessionmaker

from alethical.db import models
from alethical.db.session import get_engine
from alethical.pipeline import campaign_finance_filings as filings
from alethical.pipeline import campaign_money_completion as completion
from alethical.pipeline import record_refresh as runner
from alethical.pipeline.campaign_finance_refresh import (
    catch_up_settled,
    plan_totals_refresh,
)
from alethical.tests.filed_figures import (
    clear_filings_snapshots,
    publish_filings_snapshot,
)
from scripts import report_source_refresh_health as report

NOW = datetime(2026, 10, 27, 18, tzinfo=UTC)
KIND = filings.FilerKind.candidate_committee


def lag(registration, year=2026, our=date(2026, 7, 20), member=None):
    return completion.LaggingFilerYear(
        registration_number=registration,
        kind=KIND,
        filing_year=year,
        our_through=our,
        expected_through=date(2026, 10, 19),
        newest_report="2026 Pre-General Report",
        member=member,
    )


def tab(**through):
    result = filings.FinancialTab()
    for year, value in through.items():
        if value is None:
            result.unavailable_years.add(int(year[1:]))
            continue
        result.years[int(year[1:])] = filings.YearFigures(
            year=int(year[1:]), heading=year[1:], reported_through=value
        )
    return result


# --- Which filers are asked about -----------------------------------------------------


def test_members_come_first_and_the_least_recently_asked_lead():
    lagging = [lag(str(n), member=f"m{n}") for n in range(3)] + [lag("900")]
    chosen = completion.choose_probes(
        lagging,
        {"0": {"probed_at": NOW.isoformat()}},
        member_limit=2,
        other_limit=1,
    )
    assert [c[0] for c in chosen] == ["1", "2", "900"]


def test_one_request_covers_both_years_of_a_segment():
    chosen = completion.choose_probes(
        [lag("5", year=2026), lag("5", year=2027)], {}, member_limit=5
    )
    assert len(chosen) == 1 and chosen[0][2] == (2026, 2027)
    assert len(chosen[0][3]) == 2


# --- One turn's decision --------------------------------------------------------------


def run(lagging, *, probe, state=None, last_full=None, **options):
    return completion.evaluate(
        lagging,
        state or {},
        probe=probe,
        now=NOW,
        last_full_refresh_at=last_full,
        **options,
    )


def test_board_ahead_asks_for_totals_even_though_no_list_changed():
    result = run(
        [lag("18272", member="patty-acomb")],
        probe=lambda *a: tab(y2026=date(2026, 10, 19)),
        last_full=NOW - timedelta(hours=7),
    )
    assert result.request_totals
    assert result.finding["board_ahead"][0]["board_through"] == "2026-10-19"
    assert result.code == 0


def test_a_recent_full_refresh_waits_but_the_catch_up_stays_recorded():
    result = run(
        [lag("18272", member="patty-acomb")],
        probe=lambda *a: tab(y2026=date(2026, 10, 19)),
        last_full=NOW - timedelta(hours=1),
    )
    assert not result.request_totals
    marker = completion.catch_up_marker(None, result, NOW)
    assert marker["filer_years"] == ["18272:2026"]


def test_a_caught_up_page_removes_the_catch_up_record():
    result = run([], probe=lambda *a: tab())
    assert (
        completion.catch_up_marker({"detected_at": NOW.isoformat()}, result, NOW)
        is None
    )


def test_the_board_still_behind_is_not_a_catch_up():
    result = run([lag("18833")], probe=lambda *a: tab(y2026=date(2026, 7, 20)))
    assert not result.request_totals and result.finding["board_ahead"] == []
    assert completion.catch_up_marker(None, result, NOW) is None


def test_the_board_ahead_past_the_budget_needs_a_person():
    since = (NOW - completion.BOARD_AHEAD_BUDGET - timedelta(minutes=1)).isoformat()
    result = run(
        [lag("18272", member="patty-acomb")],
        probe=lambda *a: tab(y2026=date(2026, 10, 19)),
        state={
            "18272": {
                "ahead": [
                    {
                        "registration_number": "18272",
                        "year": 2026,
                        "board_through": "2026-10-19",
                        "our_through": "2026-07-20",
                        "since": since,
                    }
                ]
            }
        },
    )
    assert result.code == completion.REVIEW_EXIT
    assert result.finding["results"][0]["source"] == "campaign-totals-catch-up"


def test_every_probe_failing_is_a_failure_not_a_quiet_success():
    def broken(*_args):
        raise ConnectionError("no route")

    result = run([lag("1"), lag("2")], probe=broken)
    assert result.code == 1 and result.finding["probe_errors"] == 2


def test_an_unreadable_answer_is_never_read_as_caught_up():
    unreadable = filings.FinancialTab(errors=["2026 was requested and not served"])
    result = run([lag("1")], probe=lambda *a: unreadable)
    assert not result.request_totals and result.finding["probe_errors"] == 1


def test_a_filer_that_caught_up_leaves_the_probe_state():
    result = run([], probe=lambda *a: tab(), state={"7": {"ahead_since": "x"}})
    assert result.state == {}


def ahead_row(registration, year, board, since=NOW):
    return {
        "registration_number": registration,
        "year": year,
        "board_through": board,
        "our_through": "2026-07-20",
        "since": since.isoformat(),
    }


def test_a_saved_ahead_row_goes_once_our_totals_reach_the_board():
    # Our totals now reach October 19, the Board's summary still lags the newest
    # report, and this filer was not asked again this turn.
    caught_up = completion.LaggingFilerYear(
        "18272", KIND, 2026, date(2026, 10, 19), date(2026, 10, 30), "r", "patty-acomb"
    )

    def answer(registration, *_args):
        if registration == "18272":
            raise ConnectionError("not asked successfully this turn")
        return tab(y2026=date(2026, 7, 20))

    old = NOW - completion.BOARD_AHEAD_BUDGET - timedelta(hours=1)
    result = run(
        [caught_up, lag("9")],
        probe=answer,
        state={"18272": {"ahead": [ahead_row("18272", 2026, "2026-10-19", old)]}},
        last_full=NOW - timedelta(days=1),
    )
    assert result.finding["board_ahead"] == []
    assert not result.request_totals and result.code == 0


def test_both_election_segments_of_a_filer_keep_their_own_answer():
    def answer(_registration, _kind, segment):
        if segment == (2024, 2025):
            return tab(y2024=date(2024, 12, 31), y2025=date(2025, 12, 31))
        return tab(y2026=date(2026, 7, 20), y2027=None)

    result = run(
        [lag("5", year=2025, our=date(2025, 6, 30)), lag("5", year=2026)],
        probe=answer,
        last_full=NOW - timedelta(days=1),
    )
    assert [(r["year"], r["board_through"]) for r in result.finding["board_ahead"]] == [
        (2025, "2025-12-31")
    ]
    assert result.request_totals


def test_a_recent_request_or_a_running_refresh_is_not_asked_again():
    ahead = dict(
        probe=lambda *a: tab(y2026=date(2026, 10, 19)),
        last_full=NOW - timedelta(days=2),
    )
    assert not run(
        [lag("1")], last_requested_at=NOW - timedelta(hours=1), **ahead
    ).request_totals
    assert not run([lag("1")], totals_running=True, **ahead).request_totals
    assert run(
        [lag("1")], last_requested_at=NOW - timedelta(hours=7), **ahead
    ).request_totals


def test_the_late_alarm_keeps_its_key_while_the_asked_filers_change():
    old = NOW - completion.BOARD_AHEAD_BUDGET - timedelta(hours=1)
    state = {"1": {"ahead": [ahead_row("1", 2026, "2026-10-19", old)]}}

    def answers(second_filer_board):
        def answer(registration, *_args):
            if registration == "1":
                raise OSError("not reached this turn")
            return tab(y2026=second_filer_board)

        return answer

    def late_key(result):
        return next(
            r["finding_key"]
            for r in result.finding["results"]
            if r["source"] == "campaign-totals-catch-up"
        )

    # The second turn adds filer 2 to the ahead set; the oldest case is unchanged.
    keys = [
        late_key(run([lag("1"), lag("2")], probe=answers(board), state=state))
        for board in (date(2026, 7, 20), date(2026, 10, 19))
    ]
    assert keys[0] == keys[1]


def test_the_request_time_is_saved_and_carried_until_the_next_request():
    ahead = dict(probe=lambda *a: tab(y2026=date(2026, 10, 19)))
    asked = run([lag("1")], last_full=NOW - timedelta(days=1), **ahead)
    marker = completion.catch_up_marker(None, asked, NOW)
    assert marker["requested_at"] == NOW.isoformat()

    waited = run(
        [lag("1")],
        last_full=NOW - timedelta(days=1),
        last_requested_at=NOW - timedelta(hours=1),
        **ahead,
    )
    later = completion.catch_up_marker(marker, waited, NOW + timedelta(hours=1))
    assert not waited.request_totals
    assert later["requested_at"] == marker["requested_at"]


# --- The planner -----------------------------------------------------------------------


def test_the_planner_fetches_totals_for_a_recorded_catch_up():
    plan = plan_totals_refresh(
        [],
        {},
        NOW - timedelta(days=1),
        now=NOW,
        catch_up={"detected_at": NOW.isoformat(), "filer_years": ["18272:2026"]},
    )
    assert plan.totals_due
    assert "later period for 1 committee-year" in plan.reasons[0]


def test_only_a_catch_up_seen_before_the_run_started_is_settled():
    started = NOW
    assert catch_up_settled(
        {"detected_at": (NOW - timedelta(minutes=5)).isoformat()}, started
    )
    assert not catch_up_settled(
        {"detected_at": (NOW + timedelta(minutes=5)).isoformat()}, started
    )
    assert not catch_up_settled(None, started)


# --- Reading the live snapshot ---------------------------------------------------------


@pytest.fixture
def database(seed_database):
    factory = sessionmaker(bind=get_engine())
    with factory() as db:
        clear_filings_snapshots(db)
        db.execute(
            delete(models.LegislatorCampaignCommittee).where(
                models.LegislatorCampaignCommittee.registration_number.in_(
                    ["90001", "90002", "90003"]
                )
            )
        )
        db.commit()
    yield factory
    with factory() as db:
        clear_filings_snapshots(db)
        db.execute(
            delete(models.LegislatorCampaignCommittee).where(
                models.LegislatorCampaignCommittee.registration_number.in_(
                    ["90001", "90002", "90003"]
                )
            )
        )
        db.commit()


def test_lagging_filer_years_are_read_from_the_live_snapshot(database):
    with database() as db:
        snapshot = publish_filings_snapshot(
            db,
            filings=[
                ("90001", 2026, "total_receipts", Decimal("1"), date(2026, 7, 20)),
                ("90002", 2026, "total_receipts", Decimal("1"), date(2026, 10, 19)),
                ("90003", 2026, "total_receipts", Decimal("1"), date(2026, 7, 28)),
            ],
        )
        for number in ("90001", "90002", "90003"):
            db.add(
                models.CampaignFinanceFiler(
                    snapshot_id=snapshot,
                    registration_number=number,
                    kind=KIND,
                    name=f"Committee {number}",
                    termination_date=date(2026, 7, 28) if number == "90003" else None,
                )
            )
        reports = [
            # Behind: the Board's list has a pre-general report, our summary is July.
            (
                "90001",
                "2026 Pre-General Report",
                date(2026, 10, 19),
                date(2026, 10, 21),
            ),
            # Current: the summary already covers the newest report.
            (
                "90002",
                "2026 Pre-General Report",
                date(2026, 10, 19),
                date(2026, 10, 21),
            ),
            # A termination report is listed with December 31 but ended when filed.
            # Without a filed date, the committee's termination date ends the period.
            ("90003", "2026 Year-End Report", date(2026, 12, 31), None),
        ]
        for row_number, (number, name, cut_off, filed) in enumerate(reports, start=10):
            db.add(
                models.CampaignFinanceFilingReport(
                    snapshot_id=snapshot,
                    row_number=row_number,
                    registration_number=number,
                    filing_year=2026,
                    report_type="E",
                    report_name=name,
                    cut_off_date=cut_off,
                    filed_date=filed,
                    special_election=False,
                )
            )
        legislator = db.scalar(select(models.Legislator.id).limit(1))
        slug = db.scalar(
            select(models.Legislator.slug).where(models.Legislator.id == legislator)
        )
        db.add(
            models.LegislatorCampaignCommittee(
                legislator_id=legislator,
                registration_number="90001",
                decision=models.CommitteeLinkReviewDecision.confirmed,
                committee_name_as_reviewed="Committee 90001",
                office_as_reviewed="House",
                reviewed_by="test",
            )
        )
        db.commit()

        lagging = completion.read_state(db, [2025, 2026])

    assert [(item.registration_number, item.member) for item in lagging] == [
        ("90001", slug)
    ]
    assert lagging[0].expected_through == date(2026, 10, 19)


# --- The shared runner keeps a failed collection's reasons ------------------------------


def summary_line(stage, status, **fields):
    return json.dumps({"stage": stage, "status": status} | fields) + "\n"


def test_a_failed_stage_keeps_its_checks_and_committees_and_never_free_text():
    recorded = (
        summary_line("lists", "unchanged")
        + summary_line(
            "payments",
            "failed",
            failed_checks=["no_published_year_lost_rows"],
            affected_committees=["18127"],
            affected_years=[2017],
            details=["a source body quoted here"],
        )
    ).encode()
    finding = runner.failed_stage_finding(recorded)
    assert finding["stages"] == [
        {
            "stage": "payments",
            "failed_checks": ["no_published_year_lost_rows"],
            "affected_committees": ["18127"],
            "affected_years": [2017],
        }
    ]
    assert "source body" not in json.dumps(finding)
    other = runner.failed_stage_finding(
        summary_line(
            "payments", "failed", failed_checks=["amount_sum_within_band"]
        ).encode()
    )
    assert other["finding_key"] != finding["finding_key"]


def test_the_same_failure_on_other_committees_keeps_its_key():
    one = runner.failed_stage_finding(
        summary_line(
            "payments", "failed", failed_checks=["x"], affected_committees=["1"]
        ).encode()
    )
    two = runner.failed_stage_finding(
        summary_line(
            "payments", "failed", failed_checks=["x"], affected_committees=["2"]
        ).encode()
    )
    assert one["finding_key"] == two["finding_key"]


def test_a_finished_collection_has_no_stage_finding():
    assert (
        runner.failed_stage_finding(summary_line("payments", "unchanged").encode())
        is None
    )
    assert runner.failed_stage_finding(b"") is None


def test_a_failed_command_returns_its_own_stages_and_keeps_the_workflow_file(
    monkeypatch, tmp_path
):
    workflow_file = tmp_path / "collection-run-summary.jsonl"
    monkeypatch.setenv("COLLECTION_RUN_SUMMARY", str(workflow_file))
    line = summary_line("payments", "failed", failed_checks=["amount_sum_within_band"])

    class Process:
        pid = 1

        def __init__(self, *_args, env, **_kwargs):
            Path(env["COLLECTION_RUN_SUMMARY"]).write_text(line)

        def wait(self, timeout=None):
            return 1

        def poll(self):
            return 1

    monkeypatch.setattr(runner.subprocess, "Popen", Process)
    job = runner.RefreshJob(
        "campaign-money", timedelta(days=1), timedelta(seconds=5), ("x",), "s", "p"
    )
    result = runner.run_command(runner.Claim(job, uuid.uuid4(), NOW), target="local")
    assert result.code == 1
    assert result.finding["stages"][0]["failed_checks"] == ["amount_sum_within_band"]
    assert workflow_file.read_text() == line


def fake_process(line, *, code=1, interrupt=False):
    class Process:
        pid = 1

        def __init__(self, *_args, env, **_kwargs):
            Path(env["COLLECTION_RUN_SUMMARY"]).write_text(line)

        def wait(self, timeout=None):
            if interrupt:
                raise KeyboardInterrupt
            return code

        def poll(self):
            return code

    return Process


def money_job():
    return runner.RefreshJob(
        "campaign-money", timedelta(days=1), timedelta(seconds=5), ("x",), "s", "p"
    )


def test_stages_written_before_a_shutdown_still_reach_the_artifact(
    monkeypatch, tmp_path
):
    workflow_file = tmp_path / "collection-run-summary.jsonl"
    monkeypatch.setenv("COLLECTION_RUN_SUMMARY", str(workflow_file))
    line = summary_line("lists", "unchanged")
    monkeypatch.setattr(runner.subprocess, "Popen", fake_process(line, interrupt=True))
    monkeypatch.setattr(runner.os, "killpg", lambda *_: None)
    with pytest.raises(KeyboardInterrupt):
        runner.run_command(runner.Claim(money_job(), uuid.uuid4(), NOW), target="local")
    assert workflow_file.read_text() == line


def test_a_continuing_turn_is_not_recorded_as_a_failure(monkeypatch, tmp_path):
    monkeypatch.setenv("COLLECTION_RUN_SUMMARY", str(tmp_path / "summary.jsonl"))
    line = summary_line("rechecks", "pending")
    monkeypatch.setattr(runner.subprocess, "Popen", fake_process(line, code=75))
    result = runner.run_command(
        runner.Claim(money_job(), uuid.uuid4(), NOW), target="local"
    )
    assert result.code == 75 and result.finding is None


def test_the_completion_job_is_a_campaign_job_with_a_review_exit():
    job = runner.jobs(NOW)["campaign-completion"]
    assert runner.job_family(job.name) == "campaign"
    assert job.review_exit == completion.REVIEW_EXIT and job.capture_json
    assert job.lane != runner.jobs(NOW)["campaign-money"].lane


# --- The public health issue -----------------------------------------------------------


def health_row(name, finding, status="failed"):
    return {
        "name": name,
        "status": status,
        "overdue": False,
        "running": False,
        "source": "https://cfb.mn.gov/",
        "finding": finding,
    }


def test_the_issue_names_the_failed_stage_and_the_late_catch_up():
    body, _, attention = report.packet(
        [
            health_row(
                "campaign-money",
                runner.failed_stage_finding(
                    summary_line(
                        "payments",
                        "failed",
                        failed_checks=["no_published_year_lost_rows"],
                        affected_committees=["18127", "1; drop"],
                        affected_years=[2017],
                    ).encode()
                ),
            ),
            health_row(
                "campaign-completion",
                {
                    "results": [
                        {
                            "source": "campaign-totals-catch-up",
                            "status": "review_required",
                            "finding_key": "k",
                        }
                    ],
                    "board_ahead_count": 3,
                },
                status="review_required",
            ),
        ]
    )
    assert attention
    assert (
        "Stage **payments** did not finish: `no_published_year_lost_rows`; committees 18127; years 2017."
        in body
    )
    assert "longer than the catch-up budget" in body
    assert "The Board is ahead of our totals for 3 committee-year(s)" in body
    assert "drop" not in body


def test_a_new_reason_is_new_and_the_same_reason_repeating_is_not():
    first = [health_row("campaign-money", {"finding_key": "a"})]
    body, _, _ = report.packet(first)
    assert report.new_problems(body, report.problem_keys(first)) == []
    changed = [health_row("campaign-money", {"finding_key": "b"})]
    assert report.new_problems(body, report.problem_keys(changed)) != []
    assert "finding_key" not in body and '"a"' not in body


def test_recovery_closes_the_issue_without_a_mention(monkeypatch):
    from alethical.tests.test_source_refresh_health_report import fake_environment

    problem, _, _ = report.packet([health_row("campaign-money", {"finding_key": "a"})])
    calls = fake_environment(
        monkeypatch,
        [health_row("campaign-money", None, status="succeeded")],
        [{"number": 7, "body": problem, "state": "OPEN"}],
    )
    assert report.main() == 0
    assert any(args[:3] == ("issue", "close", "7") for args, _ in calls)
    assert not any(args[:2] == ("issue", "comment") for args, _ in calls)


def test_a_new_problem_mentions_the_owner_and_a_repeat_does_not(monkeypatch):
    from alethical.tests.test_source_refresh_health_report import fake_environment

    rows = [health_row("campaign-money", {"finding_key": "a"})]
    old_body, _, _ = report.packet([])
    calls = fake_environment(
        monkeypatch, rows, [{"number": 7, "body": old_body, "state": "CLOSED"}]
    )
    assert report.main() == 0
    comments = [body for args, body in calls if args[:2] == ("issue", "comment")]
    assert len(comments) == 1 and comments[0].startswith("@euglopi")
    assert "**campaign-money**" in comments[0]

    current, _, _ = report.packet(rows)
    calls = fake_environment(
        monkeypatch, rows, [{"number": 7, "body": current, "state": "OPEN"}]
    )
    assert report.main() == 0
    assert not any(args[:2] == ("issue", "comment") for args, _ in calls)


def test_the_script_records_a_catch_up_and_requests_totals(database, monkeypatch):
    from scripts import check_campaign_money_completion as script

    with database() as db:
        snapshot = publish_filings_snapshot(
            db,
            filings=[
                ("90001", 2026, "total_receipts", Decimal("1"), date(2026, 7, 20))
            ],
        )
        db.add(
            models.CampaignFinanceFiler(
                snapshot_id=snapshot, registration_number="90001", kind=KIND, name="C"
            )
        )
        db.add(
            models.CampaignFinanceFilingReport(
                snapshot_id=snapshot,
                row_number=1,
                registration_number="90001",
                filing_year=2026,
                report_type="E",
                report_name="2026 Pre-General Report",
                cut_off_date=date(2026, 10, 19),
                filed_date=date(2026, 10, 21),
                special_election=False,
            )
        )
        for key in (completion.CATCH_UP_KEY, completion.PROBES_KEY):
            db.execute(
                delete(models.CampaignFinanceRefreshState).where(
                    models.CampaignFinanceRefreshState.key == key
                )
            )
        db.execute(delete(models.SourceRefreshState))
        db.commit()

    answers = iter([date(2026, 10, 19)] * 3)
    monkeypatch.setattr(
        filings,
        "fetch_figures",
        lambda _http, _kind, _registration, segment: (
            None,
            tab(y2026=next(answers), y2027=None),
        ),
    )
    engine = get_engine()
    with database() as db:
        # A campaign run in progress: the catch-up is recorded but not requested.
        db.add(
            models.SourceRefreshState(
                name="campaign-money",
                next_due_at=NOW,
                failures=0,
                token=uuid.uuid4(),
                lease_expires_at=NOW + timedelta(hours=1),
            )
        )
        db.commit()
    running = script.check(engine, now=NOW, today=NOW.date())
    assert not running.request_totals
    with database() as db:
        db.execute(delete(models.SourceRefreshState))
        db.execute(
            delete(models.CampaignFinanceRefreshState).where(
                models.CampaignFinanceRefreshState.key.in_(
                    [completion.CATCH_UP_KEY, completion.PROBES_KEY]
                )
            )
        )
        db.commit()
    result = script.check(engine, now=NOW, today=NOW.date())
    assert result.request_totals and result.code == 0

    with database() as db:
        marker = db.get(models.CampaignFinanceRefreshState, completion.CATCH_UP_KEY)
        assert marker.value["filer_years"] == ["90001:2026"]
        signal = db.get(models.SourceRefreshState, "signal:campaign-money")
        assert signal is not None

        # Our totals catch up: the filer leaves the lagging set and the record goes.
        db.execute(
            text(
                "UPDATE cf_filing SET reported_through = '2026-10-19' "
                "WHERE registration_number = '90001'"
            )
        )
        db.commit()
    script.check(engine, now=NOW + timedelta(hours=1), today=NOW.date())
    with database() as db:
        assert (
            db.get(models.CampaignFinanceRefreshState, completion.CATCH_UP_KEY) is None
        )
        db.execute(delete(models.SourceRefreshState))
        db.execute(
            delete(models.CampaignFinanceRefreshState).where(
                models.CampaignFinanceRefreshState.key == completion.PROBES_KEY
            )
        )
        db.commit()


def _body_with_mention(rows, key, when):
    body, _, _ = report.packet(rows)
    return (
        body + f"\n{report.MENTIONED_MARKER}{json.dumps({key: when.isoformat()})} -->"
    )


def test_a_problem_that_returns_within_a_day_is_not_announced_again(monkeypatch):
    from alethical.tests.test_source_refresh_health_report import fake_environment

    rows = [health_row("lobbying-discovery", {"finding_key": "a"})]
    key = report.problem_keys(rows)[0]
    # It cleared on the last run (body lists nothing) but was announced 2 hours ago.
    cleared = _body_with_mention([], key, datetime.now(UTC) - timedelta(hours=2))
    calls = fake_environment(
        monkeypatch, rows, [{"number": 7, "body": cleared, "state": "CLOSED"}]
    )
    assert report.main() == 0
    assert not any(args[:2] == ("issue", "comment") for args, _ in calls)
    edited = next(body for args, body in calls if args[:2] == ("issue", "edit"))
    assert key in edited  # the earlier announcement is still remembered

    stale = _body_with_mention([], key, datetime.now(UTC) - timedelta(hours=25))
    calls = fake_environment(
        monkeypatch, rows, [{"number": 7, "body": stale, "state": "CLOSED"}]
    )
    assert report.main() == 0
    assert any(args[:2] == ("issue", "comment") for args, _ in calls)


def test_a_failed_workflow_step_is_shown_but_never_announced(monkeypatch):
    from alethical.tests.test_source_refresh_health_report import fake_environment

    monkeypatch.setenv("SOURCE_REFRESH_COLLECT_RESULT", "failure")
    old_body, _, _ = report.packet([])
    calls = fake_environment(
        monkeypatch, [], [{"number": 7, "body": old_body, "state": "CLOSED"}]
    )
    assert report.main() == 0
    edited = next(body for args, body in calls if args[:2] == ("issue", "edit"))
    assert "workflow-collect" in edited
    assert not any(args[:2] == ("issue", "comment") for args, _ in calls)


def test_a_held_back_recurrence_is_announced_once_the_quiet_period_ends(monkeypatch):
    from alethical.tests.test_source_refresh_health_report import fake_environment

    rows = [health_row("lobbying-discovery", {"finding_key": "a"})]
    key = report.problem_keys(rows)[0]
    # Fixed after its mention 2 hours ago, then back: held back, and remembered.
    cleared = _body_with_mention([], key, datetime.now(UTC) - timedelta(hours=2))
    calls = fake_environment(
        monkeypatch, rows, [{"number": 7, "body": cleared, "state": "CLOSED"}]
    )
    assert report.main() == 0
    assert not any(args[:2] == ("issue", "comment") for args, _ in calls)
    held = next(body for args, body in calls if args[:2] == ("issue", "edit"))
    assert report.deferred_problems(held) == [key]

    # Still open a day later and no longer new to the body: announced now.
    day_old = json.dumps({key: (datetime.now(UTC) - timedelta(hours=25)).isoformat()})
    before, _, after = held.partition(report.MENTIONED_MARKER)
    later = f"{before}{report.MENTIONED_MARKER}{day_old} -->{after.split(' -->', 1)[1]}"
    # Nothing else changed: the body's fingerprint is the current one.
    assert report.packet(rows)[1] in later
    calls = fake_environment(
        monkeypatch, rows, [{"number": 7, "body": later, "state": "OPEN"}]
    )
    assert report.main() == 0
    assert any(args[:2] == ("issue", "comment") for args, _ in calls)
