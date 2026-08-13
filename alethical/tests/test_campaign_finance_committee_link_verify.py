"""Re-checking a person-confirmed legislator-committee link on every load (#1398).

`scripts/review_legislator_campaign_committees.py verify` already does this check by
hand. This pins the loader's own copy of it,
`campaign_finance.verify_confirmed_committee_links`, and the wiring in
`load_campaign_finance` that runs it every time, using this run's own downloaded
contributions file and its own published filer directory rather than a second fetch of
either.

Every test here stands in for a way a stale confirmed link could keep publishing
another person's money under the wrong legislator's name without anyone noticing:

* **Zero confirmed links is a pass, not a failure.** True of every database until the
  first review sitting lands, and a check that failed on an empty table would block the
  loader before review has even started.
* **A rename, a legislator who left office, and a party or seat mismatch are each their
  own contradiction**, reported and never repaired.
* **A contradiction never blocks the load.** The money data a run publishes is correct
  whether or not a committee's identity changed, and the two are checked separately.

Needs the local Postgres on port 54329.
"""

from __future__ import annotations

import threading
import uuid
from datetime import UTC, datetime
from http.server import ThreadingHTTPServer
from typing import Iterator

import pytest
from sqlalchemy import select, text

from alethical.db import models
from alethical.db.session import get_session_factory
from alethical.pipeline import campaign_finance as cf
from alethical.tests.test_campaign_finance_load import (
    FakeBoard,
    MemoryStore,
    _clear,
    _Handler,
    publish_first,
)

Dataset = models.CampaignFinanceDataset
CONFIRMED = models.CommitteeLinkReviewDecision.confirmed
CONTRIBUTIONS_HEADER = cf.SPEC_BY_DATASET[Dataset.contributions].header_line


def _clear_committee_links(session) -> None:
    # `_clear` (below) does not reach this table -- it belongs to #1354, not #1328's
    # loader -- and `scripts/load_sample_data.py` never writes a row here, so it is
    # always safe to empty in this test database. Needed because a test that runs a
    # full `load_campaign_finance()` cycle commits internally as it publishes, which
    # commits whatever this file already `flush()`-ed in the same transaction,
    # including a confirmed link -- so one test's link can otherwise outlive it and
    # collide with the next test's own "19200".
    session.rollback()
    session.execute(text("DELETE FROM legislator_campaign_committee"))
    session.commit()


@pytest.fixture()
def db(seed_database: None):
    session = get_session_factory()()
    # Some tests here run a full `load_campaign_finance()` cycle, which commits
    # internally as it publishes. `_clear` (from test_campaign_finance_load.py) is what
    # that file's own tests use to keep one test's published release from leaking into
    # the next as a false baseline.
    _clear(session)
    _clear_committee_links(session)
    try:
        yield session
    finally:
        _clear(session)
        _clear_committee_links(session)
        session.close()


@pytest.fixture()
def board() -> Iterator[FakeBoard]:
    fake = FakeBoard()
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    server.board = fake  # type: ignore[attr-defined]
    fake.port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield fake
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


@pytest.fixture()
def store() -> MemoryStore:
    return MemoryStore()


# --- Building a sitting member and a confirmed link ---------------------------


def a_sitting_member(
    db,
    *,
    full_name: str = "Rick Olson",
    chamber_slug: str = "senate",
    party: str | None = None,
    district_code: str | None = None,
    is_current: bool = True,
) -> models.Legislator:
    """A legislator with one service period, built on the sample data already seeded.

    Reuses the jurisdiction, chamber and current session `scripts/load_sample_data.py`
    already creates, and adds a fresh district so tests never collide on one.
    """
    jurisdiction_id = db.scalars(select(models.Jurisdiction.id)).first()
    chamber = db.scalars(
        select(models.Chamber).where(
            models.Chamber.jurisdiction_id == jurisdiction_id,
            models.Chamber.slug == chamber_slug,
        )
    ).first()
    current_session = db.scalars(
        select(models.LegislativeSession).where(
            models.LegislativeSession.jurisdiction_id == jurisdiction_id,
            models.LegislativeSession.is_current.is_(True),
        )
    ).first()
    token = uuid.uuid4().hex[:6]
    district = models.District(
        jurisdiction_id=jurisdiction_id,
        chamber_id=chamber.id,
        code=district_code or f"T{token}",
        label=f"Test district {token}",
    )
    db.add(district)
    db.flush()
    parts = full_name.split()
    legislator = models.Legislator(
        jurisdiction_id=jurisdiction_id,
        slug=f"test-{token}",
        full_name=full_name,
        sort_name=f"{parts[-1]}, {' '.join(parts[:-1])}",
        first_name=" ".join(parts[:-1]),
        last_name=parts[-1],
    )
    db.add(legislator)
    db.flush()
    db.add(
        models.LegislatorServicePeriod(
            legislator_id=legislator.id,
            session_id=current_session.id,
            chamber_id=chamber.id,
            district_id=district.id,
            is_current=is_current,
            party=party,
        )
    )
    db.flush()
    return legislator


def a_confirmed_link(
    legislator: models.Legislator,
    registration: str,
    committee_name: str,
    *,
    reviewer: str = "Eugene Lopin",
) -> models.LegislatorCampaignCommittee:
    return models.LegislatorCampaignCommittee(
        legislator_id=legislator.id,
        registration_number=registration,
        decision=CONFIRMED,
        committee_name_as_reviewed=committee_name,
        reviewed_by=reviewer,
    )


def write_contributions_csv(tmp_path, rows: list[str]) -> str:
    path = tmp_path / "contributions.csv"
    path.write_text("\n".join([CONTRIBUTIONS_HEADER, *rows]) + "\n", encoding="utf-8")
    return str(path)


def a_filing_snapshot(db) -> models.CampaignFinanceFilingSnapshot:
    snapshot = models.CampaignFinanceFilingSnapshot(
        fetch_started_at=datetime.now(UTC),
        fetch_completed_at=datetime.now(UTC),
        status=models.CampaignFinanceSnapshotStatus.loaded,
    )
    db.add(snapshot)
    db.flush()
    return snapshot


def a_filer_row(
    db,
    snapshot: models.CampaignFinanceFilingSnapshot,
    registration: str,
    *,
    office: str = "Senate",
    district: str,
    party: str = "DFL",
    is_incumbent: bool = True,
) -> models.CampaignFinanceFiler:
    filer = models.CampaignFinanceFiler(
        snapshot_id=snapshot.id,
        registration_number=registration,
        kind=models.CampaignFinanceFilerKind.candidate_committee,
        name="Olson, Rick Senate Committee",
        candidate_name="Rick Olson",
        office=office,
        district=district,
        party=party,
        is_incumbent=is_incumbent,
    )
    db.add(filer)
    db.flush()
    return filer


class FakeFilings:
    """Just enough of `FilingsContext` for `verify_confirmed_committee_links` to use."""

    def __init__(self, snapshot_id):
        self.snapshot_id = snapshot_id


# --- The check itself ---------------------------------------------------------


def test_zero_confirmed_links_is_a_pass(db, tmp_path) -> None:
    path = write_contributions_csv(
        tmp_path,
        [
            '19200,"Olson, Rick Senate Committee",PCC,,250.0000,2025-07-10,2025,'
            '"Smith, Jane",,Individual,Contribution,No,,55102,Retired'
        ],
    )
    problems = cf.verify_confirmed_committee_links(
        db, path, None, log=lambda message: None
    )
    assert problems == []


def test_an_agreeing_link_produces_no_contradiction(db, tmp_path) -> None:
    member = a_sitting_member(db)
    db.add(a_confirmed_link(member, "19200", "Olson, Rick Senate Committee"))
    db.flush()
    path = write_contributions_csv(
        tmp_path,
        [
            '19200,"Olson, Rick Senate Committee",PCC,,250.0000,2025-07-10,2025,'
            '"Smith, Jane",,Individual,Contribution,No,,55102,Retired'
        ],
    )
    problems = cf.verify_confirmed_committee_links(
        db, path, None, log=lambda message: None
    )
    assert problems == []


def test_a_renamed_committee_is_reported(db, tmp_path) -> None:
    # The Board publishes a committee's *current* name against all of its history, so a
    # rename is a legitimate event -- it still wants a person's eyes, because the
    # reviewer agreed to a different string than what is now published.
    member = a_sitting_member(db)
    db.add(a_confirmed_link(member, "19200", "Olson, Richard Senate Committee"))
    db.flush()
    path = write_contributions_csv(
        tmp_path,
        [
            '19200,"Olson, Rick Senate Committee",PCC,,250.0000,2025-07-10,2025,'
            '"Smith, Jane",,Individual,Contribution,No,,55102,Retired'
        ],
    )
    problems = cf.verify_confirmed_committee_links(
        db, path, None, log=lambda message: None
    )
    assert len(problems) == 1
    assert "now published as" in problems[0]
    assert "Rick Olson" in problems[0]


def test_a_legislator_no_longer_sitting_is_reported(db, tmp_path) -> None:
    member = a_sitting_member(db, is_current=False)
    db.add(a_confirmed_link(member, "19200", "Olson, Rick Senate Committee"))
    db.flush()
    path = write_contributions_csv(
        tmp_path,
        [
            '19200,"Olson, Rick Senate Committee",PCC,,250.0000,2025-07-10,2025,'
            '"Smith, Jane",,Individual,Contribution,No,,55102,Retired'
        ],
    )
    problems = cf.verify_confirmed_committee_links(
        db, path, None, log=lambda message: None
    )
    assert len(problems) == 1
    assert "no longer a sitting member" in problems[0]
    # Not `member.full_name`: the roster query that supplies names only knows sitting
    # members, so a legislator this check is complaining is no longer sitting is, for
    # the same reason, one this check cannot name -- it falls back to the raw id,
    # matching `scripts/review_legislator_campaign_committees.py`'s own `run_verify`.
    assert str(member.id) in problems[0]


def test_a_party_mismatch_is_reported(db, tmp_path) -> None:
    # Independent of the reviewer: which party's own units gave the committee money is
    # something nobody weighed by hand at review time.
    member = a_sitting_member(db, party="DFL")
    db.add(a_confirmed_link(member, "19200", "Olson, Rick Senate Committee"))
    db.flush()
    path = write_contributions_csv(
        tmp_path,
        [
            '19200,"Olson, Rick Senate Committee",PCC,,500.0000,2025-04-04,2025,'
            '"Republican Party of Minnesota",,Party Unit,Contribution,No,,55102,'
        ],
    )
    problems = cf.verify_confirmed_committee_links(
        db, path, None, log=lambda message: None
    )
    assert len(problems) == 1
    assert "party units paying this committee are R" in problems[0]


def test_a_registration_missing_from_the_file_is_reported(db, tmp_path) -> None:
    member = a_sitting_member(db)
    db.add(a_confirmed_link(member, "99999", "Nobody Here Committee"))
    db.flush()
    path = write_contributions_csv(
        tmp_path,
        [
            '19200,"Olson, Rick Senate Committee",PCC,,250.0000,2025-07-10,2025,'
            '"Smith, Jane",,Individual,Contribution,No,,55102,Retired'
        ],
    )
    problems = cf.verify_confirmed_committee_links(
        db, path, None, log=lambda message: None
    )
    assert len(problems) == 1
    assert "no longer appears in the contributions file" in problems[0]


def test_a_different_seat_in_the_filer_directory_is_reported(db, tmp_path) -> None:
    # Independent of both the reviewer and the payment file: the Board's own directory
    # states each committee's district, which no name rule can read.
    member = a_sitting_member(db, chamber_slug="senate", district_code="5", party="DFL")
    db.add(a_confirmed_link(member, "19200", "Olson, Rick Senate Committee"))
    db.flush()
    snapshot = a_filing_snapshot(db)
    a_filer_row(db, snapshot, "19200", office="Senate", district="47", party="DFL")
    path = write_contributions_csv(
        tmp_path,
        [
            '19200,"Olson, Rick Senate Committee",PCC,,250.0000,2025-07-10,2025,'
            '"Smith, Jane",,Individual,Contribution,No,,55102,Retired'
        ],
    )
    problems = cf.verify_confirmed_committee_links(
        db, path, FakeFilings(snapshot.id), log=lambda message: None
    )
    assert len(problems) == 1
    assert "not this member's seat" in problems[0]


def test_the_filer_directory_agreeing_produces_no_contradiction(db, tmp_path) -> None:
    member = a_sitting_member(
        db, chamber_slug="senate", district_code="47", party="DFL"
    )
    db.add(a_confirmed_link(member, "19200", "Olson, Rick Senate Committee"))
    db.flush()
    snapshot = a_filing_snapshot(db)
    a_filer_row(db, snapshot, "19200", office="Senate", district="47", party="DFL")
    path = write_contributions_csv(
        tmp_path,
        [
            '19200,"Olson, Rick Senate Committee",PCC,,250.0000,2025-07-10,2025,'
            '"Smith, Jane",,Individual,Contribution,No,,55102,Retired'
        ],
    )
    problems = cf.verify_confirmed_committee_links(
        db, path, FakeFilings(snapshot.id), log=lambda message: None
    )
    assert problems == []


def test_a_rejected_link_is_never_checked(db, tmp_path) -> None:
    # Only a *confirmed* link publishes anything, so only a confirmed link is re-checked.
    # A rejection is stored so the proposer stops re-suggesting it -- it never needs
    # re-verifying against anything.
    member = a_sitting_member(db)
    db.add(
        models.LegislatorCampaignCommittee(
            legislator_id=member.id,
            registration_number="19200",
            decision=models.CommitteeLinkReviewDecision.rejected,
            committee_name_as_reviewed="Someone Else Committee",
            reviewed_by="Eugene Lopin",
        )
    )
    db.flush()
    path = write_contributions_csv(
        tmp_path,
        [
            '19200,"Olson, Rick Senate Committee",PCC,,250.0000,2025-07-10,2025,'
            '"Smith, Jane",,Individual,Contribution,No,,55102,Retired'
        ],
    )
    problems = cf.verify_confirmed_committee_links(
        db, path, None, log=lambda message: None
    )
    assert problems == []


# --- Wired into the loader itself ---------------------------------------------


def test_zero_confirmed_links_still_lets_the_load_publish(db, board, store) -> None:
    published = publish_first(db, board, store)
    assert published.committee_link_contradictions == []
    assert published.published
    assert published.refusal is None
    assert "NEEDS A PERSON" not in published.summary()


def test_a_contradiction_does_not_block_publication(db, board, store) -> None:
    # publish_first's board fixture publishes registration 19200 as "Olson, Rick Senate
    # Committee" (CONTRIBUTION_ROWS in test_campaign_finance_load.py). Confirming it
    # under a different name first is what makes this run's re-check find a rename.
    member = a_sitting_member(db)
    db.add(a_confirmed_link(member, "19200", "Olson, Richard Senate Committee"))
    db.flush()

    published = publish_first(db, board, store)

    assert published.published
    assert published.refusal is None
    assert len(published.committee_link_contradictions) == 1
    assert "now published as" in published.committee_link_contradictions[0]
    assert "NEEDS A PERSON" in published.summary()
    assert "1 confirmed" in published.summary()
