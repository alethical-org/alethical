"""Source-bound optional address text survives the normal expense read/export path."""

# ruff: noqa: F811,F401
import csv
import io
import json

import pytest
from fastapi import HTTPException

from alethical.db import models as m
from alethical.api.services import election_expense_analytics as expenses
from alethical.pipeline import election_external_finance as storage
from alethical.tests.test_election_external_finance import (
    db,
    external,
    rewrite_original,
)
from alethical.tests.test_election_external_finance_reads import checked

LITERAL = "1445 Valleyhigh Drive NW\nRochester MN 55901"


@pytest.fixture
def literal_generation(db, external, monkeypatch):
    ctx = external
    records = json.loads(ctx.originals[ctx.source_hash])["records"]
    for payment in ctx.g["payments"]:
        payment.update(
            target_source_candidate_id=None,
            direction="unknown",
            transaction_type="F3:SB17",
            payee="Exact Vendor",
            memo={},
            payee_address=dict(
                street_1=None,
                street_2=None,
                city=None,
                state="MN",
                postal_code="55901",
                as_filed=LITERAL,
            ),
        )
        records[payment["binding"]["locator"]["row"]] = storage.payment_facts(payment)
    rewrite_original(ctx, records)
    checked(db, ctx)
    ctx.snapshot.first_published_at = ctx.snapshot.fetched_at
    db.add(
        m.ElectionComparisonCurrent(
            election_key=ctx.g["election_key"], snapshot_id=ctx.snapshot.id
        )
    )
    db.flush()
    monkeypatch.setattr(expenses, "raw_file_store_from_env", lambda: ctx.store)
    monkeypatch.setattr(expenses.external, "raw_file_store_from_env", lambda: ctx.store)
    return ctx


def test_current_pinned_history_and_csv_keep_literal(db, literal_generation):
    ctx = literal_generation
    args = dict(election_key=ctx.g["election_key"])
    current = expenses.report(db, **args)
    pin = dict(snapshot_id=current["snapshot_id"], version=current["version"])
    assert expenses.report(db, **args, **pin) == current
    payees = expenses.payees(db, **args, **pin)
    address = payees["payees"][0]["payee"]["address"]
    assert address["as_filed"] == LITERAL
    assert address["lines"] == [LITERAL]
    assert address["street"] is address["city"] is None
    details = expenses.payments(
        db, **args, **pin, payee_id=payees["payees"][0]["payee_id"]
    )
    assert all(
        p["payee"]["address"]["as_filed"] == LITERAL for p in details["payments"]
    )
    assert all(p["payee"]["address"]["lines"] == [LITERAL] for p in details["payments"])
    body, _ = expenses.export(db, **args, **pin, format="csv")
    rows = list(csv.DictReader(io.StringIO(body)))
    payments = [r for r in rows if r["Row type"] == "External payment"]
    assert len(payments) == 2
    assert all(r["Filed address"] == LITERAL for r in payments)
    assert all(r["Filed address status"] == "Address shown as filed" for r in payments)
    assert all(
        r["Filed state"] == "MN" and r["Filed postal code"] == "55901" for r in payments
    )
    assert all(r["Filed street"] == r["Filed city"] == "" for r in payments)
    assert "PRIVATE_" not in json.dumps(current)


def test_address_original_loss_recovery_keeps_pin_guards(db, literal_generation):
    ctx = literal_generation
    args = dict(election_key=ctx.g["election_key"])
    first = expenses.report(db, **args)
    pin = dict(snapshot_id=first["snapshot_id"], version=first["version"])
    row = db.get(m.ElectionResultSource, ctx.source_hash)
    saved = ctx.store.objects.pop(row.object_key)
    lost = expenses.report(db, **args)
    assert lost["version"] != first["version"]
    with pytest.raises(HTTPException) as error:
        expenses.report(db, **args, **pin)
    assert error.value.status_code == 409
    ctx.store.objects[row.object_key] = saved
    assert expenses.report(db, **args, **pin) == first
