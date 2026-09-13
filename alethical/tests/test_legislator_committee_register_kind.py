"""The filer's kind rides on a legislator's confirmed committee (#2179).

The Board gives every registered filer its own page, keyed on the registration number
the card already prints, and the path segment in front of that number says which of
the register's 3 kinds the filer is. Without the kind the card can only link to the
**candidate** name search, which cannot contain a party unit or a political fund at
all. So the kind travels with the committee, and a number our copy of the filer list
does not carry serves ``None`` rather than a guess.

Uses the test runner's temporary PostgreSQL server.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text

from alethical.db import models
from alethical.db.session import get_session_factory
from alethical.tests.test_committee_page_reads import (
    CANDIDATE,
    FilerKind,
    Published,
    _clear,
    _confirm,
    _filer,
    _filings_snapshot,
    _receipt,
)


@pytest.fixture()
def db(seed_database):
    session = get_session_factory()()
    _clear(session)
    try:
        yield session
    finally:
        _clear(session)
        session.close()


def _confirmed_member(db, *, kind: FilerKind | None):
    published = Published(db)
    _receipt(db, published.contributions, reg_num=CANDIDATE, amount="250.00")
    db.commit()
    if kind is not None:
        snapshot = _filings_snapshot(db)
        _filer(db, snapshot, CANDIDATE, kind=kind)
    return _confirm(
        db,
        CANDIDATE,
        decision=models.CommitteeLinkReviewDecision.confirmed,
        basis={"office_as_reviewed": "House"},
    )


@pytest.mark.parametrize(
    "kind",
    [
        FilerKind.candidate_committee,
        FilerKind.party_unit,
        FilerKind.political_committee_or_fund,
    ],
)
def test_the_committee_carries_the_register_kind_it_is_listed_under(db, client, kind):
    member = _confirmed_member(db, kind=kind)

    response = client.get(
        f"/api/v1/legislators/{member[0]}/campaign-finance", params={"year": 2025}
    )

    assert response.status_code == 200, response.text
    committee = response.json()["data"]["committees"][0]
    assert committee["registration_number"] == CANDIDATE
    assert committee["register_kind"] == kind.value


def test_a_number_our_filer_list_does_not_carry_serves_no_kind(db, client):
    """Our gap, said as a gap. The card then links to the page listing all 3
    searches, rather than sending the reader into one the filer may not appear in."""
    member = _confirmed_member(db, kind=None)

    response = client.get(
        f"/api/v1/legislators/{member[0]}/campaign-finance", params={"year": 2025}
    )

    assert response.status_code == 200, response.text
    assert response.json()["data"]["committees"][0]["register_kind"] is None


def test_a_committee_with_no_money_row_still_carries_its_kind(db, client):
    """The confirmed link stays visible when the release holds no row for it, and the
    way out to the Board's own record has to stay usable in exactly that year."""
    Published(db)
    snapshot = _filings_snapshot(db)
    _filer(db, snapshot, CANDIDATE, kind=FilerKind.party_unit)
    member = _confirm(
        db,
        CANDIDATE,
        decision=models.CommitteeLinkReviewDecision.confirmed,
        basis={"office_as_reviewed": "House"},
    )
    db.execute(text("SELECT 1"))

    response = client.get(
        f"/api/v1/legislators/{member[0]}/campaign-finance", params={"year": 2025}
    )

    assert response.status_code == 200, response.text
    committee = response.json()["data"]["committees"][0]
    assert committee["register_kind"] == "party_unit"
