"""A race names its election only when exactly 1 held election lists its seat.

``GET /campaign-finance/races`` groups committees by the Board register's office and
district. The register holds no election type or date, so a contest's election comes
from held ballot records (``candidate_record``) of a held election
(``candidate_election``) in the year asked for, matched by the exact official ballot
title ("State Representative District 12A", "State Senator District 41"). Anything
else stays unnamed: no held ballot for the seat or year, more than 1 election, an
inexact title, or an office with no seat mapping. A date is never inferred from the
year.
"""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
from sqlalchemy import delete

from alethical.db import models
from alethical.tests.test_campaign_finance_races import (  # noqa: F401
    URL,
    _a_ballot_of_contests,
    db,
)

GENERAL_2026 = ("test-race-g26", "general", date(2026, 11, 3))
SPECIAL_2026 = ("test-race-s26", "special", date(2026, 2, 10))
GENERAL_2024 = ("test-race-g24", "general", date(2024, 11, 5))


@pytest.fixture()
def ballots(db):  # noqa: F811
    _a_ballot_of_contests(db)
    for election_id, stage, when in (GENERAL_2026, SPECIAL_2026, GENERAL_2024):
        db.add(
            models.CandidateElection(
                id=election_id,
                canonical_key=f"{election_id}-key",
                election_date=when,
                stage=stage,
                public_payload={"id": election_id, "date": when.isoformat()},
            )
        )
    records = [
        # House 12A: 2 candidates on 1 general ballot is still 1 election.
        (GENERAL_2026, "State Representative District 12A"),
        (GENERAL_2026, "State Representative District 12A"),
        # House 2B: a special and a general in the same year: no single election.
        (GENERAL_2026, "State Representative District 2B"),
        (SPECIAL_2026, "State Representative District 2B"),
        # Senate 41: only an inexact title this year, and an exact one in 2024.
        (GENERAL_2026, "State Senator District 041"),
        (GENERAL_2024, "State Senator District 41"),
        # Governor: a statewide office has no seat mapping here.
        (GENERAL_2026, "Governor & Lt Governor"),
    ]
    for number, ((election_id, _, when), office) in enumerate(records):
        db.add(
            models.CandidateRecord(
                id=f"test-race-record-{number}",
                election_id=election_id,
                election_date=when,
                public_payload={"office": office, "name": f"Candidate {number}"},
                source_sha256="0" * 64,
                checked_at=datetime(2026, 9, 1, tzinfo=UTC),
            )
        )
    db.commit()
    try:
        yield
    finally:
        db.rollback()
        db.execute(
            delete(models.CandidateRecord).where(
                models.CandidateRecord.id.like("test-race-record-%")
            )
        )
        db.execute(
            delete(models.CandidateElection).where(
                models.CandidateElection.id.like("test-race-%")
            )
        )
        db.commit()


def elections(client, year):
    response = client.get(URL, params={"year": year})
    assert response.status_code == 200, response.text
    return {
        contest["anchor"]: contest["election"]
        for contest in response.json()["data"]["contests"]
    }


def test_a_seat_on_exactly_1_held_ballot_names_that_election(client, ballots):
    assert elections(client, 2026)["house-12a"] == {
        "stage": "general",
        "date": "2026-11-03",
    }


def test_anything_but_exactly_1_exact_match_names_no_election(client, ballots):
    held = elections(client, 2026)
    # 2 elections list House 2B this year; neither is chosen.
    assert held["house-2b"] is None
    # Only an inexact title lists Senate 41 this year; the 2024 ballot is not used.
    assert held["senate-41"] is None
    # Only House and Senate seats name an election (the brief's legislative scope).
    assert all(
        election is None
        for anchor, election in held.items()
        if anchor.startswith("governor")
    )


def test_the_year_asked_for_decides_which_ballots_count(client, ballots):
    held = elections(client, 2024)
    assert held["senate-41"] == {"stage": "general", "date": "2024-11-05"}
    assert held["house-12a"] is None


def test_without_any_held_ballot_no_contest_names_an_election(client, db):  # noqa: F811
    _a_ballot_of_contests(db)
    assert set(elections(client, 2026).values()) == {None}
