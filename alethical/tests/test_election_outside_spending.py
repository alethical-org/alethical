"""Source-wide spending stays complete, versioned, and honestly scoped."""

# ruff: noqa: F811
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import delete

from alethical.api.services import finance_access
from alethical.api.services.election_outside_spending import SOURCE_COLUMNS
from alethical.db import models as m
from alethical.tests.finance_fixtures import (
    FINANCE_EMAIL,
    finance_api,  # noqa: F401
    finance_db,  # noqa: F401
)
from alethical.tests.test_committee_finance import Published
from alethical.tests.test_election_comparison_reads import KEY, _current, _snapshot

BASE = f"/api/v1/finance/elections/{KEY}/outside-spending"
R = m.CampaignFinanceIndependentExpenditureRow


@pytest.fixture()
def spending(finance_db):
    _snapshot(finance_db)
    _current(finance_db)
    publication = Published(finance_db)
    defaults = dict(
        spender="Example fund",
        spender_reg_num="40001",
        spender_type="PCF",
        spender_sub_type="Political fund",
        affected_committee_name="As filed",
        affected_committee_reg_num="-101",
        for_against="For",
        year=2026,
        transaction_date=date(2026, 10, 1),
        type="Independent expenditure",
        amount=Decimal("10"),
        unpaid_amount=Decimal("3"),
        in_kind="No",
        in_kind_descr=None,
        purpose="Mail",
        vendor_name="Printer",
        vendor_city="St Paul",
        vendor_state="MN",
        vendor_zip="55101",
    )
    changes = [
        {},
        {},  # Identical rows are separate, legitimate source records.
        dict(
            spender_type="PTU",
            spender_sub_type="Party unit",
            amount=Decimal("20"),
            unpaid_amount=Decimal("0"),
            for_against="Against",
            affected_committee_reg_num="",
        ),
        dict(
            spender_type="OTH",
            spender_sub_type="Other filed type",
            amount=Decimal("5"),
            for_against="Unclear",
            affected_committee_reg_num=None,
        ),
        dict(year=2025, amount=Decimal("99")),
        dict(year=None, amount=Decimal("7")),
        dict(transaction_date=None, amount=Decimal("4")),
        dict(
            spender_type=None,
            spender_sub_type=None,
            amount=None,
            unpaid_amount=None,
            for_against=None,
        ),
        dict(amount=Decimal("0"), spender_reg_num="zero", unpaid_amount=Decimal("0")),
        dict(amount=Decimal("2"), transaction_date=date(2025, 12, 31)),
    ]
    for number, change in enumerate(changes, 1):
        finance_db.add(
            R(
                snapshot_id=publication.independent.id,
                row_number=number,
                **(defaults | change),
            )
        )
    publication.independent.row_count = len(changes)
    finance_db.commit()
    return publication


def _data(client, **params):
    response = client.get(BASE, params=params)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _page(client, context, **params):
    return client.get(
        f"{BASE}/records",
        params={
            "version": context["version"],
            "release_id": context["release_id"],
            **params,
        },
    )


def test_retained_csv_download_checks_bytes_scope_and_access(
    finance_api, finance_db, spending, monkeypatch
):
    import gzip
    import hashlib
    from alethical.api.services import election_outside_spending as reads
    from alethical.tests.test_election_comparison_storage import MemoryStore

    store = MemoryStore()
    body = b'Spender,Amount\r\n"A, B",10.00\r\n'
    compressed = gzip.compress(body, mtime=0)
    original = spending.independent
    original.content_hash = hashlib.sha256(body).hexdigest()
    original.byte_size = len(body)
    key = "retained/independent.csv.gz"
    store.objects[key] = compressed
    retained = m.CampaignFinanceSnapshotBody(
        snapshot_id=original.id,
        object_key=key,
        compression="gzip",
        compressed_hash=hashlib.sha256(compressed).hexdigest(),
        compressed_byte_size=len(compressed),
    )
    finance_db.add(retained)
    finance_db.commit()
    monkeypatch.setattr(reads, "raw_file_store_from_env", lambda: store)
    context = _data(finance_api)
    params = {
        "election_snapshot_id": context["election_snapshot_id"],
        "version": context["version"],
        "release_id": context["release_id"],
    }
    response = finance_api.get(BASE + "/source", params=params)
    assert response.status_code == 200
    assert response.content == body
    assert "private" in response.headers["cache-control"]
    assert response.headers["x-content-type-options"] == "nosniff"
    assert (
        finance_api.get(
            BASE + "/source", params=params, headers={"Authorization": ""}
        ).status_code
        == 401
    )
    assert (
        finance_api.get(
            BASE + "/source", params={**params, "version": "0" * 16}
        ).status_code
        == 409
    )
    assert (
        finance_api.get(
            BASE + "/source", params={**params, "source_hash": original.content_hash}
        ).content
        == body
    )
    assert (
        finance_api.get(
            BASE + "/source", params={**params, "source_hash": "0" * 64}
        ).status_code
        == 409
    )
    assert (
        finance_api.get(
            BASE + "/source", params={**params, "source_hash": "bad"}
        ).status_code
        == 422
    )
    store.objects[key] = b"corrupt"
    assert finance_api.get(BASE + "/source", params=params).status_code == 503
    store.objects[key] = gzip.compress(body + b"changed", mtime=0)
    retained.compressed_hash = hashlib.sha256(store.objects[key]).hexdigest()
    retained.compressed_byte_size = len(store.objects[key])
    finance_db.commit()
    assert finance_api.get(BASE + "/source", params=params).status_code == 503
    finance_db.delete(retained)
    finance_db.commit()
    assert finance_api.get(BASE + "/source", params=params).status_code == 503


def test_inventory_partitions_years_and_keeps_missing_amounts(finance_api, spending):
    data = _data(finance_api)
    inventory = data["inventory"]
    assert inventory["all_source_records"]["record_count"] == 10
    assert inventory["reported_year"]["record_count"] == 8
    assert inventory["missing_year"]["record_count"] == 1
    assert inventory["other_years"]["record_count"] == 1
    assert inventory["reported_year"]["amount"] is None
    assert inventory["reported_year"]["known_amount_subtotal"] == "51.0000"
    assert inventory["reported_year"]["missing_amount_count"] == 1
    assert inventory["reported_year"]["date_year_conflict_count"] == 1
    assert inventory["reported_year"]["missing_date_count"] == 1
    assert inventory["reported_year"]["date_coverage"] == "incomplete"
    assert inventory["reported_year"]["first_known_date"] == "2025-12-31"
    assert inventory["reported_year"]["last_known_date"] == "2026-10-01"
    assert inventory["all_source_records"]["known_amount_subtotal"] == "157.0000"
    assert data["reported_year"] == 2026
    assert data["year_basis"] == "source_reported_calendar_year"
    assert data["election_stage_available"] is False
    assert data["complete_election_spending"] is False
    assert data["source"]["copied_at"] == "2026-08-12T02:54:00+00:00"
    assert data["source"]["content_hash"] == spending.independent.content_hash


def test_filer_groups_do_not_add_unpaid_twice_or_guess_direction(finance_api, spending):
    data = _data(finance_api)
    groups = {(g["category"], g["direction"]): g for g in data["category_totals"]}
    assert groups[("PCF", "For")]["amount"] == "26.0000"
    assert groups[("PCF", "For")]["record_count"] == 5
    assert groups[("PCF", "For")]["included_unpaid_amount"] == "12.0000"
    assert groups[("PTU", "Against")]["amount"] == "20.0000"
    assert groups[("other", "unknown")]["amount"] is None
    assert groups[("other", "unknown")]["known_amount_subtotal"] == "5.0000"
    assert {g["spender_type"] for g in data["groups"]} == {"PCF", "PTU", "OTH", None}
    assert {g["spender_sub_type"] for g in data["groups"]} == {
        "Political fund",
        "Party unit",
        "Other filed type",
        None,
    }


def test_every_source_column_duplicates_and_absent_targets_survive(
    finance_api, spending
):
    context = _data(finance_api)
    response = _page(finance_api, context, limit=2)
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["page"] == dict(total=8, offset=0, limit=2, has_more=True)
    assert [row["row_number"] for row in data["rows"]] == [1, 2]
    assert data["rows"][0]["fields"] == data["rows"][1]["fields"]
    assert set(data["rows"][0]["fields"]) == set(SOURCE_COLUMNS)
    assert data["rows"][0]["fields"]["Affected Cmte Reg Num"] == "-101"
    assert data["rows"][0]["fields"]["Amount"] == "10.0000"
    assert all(row["resolution"] == "not_attributed" for row in data["rows"])
    next_page = _page(finance_api, context, limit=2, offset=2).json()["data"]
    assert [row["row_number"] for row in next_page["rows"]] == [3, 4]
    assert [row["fields"]["Affected Cmte Reg Num"] for row in next_page["rows"]] == [
        "",
        None,
    ]
    assert next_page["source"] == context["source"]


@pytest.mark.parametrize(
    "params, expected",
    [
        ({"spender_type": "PTU", "direction": "Against"}, 1),
        ({"spender_type": "other", "direction": "unknown"}, 2),
        ({"target_registration": ""}, 1),
        ({"target_registration": "-101"}, 6),
        ({"spender_registration": "x' OR 1=1 --"}, 0),
        ({"spender_registration": "%"}, 0),
    ],
)
def test_filters_use_literal_filed_values(finance_api, spending, params, expected):
    context = _data(finance_api, **params)
    assert context["filtered_total"]["record_count"] == expected
    response = _page(finance_api, context, **params)
    assert response.json()["data"]["page"]["total"] == expected
    if expected == 0:
        assert context["filtered_total"]["amount"] is None
        assert context["filtered_total"]["state"] == "no_records"


def test_zero_is_reported_only_when_a_source_row_says_zero(finance_api, spending):
    total = _data(finance_api, spender_registration="zero")["filtered_total"]
    assert total["amount"] == "0.0000"
    assert total["state"] == "reported"


def test_missing_year_is_separate_even_with_a_date(finance_api, spending):
    context = _data(finance_api)
    data = _page(finance_api, context, scope="missing_year").json()["data"]
    assert data["page"]["total"] == 1
    assert data["rows"][0]["row_number"] == 6
    assert data["rows"][0]["fields"]["Year"] is None
    assert data["rows"][0]["fields"]["Date"] == "2026-10-01"


def test_release_change_requires_restart(finance_api, finance_db, spending):
    old = _data(finance_api)
    Published(finance_db)
    assert _page(finance_api, old).status_code == 409
    new = _data(finance_api)
    assert new["version"] != old["version"]
    assert _page(finance_api, new, release_id=old["release_id"]).status_code == 409
    assert new["filtered_total"]["state"] == "no_records"
    assert new["filtered_total"]["amount"] is None


@pytest.mark.parametrize("all_rows", [False, True])
def test_pruned_source_never_becomes_zero(finance_api, finance_db, spending, all_rows):
    context = _data(finance_api)
    statement = delete(R).where(R.snapshot_id == spending.independent.id)
    if not all_rows:
        statement = statement.where(R.row_number == 1)
    finance_db.execute(statement)
    finance_db.commit()
    assert finance_api.get(BASE).status_code == 503
    assert _page(finance_api, context).status_code == 503


def test_only_published_elections_are_visible(finance_api, finance_db, spending):
    election = finance_db.get(m.ElectionComparisonSnapshot, "a" * 64)
    election.first_published_at = None
    finance_db.commit()
    assert finance_api.get(BASE).status_code == 404


def test_authentication_and_private_cache(finance_api, spending):
    context = _data(finance_api)
    for path, params in (
        (BASE, {}),
        (
            f"{BASE}/records",
            {
                "version": context["version"],
                "release_id": context["release_id"],
            },
        ),
    ):
        result = finance_api.get(path, params=params)
        assert "private" in result.headers["cache-control"]
        assert "no-store" in result.headers["cache-control"]
        result = finance_api.get(path, params=params, headers={"Authorization": ""})
        assert result.status_code == 401


def test_unlisted_account_cannot_read_spending(finance_api, finance_db, spending):
    context = _data(finance_api)
    finance_access.revoke(finance_db, FINANCE_EMAIL)
    finance_db.commit()
    assert finance_api.get(BASE).status_code == 403
    assert _page(finance_api, context).status_code == 403


def test_absent_release_is_unavailable_not_zero(finance_api, finance_db, spending):
    finance_db.get(m.CampaignFinanceCurrentRelease, True).release_id = None
    finance_db.commit()
    assert finance_api.get(BASE).status_code == 503


@pytest.mark.parametrize(
    "params", [{}, {"limit": 101}, {"offset": -1}, {"direction": "maybe"}]
)
def test_records_require_version_and_bounded_inputs(finance_api, spending, params):
    context = _data(finance_api)
    response = (
        finance_api.get(f"{BASE}/records")
        if not params
        else _page(finance_api, context, **params)
    )
    assert response.status_code == 422
