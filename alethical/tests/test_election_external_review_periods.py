"""Account review spans only the continuous intervals proved by its covers."""

# ruff: noqa: F401,F811
from copy import deepcopy
from datetime import date
import json

import pytest

from alethical.api.services import election_external_finance_reads as reads
from alethical.pipeline import election_account_reviews as reviews
from alethical.pipeline.election_comparison import ComparisonImportError
from alethical.tests.test_election_external_finance import (
    db,
    external,
    rewrite_original,
    stage,
)
from alethical.tests.test_election_external_finance_reads import args, checked


def adjacent_reports(ctx, *, second_start="2026-10-01"):
    records = json.loads(ctx.originals[ctx.source_hash])["records"]
    periods = [("2026-09-01", "2026-09-30"), (second_start, "2026-10-14")]
    for index, (report, (start, end)) in enumerate(zip(ctx.g["reports"], periods)):
        values = {
            "period_start": start,
            "period_end": end,
            "series_id": f"synthetic-distinct-period-{index}",
            "predecessor_report_key": None,
            "effective": True,
        }
        report.update(values)
        records[report["binding"]["locator"]["row"]].update(values)
        for figure in report["figures"]:
            figure.update(period_start=start, period_end=end)
            records[figure["binding"]["locator"]["row"]].update(
                period_start=start, period_end=end
            )
    first = ctx.g["reports"][0]
    ctx.args["evidence"].append(
        {
            "kind": "report_cover",
            "sha256": ctx.source_hash,
            "generation_id": ctx.g["id"],
            "binding": deepcopy(first["binding"]),
            "report_key": first["report_key"],
        }
    )
    ctx.args["period_start"] = date(2026, 9, 1)
    rewrite_original(ctx, records)


@pytest.mark.parametrize("second_start", ["2026-10-01", "2026-09-30"])
def test_contiguous_checked_covers_support_full_review_without_summing_reports(
    db, external, second_start
):
    adjacent_reports(external, second_start=second_start)
    checked(db, external)
    result = reads.candidate_finance(db, **args(external))
    assert len(result["accounts"]) == 1
    assert len(result["reports"]) == 2
    assert {r["period_start"] for r in result["reports"]} == {
        "2026-09-01",
        second_start,
    }
    assert all(len(r["figures"]) == 2 for r in result["reports"])


@pytest.mark.parametrize(
    "change", ["gap", "missing_cover", "start_before", "end_after"]
)
def test_unproved_day_or_missing_cover_refuses_review(db, external, change):
    # Keep the existing payments inside the later report even for the gap case.
    adjacent_reports(external)
    if change == "gap":
        records = json.loads(external.originals[external.source_hash])["records"]
        first = external.g["reports"][0]
        first["period_end"] = "2026-09-29"
        records[first["binding"]["locator"]["row"]]["period_end"] = "2026-09-29"
        for f in first["figures"]:
            f["period_end"] = "2026-09-29"
            records[f["binding"]["locator"]["row"]]["period_end"] = "2026-09-29"
        rewrite_original(external, records)
    elif change == "missing_cover":
        external.args["evidence"].pop()
    elif change == "start_before":
        external.args["period_start"] = date(2026, 8, 31)
    else:
        external.args["period_end"] = date(2026, 10, 15)
    stage(db, external)
    with pytest.raises(ComparisonImportError, match="unchecked report dates"):
        reviews.record_decision(db, **external.args)
