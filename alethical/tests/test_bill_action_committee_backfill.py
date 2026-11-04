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
