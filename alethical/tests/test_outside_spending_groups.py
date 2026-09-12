"""A spender list preserves every payment for exactly one committee and year."""

from decimal import Decimal

import pytest

from alethical.api.services.outside_spending import outside_spending
from alethical.tests.test_outside_spending import (
    CAUCUS,
    CANDIDATE,
    FUND,
    OTHER_CANDIDATE,
    Published,
    URL,
    _independent,
    _receipt,
    _release,
    db as outside_spending_db,
)


db = outside_spending_db


def test_all_groups_and_direction_figures_equal_all_underlying_rows(db):
    published = Published(db, published_rows=70)
    snap = published.independent
    # More rows than one raw page; duplicate amounts and dates are real payments.
    for _ in range(60):
        _independent(db, snap, amount="1.25")
    _independent(db, snap, spender="A later filed spelling", amount="2.50")
    _independent(db, snap, direction="against", amount="9")
    _independent(
        db, snap, spender_reg=CAUCUS, spender="A later filed spelling", amount="8"
    )
    _independent(db, snap, spender_reg=None, spender="Exact Name", amount="4")
    _independent(db, snap, spender_reg="0", spender="Exact Name", amount="5")
    _independent(db, snap, spender_reg="", spender="exact name", amount="6")
    # Numeric names must never become a registration key by accident.
    _independent(db, snap, spender_reg=None, spender=FUND, amount="7")
    _independent(db, snap, direction="", amount="3")
    _independent(db, snap, direction="unknown", amount="2")
    _independent(db, snap, amount="9999", about=OTHER_CANDIDATE)
    _independent(db, snap, amount="8888", year=2024)
    _receipt(db, published.contributions, reg_num=FUND, name="Education Minn PAC")
    db.commit()
    release = _release(db)
    grouped = outside_spending(
        db, release, about=CANDIDATE, year=2025, group_by_spender=True
    )
    first = outside_spending(db, release, about=CANDIDATE, year=2025)
    second = outside_spending(db, release, about=CANDIDATE, year=2025, page_number=2)
    raw_rows = first.rows + second.rows
    assert grouped.state == "reported"
    assert grouped.about.registration_number == CANDIDATE
    assert grouped.year == 2025
    assert grouped.rows == ()
    assert len(grouped.groups) == 7
    assert sum(group.row_count for group in grouped.groups) == len(raw_rows) == 69
    assert sum(group.amount for group in grouped.groups) == sum(
        row.amount for row in raw_rows
    )
    assert (
        grouped.figures.amount_total == first.figures.amount_total == Decimal("121.5")
    )
    groups = {
        (g.spender_registration_number, g.spender, g.direction): g
        for g in grouped.groups
    }
    supporting = groups[(FUND, "A later filed spelling", "For")]
    assert supporting.amount == Decimal("77.5")
    assert supporting.row_count == 61
    assert supporting.spender_linkable is True
    assert supporting.grouping_basis == "registration_number"
    unnamed = groups[(None, "Exact Name", "For")]
    assert unnamed.amount == Decimal("9") and unnamed.row_count == 2
    assert unnamed.grouping_basis == "exact_name" and unnamed.spender_linkable is False
    assert groups[(CAUCUS, "A later filed spelling", "For")].spender_linkable is False
    assert grouped.figures.supporting_spender_count == 5
    assert grouped.figures.opposing_spender_count == 1
    assert grouped.figures.direction_not_recorded_spender_count == 1
    assert grouped.figures.spender_count == 5
    for direction, amount, count in (
        ("For", grouped.figures.supporting_amount, grouped.figures.supporting_count),
        ("Against", grouped.figures.opposing_amount, grouped.figures.opposing_count),
        (
            "not recorded",
            grouped.figures.direction_not_recorded_amount,
            grouped.figures.direction_not_recorded_count,
        ),
    ):
        matching = [group for group in grouped.groups if group.direction == direction]
        assert sum(group.amount for group in matching) == amount
        assert sum(group.row_count for group in matching) == count
    assert [group.amount for group in grouped.groups] == sorted(
        [group.amount for group in grouped.groups], reverse=True
    )


def test_a_missing_amount_withholds_its_group_total_and_all_direction_figures(db):
    published = Published(db, published_rows=3)
    _independent(db, published.independent, amount="5")
    _independent(db, published.independent, amount=None)
    _independent(db, published.independent, direction="Against", amount="2")
    db.commit()
    page = outside_spending(
        db, _release(db), about=CANDIDATE, year=2025, group_by_spender=True
    )
    assert page.figures.amount_total is None
    assert page.figures.supporting_amount is None
    assert page.figures.opposing_amount is None
    assert page.figures.direction_not_recorded_amount is None
    assert page.figures.supporting_spender_count == 1
    assert page.groups[-1].amount is None and page.groups[-1].row_count == 2
    assert page.groups[0].amount == Decimal("2")


def test_grouped_route_has_one_list_and_raw_route_keeps_its_existing_shape(client, db):
    published = Published(db, published_rows=2)
    _independent(db, published.independent, amount="2")
    _independent(db, published.independent, amount="3")
    db.commit()
    params = {"about": CANDIDATE, "year": 2025}
    raw = client.get(URL, params=params).json()["data"]
    response = client.get(URL, params={**params, "group_by": "spender"})
    assert response.status_code == 200
    grouped = response.json()["data"]
    assert "groups" not in raw and "group_by" not in raw
    assert "supporting_spender_count" not in raw["figures"]
    assert "rows" not in grouped and "page" not in grouped
    assert grouped["group_by"] == "spender" and grouped["sort"] == "largest"
    assert grouped["about"]["registration_number"] == CANDIDATE
    assert grouped["groups"] == [
        {
            "spender": "Education Minn PAC",
            "spender_registration_number": FUND,
            "spender_linkable": False,
            "direction": "For",
            "amount": "5.0000",
            "row_count": 2,
            "grouping_basis": "registration_number",
        }
    ]
    assert grouped["figures"]["supporting_spender_count"] == 1
    # A silent year remains silence, not a checked zero or an invented money total.
    empty = client.get(
        URL, params={**params, "year": 2024, "group_by": "spender"}
    ).json()["data"]
    assert empty["groups"] == [] and empty["figures"] is None
    assert empty["state"] != "reported"


@pytest.mark.parametrize("params", [{}, {"year": 2025}, {"about": CANDIDATE}])
def test_grouping_requires_one_about_committee_and_one_year(client, params):
    response = client.get(URL, params={**params, "group_by": "spender"})
    assert response.status_code == 422
