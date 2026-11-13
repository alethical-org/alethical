"""Exact checked address literals are separate from unchanged payment facts."""

# ruff: noqa: F811,F401
from copy import deepcopy
import json

import pytest

from alethical.api.services import election_expense_analytics as expenses
from alethical.pipeline import election_local_sources as local
from alethical.pipeline import election_source_readings as readings
from alethical.pipeline.election_comparison import ComparisonImportError, archive_source
from alethical.tests.test_election_comparison_storage import MemoryStore
from alethical.tests.test_election_local_reading_integration import db, isolated_engine
from alethical.tests import test_election_local_reading_integration as integration
from alethical.pipeline import election_external_finance as storage
from alethical.pipeline.election_comparison import digest
from alethical.db import models as m
from fastapi import HTTPException
import csv
import io
from sqlalchemy.orm import Session
from alethical.tests import test_election_local_sources as fixtures

LITERAL = "1445 Valleyhigh Drive NW\nRochester MN 55901"


def address_packet(monkeypatch, **options):
    original = fixtures.native_pdf

    def with_address(changes):
        return original(
            {
                **changes,
                "payee": (40, 535, 10, "Row 1 payee: Postal Vendor"),
                "address1": (40, 555, 10, "1445 Valleyhigh Drive NW"),
                "address2": (40, 570, 10, "Rochester MN 55901"),
            }
        )

    monkeypatch.setattr(fixtures, "native_pdf", with_address)
    body, bodies, receipt, source = fixtures.packet(**options)
    fields = deepcopy(receipt["fields"])
    for name, literal, kind, bounds in [
        ("date", "9/4/26", "date", [40, 447, 100, 463]),
        ("amount", "$536.46", "money", [480, 447, 580, 463]),
        ("purpose", "Campaign Signs", "text", [120, 447, 400, 463]),
        ("payee", "Postal Vendor", "text", [100, 523, 280, 539]),
        ("payee_address", LITERAL, "text", [35, 542, 300, 574]),
    ]:
        fields.append(
            readings.field_proposal(
                f"payments.1.{name}",
                page=1,
                row=1,
                record_type="disbursement",
                bounds=bounds,
                label=name,
                literal=literal,
                value_type=kind,
                currency="USD" if kind == "money" else None,
            )
        )
    receipt = readings.prepare_receipt(
        body,
        fields=fields,
        document_kind="financial_report",
        source_context=receipt["source_context"],
    )
    return body, bodies, receipt, source


@pytest.fixture
def checked_address(db, monkeypatch):
    body, bodies, receipt, source = address_packet(monkeypatch)
    store = MemoryStore()
    for value in bodies.values():
        archive_source(db, store, value)
    row = readings.record_reading(
        db,
        store,
        receipt=receipt,
        decision="checked",
        reviewed_by="private",
        reason="Synthetic visible address checked",
        expected_previous_id=None,
    )
    proof = readings.load_verified_reading_context(
        db, store, [row.receipt_sha256], allowed_source_hashes=set(bodies)
    )
    return body, source, row, proof, receipt, store, bodies


def test_normal_checked_address_is_separate_from_payment(checked_address):
    body, source, row, proof, *_ = checked_address
    locator = dict(kind="payment", receipt_sha256=row.receipt_sha256, page=1, row=1)
    payment = local.extract_local_reading(body, source, locator, context=proof)
    address = local.extract_local_reading(
        body, source, {**locator, "kind": "payment_address"}, context=proof
    )
    assert "payee_address" not in payment.facts
    assert address.facts == {
        **{
            k: payment.facts[k]
            for k in ("authority", "account_id", "source_report_id", "source_row_id")
        },
        "payee_address": dict(
            street_1=None,
            street_2=None,
            city=None,
            state="MN",
            postal_code="55901",
            as_filed=LITERAL,
        ),
    }
    assert json.loads(address.quote) == {
        "payee_address": {"literal": LITERAL, "state": "value"}
    }
    _, identity = expenses._external_identity(
        {**payment.facts, **address.facts, "payment_key": "row1"}
    )
    public = expenses._identity(identity)
    assert public["address"]["as_filed"] == LITERAL
    assert public["address"]["lines"] == [LITERAL]
    assert expenses._csv_address(public)["Filed address"] == LITERAL
    assert (
        expenses._csv_address(public)["Filed address status"]
        == "Address shown as filed"
    )
    assert expenses._csv_address(public)["Filed street"] is None


@pytest.mark.parametrize(
    "literal,state,postal",
    [
        (LITERAL, "MN", "55901"),
        ("Boston MA 02196", "MA", "02196"),
        ("Fairfax VA 22003-0123\r\n", "VA", "22003-0123"),
        ("DC 20001", "DC", "20001"),
        ("PR 00901", "PR", "00901"),
        ("MN 55901; MA 02196", None, None),
        ("mn 55901", None, None),
        ("Minnesota 55901", None, None),
        ("MN 559012", None, None),
        ("MN 5590", None, None),
        ("MN 55901 USA", None, None),
        ("MN", None, None),
    ],
)
def test_literal_geography_is_narrow(literal, state, postal):
    address = local._local_payee_address(
        {
            "payee_address": dict(
                literal=literal, normalized=literal, state="value", value_type="text"
            )
        }
    )
    assert address == dict(
        street_1=None,
        street_2=None,
        city=None,
        state=state,
        postal_code=postal,
        as_filed=literal,
    )


@pytest.mark.parametrize("state", ["blank", "ambiguous", "unreadable", "redacted"])
def test_checked_nonvalue_address_does_not_invent_values(state):
    field = dict(literal="", normalized=None, state=state, value_type="text")
    assert not any(local._local_payee_address({"payee_address": field}).values())


@pytest.mark.parametrize("which", ["payee_address", "payee_street"])
def test_not_checked_address_observation_is_refused(which):
    fields = {
        "payee_address": dict(
            literal=LITERAL, normalized=LITERAL, state="value", value_type="text"
        )
    }
    fields[which] = dict(
        literal="", normalized=None, state="not_checked", value_type="text"
    )
    with pytest.raises(ComparisonImportError):
        local._local_payee_address(fields)


@pytest.fixture
def address_generation(db, monkeypatch, request):
    monkeypatch.setattr(
        integration, "packet", lambda **options: address_packet(monkeypatch, **options)
    )
    ctx = integration.local_generation.__wrapped__(db, monkeypatch, request)
    report = ctx.g["reports"][0]
    proof = readings.load_verified_reading_context(
        db,
        ctx.store,
        [ctx.reading.receipt_sha256],
        allowed_source_hashes=set(ctx.originals),
    )
    source = next(s for s in ctx.g["sources"] if s["sha256"] == report["source_sha256"])
    bindings = []
    for kind in ("payment", "payment_address"):
        locator = dict(
            kind=kind, receipt_sha256=ctx.reading.receipt_sha256, page=1, row=1
        )
        actual = local.extract_local_reading(
            ctx.originals[source["sha256"]], source, locator, context=proof
        )
        bindings.append(
            dict(
                source_sha256=source["sha256"],
                adapter="local_checked_reading:v1",
                locator=locator,
                facts=actual.facts,
                quote=actual.quote,
            )
        )
    payment = {
        **bindings[0]["facts"],
        **bindings[1]["facts"],
        "payment_key": digest("checked address payment"),
        "report_key": report["report_key"],
        "source_sha256": source["sha256"],
        "locator": bindings[0]["locator"],
        "check_status": "checked",
        "raw_metadata": {},
        "binding": bindings,
    }
    ctx.g["payments"] = [payment]
    ctx.g["id"] = storage.generation_digest(ctx.g)
    for item in ctx.args["evidence"]:
        if "generation_id" in item:
            item["generation_id"] = ctx.g["id"]
    return ctx


def test_normal_address_stage_current_history_csv_and_source_loss(
    db, address_generation, monkeypatch
):
    ctx = address_generation
    integration.publish(db, ctx)
    snapshot = db.get(m.ElectionComparisonSnapshot, ctx.g["snapshot_id"])
    snapshot.first_published_at = snapshot.fetched_at
    db.add(
        m.ElectionComparisonCurrent(
            election_key=ctx.g["election_key"], snapshot_id=snapshot.id
        )
    )
    db.flush()
    monkeypatch.setattr(expenses, "raw_file_store_from_env", lambda: ctx.store)
    monkeypatch.setattr(expenses.external, "raw_file_store_from_env", lambda: ctx.store)

    def public_read(fn, **kwargs):
        db.commit()
        with (
            db.get_bind()
            .connect()
            .execution_options(isolation_level="REPEATABLE READ") as connection
        ):
            with Session(connection) as reader:
                # Integration fixture's wrapper is for its original writer only.
                with monkeypatch.context() as scoped:
                    for name in ("candidate_finance", "bulk_finance"):
                        scoped.setattr(
                            integration.reads,
                            name,
                            getattr(integration.reads, name).__wrapped__,
                        )
                    return getattr(fn, "__wrapped__", fn)(reader, **kwargs)

    args = dict(election_key=ctx.g["election_key"])
    result = public_read(expenses.report, **args)
    # Exact-document status remains unknown; address does not make money additive.
    assert result["authority_reports"] == []
    bulk = public_read(
        integration.reads.bulk_finance,
        election_key=ctx.g["election_key"],
        store=ctx.store,
    )
    assert bulk["candidates"][0]["reports"][0]["effective"] is None
    own = bulk["candidates"][0]["own_payments"]
    assert own[0]["payee_address"]["as_filed"] == LITERAL
    assert len(own[0]["sources"]) == 2
    original_hash = ctx.g["payments"][0]["source_sha256"]
    body, metadata, headers = public_read(
        integration.reads.source_body,
        election_key=ctx.g["election_key"],
        generation_id=ctx.g["id"],
        source_hash=original_hash,
        store=ctx.store,
    )
    assert body == ctx.originals[original_hash]
    assert metadata["sha256"] == original_hash
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert all(
        "receipt_sha256" not in json.dumps(source) for source in own[0]["sources"]
    )
    pin = dict(snapshot_id=snapshot.id, version=result["version"])
    historical = public_read(expenses.report, **args, **pin)
    assert historical == result
    exported = public_read(expenses.export, **args, **pin, format="csv")
    rows = list(csv.DictReader(io.StringIO(exported[0])))
    payments = [r for r in rows if r["Row type"] == "External payment"]
    assert payments == []  # Unknown effective status cannot enter expense totals/CSV.
    assert "PRIVATE_" not in json.dumps(result)
    # Loss must change the pin rather than substitute an unchecked address or zero.
    original = ctx.g["payments"][0]["source_sha256"]
    source_row = db.get(m.ElectionResultSource, original)
    saved = ctx.store.objects.pop(source_row.object_key)
    lost = public_read(expenses.report, **args)
    assert lost["version"] != result["version"]
    with pytest.raises(HTTPException) as error:
        public_read(expenses.report, **args, **pin)
    assert error.value.status_code == 409
    ctx.store.objects[source_row.object_key] = saved
    assert public_read(expenses.report, **args, **pin)["version"] == result["version"]


@pytest.mark.parametrize(
    "attack", ["literal", "state", "postal_code", "missing_binding", "row", "quote"]
)
def test_supplemental_address_is_fresh_source_bound(db, address_generation, attack):
    ctx = address_generation
    payment = ctx.g["payments"][0]
    if attack in {"literal", "state", "postal_code"}:
        key = "as_filed" if attack == "literal" else attack
        payment["payee_address"][key] = "invented"
    elif attack == "missing_binding":
        payment["binding"].pop()
    elif attack == "row":
        payment["binding"][1]["locator"]["row"] = 2
    else:
        payment["binding"][1]["quote"] = "changed"
    ctx.g["id"] = storage.generation_digest(ctx.g)
    with pytest.raises(ComparisonImportError):
        storage.stage_generation(db, ctx.store, ctx.g, ctx.originals)


@pytest.mark.parametrize(
    "attack",
    [
        "extra_key",
        "missing_key",
        "empty",
        "space",
        "overflow",
        "control",
        "typed_newline",
    ],
)
def test_literal_address_closed_shape(db, address_generation, attack):
    ctx = address_generation
    address = ctx.g["payments"][0]["payee_address"]
    if attack == "extra_key":
        address["country"] = "US"
    elif attack == "missing_key":
        del address["city"]
    elif attack == "typed_newline":
        address["street_1"] = "one\ntwo"
    else:
        address["as_filed"] = {
            "empty": "",
            "space": " \n",
            "overflow": "x" * 4001,
            "control": "one\x00two",
        }[attack]
    ctx.g["id"] = storage.generation_digest(ctx.g)
    with pytest.raises(ComparisonImportError, match="Payment address"):
        storage.validate_generation(ctx.g)


def test_optional_literal_does_not_change_legacy_or_claim_null_is_visible():
    address = dict(
        street_1="123 Main",
        street_2=None,
        city="Boston",
        state="MA",
        postal_code="02196",
    )
    payment = dict(
        authority="fec", payee="Legacy Vendor", payment_key="one", payee_address=address
    )
    _, before = expenses._external_identity(payment)
    assert before["address"]["lines"] == ["123 Main", "Boston", "MA", "02196"]
    assert "as_filed" not in expenses._identity(before)["address"]
    assert expenses._csv_address(before)["Filed address status"] == "Address shown"
    _, after = expenses._external_identity(
        {**payment, "payee_address": dict.fromkeys((*address, "as_filed"))}
    )
    assert after["address"]["as_filed"] is None
    assert expenses._csv_address(after)["Filed address status"] == "Address not shown"


@pytest.mark.parametrize("attack", ["missing", "wrong_type", "different_normalized"])
def test_address_does_not_supply_unchecked_text(attack):
    field = dict(literal=LITERAL, normalized=LITERAL, state="value", value_type="text")
    if attack == "wrong_type":
        field["value_type"] = "money"
    elif attack == "different_normalized":
        field["normalized"] = "different"
    fields = {} if attack == "missing" else {"payee_address": field}
    with pytest.raises(ComparisonImportError):
        local._local_payee_address(fields)


@pytest.mark.parametrize("attack", ["page", "row", "receipt"])
def test_address_locator_cannot_escape_checked_section(checked_address, attack):
    body, source, row, proof, *_ = checked_address
    locator = dict(
        kind="payment_address", receipt_sha256=row.receipt_sha256, page=1, row=1
    )
    locator[{"page": "page", "row": "row", "receipt": "receipt_sha256"}[attack]] = (
        "0" * 64 if attack == "receipt" else 2
    )
    with pytest.raises(ComparisonImportError):
        local.extract_local_reading(body, source, locator, context=proof)
