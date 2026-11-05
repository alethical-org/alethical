"""Finance finds likely spellings while keeping records, filters and sort intact."""

# ruff: noqa: F811
from datetime import date
from decimal import Decimal


from alethical.db import models as m
from alethical.db.session import get_db
from alethical.tests.finance_fixtures import finance_api, finance_db  # noqa: F401
from alethical.tests.test_identity_confirmations import board, gift  # noqa: F401
from alethical.tests.test_campaign_finance_lists_and_search import _register, _filer
from alethical.tests.test_lobbying_api import _pair
from alethical.tests.test_finance_people import service_member


def get(api, path, **params):
    api.app.dependency_overrides[get_db]().connection()
    response = api.get("/api/v1/" + path, params=params)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def names(data, kind):
    return next(group["results"] for group in data["groups"] if group["kind"] == kind)


def test_home_and_search_include_typo_names_once_direct_first_and_public_stays_exact(
    finance_api, finance_db, board
):
    for i, name in enumerate(
        [
            "Dantchick, Arthur",
            "Dantchik, Arthur Mr",
            "Danchik, Arthur",
            "Arndt, Arthur",
        ],
        100,
    ):
        finance_db.add(gift(board.contributions_snapshot_id, i, contributor=name))
    finance_db.commit()
    found = get(finance_api, "finance/name-search", q="danchik", limit=10)
    rows = names(found, "gave")
    assert [r["name"] for r in rows] == [
        "Danchik, Arthur",
        "Dantchick, Arthur",
        "Dantchik, Arthur Mr",
    ]
    assert [r["payment_count"] for r in rows] == [1, 1, 1]
    suggested = get(
        finance_api, "finance/suggestions", q="danchik", request_id="spell", limit=10
    )
    assert names(suggested["money"], "gave") == rows
    old = get(finance_api, "campaign-finance/search", q="danchik", limit=10)
    assert [r["name"] for r in names(old, "gave")] == ["Danchik, Arthur"]
    assert all(r["role"] == "contributor" for r in rows)


def test_official_committee_matches_keep_ids_tab_and_chosen_sort(
    finance_api, finance_db
):
    register = _register(finance_db, filer_count=3)
    _filer(finance_db, register, "32110", name="Health Association")
    _filer(finance_db, register, "32109", name="Wealth Partners")
    _filer(
        finance_db,
        register,
        "32108",
        name="Health Party",
        kind=m.CampaignFinanceFilerKind.party_unit,
    )
    result = get(
        finance_api,
        "finance/committees",
        q="health",
        kind="candidate_committee",
        sort="registration",
        limit=1,
    )
    assert result["page"]["total"] == 2
    assert [(r["name"], r["registration_number"]) for r in result["committees"]] == [
        ("Wealth Partners", "32109")
    ]
    next_page = get(
        finance_api,
        "finance/committees",
        q="health",
        kind="candidate_committee",
        sort="registration",
        limit=1,
        offset=1,
    )
    assert [r["name"] for r in next_page["committees"]] == ["Health Association"]
    alphabetical = get(
        finance_api,
        "finance/committees",
        q="health",
        kind="candidate_committee",
        sort="name",
    )
    assert [r["name"] for r in alphabetical["committees"]] == [
        "Health Association",
        "Wealth Partners",
    ]
    public = get(
        finance_api,
        "campaign-finance/committees",
        q="health",
        kind="candidate_committee",
    )
    assert public["page"]["total"] == 1


def test_payee_sort_is_over_every_match_with_held_amounts(
    finance_api, finance_db, board
):
    for i, name, amount in [
        (100, "Health Association", "412"),
        (101, "Wealth Partners", "520"),
    ]:
        finance_db.add(
            m.CampaignFinanceExpenditureRow(
                snapshot_id=board.expenditures_snapshot_id,
                row_number=i,
                vendor_name=name,
                committee_reg_num="18135",
                amount=Decimal(amount),
                transaction_date=date(2026, 2, 1),
                year=2026,
            )
        )
    finance_db.commit()
    rows = get(finance_api, "finance/payees", q="health", year=2026, sort="amount")[
        "rows"
    ]
    assert [(r["name"], r["amount"]) for r in rows] == [
        ("Wealth Partners", "520.0000"),
        ("Health Association", "412.0000"),
    ]
    rows = get(finance_api, "finance/payees", q="health", year=2026, sort="name")[
        "rows"
    ]
    assert [r["name"] for r in rows] == ["Health Association", "Wealth Partners"]
    assert get(finance_api, "finance/payees", q="health", year=2025)["total"] == 0


def test_people_typo_returns_existing_member_id(finance_api, finance_db):
    person = service_member(finance_db, "sample-spelling-member")
    person.full_name = "Arthur Dantchick"
    finance_db.commit()
    data = get(finance_api, "finance/people", q="arthur danchik", type="legislators")
    assert [(r["id"], r["name"]) for r in data["rows"]] == [
        (str(person.id), "Arthur Dantchick")
    ]


def test_lobbying_name_order_typo_and_filter_preserve_registration(
    finance_api, finance_db
):
    active, _, _ = _pair(finance_db)
    active.row_count += 1
    finance_db.add(
        m.LobbyistRow(
            snapshot_id=active.id,
            registration_number="90121",
            name="Dantchick, Arthur",
            formatted_name="Arthur Dantchick",
        )
    )
    finance_db.commit()
    data = get(
        finance_api, "finance/lobbying/lobbyists", q="arthur danchik", sort="name"
    )
    assert [(r["registration_number"], r["name"]) for r in data["lobbyists"]] == [
        ("90121", "Dantchick, Arthur")
    ]
    public = get(finance_api, "lobbying/lobbyists", q="arthur danchik", sort="name")
    assert public["total"] == 0


def test_finance_discovery_routes_require_access(finance_api):
    finance_api.headers.pop("Authorization")
    for path in [
        "name-search?q=danchik",
        "committees?q=danchik",
        "lobbying/lobbyists?q=danchik",
        "lobbying/principals?q=health",
    ]:
        assert finance_api.get("/api/v1/finance/" + path).status_code == 401


def test_home_summary_keeps_all_three_file_groups_counts_and_public_default(
    finance_api, finance_db, board
):
    from sqlalchemy import event
    from alethical.tests.test_finance_similar_names import build_summaries, sync_counts

    sync_counts(finance_db, board)
    before = get(finance_api, "finance/name-search", q="exmaple", limit=10)
    build_summaries(finance_db, board)
    statements = []
    connection = finance_db.connection()

    def capture(_conn, _cursor, statement, _parameters, _context, _many):
        statements.append(statement)

    event.listen(connection, "before_cursor_execute", capture)
    try:
        after = get(finance_api, "finance/name-search", q="exmaple", limit=10)
    finally:
        event.remove(connection, "before_cursor_execute", capture)
    before.pop("current_claim_validated_at")
    after.pop("current_claim_validated_at")
    assert before == after
    assert all(
        names(after, kind) for kind in ["gave", "got_paid", "got_paid_independent"]
    )
    grouped_queries = [s for s in statements if "WITH names AS" in s]
    assert len(grouped_queries) == 3
    assert all("FROM cf_identity_name_summary" in s for s in grouped_queries)
    assert not any("FROM cf_contribution_row" in s for s in grouped_queries)
    public = get(finance_api, "campaign-finance/search", q="exmaple", limit=10)
    assert all(
        not names(public, kind) for kind in ["gave", "got_paid", "got_paid_independent"]
    )


def test_home_summary_preserves_direct_first_and_capped_count(
    finance_api, finance_db, board, monkeypatch
):
    from alethical.api.services import campaign_finance_search as search
    from alethical.tests.test_finance_similar_names import build_summaries, sync_counts

    for number, name in enumerate(["Exmaple, Aaron", "Example, Zora"], 100):
        finance_db.add(gift(board.contributions_snapshot_id, number, contributor=name))
    finance_db.commit()
    sync_counts(finance_db, board)
    monkeypatch.setattr(search, "COUNTED_UP_TO", 2)
    before = get(finance_api, "finance/name-search", q="example", limit=1)
    build_summaries(finance_db, board)
    after = get(finance_api, "finance/name-search", q="example", limit=1)
    before.pop("current_claim_validated_at")
    after.pop("current_claim_validated_at")
    assert before == after
    group = next(group for group in after["groups"] if group["kind"] == "gave")
    assert group["total"] is None and group["at_least"] == 2 and group["has_more"]
    assert group["results"][0]["name"] == "Example, Jordan A"
    assert group["results"][0]["payment_count"] == 3


def test_home_summary_refuses_only_the_partially_removed_source(
    finance_api, finance_db, board
):
    from sqlalchemy import text
    from alethical.tests.test_finance_similar_names import build_summaries, sync_counts

    sync_counts(finance_db, board)
    build_summaries(finance_db, board)
    finance_db.execute(text("DELETE FROM cf_contribution_row WHERE row_number=31"))
    finance_db.commit()
    after = get(finance_api, "finance/name-search", q="exmaple", limit=10)
    groups = {group["kind"]: group for group in after["groups"]}
    assert groups["gave"]["state"] == "unavailable"
    assert groups["gave"]["results"] == []
    assert groups["gave"]["total"] is None
    assert groups["got_paid"]["results"]
    assert groups["got_paid_independent"]["results"]
