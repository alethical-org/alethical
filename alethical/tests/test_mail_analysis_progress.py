"""Progressive private mail reading stays fenced and input-scoped."""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from threading import Event
from types import SimpleNamespace
import uuid

import pytest
from sqlalchemy import select

from alethical.api.services import mail_analysis
from alethical.db import models as m
from alethical.db.session import get_session_factory
from alethical.tests.test_mail_upload import (
    draft,
    session,
    upload,
    photo,
    storage as storage,
)


def saved(client, *, colors=("red", "blue")):
    headers, _, _ = session(client)
    path = draft(client, headers)
    for side, color in zip(("front", "back"), colors, strict=True):
        assert upload(client, path, headers, side, photo(color)).status_code == 200
    assert (
        client.post(
            path + "/submit", headers=headers, json={"likes_ad": True}
        ).status_code
        == 200
    )
    return headers, path


def reading(text="Readable words"):
    return {"status": "read", "text": text, "disclosures": [], "complete": False}


@pytest.mark.usefixtures("storage")
def test_first_side_is_visible_before_second_finishes(client, monkeypatch):
    headers, path = saved(client)
    back_started, release, published = Event(), Event(), Event()
    publish = mail_analysis.publish_progress

    def observe(*args):
        ok = publish(*args)
        if (
            ok
            and args[-1]["progress"]["completed_sides"] == ["front"]
            and args[-1]["progress"]["active_sides"] == ["back"]
        ):
            published.set()
        return ok

    monkeypatch.setattr(mail_analysis, "publish_progress", observe)

    def read(path):
        if path.name == "back":
            back_started.set()
            assert release.wait(10)
        return reading(path.name + " readable words")

    monkeypatch.setattr(mail_analysis, "read_image", read)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(mail_analysis.drain_once)
        try:
            assert back_started.wait(10)
            assert published.wait(10)
            data = client.get(path + "/analysis", headers=headers).json()["data"]
            assert data["status"] == "processing"
            assert data["snapshot_version"] == 1
            assert data["progress"] == {
                "active_sides": ["back"],
                "completed_sides": ["front"],
                "reading_complete": False,
                "records_complete": False,
            }
            assert data["sides"][0]["text"] == "front readable words"
            assert "payer_status" not in data
        finally:
            release.set()
            future.result(timeout=10)
    data = client.get(path + "/analysis", headers=headers).json()["data"]
    assert data["progress"]["records_complete"] is True
    assert data["payer_status"] == "not_found"


@pytest.mark.usefixtures("storage")
def test_records_loading_publishes_identity_without_false_failure(client, monkeypatch):
    headers, path = saved(client)
    started, release, both_read = Event(), Event(), Event()
    publish = mail_analysis.publish_progress

    def observe(*args):
        ok = publish(*args)
        if ok and args[-1]["progress"]["reading_complete"]:
            both_read.set()
        return ok

    monkeypatch.setattr(mail_analysis, "publish_progress", observe)
    quote = {
        "quote": "Paid for by Example",
        "payer_text": "Example",
        "confidence": 99,
        "edge_warning": False,
    }
    monkeypatch.setattr(
        mail_analysis, "read_image", lambda _: {**reading(), "disclosures": [quote]}
    )
    monkeypatch.setattr(
        mail_analysis,
        "candidate_records",
        lambda *_: [
            {
                "name": "Example",
                "registration_number": "123",
                "scope": "candidate_record",
                "source_url": "https://example.org",
            }
        ],
    )

    def records(*_):
        started.set()
        assert release.wait(10)
        return {"state": "available", "registration_number": "123", "year": 2026}

    monkeypatch.setattr(mail_analysis, "public_records", records)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(mail_analysis.drain_once)
        try:
            assert started.wait(10)
            assert both_read.wait(10)
            data = client.get(path + "/analysis", headers=headers).json()["data"]
            assert data["progress"] == {
                "active_sides": [],
                "completed_sides": ["front", "back"],
                "reading_complete": True,
                "records_complete": False,
            }
            assert data["payers"][0]["candidates"][0]["records"]["state"] == "loading"
            assert data["status"] == "processing"
            assert data["records_retry_needed"] is False
        finally:
            release.set()
            future.result(timeout=10)


@pytest.mark.usefixtures("storage")
def test_progressive_write_rejects_reclaimed_lease(client):
    _, path = saved(client)
    sid = uuid.UUID(path.rsplit("/", 1)[1])
    started = datetime.now(timezone.utc)
    with get_session_factory()() as db:
        db.add(
            m.MailUploadAnalysis(
                submission_id=sid,
                status="processing",
                attempts=2,
                started_at=started,
                result={"payers": [{"kept": True}]},
            )
        )
        db.commit()
    assert (
        mail_analysis.publish_progress(
            sid, 1, started - timedelta(seconds=1), {"payers": []}
        )
        is False
    )
    with get_session_factory()() as db:
        assert db.get(m.MailUploadAnalysis, sid).result == {"payers": [{"kept": True}]}


@pytest.mark.usefixtures("storage")
def test_exact_reading_reuse_is_versioned_and_does_not_copy_other_feedback(
    client, monkeypatch
):
    _, first = saved(client)
    calls = []
    monkeypatch.setattr(
        mail_analysis, "read_image", lambda path: calls.append(path.name) or reading()
    )
    mail_analysis.drain_once()
    assert len(calls) == 2
    headers, second = saved(client)
    mail_analysis.drain_once()
    assert len(calls) == 2
    data = client.get(second + "/analysis", headers=headers).json()["data"]
    assert len(data["sides"]) == 2
    assert first.rsplit("/", 1)[1] not in str(data)
    with get_session_factory()() as db:
        for row in db.scalars(select(m.MailUploadAnalysis)):
            row.result = {
                **row.result,
                "version": "old-reader",
                "sides": [
                    {**side, "reader_version": "old-reader"}
                    for side in row.result["sides"]
                ],
            }
        db.commit()
    saved(client)
    mail_analysis.drain_once()
    assert len(calls) == 4


def test_worker_drains_backlog_without_fixed_wait(monkeypatch):
    monkeypatch.setenv("ALETHICAL_MAIL_ANALYSIS_ENABLED", "true")
    monkeypatch.setattr(mail_analysis, "require_ocr_runtime", lambda: None)
    calls = []

    def drain():
        calls.append(True)
        return len(calls) < 3

    monkeypatch.setattr(mail_analysis, "drain_once", drain)

    async def check():
        async with mail_analysis.mail_analysis_lifespan(
            SimpleNamespace(state=SimpleNamespace())
        ):
            for _ in range(30):
                if len(calls) >= 3:
                    break
                await asyncio.sleep(0.01)
            assert len(calls) == 3

    asyncio.run(check())


def test_idle_worker_wakes_from_submit_signal(monkeypatch):
    monkeypatch.setenv("ALETHICAL_MAIL_ANALYSIS_ENABLED", "true")
    monkeypatch.setattr(mail_analysis, "require_ocr_runtime", lambda: None)
    calls = []
    monkeypatch.setattr(
        mail_analysis, "drain_once", lambda: calls.append(True) or False
    )
    app = SimpleNamespace(state=SimpleNamespace())

    async def check():
        async with mail_analysis.mail_analysis_lifespan(app):
            for _ in range(30):
                if calls:
                    break
                await asyncio.sleep(0.01)
            assert len(calls) == 1
            await asyncio.to_thread(mail_analysis.wake_worker, app)
            for _ in range(30):
                if len(calls) > 1:
                    break
                await asyncio.sleep(0.01)
            assert len(calls) == 2

    asyncio.run(check())


@pytest.mark.usefixtures("storage")
def test_parallel_sides_publish_finished_back_while_front_waits(client, monkeypatch):
    headers, path = saved(client)
    front_started, release = Event(), Event()
    monkeypatch.setenv("ALETHICAL_MAIL_READ_CONCURRENCY", "2")

    def read(path):
        if path.name == "front":
            front_started.set()
            assert release.wait(10)
        else:
            assert front_started.wait(10)
        return reading(path.name + " readable words")

    published = Event()
    real_publish = mail_analysis.publish_progress

    def observe(*args):
        accepted = real_publish(*args)
        if args[-1]["progress"]["completed_sides"] == ["back"]:
            published.set()
        return accepted

    monkeypatch.setattr(mail_analysis, "publish_progress", observe)
    monkeypatch.setattr(mail_analysis, "read_image", read)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(mail_analysis.drain_once)
        try:
            assert published.wait(10)
            data = client.get(path + "/analysis", headers=headers).json()["data"]
            assert data["progress"]["completed_sides"] == ["back"]
            assert data["sides"][0]["side"] == "back"
        finally:
            release.set()
            future.result(timeout=10)
    data = client.get(path + "/analysis", headers=headers).json()["data"]
    assert [side["side"] for side in data["sides"]] == ["front", "back"]


@pytest.mark.usefixtures("storage")
def test_fenced_worker_cannot_overwrite_reclaimed_result(client, monkeypatch):
    _, path = saved(client)
    sid = uuid.UUID(path.rsplit("/", 1)[1])
    completed = {"version": "new-owner", "sides": [], "payers": []}
    real_publish = mail_analysis.publish_progress

    def reclaim(*args):
        with get_session_factory()() as db:
            row = db.get(m.MailUploadAnalysis, sid)
            row.attempts += 1
            row.started_at = datetime.now(timezone.utc)
            row.result = completed
            db.commit()
        return real_publish(*args)

    monkeypatch.setattr(mail_analysis, "publish_progress", reclaim)
    monkeypatch.setattr(mail_analysis, "read_image", lambda _: reading())
    mail_analysis.drain_once()
    with get_session_factory()() as db:
        row = db.get(m.MailUploadAnalysis, sid)
        assert row.result == completed
        assert row.status == "processing"
        assert row.attempts == 2


@pytest.mark.usefixtures("storage")
@pytest.mark.parametrize("changed", ["byte_count", "content_type", "width", "height"])
def test_reuse_rejects_metadata_mismatch(client, monkeypatch, changed):
    saved(client)
    calls = []
    monkeypatch.setattr(
        mail_analysis, "read_image", lambda path: calls.append(path.name) or reading()
    )
    mail_analysis.drain_once()
    with get_session_factory()() as db:
        row = db.scalar(select(m.MailUploadAnalysis))
        result = deepcopy(row.result)
        for side in result["sides"]:
            side["input"][changed] = (
                "invalid" if changed == "content_type" else side["input"][changed] + 1
            )
        row.result = result
        db.commit()
    saved(client)
    mail_analysis.drain_once()
    assert len(calls) == 4


@pytest.mark.usefixtures("storage")
def test_reuse_copies_extraction_only_not_submission_fields(client, monkeypatch):
    saved(client)
    monkeypatch.setattr(mail_analysis, "read_image", lambda _: reading())
    mail_analysis.drain_once()
    with get_session_factory()() as db:
        row = db.scalar(select(m.MailUploadAnalysis))
        result = deepcopy(row.result)
        result["private_comment"] = "other person's feedback"
        for side in result["sides"]:
            side["private_comment"] = "other person's feedback"
            side["owner_token"] = "other person's credential"
            side["payers"] = [{"payer_text": "not source extraction"}]
        row.result = result
        db.commit()
    headers, path = saved(client)
    monkeypatch.setattr(
        mail_analysis,
        "read_image",
        lambda _: (_ for _ in ()).throw(AssertionError("must reuse")),
    )
    mail_analysis.drain_once()
    result = client.get(path + "/analysis", headers=headers).json()["data"]
    assert result["status"] == "ready"
    assert "other person" not in str(result)
    assert result["payers"] == []


@pytest.mark.usefixtures("storage")
def test_routes_wake_only_after_committed_save_and_retry(client, monkeypatch):
    observed = []

    def wake(_):
        with get_session_factory()() as db:
            rows = db.scalars(
                select(m.MailUploadSubmission).where(
                    m.MailUploadSubmission.saved_at.is_not(None)
                )
            ).all()
            assert rows
            observed.append(True)

    monkeypatch.setattr(mail_analysis, "wake_worker", wake)
    headers, path = saved(client)
    assert observed == [True]
    monkeypatch.setattr(
        mail_analysis, "read_image", lambda _: {**reading(), "status": "partial"}
    )
    mail_analysis.drain_once()
    assert client.post(path + "/analysis/retry", headers=headers).status_code == 200
    assert observed == [True, True]


def test_extraction_allowlist_removes_nested_private_and_assembled_fields():
    result = mail_analysis.extraction_copy(
        {
            "text": "Paid for by Example",
            "private_comment": "private",
            "recovery_canvas": {
                "source_size": [4032, 3024],
                "size": [2400, 1800],
                "resample": "bicubic",
                "owner_token": "secret",
            },
            "disclosures": [
                {
                    "quote": "Paid for by Example",
                    "payer_text": "Example",
                    "owner_token": "secret",
                    "candidates": [{"name": "wrong"}],
                    "crop": {"width": 100, "owner_token": "secret"},
                }
            ],
            "reading_lines": [
                {
                    "text": "Example",
                    "owner_token": "secret",
                    "words": [
                        {"text": "Example", "confidence": 99, "owner_token": "secret"}
                    ],
                }
            ],
        }
    )
    assert "secret" not in str(result)
    assert "private" not in str(result)
    assert "candidates" not in str(result)
    assert result["recovery_canvas"] == {
        "source_size": [4032, 3024],
        "size": [2400, 1800],
        "resample": "bicubic",
    }
    assert result["disclosures"][0]["crop"] == {"width": 100}
    assert result["reading_lines"][0]["words"] == [
        {"text": "Example", "confidence": 99}
    ]


@pytest.mark.usefixtures("storage")
def test_progress_marks_only_actually_running_side(client, monkeypatch):
    headers, path = saved(client)
    monkeypatch.setenv("ALETHICAL_MAIL_READ_CONCURRENCY", "1")
    visible, release = Event(), Event()
    publish = mail_analysis.publish_progress

    def observe(*args):
        ok = publish(*args)
        if ok and args[-1]["progress"]["active_sides"] == ["front"]:
            visible.set()
        return ok

    def read(path):
        if path.name == "front":
            assert release.wait(10)
        return reading()

    monkeypatch.setattr(mail_analysis, "read_image", read)
    monkeypatch.setattr(mail_analysis, "publish_progress", observe)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(mail_analysis.drain_once)
        try:
            assert visible.wait(10)
            data = client.get(path + "/analysis", headers=headers).json()["data"]
            assert data["status"] == "processing"
            assert data["progress"]["active_sides"] == ["front"]
            assert data["progress"]["completed_sides"] == []
            assert data["sides"] == []
            assert "payer_status" not in data
        finally:
            release.set()
            future.result(timeout=10)
    data = client.get(path + "/analysis", headers=headers).json()["data"]
    assert data["progress"]["active_sides"] == []


@pytest.mark.usefixtures("storage")
def test_old_reader_evidence_survives_failed_fresh_read_without_becoming_cache(
    client, monkeypatch
):
    headers, path = saved(client)
    monkeypatch.setattr(
        mail_analysis, "read_image", lambda _: reading("Earlier useful source words")
    )
    mail_analysis.drain_once()
    sid = uuid.UUID(path.rsplit("/", 1)[1])
    with get_session_factory()() as db:
        row = db.get(m.MailUploadAnalysis, sid)
        result = deepcopy(row.result)
        result["version"] = "tesseract-english-v3"
        for side in result["sides"]:
            side.pop("input")  # Actual older saved payload had only a hash.
            side.pop("reader_version")
            side["status"] = "partial"
        row.result = result
        row.status = "partial"
        db.commit()
    assert client.post(path + "/analysis/retry", headers=headers).status_code == 200
    calls = []
    monkeypatch.setattr(
        mail_analysis,
        "read_image",
        lambda path: (
            calls.append(path.name)
            or {
                "status": "unreadable",
                "text": "",
                "disclosures": [],
                "complete": False,
            }
        ),
    )
    mail_analysis.drain_once()
    data = client.get(path + "/analysis", headers=headers).json()["data"]
    assert len(calls) == 2
    assert data["status"] == "partial"
    for side in data["sides"]:
        assert side["text"] == "Earlier useful source words"
        assert side["reader_version"] == "tesseract-english-v3"
        assert side["status"] == "partial"
    # A fresh identical submission still has to read; the fallback is not v4 evidence.
    _, fresh = saved(client)
    mail_analysis.drain_once()
    assert len(calls) == 4
    # Retrying the same submission also reads again rather than promoting fallback.
    assert client.post(path + "/analysis/retry", headers=headers).status_code == 200
    mail_analysis.drain_once()
    assert len(calls) == 6
