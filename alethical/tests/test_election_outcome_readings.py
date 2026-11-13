"""Checked image quotes remain scoped evidence, never inferred outcomes."""

# ruff: noqa: F401, F811
from copy import deepcopy
from io import BytesIO

import pytest
from PIL import Image, ImageDraw

from alethical.db import models as m
from alethical.pipeline import election_comparison as storage
from alethical.pipeline import election_outcomes as outcomes
from alethical.pipeline import election_source_readings as readings
from alethical.pipeline.election_source_files import SourceFileLimitError
from alethical.tests.test_election_outcomes import context
from alethical.tests.test_election_comparison_storage import db, prepared, source_set


def test_public_checked_locator_keeps_only_page_and_bounds():
    locator = {
        "page": 1,
        "reading_sha256": "a" * 64,
        "field_id": "outcome.elected",
        "bounds": [10, 20, 300, 50],
    }
    public = outcomes.public_evidence(
        {
            "locator": locator,
            "context": {
                "bindings": [
                    {
                        "field": "office",
                        "value": "Office",
                        "literal": "Office",
                        "quote": "Office",
                        "locator": locator,
                        "reason": "Private review",
                    }
                ]
            },
        }
    )
    assert public["locator"] == {"page": 1, "bounds": [10, 20, 300, 50]}
    assert public["context"]["bindings"][0]["locator"] == public["locator"]
    assert "reading_sha256" not in str(public)
    assert "field_id" not in str(public)
    assert "Private" not in str(public)


@pytest.fixture
def scanned(db, context, monkeypatch):
    snapshot, race, candidate, store, native_request, _ = context
    lines = {
        "office": race.label,
        "date": "2026-11-03",
        "jurisdiction": race.jurisdiction,
        "candidate": candidate["name"],
        "status": "Final canvass certified",
        "elected": candidate["name"] + " elected",
    }
    image = Image.new("RGB", (800, 600), "white")
    draw = ImageDraw.Draw(image)
    fields = []
    for index, (key, literal) in enumerate(lines.items()):
        y = 40 + index * 35
        draw.text((20, y), literal, fill="black")
        fields.append(
            readings.field_proposal(
                "outcome." + key,
                page=1,
                bounds=[15, y - 2, 780, y + 25],
                label=key,
                literal=literal,
                value_type="text",
                record_type="certification",
            )
        )
    stream = BytesIO()
    image.save(stream, format="PDF", resolution=72.0)
    body = stream.getvalue()
    assert outcomes._quoted_text(body, "application/pdf", {"page": 1}) == ""
    url = "https://www.sos.mn.gov/elections-voting/scanned-canvass"
    publisher = "https://www.sos.mn.gov/"
    publisher_body = ("Official <a href='" + url + "'>Canvass</a>").encode()
    monkeypatch.setattr(
        outcomes,
        "_download",
        lambda link, hosts: (
            body if link == url else publisher_body,
            link,
            "application/pdf" if link == url else "text/html",
        ),
    )
    capture = outcomes.capture_source(
        db,
        url=url,
        publisher_url=publisher,
        publisher_hosts=["www.sos.mn.gov"],
        authority="Synthetic canvassing board",
        store=store,
    )
    receipt = readings.prepare_receipt(
        body,
        fields=fields,
        document_kind="certification",
        reading_scope={
            "cover": {"page": 1, "bounds": [10, 30, 790, 280]},
            "regions": [{"page": 1, "bounds": [10, 30, 790, 280], "role": "cover"}],
        },
    )
    receipt["document_kind"] = "outcome_certification"
    request = deepcopy(native_request)
    fieldmap = {f["field_id"].split(".")[-1]: f for f in fields}

    def bind_request(value):
        rid = storage.digest(value)

        def locator(key):
            return {
                "page": 1,
                "reading_sha256": rid,
                "field_id": "outcome." + key,
                "bounds": list(fieldmap[key]["bounds"]),
            }

        result = deepcopy(request)
        for item in result["evidence"]:
            item.update(outcomes.capture_metadata(capture))
            key = "elected" if item["kind"] == "candidate_outcome" else "status"
            item.update(quote=lines[key], locator=locator(key))
            for binding in item["context"]["bindings"]:
                key = {
                    "office": "office",
                    "election_date": "date",
                    "jurisdiction": "jurisdiction",
                    "candidate_name": "candidate",
                }[binding["field"]]
                binding.update(
                    quote=lines[key], literal=lines[key], locator=locator(key)
                )
        return result

    return store, receipt, bind_request, context


def checked(db, scanned, *, receipt=None):
    store, original, bind, _ = scanned
    receipt = deepcopy(receipt or original)
    row = readings.record_reading(
        db,
        store,
        receipt=receipt,
        decision="checked",
        reviewed_by="Private synthetic reviewer",
        reason="Synthetic visible image fields checked",
        expected_previous_id=None,
    )
    return row, bind(receipt)


def test_scanned_outcome_needs_checked_purpose_and_never_rerenders(
    db, scanned, monkeypatch
):
    store, receipt, bind, _ = scanned
    readings.validate_receipt(receipt)
    with pytest.raises(storage.ComparisonImportError):
        outcomes.record_decision(db, **bind(receipt))
    _, request = checked(db, scanned)
    decision = outcomes.record_decision(db, **request)
    monkeypatch.setattr(
        readings, "render_page", lambda *a: pytest.fail("ordinary render")
    )
    result = outcomes.applicable_outcomes(
        db, snapshot_id=request["snapshot_id"], store=store
    )[request["race_id"]]
    assert result["outcome_review"]["state"] == "checked"
    assert result["outcome_review"]["decision_id"] == decision.id
    selected = request["candidate_outcomes"][0]["candidate_id"]
    assert result["candidates"][selected]["outcome"] == "elected"
    assert all(
        c["outcome"] is None
        for key, c in result["candidates"].items()
        if key != selected
    )
    assert "reading_sha256" not in str(result)


def test_financial_certification_cannot_supply_outcome_quote(db, scanned):
    _, receipt, _, _ = scanned
    receipt = deepcopy(receipt)
    receipt["document_kind"] = "certification"
    _, request = checked(db, scanned, receipt=receipt)
    with pytest.raises(storage.ComparisonImportError, match="purpose"):
        outcomes.record_decision(db, **request)


@pytest.mark.parametrize(
    "change", ["bounds", "field", "page", "quote", "extra", "binding"]
)
def test_checked_quote_rejects_changed_locator_or_quote(db, scanned, change):
    _, request = checked(db, scanned)
    item = request["evidence"][0]
    if change == "bounds":
        item["locator"]["bounds"][0] += 1
    elif change == "field":
        item["locator"]["field_id"] = "outcome.missing"
    elif change == "page":
        item["locator"]["page"] = 2
    elif change == "quote":
        item["quote"] = "invented certification"
    elif change == "extra":
        item["locator"]["private_note"] = "Must not echo"
    else:
        item["context"]["bindings"][0]["locator"]["bounds"][0] += 1
    with pytest.raises(storage.ComparisonImportError):
        outcomes.record_decision(db, **request)


def test_current_reading_withdrawal_and_source_loss_recovery_version(
    db, scanned, monkeypatch
):
    store, receipt, _, _ = scanned
    row, request = checked(db, scanned)
    outcomes.record_decision(db, **request)
    monkeypatch.setattr(
        readings, "render_page", lambda *a: pytest.fail("ordinary render")
    )

    def read():
        return outcomes.applicable_outcomes(
            db, snapshot_id=request["snapshot_id"], store=store
        )[request["race_id"]]

    good = read()
    source = db.get(m.ElectionResultSource, receipt["original_sha256"])
    body = store.objects.pop(source.object_key)
    lost = read()
    assert lost["outcome_review"]["state"] == "sources_unavailable"
    assert lost["outcome_review"]["version"] != good["outcome_review"]["version"]
    store.objects[source.object_key] = body
    assert read()["outcome_review"]["version"] == good["outcome_review"]["version"]
    readings.record_reading(
        db,
        store,
        receipt=receipt,
        decision="withdrawn",
        reviewed_by="Private synthetic reviewer",
        reason="Withdraw reading",
        expected_previous_id=row.id,
    )
    withdrawn = read()
    assert withdrawn["outcome_review"]["state"] == "sources_unavailable"
    assert withdrawn["outcome_review"]["version"] != good["outcome_review"]["version"]


def test_historical_reading_change_versions_healthy_native_replacement(
    db, scanned, monkeypatch
):
    store, receipt, _, native = scanned
    reading, request = checked(db, scanned)
    first = outcomes.record_decision(db, **request)
    replacement = deepcopy(native[4])
    replacement["expected_previous_id"] = first.id
    replacement["reason"] = "Native replacement"
    outcomes.record_decision(db, **replacement)
    monkeypatch.setattr(
        readings, "render_page", lambda *a: pytest.fail("ordinary render")
    )

    def read():
        return outcomes.applicable_outcomes(
            db, snapshot_id=request["snapshot_id"], store=store
        )[request["race_id"]]

    before = read()
    readings.record_reading(
        db,
        store,
        receipt=receipt,
        decision="withdrawn",
        reviewed_by="Private synthetic reviewer",
        reason="Old reading withdrawn",
        expected_previous_id=reading.id,
    )
    after = read()
    assert after["outcome_review"]["state"] == "checked"
    assert after["outcome_review"]["version"] != before["outcome_review"]["version"]


@pytest.mark.parametrize("boundary", ["source", "evidence"])
def test_capacity_is_not_recorded_as_source_loss(db, context, monkeypatch, boundary):
    outcomes.record_decision(db, **context[4])

    def capacity(*args, **kwargs):
        raise SourceFileLimitError("Synthetic retryable capacity")

    monkeypatch.setattr(
        outcomes,
        "read_source" if boundary == "source" else "_validate_evidence",
        capacity,
    )
    with pytest.raises(SourceFileLimitError):
        outcomes.applicable_outcomes(db, snapshot_id=context[0].id)


@pytest.mark.parametrize(
    "state", ["ambiguous", "blank", "unreadable", "redacted", "not_checked"]
)
def test_unresolved_checked_field_never_supplies_outcome(db, scanned, state):
    _, receipt, _, _ = scanned
    receipt = deepcopy(receipt)
    field = next(f for f in receipt["fields"] if f["field_id"] == "outcome.status")
    field["state"] = state
    if state != "ambiguous":
        field["literal"] = ""
    field["normalized"] = None
    receipt["pages"][0]["transcript"] = "\n".join(
        f"{f['field_id']} | {f['label']} | {f['literal']} | {f['state']}"
        for f in receipt["fields"]
    )
    _, request = checked(db, scanned, receipt=receipt)
    with pytest.raises(storage.ComparisonImportError, match="unresolved"):
        outcomes.record_decision(db, **request)


def test_outcome_kind_requires_section_and_no_financial_context(scanned):
    receipt = deepcopy(scanned[1])
    receipt["source_context"] = {}
    with pytest.raises(storage.ComparisonImportError, match="no financial context"):
        readings.validate_receipt(receipt)
    receipt = deepcopy(scanned[1])
    receipt["schema"] = readings.SCHEMA
    del receipt["reading_scope"]
    with pytest.raises(storage.ComparisonImportError, match="section scope"):
        readings.validate_receipt(receipt)


def test_other_original_cannot_borrow_checked_field(db, scanned):
    _, request = checked(db, scanned)
    native = scanned[3][4]["evidence"][0]
    for item in request["evidence"]:
        item.update({key: native[key] for key in outcomes.SOURCE_FIELDS})
    with pytest.raises(storage.ComparisonImportError):
        outcomes.record_decision(db, **request)


def test_no_review_does_not_resolve_store(db, context, monkeypatch):
    monkeypatch.setattr(
        outcomes, "raw_file_store_from_env", lambda: pytest.fail("unused store")
    )
    result = outcomes.applicable_outcomes(db, snapshot_id=context[0].id)
    assert all(r["outcome_review"]["state"] == "unreviewed" for r in result.values())


def test_scoped_history_does_not_change_unrelated_race_version(db, scanned):
    store, receipt, _, _ = scanned
    reading, request = checked(db, scanned)
    outcomes.record_decision(db, **request)
    race = scanned[3][1]
    other = storage.digest({"synthetic_unrelated_race": race.id})
    db.add(
        m.ElectionComparisonRace(
            snapshot_id=race.snapshot_id,
            id=other,
            label="Other synthetic race",
            office_id="other",
            jurisdiction="Other synthetic jurisdiction",
            result_status="unofficial",
            payload=deepcopy(race.payload),
        )
    )
    db.flush()
    before = outcomes.applicable_outcomes(
        db, snapshot_id=request["snapshot_id"], store=store
    )
    readings.record_reading(
        db,
        store,
        receipt=receipt,
        decision="withdrawn",
        reviewed_by="Private synthetic reviewer",
        reason="Withdraw reading",
        expected_previous_id=reading.id,
    )
    after = outcomes.applicable_outcomes(
        db, snapshot_id=request["snapshot_id"], store=store
    )
    assert (
        before[other]["outcome_review"]["version"]
        == after[other]["outcome_review"]["version"]
    )
    scoped = outcomes.applicable_outcomes(
        db, snapshot_id=request["snapshot_id"], race_ids=[other], store=store
    )
    assert scoped[other] == after[other]


def test_injected_request_store_reuses_bytes_but_new_request_checks_loss(
    db, scanned, monkeypatch
):
    from alethical.api.services.election_source_io import FreshReadStore

    store, receipt, _, _ = scanned
    _, request = checked(db, scanned)
    outcomes.record_decision(db, **request)
    calls = []
    original_get = store.get

    def counted(key, path, *, max_bytes=None):
        calls.append(key)
        return original_get(key, path, max_bytes=max_bytes)

    monkeypatch.setattr(store, "get", counted)
    view = outcomes.applicable_outcomes(
        db, snapshot_id=request["snapshot_id"], store=FreshReadStore(store)
    )
    assert view[request["race_id"]]["outcome_review"]["state"] == "checked"
    assert len(calls) == len(set(calls)) == 2
    source = db.get(m.ElectionResultSource, receipt["original_sha256"])
    store.objects.pop(source.object_key)
    lost = outcomes.applicable_outcomes(
        db, snapshot_id=request["snapshot_id"], store=FreshReadStore(store)
    )
    assert lost[request["race_id"]]["outcome_review"]["state"] == "sources_unavailable"


def test_record_locks_reading_heads_and_ordinary_read_batches_fresh_proof(
    db, scanned, monkeypatch
):
    store, _, _, _ = scanned
    _, request = checked(db, scanned)
    calls = []
    original = readings.load_verified_reading_context

    def observed(*args, **kwargs):
        calls.append((set(args[2]), kwargs.copy()))
        return original(*args, **kwargs)

    monkeypatch.setattr(readings, "load_verified_reading_context", observed)
    outcomes.record_decision(db, **request)
    assert len(calls) == 1
    assert calls[0][1]["lock"] is True
    assert calls[0][1]["partial"] is False
    outcomes.applicable_outcomes(db, snapshot_id=request["snapshot_id"], store=store)
    assert len(calls) == 2
    assert calls[1][1]["lock"] is False
    assert calls[1][1]["partial"] is True
    assert calls[0][0] == calls[1][0]
    assert calls[0][1]["allowed_source_hashes"] == {
        e[key] for e in request["evidence"] for key in ("sha256", "publisher_sha256")
    }

    def capacity(*args, **kwargs):
        raise SourceFileLimitError("Synthetic checked-proof capacity")

    monkeypatch.setattr(readings, "load_verified_reading_context", capacity)
    with pytest.raises(SourceFileLimitError):
        outcomes.applicable_outcomes(
            db, snapshot_id=request["snapshot_id"], store=store
        )
