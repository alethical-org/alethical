"""Exact candidate views expose checked own rows separately from targeted money."""

# ruff: noqa: F811,F401
from copy import deepcopy
from datetime import date
import hashlib
import json

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from alethical.api.services import election_external_finance_reads as reads
from alethical.db import models as m
from alethical.pipeline import election_account_reviews as reviews
from alethical.pipeline import election_external_finance as storage
from alethical.pipeline import election_source_readings as readings
from alethical.tests.test_election_local_payment_address import (
    db,
    isolated_engine,
    address_generation,
    LITERAL,
)
from alethical.tests import test_election_local_reading_integration as integration


def query(ctx):
    return dict(
        election_key=ctx.g["election_key"],
        race_id=ctx.race.id,
        candidate_id=ctx.candidate["candidate_id"],
        store=ctx.store,
    )


def test_exact_local_candidate_has_separate_checked_own_detail(db, address_generation):
    ctx = address_generation
    integration.publish(db, ctx)
    result = reads.candidate_finance(db, **query(ctx))
    own = result["own_payments"]
    assert len(own) == 1
    row = own[0]
    assert row["report_key"] == ctx.report["report_key"]
    assert row["payee"] == "Postal Vendor"
    assert row["payee_address"]["as_filed"] == LITERAL
    assert row["direction"] == "unknown"
    assert row.get("target_source_candidate_id") is None
    assert row["amount"] == "536.46"
    assert row["effective"] is None
    assert row["amendment_status"] == "not_established"
    assert len(row["sources"]) == 2
    assert all(
        s["source_sha256"] == ctx.receipt["original_sha256"] for s in row["sources"]
    )
    assert result["payments"] == []
    assert "PRIVATE_" not in json.dumps(result)
    assert "receipt_sha256" not in json.dumps(row)
    assert (
        reads.candidate_finance(
            db, **query(ctx), generation_id=ctx.g["id"], version=result["version"]
        )
        == result
    )


@pytest.mark.parametrize(
    "failure", ["original_loss", "reading_withdrawal", "account_withdrawal"]
)
def test_own_detail_loss_changes_pin_and_never_keeps_stale_rows(
    db, address_generation, failure
):
    ctx = address_generation
    integration.publish(db, ctx)
    before = reads.candidate_finance(db, **query(ctx))
    assert before["own_payments"]
    if failure == "original_loss":
        source = db.get(m.ElectionResultSource, ctx.receipt["original_sha256"])
        saved = ctx.store.objects.pop(source.object_key)
    elif failure == "reading_withdrawal":
        readings.record_reading(
            db,
            ctx.store,
            receipt=ctx.receipt,
            decision="withdrawn",
            reviewed_by="private",
            reason="Withdraw exact source reading",
            expected_previous_id=ctx.reading.id,
        )
    else:
        latest = db.scalar(
            select(m.ElectionCampaignAccountDecision).order_by(
                m.ElectionCampaignAccountDecision.id.desc()
            )
        )
        reviews.record_decision(
            db,
            **(ctx.args | dict(decision="withdrawn", expected_previous_id=latest.id)),
        )
    with pytest.raises(HTTPException) as error:
        reads.candidate_finance(db, **query(ctx), version=before["version"])
    assert error.value.status_code == 409
    after = reads.candidate_finance(db, **query(ctx))
    assert after["own_payments"] == []
    assert after["version"] != before["version"]
    if failure == "original_loss":
        ctx.store.objects[source.object_key] = saved
        assert (
            reads.candidate_finance(db, **query(ctx), version=before["version"])
            == before
        )


def test_own_detail_needs_entire_report_interval(db, address_generation):
    ctx = address_generation
    ctx.args["period_start"] = date(2026, 9, 1)
    integration.publish(db, ctx)
    result = reads.candidate_finance(db, **query(ctx))
    assert result["accounts"]
    assert result["own_payments"] == []
    assert result["payments"] == []


def test_scoped_own_detail_does_not_fetch_unrelated_original_or_wrong_candidate(
    db, address_generation, monkeypatch
):
    ctx = address_generation
    body = b"unrelated unbound retained source"
    sha = hashlib.sha256(body).hexdigest()
    ctx.originals[sha] = body
    ctx.g["sources"].append(
        dict(
            sha256=sha,
            authority=None,
            url="https://www.crowwing.gov/unrelated",
            media_type="text/plain",
            copied_at=ctx.g["copied_at"],
        )
    )
    ctx.g["id"] = storage.generation_digest(ctx.g)
    for item in ctx.args["evidence"]:
        if "generation_id" in item:
            item["generation_id"] = ctx.g["id"]
    integration.publish(db, ctx)
    unrelated = db.get(m.ElectionResultSource, sha)
    unrelated_key = unrelated.object_key
    original_get = ctx.store.get
    fetched = []

    def tracked(key, *args, **kwargs):
        fetched.append(key)
        assert key != unrelated_key
        return original_get(key, *args, **kwargs)

    monkeypatch.setattr(ctx.store, "get", tracked)
    scopes = []
    original_load = storage.load_published_view

    def scoped(*args, **kwargs):
        scopes.append((args[2], kwargs))
        return original_load(*args, **kwargs)

    monkeypatch.setattr(storage, "load_published_view", scoped)
    result = reads.candidate_finance(db, **query(ctx))
    assert result["own_payments"]
    current_scopes = [
        scope for scope in scopes if scope[1].get("history_report_keys") is None
    ]
    assert len(current_scopes) == 1
    assert current_scopes[0][0] == {
        (ctx.args["authority"], ctx.args["registration_number"])
    }
    assert current_scopes[0][1]["include_own_payments"] is True
    assert current_scopes[0][1]["stable_id"] == ctx.candidate["candidate_stable_id"]
    assert unrelated_key not in fetched
    fetched.clear()
    with pytest.raises(HTTPException) as error:
        reads.candidate_finance(db, **(query(ctx) | dict(candidate_id="wrong")))
    assert error.value.status_code == 404
    assert fetched == []


def test_bulk_projects_own_detail_once_per_candidate(
    db, address_generation, monkeypatch
):
    ctx = address_generation
    integration.publish(db, ctx)
    calls = []
    original = reads._own_payments

    def counted(*args, **kwargs):
        calls.append(args[0]["candidate_id"])
        return original(*args, **kwargs)

    monkeypatch.setattr(reads, "_own_payments", counted)
    result = reads.bulk_finance(db, election_key=ctx.g["election_key"], store=ctx.store)
    assert result["candidates"][0]["own_payments"]
    assert calls == [ctx.candidate["candidate_id"]]
