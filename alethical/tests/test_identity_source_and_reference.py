"""Every identity has a short reference, and every decision can say where its evidence was found.

The reference (ORG-0042, PER-0042) is numbered by kind in creation order and never
reused; a split's parts each get a new one, and every identity read, search result,
split part and history event names it. A source is optional free text kept apart
from the basis or reason, on confirmations, withdrawals, merges and splits.
Sequences are not rolled back with a test's transaction, so these tests check the
reference's form and order, never a particular number.
"""

# ruff: noqa: F811
import re

from alethical.tests.finance_fixtures import finance_api, finance_db  # noqa: F401
from alethical.tests.test_finance_payees import get as payees
from alethical.tests.test_identity_confirmations import (  # noqa: F401
    BASE,
    VENDOR,
    board,
    committee,
    create,
    donor,
    get,
    payee,
    post,
    prints,
    registered,
    two_confirmations,
)

REFERENCE = re.compile(r"^(ORG|PER)-(\d{4,})$")


def number(reference, prefix):
    found = REFERENCE.match(reference)
    assert found and found.group(1) == prefix, reference
    return int(found.group(2))


def test_identities_get_references_by_kind_in_creation_order(
    finance_api, board, registered
):
    rows = prints(finance_api)
    first = create(finance_api, "person", "Example, Jordan", donor(board, [rows[31]]))
    second = create(
        finance_api, "person", "Example, Jordan 2", donor(board, [rows[32]])
    )
    organization = create(
        finance_api, "organization", "Example Senate Org", committee(registered)
    )
    assert number(second["reference"], "PER") > number(first["reference"], "PER")
    number(organization["reference"], "ORG")
    assert get(finance_api, first["id"])["reference"] == first["reference"]
    found = finance_api.get(BASE, params={"q": "Example Senate"}).json()["data"]
    [row] = [r for r in found["rows"] if r["id"] == organization["id"]]
    assert row["reference"] == organization["reference"]


def test_a_confirmation_and_its_withdrawal_keep_their_own_sources(finance_api, board):
    rows = prints(finance_api)
    person = create(
        finance_api,
        "person",
        "Example, Jordan",
        {**donor(board, [rows[31]]), "source": "Board contributions file, row 31"},
    )
    [confirmation] = person["confirmations"]
    assert confirmation["source"] == "Board contributions file, row 31"
    assert confirmation["basis"] != confirmation["source"]
    assert confirmation["withdrawal_source"] is None
    withdrawn = post(
        finance_api,
        f"/confirmations/{confirmation['id']}/withdraw",
        {"reason": "Not him.", "source": "  Phone call with the committee  "},
    )
    assert withdrawn.status_code == 200, withdrawn.text
    [after] = get(finance_api, person["id"])["confirmations"]
    assert (after["withdrawal_reason"], after["withdrawal_source"]) == (
        "Not him.",
        "Phone call with the committee",
    )
    assert after["source"] == "Board contributions file, row 31"


def test_a_source_is_optional_and_blank_is_none(finance_api, board):
    rows = prints(finance_api)
    person = create(
        finance_api,
        "person",
        "Example, Jordan",
        {**donor(board, [rows[31]]), "source": "   "},
    )
    assert person["confirmations"][0]["source"] is None
    plain = create(finance_api, "person", "Example, Jordan 2", donor(board, [rows[32]]))
    assert plain["confirmations"][0]["source"] is None


def test_a_source_that_cannot_be_saved_is_refused(finance_api, board):
    rows = prints(finance_api)
    response = post(
        finance_api,
        "",
        {
            "kind": "person",
            "name": "Example, Jordan",
            "confirmation": {**donor(board, [rows[31]]), "source": "bad\u0000byte"},
        },
    )
    assert response.status_code == 422
    assert "Source" in response.json()["detail"]
    too_long = post(
        finance_api,
        "",
        {
            "kind": "person",
            "name": "Example, Jordan",
            "confirmation": {**donor(board, [rows[31]]), "source": "x" * 2001},
        },
    )
    assert too_long.status_code == 422


def test_a_merge_names_both_identities_by_reference_and_keeps_its_source(
    finance_api, board
):
    rows = prints(finance_api)
    [vendor] = prints(finance_api, "payee_name", VENDOR).values()
    left = create(finance_api, "organization", "Example Media", payee(board, [vendor]))
    right = create(finance_api, "person", "Example, Jordan", donor(board, [rows[31]]))
    joined = create(
        finance_api, "person", "Example, Jordan A", donor(board, [rows[32]])
    )
    response = post(
        finance_api,
        f"/{joined['id']}/merge",
        {"into": right["id"], "reason": "Same person.", "source": "Voter file"},
    )
    assert response.status_code == 200, response.text
    merged = get(finance_api, joined["id"])
    assert merged["redirect_to"] == right["id"]
    assert merged["redirect_to_reference"] == right["reference"]
    [event] = [e for e in merged["history"] if e["action"] == "merged"]
    assert event["detail"]["source"] == "Voter file"
    assert event["references"] == {
        joined["id"]: joined["reference"],
        right["id"]: right["reference"],
    }
    assert left["reference"].startswith("ORG-")


def test_split_parts_carry_new_references_counts_and_the_source(finance_api, board):
    person, first, second, _ = two_confirmations(finance_api, board)
    done = post(
        finance_api,
        f"/{person['id']}/split",
        {
            "reason": "2 people.",
            "source": "Board register, 2 addresses",
            "parts": [
                {"name": "Jordan A", "confirmations": [first]},
                {"name": "Jordan B", "confirmations": [second]},
            ],
        },
    ).json()["data"]
    parts = done["split_into"]
    # In the split's own order, each with a new reference and its confirmed records.
    assert [part["name"] for part in parts] == ["Jordan A", "Jordan B"]
    references = [part["reference"] for part in parts]
    assert len(set(references + [person["reference"]])) == 3
    assert [number(r, "PER") for r in references] == sorted(
        number(r, "PER") for r in references
    )
    assert [part["confirmed_records"] for part in parts] == [1, 1]
    old = {c["id"]: c for c in done["confirmations"]}
    assert old[first]["withdrawal_source"] == "Board register, 2 addresses"
    [event] = [e for e in done["history"] if e["action"] == "split"]
    assert event["detail"]["source"] == "Board register, 2 addresses"
    assert event["references"] == {
        person["id"]: person["reference"],
        parts[0]["id"]: references[0],
        parts[1]["id"]: references[1],
    }
    part = get(finance_api, parts[0]["id"])
    assert part["reference"] == references[0]
    [created] = [e for e in part["history"] if e["action"] == "created"]
    assert created["references"] == {person["id"]: person["reference"]}
    # The replacement keeps the original confirmation's source.
    [replacement] = part["confirmations"]
    assert replacement["source"] == old[first]["source"]


def test_the_payees_directory_names_a_confirmed_identity_by_reference(
    finance_api, board
):
    [vendor] = prints(finance_api, "payee_name", VENDOR).values()
    firm = create(finance_api, "organization", "Confirmed firm", payee(board, [vendor]))
    rows = payees(finance_api)["rows"]
    [confirmed] = [r for r in rows if r["identity"]]
    assert confirmed["identity"] == {
        "id": firm["id"],
        "reference": firm["reference"],
        "kind": "organization",
        "name": "Confirmed firm",
    }
