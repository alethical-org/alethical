"""Agency suggestions keep each held spelling and its own file checks."""

# ruff: noqa: F811
from sqlalchemy import select

from alethical.api.services import tv_ads as reader
from alethical.db import models as m
from alethical.db.session import get_db
from alethical.pipeline.fcc_document_text import EXTRACTOR_VERSION
from alethical.tests.finance_fixtures import finance_api, finance_db  # noqa: F401
from alethical.tests.test_finance_media_buys import (  # noqa: F401
    held,
    listed,
    source,
    page_count,
    problems,
)

BASE = "/api/v1/finance/media-buys/agencies/"


def test_strong_agency_spellings_keep_exact_versions_and_checks(
    finance_api, finance_db, held
):
    names(finance_db, held, ["Exmaple Media", "Unrelated business"])
    key = reader.agency_key("Example Media")
    exact = finance_api.get(BASE + key).json()["data"]
    response = finance_api.get(
        BASE + key + "/spellings", params={"version": exact["version"]}
    )
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert [item["name"] for item in data["spellings"]] == ["Exmaple Media"]
    variant = data["spellings"][0]
    assert variant["groups"][0]["files"][0]["agency_unchecked"] is True
    assert variant["addresses"] == []
    assert [row["label"] for row in read(finance_api)["rows"]] == ["Exmaple Media"]
    assert (
        read(finance_api, exclude_key=[reader.agency_key("Exmaple Media")])["rows"]
        == []
    )


def test_displayed_agency_exclusions_apply_before_every_page(
    finance_api, finance_db, held
):
    variants = ["Exmaple Media", "EXAMPLE MEDIA", "Example Meedia"]
    names(finance_db, held, variants)
    excluded = reader.agency_key(variants[0])
    result = read(finance_api, exclude_key=[excluded], limit=1)
    found = []
    while True:
        assert result["excluded_keys"] == [excluded]
        found.extend(row["label"] for row in result["rows"])
        if not result["has_more"]:
            break
        result = read(
            finance_api,
            exclude_key=[excluded],
            limit=1,
            offset=len(found),
            version=result["version"],
        )
    assert variants[0] not in found
    assert set(variants[1:]) <= set(found)
    assert len(found) == len(set(found))


def names(db, held, values):
    extraction = db.scalar(
        select(m.FCCExtraction).where(
            m.FCCExtraction.content_hash == held["document"].content_hash,
            m.FCCExtraction.version == EXTRACTOR_VERSION,
        )
    )
    extraction.facts = [
        *extraction.facts,
        *({"field": "agency_name", "value": name, "page": 1} for name in values),
    ]
    db.commit()


def read(api, name="Example Media", status=200, **params):
    api.app.dependency_overrides[get_db]().connection()
    if params.get("exclude_key") and "version" not in params:
        initial = api.get(BASE + reader.agency_key(name) + "/similar-names").json()[
            "data"
        ]
        params["version"] = initial["version"]
    response = api.get(BASE + reader.agency_key(name) + "/similar-names", params=params)
    assert response.status_code == status, response.text
    return response.json().get("data")


def test_agency_typos_are_exact_distinct_names_with_own_evidence(
    finance_api, finance_db, held
):
    names(
        finance_db,
        held,
        ["Exmaple Media", "Example Media LLC", " Example Media ", "Unrelated business"],
    )
    data = read(finance_api)
    assert [x["label"] for x in data["rows"]] == [
        " Example Media ",
        "Exmaple Media",
        "Example Media LLC",
    ]
    for row in data["rows"]:
        assert row == {
            "key": reader.agency_key(row["label"]),
            "label": row["label"],
            "file_count": 1,
            "stations": ["KSTP-TV"],
            "unchecked": True,
            "checked_on": None,
        }
    assert problems(data) == []
    assert not data["has_more"]


def test_agency_paging_is_closest_first_and_excludes_exact_input(
    finance_api, finance_db, held
):
    expected = ["EXAMPLE MEDIA", "Exmaple Media", "Example Media LLC"]
    names(finance_db, held, expected)
    first = read(finance_api, limit=1)
    second = read(finance_api, limit=1, offset=1, version=first["version"])
    third = read(finance_api, limit=1, offset=2, version=first["version"])
    assert [part["rows"][0]["label"] for part in [first, second, third]] == expected
    assert first["has_more"] and second["has_more"] and not third["has_more"]
    assert first["name"] == "Example Media"


def test_a_checked_name_does_not_check_similar_spelling_or_other_file(
    finance_api, finance_db, held
):
    names(finance_db, held, ["Exmaple Media"])
    # The source has a standing check of Example Media; typo is only machine read.
    checked = read(finance_api, name="Exmaple Media")["rows"]
    assert (
        next(row for row in checked if row["label"] == "Example Media")["unchecked"]
        is False
    )
    finance_db.add(
        m.FCCExtraction(
            content_hash=held["second_version"],
            version=EXTRACTOR_VERSION,
            document_kind="unknown",
            status="readable",
            errors=[],
            facts=[{"field": "agency_name", "value": "Example Media", "page": 1}],
        )
    )
    finance_db.commit()
    mixed = next(
        row
        for row in read(finance_api, name="Exmaple Media")["rows"]
        if row["label"] == "Example Media"
    )
    assert mixed["unchecked"] is True
    assert mixed["file_count"] == 2


def test_new_held_label_invalidates_paging(finance_api, finance_db, held):
    names(finance_db, held, ["Exmaple Media"])
    version = read(finance_api)["version"]
    finance_db.add(
        m.FCCExtraction(
            content_hash=held["second_version"],
            version=EXTRACTOR_VERSION,
            document_kind="unknown",
            status="readable",
            errors=[],
            facts=[{"field": "agency_name", "value": "Example Media LLC", "page": 1}],
        )
    )
    finance_db.commit()
    read(finance_api, status=409, version=version, offset=1)


def test_no_matches_is_distinct_from_catalogue_bound_or_read_failure(
    finance_api, finance_db, held, monkeypatch
):
    from alethical.api.services import finance_similar_agencies as similar
    from sqlalchemy.exc import SQLAlchemyError

    assert read(finance_api)["rows"] == []
    monkeypatch.setattr(similar, "MAX_NAMES", 0)
    read(finance_api, status=503)
    monkeypatch.setattr(similar, "MAX_NAMES", 20000)

    def unavailable(*args, **kwargs):
        raise SQLAlchemyError("synthetic unavailable database")

    monkeypatch.setattr(similar, "_read", unavailable)
    read(finance_api, status=503)


def test_unknown_hash_does_not_search_unknown_or_address_text(
    finance_api, finance_db, held
):
    read(finance_api, name="Unknown Agency", status=404)
    # A checked organization address is not a printed agency name.
    read(finance_api, name="456 Example Avenue", status=404)


def test_similar_agencies_keep_private_access(client):
    response = client.get(BASE + reader.agency_key("Example Media") + "/similar-names")
    assert response.status_code == 401


def test_similar_agencies_keep_query_limits(finance_api, held):
    read(finance_api, status=422, limit=51)
    read(finance_api, status=422, offset=-1)
    response = finance_api.get(BASE + "not-a-key/similar-names")
    assert response.status_code == 422


def test_displayed_agency_exclusions_require_the_same_source_version(
    finance_api, finance_db, held
):
    variant = "Exmaple Media"
    names(finance_db, held, [variant])
    path = BASE + reader.agency_key("Example Media") + "/similar-names"
    params = {"exclude_key": [reader.agency_key(variant)]}
    unpinned = finance_api.get(path, params=params)
    assert unpinned.status_code == 200
    assert variant in {row["label"] for row in unpinned.json()["data"]["rows"]}
    assert unpinned.json()["data"]["excluded_keys"] == []
    changed = finance_api.get(path, params={**params, "version": "0000000000000000"})
    assert changed.status_code == 409
