"""Finance's payments under a name are alethical.com's rows plus each row's own facts."""

# ruff: noqa: F811
from datetime import date
from decimal import Decimal

import pytest

from alethical.db.session import get_db
from alethical.tests.finance_fixtures import finance_api, finance_db  # noqa: F401
from alethical.tests.test_identity_confirmations import (  # noqa: F401
    DONOR,
    EMPLOYER,
    VENDOR,
    board,
    create,
    donor,
    employer,
    gift,
    payee,
    prints,
)

FINANCE = "/api/v1/finance/payments-under-name"
PUBLIC = "/api/v1/campaign-finance/payments-under-name"
EXTRA = {"fingerprint", "identity", "evidence", "excerpt"}


def read(api, path=FINANCE, status=200, **params):
    api.app.dependency_overrides[get_db]().connection()
    response = api.get(path, params=params)
    assert response.status_code == status, response.text
    return response.json().get("data")


@pytest.mark.parametrize(
    "params",
    [
        {"name": DONOR, "role": "contributor"},
        {"name": DONOR, "role": "contributor", "year": 2025},
        {"name": DONOR, "role": "contributor", "limit": 1, "offset": 1},
        {"name": EMPLOYER, "role": "employer"},
        {"name": VENDOR, "role": "vendor"},
        {"name": VENDOR, "role": "independent_vendor"},
        {"name": "Nobody, Printed", "role": "contributor"},
    ],
)
def test_rows_states_and_paging_are_alethicals_own(finance_api, board, params):
    finance = read(finance_api, **params)
    public = read(finance_api, PUBLIC, **params)
    assert [
        {k: v for k, v in payment.items() if k not in EXTRA}
        for payment in finance["payments"]
    ] == public["payments"]
    for key in ("state", "page", "dataset", "source_url", "release_id"):
        assert finance[key] == public[key], key


def test_each_row_carries_the_fingerprint_confirmations_store(finance_api, board):
    data = read(finance_api, name=DONOR, role="contributor")
    held = prints(finance_api)
    assert {p["record_number"]: p["fingerprint"] for p in data["payments"]} == held
    assert data["record_kind"] == "donor_name"
    [first] = [p for p in data["payments"] if p["record_number"] == 31]
    assert first["evidence"] == {
        "dataset": "contributions",
        "snapshot_id": str(board.contributions_snapshot_id),
        "record_number": 31,
        "source_url": data["source_url"],
        "copied_at": first["evidence"]["copied_at"],
    }
    # The whole row in the file's own column order, labelled as the file labels it.
    labels = [label for label, _ in first["excerpt"]]
    assert labels[:5] == [
        "Recipient reg num",
        "Recipient",
        "Recipient type",
        "Recipient subtype",
        "Amount",
    ]
    assert labels[-1] == "Contrib Employer name"
    printed = dict(first["excerpt"])
    assert (printed["Contributor"], printed["Amount"], printed["Receipt date"]) == (
        DONOR,
        "250.0000",
        "2026-03-02",
    )
    assert printed["Recipient type"] is None


def test_rows_name_the_identity_their_fingerprint_is_confirmed_to(finance_api, board):
    held = prints(finance_api)
    person = create(finance_api, "person", "Example, Jordan", donor(board, [held[31]]))
    data = read(finance_api, name=DONOR, role="contributor")
    by_row = {p["record_number"]: p["identity"] for p in data["payments"]}
    # 31 and 33 print the same facts and share 1 fingerprint and 1 claim.
    assert by_row[31]["id"] == by_row[33]["id"] == person["id"]
    assert by_row[32] is None
    assert [(i["id"], i["confirmed_records"]) for i in data["identities"]] == [
        (person["id"], 2)
    ]
    # The same rows read as an employer spelling are not confirmed by a donor claim.
    as_employer = read(finance_api, name=EMPLOYER, role="employer")
    assert all(p["identity"] is None for p in as_employer["payments"])
    assert as_employer["identities"] == []


def test_counts_follow_the_year_and_filer_scope(finance_api, finance_db, board):
    finance_db.add(
        gift(
            board.contributions_snapshot_id,
            35,
            recipient_reg_num="18466",
            recipient="Another Committee",
            receipt_date=date(2026, 6, 1),
            amount=Decimal("75"),
        )
    )
    finance_db.commit()
    held = prints(finance_api)
    create(
        finance_api,
        "person",
        "Example, Jordan",
        donor(board, [held[31], held[32], held[35]]),
    )
    every = read(finance_api, name=DONOR, role="contributor")
    assert every["page"]["total_payments"] == 4
    assert every["identities"][0]["confirmed_records"] == 4
    filed = read(finance_api, name=DONOR, role="contributor", filer="18135")
    assert {p["record_number"] for p in filed["payments"]} == {31, 32, 33}
    assert filed["page"]["total_payments"] == 3
    assert filed["identities"][0]["confirmed_records"] == 3
    year = read(finance_api, name=DONOR, role="contributor", year=2025, filer="18135")
    assert [p["record_number"] for p in year["payments"]] == [32]
    assert year["identities"][0]["confirmed_records"] == 1
    other = read(finance_api, name=DONOR, role="contributor", filer="99999")
    assert other["state"] != "reported" and other["payments"] == []
    assert other["identities"] == []


def test_a_merged_identity_is_named_by_the_identity_standing_today(finance_api, board):
    held = prints(finance_api)
    old = create(finance_api, "person", "Old", donor(board, [held[31]]))
    new = create(finance_api, "person", "New", donor(board, [held[32]]))
    response = finance_api.post(
        f"/api/v1/finance/identities/{old['id']}/merge",
        json={"into": new["id"], "reason": "Same person."},
    )
    assert response.status_code == 200, response.text
    data = read(finance_api, name=DONOR, role="contributor")
    assert {p["identity"]["id"] for p in data["payments"]} == {new["id"]}
    assert [(i["id"], i["confirmed_records"]) for i in data["identities"]] == [
        (new["id"], 3)
    ]


def test_a_withdrawn_confirmation_names_no_identity(finance_api, board):
    held = prints(finance_api)
    person = create(finance_api, "person", "Example", donor(board, [held[31]]))
    confirmation = person["confirmations"][0]["id"]
    finance_api.post(
        f"/api/v1/finance/identities/confirmations/{confirmation}/withdraw",
        json={"reason": "Wrong person."},
    )
    data = read(finance_api, name=DONOR, role="contributor")
    assert all(p["identity"] is None for p in data["payments"])
    assert data["identities"] == []


def test_payees_and_employers_use_their_own_record_kinds(finance_api, board):
    [vendor] = prints(finance_api, "payee_name", VENDOR).values()
    firm = create(finance_api, "organization", "Firm", payee(board, [vendor]))
    paid = read(finance_api, name=VENDOR, role="vendor")
    assert paid["record_kind"] == "payee_name"
    assert [p["identity"]["id"] for p in paid["payments"]] == [firm["id"]]
    # The independent-expenditures file is a separate kind; this claim is not its.
    outside = read(finance_api, name=VENDOR, role="independent_vendor")
    assert outside["record_kind"] == "independent_payee_name"
    assert [p["identity"] for p in outside["payments"]] == [None]
    employers = prints(finance_api, "employer_name", EMPLOYER)
    org = create(
        finance_api, "organization", "Health Org", employer(board, [employers[32]])
    )
    typed = read(finance_api, name=EMPLOYER, role="employer")
    assert {
        p["record_number"]: p["identity"]["id"] if p["identity"] else None
        for p in typed["payments"]
    } == {31: None, 32: org["id"], 33: None, 34: None}


def test_a_changed_release_is_refused_and_bad_input_is_422(finance_api, board):
    data = read(finance_api, name=DONOR, role="contributor")
    assert (
        read(
            finance_api, name=DONOR, role="contributor", release_id=data["release_id"]
        )["release_id"]
        == data["release_id"]
    )
    read(
        finance_api,
        status=409,
        name=DONOR,
        role="contributor",
        release_id="00000000-0000-0000-0000-000000000000",
    )
    read(finance_api, status=422, name="bad\x00name", role="contributor")
    read(finance_api, status=422, name=DONOR, role="donor")
    read(finance_api, status=422, name=DONOR, role="contributor", limit=500)


def test_a_fingerprint_is_claimed_once_so_each_row_counts_once(finance_api, board):
    held = prints(finance_api)
    person = create(finance_api, "person", "Example, Jordan", donor(board, [held[31]]))
    # The same fingerprint cannot be confirmed again for another identity.
    second = finance_api.post(
        "/api/v1/finance/identities",
        json={
            "kind": "person",
            "name": "Someone else",
            "confirmation": donor(board, [held[31]]),
        },
    )
    assert second.status_code == 422
    data = read(finance_api, name=DONOR, role="contributor")
    public = read(finance_api, PUBLIC, name=DONOR, role="contributor")
    assert [p["record_number"] for p in data["payments"]] == [
        p["record_number"] for p in public["payments"]
    ]
    assert [(i["id"], i["confirmed_records"]) for i in data["identities"]] == [
        (person["id"], 2)
    ]


def test_a_merge_neither_repeats_rows_nor_doubles_counts(finance_api, board):
    held = prints(finance_api)
    old = create(finance_api, "person", "Old", donor(board, [held[31]]))
    new = create(finance_api, "person", "New", donor(board, [held[32]]))
    finance_api.post(
        f"/api/v1/finance/identities/{old['id']}/merge",
        json={"into": new["id"], "reason": "Same person."},
    )
    data = read(finance_api, name=DONOR, role="contributor")
    public = read(finance_api, PUBLIC, name=DONOR, role="contributor")
    assert len(data["payments"]) == len(public["payments"]) == 3
    assert data["page"]["total_payments"] == 3
    assert sum(i["confirmed_records"] for i in data["identities"]) == 3


def test_nothing_published_is_an_unavailable_state_not_an_error(
    finance_api, board, monkeypatch
):
    from alethical.api.services import committee_finance

    monkeypatch.setattr(committee_finance, "current_release", lambda db: None)
    data = read(finance_api, name=DONOR, role="contributor")
    assert data["state"] == "unavailable"
    assert data["payments"] == [] and data["identities"] == []
    assert data["page"]["total_payments"] is None
    assert (data["dataset"], data["release_id"]) == ("contributions", None)


def test_a_release_whose_files_are_gone_is_unavailable_and_a_pin_is_refused(
    finance_api, board, monkeypatch
):
    from alethical.api.services import committee_finance
    from alethical.pipeline.campaign_finance_reader import ReleaseNoLongerHeld

    def gone(db):
        raise ReleaseNoLongerHeld("replaced")

    monkeypatch.setattr(committee_finance, "current_release", gone)
    data = read(finance_api, name=DONOR, role="contributor")
    assert data["state"] == "unavailable" and data["payments"] == []
    monkeypatch.setattr(committee_finance, "current_release", lambda db: None)
    read(
        finance_api,
        status=409,
        name=DONOR,
        role="contributor",
        release_id=str(board.id),
    )
