"""A Finance list names the source state it read, and refuses a page from a changed one."""

# ruff: noqa: F811
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import select, text

from alethical.api.services import finance_people
from alethical.db.session import get_session_factory
from alethical.pipeline.fcc_document_text import EXTRACTOR_VERSION
from alethical.tests.test_finance_people import service_member
from alethical.tests.test_finance_media_buys import held, listed, source  # noqa: F401
from alethical.tests.test_finance_station_checks import original, _fact, _file  # noqa: F401

from alethical.db import models as m
from alethical.db.session import get_db
from alethical.tests.finance_fixtures import finance_api, finance_db  # noqa: F401
from alethical.tests.test_identity_confirmations import (  # noqa: F401
    board,
    create,
    donor,
    prints,
    registered,
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
        # People now includes active identity-linked lobbyist record counts.
        "/api/v1/finance/people",
    ):
        read(finance_api, path, status=409, version=before[path])


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


@pytest.mark.parametrize("source", ["session", "district"])
def test_people_version_covers_service_reference_changes(
    finance_api, finance_db, source
):
    member = service_member(finance_db, "reference-change")
    period = member.service_periods[0]
    finance_db.commit()
    before = read(finance_api, "/api/v1/finance/people", q=member.full_name)["data"]
    if source == "session":
        period.session.slug += "-corrected"
    else:
        period.district.code += "-corrected"
    finance_db.commit()
    read(finance_api, "/api/v1/finance/people", status=409, version=before["version"])


def test_connections_version_covers_legislator_names(finance_api, finance_db, board):
    before = read(finance_api, "/api/v1/finance/connections")["data"]["version"]
    member = finance_db.scalar(select(m.Legislator))
    member.full_name += " corrected"
    finance_db.commit()
    read(finance_api, "/api/v1/finance/connections", status=409, version=before)


def test_people_version_changes_at_the_local_date_boundary(
    finance_api, finance_db, monkeypatch
):
    class Clock(datetime):
        instant = datetime(2026, 11, 4, 5, 59, tzinfo=UTC)

        @classmethod
        def now(cls, tz=None):
            return cls.instant.astimezone(tz)

    member = service_member(finance_db, "date-boundary-member")
    period = member.service_periods[0]
    period.is_current = True
    period.end_date = date(2026, 11, 3)
    finance_db.commit()
    monkeypatch.setattr(finance_people, "datetime", Clock)
    params = {"q": member.full_name, "type": "legislators", "service": "current"}
    before = read(finance_api, "/api/v1/finance/people", **params)["data"]
    assert before["total"] == 1
    Clock.instant += timedelta(minutes=2)  # Midnight in Minnesota, not UTC.
    assert read(finance_api, "/api/v1/finance/people", **params)["data"]["total"] == 0
    read(
        finance_api,
        "/api/v1/finance/people",
        status=409,
        version=before["version"],
        **params,
    )


def test_station_version_covers_revised_machine_read_facts(finance_api, original):
    path = "/api/v1/finance/media-buys/queue"
    before = read(finance_api, path)["data"]
    extraction = original.db.get(
        m.FCCExtraction, (original.document.content_hash, EXTRACTOR_VERSION)
    )
    extraction.facts = [_fact()]
    original.db.commit()
    after = read(finance_api, path)["data"]
    assert after["rows"] != before["rows"]
    read(finance_api, path, status=409, version=before["version"])


def test_station_version_covers_searchable_page_text(finance_api, original):
    path = "/api/v1/finance/media-buys/browse"
    before = read(finance_api, path)["data"]["version"]
    page = original.db.get(
        m.FCCPage, (original.document.content_hash, EXTRACTOR_VERSION, 1)
    )
    page.text += " Corrected original text"
    original.db.commit()
    read(finance_api, path, status=409, version=before)


def test_token_and_list_share_one_snapshot_during_a_concurrent_write(
    seed_database, monkeypatch
):
    # Fresh request sessions, unlike the outer-transaction fixtures above. The
    # writer commits between token and page reads; the old page must stay old.
    from alethical.api import finance_access as access_dependency
    from alethical.api.auth import get_auth_service
    from alethical.tests.finance_fixtures import _ListedAccount, FINANCE_TOKEN
    from alethical.api.main import create_app
    from alethical.api.services.finance_access import FinanceAccount
    from fastapi.testclient import TestClient

    factory = get_session_factory()
    name = "Concurrent version record"
    with factory() as writer:
        person = m.PublicPerson(name=name, identity_evidence={})
        writer.add(person)
        writer.commit()
        person_id = person.id
    app = create_app()
    app.dependency_overrides[get_auth_service] = lambda: _ListedAccount()
    access_sessions = []

    def checked_access(db, subject):
        # Exercise the real auth dependency's database read before the endpoint.
        access_sessions.append(db)
        db.execute(text("SELECT 1"))
        return FinanceAccount(subject, "test@example.test", False)

    monkeypatch.setattr(access_dependency, "supabase_account_access", checked_access)
    client = TestClient(app)
    client.headers["Authorization"] = f"Bearer {FINANCE_TOKEN}"
    normal_directory = finance_people.directory
    try:
        with pytest.MonkeyPatch.context() as patch:

            def interleaved(db, **kwargs):
                assert db is not access_sessions[-1]
                with factory() as writer:
                    writer.get(m.PublicPerson, person_id).name = name + " updated"
                    writer.commit()
                assert (
                    db.scalar(text("SHOW transaction_isolation")) == "repeatable read"
                )
                return normal_directory(db, **kwargs)

            patch.setattr(finance_people, "directory", interleaved)
            first = client.get("/api/v1/finance/people", params={"q": name}).json()[
                "data"
            ]
        assert [row["name"] for row in first["rows"]] == [name]
        second = client.get("/api/v1/finance/people", params={"q": name}).json()["data"]
        assert [row["name"] for row in second["rows"]] == [name + " updated"]
        assert first["version"] != second["version"]
    finally:
        with factory() as writer:
            writer.delete(writer.get(m.PublicPerson, person_id))
            writer.commit()


def test_station_version_covers_current_document_selection(finance_api, original):
    path = "/api/v1/finance/media-buys/queue"
    newer = _file(original.db, original.store, like=original.document)
    original.db.commit()
    before = read(finance_api, path)["data"]
    assert before["rows"][0]["version_id"] == newer.content_hash
    original.document.last_downloaded_at = newer.last_downloaded_at + timedelta(days=1)
    original.db.commit()
    after = read(finance_api, path)["data"]
    assert after["rows"][0]["version_id"] == original.document.content_hash
    read(finance_api, path, status=409, version=before["version"])


def test_station_version_covers_metadata_even_when_observed_dates_are_unchanged(
    finance_api, original
):
    path = "/api/v1/finance/media-buys/queue"
    before = read(finance_api, path)["data"]
    original.document.name = "Corrected source title"
    original.db.commit()
    after = read(finance_api, path)["data"]
    assert after["rows"][0]["name"] == "Corrected source title"
    read(finance_api, path, status=409, version=before["version"])


def test_an_already_open_read_committed_transaction_cannot_name_a_snapshot(
    seed_database,
):
    from fastapi import HTTPException
    from alethical.api.services import finance_versions

    with get_session_factory()() as db:
        db.execute(text("SELECT 1"))
        assert db.connection().get_isolation_level() == "READ COMMITTED"
        with pytest.raises(HTTPException) as refused:
            finance_versions.current(db, "people")
        assert refused.value.status_code == 503


def test_connections_refuses_pages_after_filing_register_changes(
    finance_api, finance_db, board, registered
):
    path = "/api/v1/finance/connections"
    finance_db.merge(
        m.CampaignFinanceFilingCurrentSnapshot(id=True, snapshot_id=registered)
    )
    finance_db.commit()
    first = read(finance_api, path)["data"]
    committee = next(
        node for node in first["nodes"] if node["key"] == "committee:18135"
    )
    assert committee["register_kind"] == "candidate_committee"
    pointer = finance_db.get(m.CampaignFinanceFilingCurrentSnapshot, True)
    pointer.snapshot_id = None
    finance_db.commit()
    read(finance_api, path, status=409, version=first["version"])


def test_connections_refuses_pages_after_summary_metadata_rebuild(
    finance_api, finance_db, board
):
    from alethical.pipeline import campaign_finance_graph_summary as summary

    path = "/api/v1/finance/connections"
    first = read(finance_api, path)["data"]
    summary.rebuild(
        finance_db,
        m.CampaignFinanceDataset.independent_expenditures,
        board.independent_expenditures_snapshot_id,
    )
    finance_db.commit()
    read(finance_api, path, status=409, version=first["version"])


def test_station_version_covers_accepted_expense_link_withdrawal(finance_api, original):
    from uuid import uuid4

    link = m.FCCExpenseLink(
        content_hash=original.document.content_hash,
        extraction_version=EXTRACTOR_VERSION,
        source_dataset="expenditures",
        source_snapshot_id=uuid4(),
        source_content_hash="a" * 64,
        source_row_number=1,
        source_row={},
        status="accepted",
        evidence="Exact saved row and document",
        reviewed_by="test",
    )
    original.db.add(link)
    original.db.commit()
    path = "/api/v1/finance/media-buys/queue"
    version = read(finance_api, path)["data"]["version"]
    link.status = "rejected"
    original.db.commit()
    read(finance_api, path, status=409, version=version)
