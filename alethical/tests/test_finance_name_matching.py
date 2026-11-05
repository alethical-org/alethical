"""Browsing name tolerance does not turn a partial name into an identity claim."""

# ruff: noqa: F811

import pytest
from sqlalchemy import literal, select

from alethical.api.services.finance_name_matching import (
    strong_spelling,
    closeness,
    discovery_match,
)
from alethical.tests.finance_fixtures import finance_db  # noqa: F401


@pytest.mark.parametrize(
    "candidate",
    [
        "Dantchik, Arthur",
        "Dantchick, Arthur",
        "Dantchik, Arthur Mr",
        "Arthur Danchik",
        "DANCHIK, ARTHUR",
    ],
)
def test_full_person_variants(candidate):
    assert strong_spelling("Danchik, Arthur", candidate, person=True)


@pytest.mark.parametrize(
    "candidate",
    [
        "Arndt, Arthur",
        "Arthur, Alan",
        "Arthur, Deborah",
        "Davis, Arthur",
        "Li, Arthur",
        "Danchik, Alan",
        "Danchik, Arthur Jr",
        "Danchik, Arthur A",
        "Danchik, Arther",
    ],
)
def test_other_people_and_incomplete_names_stay_separate(candidate):
    assert not strong_spelling("Danchik, Arthur", candidate, person=True)


def test_organizations_keep_meaningful_words_and_numbers():
    assert strong_spelling("Example Health Association", "Example Health Assn")
    assert strong_spelling("Example Media LLC", "Exmaple Media L.L.C.")
    assert not strong_spelling("Health Partners", "Wealth Partners")
    assert not strong_spelling("District 10 DFL", "District 11 DFL")
    assert not strong_spelling("Example Media", "Example Media Group")
    assert closeness("Danchik, Arthur", "Dantchik, Arthur") > closeness(
        "Danchik, Arthur", "Arndt, Arthur"
    )


@pytest.mark.parametrize(
    "query,name,expected",
    [
        ("danchik", "Dantchick, Arthur", True),
        ("david aafedt", "Aafedt, David M", True),
        ("health", "Wealth Partners", True),
        ("district 10", "District 11 DFL", False),
        ("joh", "Smith, John", True),
        ("joh", "Smith, Jim", False),
        ("unfindable", "Arthur Danchik", False),
    ],
)
def test_discovery_sql(finance_db, query, name, expected):
    assert finance_db.scalar(select(discovery_match(literal(name), query))) is expected


@pytest.mark.parametrize(
    "query,name",
    [
        ("Danchik", "Dantchick, Arthur"),
        ("arthur danchik", "Dantchik, Arthur Mr"),
        ("health", "Wealth Partners"),
        ("Example Health Association", "EXAMPLE HEALTH ASSN"),
        ("Example Media LLC", "Exmaple Media LLC"),
        ("Example Media LLC", "Example Media L.L.C."),
        ("18%", "18135 Committee"),
        ("District 10", "District 11 DFL"),
    ],
)
def test_index_candidates_keep_the_approved_matches(finance_db, query, name):
    from alethical.api.services.finance_name_matching import (
        configure_discovery,
        indexed_discovery_match,
        discovery_text,
    )

    configure_discovery(finance_db)
    assert finance_db.scalar(
        select(indexed_discovery_match(literal(name), query))
    ) is discovery_text(query, name)
