"""Historical committee links require exact retained evidence and guarded undo."""
# ruff: noqa: F811

import pytest
from sqlalchemy import delete, select

from alethical.db import models as m
from alethical.pipeline import bill_action_committee_backfill as recovery
from alethical.pipeline.minnesota import (
    MinnesotaIngestionPipeline,
    parse_bill_xml,
    parse_datetime,
)
from alethical.tests.finance_fixtures import finance_db  # noqa: F401
from alethical.tests.test_minnesota_ingestion import COMMITTEE_BILL_XML

URL = "https://www.revisor.mn.gov/bills/status_result.php?session=0942025&body=House&type=xml&bill=HF6666"


@pytest.fixture()
def held(finance_db):
    db = finance_db
    bill = db.scalar(select(m.Bill))
    db.execute(delete(m.BillAction).where(m.BillAction.bill_id == bill.id))
    bill.bill_key = parse_bill_xml(COMMITTEE_BILL_XML)["bill_key"]
    house = db.scalar(select(m.Chamber).where(m.Chamber.slug == "house"))
    committee = m.Committee(
        session_id=bill.session_id,
        chamber_id=house.id,
        code="94012",
        name="Not matched by name",
    )
    db.add(committee)
    pipeline = MinnesotaIngestionPipeline(db)
    run = pipeline.start_run("bill", bill.bill_key)
    artifact = pipeline.record_artifact(
        run, m.ArtifactType.xml, URL, COMMITTEE_BILL_XML
    )
    source = parse_bill_xml(COMMITTEE_BILL_XML)["actions"]["house"][0]
    action = m.BillAction(
        bill_id=bill.id,
        chamber_id=house.id,
        action_number=1,
        action_text=source["action_text"],
        action_at=parse_datetime(source["action_date"]),
        committee_name=source["committee_name"],
        source_artifact_id=artifact.id,
    )
    db.add(action)
    db.commit()
    return bill, house, committee, action


def test_plan_rejects_other_bill_xml(finance_db, held):
    bill, house, _, _ = held
    fills, counts = recovery.plan_bill(
        finance_db,
        bill,
        COMMITTEE_BILL_XML.replace("<FILE_NUMBER>6666", "<FILE_NUMBER>6667"),
        {house.id: "house"},
    )
    assert fills == []
    assert counts["source_bill_mismatch"]


def prepared(db, held):
    return recovery.plan(db, held[0].bill_key, COMMITTEE_BILL_XML, URL)


def test_dry_run_apply_rollback_changes_only_committee(finance_db, held, tmp_path):
    import json

    db = finance_db
    saved = prepared(db, held)
    assert saved["counts"] == {"would_fill": 1}
    prior = recovery.before(held[3])
    assert prior["committee_id"] is None
    receipt = tmp_path / "applied.json"
    assert recovery.apply(db, saved, COMMITTEE_BILL_XML, receipt) == {"filled": 1}
    db.commit()
    db.expire_all()
    assert recovery.before(held[3]) == {**prior, "committee_id": str(held[2].id)}
    evidence = json.loads(receipt.read_text())
    assert evidence["plan"]["fills"][0]["before"] == prior
    assert recovery.rollback(db, evidence, tmp_path / "undone.json") == {"cleared": 1}
    db.commit()
    db.expire_all()
    assert recovery.before(held[3]) == prior
    assert recovery.rollback(db, evidence, tmp_path / "again.json") == {
        "changed_since_kept": 1
    }


@pytest.mark.parametrize(
    "field,value",
    [
        ("action_text", "Changed"),
        ("committee_name", "Changed name"),
        ("action_number", 9),
        ("source_artifact_id", None),
    ],
)
def test_changed_row_cannot_be_applied(finance_db, held, tmp_path, field, value):
    saved = prepared(finance_db, held)
    setattr(held[3], field, value)
    finance_db.commit()
    with pytest.raises(ValueError, match="no longer matches"):
        recovery.apply(finance_db, saved, COMMITTEE_BILL_XML, tmp_path / "apply.json")
    assert held[3].committee_id is None
    assert not (tmp_path / "apply.json").exists()


def test_changed_date_source_and_duplicate_committee_are_rejected(
    finance_db, held, tmp_path
):
    db = finance_db
    saved = prepared(db, held)
    changed = COMMITTEE_BILL_XML.replace("2025-01-10", "2025-01-11")
    assert recovery.plan(db, held[0].bill_key, changed, URL)["counts"] == {
        "source_row_changed": 1
    }
    with pytest.raises(ValueError, match="no longer matches"):
        recovery.apply(db, saved, changed, tmp_path / "different.xml.json")
    db.add(
        m.Committee(
            session_id=held[0].session_id,
            chamber_id=held[1].id,
            code="94012",
            name="Other committee",
        )
    )
    db.commit()
    assert prepared(db, held)["counts"] == {"ambiguous_code": 1}
    with pytest.raises(ValueError, match="no longer matches"):
        recovery.apply(db, saved, COMMITTEE_BILL_XML, tmp_path / "ambiguous.json")


def test_rollback_keeps_later_writer_even_if_same_committee(finance_db, held, tmp_path):
    import json
    from sqlalchemy import text

    db = finance_db
    saved = prepared(db, held)
    receipt = tmp_path / "receipt.json"
    recovery.apply(db, saved, COMMITTEE_BILL_XML, receipt)
    db.commit()
    # A later write that ends at the same value still owns the newer row.
    db.execute(
        text("UPDATE bill_action SET committee_id = committee_id WHERE id = :id"),
        {"id": held[3].id},
    )
    db.commit()
    assert recovery.rollback(
        db, json.loads(receipt.read_text()), tmp_path / "undo.json"
    ) == {"changed_since_kept": 1}
    db.expire_all()
    assert held[3].committee_id == held[2].id


def test_receipt_failure_requires_transaction_rollback(
    finance_db, held, tmp_path, monkeypatch
):
    db = finance_db
    saved = prepared(db, held)

    def fail(*args):
        raise OSError("disk full")

    monkeypatch.setattr(recovery, "write_evidence", fail)
    with pytest.raises(OSError, match="disk full"):
        with db.begin_nested():
            recovery.apply(db, saved, COMMITTEE_BILL_XML, tmp_path / "receipt.json")
    db.expire_all()
    assert held[3].committee_id is None


def test_missing_codes_names_other_chambers_do_not_infer(finance_db, held):
    db = finance_db
    for body, state in [
        (
            COMMITTEE_BILL_XML.replace("<COMMITTEE_ID>94012</COMMITTEE_ID>", ""),
            "missing_source_id",
        ),
        (
            COMMITTEE_BILL_XML.replace("<COMMITTEE_ID>94012", "<COMMITTEE_ID>094012"),
            "unheld_code",
        ),
        (
            COMMITTEE_BILL_XML.replace("<house>", "<senate>").replace(
                "</house>", "</senate>"
            ),
            "source_action_missing_or_ambiguous",
        ),
    ]:
        result = recovery.plan(db, held[0].bill_key, body, URL)
        assert result["counts"] == {state: 1}
        assert not result["fills"]
    assert held[3].committee_id is None


def test_existing_link_and_changed_source_address_are_kept(finance_db, held):
    db = finance_db
    held[3].committee_id = held[2].id
    db.commit()
    assert prepared(db, held)["counts"] == {"already_set": 1}
    artifact = db.get(m.SourceArtifact, held[3].source_artifact_id)
    artifact.source_url = URL + "&other=1"
    db.commit()
    assert prepared(db, held)["counts"] == {"source_address_changed": 1}


def test_capture_keeps_exact_bytes_and_digest_then_source_tamper_fails(
    finance_db, held, tmp_path
):
    import json
    from scripts import recover_bill_action_committee_links as command

    path = tmp_path / "source.json"
    calls = []

    def fetch(url):
        calls.append(url)
        return COMMITTEE_BILL_XML

    command.capture(finance_db, held[0].bill_key, path, fetch)
    assert calls == [URL]
    retained = command.source(path, held[0].bill_key)
    assert retained["xml"] == COMMITTEE_BILL_XML
    retained["xml"] += " "
    path.write_text(json.dumps(retained))
    with pytest.raises(ValueError, match="digest changed"):
        command.source(path, held[0].bill_key)
    assert held[3].committee_id is None


def test_capture_rejects_unheld_or_ambiguous_address_and_other_bill(
    finance_db, held, tmp_path
):
    from scripts import recover_bill_action_committee_links as command

    with pytest.raises(ValueError, match="one held"):
        command.capture(
            finance_db,
            "unheld-bill",
            tmp_path / "none.json",
            lambda _: COMMITTEE_BILL_XML,
        )
    with pytest.raises(ValueError, match="different bill"):
        command.capture(
            finance_db,
            held[0].bill_key,
            tmp_path / "wrong.json",
            lambda _: COMMITTEE_BILL_XML.replace(
                "<FILE_NUMBER>6666", "<FILE_NUMBER>6667"
            ),
        )
    artifact = finance_db.get(m.SourceArtifact, held[3].source_artifact_id)
    artifact.source_url = "https://example.test/private"
    finance_db.commit()
    with pytest.raises(ValueError, match="official"):
        command.capture(
            finance_db,
            held[0].bill_key,
            tmp_path / "host.json",
            lambda _: pytest.fail("must not fetch"),
        )
    assert list(tmp_path.iterdir()) == []


def test_changed_bill_scope_and_already_used_receipt_abort(finance_db, held, tmp_path):
    db = finance_db
    saved = prepared(db, held)
    path = tmp_path / "existing.json"
    path.write_text("preserved")
    with pytest.raises(FileExistsError):
        with db.begin_nested():
            recovery.apply(db, saved, COMMITTEE_BILL_XML, path)
    db.expire_all()
    assert held[3].committee_id is None
    assert path.read_text() == "preserved"
    held[0].title = "A later source edit"
    db.commit()
    with pytest.raises(ValueError, match="no longer matches"):
        recovery.apply(db, saved, COMMITTEE_BILL_XML, tmp_path / "new.json")


def test_duplicate_source_action_is_not_arbitrarily_chosen(finance_db, held):
    action = COMMITTEE_BILL_XML.split("<ACTION>", 1)[1].split("</ACTION>", 1)[0]
    body = COMMITTEE_BILL_XML.replace(
        "</house>", "<ACTION>" + action + "</ACTION></house>"
    )
    assert recovery.plan(finance_db, held[0].bill_key, body, URL)["counts"] == {
        "source_action_missing_or_ambiguous": 1
    }


def test_held_api_url_is_accepted_but_lookalikes_are_rejected(
    finance_db, held, tmp_path
):
    from scripts import recover_bill_action_committee_links as command

    api_url = "https://api.revisor.mn.gov/bills/v1/94/2025/0/HF/6666/"
    artifact = finance_db.get(m.SourceArtifact, held[3].source_artifact_id)
    artifact.source_url = api_url
    finance_db.commit()
    command.capture(
        finance_db,
        held[0].bill_key,
        tmp_path / "api.json",
        lambda url: (
            COMMITTEE_BILL_XML if url == api_url else pytest.fail("wrong address")
        ),
    )
    assert (
        command.source(tmp_path / "api.json", held[0].bill_key)["source_url"] == api_url
    )
    for address in [
        api_url.replace("api.revisor.mn.gov", "api.revisor.mn.gov.evil.test"),
        api_url.replace("/v1/", "/v2/"),
        api_url + "../",
        api_url.replace("https:", "http:"),
        "https://user@api.revisor.mn.gov/bills/v1/94/2025/0/HF/6666/",
    ]:
        with pytest.raises(ValueError, match="official"):
            recovery.official(address)


def test_duplicate_chamber_blocks_cannot_hide_conflicting_source_id(finance_db, held):
    duplicate = COMMITTEE_BILL_XML.split("<house>", 1)[1].split("</house>", 1)[0]
    body = COMMITTEE_BILL_XML.replace(
        "</ACTIONS>",
        "<HOUSE>" + duplicate.replace("94012", "other-code") + "</HOUSE></ACTIONS>",
    )
    with pytest.raises(ValueError, match="duplicate.*chamber"):
        recovery.plan(finance_db, held[0].bill_key, body, URL)


def test_unparseable_date_is_not_equal_to_unknown_stored_date(finance_db, held):
    held[3].action_at = None
    finance_db.commit()
    body = COMMITTEE_BILL_XML.replace("2025-01-10 00:00:00", "not a date")
    result = recovery.plan(finance_db, held[0].bill_key, body, URL)
    assert result["counts"] == {"source_row_changed": 1}
    assert not result["fills"]


def test_limits_reject_2001_actions_and_oversized_xml(finance_db, held):
    from sqlalchemy import insert

    db = finance_db
    with pytest.raises(ValueError, match="source size"):
        recovery.plan(db, held[0].bill_key, "x" * (recovery.MAX_XML_BYTES + 1), URL)
    db.execute(
        insert(m.BillAction),
        [
            {
                "bill_id": held[0].id,
                "chamber_id": held[1].id,
                "action_number": i,
                "action_text": "Held action",
            }
            for i in range(2, 2002)
        ],
    )
    db.commit()
    with pytest.raises(ValueError, match="action count"):
        prepared(db, held)


def test_capture_rejects_two_actual_held_source_addresses(finance_db, held, tmp_path):
    from scripts import recover_bill_action_committee_links as command

    db = finance_db
    original = db.get(m.SourceArtifact, held[3].source_artifact_id)
    artifact = m.SourceArtifact(
        run_id=original.run_id,
        adapter=original.adapter,
        artifact_type=m.ArtifactType.xml,
        source_url=URL + "&new=1",
        storage_path="held-metadata",
        content_hash="a" * 64,
    )
    db.add(artifact)
    db.flush()
    db.add(
        m.BillAction(
            bill_id=held[0].id,
            chamber_id=held[1].id,
            source_artifact_id=artifact.id,
            action_number=2,
            action_text="Other action",
        )
    )
    db.commit()
    with pytest.raises(ValueError, match="one held"):
        command.capture(
            db,
            held[0].bill_key,
            tmp_path / "two.json",
            lambda _: pytest.fail("must not fetch ambiguous address"),
        )


def test_deadline_after_receipt_rolls_back_and_prepared_receipt_cannot_undo(
    finance_db, held, tmp_path, monkeypatch
):
    import json

    db = finance_db
    saved = prepared(db, held)
    clock = [0.0]
    monkeypatch.setattr(recovery.time, "monotonic", lambda: clock[0])
    write = recovery.write_evidence

    def slow_receipt(path, value):
        write(path, value)
        clock[0] = recovery.LOCK_DEADLINE_SECONDS + 1

    monkeypatch.setattr(recovery, "write_evidence", slow_receipt)
    receipt = tmp_path / "prepared.json"
    with pytest.raises(TimeoutError, match="deadline"):
        with db.begin_nested():
            recovery.apply(db, saved, COMMITTEE_BILL_XML, receipt)
    assert receipt.exists()
    db.expire_all()
    assert held[3].committee_id is None
    monkeypatch.setattr(recovery, "write_evidence", write)
    assert recovery.rollback(
        db, json.loads(receipt.read_text()), tmp_path / "undo.json"
    ) == {"changed_since_kept": 1}


def test_plan_read_count_does_not_grow_with_distinct_artifacts_and_committees(
    finance_db, held
):
    from sqlalchemy import event

    db = finance_db
    bill, chamber, _, action = held
    bill_key, bill_id, session_id, chamber_id = (
        bill.bill_key,
        bill.id,
        bill.session_id,
        chamber.id,
    )
    original = db.get(m.SourceArtifact, action.source_artifact_id)
    run_id, adapter = original.run_id, original.adapter

    def reads(body):
        db.expire_all()
        statements = []
        connection = db.connection()

        def record(conn, cursor, statement, parameters, context, many):
            if statement.lstrip().startswith("SELECT"):
                statements.append(statement)

        event.listen(connection, "before_cursor_execute", record)
        try:
            result = recovery.plan(db, bill_key, body, URL)
        finally:
            event.remove(connection, "before_cursor_execute", record)
        return len(statements), result

    single, _ = reads(COMMITTEE_BILL_XML)
    source_action = COMMITTEE_BILL_XML.split("<ACTION>", 1)[1].split("</ACTION>", 1)[0]
    actions = ["<ACTION>" + source_action + "</ACTION>"]
    for i in range(2, 22):
        code = "bounded-" + str(i)
        db.add(
            m.Committee(
                session_id=session_id,
                chamber_id=chamber_id,
                code=code,
                name="Held " + str(i),
            )
        )
        artifact = m.SourceArtifact(
            run_id=run_id,
            adapter=adapter,
            artifact_type=m.ArtifactType.xml,
            source_url=URL,
            storage_path="held-metadata",
            content_hash=f"{i:064x}",
        )
        db.add(artifact)
        db.flush()
        db.add(
            m.BillAction(
                bill_id=bill_id,
                chamber_id=chamber_id,
                action_number=i,
                action_text=action.action_text,
                action_at=action.action_at,
                committee_name=action.committee_name,
                source_artifact_id=artifact.id,
            )
        )
        actions.append(
            "<ACTION>"
            + source_action.replace("<ACTION_NUMBER>1", f"<ACTION_NUMBER>{i}").replace(
                "94012", code
            )
            + "</ACTION>"
        )
    db.commit()
    body = (
        COMMITTEE_BILL_XML.split("<ACTIONS>", 1)[0]
        + "<ACTIONS><house>"
        + "".join(actions)
        + "</house></ACTIONS></BILL>"
    )
    multiple, result = reads(body)
    assert result["counts"] == {"would_fill": 21}
    assert multiple == single <= 8


def test_capture_refuses_redirects(monkeypatch):
    import httpx
    from contextlib import contextmanager
    from scripts import recover_bill_action_committee_links as command

    @contextmanager
    def stream(method, url, **kwargs):
        assert kwargs["follow_redirects"] is False
        yield httpx.Response(
            302,
            request=httpx.Request(method, url),
            headers={"location": "https://example.test/"},
        )

    monkeypatch.setattr(command.httpx, "stream", stream)
    with pytest.raises(httpx.HTTPStatusError):
        command.fetch(URL)
