"""A memo's original purchase date is not the committee's payment date."""

# ruff: noqa: F401,F811
from copy import deepcopy
from datetime import date
import json

import pytest

from alethical.api.services import election_external_finance_reads as reads
from alethical.pipeline import election_external_finance as storage
from alethical.pipeline.election_comparison import ComparisonImportError
from alethical.tests.test_election_external_finance import (
    db,
    external,
    rewrite_original,
    stage,
)
from alethical.tests.test_election_external_finance_reads import args, checked


def memo_fixture(ctx, *, memo=True, payment_date="2026-09-30", source_memo=True):
    ctx.args["period_start"] = date(2026, 10, 1)
    records = json.loads(ctx.originals[ctx.source_hash])["records"]
    for report in ctx.g["reports"]:
        report["period_start"] = "2026-10-01"
        records[report["binding"]["locator"]["row"]]["period_start"] = "2026-10-01"
        for figure in report["figures"]:
            figure["period_start"] = "2026-10-01"
            records[figure["binding"]["locator"]["row"]]["period_start"] = "2026-10-01"
    payment = ctx.g["payments"][0]
    payment.update(
        date=payment_date,
        transaction_type="F3:SB17",
        memo={
            "code": "X" if memo else None,
            "text": "Original vendor purchase",
            "back_reference_transaction_id": "parent-transaction",
            "back_reference_schedule": "SB17",
        },
    )
    literal = storage.payment_facts(payment)
    literal["memo"] = deepcopy(literal["memo"])
    if not source_memo:
        literal["memo"]["code"] = None
    records[payment["binding"]["locator"]["row"]] = literal
    rewrite_original(ctx, records)
    return payment


def test_earlier_memo_date_is_retained_as_nonadditive_source_detail(db, external):
    memo_fixture(external)
    checked(db, external)
    result = reads.candidate_finance(db, **args(external))
    memo = next(p for p in result["payments"] if p["memo"] != "source memo")
    assert memo["date"] == "2026-09-30"
    assert memo["amount"] == "123.4500"
    assert memo["amount_role"] == "supplemental_memo"
    assert memo["nonadditive"] is True
    other = next(p for p in result["payments"] if p is not memo)
    assert other["amount_role"] == "reported_payment"
    assert other["nonadditive"] is False
    assert (
        next(r for r in result["reports"] if r["effective"])["figures"][1]["value"]
        == "12.3400"
    )
    page = reads.payment_records(db, **args(external))
    assert page["rows"] == result["payments"]


@pytest.mark.parametrize(
    "memo,payment_date",
    [(False, "2026-09-30"), (True, "2026-10-15"), (True, "bad-date")],
)
def test_memo_does_not_allow_real_out_of_period_payments_or_future_dates(
    db, external, memo, payment_date
):
    memo_fixture(external, memo=memo, payment_date=payment_date)
    with pytest.raises(ComparisonImportError):
        stage(db, external)


def test_operator_cannot_turn_unmarked_source_payment_into_memo(db, external):
    memo_fixture(external, source_memo=False)
    with pytest.raises(ComparisonImportError):
        stage(db, external)


def test_local_memo_string_does_not_inherit_federal_date_semantics(db, external):
    memo_fixture(external)
    payment = external.g["payments"][0]
    # Semantic helper is source-family-specific; arbitrary memo text is not a flag.
    assert storage.supplemental_memo(payment)
    assert not storage.supplemental_memo({**payment, "authority": "local"})
    assert not storage.supplemental_memo({**payment, "memo": "X"})
    assert not storage.supplemental_memo({**payment, "memo": {"code": "x"}})


def test_in_period_memo_is_also_nonadditive_and_source_loss_still_withholds(
    db, external
):
    memo_fixture(external, payment_date="2026-10-01")
    checked(db, external)
    result = reads.candidate_finance(db, **args(external))
    assert (
        next(p for p in result["payments"] if p["amount"] == "123.4500")["nonadditive"]
        is True
    )
    external.store.objects.clear()
    after = reads.candidate_finance(db, **args(external))
    assert after["payments"] == []
    assert after["version"] != result["version"]
