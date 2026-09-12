"""Name lists page by filing year and read filer kinds from one held register."""

from datetime import date

import pytest
from sqlalchemy import text

from alethical.api.services.campaign_finance_payments import (
    independent_payments_to_vendor,
    payments_from_contributor,
    payments_to_vendor,
    payments_received,
)
from alethical.db import models
from alethical.tests.test_campaign_finance_lists_and_search import (
    db as _register_fixture,
    _register,
    _filer,
)
from alethical.tests.test_campaign_finance_payments import (
    Published,
    _receipt,
    _payment,
    _independent,
    _release,
    CANDIDATE,
    STATE_PARTY,
)


# Reuse the register-and-money cleanup fixture in the isolated test database.
db = _register_fixture


def test_payee_kinds_come_only_from_the_current_register(db):
    published = Published(db)
    old = _register(db)
    _filer(
        db,
        old,
        CANDIDATE,
        name="Older name",
        kind=models.CampaignFinanceFilerKind.party_unit,
    )
    held = _register(db)
    for registration, kind in [
        (CANDIDATE, "candidate_committee"),
        (STATE_PARTY, "party_unit"),
        ("41363", "political_committee_or_fund"),
    ]:
        _filer(
            db,
            held,
            registration,
            name="Held filer",
            kind=models.CampaignFinanceFilerKind(kind),
        )
        _payment(
            db, published.expenditures, reg_num=registration, vendor="Exact Vendor"
        )
        _independent(
            db, published.independent, spender_reg=registration, vendor="Exact Vendor"
        )
    _payment(db, published.expenditures, reg_num="999999", vendor="Exact Vendor")
    _independent(db, published.independent, spender_reg="999999", vendor="Exact Vendor")
    _independent(db, published.independent, spender_reg=None, vendor="Exact Vendor")
    db.commit()
    release = _release(db)
    vendor = payments_to_vendor(db, release, vendor="Exact Vendor")
    assert len(vendor.payments) == 4
    assert {p.committee_registration_number: p.filer_kind for p in vendor.payments} == {
        CANDIDATE: "candidate_committee",
        STATE_PARTY: "party_unit",
        "41363": "political_committee_or_fund",
        "999999": None,
    }
    independent = independent_payments_to_vendor(db, release, vendor="Exact Vendor")
    assert len(independent.payments) == 5
    assert {
        p.spender_registration_number: p.filer_kind for p in independent.payments
    } == {
        CANDIDATE: "candidate_committee",
        STATE_PARTY: "party_unit",
        "41363": "political_committee_or_fund",
        "999999": None,
        None: None,
    }
    assert payments_to_vendor(db, release, vendor="exact vendor").payments == ()


@pytest.mark.parametrize("role", ["contributor", "vendor", "independent_vendor"])
def test_name_paging_keeps_undated_and_mismatched_dates_inside_their_filing_year(
    db, role
):
    published = Published(db)
    if role == "contributor":
        snapshot = published.contributions
        table = "cf_contribution_row"
        date_column = "receipt_date"

        def add(year):
            return _receipt(db, snapshot, contributor="Same name", year=year)

        def read(offset):
            return payments_from_contributor(
                db, _release(db), contributor="Same name", limit=2, offset=offset
            )
    elif role == "vendor":
        snapshot = published.expenditures
        table = "cf_expenditure_row"
        date_column = "transaction_date"

        def add(year):
            return _payment(db, snapshot, vendor="Same name", year=year)

        def read(offset):
            return payments_to_vendor(
                db, _release(db), vendor="Same name", limit=2, offset=offset
            )
    else:
        snapshot = published.independent
        table = "cf_independent_expenditure_row"
        date_column = "transaction_date"

        def add(year):
            return _independent(db, snapshot, vendor="Same name", year=year)

        def read(offset):
            return independent_payments_to_vendor(
                db, _release(db), vendor="Same name", limit=2, offset=offset
            )

    recent = add(2026)
    undated = add(2026)
    old = add(2025)
    same = add(2025)
    db.execute(
        text(
            f"UPDATE {table} SET {date_column}=NULL WHERE snapshot_id=:s AND row_number=:r"
        ),
        {"s": snapshot.id, "r": undated},
    )
    db.execute(
        text(
            f"UPDATE {table} SET {date_column}=:day WHERE snapshot_id=:s AND row_number IN (:r,:r2)"
        ),
        {"s": snapshot.id, "r": old, "r2": same, "day": date(2027, 1, 1)},
    )
    db.commit()
    first = read(0)
    second = read(2)
    assert [p.record_number for p in first.payments] == [recent, undated]
    assert first.has_more is True
    assert [p.record_number for p in second.payments] == [same, old]
    assert second.has_more is False
    assert first.release_id == second.release_id
    if role == "contributor":
        # A committee's own existing list retains its date order.
        own = payments_received(
            db, _release(db), registration_number=CANDIDATE, limit=2
        )
        assert [p.record_number for p in own.payments] == [same, old]
