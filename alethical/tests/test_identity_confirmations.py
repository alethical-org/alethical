"""Finance identity confirmations: record-by-record names, evidence, merges, splits."""

# ruff: noqa: F811 -- pytest fixtures arrive as parameters named after the imports

from __future__ import annotations

import json
import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import event, select, text, update
from sqlalchemy.exc import IntegrityError

from alethical.api.services import finance_access
from alethical.api.services import identity_confirmations as identities
from alethical.db import models as m
from alethical.tests.finance_fixtures import (  # noqa: F401
    FINANCE_EMAIL,
    finance_api,
    finance_db,
)
from alethical.tests.test_campaign_finance_landing_reads import (
    FilerKind as _FilerKind,
)
from alethical.tests.test_campaign_finance_landing_reads import _published_release

BASE = "/api/v1/finance/identities"
DONOR = "Example, Jordan A"
EMPLOYER = "Example Health Association"
VENDOR = "Example Media LLC"
# The printed fields each kind of record is fingerprinted by, beside the kind and
# the file (docs/architecture/alethical-finance-architecture.md §4).
FINGERPRINTED = {
    "donor_name": {
        "contributor",
        "contrib_employer_name",
        "recipient_reg_num",
        "receipt_date",
        "amount",
        "contrib_zip",
    },
    "employer_name": {
        "contributor",
        "contrib_employer_name",
        "recipient_reg_num",
        "receipt_date",
        "amount",
        "contrib_zip",
    },
    "payee_name": {
        "vendor_name",
        "committee_reg_num",
        "transaction_date",
        "amount",
        "vendor_zip",
    },
    "independent_payee_name": {
        "vendor_name",
        "spender_reg_num",
        "transaction_date",
        "amount",
        "vendor_zip",
    },
}


def gift(snapshot_id, row_number, **change):
    printed = {
        "contributor": DONOR,
        "contrib_employer_name": EMPLOYER,
        "recipient_reg_num": "18135",
        "recipient": "Example for Senate",
        "receipt_date": date(2026, 3, 2),
        "amount": Decimal("250"),
        "contrib_zip": "55101",
        "year": 2026,
        "receipt_type": "Contribution",
    }
    return m.CampaignFinanceContributionRow(
        snapshot_id=snapshot_id, row_number=row_number, **{**printed, **change}
    )


@pytest.fixture()
def board(finance_db):  # noqa: F811
    """The Board's current files: 3 gifts from 1 donor, 2 of them identical."""
    release = _published_release(finance_db)
    gave = release.contributions_snapshot_id
    finance_db.add(gift(gave, 31))
    finance_db.add(
        gift(gave, 32, receipt_date=date(2025, 5, 1), amount=Decimal(100), year=2025)
    )
    finance_db.add(gift(gave, 33))
    finance_db.add(gift(gave, 34, contributor="Example, Morgan"))
    finance_db.add(
        m.CampaignFinanceExpenditureRow(
            snapshot_id=release.expenditures_snapshot_id,
            row_number=52,
            committee_reg_num="18135",
            vendor_name=VENDOR,
            vendor_zip="55401",
            transaction_date=date(2026, 4, 1),
            amount=Decimal("1200.5"),
            purpose="ADVERTISING",
            year=2026,
        )
    )
    finance_db.add(
        m.CampaignFinanceIndependentExpenditureRow(
            snapshot_id=release.independent_expenditures_snapshot_id,
            row_number=7,
            spender_reg_num="40100",
            vendor_name=VENDOR,
            vendor_zip="55401",
            transaction_date=date(2026, 5, 1),
            amount=Decimal(900),
            purpose="Mail",
            year=2026,
        )
    )
    # Commit into the test's outer transaction, so a refused request's rollback
    # keeps the listed account and these rows; the outer transaction still ends
    # in a rollback.
    finance_db.commit()
    return release


def listing(api, kind="donor_name", key=DONOR):
    response = api.get(
        f"{BASE}/records", params={"record_kind": kind, "record_key": key}
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def prints(api, kind="donor_name", key=DONOR):
    """Each current row's fingerprint, by row number."""
    return {
        row["row_number"]: record["fingerprint"]
        for record in listing(api, kind, key)["fingerprints"]
        for row in record["rows"]
    }


def donor(board, fingerprints, key=DONOR, quote="EXAMPLE, JORDAN A"):
    return {
        "record_kind": "donor_name",
        "record_key": key,
        "relation": "Donor name as printed",
        "evidence_source": "cf_contribution_row",
        "evidence_snapshot_id": str(board.contributions_snapshot_id),
        "evidence_locator": 31,
        "evidence_quote": quote,
        "basis": "The registered lobbyist's address matches the donor row's address.",
        "fingerprints": fingerprints,
    }


def employer(board, fingerprints):
    return {
        **donor(board, fingerprints, key=EMPLOYER, quote="Health Association"),
        "record_kind": "employer_name",
        "relation": "Employer as printed",
    }


def payee(board, fingerprints):
    return {
        "record_kind": "payee_name",
        "record_key": VENDOR,
        "relation": "Payee name as printed",
        "evidence_source": "cf_expenditure_row",
        "evidence_snapshot_id": str(board.expenditures_snapshot_id),
        "evidence_locator": 52,
        "evidence_quote": VENDOR,
        "basis": "The vendor row names the advertising firm.",
        "fingerprints": fingerprints,
    }


def post(api, path, body):
    return api.post(f"{BASE}{path}", json=body)


def create(api, kind, name, confirmation):
    response = post(api, "", {"kind": kind, "name": name, "confirmation": confirmation})
    assert response.status_code == 201, response.text
    return response.json()["data"]


def get(api, entity_id):
    return api.get(f"{BASE}/{entity_id}").json()["data"]


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


def committee(registered, key="18135"):
    return {
        "record_kind": "committee",
        "record_key": key,
        "relation": "Candidate committee",
        "evidence_source": "cf_filer",
        "evidence_snapshot_id": str(registered),
        "evidence_quote": "Example for Senate",
        "basis": "The Board's register names the candidate.",
    }


# A printed name is confirmed record by record.


def test_a_printed_name_is_confirmed_record_by_record(finance_api, board):  # noqa: F811
    rows = prints(finance_api)
    assert rows[31] == rows[33] != rows[32]
    person = create(finance_api, "person", DONOR, donor(board, [rows[32]]))
    [confirmation] = person["confirmations"]
    [record] = confirmation["records"]
    assert (record["fingerprint"], record["rows"], record["in_board_file"]) == (
        rows[32],
        1,
        True,
    )
    assert person["printed_names"] == [
        {"record_kind": "donor_name", "record_key": DONOR, "records": 3, "confirmed": 1}
    ]
    # The same printed name on other records can be someone else.
    other = create(finance_api, "person", "Jordan A. Example", donor(board, [rows[31]]))
    assert other["printed_names"][0]["confirmed"] == 2
    listed = listing(finance_api)
    claimed = {
        record["fingerprint"]: record["confirmation"]["identity"]["id"]
        for record in listed["fingerprints"]
    }
    assert claimed == {rows[32]: person["id"], rows[31]: other["id"]}
    assert (listed["records"], listed["confirmed"]) == (3, 3)


def test_identical_repeated_rows_share_1_claim(finance_api, board):  # noqa: F811
    rows = prints(finance_api)
    person = create(finance_api, "person", DONOR, donor(board, [rows[31]]))
    [record] = person["confirmations"][0]["records"]
    assert record["rows"] == 2
    [shared] = [
        r for r in listing(finance_api)["fingerprints"] if r["fingerprint"] == rows[31]
    ]
    assert [row["row_number"] for row in shared["rows"]] == [31, 33]
    assert shared["confirmation"]["identity"]["id"] == person["id"]


@pytest.mark.parametrize("kind", sorted(FINGERPRINTED))
def test_each_kind_of_record_is_fingerprinted_by_its_printed_fields(
    finance_api, board, kind
):  # noqa: F811
    key = {"employer_name": EMPLOYER}.get(kind, VENDOR if "payee" in kind else DONOR)
    for record in listing(finance_api, kind, key)["fingerprints"]:
        assert set(record["fields"]) == FINGERPRINTED[kind]
        assert record["fields"]["amount"] in {
            "250.0000",
            "100.0000",
            "1200.5000",
            "900.0000",
        }


@pytest.mark.parametrize(
    ("change", "same"),
    [
        ({"contrib_employer_name": "Other Employer"}, False),
        ({"recipient_reg_num": "18136"}, False),
        ({"receipt_date": date(2026, 3, 3)}, False),
        ({"amount": Decimal("250.01")}, False),
        ({"contrib_zip": "55102"}, False),
        # Not a fingerprinted field: the same record, printed again.
        ({"recipient": "Friends of Example", "year": 2027}, True),
    ],
)
def test_a_record_differs_when_a_fingerprinted_field_differs(
    finance_api, finance_db, board, change, same
):  # noqa: F811
    finance_db.add(gift(board.contributions_snapshot_id, 40, **change))
    finance_db.commit()
    rows = prints(finance_api)
    assert (rows[40] == rows[31]) is same


def refresh(db, *gifts):
    """The next copy of the Board's files: new snapshot ids, new row numbers."""
    release = _published_release(db, fetched=datetime(2026, 9, 1, tzinfo=UTC))
    for number, change in gifts:
        db.add(gift(release.contributions_snapshot_id, number, **change))
    db.commit()
    return release


def test_a_refresh_re_matches_records_and_keeps_those_that_left(
    finance_api, finance_db, board
):  # noqa: F811
    rows = prints(finance_api)
    person = create(finance_api, "person", DONOR, donor(board, [rows[31], rows[32]]))
    # Row 32 is gone, rows 31 and 33 moved, and 1 new gift arrived.
    refresh(
        finance_db,
        (5, {}),
        (6, {}),
        (7, {"receipt_date": date(2026, 9, 1), "amount": Decimal(75)}),
    )
    after = get(finance_api, person["id"])
    records = {r["fingerprint"]: r for r in after["confirmations"][0]["records"]}
    assert (records[rows[31]]["rows"], records[rows[31]]["in_board_file"]) == (2, True)
    assert (records[rows[32]]["rows"], records[rows[32]]["in_board_file"]) == (0, False)
    assert records[rows[32]]["fields"]["receipt_date"] == "2025-05-01"
    assert after["printed_names"][0] == {
        "record_kind": "donor_name",
        "record_key": DONOR,
        "records": 3,
        "confirmed": 2,
    }
    listed = listing(finance_api)
    new = prints(finance_api)
    # The new gift is not covered until someone confirms it.
    [arrived] = [r for r in listed["fingerprints"] if r["fingerprint"] == new[7]]
    assert arrived["confirmation"] is None
    [gone] = listed["no_longer_in_board_file"]
    assert gone["fingerprint"] == rows[32]
    assert gone["confirmation"]["identity"]["id"] == person["id"]


def test_a_record_belongs_to_1_active_confirmation(finance_api, board, monkeypatch):  # noqa: F811
    rows = prints(finance_api)
    create(finance_api, "person", DONOR, donor(board, [rows[31]]))
    again = post(
        finance_api,
        "",
        {"kind": "person", "name": "Y", "confirmation": donor(board, [rows[31]])},
    )
    assert again.status_code == 422
    assert "already confirmed" in again.json()["detail"]
    # A 2nd request that read before the 1st saved: the database still refuses it.
    monkeypatch.setattr(identities, "_taken", lambda *_: [])
    raced = post(
        finance_api,
        "",
        {"kind": "person", "name": "Y", "confirmation": donor(board, [rows[31]])},
    )
    assert raced.status_code == 409


def test_the_database_holds_each_record_to_1_active_confirmation(
    finance_api, finance_db, board
):  # noqa: F811
    rows = prints(finance_api)
    person = create(finance_api, "person", DONOR, donor(board, [rows[31]]))
    confirmation_id = uuid.UUID(person["confirmations"][0]["id"])
    second = m.IdentityConfirmation(
        entity_id=uuid.UUID(person["id"]),
        record_kind="donor_name",
        record_key=DONOR,
        relation="Donor name as printed",
        evidence_source="cf_contribution_row",
        evidence_quote=DONOR,
        basis="A second claim on the same record.",
        made_by_alethical_team=False,
    )
    finance_db.add(second)
    finance_db.flush()
    with pytest.raises(IntegrityError), finance_db.begin_nested():
        finance_db.add(
            m.IdentityConfirmedRecord(
                confirmation_id=second.id,
                fingerprint=rows[31],
                record_kind="donor_name",
                fields={},
            )
        )
        finance_db.flush()
    # A record is active exactly when its confirmation is.
    with pytest.raises(IntegrityError), finance_db.begin_nested():
        finance_db.execute(
            update(m.IdentityConfirmedRecord)
            .where(m.IdentityConfirmedRecord.confirmation_id == confirmation_id)
            .values(active=False)
        )


@pytest.mark.parametrize(
    ("fingerprints", "message"),
    [
        (None, "Select at least 1 record"),
        ([], "Select at least 1 record"),
        (["x" * 64], "fingerprints the listing gives"),
        ([1], "Request validation failed"),
        (["0" * 64], "not in the Board's current file"),
        ("twice", "Select each record once"),
    ],
)
def test_the_selection_is_current_records_printing_this_name(
    finance_api, board, fingerprints, message
):  # noqa: F811
    rows = prints(finance_api)
    if fingerprints == "twice":
        fingerprints = [rows[31], rows[31]]
    response = post(
        finance_api,
        "",
        {"kind": "person", "name": "X", "confirmation": donor(board, fingerprints)},
    )
    assert response.status_code == 422
    assert message in response.json()["detail"]


def test_a_record_of_another_name_is_not_selectable(finance_api, board):  # noqa: F811
    [morgan] = prints(finance_api, "donor_name", "Example, Morgan").values()
    response = post(
        finance_api,
        "",
        {"kind": "person", "name": "X", "confirmation": donor(board, [morgan])},
    )
    assert response.status_code == 422
    assert "not in the Board's current file" in response.json()["detail"]


def test_a_record_only_in_an_older_copy_is_refused(finance_api, finance_db, board):  # noqa: F811
    rows = prints(finance_api)
    # The next copy holds rows 31 and 33 again; row 32 is only in the older one.
    refresh(finance_db, (5, {}), (6, {}))
    response = post(
        finance_api,
        "",
        {"kind": "person", "name": "X", "confirmation": donor(board, [rows[32]])},
    )
    assert response.status_code == 422
    assert "not in the Board's current file" in response.json()["detail"]


def test_listing_pages_keep_whole_fingerprints_and_counts(finance_api, board):
    rows = prints(finance_api)
    person = create(finance_api, "person", DONOR, donor(board, [rows[32]]))
    params = {"record_kind": "donor_name", "record_key": DONOR, "page_size": 1}
    first = finance_api.get(f"{BASE}/records", params=params).json()["data"]
    second = finance_api.get(
        f"{BASE}/records",
        params={**params, "page": 2, "snapshot_id": first["snapshot_id"]},
    ).json()["data"]
    assert (
        first["records"],
        first["confirmed"],
        first["total_fingerprints"],
        first["pages"],
    ) == (3, 1, 2, 2)
    assert first["years"] == [2026, 2025]
    assert [r["row_number"] for r in first["fingerprints"][0]["rows"]] == [31, 33]
    assert second["fingerprints"][0]["confirmation"]["identity"]["id"] == person["id"]
    assert second["no_longer_in_board_file"] == first["no_longer_in_board_file"] == []
    assert second["confirmed"] == 1
    assert len(second["fingerprints"]) == 1
    selected = [first["fingerprints"][0]["fingerprint"]]
    create(finance_api, "person", "Other person", donor(board, selected))


@pytest.mark.parametrize("pick", ["explicit", "all", "year"])
def test_over_5000_records_can_be_reviewed_and_confirmed(
    finance_api, finance_db, board, pick
):
    finance_db.add_all(
        [
            gift(board.contributions_snapshot_id, 100 + i, amount=Decimal(i + 1000))
            for i in range(5001)
        ]
    )
    finance_db.commit()
    params = {"record_kind": "donor_name", "record_key": DONOR, "page_size": 500}
    first = finance_api.get(f"{BASE}/records", params=params).json()["data"]
    assert (first["records"], first["total_fingerprints"]) == (5004, 5003)
    if pick == "explicit":
        selected = [item["fingerprint"] for item in first["fingerprints"]]
        for page in range(2, first["pages"] + 1):
            result = finance_api.get(
                f"{BASE}/records",
                params={**params, "page": page, "snapshot_id": first["snapshot_id"]},
            )
            assert result.status_code == 200
            selected.extend(
                item["fingerprint"] for item in result.json()["data"]["fingerprints"]
            )
        assert len(selected) == len(set(selected)) == 5003
        confirmation = donor(board, selected)
    else:
        selection = {"snapshot_id": first["snapshot_id"]}
        if pick == "year":
            selection["year"] = 2026
        confirmation = {**donor(board, None), "record_selection": selection}
    person = create(finance_api, "person", DONOR, confirmation)
    coverage = person["printed_names"][0]
    assert coverage["confirmed"] == (5003 if pick == "year" else 5004)
    assert coverage["records"] == 5004


def test_quick_selection_skips_claims_and_refuses_changed_files(
    finance_api, finance_db, board
):
    rows = prints(finance_api)
    create(finance_api, "person", DONOR, donor(board, [rows[32]]))
    selection = {"snapshot_id": str(board.contributions_snapshot_id)}
    person = create(
        finance_api,
        "person",
        "Other person",
        {**donor(board, None), "record_selection": selection},
    )
    assert person["printed_names"][0]["confirmed"] == 2
    refresh(finance_db, (5, {}), (6, {}))
    response = post(
        finance_api,
        "",
        {
            "kind": "person",
            "name": "Changed",
            "confirmation": {**donor(board, None), "record_selection": selection},
        },
    )
    assert response.status_code == 422
    assert "file changed" in response.json()["detail"]
    response = finance_api.get(
        f"{BASE}/records",
        params={"record_kind": "donor_name", "record_key": DONOR, **selection},
    )
    assert response.status_code == 422
    assert "file changed" in response.json()["detail"]


def test_without_the_boards_file_nothing_is_called_gone(finance_api, finance_db, board):  # noqa: F811
    rows = prints(finance_api)
    person = create(finance_api, "person", DONOR, donor(board, [rows[31]]))
    finance_db.execute(text("DELETE FROM cf_current_release"))
    finance_db.commit()
    [record] = get(finance_api, person["id"])["confirmations"][0]["records"]
    assert (record["rows"], record["in_board_file"]) == (None, None)
    unavailable = finance_api.get(
        f"{BASE}/records", params={"record_kind": "donor_name", "record_key": DONOR}
    )
    assert unavailable.status_code == 503


def test_names_are_listed_and_identifiers_looked_up(finance_api, board):  # noqa: F811
    by_name = finance_api.get(
        f"{BASE}/lookup", params={"record_kind": "donor_name", "record_key": DONOR}
    )
    assert by_name.status_code == 422
    assert "record by record" in by_name.json()["detail"]
    by_number = finance_api.get(
        f"{BASE}/records", params={"record_kind": "committee", "record_key": "18135"}
    )
    assert by_number.status_code == 422


# A registration number or held record is an identity for all time.


def test_a_committee_is_confirmed_by_its_registration_number(finance_api, registered):  # noqa: F811
    created = create(
        finance_api, "organization", "Example for Senate", committee(registered)
    )
    [confirmation] = created["confirmations"]
    assert confirmation["evidence"]["locator"] == "18135"
    assert confirmation["records"] is None
    found = finance_api.get(
        f"{BASE}/lookup", params={"record_kind": "committee", "record_key": "18135"}
    ).json()["data"]
    assert found["identity"]["id"] == created["id"]
    unknown = post(
        finance_api,
        "",
        {
            "kind": "organization",
            "name": "X",
            "confirmation": committee(registered, "99999"),
        },
    )
    assert unknown.status_code == 422
    assert "No such row" in unknown.json()["detail"]
    chosen = post(
        finance_api,
        "",
        {
            "kind": "organization",
            "name": "X",
            "confirmation": {**committee(registered), "fingerprints": ["0" * 64]},
        },
    )
    assert chosen.status_code == 422
    assert "confirmed whole" in chosen.json()["detail"]


def test_an_identifier_is_confirmed_for_1_identity_at_a_time(
    finance_api, registered, monkeypatch
):  # noqa: F811
    create(finance_api, "organization", "Example for Senate", committee(registered))
    body = {"kind": "organization", "name": "Y", "confirmation": committee(registered)}
    assert post(finance_api, "", body).status_code == 422
    # The 2nd request read before the 1st saved; the database still refuses it.
    monkeypatch.setattr(identities, "_standing", lambda *_: None)
    assert post(finance_api, "", body).status_code == 409


def test_a_withdrawn_identifier_is_free_to_confirm_again(finance_api, registered):  # noqa: F811
    first = create(
        finance_api, "organization", "Example for Senate", committee(registered)
    )
    withdrawn = post(
        finance_api,
        f"/confirmations/{first['confirmations'][0]['id']}/withdraw",
        {"reason": "The register names another committee."},
    )
    assert withdrawn.status_code == 200

    def lookup():
        response = finance_api.get(
            f"{BASE}/lookup", params={"record_kind": "committee", "record_key": "18135"}
        )
        assert response.status_code == 200, response.text
        return response.json()["data"]

    assert lookup() is None
    again = create(
        finance_api, "organization", "Example Senate Committee", committee(registered)
    )
    assert lookup()["identity"]["id"] == again["id"]


@pytest.mark.parametrize(
    ("kind", "key"),
    [
        ("legislator", "upper"),
        ("legislator", "braced"),
        ("committee", " 18135"),
        ("committee", "18135 "),
    ],
)
def test_lookup_refuses_a_differently_written_key(
    finance_api, finance_db, registered, kind, key
):  # noqa: F811
    legislator = finance_db.scalar(select(m.Legislator))
    create(finance_api, "person", legislator.full_name, held_link(legislator))
    create(finance_api, "organization", "Example for Senate", committee(registered))
    key = {"upper": str(legislator.id).upper(), "braced": f"{{{legislator.id}}}"}.get(
        key, key
    )
    response = finance_api.get(
        f"{BASE}/lookup", params={"record_kind": kind, "record_key": key}
    )
    assert response.status_code == 422


def test_a_held_person_record_needs_an_official_page(finance_api, finance_db, board):  # noqa: F811
    legislator = finance_db.scalar(select(m.Legislator))
    plain = held_link(legislator, evidence_url="http://www.leg.mn.gov/")
    body = {"kind": "person", "name": "X", "confirmation": plain}
    assert post(finance_api, "", body).status_code == 422
    link = held_link(legislator, evidence_url="https://www.leg.mn.gov/members")
    created = create(finance_api, "person", legislator.full_name, link)
    assert created["confirmations"][0]["evidence"]["url"] == link["evidence_url"]
    found = finance_api.get(
        f"{BASE}/lookup",
        params={"record_kind": "legislator", "record_key": str(legislator.id)},
    ).json()["data"]
    assert found["identity"]["id"] == created["id"]


def test_only_a_person_holds_a_legislator_record(finance_api, finance_db, board):  # noqa: F811
    legislator = finance_db.scalar(select(m.Legislator))
    response = post(
        finance_api,
        "",
        {
            "kind": "organization",
            "name": "Example Caucus",
            "confirmation": held_link(legislator),
        },
    )
    assert response.status_code == 422
    assert "Only a person" in response.json()["detail"]


@pytest.mark.parametrize(
    ("url", "message"),
    [
        ("https://example.org/members", "official Minnesota site"),
        ("https://mn.gov.example.org/x", "official Minnesota site"),
        ("https://evil.example\\.mn.gov/x", "https address"),
        ("https://evil.example\\@www.leg.mn.gov/", "https address"),
        ("https://www.senate.mn /x", "https address"),
        ("ftp://www.senate.mn/x", "https address"),
        ("https://www.senate.mn/é", "https address"),
    ],
)
def test_an_official_page_is_on_a_minnesota_site(finance_api, finance_db, url, message):  # noqa: F811
    legislator = finance_db.scalar(select(m.Legislator))
    confirmation = held_link(legislator, evidence_url=url)
    response = post(
        finance_api, "", {"kind": "person", "name": "X", "confirmation": confirmation}
    )
    assert response.status_code == 422
    assert message in response.json()["detail"]


# Evidence is required and checked.


def test_a_confirmation_keeps_its_evidence_and_never_names_who_made_it(
    finance_api, board
):  # noqa: F811
    rows = prints(finance_api)
    person = create(finance_api, "person", DONOR, donor(board, [rows[31]]))
    assert person["kind"] == "person" and person["status"] == "active"
    [confirmation] = person["confirmations"]
    assert confirmation["record_key"] == DONOR
    assert confirmation["evidence"] == {
        "source": "cf_contribution_row",
        "snapshot_id": str(board.contributions_snapshot_id),
        "locator": "31",
        "url": None,
        "quote": "EXAMPLE, JORDAN A",
    }
    assert [event["action"] for event in person["history"]] == ["created", "confirmed"]
    answer = str(person) + str(listing(finance_api))
    assert "made_by_alethical_team" not in answer and FINANCE_EMAIL not in answer


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"record_key": "EXAMPLE, JORDAN"}, "does not print this exact record"),
        ({"record_key": " Example, Jordan A"}, "exactly as printed"),
        ({"evidence_quote": "SOMEONE ELSE"}, "must appear in the evidence row"),
        ({"evidence_quote": "Jo"}, "at least 3 characters"),
        # The contributor ends, then the receipt type begins: 2 values, not 1.
        ({"evidence_quote": "Jordan A Contribution"}, "must appear in the evidence"),
        ({"evidence_locator": 999}, "No such row"),
        ({"evidence_locator": 2**40}, "Name the row"),
        ({"evidence_snapshot_id": "x"}, "Name the saved source copy"),
        ({"evidence_source": "cf_expenditure_row"}, "cannot show this kind"),
        ({"basis": " "}, "Basis is required"),
        ({"basis": "A\x00B"}, "cannot be saved"),
    ],
)
def test_evidence_must_print_exactly_the_record_claimed(
    finance_api, board, change, message
):  # noqa: F811
    rows = prints(finance_api)
    confirmation = {**donor(board, [rows[31]]), **change}
    response = post(
        finance_api, "", {"kind": "person", "name": "X", "confirmation": confirmation}
    )
    assert response.status_code == 422
    assert message in response.json()["detail"]


@pytest.mark.parametrize(
    "body",
    [
        {"kind": "person", "name": "X", "confirmation": ["not", "a", "record"]},
        {"kind": "person", "name": "X", "confirmation": None},
        {"kind": "person", "name": "X\x00", "confirmation": {}},
        {"kind": ["person"], "name": "X", "confirmation": {}},
    ],
)
def test_malformed_requests_are_refused_not_failed(finance_api, board, body):  # noqa: F811
    assert post(finance_api, "", body).status_code == 422


@pytest.mark.parametrize("source", [["cf_contribution_row"], {"a": 1}, 7])
def test_a_non_text_evidence_source_is_refused(finance_api, board, source):  # noqa: F811
    rows = prints(finance_api)
    confirmation = {**donor(board, [rows[31]]), "evidence_source": source}
    response = post(
        finance_api, "", {"kind": "person", "name": "X", "confirmation": confirmation}
    )
    assert response.status_code == 422
    # The service refuses it too, when called without the router's typed body.
    with pytest.raises(identities.IdentityError):
        identities._evidence(None, "donor_name", DONOR, confirmation)


SURROGATE = "\ud800"


@pytest.mark.parametrize(
    ("field", "message"),
    [
        ("name", "Name contains a character that cannot be saved"),
        ("relation", "Relation contains a character that cannot be saved"),
        ("basis", "Basis contains a character that cannot be saved"),
        ("evidence_quote", "evidence contains a character that cannot be saved"),
        ("record_key", "Record contains a character that cannot be saved"),
        ("evidence_url", "https address"),
    ],
)
def test_a_lone_surrogate_is_refused_not_failed(
    finance_api, finance_db, board, field, message
):  # noqa: F811
    rows = prints(finance_api)
    legislator = finance_db.scalar(select(m.Legislator))
    confirmation = (
        held_link(legislator) if field == "evidence_url" else donor(board, [rows[31]])
    )
    body = {"kind": "person", "name": "X", "confirmation": confirmation}
    if field == "name":
        body["name"] += SURROGATE
    else:
        confirmation[field] += SURROGATE
    response = finance_api.post(
        BASE, content=json.dumps(body), headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 422, response.text
    assert message in response.json()["detail"]


def test_a_lone_surrogate_in_a_reason_or_part_is_refused(finance_api, board):  # noqa: F811
    person, first, second, _ = two_confirmations(finance_api, board)
    rows = prints(finance_api, "payee_name", VENDOR)
    other = create(finance_api, "person", "B", payee(board, list(rows.values())))

    def send(path, body):
        response = finance_api.post(
            f"{BASE}{path}",
            content=json.dumps(body),
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 422, response.text
        return response.json()["detail"]

    withdraw = f"/confirmations/{first}/withdraw"
    assert "cannot be saved" in send(withdraw, {"reason": SURROGATE})
    merge = f"/{person['id']}/merge"
    assert "cannot be saved" in send(merge, {"into": other["id"], "reason": SURROGATE})
    assert "Name the identity" in send(merge, {"into": SURROGATE, "reason": "x"})
    parts = [
        {"name": f"A{SURROGATE}", "confirmations": [first]},
        {"name": "B", "confirmations": [second]},
    ]
    split = f"/{person['id']}/split"
    assert "cannot be saved" in send(split, {"reason": "x", "parts": parts})
    assert get(finance_api, person["id"])["status"] == "active"


def test_evidence_notes_are_documented_as_readable_by_every_account(client):
    schemas = client.app.openapi()["components"]["schemas"]
    for model, field in [
        ("IdentityConfirmationRequest", "basis"),
        ("IdentityConfirmationRequest", "relation"),
        ("IdentityCreateRequest", "name"),
        ("IdentityWithdrawRequest", "reason"),
        ("IdentityMergeRequest", "reason"),
        ("IdentitySplitRequest", "reason"),
        ("IdentitySplitPart", "name"),
    ]:
        description = schemas[model]["properties"][field]["description"]
        assert "Every Finance account can read this" in description, (model, field)


# Decisions are append-only; merges redirect; splits replace.


def test_a_withdrawal_is_once_and_frees_the_record_everywhere(
    finance_api, finance_db, board
):  # noqa: F811
    rows = prints(finance_api)
    first = create(finance_api, "person", DONOR, donor(board, [rows[31], rows[32]]))
    confirmation_id = first["confirmations"][0]["id"]
    withdrawn = post(
        finance_api,
        f"/confirmations/{confirmation_id}/withdraw",
        {"reason": "The address belongs to a different person."},
    ).json()["data"]
    [taken_back] = withdrawn["confirmations"]
    assert taken_back["status"] == "withdrawn" and taken_back["withdrawn_at"]
    assert taken_back["withdrawal_reason"].startswith("The address")
    # Everything else stays exactly as it was confirmed.
    changed = {"status", "withdrawn_at", "withdrawal_reason"}
    assert {k: v for k, v in taken_back.items() if k not in changed} == {
        k: v for k, v in first["confirmations"][0].items() if k not in changed
    }
    assert withdrawn["printed_names"] == []
    assert all(r["confirmation"] is None for r in listing(finance_api)["fingerprints"])
    held = finance_db.scalars(
        select(m.IdentityConfirmedRecord.active).where(
            m.IdentityConfirmedRecord.confirmation_id == uuid.UUID(confirmation_id)
        )
    ).all()
    assert held == [False, False]
    again = post(
        finance_api, f"/confirmations/{confirmation_id}/withdraw", {"reason": "Again."}
    )
    assert again.status_code == 422
    assert "already withdrawn" in again.json()["detail"]
    create(finance_api, "person", "Jordan B", donor(board, [rows[31]]))


def test_a_merge_moves_no_confirmation_and_lookups_follow_it(
    finance_api, finance_db, board, registered
):  # noqa: F811
    a = create(
        finance_api,
        "organization",
        "Example Media",
        payee(board, [rows_of(finance_api)]),
    )
    b = create(finance_api, "organization", "Example for Senate", committee(registered))
    c = m.IdentityEntity(kind="organization", name="C", made_by_alethical_team=False)
    finance_db.add(c)
    finance_db.commit()
    merged = post(
        finance_api, f"/{a['id']}/merge", {"into": b["id"], "reason": "Same firm."}
    ).json()["data"]
    assert {conf["identity_id"] for conf in merged["confirmations"]} == {
        a["id"],
        b["id"],
    }
    post(finance_api, f"/{b['id']}/merge", {"into": str(c.id), "reason": "Same."})
    old = get(finance_api, a["id"])
    assert (old["status"], old["redirect_to"]) == ("merged", str(c.id))
    assert [conf["identity_id"] for conf in old["confirmations"]] == [a["id"]]
    assert len(get(finance_api, str(c.id))["confirmations"]) == 2
    found = finance_api.get(
        f"{BASE}/lookup", params={"record_kind": "committee", "record_key": "18135"}
    ).json()["data"]
    assert found["identity"]["id"] == str(c.id)
    [record] = listing(finance_api, "payee_name", VENDOR)["fingerprints"]
    assert record["confirmation"]["identity"]["id"] == str(c.id)
    blocked = post(finance_api, f"/{a['id']}/confirmations", committee(registered))
    assert blocked.status_code == 422
    assert "merged or split" in blocked.json()["detail"]


def rows_of(api):
    [fingerprint] = prints(api, "payee_name", VENDOR).values()
    return fingerprint


def test_a_merged_identitys_confirmation_can_be_withdrawn(
    finance_api, board, registered
):  # noqa: F811
    a = create(
        finance_api,
        "organization",
        "Example Media",
        payee(board, [rows_of(finance_api)]),
    )
    b = create(finance_api, "organization", "Example for Senate", committee(registered))
    post(finance_api, f"/{a['id']}/merge", {"into": b["id"], "reason": "Same firm."})
    confirmation_id = a["confirmations"][0]["id"]
    done = post(
        finance_api,
        f"/confirmations/{confirmation_id}/withdraw",
        {"reason": "Not this firm."},
    )
    assert done.status_code == 200
    [record] = listing(finance_api, "payee_name", VENDOR)["fingerprints"]
    assert record["confirmation"] is None


def test_a_person_never_merges_into_an_organization(finance_api, board, registered):  # noqa: F811
    rows = prints(finance_api)
    person = create(finance_api, "person", DONOR, donor(board, [rows[31]]))
    organization = create(
        finance_api, "organization", "Example for Senate", committee(registered)
    )
    response = post(
        finance_api,
        f"/{person['id']}/merge",
        {"into": organization["id"], "reason": "x"},
    )
    assert response.status_code == 422


def test_an_identity_never_merges_into_itself(finance_api, finance_db, board):  # noqa: F811
    rows = prints(finance_api)
    a = create(finance_api, "person", DONOR, donor(board, [rows[31]]))
    response = post(finance_api, f"/{a['id']}/merge", {"into": a["id"], "reason": "x"})
    assert response.status_code == 422
    assert "itself" in response.json()["detail"]
    # The database refuses it too.
    with pytest.raises(IntegrityError), finance_db.begin_nested():
        finance_db.execute(
            update(m.IdentityEntity)
            .where(m.IdentityEntity.id == uuid.UUID(a["id"]))
            .values(status="merged", merged_into_id=uuid.UUID(a["id"]))
        )


def added(api, person, confirmation):
    """The id of the confirmation this request adds to the person."""
    before = {c["id"] for c in get(api, person["id"])["confirmations"]}
    response = post(api, f"/{person['id']}/confirmations", confirmation)
    assert response.status_code == 201, response.text
    [new] = [
        c["id"]
        for c in response.json()["data"]["confirmations"]
        if c["id"] not in before
    ]
    return new


def two_confirmations(api, board):
    """1 person with 2 active confirmations and 1 withdrawn one."""
    donors = prints(api)
    employers = prints(api, "employer_name", EMPLOYER)
    person = create(api, "person", "Example, Jordan", donor(board, [donors[31]]))
    first = person["confirmations"][0]["id"]
    second = added(api, person, employer(board, [employers[32]]))
    withdrawn = added(api, person, donor(board, [donors[32]]))
    post(api, f"/confirmations/{withdrawn}/withdraw", {"reason": "Not him."})
    return person, first, second, withdrawn


def test_a_split_replaces_each_confirmation_on_its_part(finance_api, board):  # noqa: F811
    person, first, second, withdrawn = two_confirmations(finance_api, board)
    done = post(
        finance_api,
        f"/{person['id']}/split",
        {
            "reason": "2 people.",
            "parts": [
                {"name": "Jordan A", "confirmations": [first]},
                {"name": "Jordan B", "confirmations": [second]},
            ],
        },
    ).json()["data"]
    assert done["status"] == "split"
    names = {part["name"]: part["id"] for part in done["split_into"]}
    old = {c["id"]: c for c in done["confirmations"]}
    # Withdrawn records stay behind; moved ones are withdrawn and point onward.
    assert old[withdrawn]["replaced_by"] is None
    assert {old[first]["status"], old[second]["status"]} == {"withdrawn"}
    jordan_a = get(finance_api, names["Jordan A"])
    [replacement] = jordan_a["confirmations"]
    assert replacement["replaces"] == first
    assert old[first]["replaced_by"] == replacement["id"]
    for field in (
        "record_kind",
        "record_key",
        "relation",
        "basis",
        "evidence",
        "checked_at",
    ):
        assert replacement[field] == old[first][field], field
    assert [r["fingerprint"] for r in replacement["records"]] == [
        r["fingerprint"] for r in old[first]["records"]
    ]
    assert jordan_a["printed_names"][0]["confirmed"] == 2
    [event] = [e for e in done["history"] if e["action"] == "split"]
    by_part = {p["id"]: p["confirmations"] for p in event["detail"]["parts"]}
    assert by_part[names["Jordan A"]] == [{"from": first, "to": replacement["id"]}]
    donors = {
        r["confirmation"]["identity"]["id"] if r["confirmation"] else None
        for r in listing(finance_api)["fingerprints"]
    }
    assert donors == {names["Jordan A"], None}
    employers = {
        r["confirmation"]["identity"]["id"] if r["confirmation"] else None
        for r in listing(finance_api, "employer_name", EMPLOYER)["fingerprints"]
    }
    assert employers == {names["Jordan B"], None}


@pytest.mark.parametrize(
    "parts",
    [
        # The second confirmation is left out.
        [{"name": "A", "confirmations": ["first"]}, {"name": "B", "confirmations": []}],
        [{"name": "A", "confirmations": ["first"]}],
        # A withdrawn confirmation is not the split's to give.
        [
            {"name": "A", "confirmations": ["first", "withdrawn"]},
            {"name": "B", "confirmations": ["second"]},
        ],
        [
            {"name": "A", "confirmations": ["first", "second"]},
            {"name": "B", "confirmations": ["second"]},
        ],
        [
            {"name": "A", "confirmations": ["first"]},
            {"name": "B", "confirmations": ["withdrawn"]},
        ],
    ],
)
def test_a_split_gives_every_active_confirmation_to_exactly_1_part(
    finance_api, board, parts
):  # noqa: F811
    person, first, second, withdrawn = two_confirmations(finance_api, board)
    ids = {"first": first, "second": second, "withdrawn": withdrawn}
    parts = [
        {**part, "confirmations": [ids[c] for c in part["confirmations"]]}
        for part in parts
    ]
    response = post(
        finance_api, f"/{person['id']}/split", {"reason": "x", "parts": parts}
    )
    assert response.status_code == 422
    assert get(finance_api, person["id"])["status"] == "active"


def test_a_split_refuses_to_leave_out_an_active_confirmation(finance_api, board):  # noqa: F811
    person, first, second, _ = two_confirmations(finance_api, board)
    [vendor] = prints(finance_api, "payee_name", VENDOR).values()
    added(finance_api, person, payee(board, [vendor]))
    response = post(
        finance_api,
        f"/{person['id']}/split",
        {
            "reason": "2 people.",
            "parts": [
                {"name": "A", "confirmations": [first]},
                {"name": "B", "confirmations": [second]},
            ],
        },
    )
    assert response.status_code == 422
    assert "exactly 1 part" in response.json()["detail"]
    assert get(finance_api, person["id"])["status"] == "active"


def test_a_split_needs_at_least_2_parts(finance_api, board):  # noqa: F811
    person, first, second, _ = two_confirmations(finance_api, board)
    response = post(
        finance_api,
        f"/{person['id']}/split",
        {"reason": "x", "parts": [{"name": "A", "confirmations": [first, second]}]},
    )
    assert response.status_code == 422
    assert "at least 2 parts" in response.json()["detail"]


def test_a_confirmation_is_replaced_at_most_once(finance_api, finance_db, board):  # noqa: F811
    person, first, second, _ = two_confirmations(finance_api, board)
    done = post(
        finance_api,
        f"/{person['id']}/split",
        {
            "reason": "2 people.",
            "parts": [
                {"name": "A", "confirmations": [first]},
                {"name": "B", "confirmations": [second]},
            ],
        },
    )
    assert done.status_code == 200
    original = finance_db.get(m.IdentityConfirmation, uuid.UUID(first))
    with pytest.raises(IntegrityError), finance_db.begin_nested():
        finance_db.add(
            m.IdentityConfirmation(
                entity_id=original.entity_id,
                record_kind=original.record_kind,
                record_key=original.record_key,
                relation=original.relation,
                evidence_source=original.evidence_source,
                evidence_quote=original.evidence_quote,
                basis=original.basis,
                replaces_id=original.id,
                made_by_alethical_team=False,
            )
        )
        finance_db.flush()


def test_a_split_takes_the_confirmations_of_identities_merged_into_it(
    finance_api, board, registered
):  # noqa: F811
    a = create(
        finance_api,
        "organization",
        "Example Media",
        payee(board, [rows_of(finance_api)]),
    )
    b = create(finance_api, "organization", "Example for Senate", committee(registered))
    post(finance_api, f"/{a['id']}/merge", {"into": b["id"], "reason": "Same firm."})
    media, senate = a["confirmations"][0]["id"], b["confirmations"][0]["id"]
    done = post(
        finance_api,
        f"/{b['id']}/split",
        {
            "reason": "2 firms.",
            "parts": [
                {"name": "Media", "confirmations": [media]},
                {"name": "Senate", "confirmations": [senate]},
            ],
        },
    ).json()["data"]
    names = {part["name"]: part["id"] for part in done["split_into"]}
    [record] = listing(finance_api, "payee_name", VENDOR)["fingerprints"]
    assert record["confirmation"]["identity"]["id"] == names["Media"]
    # The merged identity's redirect ends on the split one, which lists its parts.
    assert get(finance_api, a["id"])["redirect_to"] == b["id"]
    refused = post(finance_api, f"/{b['id']}/confirmations", committee(registered))
    assert refused.status_code == 422


@pytest.mark.parametrize(
    ("original", "splitter", "replacement"),
    [(True, True, True), (True, False, False), (False, True, False)],
)
def test_a_replacement_is_team_made_only_when_both_decisions_were(
    finance_api, finance_db, board, original, splitter, replacement
):  # noqa: F811
    finance_access.grant(finance_db, FINANCE_EMAIL, team=original)
    finance_db.commit()
    person, first, second, _ = two_confirmations(finance_api, board)
    finance_access.grant(finance_db, FINANCE_EMAIL, team=splitter)
    finance_db.commit()
    done = post(
        finance_api,
        f"/{person['id']}/split",
        {
            "reason": "2 people.",
            "parts": [
                {"name": "A", "confirmations": [first]},
                {"name": "B", "confirmations": [second]},
            ],
        },
    ).json()["data"]
    made = finance_db.scalars(
        select(m.IdentityConfirmation.made_by_alethical_team).where(
            m.IdentityConfirmation.replaces_id.in_(
                [uuid.UUID(first), uuid.UUID(second)]
            )
        )
    ).all()
    assert made == [replacement, replacement]
    assert done["status"] == "split"


@pytest.mark.parametrize("team", [False, True])
def test_whether_a_team_account_made_it_is_recorded_privately(
    finance_api, finance_db, board, team
):  # noqa: F811
    finance_access.grant(finance_db, FINANCE_EMAIL, team=team)
    finance_db.commit()
    rows = prints(finance_api)
    person = create(finance_api, "person", DONOR, donor(board, [rows[31]]))
    entity_id = uuid.UUID(person["id"])
    assert finance_db.get(m.IdentityEntity, entity_id).made_by_alethical_team is team
    confirmation = finance_db.get(
        m.IdentityConfirmation, uuid.UUID(person["confirmations"][0]["id"])
    )
    assert confirmation.made_by_alethical_team is team
    events = finance_db.scalars(
        select(m.IdentityEvent.made_by_alethical_team).where(
            m.IdentityEvent.entity_id == entity_id
        )
    ).all()
    assert events == [team, team]


# Locks: always the identity before its confirmations, identities in id order.


def locks(finance_db, work):
    statements = []
    connection = finance_db.connection()

    def keep(_conn, _cursor, statement, *_):
        if "FOR UPDATE" in statement:
            statements.append(statement)

    event.listen(connection, "before_cursor_execute", keep)
    try:
        work()
    finally:
        event.remove(connection, "before_cursor_execute", keep)
    return statements


def test_a_withdrawal_locks_the_identity_before_the_confirmation(
    finance_api, finance_db, board
):  # noqa: F811
    rows = prints(finance_api)
    person = create(finance_api, "person", DONOR, donor(board, [rows[31]]))
    confirmation_id = uuid.UUID(person["confirmations"][0]["id"])
    taken = locks(
        finance_db,
        lambda: identities.withdraw(
            finance_db, confirmation_id, {"reason": "x"}, team=False
        ),
    )
    assert ["FROM identity_entity" in s for s in taken] == [True, False]
    assert "FROM identity_confirmation" in taken[1]


def test_a_split_locks_the_identity_before_its_confirmations(
    finance_api, finance_db, board
):  # noqa: F811
    person, first, second, _ = two_confirmations(finance_api, board)
    parts = [
        {"name": "A", "confirmations": [first]},
        {"name": "B", "confirmations": [second]},
    ]
    taken = locks(
        finance_db,
        lambda: identities.split(
            finance_db,
            uuid.UUID(person["id"]),
            {"reason": "x", "parts": parts},
            team=False,
        ),
    )
    assert "FROM identity_entity" in taken[0]
    assert "FROM identity_confirmation" in taken[1]


def test_a_merge_locks_both_identities_at_once_in_id_order(
    finance_api, finance_db, registered, board
):  # noqa: F811
    a = create(
        finance_api,
        "organization",
        "Example Media",
        payee(board, [rows_of(finance_api)]),
    )
    b = create(finance_api, "organization", "Example for Senate", committee(registered))
    low, high = sorted([a["id"], b["id"]])
    taken = locks(
        finance_db,
        lambda: identities.merge(
            finance_db, uuid.UUID(high), {"into": low, "reason": "x"}, team=False
        ),
    )
    [statement] = taken
    assert "ORDER BY identity_entity.id" in statement


# Not found is only ever not found.


def test_unknown_ids_are_not_found(finance_api, board):  # noqa: F811
    missing = str(uuid.uuid4())
    assert finance_api.get(f"{BASE}/{missing}").status_code == 404
    withdraw = post(finance_api, f"/confirmations/{missing}/withdraw", {"reason": "x"})
    assert withdraw.status_code == 404
    merge = post(
        finance_api, f"/{missing}/merge", {"into": str(uuid.uuid4()), "reason": "x"}
    )
    assert merge.status_code == 404


def test_a_failure_inside_is_never_reported_as_not_found(finance_api, monkeypatch):  # noqa: F811
    def broken(*_):
        raise KeyError("a bug, not a missing identity")

    monkeypatch.setattr(identities, "read", broken)
    with pytest.raises(KeyError):
        finance_api.get(f"{BASE}/{uuid.uuid4()}")


def test_lookup_refuses_what_it_cannot_read(finance_api, board):  # noqa: F811
    unknown = finance_api.get(
        f"{BASE}/lookup", params={"record_kind": "nickname", "record_key": "Jo"}
    )
    assert unknown.status_code == 422
    nul = finance_api.get(
        f"{BASE}/lookup", params={"record_kind": "committee", "record_key": "A\x00B"}
    )
    assert nul.status_code == 422


def test_identities_need_finance_access(client):
    assert client.get(f"{BASE}/{uuid.uuid4()}").status_code == 401
    assert client.get(f"{BASE}/records").status_code == 401
    assert client.post(BASE, json={}).status_code == 401


@pytest.mark.parametrize("kind", sorted(FINGERPRINTED))
def test_quick_picks_match_each_printed_record_kind(finance_api, board, kind):
    key = {"employer_name": EMPLOYER}.get(kind, VENDOR if "payee" in kind else DONOR)
    first = listing(finance_api, kind, key)
    confirmation = (
        donor(board, None)
        if kind == "donor_name"
        else employer(board, None)
        if kind == "employer_name"
        else payee(board, None)
    )
    if kind == "independent_payee_name":
        confirmation.update(
            record_kind=kind,
            evidence_source="cf_independent_expenditure_row",
            evidence_snapshot_id=str(board.independent_expenditures_snapshot_id),
            evidence_locator=7,
        )
    confirmation["record_selection"] = {"snapshot_id": first["snapshot_id"]}
    person = create(finance_api, "organization", "Confirmed example", confirmation)
    assert person["printed_names"][0]["confirmed"] == first["records"]
    again = post(
        finance_api,
        "",
        {"kind": "organization", "name": "Nobody else", "confirmation": confirmation},
    )
    assert again.status_code == 422
    assert "at least 1 unconfirmed record" in again.json()["detail"]


def test_quick_picks_refuse_mixed_selection_and_invalid_scope(finance_api, board):
    rows = prints(finance_api)
    first = listing(finance_api)
    for change in (
        {
            "fingerprints": [rows[31]],
            "record_selection": {"snapshot_id": first["snapshot_id"]},
        },
        {
            "fingerprints": None,
            "record_selection": {"snapshot_id": first["snapshot_id"], "year": True},
        },
        {
            "fingerprints": None,
            "record_selection": {
                "snapshot_id": first["snapshot_id"],
                "all_names": True,
            },
        },
    ):
        response = post(
            finance_api,
            "",
            {
                "kind": "person",
                "name": "Example",
                "confirmation": {**donor(board, None), **change},
            },
        )
        assert response.status_code == 422
    selected_year = finance_api.get(
        f"{BASE}/records",
        params={
            "record_kind": "donor_name",
            "record_key": DONOR,
            "year": 2025,
            "page_size": 1,
        },
    ).json()["data"]
    assert selected_year["records"] == selected_year["total_fingerprints"] == 1
    assert selected_year["fingerprints"][0]["fingerprint"] == rows[32]
    assert selected_year["years"] == [2026, 2025]
    for params in ({"page": 0}, {"page_size": 501}, {"page_size": 0}):
        assert (
            finance_api.get(
                f"{BASE}/records",
                params={"record_kind": "donor_name", "record_key": DONOR, **params},
            ).status_code
            == 422
        )


def test_only_identity_selection_requests_get_the_larger_transport_limit(finance_api):
    response = finance_api.post(
        f"{BASE}/confirmations/{uuid.uuid4()}/withdraw", content=b"x" * 65_537
    )
    assert response.status_code == 413
    assert response.json()["detail"] == "The request is too large"
    response = finance_api.post(BASE, content=b"x" * (16 * 1024 * 1024 + 1))
    assert response.status_code == 413
    assert "Alethical's request limit" in response.json()["detail"]
    assert response.headers["cache-control"] == "private, no-store"
