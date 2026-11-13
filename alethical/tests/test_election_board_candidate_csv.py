"""Native Board fields stay separate from campaign-account CSV arithmetic."""

from copy import deepcopy
import ast
import csv
import io
from pathlib import Path

import pytest

from alethical.api.services import election_board_candidate_csv as board_csv


def field(key, literal, *, state="value", normalized=None, page=2):
    return {
        "field_id": key,
        "literal": literal,
        "state": state,
        "normalized": literal
        if normalized is None and state == "value"
        else normalized,
        "page": page,
        "bounds": [10, 20, 30, 40],
        "label": key,
        "value_type": "money",
        "currency": "USD",
        "private_note": "private-field-sentinel",
    }


def data():
    claim = {
        "race_id": "race-56",
        "candidate_id": "00123",
        "name": "Raymond David Petersen",
        "filed_party": "R",
        "party_group": "R",
        "office": "State Senator",
        "district": "56",
    }
    source = {"url": "https://cfb.mn.gov/original", "copied_at": "2026-11-13T12:00:00Z"}
    report = {
        "report_key": "personal-E",
        "record_id": "2790",
        "role": "AOC",
        "year": 2026,
        "report_type": "E",
        "amendment": "0",
        "latest_amendment": "0",
        "name": "Raymond David Petersen",
        "office": "Senate 56",
        "claim": claim,
        "period": {"start": "2026-01-01", "end": "2026-10-19"},
        "source_sha256": "d" * 64,
        "source_url": "/retained/pdf",
        "source": source,
        "received_date": field(
            "cover.received_date", "10/20/26", normalized="2026-10-20", page=1
        ),
        "certification_date": field(
            "cover.certification_date", "10/20/26", normalized="2026-10-20", page=1
        ),
        "measures": {
            k: field("total." + k, v)
            for k, v in {
                "cash": "1221.52",
                "unpaid": "",
                "in_kind": "291.00",
                "total": "1512.52",
            }.items()
        },
        "nonitemized": {
            k: field("nonitemized." + k, v)
            for k, v in {
                "cash": "90.61",
                "unpaid": "",
                "in_kind": "291.00",
                "total": "381.61",
            }.items()
        },
        "items": [
            {
                "row": 2,
                "fields": {
                    "date": field("item.2.date", "8/12/2026", normalized="2026-08-12"),
                    "payee": field("item.2.payee", "〃", state="ambiguous"),
                    "street": field("item.2.street", "", state="redacted"),
                    "city": None,
                    "state": field("item.2.state", "MA"),
                    "postal_code": None,
                    "purpose": field("item.2.purpose", "Printing of lawn signs"),
                    **{
                        k: field("item.2." + k, v)
                        for k, v in {
                            "cash": "933.73",
                            "unpaid": "",
                            "in_kind": "",
                            "total": "933.73",
                        }.items()
                    },
                },
            }
        ],
        "reviewed_by": "private-reviewer-sentinel",
    }
    for family in (
        report["measures"],
        report["nonitemized"],
        report["items"][0]["fields"],
    ):
        for k in ("unpaid", "in_kind"):
            if k in family and family[k]["literal"] == "":
                family[k]["state"] = "blank"
                family[k]["normalized"] = None
    return {
        "candidates": [claim],
        "personal_reports": [report],
        "board_candidate_records": [
            {
                "record_id": "2790",
                "role": "AOC",
                "year": 2026,
                "state": "checked",
                "relationship": {"race_id": "race-56", "candidate_id": "00123"},
                "availability": {"state": "reports_offered"},
                "selected_report_key": "personal-E",
                "sources": {
                    "information": {
                        **source,
                        "sha256": "a" * 64,
                        "retained_source_url": "/retained/information",
                    }
                },
            }
        ],
    }


def test_source_only_has_candidate_party_source_but_no_report_money_or_account():
    value = data()
    value["personal_reports"] = []
    value["board_candidate_records"][0]["selected_report_key"] = None
    value["board_candidate_records"][0]["availability"]["state"] = (
        "no_information_returned"
    )
    rows = list(board_csv.csv_rows(value))
    assert len(rows) == 1
    row = rows[0]
    assert row["Candidate"] == "Raymond David Petersen"
    assert row["Official party"] == "R"
    assert row["Authority ID"] == "2790"
    assert row["Source copied at"] == "2026-11-13T12:00:00Z"
    for key in (
        "Report key",
        "Report total USD",
        "Reported measure value",
        "Account",
        "Account count",
        "Public subsidy USD",
    ):
        assert row.get(key) is None


def test_native_families_once_blank_never_zero_and_context_has_no_money():
    value = data()
    before = deepcopy(value)
    rows = list(board_csv.csv_rows(value))
    for kind, prefix in (
        ("Board report measure", "total"),
        ("Board non-itemized measure", "nonitemized"),
        ("Board personal payment", "item.2"),
    ):
        family = [r for r in rows if r["Row type"] == kind]
        assert len(family) == 4
        assert {r["Measure ID"] for r in family} == {
            "cash",
            "unpaid",
            "in_kind",
            "total",
        }
        unpaid = next(r for r in family if r["Measure ID"] == "unpaid")
        assert unpaid.get("Reported measure value") is None
        assert unpaid.get("Reported payment amount") is None
        assert unpaid["Figure status"] == "Blank in source"
        assert f"{prefix}.unpaid" in unpaid["Source references"]
    cash = next(
        r
        for r in rows
        if r["Row type"] == "Board report measure" and r["Measure ID"] == "cash"
    )
    assert cash["Reported measure value"] == "1221.52"
    assert cash["Source text"] == "1221.52"
    assert cash["Source pages"] == "2" and "10,20,30,40" in cash["Source references"]
    assert all(
        r.get("Account") is None and r.get("Report paid USD") is None for r in rows
    )
    assert value == before


@pytest.mark.parametrize(
    "state", ["blank", "ambiguous", "redacted", "unreadable", "not_checked"]
)
def test_unknown_amount_preserves_literal_and_state_without_numeric_guess(state):
    value = data()
    value["personal_reports"][0]["measures"]["in_kind"] = field(
        "total.in_kind",
        "197 or 192" if state == "ambiguous" else "",
        state=state,
        normalized="999.00",
    )
    row = next(
        r
        for r in board_csv.csv_rows(value)
        if r["Row type"] == "Board report measure" and r["Measure ID"] == "in_kind"
    )
    assert row["Reported measure value"] is None
    assert "state=" + state in row["Source references"]
    assert row["Source text"] == ("197 or 192" if state == "ambiguous" else "")


def test_two_selected_reports_keep_own_period_source_and_values():
    value = data()
    other = deepcopy(value["personal_reports"][0])
    other.update(
        report_key="personal-C",
        report_type="C",
        source_sha256="e" * 64,
        source_url="/retained/primary",
    )
    other["period"]["end"] = "2026-07-20"
    other["source"]["copied_at"] = "2026-11-14T12:00:00Z"
    other["measures"]["cash"] = field("total.cash", "201.18")
    value["personal_reports"].append(other)
    cash = [
        r
        for r in board_csv.csv_rows(value)
        if r["Row type"] == "Board report measure" and r["Measure ID"] == "cash"
    ]
    assert [
        (
            r["Report key"],
            r["Period end"],
            r["Reported measure value"],
            r["Source URL"],
            r["Source copied at"],
        )
        for r in cash
    ] == [
        (
            "personal-E",
            "2026-10-19",
            "1221.52",
            "/retained/pdf",
            "2026-11-13T12:00:00Z",
        ),
        (
            "personal-C",
            "2026-07-20",
            "201.18",
            "/retained/primary",
            "2026-11-14T12:00:00Z",
        ),
    ]


def test_ditto_redaction_and_private_fields_are_not_resolved_or_leaked():
    rows = list(board_csv.csv_rows(data()))
    row = next(
        r
        for r in rows
        if r["Row type"] == "Board personal payment" and r["Measure ID"] == "cash"
    )
    assert row["Payee"] == "〃" and row["Payee status"] == "Unclear"
    assert row["Filed state"] == "MA" and not row.get("Filed street")
    assert "street=redacted" in row["Filed address status"]
    assert "item.2.payee" in row["Source references"]
    assert "private-" not in repr(rows)


def shared_writer(rows):
    """Use the real scalar writer prefix without importing app/DB modules."""
    path = Path(board_csv.__file__).with_name("election_expense_analytics.py")
    tree = ast.parse(path.read_text())
    safe = next(
        n
        for n in tree.body
        if isinstance(n, ast.FunctionDef) and n.name == "_safe_text"
    )
    columns = next(
        n
        for n in tree.body
        if isinstance(n, ast.Assign)
        and any(isinstance(t, ast.Name) and t.id == "_CSV_COLUMNS" for t in n.targets)
    )
    body = next(
        n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "_csv_body"
    )
    stop = next(
        i
        for i, n in enumerate(body.body)
        if isinstance(n, ast.FunctionDef) and n.name == "write"
    )
    namespace = {
        "csv": csv,
        "io": io,
        "COLUMNS": ("paid", "unpaid", "in_kind", "total"),
        "_CSV_AMOUNT_FAMILIES": ("Report", "Non-itemized", "Payment"),
    }
    exec(
        compile(
            ast.Module(body=[safe, columns, *body.body[: stop + 1]], type_ignores=[]),
            str(path),
            "exec",
        ),
        namespace,
    )
    for row in rows:
        namespace["write"](row)
    return list(csv.DictReader(io.StringIO(namespace["output"].getvalue())))


def test_shared_writer_escapes_text_and_generator_uses_only_existing_columns():
    value = data()
    value["personal_reports"][0]["claim"]["name"] = "=2+3"
    value["personal_reports"][0]["items"][0]["fields"]["payee"]["literal"] = "@SUM(1)"
    rows = list(board_csv.csv_rows(value))
    assert any(r.get("Candidate") == "=2+3" for r in rows)
    output = shared_writer(rows)
    assert all(r["Candidate"] == "'=2+3" for r in output)
    assert (
        next(r for r in output if r["Row type"] == "Board personal payment")["Payee"]
        == "'@SUM(1)"
    )
    assert (
        next(
            r
            for r in output
            if r["Row type"] == "Board report measure" and r["Measure ID"] == "cash"
        )["Reported measure value"]
        == "1221.52"
    )


def test_invalid_numeric_value_refuses_instead_of_bypassing_shared_text_safety():
    value = data()
    value["personal_reports"][0]["measures"]["cash"]["normalized"] = "=2+3"
    with pytest.raises(ValueError, match="money"):
        list(board_csv.csv_rows(value))


def test_excluded_item_keeps_all_native_measures_and_uses_provided_subtotal_once():
    value = data()
    report = value["personal_reports"][0]
    report.update(itemized_before_exclusions="933.73", itemized_after_exclusions="0.00")
    value["personal_baseline_payments"] = [
        {"report_key": "personal-E", "row": 2, "payee_id": "stable-payee"}
    ]
    value["filters"] = {"excluded_payee_ids": ["stable-payee"]}
    value["payments"] = []
    rows = list(board_csv.csv_rows(value))
    item = [r for r in rows if r["Row type"] == "Board personal payment"]
    assert len(item) == 4
    assert all(
        r["Excluded payee"] == "Yes" and r["Included in filtered view"] == "No"
        for r in item
    )
    assert (
        next(r for r in item if r["Measure ID"] == "cash")["Reported payment amount"]
        == "933.73"
    )
    subtotal = [r for r in rows if r["Row type"] == "Board itemized subtotal"]
    assert len(subtotal) == 1
    assert subtotal[0]["Itemized before exclusions"] == "933.73"
    assert subtotal[0]["Itemized after exclusions"] == "0.00"
    assert subtotal[0].get("Reported measure value") is None
    assert "Calculated" in subtotal[0]["Basis"] and not subtotal[0].get("Source text")


def test_missing_source_copy_date_refuses_and_checked_zero_is_preserved():
    value = data()
    value["personal_reports"][0]["measures"]["cash"] = field("total.cash", "0.00")
    row = next(
        r
        for r in board_csv.csv_rows(value)
        if r["Row type"] == "Board report measure" and r["Measure ID"] == "cash"
    )
    assert row["Reported measure value"] == "0.00" and row["Figure status"] == "Checked"
    del value["personal_reports"][0]["source"]["copied_at"]
    with pytest.raises(KeyError, match="copied_at"):
        list(board_csv.csv_rows(value))


def test_source_only_observations_bind_each_status_to_its_actual_original():
    value = data()
    value["personal_reports"] = []
    record = value["board_candidate_records"][0]
    record["availability"]["state"] = "no_information_returned"
    record["financial_status"] = "no_data_returned"
    record["sources"]["catalogue"] = {
        "url": "https://cfb.mn.gov/catalogue",
        "copied_at": "2026-11-14T12:00:00Z",
        "sha256": "b" * 64,
        "retained_source_url": "/retained/catalogue",
    }
    record["sources"]["financial"] = {
        "url": "https://cfb.mn.gov/financial",
        "copied_at": "2026-11-15T12:00:00Z",
        "sha256": "c" * 64,
        "retained_source_url": "/retained/financial",
    }
    rows = {r["Metadata value"]: r for r in board_csv.csv_rows(value)}
    assert rows["catalogue"]["Gaps"] == "no information returned"
    assert rows["catalogue"]["Source URL"] == "/retained/catalogue"
    assert rows["financial"]["Gaps"] == "no data returned"
    assert rows["financial"]["Source copied at"] == "2026-11-15T12:00:00Z"
    assert rows["information"]["Gaps"] is None
    assert all(
        r.get("Report key") is None and r.get("Account count") is None
        for r in rows.values()
    )
