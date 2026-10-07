"""Manual collectors share the scheduled campaign writer lease."""

from contextlib import contextmanager
import importlib

import pytest


@pytest.mark.parametrize("kind", ["notices", "statements"])
@pytest.mark.parametrize("held", [False, True])
def test_collector_defers_without_reading_or_writing(monkeypatch, kind, held):
    module = importlib.import_module(f"scripts.collect_campaign_finance_{kind}")
    monkeypatch.setattr(
        "sys.argv", ["collector", "--database-url", "postgresql://unused"]
    )
    monkeypatch.setattr(module, "create_engine", lambda *a, **k: object())
    events = []

    @contextmanager
    def lease(*a, **k):
        events.append("acquire")
        try:
            yield held
        finally:
            events.append("release")

    monkeypatch.setattr(module, "hold_full_run_lease", lease)
    monkeypatch.setattr(module, "_collect", lambda *a: events.append("collect") or 0)
    monkeypatch.setattr(module, "record_stage", lambda *a, **k: events.append(a))
    assert module.main() == (0 if held else 76)
    assert events == (
        ["acquire", "collect", "release"]
        if held
        else ["acquire", (kind, "skipped"), "release"]
    )


@pytest.mark.parametrize("kind", ["notices", "statements"])
def test_readonly_collector_needs_no_writer_lease(monkeypatch, kind):
    module = importlib.import_module(f"scripts.collect_campaign_finance_{kind}")
    monkeypatch.setattr(
        "sys.argv", ["collector", "--database-url", "postgresql://unused", "--dry-run"]
    )
    monkeypatch.setattr(module, "create_engine", lambda *a, **k: object())
    monkeypatch.setattr(
        module,
        "hold_full_run_lease",
        lambda *a, **k: pytest.fail("dry run acquired writer lease"),
    )
    monkeypatch.setattr(
        module, "_collect", lambda args, engine: 0 if args.dry_run else 1
    )
    assert module.main() == 0


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
