"""Manual collectors share the scheduled campaign writer lease."""

from contextlib import contextmanager
import importlib
from types import SimpleNamespace

import pytest


@pytest.mark.parametrize("kind", ["notices", "statements"])
@pytest.mark.parametrize("busy", [None, "NoticeWriterBusy", "NoticeWriterLost"])
def test_busy_or_lost_notice_writer_defers_without_success(monkeypatch, kind, busy):
    """Collectors take their own short writer lock, not the long money lease."""
    from alethical.pipeline import notice_collection_lock

    module = importlib.import_module(f"scripts.collect_campaign_finance_{kind}")
    monkeypatch.setattr(
        "sys.argv", ["collector", "--database-url", "postgresql://unused"]
    )
    monkeypatch.setattr(
        module, "create_engine", lambda *a, **k: SimpleNamespace(dispose=lambda: 0)
    )
    stages = []

    def collect(*args, **kwargs):
        if busy:
            raise getattr(notice_collection_lock, busy)("writer unavailable")
        return 0

    monkeypatch.setattr(module, "_collect", collect)
    monkeypatch.setattr(module, "record_stage", lambda *a, **k: stages.append(a))
    assert module.main() == (76 if busy else 0)
    assert stages == ([(kind, "skipped")] if busy else [])


def test_future_notice_year_is_reviewed_instead_of_silent_success(monkeypatch):
    import io
    import json
    from types import SimpleNamespace
    from scripts import collect_campaign_finance_notices as command
    from alethical.pipeline.campaign_finance_notices import NoticeRunReport

    @contextmanager
    def session(engine):
        yield SimpleNamespace(execute=lambda *a: SimpleNamespace(scalar=lambda: True))

    report = NoticeRunReport(
        observed_years=[2028], source_page_sha256="source-hash", listed=1, new=1
    )
    monkeypatch.setattr(command, "Session", session)
    monkeypatch.setattr(command.filings, "http_session", lambda: None)
    monkeypatch.setattr(command, "DatabaseRequestLimiter", lambda engine: None)
    monkeypatch.setattr(
        command,
        "RateLimitedSession",
        lambda session, limiter: SimpleNamespace(close=lambda: 0),
    )
    monkeypatch.setattr(command, "raw_file_store_from_env", lambda: None)
    monkeypatch.setattr(command.notices, "collect_notices", lambda *a, **k: report)
    monkeypatch.setattr(command, "clear_and_note", lambda *a, **k: (False, "cleared"))
    monkeypatch.setattr(command, "record_stage", lambda *a, **k: None)
    output = io.StringIO()
    args = SimpleNamespace(
        dry_run=False, pdf_cache=None, refresh_existing=False, skip_ballot=True
    )
    assert command._collect(args, None, json_output=output) == 2
    result = json.loads(output.getvalue())
    assert result["status"] == "review"
    assert result["missing_notice_window_years"] == [2028]
    assert result["source_page_sha256"] == "source-hash"
    assert 2028 not in command.notices.NOTICE_WINDOWS


def test_new_calendar_does_not_reuse_old_ballot_file(monkeypatch):
    from scripts import collect_campaign_finance_notices as command
    from alethical.pipeline.campaign_finance_notices import NoticeRunReport

    monkeypatch.setitem(command.notices.NOTICE_WINDOWS, 2028, ())
    result = command.notice_finding(
        NoticeRunReport(observed_years=[2028]),
        now_year=2028,
        skip_ballot=False,
        failed=False,
    )
    assert result["status"] == "review"
    assert result["ballot_source_years_needing_review"] == [2028]
    assert result["missing_notice_window_years"] == []
    assert (
        command.notice_finding(
            NoticeRunReport(observed_years=[2028]),
            now_year=2028,
            skip_ballot=False,
            failed=True,
        )["status"]
        == "failed"
    )


@pytest.mark.parametrize(
    "not_served, failures, expected, status",
    [
        (["https://cfb.mn.gov/statement.pdf"], [], 2, "review"),
        (["https://cfb.mn.gov/statement.pdf"], ["catalogue unreadable"], 1, "failed"),
        ([], [], 0, "complete"),
    ],
    ids=["board-holds-no-file", "real-problem", "clean"],
)
def test_statement_pdfs_the_board_does_not_hold_ask_for_review(
    monkeypatch, capsys, not_served, failures, expected, status
):
    import json
    from scripts import collect_campaign_finance_statements as command

    @contextmanager
    def session(engine):
        yield SimpleNamespace(execute=lambda *a: SimpleNamespace(scalar=lambda: True))

    kind = command.schema.CampaignFinanceFilerKind.political_committee_or_fund
    reference = SimpleNamespace(
        filers=[SimpleNamespace(kind=kind, registration_number="20003")],
        still_current=lambda db: True,
    )
    report = SimpleNamespace(
        catalogues_read=1,
        listed=1,
        new=0,
        pdfs_fetched=0,
        notice_amendments=0,
        failures=failures,
        not_served=not_served,
    )
    monkeypatch.setattr(command, "Session", session)
    monkeypatch.setattr(command, "load_reference", lambda engine: reference)
    monkeypatch.setattr(command, "raw_file_store_from_env", lambda: None)
    monkeypatch.setattr(command, "DatabaseRequestLimiter", lambda engine: None)
    monkeypatch.setattr(command, "RateLimitedSession", lambda *a: None)
    monkeypatch.setattr(command.filings, "http_session", lambda: None)
    monkeypatch.setattr(
        command.notices, "scan_catalogues_for_statements", lambda *a, **k: report
    )
    monkeypatch.setattr(command, "clear_and_note", lambda *a, **k: (False, "cleared"))
    monkeypatch.setattr(command, "record_stage", lambda *a, **k: None)
    monkeypatch.setattr(
        command, "create_engine", lambda *a, **k: SimpleNamespace(dispose=lambda: 0)
    )
    monkeypatch.setattr(
        "sys.argv",
        [
            "collector",
            "--database-url",
            "postgresql://unused",
            "--kinds",
            "committees",
            "--json",
        ],
    )
    assert command.main() == expected
    summary = json.loads(capsys.readouterr().out)
    assert summary["status"] == status
    assert summary["pdfs_not_served"] == len(not_served)
