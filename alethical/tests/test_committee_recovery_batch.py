"""Real Postgres recovery turns; only HTTP, the clock and crashes are simulated."""

import json
import time
import uuid
from datetime import timedelta

import httpx
import pytest
from sqlalchemy import delete, select, text
from sqlalchemy.orm import Session

from alethical.db import models as m
from alethical.db.session import get_engine
from alethical.pipeline import bill_action_committee_backfill as recovery
from alethical.pipeline import committee_recovery_batch as batch
from alethical.pipeline import record_refresh as refresh
from alethical.pipeline.minnesota import (
    MinnesotaIngestionPipeline,
    parse_bill_xml,
    parse_datetime,
)
from alethical.pipeline.request_limits import DatabaseRequestLimiter
from alethical.tests.test_minnesota_ingestion import COMMITTEE_BILL_XML

URL = "https://api.revisor.mn.gov/bills/v1/94/2025/0/HF/6666/"


@pytest.fixture
def setup(seed_database, tmp_path, monkeypatch):
    engine = get_engine()
    monkeypatch.setenv("ALETHICAL_SOURCE_REFRESH_FAMILIES", "[]")
    with engine.begin() as c:
        c.execute(delete(m.SourceRefreshAttempt))
        c.execute(delete(m.SourceRefreshState))
        c.execute(text("DELETE FROM source_request_limits"))
    with Session(engine) as db:
        sample = db.scalar(select(m.Bill))
        house = db.scalar(select(m.Chamber).where(m.Chamber.slug == "house"))
        bill = m.Bill(
            session_id=sample.session_id,
            chamber_id=house.id,
            bill_key="94-2025-HF6666",
            file_type="HF",
            file_number=6666,
            title="Test",
        )
        committee = m.Committee(
            session_id=sample.session_id,
            chamber_id=house.id,
            code="94012",
            name="Not used for matching",
        )
        db.add_all([bill, committee])
        db.flush()
        pipeline = MinnesotaIngestionPipeline(db)
        run = pipeline.start_run("bill", bill.bill_key)
        artifact = pipeline.record_artifact(
            run, m.ArtifactType.xml, URL, COMMITTEE_BILL_XML
        )
        item = parse_bill_xml(COMMITTEE_BILL_XML)["actions"]["house"][0]
        action = m.BillAction(
            bill_id=bill.id,
            chamber_id=house.id,
            action_number=1,
            action_text=item["action_text"],
            action_at=parse_datetime(item["action_date"]),
            committee_name=item["committee_name"],
            source_artifact_id=artifact.id,
        )
        db.add(action)
        db.commit()
        ids = bill.id, action.id, committee.id, artifact.id, run.id
    manifest = batch.inventory(engine, tmp_path, "local")
    # This test inventory keeps only the new bill; the real query is tested below.
    manifest["bills"] = [r for r in manifest["bills"] if r["id"] == str(ids[0])]
    manifest["sha256"] = batch.digest(
        {k: v for k, v in manifest.items() if k != "sha256"}
    )
    (tmp_path / "inventory.json").write_text(json.dumps(manifest))
    client = httpx.Client(
        transport=httpx.MockTransport(
            lambda req: httpx.Response(200, text=COMMITTEE_BILL_XML)
        )
    )
    yield engine, tmp_path, ids, client
    client.close()
    with engine.begin() as c:
        c.execute(delete(m.BillAction).where(m.BillAction.bill_id == ids[0]))
        c.execute(delete(m.Bill).where(m.Bill.id == ids[0]))
        c.execute(delete(m.Committee).where(m.Committee.id == ids[2]))
        c.execute(delete(m.SourceArtifact).where(m.SourceArtifact.id == ids[3]))
        c.execute(delete(m.IngestionRun).where(m.IngestionRun.id == ids[4]))
        c.execute(delete(m.SourceRefreshAttempt))
        c.execute(delete(m.SourceRefreshState))
        c.execute(text("DELETE FROM source_request_limits"))


def release_cooldown(engine):
    # Test clock advances only the owned job, never used by production runner.
    with engine.begin() as c:
        c.execute(
            text(
                "UPDATE source_refresh_state SET next_due_at=clock_timestamp()-interval '1 second' WHERE name=:name"
            ),
            {"name": batch.JOB.name},
        )


def test_apply_exact_rows_then_resume_without_duplicate(setup):
    engine, root, ids, client = setup
    with Session(engine) as db:
        prior = recovery.before(db.get(m.BillAction, ids[1]))
    answer = batch.run_turn(engine, root, "local", apply=True, client=client)
    assert answer["status"] == "pass_finished"
    assert answer["outcomes"] == {"applied": 1}
    with Session(engine) as db:
        assert recovery.before(db.get(m.BillAction, ids[1])) == {
            **prior,
            "committee_id": str(ids[2]),
        }
        assert db.get(m.SourceRefreshState, "lane:legislative").token is None
    release_cooldown(engine)
    assert (
        batch.run_turn(engine, root, "local", apply=True, client=client)["outcomes"]
        == {}
    )
    assert len(list(root.glob("*/attempt-*/receipt.json"))) == 1


def test_busy_lane_and_due_normal_work_do_not_fetch(setup):
    engine, root, _, _ = setup
    client = httpx.Client(
        transport=httpx.MockTransport(lambda req: pytest.fail("must not fetch"))
    )
    with Session(engine) as db:
        now = db.scalar(select(__import__("sqlalchemy").func.clock_timestamp()))
        busy = refresh.claim_job(
            db,
            refresh.RefreshJob(
                "other",
                timedelta(hours=1),
                timedelta(minutes=5),
                (),
                "x",
                "x",
                lane="legislative",
            ),
        )
    assert batch.run_turn(engine, root, "local", client=client)["status"] == "deferred"
    with Session(engine) as db:
        refresh.finish_job(db, busy, code=0)
        name = next(k for k, v in refresh.jobs(now).items() if v.lane == "legislative")
        db.add(
            m.SourceRefreshState(
                name=name, next_due_at=now - timedelta(seconds=1), failures=0
            )
        )
        db.commit()
    assert batch.run_turn(engine, root, "local", client=client)["status"] == "deferred"
    assert not list(root.glob("*/attempt-*"))
    client.close()


def test_lost_lease_after_fetch_never_applies(setup):
    engine, root, ids, _ = setup

    def respond(req):
        with engine.begin() as c:
            c.execute(
                text("UPDATE source_refresh_state SET token=:token WHERE name=:name"),
                {"token": uuid.uuid4(), "name": batch.JOB.name},
            )
        return httpx.Response(200, text=COMMITTEE_BILL_XML)

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        with pytest.raises(batch.CleanupOwnershipLost, match="finish refused"):
            batch.run_turn(engine, root, "local", apply=True, client=client)
    with Session(engine) as db:
        assert db.get(m.BillAction, ids[1]).committee_id is None
    assert not list(root.glob("*/attempt-*/receipt.json"))


def test_no_fill_never_takes_product_locks(setup, monkeypatch):
    engine, root, ids, _ = setup
    monkeypatch.setattr(
        recovery, "lock", lambda *_: pytest.fail("no-fill must not lock")
    )
    xml = COMMITTEE_BILL_XML.replace(
        "<COMMITTEE_ID>94012</COMMITTEE_ID>", "<COMMITTEE_ID></COMMITTEE_ID>"
    )
    assert xml != COMMITTEE_BILL_XML
    with httpx.Client(
        transport=httpx.MockTransport(lambda req: httpx.Response(200, text=xml))
    ) as client:
        answer = batch.run_turn(engine, root, "local", apply=True, client=client)
    assert answer["outcomes"] == {"no_fill": 1}
    assert not list(root.glob("*/attempt-*/receipt.json"))


def test_source_cooldown_defers_without_moving_cursor(setup):
    engine, root, _, _ = setup
    with httpx.Client(
        transport=httpx.MockTransport(
            lambda req: httpx.Response(429, headers={"Retry-After": "900"})
        )
    ) as client:
        answer = batch.run_turn(engine, root, "local", apply=True, client=client)
    assert answer["status"] == "deferred" and answer["cursor"] == 0
    with engine.connect() as db:
        assert db.scalar(
            text(
                "SELECT blocked_until > clock_timestamp()+interval '890 seconds' FROM source_request_limits WHERE host='revisor.mn.gov'"
            )
        )
    assert not list(root.glob("*/attempt-*/receipt.json"))


def test_deadline_cooldown_does_not_sleep_or_consume_reservation(setup, monkeypatch):
    engine, _, _, _ = setup
    limiter = DatabaseRequestLimiter(engine)
    limiter.defer(URL, 900)
    with engine.connect() as db:
        prior = db.scalar(
            text(
                "SELECT next_request_at FROM source_request_limits WHERE host='revisor.mn.gov'"
            )
        )
    monkeypatch.setattr(
        time, "sleep", lambda *_: pytest.fail("must defer without sleeping")
    )
    with pytest.raises(TimeoutError, match="deadline"):
        limiter.wait(
            "https://www.revisor.mn.gov/bills/status_result.php",
            deadline=time.monotonic() + 1,
        )
    with engine.connect() as db:
        assert (
            db.scalar(
                text(
                    "SELECT next_request_at FROM source_request_limits WHERE host='revisor.mn.gov'"
                )
            )
            == prior
        )


def test_shared_budget_used_for_every_http_call(setup):
    engine, _, _, client = setup
    source = batch.SourceClient(engine, client, time.monotonic() + 10)
    reserved = []
    for _ in range(2):
        source(URL)
        with engine.connect() as db:
            reserved.append(
                db.scalar(
                    text(
                        "SELECT next_request_at FROM source_request_limits WHERE host='revisor.mn.gov'"
                    )
                )
            )
    assert all(reserved)
    assert (reserved[1] - reserved[0]).total_seconds() >= 0.5


@pytest.mark.parametrize("commit", [False, True])
def test_prepared_receipt_reconciles_before_retry(setup, commit):
    engine, root, ids, client = setup
    entry = json.loads((root / "inventory.json").read_text())["bills"][0]
    path = root / entry["id"] / "attempt-0001"
    path.mkdir(parents=True)
    with Session(engine) as db:
        saved = recovery.plan(
            db,
            entry["key"],
            COMMITTEE_BILL_XML,
            URL,
            source_generation=recovery.generation(db, entry["key"]),
        )
        recovery.apply(db, saved, COMMITTEE_BILL_XML, path / "receipt.json")
        db.commit() if commit else db.rollback()
    answer = batch.run_turn(engine, root, "local", apply=True, client=client)
    assert answer["status"] == "pass_finished"
    with Session(engine) as db:
        assert db.get(m.BillAction, ids[1]).committee_id == ids[2]
    first = json.loads((path / "result.json").read_text())
    assert first["status"] == ("applied" if commit else "aborted")
    assert len(list(root.glob("*/attempt-*/receipt.json"))) == (1 if commit else 2)


def test_changed_after_receipt_stops_without_overwrite(setup):
    engine, root, ids, client = setup
    entry = json.loads((root / "inventory.json").read_text())["bills"][0]
    path = root / entry["id"] / "attempt-0001"
    path.mkdir(parents=True)
    with Session(engine) as db:
        saved = recovery.plan(
            db,
            entry["key"],
            COMMITTEE_BILL_XML,
            URL,
            source_generation=recovery.generation(db, entry["key"]),
        )
        recovery.apply(db, saved, COMMITTEE_BILL_XML, path / "receipt.json")
        db.commit()
        db.get(m.BillAction, ids[1]).action_text = "Later source edit"
        db.commit()
    with pytest.raises(batch.AmbiguousReceipt, match="changed"):
        batch.run_turn(engine, root, "local", apply=True, client=client)
    assert not (path / "result.json").exists()
    with Session(engine) as db:
        assert db.get(m.BillAction, ids[1]).action_text == "Later source edit"
        assert db.get(m.SourceRefreshState, "lane:legislative").token is None


def test_plan_only_then_apply_and_immutable_inventory(setup):
    engine, root, ids, client = setup
    assert batch.run_turn(engine, root, "local", client=client)["outcomes"] == {
        "planned": 1
    }
    with Session(engine) as db:
        assert db.get(m.BillAction, ids[1]).committee_id is None
    release_cooldown(engine)
    assert batch.run_turn(engine, root, "local", apply=True, client=client)[
        "outcomes"
    ] == {"applied": 1}
    with pytest.raises(FileExistsError):
        batch.inventory(engine, root, "local")


def test_inventory_digest_and_turn_limits_refuse_before_fetch(setup):
    engine, root, _, client = setup
    with pytest.raises(ValueError, match="limits"):
        batch.run_turn(engine, root, "local", max_bills=11, client=client)
    manifest = json.loads((root / "inventory.json").read_text())
    manifest["bills"][0]["key"] = "94-2025-HF1"
    (root / "inventory.json").write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="digest"):
        batch.run_turn(engine, root, "local", client=client)


def test_expiring_lease_after_fetch_never_applies(setup):
    engine, root, ids, _ = setup

    def respond(req):
        with engine.begin() as c:
            c.execute(
                text(
                    "UPDATE source_refresh_state SET lease_expires_at=clock_timestamp()+interval '5 seconds' WHERE name=:name"
                ),
                {"name": batch.JOB.name},
            )
        return httpx.Response(200, text=COMMITTEE_BILL_XML)

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        answer = batch.run_turn(engine, root, "local", apply=True, client=client)
    assert answer["status"] == "deferred"
    with Session(engine) as db:
        assert db.get(m.BillAction, ids[1]).committee_id is None


def test_stream_rejects_redirect_and_oversized_body(setup):
    engine, _, _, _ = setup
    for response, error in [
        (httpx.Response(302, headers={"Location": URL}), httpx.HTTPStatusError),
        (httpx.Response(200, content=b"x" * (recovery.MAX_XML_BYTES + 1)), ValueError),
    ]:
        with httpx.Client(
            transport=httpx.MockTransport(lambda req: response)
        ) as client:
            with pytest.raises(error):
                batch.SourceClient(engine, client, time.monotonic() + 10)(URL)


def test_new_fills_outside_frozen_action_inventory_are_withheld(setup):
    engine, root, ids, client = setup
    value = json.loads((root / "inventory.json").read_text())
    value["bills"][0]["actions"] = [str(uuid.uuid4())]
    value["sha256"] = batch.digest({k: v for k, v in value.items() if k != "sha256"})
    (root / "inventory.json").write_text(json.dumps(value))
    answer = batch.run_turn(engine, root, "local", apply=True, client=client)
    assert answer["status"] == "review_required"
    with Session(engine) as db:
        assert db.get(m.BillAction, ids[1]).committee_id is None
    assert not list(root.glob("*/attempt-*/receipt.json"))


def test_deferred_turn_retains_finite_inventory_and_yields_normal_jobs(setup):
    engine, root, ids, client = setup
    value = json.loads((root / "inventory.json").read_text())
    second = {
        "id": str(uuid.uuid4()),
        "key": "94-2025-HF6667",
        "actions": [str(uuid.uuid4())],
    }
    value["bills"].append(second)
    value["sha256"] = batch.digest({k: v for k, v in value.items() if k != "sha256"})
    (root / "inventory.json").write_text(json.dumps(value))
    answer = batch.run_turn(
        engine, root, "local", apply=True, client=client, max_bills=1
    )
    assert answer["status"] == "continuing" and answer["cursor"] == 1
    assert (
        batch.run_turn(engine, root, "local", apply=True, client=client)["status"]
        == "deferred"
    )
    release_cooldown(engine)
    answer = batch.run_turn(
        engine, root, "local", apply=True, client=client, max_bills=1
    )
    assert answer["cursor"] == 2 and answer["status"] == "review_required"
    assert len(list(root.glob("*/attempt-*/receipt.json"))) == 1
    assert json.loads((root / "inventory.json").read_text()) == value


def test_retry_budget_does_not_block_following_inventory_forever(setup):
    engine, root, ids, client = setup
    folder = root / str(ids[0])
    for i in range(1, 4):
        path = folder / f"attempt-{i:04d}"
        path.mkdir(parents=True)
        batch.result(path, "deferred", reason="previous bounded network failure")
    answer = batch.run_turn(engine, root, "local", apply=True, client=client)
    assert answer["status"] == "review_required" and answer["cursor"] == 1
    assert answer["outcomes"] == {"retry_exhausted": 1}
    with Session(engine) as db:
        assert db.get(m.BillAction, ids[1]).committee_id is None


def test_limiter_deadline_also_bounds_database_lock_wait(setup):
    from concurrent.futures import ThreadPoolExecutor
    from sqlalchemy.exc import DBAPIError

    engine, _, _, _ = setup
    limiter = DatabaseRequestLimiter(engine)
    limiter.wait(URL)
    executor = ThreadPoolExecutor(max_workers=1)
    blocker = engine.connect()
    transaction = blocker.begin()
    try:
        blocker.execute(
            text(
                "SELECT * FROM source_request_limits WHERE host='revisor.mn.gov' FOR UPDATE"
            )
        )
        future = executor.submit(limiter.wait, URL, deadline=time.monotonic() + 0.15)
        with pytest.raises(DBAPIError, match="statement timeout"):
            future.result(timeout=2)
    finally:
        transaction.rollback()
        blocker.close()
        executor.shutdown(wait=True)


def test_turn_deadline_after_plan_withholds_apply(setup, monkeypatch):
    engine, root, ids, client = setup
    original = recovery.plan
    clock = time.monotonic()
    calls = 0
    monkeypatch.setattr(time, "monotonic", lambda: clock)

    def advance_after_plan(*args, **kwargs):
        nonlocal calls, clock
        saved = original(*args, **kwargs)
        calls += 1
        if calls == 2:
            clock += 100
        return saved

    monkeypatch.setattr(recovery, "plan", advance_after_plan)
    answer = batch.run_turn(engine, root, "local", apply=True, client=client)
    assert answer["status"] == "deferred" and answer["cursor"] == 0
    with Session(engine) as db:
        assert db.get(m.BillAction, ids[1]).committee_id is None
    assert not list(root.glob("*/attempt-*/receipt.json"))


def test_blocked_cooldown_write_obeys_deadline(setup):
    from concurrent.futures import ThreadPoolExecutor
    from sqlalchemy.exc import DBAPIError

    engine, _, _, _ = setup
    limiter = DatabaseRequestLimiter(engine)
    limiter.wait(URL)
    executor = ThreadPoolExecutor(max_workers=1)
    blocker = engine.connect()
    transaction = blocker.begin()
    try:
        blocker.execute(
            text(
                "SELECT * FROM source_request_limits WHERE host='revisor.mn.gov' FOR UPDATE"
            )
        )
        future = executor.submit(
            limiter.defer, URL, 900, deadline=time.monotonic() + 0.15
        )
        with pytest.raises(DBAPIError, match="statement timeout"):
            future.result(timeout=2)
    finally:
        transaction.rollback()
        blocker.close()
        executor.shutdown(wait=True)


def test_slow_no_fill_plan_cannot_complete_past_budget(setup, monkeypatch):
    engine, root, ids, _ = setup
    original = recovery.plan
    monkeypatch.setattr(batch, "APPLY_RESERVE", 59)

    def slow_plan(db, *args, **kwargs):
        recovery.execute(
            db, text("SELECT pg_sleep(2)"), deadline=kwargs.get("deadline")
        )
        return original(db, *args, **kwargs)

    monkeypatch.setattr(recovery, "plan", slow_plan)
    xml = COMMITTEE_BILL_XML.replace(
        "<COMMITTEE_ID>94012</COMMITTEE_ID>", "<COMMITTEE_ID/>"
    )
    with httpx.Client(
        transport=httpx.MockTransport(lambda req: httpx.Response(200, text=xml))
    ) as client:
        answer = batch.run_turn(
            engine, root, "local", apply=True, max_seconds=60, client=client
        )
    assert answer["status"] == "deferred" and answer["cursor"] == 0
    assert not list(root.glob("*/attempt-*/receipt.json"))


def test_remaining_lock_budget_aborts_slow_apply(setup, monkeypatch):
    engine, root, ids, client = setup
    original = recovery.apply
    monkeypatch.setattr(batch, "LOCK_BUDGET", 0.2)

    def slow_apply(db, *args, **kwargs):
        recovery.execute(
            db, text("SELECT pg_sleep(1)"), deadline=kwargs.get("deadline")
        )
        return original(db, *args, **kwargs)

    monkeypatch.setattr(recovery, "apply", slow_apply)
    answer = batch.run_turn(engine, root, "local", apply=True, client=client)
    assert answer["status"] == "deferred"
    with Session(engine) as db:
        assert db.get(m.BillAction, ids[1]).committee_id is None
    assert not list(root.glob("*/attempt-*/receipt.json"))


def test_lost_cleanup_owner_is_reported_after_saved_plan(setup, monkeypatch):
    engine, root, _, client = setup
    monkeypatch.setattr(refresh, "finish_job", lambda *args, **kwargs: False)
    with pytest.raises(batch.CleanupOwnershipLost, match="finish refused"):
        batch.run_turn(engine, root, "local", client=client)
    assert list(root.glob("*/attempt-*/plan.json"))
    assert json.loads((root / "progress.json").read_text())["plan"] == 1


def test_cleanup_database_wait_has_separate_bound(setup, monkeypatch):
    from sqlalchemy.exc import DBAPIError

    engine, root, _, client = setup
    monkeypatch.setattr(batch, "CLEANUP_BUDGET", 0.15)

    def slow_finish(db, *args, **kwargs):
        db.execute(text("SELECT pg_sleep(1)"))
        return True

    monkeypatch.setattr(refresh, "finish_job", slow_finish)
    with pytest.raises(DBAPIError, match="statement timeout"):
        batch.run_turn(engine, root, "local", client=client)
    assert json.loads((root / "progress.json").read_text())["plan"] == 1


def test_claim_reads_share_overall_deadline(setup, monkeypatch):
    from sqlalchemy.exc import DBAPIError

    engine, _, _, _ = setup

    def slow_due(db, now):
        db.execute(text("SELECT pg_sleep(1)"))
        return False

    monkeypatch.setattr(batch, "normal_work_due", slow_due)
    with batch.sql_deadline(engine, time.monotonic() + 0.15):
        with pytest.raises(DBAPIError, match="statement timeout"):
            batch.claim(engine)
    with Session(engine) as db:
        assert db.get(m.SourceRefreshState, batch.JOB.name) is None


def test_mixed_fills_keep_exact_unresolved_target_reason(setup):
    from xml.etree import ElementTree as ET

    engine, root, ids, _ = setup
    with Session(engine) as db:
        first = db.get(m.BillAction, ids[1])
        second = m.BillAction(
            bill_id=ids[0],
            chamber_id=first.chamber_id,
            action_number=3,
            action_text=first.action_text,
            action_at=first.action_at,
            committee_name=first.committee_name,
            source_artifact_id=first.source_artifact_id,
        )
        db.add(second)
        db.commit()
        second_id = str(second.id)
    xml = ET.fromstring(COMMITTEE_BILL_XML)
    chamber = xml.find("./ACTIONS/house")
    assert chamber is not None
    copy = ET.fromstring(ET.tostring(chamber.find("ACTION")))
    copy.find("ACTION_NUMBER").text = "3"
    copy.find("COMMITTEE_ID").text = "unknown-held-code"
    chamber.append(copy)
    body = ET.tostring(xml, encoding="unicode")
    manifest = json.loads((root / "inventory.json").read_text())
    manifest["bills"][0]["actions"].append(second_id)
    manifest["sha256"] = batch.digest(
        {k: v for k, v in manifest.items() if k != "sha256"}
    )
    (root / "inventory.json").write_text(json.dumps(manifest))
    with httpx.Client(
        transport=httpx.MockTransport(lambda req: httpx.Response(200, text=body))
    ) as client:
        answer = batch.run_turn(engine, root, "local", apply=True, client=client)
    assert answer["status"] == "review_required"
    saved = json.loads(next(root.glob("*/attempt-*/result.json")).read_text())
    assert saved["targets"] == {str(ids[1]): "applied", second_id: "unheld_code"}
    with Session(engine) as db:
        assert db.get(m.BillAction, ids[1]).committee_id == ids[2]
        assert db.get(m.BillAction, uuid.UUID(second_id)).committee_id is None


def test_changed_source_zero_fill_requires_review(setup):
    engine, root, ids, _ = setup
    with Session(engine) as db:
        action = db.get(m.BillAction, ids[1])
        action.action_text = "A later changed source text"
        db.commit()
    with httpx.Client(
        transport=httpx.MockTransport(
            lambda req: httpx.Response(200, text=COMMITTEE_BILL_XML)
        )
    ) as client:
        answer = batch.run_turn(engine, root, "local", apply=True, client=client)
    assert answer["status"] == "review_required"
    saved = json.loads(next(root.glob("*/attempt-*/result.json")).read_text())
    assert saved["targets"] == {str(ids[1]): "source_row_changed"}


def stalled_owned_worker(args):
    (args.evidence / "retained.txt").write_text("already prepared evidence")
    time.sleep(30)


def test_cli_supervisor_stops_only_owned_worker_retaining_files(tmp_path):
    from types import SimpleNamespace
    from scripts.run_committee_link_recovery import supervise

    args = SimpleNamespace(evidence=tmp_path, max_seconds=60)
    assert supervise(args, target=stalled_owned_worker, timeout=3) == 1
    assert (tmp_path / "retained.txt").read_text() == "already prepared evidence"


def test_receipt_stall_releases_server_locks_before_writer_returns(setup, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    from sqlalchemy.exc import DBAPIError

    engine, root, ids, _ = setup
    entered, resume = Event(), Event()
    original = recovery.write_evidence

    def stalled_receipt(path, evidence):
        if path.name == "receipt-idle.json":
            entered.set()
            assert resume.wait(3)
        return original(path, evidence)

    monkeypatch.setattr(recovery, "write_evidence", stalled_receipt)
    with Session(engine) as db:
        saved = recovery.plan(
            db,
            "94-2025-HF6666",
            COMMITTEE_BILL_XML,
            URL,
            source_generation=recovery.generation(db, "94-2025-HF6666"),
        )

    def apply():
        with Session(engine) as db, db.begin():
            recovery.apply(
                db,
                saved,
                COMMITTEE_BILL_XML,
                root / "receipt-idle.json",
                deadline=time.monotonic() + 0.4,
            )

    executor = ThreadPoolExecutor(max_workers=1)
    future = executor.submit(apply)
    try:
        assert entered.wait(2)
        # This incompatible write lock cannot be acquired while the stalled
        # helper still owns its transaction. Its server idle bound must release it.
        with engine.begin() as connection:
            connection.execute(text("SET LOCAL lock_timeout='1s'"))
            connection.execute(text("LOCK TABLE bill_action IN ROW EXCLUSIVE MODE"))
        assert not future.done()
    finally:
        resume.set()
        with pytest.raises((TimeoutError, DBAPIError)) as failure:
            future.result(timeout=3)
        if isinstance(failure.value, DBAPIError):
            assert failure.value.orig.sqlstate == "25P03"
        executor.shutdown(wait=True)
    with Session(engine) as db:
        assert db.get(m.BillAction, ids[1]).committee_id is None
    assert (root / "receipt-idle.json").exists()


def test_commit_timeout_refreshes_after_receipt_time(setup, monkeypatch):
    from sqlalchemy import event

    engine, _, ids, _ = setup
    clock = 100.0
    monkeypatch.setattr(time, "monotonic", lambda: clock)
    observed = []

    def inspect_commit(connection):
        with connection.connection.cursor() as cursor:
            cursor.execute("SHOW statement_timeout")
            observed.append(cursor.fetchone()[0])

    with batch.sql_deadline(engine, 110.0):
        event.listen(engine, "commit", inspect_commit)
        try:
            with Session(engine) as db, db.begin():
                row = db.get(m.BillAction, ids[1])
                row.committee_id = ids[2]
                db.flush()
                # Receipt persistence consumed7s since the last SQL statement.
                clock = 107.0
        finally:
            event.remove(engine, "commit", inspect_commit)
    assert observed == ["3s"]
    with Session(engine) as db:
        assert db.get(m.BillAction, ids[1]).committee_id == ids[2]


def test_listener_owns_one_timeout_and_keeps_tighter_helper_deadline(
    setup, monkeypatch
):
    engine, _, _, _ = setup
    clock = 100.0
    monkeypatch.setattr(time, "monotonic", lambda: clock)
    with batch.sql_deadline(engine, 110.0), Session(engine) as db:
        calls = []
        original = db.execute

        def tracked(statement, *args, **kwargs):
            calls.append(str(statement))
            return original(statement, *args, **kwargs)

        monkeypatch.setattr(db, "execute", tracked)
        timeout = recovery.execute(
            db, text("SELECT current_setting('statement_timeout')"), deadline=103.0
        ).scalar()
    assert timeout == "3s"
    assert len(calls) == 1  # The engine listener, not a second helper setter, owns it.
    with Session(engine) as db:
        assert (
            recovery.execute(
                db, text("SELECT current_setting('statement_timeout')"), deadline=102.0
            ).scalar()
            == "2s"
        )  # Standalone helper remains bounded after context exit.


def test_partial_lock_budget_yields_before_next_attempt(setup, monkeypatch):
    engine, root, _, client = setup
    manifest = json.loads((root / "inventory.json").read_text())
    manifest["bills"].append(
        {"id": str(uuid.uuid4()), "key": "94-2025-HF9999", "actions": []}
    )
    manifest["sha256"] = batch.digest(
        {k: v for k, v in manifest.items() if k != "sha256"}
    )
    (root / "inventory.json").write_text(json.dumps(manifest))
    calls = []

    def apply(*args, **kwargs):
        calls.append(args[2]["key"])
        return {"status": "applied", "lock_seconds": 2.8, "filled": 1}

    monkeypatch.setattr(batch, "process_bill", apply)
    answer = batch.run_turn(engine, root, "local", apply=True, client=client)
    assert answer["status"] == "continuing"
    assert answer["cursor"] == 1
    assert calls == ["94-2025-HF6666"]
    assert (
        answer["yield_reason"] == "remaining lock budget below observed apply duration"
    )
    assert not list(root.glob("*/attempt-*"))


def test_attempt_timings_persist_source_and_database_stages(setup, monkeypatch):
    engine, root, _, client = setup
    answer = batch.run_turn(engine, root, "local", apply=True, client=client)
    assert answer["status"] == "pass_finished"
    saved = json.loads(next(root.glob("*/attempt-*/timings.json")).read_text())
    stages = saved["seconds"]
    assert set(stages) >= {
        "source_wait",
        "source_fetch",
        "lease_check",
        "capture",
        "plan",
        "apply",
        "readback",
        "total",
    }
    assert all(value >= 0 for value in stages.values())
    assert stages["capture"] >= stages["source_wait"] + stages["source_fetch"]
    assert (
        stages["total"]
        >= stages["capture"] + stages["plan"] + stages["apply"] + stages["readback"]
    )


def test_partial_allowance_timeout_does_not_spend_source_attempt(setup, monkeypatch):
    engine, root, ids, client = setup
    held = batch.claim(engine)
    entry = json.loads((root / "inventory.json").read_text())["bills"][0]
    folder = root / entry["id"]
    original = recovery.apply

    def slow(db, *args, **kwargs):
        recovery.execute(db, text("SELECT pg_sleep(0.3)"), deadline=kwargs["deadline"])
        return original(db, *args, **kwargs)

    monkeypatch.setattr(recovery, "apply", slow)
    fetcher = batch.SourceClient(engine, client, time.monotonic() + 60)
    for _ in range(batch.MAX_ATTEMPTS + 1):
        with pytest.raises(batch.Deferred, match="remaining apply lock budget"):
            batch.process_bill(
                engine,
                held,
                entry,
                folder,
                fetcher,
                time.monotonic() + 90,
                apply=True,
                lock_budget=0.08,
            )
    results = [json.loads(p.read_text()) for p in folder.glob("*/result.json")]
    assert len(results) == batch.MAX_ATTEMPTS + 1
    assert {r["status"] for r in results} == {"budget_yield"}
    assert not list(folder.glob("*/receipt.json"))
    for p in folder.glob("*/timings.json"):
        value = json.loads(p.read_text())
        assert value["apply_budget_exhausted"] is True
        assert value["seconds"]["apply"] >= 0.05
    with Session(engine) as db:
        assert db.get(m.BillAction, ids[1]).committee_id is None
        refresh.finish_job(db, held, code=76)


def test_partial_budget_prepared_receipt_is_reconciled_before_retry(setup, monkeypatch):
    engine, root, ids, client = setup
    held = batch.claim(engine)
    entry = json.loads((root / "inventory.json").read_text())["bills"][0]
    folder = root / entry["id"]
    original = recovery.apply

    def expired_after_receipt(*args, **kwargs):
        original(*args, **kwargs)
        raise TimeoutError(
            "recovery lock deadline exceeded; transaction must roll back"
        )

    monkeypatch.setattr(recovery, "apply", expired_after_receipt)
    fetcher = batch.SourceClient(engine, client, time.monotonic() + 60)
    with pytest.raises(batch.Deferred, match="remaining apply lock budget"):
        batch.process_bill(
            engine,
            held,
            entry,
            folder,
            fetcher,
            time.monotonic() + 90,
            apply=True,
            lock_budget=2,
        )
    assert list(folder.glob("*/receipt.json"))
    assert not list(folder.glob("*/result.json"))
    batch.pending_attempt(engine, folder, entry)
    saved = json.loads(next(folder.glob("*/result.json")).read_text())
    assert saved["status"] == "budget_yield"
    with Session(engine) as db:
        assert db.get(m.BillAction, ids[1]).committee_id is None
        refresh.finish_job(db, held, code=76)


def test_helper_timeout_owner_never_leaks_to_other_engine(setup, monkeypatch):
    from sqlalchemy import create_engine

    engine, _, _, _ = setup
    other = create_engine(engine.url)
    monkeypatch.setattr(time, "monotonic", lambda: 100.0)
    try:
        with batch.sql_deadline(engine, 110.0), Session(other) as db:
            assert (
                recovery.execute(
                    db,
                    text("SELECT current_setting('statement_timeout')"),
                    deadline=102.0,
                ).scalar()
                == "2s"
            )
    finally:
        other.dispose()


@pytest.mark.parametrize("cooldown", [False, True])
def test_source_database_wait_keeps_shorter_bound_under_turn_listener(
    setup, monkeypatch, cooldown
):
    from concurrent.futures import ThreadPoolExecutor
    from sqlalchemy.exc import DBAPIError

    engine, _, _, _ = setup
    DatabaseRequestLimiter(engine).wait(URL)
    client = httpx.Client(
        transport=httpx.MockTransport(
            lambda req: httpx.Response(
                429 if cooldown else 200, text=COMMITTEE_BILL_XML
            )
        )
    )
    executor = ThreadPoolExecutor(max_workers=1)
    blocker = engine.connect()
    transaction = blocker.begin()

    def request():
        with batch.sql_deadline(engine, time.monotonic() + 10):
            fetcher = batch.SourceClient(engine, client, time.monotonic() + 0.15)
            if cooldown:
                # Reach cooldown persistence without waiting at reservation first.
                monkeypatch.setattr(
                    fetcher.limiter, "wait", lambda *args, **kwargs: None
                )
            return fetcher(URL)

    try:
        blocker.execute(
            text(
                "SELECT * FROM source_request_limits WHERE host='revisor.mn.gov' FOR UPDATE"
            )
        )
        future = executor.submit(request)
        with pytest.raises(DBAPIError, match="statement timeout"):
            future.result(timeout=1)
    finally:
        transaction.rollback()
        blocker.close()
        executor.shutdown(wait=True)
        client.close()
