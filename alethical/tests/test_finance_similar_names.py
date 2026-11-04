"""Similar spellings are separate records, never evidence of an identity."""

# ruff: noqa: F811
from decimal import Decimal

import pytest
from sqlalchemy import text, select, func

from alethical.db import models as m
from alethical.db.session import get_db
from alethical.tests.finance_fixtures import finance_api, finance_db  # noqa: F401
from alethical.tests.test_identity_confirmations import (  # noqa: F401
    DONOR,
    EMPLOYER,
    VENDOR,
    board as source_board,
    create,
    donor,
    gift,
    payee,
    prints,
)

PATH = "/api/v1/finance/similar-names"


def sync_counts(db, board):
    for model, snapshot in [
        (m.CampaignFinanceContributionRow, board.contributions_snapshot_id),
        (m.CampaignFinanceExpenditureRow, board.expenditures_snapshot_id),
        (
            m.CampaignFinanceIndependentExpenditureRow,
            board.independent_expenditures_snapshot_id,
        ),
    ]:
        db.get(m.CampaignFinanceSnapshot, snapshot).row_count = db.scalar(
            select(func.count()).select_from(model).where(model.snapshot_id == snapshot)
        )
    db.commit()


@pytest.fixture()
def board(finance_db):
    result = source_board.__wrapped__(finance_db)
    sync_counts(finance_db, result)
    return result


def read(api, status=200, **params):
    api.app.dependency_overrides[get_db]().connection()
    response = api.get(PATH, params=params)
    assert response.status_code == status, response.text
    return response.json().get("data")


def add_names(db, board, role, names):
    for n, name in enumerate(names, 100):
        if role in {"donor", "employer"}:
            field = "contributor" if role == "donor" else "contrib_employer_name"
            db.add(gift(board.contributions_snapshot_id, n, **{field: name}))
        else:
            db.add(
                m.CampaignFinanceExpenditureRow(
                    snapshot_id=board.expenditures_snapshot_id,
                    row_number=n,
                    vendor_name=name,
                    year=2026,
                    amount=Decimal("1"),
                )
            )
    db.commit()
    sync_counts(db, board)


@pytest.mark.parametrize(
    "role,name,others",
    [
        (
            "payee",
            VENDOR,
            [
                "Exmaple Media LLC",
                "Example Media",
                "Example Media Group",
                "Example Media L.L.C.",
            ],
        ),
        (
            "donor",
            DONOR,
            ["Exmaple, Jordan A", "Example, Jordan", " Example, Jordan A "],
        ),
        ("employer", EMPLOYER, ["EXAMPLE HEALTH ASSN", "Example Health Assoc."]),
    ],
)
def test_approved_typos_short_forms_and_exact_spellings(
    finance_api, finance_db, board, role, name, others
):
    add_names(finance_db, board, role, others)
    data = read(finance_api, name=name, role=role)
    names = [r["name"] for r in data["rows"]]
    assert set(others) <= set(names)
    assert name not in names
    assert names == sorted(names)
    assert data["name"] == name and data["role"] == role
    assert len(data["version"]) == 16
    assert all("amount" not in r and "score" not in r for r in data["rows"])


def test_role_and_selected_year_never_change_candidate_universe(
    finance_api, finance_db, board
):
    add_names(finance_db, board, "employer", ["Example Health Assn"])
    assert (
        read(finance_api, name="Example Health Association", role="donor")["rows"] == []
    )
    data = read(finance_api, name=EMPLOYER, role="employer", year=2024)
    assert data["rows"] == [
        {"name": "Example Health Assn", "records": 0, "identities": []}
    ]
    assert data["year"] == 2024


def test_payee_combines_source_counts_but_not_confirmation_kinds(
    finance_api, finance_db, board
):
    held = prints(finance_api, "payee_name", VENDOR)
    person = create(
        finance_api, "organization", "Established identity", payee(board, [held[52]])
    )
    data = read(finance_api, name="Exmaple Media LLC", role="payee", year=2026)
    row = next(r for r in data["rows"] if r["name"] == VENDOR)
    assert row["records"] == 2
    assert row["identities"] == [
        {
            "id": person["id"],
            "reference": person["reference"],
            "name": "Established identity",
            "kind": "organization",
            "records": 1,
        }
    ]
    assert {s["dataset"] for s in data["sources"]} == {
        "expenditures",
        "independent_expenditures",
    }
    assert all(s["snapshot_id"] and s["source_url"] for s in data["sources"])


def test_counts_keep_repeated_rows_and_version_refuses_identity_change(
    finance_api, board
):
    data = read(finance_api, name="Exmaple, Jordan A", role="donor", year=2026)
    before = next(r for r in data["rows"] if r["name"] == DONOR)
    assert before["records"] == 2 and before["identities"] == []
    held = prints(finance_api)
    person = create(finance_api, "person", "Confirmed Person", donor(board, [held[31]]))
    read(
        finance_api,
        name="Exmaple, Jordan A",
        role="donor",
        version=data["version"],
        status=409,
    )
    after = read(finance_api, name="Exmaple, Jordan A", role="donor", year=2026)
    row = next(r for r in after["rows"] if r["name"] == DONOR)
    assert row["identities"][0]["records"] == 2
    confirmation = person["confirmations"][0]["id"]
    response = finance_api.post(
        f"/api/v1/finance/identities/confirmations/{confirmation}/withdraw",
        json={"reason": "Not this person"},
    )
    assert response.status_code == 200
    read(
        finance_api,
        name="Exmaple, Jordan A",
        role="donor",
        version=after["version"],
        status=409,
    )
    assert (
        next(
            r
            for r in read(finance_api, name="Exmaple, Jordan A", role="donor")["rows"]
            if r["name"] == DONOR
        )["identities"]
        == []
    )


def test_all_candidates_are_ordered_before_paging(finance_api, finance_db, board):
    names = [f"Example Media Company {i:03d}" for i in range(60)]
    add_names(finance_db, board, "payee", names)
    full = read(finance_api, name=VENDOR, role="payee", limit=50)
    following = read(
        finance_api,
        name=VENDOR,
        role="payee",
        limit=50,
        offset=50,
        version=full["version"],
    )
    assert [r["name"] for r in full["rows"] + following["rows"]] == sorted(names)
    assert full["has_more"] and not following["has_more"]
    read(finance_api, name=VENDOR, role="payee", limit=51, status=422)


@pytest.mark.parametrize("name", ["", "   ", "x" * 501, "a\x00b"])
def test_bad_name_never_queries_unbounded_match(finance_api, board, name):
    read(finance_api, name=name, role="donor", status=422)


def test_source_absence_or_pruning_is_unavailable_not_no_similar_names(
    finance_api, finance_db, board
):
    finance_db.execute(text("DELETE FROM cf_contribution_row"))
    finance_db.commit()
    read(finance_api, name=DONOR, role="donor", status=503)


def test_short_common_and_multiple_abbreviations_have_bounded_probes(
    finance_api, finance_db, board
):
    from alethical.api.services.finance_similar_names import probes

    add_names(
        finance_db,
        board,
        "employer",
        ["3M", "3M Co", "3M Company", "The Common Company", "The Common Co"],
    )
    assert len(probes("Assoc. Inc. Co. Corp. Ltd. L.L.C.")) <= 3
    data = read(finance_api, name="3M", role="employer", limit=1)
    assert data["rows"][0]["name"] == "3M Co"
    assert len(data["rows"]) == 1
    assert isinstance(data["has_more"], bool)
    assert all(
        r["records"] >= 0
        for r in read(finance_api, name="The Common Co", role="employer")["rows"]
    )


def test_similarity_is_not_confirmation_and_no_other_role_claims_leak(
    finance_api, board
):
    held = prints(finance_api)
    create(finance_api, "person", "Known person", donor(board, [held[31]]))
    assert all(
        r["identities"] == []
        for r in read(finance_api, name="Example Health Assn", role="employer")["rows"]
    )


def test_changed_release_refuses_paging(finance_api, finance_db, board):
    first = read(finance_api, name="Exmaple, Jordan A", role="donor")
    pointer = finance_db.get(m.CampaignFinanceCurrentRelease, True)
    pointer.release_id = None
    finance_db.commit()
    read(
        finance_api,
        name="Exmaple, Jordan A",
        role="donor",
        version=first["version"],
        status=409,
    )


def test_failed_query_does_not_masquerade_as_no_matches(finance_api, monkeypatch):
    from alethical.api.services import finance_similar_names
    from sqlalchemy.exc import SQLAlchemyError

    def failed(*args, **kwargs):
        raise SQLAlchemyError("test query timeout")

    monkeypatch.setattr(finance_similar_names, "read", failed)
    read(finance_api, name=DONOR, role="donor", status=503)


def test_similarity_requires_finance_access(client):
    response = client.get(PATH, params={"name": DONOR, "role": "donor"})
    assert response.status_code == 401


def test_punctuation_only_input_cannot_match_every_blank_spelling(finance_api, board):
    data = read(finance_api, name="...", role="payee")
    assert data["rows"] == [] and not data["has_more"]


def test_partial_pruning_never_makes_a_smaller_count(finance_api, finance_db, board):
    finance_db.execute(text("DELETE FROM cf_contribution_row WHERE row_number=31"))
    finance_db.commit()
    read(finance_api, name="Exmaple, Jordan A", role="donor", status=503)


def test_payee_filer_and_dataset_scope_discovery_counts_and_identities(
    finance_api, finance_db, board
):
    held = prints(finance_api, "payee_name", VENDOR)
    person = create(
        finance_api, "organization", "Campaign-only identity", payee(board, [held[52]])
    )
    finance_db.add(
        m.CampaignFinanceIndependentExpenditureRow(
            snapshot_id=board.independent_expenditures_snapshot_id,
            row_number=8,
            spender_reg_num="99999",
            vendor_name="Example Media Association",
            year=2024,
        )
    )
    finance_db.commit()
    sync_counts(finance_db, board)
    campaign = read(
        finance_api,
        name="Exmaple Media LLC",
        role="payee",
        filer="18135",
        dataset="expenditures",
        year=2026,
    )
    assert campaign["filer"] == "18135" and campaign["dataset"] == "expenditures"
    assert [(r["name"], r["records"]) for r in campaign["rows"]] == [(VENDOR, 1)]
    assert campaign["rows"][0]["identities"][0]["id"] == person["id"]
    outside = read(
        finance_api,
        name="Exmaple Media LLC",
        role="payee",
        filer="40100",
        dataset="independent",
        year=2026,
    )
    assert outside["rows"] == [{"name": VENDOR, "records": 1, "identities": []}]
    assert [s["dataset"] for s in outside["sources"]] == ["independent_expenditures"]
    assert (
        read(
            finance_api,
            name="Exmaple Media LLC",
            role="payee",
            filer="18135",
            dataset="independent",
        )["rows"]
        == []
    )
    # Dataset only excludes the campaign claim; filer only excludes the other filer's spelling.
    assert all(
        not r["identities"]
        for r in read(
            finance_api, name="Exmaple Media LLC", role="payee", dataset="independent"
        )["rows"]
    )
    assert [
        r["name"]
        for r in read(
            finance_api, name="Exmaple Media LLC", role="payee", filer="40100"
        )["rows"]
    ] == [VENDOR]


@pytest.mark.parametrize(
    "role,name,column",
    [
        ("donor", "Exmaple, Jordan A", "contributor"),
        ("employer", "Example Health Assn", "contrib_employer_name"),
    ],
)
def test_contribution_scope_uses_recipient_and_keeps_year_zero_candidates(
    finance_api, finance_db, board, role, name, column
):
    from alethical.tests.test_identity_confirmations import employer

    source_name = DONOR if role == "donor" else EMPLOYER
    record_kind = "donor_name" if role == "donor" else "employer_name"
    held = prints(finance_api, record_kind, source_name)
    claim = donor(board, [held[31]]) if role == "donor" else employer(board, [held[31]])
    create(
        finance_api,
        "person" if role == "donor" else "organization",
        "Other filer's identity",
        claim,
    )
    finance_db.add(
        gift(board.contributions_snapshot_id, 40, recipient_reg_num="55555", year=2024)
    )
    finance_db.add(
        gift(
            board.contributions_snapshot_id,
            41,
            recipient_reg_num="99999",
            **{column: source_name + " Other"},
        )
    )
    finance_db.commit()
    sync_counts(finance_db, board)
    data = read(
        finance_api,
        name=name,
        role=role,
        filer="55555",
        dataset="contributions",
        year=2026,
    )
    assert data["rows"] == [{"name": source_name, "records": 0, "identities": []}]
    assert read(
        finance_api,
        name=name,
        role=role,
        filer="55555",
        dataset="contributions",
        year=2024,
    )["rows"] == [{"name": source_name, "records": 1, "identities": []}]


@pytest.mark.parametrize(
    "role,dataset",
    [
        ("donor", "expenditures"),
        ("employer", "independent"),
        ("payee", "contributions"),
    ],
)
def test_inapplicable_dataset_is_empty_not_broadened(finance_api, board, role, dataset):
    data = read(finance_api, name="Example", role=role, dataset=dataset)
    assert data["rows"] == [] and data["sources"] == [] and not data["has_more"]


@pytest.mark.parametrize(
    "params",
    [{"filer": ""}, {"filer": "a" * 21}, {"filer": "x\x00"}, {"dataset": "unknown"}],
)
def test_scope_parameters_use_validated_payment_contract(finance_api, board, params):
    read(finance_api, name="Example", status=422, **params)
