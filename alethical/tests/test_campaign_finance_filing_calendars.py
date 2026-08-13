"""What may and may not be said about when a committee's next money report is due.

Net: the failure these tests exist to prevent is telling a reader that a named
politician owes a report when they do not, or that nothing is due when something is. So
most of what follows is a committee the state's records cannot place, and an assertion
that the answer comes back **unknown with no date** rather than defaulting onto whichever
calendar is more common.

The pure classification tests need no database. The 4 at the end read a real snapshot,
because "no snapshot published" and "this committee is not in the snapshot" are states
only the database layer can be wrong about.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from typing import Iterator

import pytest

from alethical.api.services import committee_filing_schedule as service
from alethical.db import models
from alethical.db.session import get_session_factory
from alethical.pipeline import campaign_finance_filing_calendars as calendars
from alethical.pipeline.campaign_finance_filing_calendars import (
    CalendarKey,
    CataloguedReport,
    ScheduleClass,
    classify,
)

# The day every dated assertion below is made on, a day after the 2026 primary and
# after the pre-primary report came due. Pinned rather than ``date.today()``: the whole
# answer is a function of the day it is asked, so a test reading the clock would start
# failing on 27 October when the pre-general came due.
AS_OF = date(2026, 8, 12)

PRE_PRIMARY = CataloguedReport(
    filing_year=2026, report_name="2026 Pre-Primary Report", special_election=False
)
YEAR_END_2025 = CataloguedReport(
    filing_year=2025, report_name="2025 Year-End Report", special_election=False
)


def place(**overrides):
    """Classify one committee, with the ordinary sitting-legislator case as the default."""
    kwargs = dict(
        registration_number="17500",
        year=2026,
        catalogued=[YEAR_END_2025],
        office="House",
        termination_date=None,
        as_of=AS_OF,
    )
    kwargs.update(overrides)
    return classify(**kwargs)


# --- The transcription itself ---------------------------------------------------


def test_every_calendar_records_where_it_was_read_from_and_when() -> None:
    """Without these a future session cannot tell a transcription from a guess, and the
    calendars are the one thing here no source serves us."""
    for key in CalendarKey:
        assert key in calendars.SOURCE_URLS
        assert calendars.SOURCE_URLS[key].startswith("https://cfb.mn.gov/pdf/calendars/")
    assert calendars.TRANSCRIBED_ON == date(2026, 8, 12)


def test_all_4_calendars_are_transcribed_for_2026() -> None:
    for key in CalendarKey:
        assert calendars.CALENDARS.get((key, 2026)), key


@pytest.mark.parametrize(
    ("report_name", "period_end"),
    [
        # The Board serves a `CutOffDate` per report (§9.1), and these are the 3 periods
        # a candidate calendar shares with what it serves. Every one matches, which is
        # the only independent check available on a hand-transcription.
        ("Pre-primary report of receipts and expenditures", date(2026, 7, 20)),
        ("Pre-general report of receipts and expenditures", date(2026, 10, 19)),
        ("2026 year-end report of receipts and expenditures", date(2026, 12, 31)),
    ],
)
def test_a_transcribed_period_end_matches_the_cut_off_date_the_board_serves(
    report_name: str, period_end: date
) -> None:
    entries = calendars.CALENDARS[
        (CalendarKey.legislative_candidate_filing_for_office, 2026)
    ]
    entry = next(one for one in entries if one.report_name == report_name)
    assert entry.period_end == period_end


def test_no_period_start_is_assumed_and_the_2025_year_end_starts_where_it_is_printed() -> None:
    """§7 forbids hardcoding 1 January as a period start. Almost every period does begin
    there, which is exactly why each one has to come off the document -- so this asserts
    the 2 different years, from the 2 calendars, as printed."""
    filing = calendars.CALENDARS[
        (CalendarKey.legislative_candidate_filing_for_office, 2026)
    ]
    closing_2025 = next(
        one for one in filing if one.period_end == date(2025, 12, 31)
    )
    assert closing_2025.period_start == date(2025, 1, 1)
    assert closing_2025.due_date == date(2026, 2, 2)
    covering_2026 = next(one for one in filing if one.period_end == date(2026, 12, 31))
    assert covering_2026.period_start == date(2026, 1, 1)
    assert covering_2026.due_date == date(2027, 2, 1)


def test_the_not_running_calendar_holds_only_the_2_year_end_reports() -> None:
    """The whole reason this issue exists: a committee not on the ballot owes nothing
    covering this year's money until next February, so there is nothing else on it."""
    entries = calendars.CALENDARS[(CalendarKey.candidate_not_filing_for_office, 2026)]
    assert [one.report_name for one in entries] == [
        "2025 year-end report of receipts and expenditures",
        "2026 year-end report of receipts and expenditures",
    ]
    assert not any(
        calendars.names_an_election_report(one.report_name) for one in entries
    )


def test_the_party_and_fund_calendars_are_the_same_document_twice() -> None:
    """Identical entry for entry on both PDFs, so they share one tuple. If they ever
    diverge this fails rather than one of them silently trailing the other."""
    assert (
        calendars.CALENDARS[(CalendarKey.state_party_or_legislative_caucus, 2026)]
        is calendars.CALENDARS[(CalendarKey.political_committee_or_fund, 2026)]
    )


# --- Reading the Board's own report names ---------------------------------------


@pytest.mark.parametrize(
    "report_name",
    [
        "2026 Pre-Primary Report",
        "2024 Pre-General Report",
        "2010 15th Day Pre-Primary",
        "2016 October Pre-General Report",
        # The Board's own typos, both live in the catalogue.
        "Special Election: 2024 Pre-Primay Report",
        "Special Election: 2025 Pre_Primary",
    ],
)
def test_an_election_report_is_recognised_by_its_name_however_it_is_spelled(
    report_name: str,
) -> None:
    assert calendars.names_an_election_report(report_name)


@pytest.mark.parametrize(
    "report_name",
    [
        "2025 Year-End Report",
        "2026 1st Quarter Report",
        "2026 June Report",
        "2025 September Report",
        # Carries "Pre" and belongs to the special-election series, not the regular one.
        "2015 Pre-Special Election Report",
        "Special Election: 2023 Election Cycle Final Report",
        "",
    ],
)
def test_a_report_that_is_not_a_pre_election_report_is_not_read_as_one(
    report_name: str,
) -> None:
    assert not calendars.names_an_election_report(report_name)


def test_the_type_letter_is_never_what_decides(monkeypatch) -> None:
    """The letters are not stable in meaning across years: ``A`` is "2010 15th Day
    Pre-Primary" in 2010 and "2026 1st Quarter Report" in 2026. Nothing in this module
    may read one, which this asserts by classifying 2 reports that would share a letter
    and must not share an answer."""
    on_ballot = place(
        catalogued=[
            CataloguedReport(2026, "2026 Pre-Primary Report", special_election=False)
        ]
    )
    quarterly = place(
        catalogued=[
            CataloguedReport(2026, "2026 1st Quarter Report", special_election=False)
        ]
    )
    assert on_ballot.schedule_class is ScheduleClass.filing_for_office
    assert quarterly.schedule_class is ScheduleClass.not_filing_for_office


# --- Placing a committee on a calendar ------------------------------------------


def test_a_committee_the_state_scheduled_a_pre_election_report_for_is_on_the_ballot() -> None:
    placed = place(catalogued=[YEAR_END_2025, PRE_PRIMARY])
    assert placed.schedule_class is ScheduleClass.filing_for_office
    assert placed.calendar is CalendarKey.legislative_candidate_filing_for_office
    assert placed.next_report is not None
    assert placed.next_report.report_name == (
        "Pre-general report of receipts and expenditures"
    )
    assert placed.next_report.due_date == date(2026, 10, 26)
    assert placed.next_report.period_start == date(2026, 1, 1)
    assert placed.next_report.period_end == date(2026, 10, 19)


def test_an_unfiled_report_still_places_a_committee_because_the_catalogue_is_a_schedule() -> None:
    """Filer 18767's 2026 pre-primary is catalogued with a 20 Jul cut-off and no
    amendment record, which is what an unfiled report looks like. It is still the state
    saying that committee is on the ballot, so a committee that has filed nothing this
    year is placed exactly as one that has."""
    placed = place(registration_number="18767", catalogued=[PRE_PRIMARY])
    assert placed.schedule_class is ScheduleClass.filing_for_office
    assert placed.next_report is not None


def test_a_committee_with_no_election_report_owes_nothing_until_the_year_end() -> None:
    """The answer this issue was opened for. A sitting legislator not on the 2026 ballot
    has nothing due covering 2026 money until 1 Feb 2027, so the blank year can say so."""
    placed = place(catalogued=[YEAR_END_2025])
    assert placed.schedule_class is ScheduleClass.not_filing_for_office
    assert placed.calendar is CalendarKey.candidate_not_filing_for_office
    assert placed.next_report is not None
    assert placed.next_report.due_date == date(2027, 2, 1)
    assert placed.next_report.period_start == date(2026, 1, 1)
    assert placed.next_report.period_end == date(2026, 12, 31)
    assert "not on the ballot" in placed.reason


def test_absence_is_not_readable_before_the_years_first_election_report_is_due() -> None:
    """The guard against the false claim in the other direction. Asked in March, a
    committee with no 2026 election report yet proves nothing -- the state had not
    scheduled anybody's -- so this must be unknown and carry no date, not "not on the
    ballot, nothing due until February"."""
    placed = place(catalogued=[YEAR_END_2025], as_of=date(2026, 3, 1))
    assert placed.schedule_class is ScheduleClass.unknown
    assert placed.next_report is None
    assert placed.calendar is None
    assert "not due until 2026-07-27" in placed.reason


def test_a_terminated_registration_owes_nothing_further_and_is_not_read_as_unknown() -> None:
    """A closed committee is a 5th state §7 already names, and it is an answer rather
    than a gap: a page can say the committee closed on this date."""
    placed = place(
        registration_number="18472",
        catalogued=[
            CataloguedReport(2026, "2026 Year-End Report", special_election=False)
        ],
        termination_date=date(2026, 7, 28),
    )
    assert placed.schedule_class is ScheduleClass.terminated
    assert placed.terminated_on == date(2026, 7, 28)
    assert placed.next_report is None
    assert "no further report is due" in placed.reason


def test_a_termination_still_in_the_future_does_not_close_the_committee_yet() -> None:
    placed = place(
        catalogued=[YEAR_END_2025, PRE_PRIMARY],
        termination_date=date(2026, 12, 1),
    )
    assert placed.schedule_class is ScheduleClass.filing_for_office


def test_a_special_election_filer_is_unknown_rather_than_placed_on_the_regular_series() -> None:
    """They file a whole second series whose period starts §9.9 records as confirmed on
    one filer-year. Reading their pre-election report as an ordinary placement would
    print a plausible wrong date range, which renders as data rather than as an error."""
    placed = place(
        catalogued=[
            CataloguedReport(
                2026, "Special Election: 2026 Pre-Primary Report", special_election=True
            )
        ]
    )
    assert placed.schedule_class is ScheduleClass.unknown
    assert placed.next_report is None
    assert "special-election" in placed.reason


def test_a_seat_whose_calendar_is_not_transcribed_gets_no_date(
) -> None:
    """A statewide or appellate candidate on this year's ballot is on a 5th calendar we
    have not transcribed. The class is known and the date is not, and inventing one from
    the legislative calendar would apply the wrong race's deadlines."""
    placed = place(office="Governor", catalogued=[PRE_PRIMARY])
    assert placed.schedule_class is ScheduleClass.filing_for_office
    assert placed.next_report is None
    assert placed.calendar is None
    assert "Governor" in placed.reason


def test_a_year_with_no_transcribed_calendar_is_unknown_rather_than_last_years_dates() -> None:
    """Next year this file gets 4 new entries. Until it does, 2027 must answer unknown --
    reusing 2026's dates would be a year wrong on every one."""
    placed = place(year=2027, catalogued=[], as_of=date(2027, 3, 1))
    assert placed.schedule_class is ScheduleClass.unknown
    assert placed.next_report is None
    assert "has not been transcribed" in placed.reason


def test_a_report_due_today_is_the_next_report_and_not_a_missed_one() -> None:
    placed = place(catalogued=[YEAR_END_2025, PRE_PRIMARY], as_of=date(2026, 10, 26))
    assert placed.next_report is not None
    assert placed.next_report.due_date == date(2026, 10, 26)


def test_the_pre_general_carries_the_exemption_printed_beside_it() -> None:
    """Every candidate who advances past the primary owes this report and one who lost
    it does not, and no source we hold says which happened. So the printed sentence
    travels with the date rather than the report being suppressed or asserted flat."""
    placed = place(catalogued=[PRE_PRIMARY])
    assert placed.next_report is not None
    assert placed.next_report.condition == (
        "Candidates who lost the primary election do not need to file this report."
    )


def test_a_report_from_another_year_never_places_a_committee() -> None:
    """One request returns a filer's whole history (§9.6), so a 2024 pre-primary is
    ordinary to be holding while asking about 2026 and must not answer for it."""
    placed = place(
        catalogued=[
            CataloguedReport(2024, "2024 Pre-Primary Report", special_election=False),
            YEAR_END_2025,
        ]
    )
    assert placed.schedule_class is ScheduleClass.not_filing_for_office


# --- Reading it out of the database ---------------------------------------------


@pytest.fixture()
def db() -> Iterator:
    session = get_session_factory()()
    _clear(session)
    try:
        yield session
    finally:
        _clear(session)
        session.close()


def _clear(session) -> None:
    session.query(models.CampaignFinanceFilingCurrentSnapshot).update(
        {models.CampaignFinanceFilingCurrentSnapshot.snapshot_id: None}
    )
    session.query(models.CampaignFinanceFilingReport).delete()
    session.query(models.CampaignFinanceFiler).delete()
    session.query(models.CampaignFinanceFilingSnapshot).delete()
    session.commit()


def _publish_snapshot(session, *, filers, reports) -> uuid.UUID:
    """A live filings snapshot holding exactly these filers and reports.

    Written straight in rather than through the loader: what is under test is what a
    *read* makes of stored rows, and the loader's own refusals have their own suite in
    ``test_campaign_finance_filings.py``.
    """
    now = datetime.now(UTC)
    snapshot = models.CampaignFinanceFilingSnapshot(
        fetch_started_at=now,
        fetch_completed_at=now,
        status=models.CampaignFinanceSnapshotStatus.loaded,
    )
    session.add(snapshot)
    session.flush()
    for registration, office, termination in filers:
        session.add(
            models.CampaignFinanceFiler(
                snapshot_id=snapshot.id,
                registration_number=registration,
                kind=models.CampaignFinanceFilerKind.candidate_committee,
                name=f"Committee {registration}",
                office=office,
                termination_date=termination,
                is_incumbent=True,
            )
        )
    for row_number, (registration, year, name, special) in enumerate(reports):
        session.add(
            models.CampaignFinanceFilingReport(
                snapshot_id=snapshot.id,
                row_number=row_number,
                registration_number=registration,
                filing_year=year,
                report_type="C",
                report_name=name,
                special_election=special,
            )
        )
    service_module_pointer = session.get(
        models.CampaignFinanceFilingCurrentSnapshot, True
    )
    if service_module_pointer is None:
        session.add(
            models.CampaignFinanceFilingCurrentSnapshot(snapshot_id=snapshot.id)
        )
    else:
        service_module_pointer.snapshot_id = snapshot.id
    session.commit()
    return snapshot.id


def test_a_committee_in_the_snapshot_reads_its_schedule_out_of_stored_rows(db) -> None:
    _publish_snapshot(
        db,
        filers=[("17500", "House", None)],
        reports=[("17500", 2025, "2025 Year-End Report", False)],
    )
    answer = service.filing_schedule(db, "17500", year=2026, as_of=AS_OF)
    assert answer.schedule_class is ScheduleClass.not_filing_for_office
    assert answer.next_report is not None
    assert answer.next_report.due_date == date(2027, 2, 1)


def test_a_committee_the_snapshot_does_not_carry_is_about_us_not_about_the_committee(
    db,
) -> None:
    """Ordinary for a committee registered since the last run. It must not read as "this
    committee is not on the ballot", which carries a due date."""
    _publish_snapshot(db, filers=[("17500", "House", None)], reports=[])
    answer = service.filing_schedule(db, "19999", year=2026, as_of=AS_OF)
    assert isinstance(answer, service.ScheduleUnavailable)
    assert answer.state == service.FILER_NOT_IN_SNAPSHOT


def test_no_published_snapshot_is_its_own_state_and_not_an_empty_schedule(db) -> None:
    answer = service.filing_schedule(db, "17500", year=2026, as_of=AS_OF)
    assert isinstance(answer, service.ScheduleUnavailable)
    assert answer.state == service.NO_SNAPSHOT


def test_coverage_counts_what_could_not_be_placed_and_says_why(db) -> None:
    """The residual is reported rather than implied by whatever a page renders
    ([#1375](https://github.com/alethical-org/alethical/issues/1375))."""
    _publish_snapshot(
        db,
        filers=[
            ("11111", "House", None),  # on the ballot
            ("22222", "House", None),  # not on the ballot
            ("33333", "House", date(2026, 7, 28)),  # terminated
            ("44444", "House", None),  # special election, unplaceable
            ("55555", "Governor", None),  # on the ballot, calendar not transcribed
        ],
        reports=[
            ("11111", 2026, "2026 Pre-Primary Report", False),
            ("22222", 2025, "2025 Year-End Report", False),
            ("33333", 2026, "2026 Year-End Report", False),
            ("44444", 2026, "Special Election: 2026 Pre-Primary Report", True),
            ("55555", 2026, "2026 Pre-Primary Report", False),
        ],
    )
    coverage = service.schedule_coverage(
        db,
        ["11111", "22222", "33333", "44444", "55555", "66666"],
        year=2026,
        as_of=AS_OF,
    )
    assert coverage.total == 6
    assert coverage.filing_for_office == 2  # 11111 and 55555
    assert coverage.not_filing_for_office == 1
    assert coverage.terminated == 1
    assert coverage.unknown == 2  # the special-election filer and the unknown number
    # 55555 is classified and still has no date, which is the count a page depends on.
    assert coverage.with_next_due_date == 2
    assert coverage.answered == 3
    assert {registration for registration, _ in coverage.unknown_reasons} == {
        "44444",
        "66666",
    }
