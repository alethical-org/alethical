"""Normal result/source/review/CSV composition for 35 raw attachment rows."""

# ruff: noqa: F811,F401
import csv
import inspect
import io
import json
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

from alethical.api.services import election_comparison_export as export
from alethical.api.services import election_external_finance_reads as reads
from alethical.api.services import election_source_io
from alethical.pipeline import election_source_readings as readings
from alethical.tests.test_election_olmsted_attachment_integration import (
    db,
    isolated_engine,
    attachment_generation,
    publish_and_review,
    assert_detail,
)


def test_normal_selected_olmsted_rows_have_own_attribution_exact_source_and_address(
    attachment_generation, db, monkeypatch, tmp_path
):
    held = attachment_generation
    query = publish_and_review(db, held, monkeypatch)
    good = reads.candidate_finance(db, **query)
    assert_detail(good, held)
    for module in (export.results, export.finance, export.outside, reads):
        monkeypatch.setattr(module, "raw_file_store_from_env", lambda: held.store)
    monkeypatch.setattr(election_source_io, "reader_store_from_env", lambda: held.store)
    attempts = []

    def refuse(*args, **kwargs):
        attempts.append(1)
        raise AssertionError("CSV ordinary reads never render")

    monkeypatch.setattr(readings, "render_page", refuse)
    args = dict(
        election_key=held.g["election_key"],
        race_id=held.race.id,
        snapshot_id=held.snapshot.id,
        external_generation_id=held.g["id"],
    )
    db.commit()
    with db.bind.connect().execution_options(
        isolation_level="REPEATABLE READ"
    ) as connection:
        with Session(connection) as reader:
            default = export.export_csv(reader, **args)
            assert not any(
                r["Row type"] == "External payment"
                for r in csv.DictReader(io.StringIO(default.decode("utf-8-sig")))
            )
            body = export.export_csv(
                reader, **args, report_keys=[held.report["report_key"]]
            )
    output = tmp_path / "normal-olmsted-selected.csv"
    output.write_bytes(body)
    print(f"Saved normal Olmsted raw CSV: {output}")
    rows = list(csv.DictReader(io.StringIO(body.decode("utf-8-sig"))))
    payments = [r for r in rows if r["Row type"] == "External payment"]
    assert len(payments) == 35 and len({r["Payment key"] for r in payments}) == 35
    by_key = {p["payment_key"]: p for p in good["own_payments"]}
    for row in payments:
        original = by_key[row["Payment key"]]
        assert (
            row["Payment amount"] == original["amount"]
            and row["Payee"] == original["payee"]
        )
        assert (
            row["Account candidate ID"] == "05309001"
            and row["Account candidate"] == "Synthetic Candidate"
        )
        assert row["Target candidate ID"] == row["Target candidate"] == ""
        assert row["Direction"] == "unknown" and row["Effective amendment"] == ""
        assert (
            row["Nonadditive"] == "Yes"
            and row["State"] == "amendment_status_not_established"
        )
        assert row["Payee address as filed"] == original["payee_address"]["as_filed"]
        assert (
            row["Payee street"] == row["Payee city"] == ""
            and row["Payee state"] == "MN"
            and row["Payee ZIP"] == "55901"
        )
        assert row["Period start"] == "2026-04-07" and row["Period end"] == "2026-07-31"
    evidence = [
        r for r in rows if r["Row type"] == "Evidence" and r["Payment key"] in by_key
    ]
    expected_hashes = {s["source_sha256"] for s in good["own_payments"][0]["sources"]}
    assert {r["Source hash"] for r in evidence} == expected_hashes
    parent = held.documents[0].receipt["original_sha256"]
    child = held.documents[1].receipt["original_sha256"]
    assert any(
        r["Source hash"] == parent
        and r["Source page"] == "1"
        and r["Source field"] == "disbursements.item_area"
        for r in evidence
    )
    assert any(
        r["Source hash"] == child and r["Source page"] == "1" and r["Source row"] == "1"
        for r in evidence
    )
    catalogue = expected_hashes - {parent, child}
    assert len(catalogue) == 1
    html = [r for r in evidence if r["Source hash"] in catalogue]
    assert all(r["Source page"] == "" for r in html)
    # Exact HTML location survives the existing Source row/field columns.
    expected = {
        (str(s["locator"]["line"]), s["locator"]["anchor_index"])
        for s in good["own_payments"][0]["sources"]
        if s["source_sha256"] in catalogue
    }
    assert {r["Source row"] for r in html} == {line for line, _ in expected}
    assert {(r["Source row"], r["Source field"]) for r in html} == {
        (line, f"Link {anchor}") for line, anchor in expected
    }
    text = body.decode("utf-8-sig")
    assert (
        "PRIVATE_" not in text
        and "receipt_sha256" not in text
        and all(d.row.receipt_sha256 not in text for d in held.documents)
    )
    assert attempts == []
