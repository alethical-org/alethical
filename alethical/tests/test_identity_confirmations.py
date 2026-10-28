"""Finance identity confirmations: evidence-checked links, withdrawals, merges, splits."""

# ruff: noqa: F811 -- pytest fixtures arrive as parameters named after the imports

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from alethical.api.services import finance_access
from alethical.db import models as m
from alethical.tests.finance_fixtures import (  # noqa: F401
    FINANCE_EMAIL,
    finance_api,
    finance_db,
)
from alethical.tests.test_campaign_finance_landing_reads import (
    Dataset,
    _download_snapshot,
)

BASE = "/api/v1/finance/identities"


@pytest.fixture()
def rows(finance_db):  # noqa: F811
    """1 contribution row and 1 expenditure row, each printing a name."""
    gave = _download_snapshot(finance_db, Dataset.contributions)
    paid = _download_snapshot(finance_db, Dataset.expenditures)
    finance_db.add(
        m.CampaignFinanceContributionRow(
            snapshot_id=gave.id,
            row_number=31,
            contributor="Example, Jordan A",
            contrib_employer_name="Example Health Association",
            recipient="Example Candidate Committee",
        )
    )
    finance_db.add(
        m.CampaignFinanceExpenditureRow(
            snapshot_id=paid.id,
            row_number=52,
            vendor_name="Example Media LLC",
            purpose="ADVERTISING",
        )
    )
    # Commit into the test's outer transaction, so a refused request's rollback
    # keeps the listed account and these rows; the outer transaction still ends
    # in a rollback.
    finance_db.commit()
    return {"gave": gave.id, "paid": paid.id}


def donor_link(rows, key="Example, Jordan A", quote="EXAMPLE, JORDAN A"):
    return {
        "record_kind": "donor_name",
        "record_key": key,
        "relation": "Donor name as printed",
        "evidence_source": "cf_contribution_row",
        "evidence_snapshot_id": str(rows["gave"]),
        "evidence_locator": 31,
        "evidence_quote": quote,
        "basis": "The registered lobbyist's address matches the donor row's address.",
    }


def payee_link(rows):
    return {
        "record_kind": "payee_name",
        "record_key": "Example Media LLC",
        "relation": "Payee name as printed",
        "evidence_source": "cf_expenditure_row",
        "evidence_snapshot_id": str(rows["paid"]),
        "evidence_locator": 52,
        "evidence_quote": "Example Media LLC",
        "basis": "The vendor row names the advertising firm.",
    }


def create(api, kind, name, link):
    response = api.post(BASE, json={"kind": kind, "name": name, "link": link})
    assert response.status_code == 201, response.text
    return response.json()["data"]


def test_a_confirmation_keeps_its_evidence_and_never_names_who_made_it(
    finance_api, rows
):  # noqa: F811
    person = create(finance_api, "person", "Example, Jordan A", donor_link(rows))
    assert person["kind"] == "person" and person["status"] == "active"
    [record] = person["records"]
    assert record["record_key"] == "Example, Jordan A"
    assert record["evidence"] == {
        "source": "cf_contribution_row",
        "snapshot_id": str(rows["gave"]),
        "locator": "31",
        "url": None,
        "quote": "EXAMPLE, JORDAN A",
    }
    assert [event["action"] for event in person["history"]] == ["created", "linked"]
    text = str(person)
    assert "made_by_alethical_team" not in text and FINANCE_EMAIL not in text
    found = finance_api.get(
        f"{BASE}/lookup",
        params={"record_kind": "donor_name", "record_key": "Example, Jordan A"},
    ).json()["data"]
    assert found["identity"]["id"] == person["id"]


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"record_key": "EXAMPLE, JORDAN"}, "does not print this exact record"),
        ({"record_key": " Example, Jordan A"}, "exactly as printed"),
        ({"evidence_quote": "SOMEONE ELSE"}, "must appear in the evidence row"),
        ({"evidence_locator": 999}, "No such row"),
        ({"evidence_source": "cf_expenditure_row"}, "cannot show this kind"),
        ({"basis": " "}, "Basis is required"),
    ],
)
def test_evidence_must_print_exactly_the_record_claimed(
    finance_api, rows, change, message
):  # noqa: F811
    response = finance_api.post(
        BASE,
        json={"kind": "person", "name": "X", "link": {**donor_link(rows), **change}},
    )
    assert response.status_code == 422
    assert message in response.json()["detail"]


def test_a_record_is_confirmed_for_1_identity_at_a_time(finance_api, rows):  # noqa: F811
    first = create(finance_api, "person", "Example, Jordan A", donor_link(rows))
    again = finance_api.post(
        BASE, json={"kind": "person", "name": "Other", "link": donor_link(rows)}
    )
    assert again.status_code == 422
    withdrawn = finance_api.post(
        f"{BASE}/links/{first['records'][0]['id']}/withdraw",
        json={"reason": "The address belongs to a different person."},
    ).json()["data"]
    assert withdrawn["records"][0]["status"] == "withdrawn"
    assert withdrawn["records"][0]["withdrawal_reason"].startswith("The address")
    assert (
        finance_api.get(
            f"{BASE}/lookup",
            params={"record_kind": "donor_name", "record_key": "Example, Jordan A"},
        ).json()["data"]
        is None
    )
    create(finance_api, "person", "Example, Jordan B", donor_link(rows))


def test_merges_redirect_through_every_later_merge(finance_api, rows, finance_db):  # noqa: F811
    a = create(finance_api, "organization", "Example Media", payee_link(rows))
    employer = {
        **donor_link(
            rows, key="Example Health Association", quote="Health Association"
        ),
        "record_kind": "employer_name",
        "relation": "Employer as printed",
    }
    b = create(finance_api, "organization", "Example Media LLC", employer)
    c_entity = m.IdentityEntity(
        kind="organization", name="C", made_by_alethical_team=False
    )
    finance_db.add(c_entity)
    finance_db.flush()
    merged = finance_api.post(
        f"{BASE}/{a['id']}/merge", json={"into": b["id"], "reason": "Same firm."}
    ).json()["data"]
    assert {r["record_key"] for r in merged["records"]} == {
        "Example Media LLC",
        "Example Health Association",
    }
    finance_api.post(
        f"{BASE}/{b['id']}/merge", json={"into": str(c_entity.id), "reason": "Same."}
    )
    old = finance_api.get(f"{BASE}/{a['id']}").json()["data"]
    assert (old["status"], old["redirect_to"]) == ("merged", str(c_entity.id))
    assert old["records"] == []
    blocked = finance_api.post(f"{BASE}/{a['id']}/links", json=payee_link(rows))
    assert blocked.status_code == 422


def test_a_person_never_merges_into_an_organization(finance_api, rows):  # noqa: F811
    person = create(finance_api, "person", "Example, Jordan A", donor_link(rows))
    organization = create(
        finance_api, "organization", "Example Media LLC", payee_link(rows)
    )
    response = finance_api.post(
        f"{BASE}/{person['id']}/merge", json={"into": organization["id"], "reason": "x"}
    )
    assert response.status_code == 422


def test_a_split_gives_every_record_to_exactly_1_part(finance_api, rows):  # noqa: F811
    person = create(finance_api, "person", "Example, Jordan", donor_link(rows))
    employer = {
        **donor_link(
            rows, key="Example Health Association", quote="Health Association"
        ),
        "record_kind": "employer_name",
        "relation": "Employer as printed",
    }
    both = finance_api.post(f"{BASE}/{person['id']}/links", json=employer).json()[
        "data"
    ]
    first, second = (record["id"] for record in both["records"])
    missing = finance_api.post(
        f"{BASE}/{person['id']}/split",
        json={
            "reason": "2 people.",
            "parts": [{"name": "A", "links": [first]}, {"name": "B", "links": []}],
        },
    )
    assert missing.status_code == 422
    twice = finance_api.post(
        f"{BASE}/{person['id']}/split",
        json={
            "reason": "2 people.",
            "parts": [
                {"name": "A", "links": [first, second]},
                {"name": "B", "links": [second]},
            ],
        },
    )
    assert twice.status_code == 422
    done = finance_api.post(
        f"{BASE}/{person['id']}/split",
        json={
            "reason": "2 people.",
            "parts": [
                {"name": "Jordan A", "links": [first]},
                {"name": "Jordan B", "links": [second]},
            ],
        },
    ).json()["data"]
    assert done["status"] == "split" and done["records"] == []
    assert sorted(part["name"] for part in done["split_into"]) == [
        "Jordan A",
        "Jordan B",
    ]
    part = next(p for p in done["split_into"] if p["name"] == "Jordan A")
    moved = finance_api.get(f"{BASE}/{part['id']}").json()["data"]
    assert [r["id"] for r in moved["records"]] == [first]


def test_a_held_person_record_needs_an_official_page(finance_api, finance_db, rows):  # noqa: F811
    legislator = finance_db.scalar(select(m.Legislator))
    link = {
        "record_kind": "legislator",
        "record_key": str(legislator.id),
        "relation": "Serving legislator",
        "evidence_source": "official_page",
        "evidence_url": "http://www.leg.mn.gov/",
        "evidence_quote": legislator.full_name,
        "basis": "The Legislature's member page.",
    }
    assert (
        finance_api.post(
            BASE, json={"kind": "person", "name": "X", "link": link}
        ).status_code
        == 422
    )
    link["evidence_url"] = "https://www.leg.mn.gov/members"
    created = create(finance_api, "person", legislator.full_name, link)
    assert created["records"][0]["evidence"]["url"] == "https://www.leg.mn.gov/members"
    organization = finance_api.post(
        BASE,
        json={
            "kind": "organization",
            "name": "X",
            "link": {**link, "record_key": str(uuid.uuid4())},
        },
    )
    assert organization.status_code == 422


@pytest.mark.parametrize("team", [False, True])
def test_whether_a_team_account_made_it_is_recorded_privately(
    finance_api, finance_db, rows, team
):  # noqa: F811
    finance_access.grant(finance_db, FINANCE_EMAIL, team=team)
    person = create(finance_api, "person", "Example, Jordan A", donor_link(rows))
    saved = finance_db.get(m.IdentityLink, uuid.UUID(person["records"][0]["id"]))
    assert saved.made_by_alethical_team is team


def test_identities_need_finance_access(client):
    assert client.get(f"{BASE}/{uuid.uuid4()}").status_code == 401
    assert client.post(BASE, json={}).status_code == 401
