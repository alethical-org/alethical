"""Names browsing cannot drop filed subjects or confuse missing records with zero."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text

from alethical.api.services.outside_spending_names import outside_spending_names
from alethical.tests.test_outside_spending import (
    Published,
    _filer,
    _independent,
    _register,
    _release,
    db as outside_spending_db,
)

db = outside_spending_db
URL = "/api/v1/campaign-finance/outside-spending/names"


def test_pages_count_all_names_and_clamp_out_of_range_without_duplicate_payments(db):
    published = Published(db, published_rows=66)
    for number in range(26):
        _independent(
            db,
            published.independent,
            spender_reg=str(number + 1),
            spender=f"Group {number:02}",
        )
    for _ in range(40):
        _independent(db, published.independent, spender_reg="1", spender="Group 00")
    db.commit()
    release = _release(db)
    pages = [outside_spending_names(db, release, page_number=p) for p in (1, 2, 99)]
    assert [len(p["names"]) for p in pages] == [12, 12, 2]
    assert [p["page"]["number"] for p in pages] == [1, 2, 3]
    assert [p["page"]["has_more"] for p in pages] == [True, True, False]
    assert all(p["page"]["total_names"] == 26 for p in pages)
    assert [n["name"] for p in pages for n in p["names"]] == [
        f"Group {n:02}" for n in range(26)
    ]


def test_file_identity_latest_name_and_missing_identifiers_are_preserved(db):
    published = Published(db, published_rows=9)
    for reg, name in [
        ("10", "Old name"),
        ("10", "Newest name"),
        ("11", "Newest name"),
        (None, "10"),
        (None, "No number"),
        ("0", "No number"),
        ("", "No number"),
        ("-25", "Local candidate"),
        ("   ", "Whitespace number"),
    ]:
        _independent(db, published.independent, spender_reg=reg, spender=name)
    register = _register(db, filer_count=2)
    _filer(db, register, "10", name="Register spelling must not replace filed name")
    _filer(db, register, "999", name="Not named by any spending record")
    db.commit()
    names = outside_spending_names(db, _release(db))["names"]
    assert len(names) == 6
    assert {n["registration_number"] for n in names} == {"10", "11", "-25", None}
    assert [n["name"] for n in names] == [
        "10",
        "Local candidate",
        "Newest name",
        "Newest name",
        "No number",
        "Whitespace number",
    ]
    assert [n for n in names if n["in_register"]] == [
        {"name": "Newest name", "registration_number": "10", "in_register": True}
    ]


def test_search_is_name_only_case_insensitive_literal_and_counted_after_grouping(db):
    published = Published(db, published_rows=4)
    for reg, name in [
        ("1", "100%_ Group"),
        ("1", "100%_ Group"),
        ("2", "Other Group"),
        ("123456", "Percentless"),
    ]:
        _independent(db, published.independent, spender_reg=reg, spender=name)
    db.commit()
    release = _release(db)
    assert (
        outside_spending_names(db, release, query="  GROUP  ")["page"]["total_names"]
        == 2
    )
    result = outside_spending_names(db, release, query="%_", page_number=2)
    assert result["page"] == {
        "number": 1,
        "size": 12,
        "total_names": 1,
        "has_more": False,
    }
    assert result["names"][0]["name"] == "100%_ Group"
    unmatched = outside_spending_names(db, release, query="123456")
    assert unmatched["state"] == "reported"
    assert unmatched["page"]["total_names"] == 0


def test_years_cover_whole_source_and_committee_names_come_from_selected_period(db):
    published = Published(db, published_rows=3)
    for year, about, name in [
        (2015, "-1", "Older target"),
        (2025, "-2", "New target"),
        (2026, "-2", "Newer target"),
    ]:
        _independent(db, published.independent, about=about, about_name=name, year=year)
    db.commit()
    result = outside_spending_names(db, _release(db), browse="committees", year=2025)
    assert result["years"] == [2026, 2025, 2015]
    assert result["names"] == [
        {"name": "New target", "registration_number": "-2", "in_register": False}
    ]
    assert result["browse"] == "committees"


def test_blank_names_do_not_invent_subjects_or_claim_payments_are_absent(db):
    published = Published(db, published_rows=3)
    for name in [None, "", "   "]:
        _independent(db, published.independent, spender=name, about_name=name)
    db.commit()
    for browse in ["groups", "committees"]:
        result = outside_spending_names(db, _release(db), browse=browse)
        assert result["state"] == "reported"
        assert result["names"] == []
        assert result["page"]["total_names"] == 0


def test_snapshot_mismatch_and_pruned_rows_are_unavailable_without_counts(db):
    published = Published(db, published_rows=1)
    _independent(db, published.independent)
    db.commit()
    release = _release(db)
    mismatched = outside_spending_names(db, release, snapshot_id=uuid.uuid4())
    db.execute(text("DELETE FROM cf_independent_expenditure_row"))
    db.commit()
    pruned = outside_spending_names(db, release)
    for result in [mismatched, pruned]:
        assert result["state"] == "unavailable"
        assert result["page"]["total_names"] is None
        assert result["names"] == []
        assert result["years"] == []


def test_empty_source_and_uncovered_year_are_distinct(db):
    published = Published(db)
    release = _release(db)
    assert outside_spending_names(db, release)["state"] == "not_reported"
    _independent(db, published.independent, year=2025)
    db.commit()
    result = outside_spending_names(db, release, year=2024)
    assert result["state"] == "unavailable"
    assert result["years"] == [2025]
    assert result["page"]["total_names"] is None


def test_route_returns_names_and_source_copy_without_money_figures(client, db):
    published = Published(db, published_rows=1)
    _independent(db, published.independent, about="-44", about_name="Filed target")
    db.commit()
    response = client.get(
        URL,
        params={
            "browse": "committees",
            "q": "filed",
            "snapshot_id": str(published.independent.id),
        },
    )
    assert response.status_code == 200
    result = response.json()["data"]
    assert result["names"] == [
        {"name": "Filed target", "registration_number": "-44", "in_register": False}
    ]
    assert result["snapshot_id"] == str(published.independent.id)
    assert result["release_id"] == str(published.release.id)
    assert result["source_url"].startswith("https://cfb.mn.gov/")
    assert result["fetched_at"] is not None
    assert "figures" not in result
    assert response.headers["cache-control"] == "public, max-age=0, must-revalidate"
    assert response.headers["cloudflare-cdn-cache-control"].startswith(
        "public, max-age=300"
    )


@pytest.mark.parametrize(
    "params",
    [
        {"browse": "donors"},
        {"year": 2014},
        {"year": 2101},
        {"page": 0},
        {"q": "x" * 201},
        {"snapshot_id": "bad"},
    ],
)
def test_route_rejects_invalid_filters(client, params):
    assert client.get(URL, params=params).status_code == 422
