"""Personal forms must not become accounts, zeroes or private review records."""

from copy import deepcopy
import json
from types import SimpleNamespace

from fastapi import HTTPException
import pytest

from alethical.api.services import election_board_candidate_reads as reads
from alethical.api.services import election_finance_reads as finance
from alethical.pipeline import election_source_readings as reading
from alethical.tests.test_election_board_candidate_records import world, load
from alethical.tests.test_election_source_provenance import (
    engine as provenance_engine,
    session,
)

# Reuse the normal disposable-database fixture in this module.
engine = provenance_engine


def collection(w):
    return SimpleNamespace(
        id="c" * 64,
        election_key=w["section"]["election_key"],
        candidate_records=w["section"],
        sources=[
            {"sha256": h, "url": "https://cfb.mn.gov/", "private_note": "must-not-leak"}
            for h in sorted(w["hashes"])
        ],
    )


def answer(w):
    return {
        "collection_id": "c" * 64,
        "snapshot_id": w["section"]["snapshot_id"],
        "version": "d" * 16,
        "candidates": [
            {
                "race_id": w["relation"]["race_id"],
                "candidate_id": w["relation"]["candidate_id"],
                "name": "Raymond David Petersen",
                "filed_party": "R",
                "party_group": "R",
                "office": "State Senator",
                "district": "56",
                "party_sources": [],
                "confirmed_account_count": 0,
                "accounts": [],
            }
        ],
        "account_reports": [],
        "summary": {"source_report_totals": {"total": "100.00"}},
        "coverage": {"selected_account_reports": 0},
    }


def test_projection_keeps_values_and_blanks_but_drops_private_receipts(engine):
    w = world(engine, "api-projection")
    with session(engine) as db:
        proof = load(db, w)
        bulk = reads.project(proof, collection(w))
    serialized = json.dumps(bulk)
    for private in (
        "acquisition_receipt_id",
        "reading_receipt_id",
        "source_context",
        "reviewed_by",
        "must-not-leak",
    ):
        assert private not in serialized
    report = bulk["records"][0]["reports"][0]
    assert report["measures"]["total"]["normalized"] == "1512.52"
    assert report["measures"]["unpaid"]["normalized"] is None
    assert report["measures"]["unpaid"]["state"] == "blank"
    assert report["items"][1]["fields"]["payee"]["normalized"] is None
    assert report["source_url"].endswith("?collection_id=" + "c" * 64)
    assert "/raw?" not in report["source_url"]


def test_personal_report_adds_no_principal_account_or_pcc_amount(engine):
    w = world(engine, "api-separate-measure")
    with session(engine) as db:
        bulk = reads.project(load(db, w), collection(w))
    data = answer(w)
    before = deepcopy(data)
    reads.join(data, bulk)
    assert data["summary"] == before["summary"]
    assert data["coverage"] == before["coverage"]
    assert data["account_reports"] == []
    assert data["candidates"][0]["confirmed_account_count"] == 0
    assert data["candidates"][0]["accounts"] == []
    assert len(data["personal_reports"]) == 1
    assert (
        data["personal_reports"][0]["claim"]["candidate_id"]
        == w["relation"]["candidate_id"]
    )
    assert data["version"] != before["version"]


def test_source_only_record_does_not_become_zero_or_report(engine):
    w = world(engine, "api-source-only")
    with session(engine) as db:
        bulk = reads.project(load(db, w), collection(w))
    record = bulk["records"][0]
    record.update(reports=[], selected_report_key=None)
    record["availability"] = {
        "state": "no_report_information_returned",
        "offered_reports": 0,
    }
    bulk["report_keys"] = []
    data = reads.join(answer(w), bulk)
    assert data["personal_reports"] == []
    assert (
        data["board_candidate_records"][0]["availability"]["state"]
        == "no_report_information_returned"
    )
    assert data["board_candidate_coverage"]["selected_reports"] == 0
    assert "public_subsidy" not in json.dumps(data["board_candidate_records"])


def test_selected_only_and_wrong_candidate_cannot_choose_personal_report(engine):
    w = world(engine, "api-selection")
    with session(engine) as db:
        bulk = reads.project(load(db, w), collection(w))
    key = bulk["report_keys"][0]
    assert reads.join(answer(w), bulk, selected_only=True)["personal_reports"] == []
    chosen = reads.join(answer(w), bulk, report_keys=[key], selected_only=True)
    assert len(chosen["personal_reports"]) == 1
    other = answer(w)
    other["candidates"][0]["candidate_id"] = "another"
    with pytest.raises(HTTPException) as failure:
        reads.join(other, bulk, report_keys=[key])
    assert failure.value.status_code == 422


def test_withdrawn_cover_removes_amount_and_changes_public_version(engine):
    w = world(engine, "api-withdrawal")
    with session(engine) as db:
        before = reads.project(load(db, w), collection(w))
    with session(engine) as db:
        reading.record_reading(
            db,
            w["store"],
            receipt=w["reading"],
            decision="withdrawn",
            reviewed_by="synthetic",
            reason="Withdraw test reading",
            expected_previous_id=w["reading_row"],
        )
    with session(engine) as db:
        after = reads.project(load(db, w, partial=True), collection(w))
    assert after["version"] != before["version"]
    assert after["records"][0]["reports"] == []
    data = reads.join(answer(w), after)
    assert data["personal_reports"] == []
    assert data["board_candidate_coverage"]["unavailable_records"] == 1


def test_legacy_report_has_no_new_fields_or_version():
    data = {"version": "old", "summary": {"total": "12.34"}}
    expected = deepcopy(data)
    assert reads.join(data, None) == expected


def test_personal_original_uses_checked_membership_and_retained_bytes(
    engine, monkeypatch
):
    w = world(engine, "api-original")
    held = collection(w)
    pdf_hash = w["refs"]["pdf"]["source_sha256"]
    monkeypatch.setattr(finance, "_collection", lambda *args: held)
    monkeypatch.setattr(finance, "raw_file_store_from_env", lambda: w["store"])
    with session(engine, isolation="REPEATABLE READ") as db:
        body = finance.source_pdf(
            db,
            election_key=held.election_key,
            collection_id=held.id,
            document_hash=pdf_hash,
        )
        assert body == w["bodies"]["pdf"]
        assert body.startswith(b"%PDF-")
        with pytest.raises(HTTPException) as failure:
            finance.source_pdf(
                db,
                election_key=held.election_key,
                collection_id=held.id,
                document_hash=w["refs"]["information"]["source_sha256"],
            )
        assert failure.value.status_code == 404
    # A held source outside this collection cannot borrow an existing reading.
    held.sources = [s for s in held.sources if s["sha256"] != pdf_hash]
    with session(engine, isolation="REPEATABLE READ") as db:
        with pytest.raises(HTTPException) as failure:
            finance.source_pdf(
                db,
                election_key=held.election_key,
                collection_id=held.id,
                document_hash=pdf_hash,
            )
        assert failure.value.status_code == 404


def payment_answer(w):
    return answer(w) | {
        "filters": {"geography": None, "payee_query": ""},
        "payees": [],
        "payments": [],
        "excluded_payees": [],
    }


def test_personal_payees_exclude_only_supported_identity_and_keep_native_total(engine):
    w = world(engine, "api-payees")
    with session(engine) as db:
        bulk = reads.project(load(db, w), collection(w))
    data = reads.join(payment_answer(w), bulk)
    report = data["personal_reports"][0]
    assert report["measures"]["total"]["normalized"] == "1512.52"
    assert report["itemized_before_exclusions"] == "1130.91"
    named = next(p for p in data["payees"] if p["payee_id"])
    unnamed = next(p for p in data["payees"] if not p["payee_id"])
    assert named["geography"] == "out_of_state"
    assert named["payee"]["address"]["street"] is None
    assert unnamed["geography"] == "unknown"
    assert unnamed["excludable"] is False
    adjusted = reads.join(
        payment_answer(w), bulk, excluded_payee_ids=[named["payee_id"]]
    )
    report = adjusted["personal_reports"][0]
    assert report["itemized_after_exclusions"] == "933.73"
    assert report["measures"]["total"]["normalized"] == "1512.52"
    assert report["by_filed_address"]["out_of_state"]["after"] == "0.00"
    assert report["by_filed_address"]["unknown"]["after"] == "933.73"
    assert len(adjusted["payments"]) == 1
    assert (
        adjusted["excluded_payees"][0]["account_reports"][0]["board_record_id"]
        == report["record_id"]
    )
    assert adjusted["version"] != data["version"]


def test_personal_missing_amount_stays_unknown_and_filters_do_not_change_report(engine):
    w = world(engine, "api-unknown-payment")
    with session(engine) as db:
        bulk = reads.project(load(db, w), collection(w))
    bulk["records"][0]["reports"][0]["items"][1]["fields"]["total"].update(
        state="ambiguous", normalized=None
    )
    data = reads.join(payment_answer(w), bulk)
    report = data["personal_reports"][0]
    assert report["itemized_before_exclusions"] is None
    assert report["itemized_unknown_amounts"] == 1
    assert report["by_filed_address"]["unknown"]["before"] is None
    filtered = payment_answer(w)
    filtered["filters"].update(geography="out_of_state", payee_query="VISTA")
    reads.join(filtered, bulk)
    assert len(filtered["payments"]) == 1
    assert filtered["personal_reports"] == data["personal_reports"]


def test_unreadable_payee_keeps_readable_filed_state_without_identity(engine):
    w = world(engine, "api-unclear-payee-state")
    with session(engine) as db:
        bulk = reads.project(load(db, w), collection(w))
    fields = bulk["records"][0]["reports"][0]["items"][0]["fields"]
    fields["payee"].update(state="ambiguous", normalized=None)
    bulk["records"][0]["reports"][0]["items"][1]["fields"]["purpose"].update(
        state="ambiguous", normalized=None
    )
    data = reads.join(payment_answer(w), bulk)
    payment = data["payments"][0]
    assert payment["payee_id"] is None
    assert payment["geography"] == "out_of_state"
    assert payment["payee"]["name"] is None
    assert payment["payee"]["address"]["state"] == "MA"
    assert payment["field_states"]["payee"] == "ambiguous"
    assert payment["payee"]["field_states"]["street"] == "redacted"
    assert (
        data["personal_reports"][0]["by_filed_address"]["out_of_state"]["before"]
        == "197.18"
    )
    assert all(not payee["excludable"] for payee in data["payees"])
    assert data["payees"][0]["geography"] == "unknown"
    assert data["payees"][0]["payee"]["address"]["state"] is None
    assert data["payees"][0]["purpose_unavailable_states"] == ["ambiguous"]
    assert "Printing of business cards" in data["payees"][0]["purposes"]


def test_personal_exclusion_rejects_out_of_scope_payee(engine):
    w = world(engine, "api-scope-exclusion")
    with session(engine) as db:
        bulk = reads.project(load(db, w), collection(w))
    identifier = next(iter(reads.payee_ids(bulk)))
    other = payment_answer(w)
    other["candidates"] = []
    with pytest.raises(HTTPException) as error:
        reads.join(other, bulk, excluded_payee_ids=[identifier])
    assert error.value.status_code == 422
