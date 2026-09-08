"""The effective-date section read, exercised against real Postgres (#2040).

The other tests of ``bill_effective_dates`` drive it through a fake database, so
they prove the tier logic and prove nothing about the SQL. The one thing that
statement now does beyond fetching rows is decide, in the database, which bills
are worth fetching text for at all: all three tiers gate on the effective-date
*headings*, so a version mixing headed and silent sections can never resolve a
date and its text is left in the database rather than crossing the region hop.

That decision is a ``HAVING`` clause counting headings with a regular expression,
and a fake database cannot tell whether it is right. These tests build the three
shapes in the real schema and read them back through the real query, inside a
transaction that is rolled back, so they leave the seeded database untouched.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session, selectinload

from alethical.api.routers.public import bill_effective_dates
from alethical.db.schema import load_schema
from alethical.db.session import get_engine

schema = load_schema()
Bill = schema.Bill
BillAction = schema.BillAction
BillVersion = schema.BillVersion
BillVersionSection = schema.BillVersionSection
Chamber = schema.Chamber
Jurisdiction = schema.Jurisdiction
LegislativeSession = schema.LegislativeSession

# The heading the Revisor puts on a section that states its own effective date.
HEADING = "EFFECTIVE DATE."
ONE_DATE = "This section is effective July 1, 2027."
NO_DATE = "Amended statute text, with no effective clause."


@pytest.fixture()
def db():
    """A session on this worktree's test database, rolled back afterwards."""
    connection = get_engine().connect()
    transaction = connection.begin()
    session = Session(bind=connection)
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


# The 2 actions the Revisor publishes for a signed act, which tier B and tier C
# cross-check a date against. Without them neither tier can resolve anything, so a
# test that needs those tiers to succeed has to carry them.
REVISOR_ACTIONS = (
    ("Governor approval", "05/15/2025"),
    ("Effective date", "08/01/2025"),
)


def _bill(db, *, sections, is_omnibus=False, actions=()):
    """One signed bill with a current version carrying ``sections``.

    ``sections`` is a list of ``(heading, raw_text)`` in the shape the real column
    holds -- ``None`` for a section that carries no effective-date heading.
    ``actions`` is ``(action_text, action_description)`` pairs.
    """
    tag = uuid.uuid4().hex[:8]
    jurisdiction = Jurisdiction(slug=f"j-{tag}", name="Test")
    db.add(jurisdiction)
    db.flush()
    chamber = Chamber(
        jurisdiction_id=jurisdiction.id,
        chamber_type=schema.ChamberType.house,
        slug=f"house-{tag}",
        name="House",
        short_name="H",
    )
    legislative_session = LegislativeSession(
        jurisdiction_id=jurisdiction.id,
        slug=f"s-{tag}",
        session_number=94,
        session_type="regular",
        year_start=2025,
        year_end=2026,
        name="Test session",
    )
    db.add_all([chamber, legislative_session])
    db.flush()
    bill = Bill(
        session_id=legislative_session.id,
        chamber_id=chamber.id,
        bill_key=f"hf-{tag}",
        file_type="HF",
        file_number="1",
        title="A test bill",
        status_key="signed_into_law",
        is_omnibus=is_omnibus,
    )
    db.add(bill)
    db.flush()
    version = BillVersion(bill_id=bill.id, version_code=f"v-{tag}", is_current=True)
    db.add(version)
    db.flush()
    db.add_all(
        [
            BillAction(
                bill_id=bill.id,
                action_number=number,
                action_text=action_text,
                action_description=description,
            )
            for number, (action_text, description) in enumerate(actions, start=1)
        ]
    )
    db.add_all(
        [
            BillVersionSection(
                bill_version_id=version.id,
                section_id_text=f"sec-{order}",
                source_order=order,
                effective_date_heading=heading,
                raw_text=raw_text,
            )
            for order, (heading, raw_text) in enumerate(sections)
        ]
    )
    db.flush()
    # ``actions`` is read by the tier B/C cross-check, so load it the way the list
    # route does rather than letting it lazy-load mid-assertion.
    return db.scalars(
        select(Bill).where(Bill.id == bill.id).options(selectinload(Bill.actions))
    ).one()


def test_every_section_headed_resolves_its_stated_date(db):
    """All headed, all naming the same day: tier A, and the text is needed."""
    bill = _bill(db, sections=[(HEADING, ONE_DATE), (HEADING, ONE_DATE)])
    assert bill_effective_dates(db, [bill]) == {str(bill.id): "July 1, 2027"}


def test_no_section_headed_and_nothing_to_cross_check_serves_nothing(db):
    """All silent: tier C is possible, and falls through with no Revisor action."""
    bill = _bill(db, sections=[(None, NO_DATE), ("", NO_DATE)])
    assert bill_effective_dates(db, [bill]) == {}


def test_a_bill_mixing_headed_and_silent_sections_serves_nothing(db):
    """The shape whose text is now never fetched.

    Its first section states a date and its second states none, so tier A and B
    refuse it (they need every section headed) and tier C refuses it (it needs
    none of them headed). The served value is nothing, which is what the route
    served when it read all of this bill's text to find out.
    """
    bill = _bill(db, sections=[(HEADING, ONE_DATE), (None, NO_DATE)])
    assert bill_effective_dates(db, [bill]) == {}


def test_an_omnibus_mixing_the_two_still_says_various_dates(db):
    """The omnibus fallback does not depend on the text, so skipping it is safe."""
    bill = _bill(db, sections=[(HEADING, ONE_DATE), (None, NO_DATE)], is_omnibus=True)
    assert bill_effective_dates(db, [bill]) == {str(bill.id): "various dates"}


def test_no_section_headed_resolves_the_revisor_date(db):
    """All silent, with the Revisor's own dates to check against: tier C."""
    bill = _bill(db, sections=[(None, NO_DATE), ("", NO_DATE)], actions=REVISOR_ACTIONS)
    assert bill_effective_dates(db, [bill]) == {str(bill.id): "August 1, 2025"}


def test_a_whitespace_only_heading_counts_as_no_heading(db):
    """Postgres and Python must agree on what an empty heading is.

    The ``HAVING`` clause asks whether a heading holds a non-blank character; the
    tier predicates ask whether ``heading.strip()`` is empty. A heading of spaces
    is the one value the 2 could read differently, so it is pinned here.

    The Revisor's dates are attached deliberately, to make the 2 readings give
    different answers rather than the same one. Read as silent, this bill is all
    silent and tier C resolves August 1; read as headed, it is mixed, its text is
    never fetched and nothing resolves. Without the actions both readings return
    nothing and the test would pass either way.
    """
    bill = _bill(
        db, sections=[("   ", NO_DATE), (None, NO_DATE)], actions=REVISOR_ACTIONS
    )
    assert bill_effective_dates(db, [bill]) == {str(bill.id): "August 1, 2025"}


def test_a_mixed_bill_s_text_never_leaves_the_database(db):
    """The saving itself, which no assertion about the served value can catch.

    Reading every section of every signed bill and reading none of them produce
    the identical answer for a mixed bill, so each test above passes whether or
    not the text is fetched. What the fetch costs is real: on production, page 1
    of ``/bills?sort=progress`` moved 482 kB of section text to serve 2 bills'
    dates, because 8 of its 10 bills mix headed and silent sections and could
    never resolve one (#2040). So this counts the rows the section read brings
    back and requires it to bring back none.
    """
    mixed = [
        _bill(db, sections=[(HEADING, ONE_DATE), (None, NO_DATE)]) for _ in range(3)
    ]
    rows_fetched = []

    def count_rows(conn, cursor, statement, parameters, context, executemany):
        if "raw_text" in statement:
            rows_fetched.append(cursor.rowcount)

    event.listen(db.get_bind(), "after_cursor_execute", count_rows)
    try:
        assert bill_effective_dates(db, mixed) == {}
    finally:
        event.remove(db.get_bind(), "after_cursor_execute", count_rows)

    assert rows_fetched == [0], (
        "the section read should fetch no rows for bills whose headings already "
        f"rule every tier out; it fetched {rows_fetched}"
    )
