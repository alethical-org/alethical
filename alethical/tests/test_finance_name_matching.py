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
        "Danchik, Arthur Allen",
        "Dantchik, Arthur A",
        "Danchik, Arther",
    ],
)
def test_other_people_and_incomplete_names_stay_separate(candidate):
    assert not strong_spelling("Danchik, Arthur", candidate, person=True)


@pytest.mark.parametrize(
    ("left", "right", "grouped"),
    [
        ("Example, Linda M", "Example, Linda Marie", True),
        ("Example, Linda Marie", "Linda M Example", True),
        ("Example, Sarah A", "Example, Sarah Catherine", False),
        ("Example, Linda Marie", "Example, Linda Mary", False),
        ("Example, Linda", "Example, Linda Marie", False),
        ("Exampel, Linda M", "Example, Linda Marie", False),
    ],
)
def test_a_middle_initial_matches_only_its_own_full_middle_name(left, right, grouped):
    assert strong_spelling(left, right, person=True) is grouped
    assert strong_spelling(right, left, person=True) is grouped


def test_spelling_groups_never_use_nicknames_or_drop_words():
    assert not strong_spelling("Example, Tom", "Example, Thomas", person=True)
    assert not strong_spelling("Example Fund", "Example Fund (New)")


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
        ("zack stephenson", "Stephenson, Zachary House Committee", True),
        ("zachary stephenson", "Zack Stephenson", True),
        ("william example", "Billings Example", False),
        ("maría pérez-vega", "Perez-Vega, Maria House Committee", True),
        ("mark w. koran", "Koran, Mark Senate Committee", True),
        ("mark w koran", "Smith, Mark W", False),
        ("isa pérez-vega", "Perez-Vega, Maria", False),
        ("maría isa pérez-vega", "Perez-Vega, Maria House Committee", False),
        ("smith, john a", "Smith, Paul", False),
        ("john a smith", "Smith, Paul", False),
        ("senate district 26 dfl", "Senate District 63 DFL", False),
        ("teamsters local 120 pac", "Teamsters Local 320 PAC", False),
        ("minnesota medical association", "Minnesota Nurses Association", False),
        ("jo a li", "Li, Jo", False),
        ("john d'amico smith", "John Amico Smith", False),
        ("mary ann o'brien", "Brien, Mary Ann", False),
        ("mary ann k smith", "Smith, Mary Ann", True),
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
        ("Zack Stephenson", "Stephenson, Zachary House Committee"),
        ("William Example", "Billings Example"),
        ("María Pérez-Vega", "Perez-Vega, Maria House Committee"),
        ("Mark W. Koran", "Koran, Mark Senate Committee"),
        ("Mark W Koran", "Smith, Mark W"),
        ("Smith, John A", "Smith, Paul"),
        ("Senate District 26 DFL", "Senate District 63 DFL"),
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


@pytest.mark.parametrize(
    "query", ["danch", "smith", "arthur", "health", "aaaaa", "école", "straße"]
)
def test_short_word_index_candidates_preserve_every_single_edit(finance_db, query):
    """Index candidates cannot lose an eligible insertion, deletion, swap or substitution."""
    from sqlalchemy import Text, column, values
    from alethical.api.services.finance_name_matching import indexed_discovery_match

    candidates = {query, query.upper(), "unrelated name", "District 10", "Assn", "Corp"}
    for index in range(len(query)):
        candidates.add(query[:index] + query[index + 1 :])
        for char in "abcdefghijklmnopqrstuvwxyzé012":
            candidates.add(query[:index] + char + query[index + 1 :])
        if index + 1 < len(query):
            candidates.add(
                query[:index] + query[index + 1] + query[index] + query[index + 2 :]
            )
    for index in range(len(query) + 1):
        for char in "abcdefghijklmnopqrstuvwxyzé012":
            candidates.add(query[:index] + char + query[index:])
    names = values(column("name", Text), name="names").data(
        [
            (name,)
            for candidate in sorted(candidates)
            for name in (
                candidate,
                f"Example {candidate}, LLC",
                f"EXAMPLE_{candidate}_LLC",
            )
        ]
    )
    disagreements = finance_db.execute(
        select(names.c.name).where(
            indexed_discovery_match(names.c.name, query)
            != discovery_match(names.c.name, query)
        )
    ).all()
    assert disagreements == []
