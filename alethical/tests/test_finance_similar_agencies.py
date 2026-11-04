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
        "Example Media LLC",
        "Exmaple Media",
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


def test_agency_paging_is_global_az_and_excludes_only_exact_input(
    finance_api, finance_db, held
):
    expected = ["EXAMPLE MEDIA", "Example Media LLC", "Exmaple Media"]
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
