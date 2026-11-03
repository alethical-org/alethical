"""A Finance list names the source state it read, and refuses a page from a changed one."""

# ruff: noqa: F811
import pytest

from alethical.db import models as m
from alethical.db.session import get_db
from alethical.tests.finance_fixtures import finance_api, finance_db  # noqa: F401
from alethical.tests.test_identity_confirmations import (  # noqa: F401
    board,
    create,
    donor,
    prints,
)

LISTS = [
    "/api/v1/finance/connections",
    "/api/v1/finance/payees",
    "/api/v1/finance/people",
    "/api/v1/finance/identities",
    "/api/v1/finance/identities/queue",
    "/api/v1/finance/media-buys/browse",
    "/api/v1/finance/media-buys/queue",
]


def read(api, path, status=200, **params):
    api.app.dependency_overrides[get_db]().connection()
    response = api.get(path, params=params)
    assert response.status_code == status, response.text
    return response.json()


@pytest.mark.parametrize("path", LISTS)
def test_every_list_names_its_version_and_accepts_it_back(finance_api, board, path):
    first = read(finance_api, path)["data"]
    assert len(first["version"]) == 16
    again = read(finance_api, path, version=first["version"])["data"]
    assert again["version"] == first["version"]


@pytest.mark.parametrize("path", LISTS)
def test_a_stale_or_malformed_version_is_refused(finance_api, board, path):
    refused = read(finance_api, path, status=409, version="0" * 16)
    assert refused["type"].endswith("/records-changed")
    read(finance_api, path, status=422, version="not-a-version")


def test_an_identity_change_changes_money_and_identity_lists(finance_api, board):
    before = {
        path: read(finance_api, path)["data"]["version"]
        for path in (
            "/api/v1/finance/connections",
            "/api/v1/finance/payees",
            "/api/v1/finance/identities/queue",
            "/api/v1/finance/people",
        )
    }
    held = prints(finance_api)
    create(finance_api, "person", "Example, Jordan", donor(board, [held[31]]))
    for path in (
        "/api/v1/finance/connections",
        "/api/v1/finance/payees",
        "/api/v1/finance/identities/queue",
    ):
        read(finance_api, path, status=409, version=before[path])
    # People read no identity, so its version is unchanged.
    assert (
        read(
            finance_api,
            "/api/v1/finance/people",
            version=before["/api/v1/finance/people"],
        )["data"]["version"]
        == before["/api/v1/finance/people"]
    )


def test_a_people_change_changes_only_the_people_version(
    finance_api, finance_db, board
):
    people = read(finance_api, "/api/v1/finance/people")["data"]["version"]
    payees = read(finance_api, "/api/v1/finance/payees")["data"]["version"]
    finance_db.add(m.PublicPerson(name="Example Public Person", identity_evidence={}))
    finance_db.commit()
    read(finance_api, "/api/v1/finance/people", status=409, version=people)
    assert (
        read(finance_api, "/api/v1/finance/payees", version=payees)["data"]["version"]
        == payees
    )


def test_a_new_release_changes_the_money_version(finance_api, finance_db, board):
    version = read(finance_api, "/api/v1/finance/payees")["data"]["version"]
    pointer = finance_db.get(m.CampaignFinanceCurrentRelease, True)
    pointer.release_id = None
    finance_db.commit()
    read(finance_api, "/api/v1/finance/payees", status=409, version=version)
