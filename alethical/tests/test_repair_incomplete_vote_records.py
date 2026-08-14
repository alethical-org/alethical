from __future__ import annotations

import sys
from types import SimpleNamespace
import uuid

import pytest

from scripts import repair_incomplete_vote_records as repair_script


def test_live_repair_is_limited_to_the_4_issue_540_members() -> None:
    expected = {uuid.uuid4() for _ in repair_script.ISSUE_540_MEMBER_KEYS}
    rows = [
        SimpleNamespace(
            id=legislator_id,
            external_key=f"https://www.house.mn.gov/members/profile/{member_key}",
        )
        for member_key, legislator_id in zip(
            sorted(repair_script.ISSUE_540_MEMBER_KEYS), sorted(expected, key=str)
        )
    ]
    rows.append(
        SimpleNamespace(
            id=uuid.uuid4(),
            external_key="https://www.house.mn.gov/members/profile/99999",
        )
    )

    class FakeDatabase:
        def scalars(self, _query):  # noqa: ANN202
            return SimpleNamespace(all=lambda: rows)

    assert repair_script.issue_540_legislator_ids(FakeDatabase()) == expected  # type: ignore[arg-type]


def test_write_requires_backup_before_database_connection(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "repair_incomplete_vote_records.py",
            "--target",
            "production",
            "--write",
        ],
    )
    monkeypatch.setattr(
        repair_script,
        "create_engine",
        lambda *_args, **_kwargs: pytest.fail("database opened without a backup path"),
    )

    with pytest.raises(SystemExit) as raised:
        repair_script.main()

    assert raised.value.code == 2
    assert "--write requires --backup-path" in capsys.readouterr().err


def test_source_requests_are_serial_and_paced(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeRequestsSession:
        def __init__(self) -> None:
            self.urls: list[str] = []

        def get(self, url: str, **_kwargs):  # noqa: ANN201
            self.urls.append(url)
            return url

        def close(self) -> None:
            return None

    source = FakeRequestsSession()
    monotonic = iter((10.0, 10.0, 10.1, 10.5))
    sleeps: list[float] = []
    monkeypatch.setattr(repair_script.requests, "Session", lambda: source)
    monkeypatch.setattr(repair_script.time, "monotonic", lambda: next(monotonic))
    monkeypatch.setattr(repair_script.time, "sleep", sleeps.append)
    session = repair_script.PacedSourceSession(interval_seconds=0.5)

    assert session.get("https://example.test/one") == "https://example.test/one"
    assert session.get("https://example.test/two") == "https://example.test/two"

    assert source.urls == [
        "https://example.test/one",
        "https://example.test/two",
    ]
    assert sleeps == [pytest.approx(0.4)]
