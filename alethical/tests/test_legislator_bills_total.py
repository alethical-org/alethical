"""The profile's bill total describes its served list, not all held authorship."""

import pytest
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from alethical.db.schema import load_schema
from alethical.db.session import get_engine


@pytest.fixture
def authored_bill_fixture(client):
    schema = load_schema()
    with Session(get_engine()) as db:
        current = db.scalar(
            select(schema.LegislativeSession).where(
                schema.LegislativeSession.slug == "94-2025-regular"
            )
        )
        chamber = db.scalar(
            select(schema.Chamber).where(schema.Chamber.slug == "house")
        )
        other = schema.LegislativeSession(
            jurisdiction_id=current.jurisdiction_id,
            slug="chief-total-fixture",
            session_number=9996,
            session_type=schema.SessionType.special,
            year_start=2995,
            year_end=2995,
            name="Chief total fixture",
            is_current=False,
        )
        member = schema.Legislator(
            jurisdiction_id=current.jurisdiction_id,
            slug="chief-total-fixture-member",
            full_name="Chief Total Fixture",
            sort_name="Fixture, Chief Total",
        )
        db.add_all([other, member])
        db.flush()
        bills = []
        # 2 visible current chief bills, 1 unsummarized current chief bill,
        # 1 visible co-authored bill and 1 chief bill from another session.
        for index, (session, role, summarized) in enumerate(
            [
                (current, "chief_author", True),
                (current, "chief_author", True),
                (current, "chief_author", False),
                (current, "co_author", True),
                (other, "chief_author", True),
            ]
        ):
            bill = schema.Bill(
                session_id=session.id,
                chamber_id=chamber.id,
                bill_key=f"{session.slug}-HF{89000 + index}",
                file_type="HF",
                file_number=89000 + index,
                title="Bill total fixture",
                official_url=f"https://example.test/bills/{index}",
                is_omnibus=False,
            )
            db.add(bill)
            db.flush()
            db.add(
                schema.Sponsorship(
                    bill_id=bill.id,
                    legislator_id=member.id,
                    role=schema.SponsorshipRole(role),
                    source_chamber="house",
                )
            )
            if summarized:
                db.add(
                    schema.AIEnrichment(
                        bill_id=bill.id,
                        enrichment_type=schema.EnrichmentType.bill_summary,
                        model_name="test-fixture",
                        content_json={"summary": "Fixture summary"},
                        is_current=True,
                    )
                )
            bills.append(bill)
        # The same person may be listed on both chambers' author lists.
        db.add(
            schema.Sponsorship(
                bill_id=bills[0].id,
                legislator_id=member.id,
                role=schema.SponsorshipRole.chief_author,
                source_chamber="senate",
            )
        )
        db.commit()
        member_id, other_id = member.id, other.id
        bill_ids = [bill.id for bill in bills]
        bill_keys = [bill.bill_key for bill in bills]
    try:
        yield str(member_id), bill_keys
    finally:
        with Session(get_engine()) as db:
            for model in (schema.AIEnrichment, schema.Sponsorship):
                db.execute(delete(model).where(model.bill_id.in_(bill_ids)))
            db.execute(delete(schema.Bill).where(schema.Bill.id.in_(bill_ids)))
            db.execute(
                delete(schema.Legislator).where(schema.Legislator.id == member_id)
            )
            db.execute(
                delete(schema.LegislativeSession).where(
                    schema.LegislativeSession.id == other_id
                )
            )
            db.commit()


def test_legislator_bills_total_matches_filtered_unique_list(
    client, authored_bill_fixture
):
    member_id, bills = authored_bill_fixture
    path = f"/api/v1/legislators/{member_id}/bills"
    for params, expected in [
        ({"role": "chief_author"}, bills[:2]),
        ({"role": "co_author"}, [bills[3]]),
        ({}, [bills[0], bills[1], bills[3]]),
        ({"session": "chief-total-fixture", "role": "chief_author"}, [bills[4]]),
        ({"session": "chief-total-fixture", "role": "co_author"}, []),
    ]:
        response = client.get(path, params=params)
        assert response.status_code == 200
        payload = response.json()
        assert [row["id"] for row in payload["data"]] == expected
        assert payload["page"]["total"] == len(expected)


@pytest.mark.parametrize(
    "limit,offset,expected_count,has_more",
    [(1, 0, 1, True), (1, 1, 1, False), (1, 2, 0, False), (0, 0, 0, False)],
)
def test_legislator_bills_total_survives_paging(
    client, authored_bill_fixture, limit, offset, expected_count, has_more
):
    member_id, bills = authored_bill_fixture
    payload = client.get(
        f"/api/v1/legislators/{member_id}/bills",
        params={"role": "chief_author", "limit": limit, "offset": offset},
    ).json()
    assert payload["page"]["total"] == 2
    assert len(payload["data"]) == expected_count
    assert payload["page"]["has_more"] is has_more
    if expected_count:
        assert payload["data"][0]["id"] == bills[offset]
    # Keep the deliberately wider profile stats: all sessions and summaries.
    stats = client.get(
        f"/api/v1/legislators/{member_id}", params={"include": "stats"}
    ).json()["data"]["stats"]
    assert stats["chief_bill_count"] == 4
    assert stats["total_bill_count"] == 5
