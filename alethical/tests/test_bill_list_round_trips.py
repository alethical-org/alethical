"""How many database round trips one bill list costs (#2040).

The API and the database sit in neighbouring regions, so every separate statement
inside one request pays a hop across that gap whatever it asks for. That is why
asking `/bills` for 1 full row cost 454 ms on production and asking for 10 cost
565 ms: the part that barely moved was the 11 statements, not the rows.

These tests count statements rather than measure a timing, because the count is
the part that is the same on every machine -- a timing measured here would say
more about this laptop than about the route. And a served-value assertion cannot
see any of this: every statement counted below could be split back into 2 and
every response body would stay identical, which is why the counts are pinned.
"""

from __future__ import annotations

from sqlalchemy import event, select
from sqlalchemy.orm import Session

from alethical.api.services.legislative_sessions import current_legislature_scope
from alethical.db.schema import load_schema
from alethical.db.session import get_engine

schema = load_schema()

# What loading a page of result cards is allowed to cost: the bills themselves,
# their actions, their chief authors, and the stored analysis a card draws. Down
# from 6 -- a bill's 4 counters and its chief author's own row used to each cost a
# statement, and both now ride back on a read that was already happening.
MOST_STATEMENTS_A_CARD_PAGE_MAY_COST = 4

# What deciding which legislative sessions a reader is asking about is allowed to
# cost. Down from 2: the current session and the others of the same Legislature
# came back in separate statements, and now come back together. This runs on the
# bill list, the bill page, the legislator pages and the Ask paths.
MOST_STATEMENTS_THE_SESSION_SCOPE_MAY_COST = 1


def _statements_while(work):
    """Run ``work`` against the test database and return what it executed."""
    engine = get_engine()
    executed: list[str] = []

    def record(conn, cursor, statement, parameters, context, executemany):
        executed.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    try:
        with Session(engine) as db:
            result = work(db)
    finally:
        event.remove(engine, "before_cursor_execute", record)
    return executed, result


def _current_session_id() -> object:
    with Session(get_engine()) as db:
        return db.scalar(
            select(schema.LegislativeSession.id).where(
                schema.LegislativeSession.is_current.is_(True)
            )
        )


def test_a_page_of_result_cards_stays_within_its_round_trip_budget(
    seed_database: None,
) -> None:
    session_id = _current_session_id()
    executed, rows = _statements_while(
        lambda db: db.scalars(schema.bill_list_stmt(session_id).limit(10)).all()
    )
    assert rows, "the seeded corpus should hold at least one listable bill"
    assert len(executed) <= MOST_STATEMENTS_A_CARD_PAGE_MAY_COST, [
        " ".join(statement.split())[:90] for statement in executed
    ]


def test_asking_for_1_card_costs_the_same_trips_as_asking_for_10(
    seed_database: None,
) -> None:
    """The shape of the original finding, kept visible.

    A card page's cost is its round trips, so 1 row and 10 rows cost the same
    number of them. Pinning the equality is what would catch a later change that
    reads something once per bill: the count would stop matching.
    """
    session_id = _current_session_id()
    one, _ = _statements_while(
        lambda db: db.scalars(schema.bill_list_stmt(session_id).limit(1)).all()
    )
    ten, _ = _statements_while(
        lambda db: db.scalars(schema.bill_list_stmt(session_id).limit(10)).all()
    )
    assert len(one) == len(ten) <= MOST_STATEMENTS_A_CARD_PAGE_MAY_COST


def test_the_slim_directory_view_reads_no_per_bill_records(
    seed_database: None,
) -> None:
    """The slim view loads none of a bill's related records, so it must stay at 1."""
    session_id = _current_session_id()
    executed, _ = _statements_while(
        lambda db: db.scalars(
            schema.bill_list_stmt(session_id, directory=True).limit(10)
        ).all()
    )
    assert len(executed) == 1


def test_the_session_scope_is_settled_in_one_statement(seed_database: None) -> None:
    executed, scope = _statements_while(lambda db: current_legislature_scope(db))
    assert scope.primary is not None
    assert scope.primary in scope.sessions
    assert len(executed) <= MOST_STATEMENTS_THE_SESSION_SCOPE_MAY_COST, [
        " ".join(statement.split())[:90] for statement in executed
    ]


def test_the_session_scope_still_refuses_two_current_sessions(
    seed_database: None,
) -> None:
    """The refusal the 2 statements used to make, kept by the 1 that replaced them.

    Nothing in the schema stops 2 rows being flagged current, so this function
    raises rather than picking whichever the database returned first. The rewrite
    counts the same rows, and the count is what raises, so this pins that the
    guard survived the change. The flag is put back inside a rolled-back
    transaction, so the seeded database is untouched.
    """
    import pytest

    engine = get_engine()
    connection = engine.connect()
    transaction = connection.begin()
    try:
        db = Session(bind=connection)
        primary = db.scalars(
            select(schema.LegislativeSession).where(
                schema.LegislativeSession.is_current.is_(True)
            )
        ).one()
        sibling = db.scalars(
            select(schema.LegislativeSession).where(
                schema.LegislativeSession.session_number == primary.session_number,
                schema.LegislativeSession.id != primary.id,
            )
        ).first()
        assert sibling is not None, "the seeded Legislature should hold 2 sessions"
        sibling.is_current = True
        db.flush()
        with pytest.raises(RuntimeError, match="exactly one current"):
            current_legislature_scope(db)
        db.close()
    finally:
        transaction.rollback()
        connection.close()


def test_a_card_page_loads_only_the_analysis_it_draws(seed_database: None) -> None:
    """What a bill list carries back, not how many trips it takes.

    A bill keeps every analysis ever written for it: on production 10,159 of the
    10,517 enriched bills hold 2 rows, at about 3.6 kB of stored document each,
    and the serializer keeps the current summary and drops the rest. Loading them
    all cost 104 kB on a 10-bill page to use 67 kB of it.

    So the load asks for the current summary alone. This test gives one bill a
    superseded summary and an analysis of another kind, both of which the old
    load returned, and requires neither to come back -- while the summary a card
    draws is unchanged, which is the half a response assertion can see. Both extra
    rows are written inside a rolled-back transaction.
    """
    from alethical.api.serializers import current_bill_summary_enrichment

    engine = get_engine()
    connection = engine.connect()
    transaction = connection.begin()
    try:
        db = Session(bind=connection)
        summary = db.scalars(
            select(schema.AIEnrichment).where(
                schema.AIEnrichment.bill_id.is_not(None),
                schema.AIEnrichment.is_current.is_(True),
                schema.AIEnrichment.enrichment_type
                == schema.EnrichmentType.bill_summary,
            )
        ).first()
        assert summary is not None, "the seeded corpus should hold one bill summary"
        bill_id = summary.bill_id
        expected = current_bill_summary_enrichment([summary])
        assert expected is not None

        db.add_all(
            [
                schema.AIEnrichment(
                    bill_id=bill_id,
                    enrichment_type=schema.EnrichmentType.bill_summary,
                    model_name="superseded",
                    is_current=False,
                    content_json={"summary": "An older summary nobody should read."},
                ),
                schema.AIEnrichment(
                    bill_id=bill_id,
                    enrichment_type=schema.EnrichmentType.talking_points,
                    model_name="other-kind",
                    is_current=True,
                    content_json={"summary": "Not a summary a card draws."},
                ),
            ]
        )
        db.flush()
        db.expunge_all()

        row = db.scalars(
            schema.bill_list_stmt(
                db.scalar(
                    select(schema.Bill.session_id).where(schema.Bill.id == bill_id)
                )
            ).where(schema.Bill.id == bill_id)
        ).one()
        loaded = list(row.enrichments)
        assert [item.model_name for item in loaded] == [expected.model_name], (
            "only the current bill summary should cross the wire; loaded "
            f"{[(item.model_name, item.enrichment_type.value) for item in loaded]}"
        )
        assert current_bill_summary_enrichment(loaded).content_json == (
            expected.content_json
        )
        db.close()
    finally:
        transaction.rollback()
        connection.close()
