"""Candidate outside totals retain exact answers without repeated source scans."""

# Imported fixtures are intentionally rebound by pytest.
# ruff: noqa: F401,F811

from datetime import date
from decimal import Decimal
from types import SimpleNamespace

import pytest
from sqlalchemy import event, select

from alethical.api.services import election_finance_reads as reads
from alethical.api.services import election_outside_spending as outside
from alethical.tests.finance_fixtures import finance_db
from alethical.tests.test_election_outside_spending import spending


def reference_outside(db, release, year, account_state):
    """The held five-query contract, independent of the replacement's assembly."""
    if release is None:
        return {
            "state": "unavailable",
            "groups": None,
            "total": None,
            "reason": "retained_payment_source_unavailable",
        }
    accounts = account_state["accounts"]
    if not accounts:
        return {"state": account_state["state"], "groups": [], "total": None}
    filters = reads._attribution_filters(release, year, accounts)
    category, direction = outside._category(), outside._direction()
    rows = (
        db.execute(
            select(
                category.label("category"),
                direction.label("direction"),
                *outside._measure_columns(),
            )
            .where(*filters)
            .group_by(category, direction)
            .order_by(category, direction)
        )
        .mappings()
        .all()
    )
    target = [
        reads.R.snapshot_id == release.independent_expenditures.snapshot_id,
        reads.R.affected_committee_reg_num.in_(
            [a["registration_number"] for a in accounts]
        ),
    ]
    return {
        "state": account_state["state"],
        "total": outside._aggregate(db, *filters),
        "groups": [
            {
                "category": row["category"],
                "direction": row["direction"],
                **outside._measures(row),
            }
            for row in rows
        ],
        "excluded_missing_date": outside._aggregate(
            db, *target, reads.R.year == year, reads.R.transaction_date.is_(None)
        ),
        "excluded_missing_year": outside._aggregate(
            db, *target, reads.R.year.is_(None)
        ),
        "excluded_outside_reviewed_period": outside._aggregate(
            db, *reads._outside_reviewed_period_filters(release, year, accounts)
        ),
        "scope": "Source reported calendar year and exact checked account dates",
        "complete_election_spending": False,
    }


def account(
    registration="-101", *, authority="mn_cfb", start="2026-01-01", end="2026-10-19"
):
    return {
        "registration_number": registration,
        "authority": authority,
        "period_start": start,
        "period_end": end,
    }


@pytest.fixture()
def outside_case(finance_db, spending):
    model = reads.R
    first = finance_db.get(model, (spending.independent.id, 1))
    defaults = {
        column.name: getattr(first, column.name) for column in model.__table__.columns
    }
    additions = [
        {"amount": Decimal("-1.2345"), "unpaid_amount": Decimal("-0.0001")},
        {"amount": Decimal("99999999999999.9999"), "unpaid_amount": Decimal("0")},
        {"year": None, "transaction_date": None, "amount": None, "unpaid_amount": None},
        {"year": None, "transaction_date": date(2026, 9, 30)},
        {"year": 2025, "transaction_date": date(2026, 10, 1), "for_against": "AGAINST"},
        {
            "transaction_date": date(2026, 1, 1),
            "for_against": "FOR",
            "spender_type": "PTU",
        },
        {
            "transaction_date": date(2026, 10, 19),
            "spender_type": "Unknown",
            "for_against": "?",
        },
        {"transaction_date": date(2026, 10, 20), "unpaid_amount": None},
        {"affected_committee_reg_num": "-202", "transaction_date": None},
        {"affected_committee_reg_num": "-202", "transaction_date": None, "year": None},
        {"affected_committee_reg_num": "-202", "transaction_date": date(2026, 10, 30)},
        {"affected_committee_reg_num": "unrelated", "amount": Decimal("999.9900")},
    ]
    for number, changes in enumerate(additions, 11):
        finance_db.add(model(**(defaults | {"row_number": number} | changes)))
    finance_db.flush()
    return SimpleNamespace(
        independent_expenditures=SimpleNamespace(snapshot_id=spending.independent.id)
    )


SCOPES = [
    [account()],
    [account(start="2026-10-01", end="2026-10-01")],
    [account(), account()],
    [account(), account(start="2026-09-01", end="2026-11-01")],
    [account(), account("-202", start="2026-09-01", end="2026-10-31")],
    [account(), account("-202", authority="local")],
    [account("-202", authority="fec")],
    [account("no-held-record")],
]


@pytest.mark.parametrize("accounts", SCOPES)
@pytest.mark.parametrize("year", [2025, 2026, 2027])
def test_outside_aggregates_match_complete_reference(
    finance_db, outside_case, accounts, year
):
    state = {"state": "checked", "accounts": accounts}
    assert reads._outside(finance_db, outside_case, year, state) == reference_outside(
        finance_db, outside_case, year, state
    )


def test_outside_exclusion_measures_keep_overlap_authorities_and_exact_decimals(
    finance_db, outside_case
):
    value = reads._outside(
        finance_db,
        outside_case,
        2026,
        {
            "state": "checked",
            "accounts": [account(), account("-202", authority="local")],
        },
    )
    assert len(outside._measure_columns()) == 10
    assert value["total"]["record_count"] > 0
    assert value["total"]["missing_amount_count"] == 1
    assert value["excluded_missing_year"]["missing_date_count"] == 2
    # Missing-date/year totals include target account IDs from other authorities;
    # attribution and outside-reviewed-period still use Board accounts only.
    assert value["excluded_missing_date"]["record_count"] == 2
    assert value["excluded_outside_reviewed_period"]["record_count"] == 2
    assert value["excluded_outside_reviewed_period"]["date_year_conflict_count"] == 1
    assert value["total"]["known_amount_subtotal"] == "100000000000038.7654"
    assert value["total"]["first_known_date"] == "2026-01-01"
    assert value["total"]["last_known_date"] == "2026-10-19"
    assert any(
        group["category"] == "other" and group["direction"] == "unknown"
        for group in value["groups"]
    )


@pytest.mark.parametrize(
    "release,state",
    [(None, "checked"), (object(), "no_confirmed_link"), (object(), "checked")],
)
def test_outside_missing_source_or_no_accounts_needs_no_query(release, state):
    def unexpected(*args, **kwargs):
        pytest.fail("An unavailable or unlinked candidate started outside queries")

    db = SimpleNamespace(execute=unexpected)
    scope = {"state": state, "accounts": []}
    assert reads._outside(db, release, 2026, scope) == reference_outside(
        db, release, 2026, scope
    )


def test_outside_uses_at_most_two_source_selects(finance_db, outside_case):
    statements = []

    def capture(conn, cursor, statement, parameters, context, many):
        if "FROM cf_independent_expenditure_row" in statement:
            statements.append(statement)

    connection = finance_db.connection()
    event.listen(connection, "before_cursor_execute", capture)
    try:
        value = reads._outside(
            finance_db,
            outside_case,
            2026,
            {"state": "checked", "accounts": [account()]},
        )
    finally:
        event.remove(connection, "before_cursor_execute", capture)
    assert value["groups"]
    assert len(statements) <= 2, (
        f"Candidate outside read scanned its source {len(statements)} times"
    )
