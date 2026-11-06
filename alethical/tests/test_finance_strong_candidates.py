"""Strong spelling eligibility cannot be cut off by candidate retrieval."""

# ruff: noqa: F811
import pytest
from sqlalchemy import column, select, values, String

from alethical.api.services.finance_name_matching import (
    strong_candidates,
    configure_discovery,
    indexed_discovery_match,
    strong_spelling,
)
from alethical.api.services import tv_ads as reader
from alethical.db.session import get_db
from alethical.tests.finance_fixtures import finance_api, finance_db  # noqa: F401
from alethical.tests.test_finance_similar_names import board, add_names  # noqa: F401
from alethical.tests.test_finance_similar_agencies import (  # noqa: F401
    names,
    held,
    listed,
    source,
    page_count,
)


def edits(word):
    result = {word[:i] + word[i + 1 :] for i in range(len(word))}
    result |= {
        word[:i] + char + word[i + 1 :] for i in range(len(word)) for char in "xyz"
    }
    result |= {
        word[:i] + char + word[i:] for i in range(len(word) + 1) for char in "xyz"
    }
    result |= {
        word[:i] + word[i + 1] + word[i] + word[i + 2 :] for i in range(len(word) - 1)
    }
    return result


@pytest.mark.parametrize("query", ["Target", "Tesla", "Abcdefg", "Abcdefghi"])
def test_candidate_predicate_keeps_every_accepted_bounded_edit(finance_db, query):
    candidates = edits(query)
    candidates |= {change for word in list(candidates) for change in edits(word)}
    accepted = {name for name in candidates if strong_spelling(query, name)}
    rows = (
        values(column("name", String), name="source_names")
        .data([(name,) for name in accepted])
        .alias("source_names")
    )
    assert len(accepted) > 10
    selected = set(
        finance_db.scalars(
            select(rows.c.name).where(strong_candidates(rows.c.name, query))
        )
    )
    assert selected == accepted
    configure_discovery(finance_db)
    discovered = set(
        finance_db.scalars(
            select(rows.c.name).where(indexed_discovery_match(rows.c.name, query))
        )
    )
    assert discovered == accepted


@pytest.mark.parametrize(
    "query,candidate,person",
    [
        ("Limited", "Ltd", False),
        ("Limietd", "Ltd", False),
        ("Example Media LLC", "Exmaple_Media L.L.C.", False),
        ("MEDIA", "ＭＥＤＩＡ", False),
        ("Gross", "Groß", False),
        ("Danchik, Arthur", "Arthur Dantchick", True),
        ("Danchik, Arthur", "Dantchik, Arthur Mr", True),
    ],
)
def test_candidate_retrieval_covers_normalization(finance_db, query, candidate, person):
    assert strong_spelling(query, candidate, person=person)
    rows = (
        values(column("name", String), name="source_names")
        .data([(candidate,)])
        .alias("source_names")
    )
    assert (
        finance_db.scalar(
            select(rows.c.name).where(
                strong_candidates(rows.c.name, query, person=person)
            )
        )
        == candidate
    )


@pytest.mark.parametrize(
    "query,variant", [("Target", "Tagret"), ("Tesla", "Tesal"), ("Abcdefg", "Abxdehg")]
)
def test_payment_strong_read_retrieves_below_trigram_cutoff(
    finance_api, finance_db, board, query, variant
):
    add_names(finance_db, board, "payee", [query, variant, "Unrelated"])
    finance_api.app.dependency_overrides[get_db]().connection()
    response = finance_api.get(
        "/api/v1/finance/name-spellings",
        params={"name": query, "role": "payee", "filer": "not-held"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["data"]["names"] == []
    response = finance_api.get(
        "/api/v1/finance/name-spellings", params={"name": query, "role": "payee"}
    )
    assert response.status_code == 200, response.text
    assert response.json()["data"]["names"] == [variant]


def test_agency_strong_read_uses_full_catalogue_and_one_projection(
    finance_api, finance_db, held, monkeypatch
):
    names(finance_db, held, ["Abcdefg", "Abxdehg", "Abcdfeg", "Unrelated"])
    original = reader._documents
    projections = []

    def documents(*args, **kwargs):
        projections.append(True)
        return original(*args, **kwargs)

    monkeypatch.setattr(reader, "_documents", documents)
    finance_api.app.dependency_overrides[get_db]().connection()
    response = finance_api.get(
        "/api/v1/finance/media-buys/agencies/"
        + reader.agency_key("Abcdefg")
        + "/spellings"
    )
    assert response.status_code == 200, response.text
    assert [row["name"] for row in response.json()["data"]["spellings"]] == [
        "Abcdfeg",
        "Abxdehg",
    ]
    assert len(projections) == 1


@pytest.mark.parametrize(
    "word", ["target", "abcde", "abcdefg", "abcdefghi", "johnson", "person", "aaaaaba"]
)
def test_optimized_sql_distance_keeps_the_python_decision(finance_db, word):
    from sqlalchemy import func
    from alethical.api.services.finance_name_matching import (
        _word_typo,
        _edit_candidate_word,
    )

    candidates = edits(word)
    candidates |= {change for value in list(candidates) for change in edits(value)}
    candidates |= {"jhonson", "dantchick", "abxdehg", "zzzzzzzz", "12target", "aaabaaa"}
    source = (
        values(column("name", String), name="variants")
        .data([(name,) for name in candidates])
        .alias("variants")
    )
    results = dict(
        finance_db.execute(
            select(source.c.name, func.finance_word_spelling(source.c.name, word))
        ).all()
    )
    expected = {name: _word_typo(name, word) for name in candidates}
    assert results == expected
    selected = set(
        finance_db.scalars(
            select(source.c.name).where(_edit_candidate_word(source.c.name, word))
        )
    )
    accepted = {name for name, matched in expected.items() if matched}
    assert accepted <= selected
    configure_discovery(finance_db)
    discovered = set(
        finance_db.scalars(
            select(source.c.name).where(indexed_discovery_match(source.c.name, word))
        )
    )
    assert accepted <= discovered


@pytest.mark.parametrize("query", ["Limited", "Limietd"])
def test_discovery_keeps_typo_of_expanded_abbreviation(finance_db, query):
    configure_discovery(finance_db)
    source = (
        values(column("name", String), name="names").data([("Ltd",)]).alias("names")
    )
    assert (
        finance_db.scalar(
            select(source.c.name).where(indexed_discovery_match(source.c.name, query))
        )
        == "Ltd"
    )
