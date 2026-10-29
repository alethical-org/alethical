"""Finance money directories keep exact source spellings and truthful counts."""

# ruff: noqa: F811
from datetime import date
from decimal import Decimal

from alethical.db.session import get_db
from alethical.tests.finance_fixtures import finance_api, finance_db  # noqa: F401
from alethical.tests.test_identity_confirmations import (  # noqa: F401
    DONOR,
    EMPLOYER,
    VENDOR,
    create,
    employer,
    prints,
    board,
    gift,
)

BASE = "/api/v1/finance"


def get(api, path, **params):
    api.app.dependency_overrides[get_db]().connection()
    response = api.get(BASE + path, params=params)
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "private, no-store"
    return response.json()["data"]


def test_employer_search_counts_exact_spellings_and_donor_names(
    finance_api, finance_db, board
):
    for number, name, donor in [
        (71, EMPLOYER.lower(), "Other"),
        (72, EMPLOYER, None),
        (73, EMPLOYER, None),
    ]:
        finance_db.add(
            gift(
                board.contributions_snapshot_id,
                number,
                contributor=donor,
                contrib_employer_name=name,
            )
        )
    finance_db.commit()
    data = get(finance_api, "/employers", q="Association", limit=1)
    assert data["total"] == 2 and data["page"]["has_more"]
    rows = (
        data["rows"]
        + get(finance_api, "/employers", q="Association", limit=1, offset=1)["rows"]
    )
    rows = {row["name"]: row for row in rows}
    assert rows[EMPLOYER]["record_count"] == 6
    assert rows[EMPLOYER]["donor_name_count"] == 2
    assert rows[EMPLOYER]["unnamed_records"] == 2
    assert rows[EMPLOYER.lower()]["record_count"] == 1
    assert get(finance_api, "/employers", q="%%% ")["total"] == 0
    for q in ("ab", "bad\x00input"):
        assert finance_api.get(BASE + "/employers", params={"q": q}).status_code == 422


def test_employer_donors_page_groups_and_keep_unnamed_records_separate(
    finance_api, finance_db, board
):
    for number in (71, 72):
        finance_db.add(
            gift(
                board.contributions_snapshot_id,
                number,
                contributor=None,
                amount=None,
                receipt_type="Loan",
                receipt_date=date(2026, 5, 1),
            )
        )
    finance_db.commit()
    data = get(finance_api, "/employers/donors", name=EMPLOYER, limit=1)
    assert data["total"] == 4 and data["total_payments"] == 6
    all_rows = data["rows"] + [
        get(finance_api, "/employers/donors", name=EMPLOYER, limit=1, offset=i)["rows"][
            0
        ]
        for i in range(1, 4)
    ]
    assert len({row["key"] for row in all_rows}) == 4
    named = next(row for row in all_rows if row["name"] == DONOR)
    assert named["payment_count"] == 3
    assert len(named["payments"]) == 3
    assert [row["record_number"] for row in named["payments"]] == [33, 31, 32]
    assert all(
        row["employer"] == EMPLOYER and row["recipient_is_filer"]
        for row in named["payments"]
    )
    unnamed = [row for row in all_rows if row["name"] is None]
    assert len(unnamed) == 2
    assert all(
        row["payments"][0]["amount"] is None
        and row["payments"][0]["receipt_type"] == "Loan"
        for row in unnamed
    )
    assert data["release_id"] == str(board.id) and data["source_url"]


def test_name_payment_reads_supply_exact_counts_on_every_page(finance_api, board):
    for name, role, total in [
        (DONOR, "contributor", 3),
        (EMPLOYER, "employer", 4),
        (VENDOR, "vendor", 1),
        (VENDOR, "independent_vendor", 1),
    ]:
        for offset in (0, 100):
            finance_api.app.dependency_overrides[get_db]().connection()
            response = finance_api.get(
                "/api/v1/campaign-finance/payments-under-name",
                params={"name": name, "role": role, "limit": 1, "offset": offset},
            )
            assert response.status_code == 200, response.text
            assert response.json()["data"]["page"]["total_payments"] == total


def test_money_read_access_and_missing_release(finance_api, client):
    data = get(finance_api, "/employers", q="Example")
    assert data["state"] == "unavailable" and data["total"] is None
    finance_api.headers.pop("Authorization")
    assert (
        finance_api.get(BASE + "/employers", params={"q": "Example"}).status_code == 401
    )


def test_employer_organization_flag_requires_current_covered_fingerprints(
    finance_api, finance_db, board
):
    fingerprints = prints(finance_api, "employer_name", EMPLOYER)
    organization = create(
        finance_api,
        "organization",
        "Checked organization",
        employer(board, [fingerprints[31]]),
    )
    create(finance_api, "person", "A person", employer(board, [fingerprints[32]]))
    finance_db.add(gift(board.contributions_snapshot_id, 71, amount=Decimal("999")))
    finance_db.commit()
    row = get(finance_api, "/employers", q="Association")["rows"][0]
    assert (
        row["confirmed_organization"]
        and row["confirmed_records"] == 2
        and row["record_count"] == 5
    )
    confirmation = organization["confirmations"][0]["id"]
    assert (
        finance_api.post(
            BASE + "/identities/confirmations/" + confirmation + "/withdraw",
            json={"reason": "Wrong organization"},
        ).status_code
        == 200
    )
    assert not get(finance_api, "/employers", q="Association")["rows"][0][
        "confirmed_organization"
    ]


def test_employer_group_expansion_is_bounded_complete_and_source_pinned(
    finance_api, finance_db, board
):
    from sqlalchemy import event, text

    for number in range(100, 161):
        finance_db.add(
            gift(board.contributions_snapshot_id, number, contributor="Many payments")
        )
    finance_db.commit()
    statements = []

    def remember(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    bind = finance_db.get_bind()
    event.listen(bind, "before_cursor_execute", remember)
    try:
        data = get(finance_api, "/employers/donors", name=EMPLOYER)
    finally:
        event.remove(bind, "before_cursor_execute", remember)
    group = next(row for row in data["rows"] if row["name"] == "Many payments")
    assert (
        group["payment_count"] == 61
        and len(group["payments"]) == 50
        and group["page"]["has_more"]
    )
    tail = get(
        finance_api,
        "/employers/donor-payments",
        name=EMPLOYER,
        donor="Many payments",
        offset=50,
        release_id=board.id,
    )
    assert (
        tail["payment_count"] == 61
        and len(tail["payments"]) == 11
        and not tail["page"]["has_more"]
    )
    assert len({p["record_number"] for p in group["payments"] + tail["payments"]}) == 61
    assert len(statements) < 15
    finance_db.execute(text("DELETE FROM cf_current_release"))
    finance_db.commit()
    assert (
        finance_api.get(
            BASE + "/employers/donor-payments",
            params={
                "name": EMPLOYER,
                "donor": "Many payments",
                "release_id": str(board.id),
            },
        ).status_code
        == 409
    )


def test_committee_groups_keep_types_missing_amounts_and_counts(
    finance_api, finance_db, board
):
    for number, name, kind, receipt, amount in [
        (80, "Known donor", "Individual", "Contribution", "10"),
        (81, "Known donor", "Individual", "Contribution", None),
        (82, "Known donor", "Individual", "Loan", "1000"),
        (83, "Typed lobbyist", "Lobbyist", "Contribution", "7"),
        (84, None, "Individual", "Contribution", "5"),
        (85, None, "Individual", "Contribution", "5"),
    ]:
        finance_db.add(
            gift(
                board.contributions_snapshot_id,
                number,
                contributor=name,
                contrib_type=kind,
                receipt_type=receipt,
                amount=Decimal(amount) if amount else None,
            )
        )
    finance_db.commit()
    data = get(
        finance_api,
        "/committees/18135/payment-groups",
        year=2026,
        direction="received",
        tab="individuals",
        q="Known",
    )
    assert data["total"] == 1 and data["total_payments"] == 2
    row = data["rows"][0]
    assert row["amount"] is None and row["missing_amounts"] == 1
    assert {payment["record_number"] for payment in row["payments"]} == {80, 81}
    assert data["tab_counts"]["individuals"] == 4
    assert data["tab_counts"]["lobbyists"] == 1
    all_groups = get(
        finance_api,
        "/committees/18135/payment-groups",
        year=2026,
        direction="received",
        tab="individuals",
    )
    assert all_groups["total"] == 3
    assert len({g["key"] for g in all_groups["rows"] if g["name"] is None}) == 2
    detail = get(
        finance_api,
        "/committees/18135/group-payments",
        year=2026,
        direction="received",
        key=row["key"],
        limit=1,
        offset=1,
        release_id=board.id,
    )
    assert detail["page"]["total_payments"] == 2 and len(detail["payments"]) == 1
    assert detail["source_url"] == data["source_url"]
    assert data["snapshot_id"] == str(board.contributions_snapshot_id)


def test_committee_group_outgoing_keeps_transfers_and_refunds(
    finance_api, finance_db, board
):
    from alethical.db import models as m

    for number, kind, vendor, target, target_name, amount in [
        (80, "Contribution", "Processor", "40100", "Receiving committee", "30"),
        (81, "Refund", VENDOR, None, None, "-100"),
    ]:
        finance_db.add(
            m.CampaignFinanceExpenditureRow(
                snapshot_id=board.expenditures_snapshot_id,
                row_number=number,
                committee_reg_num="18135",
                type=kind,
                vendor_name=vendor,
                affected_committee_reg_num=target,
                affected_committee_name=target_name,
                amount=Decimal(amount),
                transaction_date=date(2026, 6, 1),
                year=2026,
            )
        )
    finance_db.commit()
    data = get(
        finance_api,
        "/committees/18135/payment-groups",
        year=2026,
        direction="made",
        sort="total",
        limit=1,
    )
    assert data["total"] == 2 and data["total_payments"] == 3
    assert data["rows"][0]["name"] == VENDOR and Decimal(
        data["rows"][0]["amount"]
    ) == Decimal("1100.5")
    assert data["page"]["has_more"]
    other = get(
        finance_api,
        "/committees/18135/payment-groups",
        year=2026,
        direction="made",
        sort="total",
        limit=1,
        offset=1,
    )
    assert other["rows"][0]["name"] == "Receiving committee"
    assert other["rows"][0]["registration_number"] == "40100"
    assert "40100" not in other["linkable_registration_numbers"]
    finance_db.add(gift(board.contributions_snapshot_id, 90, recipient_reg_num="40100"))
    finance_db.commit()
    linked = get(
        finance_api,
        "/committees/18135/payment-groups",
        year=2026,
        direction="made",
        q="Receiving",
    )
    assert "40100" in linked["linkable_registration_numbers"]
    assert (
        get(
            finance_api, "/committees/18135/payment-groups", year=2027, direction="made"
        )["state"]
        == "unavailable"
    )


def test_report_figures_match_only_unique_filed_regular_report(
    finance_api, finance_db, board
):
    from datetime import UTC, datetime
    from sqlalchemy import select
    from alethical.db import models as m
    from alethical.tests.test_campaign_finance_landing_reads import (
        _filings_snapshot,
        _report,
        _reported_figures,
    )

    snapshot = _filings_snapshot(finance_db)
    _report(finance_db, snapshot, "18135", cut_off=date(2026, 7, 20))
    _report(
        finance_db,
        snapshot,
        "18135",
        report_type="A",
        report_name="Earlier report",
        cut_off=date(2026, 5, 31),
    )
    _report(
        finance_db,
        snapshot,
        "18135",
        report_type="D",
        report_name="Scheduled only",
        cut_off=date(2026, 10, 19),
        amendment_index=None,
    )
    _reported_figures(finance_db, snapshot, "18135")
    filing = finance_db.scalar(
        select(m.CampaignFinanceFiling).where(
            m.CampaignFinanceFiling.snapshot_id == snapshot.id
        )
    )
    filing.captured_at = datetime(2026, 7, 23, tzinfo=UTC)
    for key, value in [("total_receipts", "2345.67"), ("ending_cash_balance", "0")]:
        finance_db.add(
            m.CampaignFinanceFilingFigure(
                filing_id=filing.id,
                line_key=key,
                label_as_served=key,
                amount=Decimal(value),
            )
        )
    finance_db.commit()
    data = get(finance_api, "/committees/18135/report-figures", year=2026)
    assert len(data["reports"]) == 2
    latest, older = data["reports"]
    assert latest["report_name"] == "2026 Pre-Primary Report"
    assert Decimal(latest["total_receipts"]) == Decimal("2345.67")
    assert Decimal(latest["ending_cash_balance"]) == 0
    assert latest["filed_date"] is None
    assert latest["period_start"] == "2026-01-01"
    assert latest["figures_copied_at"].startswith("2026-07-23")
    assert older["total_receipts"] is None and older["ending_cash_balance"] is None
    assert older["figures_state"] == "unavailable"
    # Another regular report at the same cutoff cannot borrow an ambiguous total.
    _report(finance_db, snapshot, "18135", report_type="E", cut_off=date(2026, 7, 20))
    ambiguous = get(finance_api, "/committees/18135/report-figures", year=2026)
    assert all(row["total_receipts"] is None for row in ambiguous["reports"])


def test_candidacy_accounts_require_reviewed_identity_election_year_and_seat(
    finance_api, finance_db, board, monkeypatch
):
    from datetime import UTC, datetime
    from sqlalchemy import select
    from alethical.api.services import candidate_legislators
    from alethical.db import models as m
    from alethical.tests.test_campaign_finance_landing_reads import (
        _filings_snapshot,
        _filer,
    )
    from alethical.tests.test_finance_records import _link

    period = finance_db.scalar(
        select(m.LegislatorServicePeriod).where(m.LegislatorServicePeriod.is_current)
    )
    member = period.legislator
    chamber = period.chamber.chamber_type.value
    office = "Senate" if chamber == "senate" else "House"
    title = "State Senator" if chamber == "senate" else "State Representative"
    candidate_id = "c" * 64
    period.profile_url = "https://www.senate.mn/members/member_bio.html?leg_id=99999"
    period.party = "DFL"
    evidence = {
        "candidate_id": candidate_id,
        "candidate_name": member.full_name,
        "party": "DEMOCRATIC-FARMER-LABOR",
        "election_id": "8334",
        "election_date": "2026-11-03",
        "office": f"{title} District {period.district.code}",
        "legislator_slug": member.slug,
        "legislator_name": member.full_name,
        "member_source_url": period.profile_url,
        "chamber": chamber,
        "district": period.district.code,
        "member_party": period.party,
    }
    monkeypatch.setattr(
        candidate_legislators, "reviewed_links", lambda: {candidate_id: evidence}
    )
    profile = {
        "candidate": {
            "id": candidate_id,
            "name": member.full_name,
            "party": evidence["party"],
        },
        "election": {"id": "8334", "date": "2026-11-03"},
        "office": evidence["office"],
        "source": {
            "authority": "Minnesota Secretary of State",
            "url": "https://myballotmn.sos.mn.gov/",
        },
    }
    finance_db.add(
        m.CandidateRecord(
            id=candidate_id,
            election_id="8334",
            election_date=date(2026, 11, 3),
            checked_at=datetime.now(UTC),
            source_sha256="e" * 64,
            public_payload=profile,
        )
    )
    snapshot = _filings_snapshot(finance_db)
    for number, district, account_office in [
        ("18135", period.district.code, office),
        ("22222", "99Z", office),
        ("33333", period.district.code, "Governor"),
        ("44444", period.district.code, office),
    ]:
        _link(
            finance_db,
            member,
            number,
            m.CommitteeLinkReviewDecision.confirmed,
            office=account_office,
        )
        _filer(finance_db, snapshot, number, office=account_office, district=district)
    old = finance_db.scalar(
        select(m.LegislatorCampaignCommittee).where(
            m.LegislatorCampaignCommittee.registration_number == "44444"
        )
    )
    old.first_year_as_reviewed, old.last_year_as_reviewed = 2018, 2020
    finance_db.commit()
    path = f"/candidates/{candidate_id}/campaign-finance"
    year = get(finance_api, path, year=2026)
    assert year["link_state"] == "confirmed"
    assert [item["registration_number"] for item in year["committees"]] == ["18135"]
    years = get(finance_api, path + "/years", **{"from": 2025, "to": 2026})
    assert all(
        [item["registration_number"] for item in entry["committees"]] == ["18135"]
        for entry in years["years"]
    )
    assert years["election_year"] == 2026
    # Same name is never sufficient when the checked candidate identity changes.
    evidence["candidate_name"] = "Another person"
    refused = get(finance_api, path, year=2026)
    assert refused["link_state"] == "unconfirmed" and refused["committees"] == []
    assert (
        finance_api.get(
            BASE + path + "/years", params={"from": 2026, "to": 2025}
        ).status_code
        == 422
    )


def test_identity_display_metadata_preserves_hashes_and_only_links_held_filers(
    finance_api, finance_db, board
):
    from alethical.tests.test_identity_confirmations import listing

    before = listing(finance_api)
    fingerprint = next(
        item["fingerprint"] for item in before["fingerprints"] if len(item["rows"]) == 2
    )
    finance_db.add(
        gift(
            board.contributions_snapshot_id,
            91,
            recipient="Another filed name",
            receipt_type="Loan",
        )
    )
    finance_db.commit()
    data = listing(finance_api)
    row = next(
        item for item in data["fingerprints"] if item["fingerprint"] == fingerprint
    )
    assert len(row["rows"]) == 3
    assert row["display"] == {
        "filer_name": None,
        "filer_registration_number": "18135",
        "filer_is_held": True,
        "record_type": None,
        "record_types": ["Contribution", "Loan"],
    }
    assert data["source_url"].startswith("https://") and data["copied_at"]
    independent = listing(finance_api, "independent_payee_name", VENDOR)
    assert independent["fingerprints"][0]["display"]["filer_is_held"] is False


def test_group_expansion_unknown_year_and_pruned_sources_never_report_zero(
    finance_api, finance_db, board
):
    from sqlalchemy import text

    data = get(
        finance_api,
        "/committees/18135/group-payments",
        year=2099,
        direction="received",
        key="missing",
    )
    assert data["state"] == "unavailable" and data["page"]["total_payments"] is None
    finance_db.execute(
        text("UPDATE cf_snapshot SET row_count=4 WHERE id=:id"),
        {"id": board.contributions_snapshot_id},
    )
    finance_db.execute(
        text("DELETE FROM cf_contribution_row WHERE snapshot_id=:id"),
        {"id": board.contributions_snapshot_id},
    )
    finance_db.commit()
    employers = get(finance_api, "/employers", q="Association")
    assert employers["state"] == "unavailable" and employers["total"] is None
    donors = get(finance_api, "/employers/donors", name=EMPLOYER)
    assert donors["state"] == "unavailable" and donors["total_payments"] is None


def test_report_source_no_longer_held_is_unavailable(finance_api, finance_db):
    from alethical.tests.test_campaign_finance_landing_reads import _filings_snapshot

    _filings_snapshot(finance_db, report_count=1)
    data = get(finance_api, "/committees/18135/report-figures", year=2026)
    assert data["state"] == "unavailable" and data["reports"] == []


def test_committee_group_summary_covers_whole_filter_and_locates_notice_row(
    finance_api, finance_db, board
):
    path = "/committees/18135/payment-groups"
    data = get(finance_api, path, year=2026, limit=1)
    assert data["total"] == 2 and len(data["rows"]) == 1
    assert Decimal(data["amount"]) == Decimal("750")
    assert data["missing_amounts"] == 0 and data["period_basis"] == "dates"
    assert data["first_date"] == data["last_date"] == "2026-03-02"
    assert data["first_year"] == data["last_year"] == 2026
    located = get(finance_api, path, year=2026, record_number=31)
    assert located["total"] == 1 and located["total_payments"] == 2
    assert located["rows"][0]["name"] == DONOR
    assert {row["record_number"] for row in located["rows"][0]["payments"]} == {31, 33}
    assert Decimal(located["amount"]) == 500
    finance_db.add(
        gift(board.contributions_snapshot_id, 71, amount=None, receipt_date=None)
    )
    finance_db.commit()
    withheld = get(finance_api, path, year=2026, limit=1)
    assert withheld["amount"] is None and withheld["missing_amounts"] == 1
    assert withheld["period_basis"] == "years"
    assert withheld["total_payments"] == 4
    filtered = get(finance_api, path, year=2026, q="Morgan")
    assert Decimal(filtered["amount"]) == 250 and filtered["missing_amounts"] == 0
    assert filtered["period_basis"] == "dates"


def test_notice_locator_reports_offset_beyond_preview_and_zero_year_sum(
    finance_api, finance_db, board
):
    from sqlalchemy import text

    for number in range(71, 131):
        finance_db.add(
            gift(board.contributions_snapshot_id, number, receipt_date=date(2026, 4, 1))
        )
    finance_db.commit()
    data = get(
        finance_api, "/committees/18135/payment-groups", year=2026, record_number=31
    )
    located = data["located_record"]
    assert located == {
        "record_number": 31,
        "group_key": data["rows"][0]["key"],
        "offset": 61,
    }
    assert all(row["record_number"] != 31 for row in data["rows"][0]["payments"])
    row_page = get(
        finance_api,
        "/committees/18135/group-payments",
        year=2026,
        key=located["group_key"],
        offset=located["offset"],
        limit=1,
        release_id=data["release_id"],
    )
    assert row_page["payments"][0]["record_number"] == 31
    finance_db.execute(
        text(
            "UPDATE cf_contribution_row SET receipt_date=NULL, amount=CASE WHEN row_number=31 THEN -15500 ELSE 250 END WHERE snapshot_id=:id AND year=2026"
        ),
        {"id": board.contributions_snapshot_id},
    )
    finance_db.commit()
    summary = get(finance_api, "/committees/18135/payment-groups", year=2026, limit=1)
    assert Decimal(summary["amount"]) == 0
    assert (
        summary["period_basis"] == "years"
        and summary["first_year"] == summary["last_year"] == 2026
    )
    assert summary["first_date"] is None and summary["last_date"] is None
