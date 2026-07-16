"""End-to-end API coverage for the prior-biennium sessions (#155 follow-on).

Proves that once a historical session has ingested bills, it surfaces through
the same public endpoints the Search Bills session dropdown consumes:
``/sessions`` lists it and ``/bills?session=<slug>`` scopes to it. Setup and
teardown run against the shared test database and clean up after themselves so
other contract tests still see only the sample (current-session) corpus.
"""

from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from alethical.db.models import AIEnrichment, Bill, EnrichmentType, LegislativeSession
from alethical.db.session import get_engine
from alethical.pipeline.minnesota import MinnesotaIngestionPipeline

HISTORICAL_SLUG = "93-2023-regular"
HISTORICAL_BILL_KEY = "93-2023-HF100"


def _make_historical_bill() -> None:
    with Session(get_engine()) as session:
        pipeline = MinnesotaIngestionPipeline(session)
        refs = pipeline.seed_reference_data("0932023")
        historical = refs["sessions_by_number"][93]
        bill = Bill(
            session_id=historical.id,
            chamber_id=refs["chambers"]["house"].id,
            bill_key=HISTORICAL_BILL_KEY,
            file_type="HF",
            file_number=100,
            title="A 93rd Legislature bill",
        )
        session.add(bill)
        session.flush()
        # A current bill_summary enrichment makes the bill listable — the same
        # criterion the /bills list and /sessions honesty filter use.
        session.add(
            AIEnrichment(
                bill_id=bill.id,
                enrichment_type=EnrichmentType.bill_summary,
                model_name="test-enrichment",
                is_current=True,
                content_json={"summary": "A test summary.", "policy_areas": []},
                source_version_hash=f"test-{HISTORICAL_BILL_KEY}",
            )
        )
        session.commit()


def _make_raw_historical_bill() -> None:
    """A historical session whose only bill has NO current summary enrichment —
    i.e. it would return nothing from the bill list."""
    with Session(get_engine()) as session:
        pipeline = MinnesotaIngestionPipeline(session)
        refs = pipeline.seed_reference_data("0932023")
        historical = refs["sessions_by_number"][93]
        session.add(
            Bill(
                session_id=historical.id,
                chamber_id=refs["chambers"]["house"].id,
                bill_key=HISTORICAL_BILL_KEY,
                file_type="HF",
                file_number=100,
                title="A 93rd Legislature bill",
            )
        )
        session.commit()


def _remove_historical_bill() -> None:
    with Session(get_engine()) as session:
        bill_ids = list(
            session.scalars(
                select(Bill.id).where(Bill.bill_key == HISTORICAL_BILL_KEY)
            ).all()
        )
        if bill_ids:
            session.execute(
                delete(AIEnrichment).where(AIEnrichment.bill_id.in_(bill_ids))
            )
        session.execute(delete(Bill).where(Bill.bill_key == HISTORICAL_BILL_KEY))
        session.execute(
            delete(LegislativeSession).where(LegislativeSession.slug == HISTORICAL_SLUG)
        )
        session.commit()


def test_session_with_only_unenriched_bills_is_hidden(client) -> None:
    """grounded-answers rule 2: a session whose bills have no current summary
    returns nothing from the bill list, so it must NOT appear as a dropdown
    option. The 94th (current) session stays visible as the safety net."""
    _make_raw_historical_bill()
    try:
        slugs = {row["slug"] for row in client.get("/api/v1/sessions").json()["data"]}
        assert HISTORICAL_SLUG not in slugs
        assert "94-2025-regular" in slugs
    finally:
        _remove_historical_bill()


def test_prior_session_surfaces_in_sessions_and_bill_filter(client) -> None:
    _make_historical_bill()
    try:
        sessions = client.get("/api/v1/sessions", params={"scope": "bills"}).json()[
            "data"
        ]
        slugs = {row["slug"] for row in sessions}
        assert HISTORICAL_SLUG in slugs
        assert "94-2025-regular" in slugs

        # Bills scope is the default.
        assert client.get("/api/v1/sessions").json()["data"] == sessions

        # The historical session has bills but no roster, so the legislators
        # dropdown must NOT offer it — only the current session is guaranteed.
        legislator_scope = client.get(
            "/api/v1/sessions", params={"scope": "legislators"}
        ).json()["data"]
        legislator_slugs = {row["slug"] for row in legislator_scope}
        assert HISTORICAL_SLUG not in legislator_slugs
        assert "94-2025-regular" in legislator_slugs
        # None of the surfaced sessions is a current-flag duplicate; only the
        # 94th biennium is current.
        assert [row["slug"] for row in sessions if row["is_current"]] == [
            "94-2025-regular"
        ]

        historical = client.get(
            "/api/v1/bills", params={"session": HISTORICAL_SLUG, "limit": 50}
        )
        assert historical.status_code == 200
        # The bill list keys each item by its bill_key under "id".
        keys = {row["id"] for row in historical.json()["data"]}
        assert HISTORICAL_BILL_KEY in keys
        # The session filter is exclusive: the historical view shows no
        # current-session bills.
        assert all(key.startswith("93-2023-") for key in keys)

        # And the current session still excludes the historical bill.
        current = client.get(
            "/api/v1/bills", params={"session": "94-2025-regular", "limit": 100}
        )
        current_keys = {row["id"] for row in current.json()["data"]}
        assert HISTORICAL_BILL_KEY not in current_keys
    finally:
        _remove_historical_bill()

    # Teardown really removed it: the empty historical session no longer shows.
    with Session(get_engine()) as session:
        assert (
            session.scalar(
                select(LegislativeSession).where(
                    LegislativeSession.slug == HISTORICAL_SLUG
                )
            )
            is None
        )
