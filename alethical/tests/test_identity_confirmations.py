"""Finance identity confirmations: evidence-checked links, withdrawals, merges, splits."""

# ruff: noqa: F811 -- pytest fixtures arrive as parameters named after the imports

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from alethical.api.services import finance_access
from alethical.api.services import identity_confirmations as identities
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
from alethical.tests.test_campaign_finance_landing_reads import (
    FilerKind as _FilerKind,
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


def employer_link(rows):
    return {
        **donor_link(
            rows, key="Example Health Association", quote="Health Association"
        ),
        "record_kind": "employer_name",
        "relation": "Employer as printed",
    }


def held_link(legislator, **change):
    return {
        "record_kind": "legislator",
        "record_key": str(legislator.id),
        "relation": "Serving legislator",
        "evidence_source": "official_page",
        "evidence_url": "https://www.senate.mn/members",
        "evidence_quote": legislator.full_name,
        "basis": "The Senate's member page.",
        **change,
    }


def post(api, path, body):
    return api.post(f"{BASE}{path}", json=body)


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"evidence_url": "https://example.org/members"}, "official Minnesota site"),
        ({"evidence_url": "https://mn.gov.example.org/x"}, "official Minnesota site"),
        ({"evidence_url": "https://www.senate.mn /x"}, "https address"),
        ({"evidence_url": "ftp://www.senate.mn/x"}, "https address"),
    ],
)
def test_an_official_page_is_on_a_minnesota_site(
    finance_api, finance_db, rows, change, message
):  # noqa: F811
    legislator = finance_db.scalar(select(m.Legislator))
    response = post(
        finance_api,
        "",
        {"kind": "person", "name": "X", "link": held_link(legislator, **change)},
    )
    assert response.status_code == 422
    assert message in response.json()["detail"]


def test_a_held_record_is_confirmed_under_1_spelling_of_its_id(
    finance_api, finance_db, rows
):  # noqa: F811
    legislator = finance_db.scalar(select(m.Legislator))
    create(finance_api, "person", legislator.full_name, held_link(legislator))
    shouted = held_link(legislator, record_key=str(legislator.id).upper())
    response = post(finance_api, "", {"kind": "person", "name": "Y", "link": shouted})
    assert response.status_code == 422
    assert "exactly as held" in response.json()["detail"]


@pytest.mark.parametrize(
    ("quote", "message"),
    [
        ("Jo", "at least 3 characters"),
        # The contributor ends, then the employer begins: 2 values, not 1.
        ("Jordan A Example Health", "must appear in the evidence row"),
    ],
)
def test_a_quotation_stands_inside_1_printed_value(finance_api, rows, quote, message):  # noqa: F811
    response = post(
        finance_api,
        "",
        {"kind": "person", "name": "X", "link": donor_link(rows, quote=quote)},
    )
    assert response.status_code == 422
    assert message in response.json()["detail"]


@pytest.fixture()
def registered(finance_db):  # noqa: F811
    """1 committee in a saved copy of the Board's register of filers."""
    copied = datetime(2026, 8, 11, 6, 40, tzinfo=UTC)
    snapshot = m.CampaignFinanceFilingSnapshot(
        fetch_started_at=copied,
        fetch_completed_at=copied,
        status=m.CampaignFinanceSnapshotStatus.loaded,
        filer_count=1,
        report_count=0,
    )
    finance_db.add(snapshot)
    finance_db.flush()
    finance_db.add(
        m.CampaignFinanceFiler(
            snapshot_id=snapshot.id,
            registration_number="18135",
            kind=_FilerKind.candidate_committee,
            name="Example for Senate",
            is_incumbent=False,
        )
    )
    finance_db.commit()
    return snapshot.id


def test_a_committee_is_confirmed_by_its_registration_number(finance_api, registered):  # noqa: F811
    link = {
        "record_kind": "committee",
        "record_key": "18135",
        "relation": "Candidate committee",
        "evidence_source": "cf_filer",
        "evidence_snapshot_id": str(registered),
        "evidence_quote": "Example for Senate",
        "basis": "The Board's register names the candidate.",
    }
    created = create(finance_api, "organization", "Example for Senate", link)
    assert created["records"][0]["evidence"]["locator"] == "18135"
    unknown = post(
        finance_api,
        "",
        {"kind": "person", "name": "X", "link": {**link, "record_key": "99999"}},
    )
    assert unknown.status_code == 422
    assert "No such row" in unknown.json()["detail"]


def test_merged_and_split_identities_refuse_every_change(finance_api, rows):  # noqa: F811
    a = create(finance_api, "organization", "Example Media", payee_link(rows))
    b = create(finance_api, "organization", "Example Health", employer_link(rows))
    assert (
        post(
            finance_api, f"/{a['id']}/merge", {"into": b["id"], "reason": "x"}
        ).status_code
        == 200
    )
    for path, body in [
        (f"/{a['id']}/merge", {"into": b["id"], "reason": "again"}),
        (f"/{b['id']}/merge", {"into": a["id"], "reason": "into merged"}),
        (
            f"/{a['id']}/split",
            {"reason": "x", "parts": [{"name": "1", "links": []}] * 2},
        ),
        (f"/{a['id']}/links", payee_link(rows)),
    ]:
        refused = post(finance_api, path, body)
        assert refused.status_code == 422, path
        assert "merged or split" in refused.json()["detail"]
    first, second = (
        r["id"] for r in finance_api.get(f"{BASE}/{b['id']}").json()["data"]["records"]
    )
    post(
        finance_api,
        f"/{b['id']}/split",
        {
            "reason": "2 firms.",
            "parts": [
                {"name": "1", "links": [first]},
                {"name": "2", "links": [second]},
            ],
        },
    )
    split = post(finance_api, f"/{b['id']}/links", payee_link(rows))
    assert split.status_code == 422
    # The first identity's redirect ends on the split one, which lists its parts.
    old = finance_api.get(f"{BASE}/{a['id']}").json()["data"]
    assert old["redirect_to"] == b["id"]
    assert len(finance_api.get(f"{BASE}/{b['id']}").json()["data"]["split_into"]) == 2


def test_withdrawn_records_stay_behind_as_history(finance_api, rows):  # noqa: F811
    a = create(finance_api, "organization", "Example Media", payee_link(rows))
    post(finance_api, f"/{a['id']}/links", employer_link(rows))
    taken_back = finance_api.get(f"{BASE}/{a['id']}").json()["data"]["records"][1]["id"]
    post(finance_api, f"/links/{taken_back}/withdraw", {"reason": "Not this firm."})
    again = post(finance_api, f"/links/{taken_back}/withdraw", {"reason": "Again."})
    assert again.status_code == 422
    assert "already withdrawn" in again.json()["detail"]
    b = create(
        finance_api,
        "organization",
        "Example Health",
        employer_link(rows),
    )
    merged = post(
        finance_api, f"/{a['id']}/merge", {"into": b["id"], "reason": "x"}
    ).json()["data"]
    assert sorted(r["status"] for r in merged["records"]) == ["confirmed", "confirmed"]
    old = finance_api.get(f"{BASE}/{a['id']}").json()["data"]
    assert [(r["id"], r["status"]) for r in old["records"]] == [
        (taken_back, "withdrawn")
    ]


def test_a_split_records_which_part_took_each_record(finance_api, rows):  # noqa: F811
    person = create(finance_api, "person", "Example, Jordan", donor_link(rows))
    both = post(finance_api, f"/{person['id']}/links", employer_link(rows)).json()[
        "data"
    ]
    first, second = (r["id"] for r in both["records"])
    lonely = post(
        finance_api,
        f"/{person['id']}/split",
        {"reason": "x", "parts": [{"name": "A", "links": [first, second]}]},
    )
    assert lonely.status_code == 422
    done = post(
        finance_api,
        f"/{person['id']}/split",
        {
            "reason": "2 people.",
            "parts": [
                {"name": "A", "links": [first]},
                {"name": "B", "links": [second]},
            ],
        },
    ).json()["data"]
    [event] = [e for e in done["history"] if e["action"] == "split"]
    by_part = {p["id"]: p["links"] for p in event["detail"]["parts"]}
    names = {p["name"]: p["id"] for p in done["split_into"]}
    assert by_part == {names["A"]: [first], names["B"]: [second]}


def test_an_identity_never_merges_into_itself(finance_api, rows):  # noqa: F811
    a = create(finance_api, "organization", "Example Media", payee_link(rows))
    response = post(finance_api, f"/{a['id']}/merge", {"into": a["id"], "reason": "x"})
    assert response.status_code == 422
    assert "itself" in response.json()["detail"]


def test_2_confirmations_of_1_record_at_once_answer_409(finance_api, rows, monkeypatch):  # noqa: F811
    create(finance_api, "person", "Example, Jordan A", donor_link(rows))
    # The 2nd request read before the 1st saved; the database still refuses it.
    monkeypatch.setattr(identities, "_standing", lambda *_: None)
    response = post(
        finance_api, "", {"kind": "person", "name": "Y", "link": donor_link(rows)}
    )
    assert response.status_code == 409


@pytest.mark.parametrize(
    "body",
    [
        {"kind": "person", "name": "X", "link": ["not", "a", "record"]},
        {"kind": "person", "name": "X", "link": None},
        {"kind": "person", "name": "X\x00", "link": {}},
    ],
)
def test_malformed_requests_are_refused_not_failed(finance_api, rows, body):  # noqa: F811
    assert post(finance_api, "", body).status_code == 422


@pytest.mark.parametrize(
    "change",
    [{"evidence_locator": 2**40}, {"basis": "A\x00B"}, {"evidence_snapshot_id": "x"}],
)
def test_bad_evidence_is_refused_not_failed(finance_api, rows, change):  # noqa: F811
    response = post(
        finance_api,
        "",
        {"kind": "person", "name": "X", "link": {**donor_link(rows), **change}},
    )
    assert response.status_code == 422


def test_lookup_refuses_what_it_cannot_read(finance_api, rows):  # noqa: F811
    unknown = finance_api.get(
        f"{BASE}/lookup", params={"record_kind": "nickname", "record_key": "Jo"}
    )
    assert unknown.status_code == 422
    nul = finance_api.get(
        f"{BASE}/lookup", params={"record_kind": "donor_name", "record_key": "A\x00B"}
    )
    assert nul.status_code == 422


def test_unknown_ids_are_not_found(finance_api, rows):  # noqa: F811
    missing = str(uuid.uuid4())
    assert finance_api.get(f"{BASE}/{missing}").status_code == 404
    assert (
        post(finance_api, f"/links/{missing}/withdraw", {"reason": "x"}).status_code
        == 404
    )
    assert (
        post(
            finance_api, f"/{missing}/merge", {"into": str(uuid.uuid4()), "reason": "x"}
        ).status_code
        == 404
    )


def test_identities_need_finance_access(client):
    assert client.get(f"{BASE}/{uuid.uuid4()}").status_code == 401
    assert client.post(BASE, json={}).status_code == 401
