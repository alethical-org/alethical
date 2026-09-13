"""Check the transcription against preserved Board PDFs and historical classifications."""

from datetime import date
from hashlib import sha256
from pathlib import Path
import re

import pytest
from pypdf import PdfReader

from alethical.api.services.committee_filing_schedule import schedule_for_display
from alethical.pipeline.campaign_finance_calendar_sources import TRANSCRIPTIONS
from alethical.pipeline.campaign_finance_filing_calendars import (
    CALENDARS,
    CALENDAR_SOURCES,
    CalendarKey,
    CataloguedReport,
    ScheduleClass,
    UnknownBecause,
    calendar_for,
    classify,
    first_election_report_due,
)

FIXTURES = Path(__file__).parent / "fixtures" / "campaign_finance_calendars"


def normalized(value):
    return " ".join(value.replace("‐", "-").replace("‑", "-").split())


@pytest.mark.parametrize(
    "transcription", TRANSCRIPTIONS, ids=[row[2] for row in TRANSCRIPTIONS]
)
def test_every_transcribed_date_and_condition_is_in_the_preserved_board_pdf(
    transcription,
):
    year, key, filename, digest, offices, reports = transcription
    path = FIXTURES / filename
    assert sha256(path.read_bytes()).hexdigest() == digest
    text = normalized(
        "\n".join(
            page.extract_text(extraction_mode="layout")
            for page in PdfReader(path).pages
        )
    )
    assert str(year) in text[:700]
    source = CALENDAR_SOURCES[(CalendarKey(key), year)]
    assert source["url"].endswith(filename)
    assert source["sha256"] == digest
    entries = CALENDARS[(CalendarKey(key), year)]
    assert len(entries) == len(reports)
    for entry in entries:
        start, end, due = entry.period_start, entry.period_end, entry.due_date
        start_print = rf"{start.month}/{start.day}(?:/{start.year})?"
        end_print = rf"{end.month}/{end.day}/{end.year}"
        # Start at this row's own due-date column. Bound the match to the printed
        # report name and period so a correct date on a different row cannot pass.
        name = normalized(entry.report_name)
        if " - Pre" in name or " – Pre" in name:
            prefix, suffix = re.split(r"\s+[-–]\s+", name, maxsplit=1)
            title = (
                re.escape(prefix.replace(" ", ""))
                + r"due\.?[-–]"
                + re.escape(suffix.replace(" ", ""))
                + r"\.?"
            )
        else:
            title = re.escape(name.replace(" ", "")) + r"due\.?"
        pattern = (
            rf"{due.strftime('%B')}{due.day}{title}"
            rf"Periodcovered:{start_print}through{end_print}"
        )
        compact = text.replace(" ", "")
        assert re.search(pattern, compact, re.I), (filename, entry)
        assert start <= end < due
        if entry.condition:
            assert normalized(entry.condition).replace(" ", "") in compact


def historical(year, office="Senate", election=False, **overrides):
    kwargs = dict(
        registration_number="17500",
        year=year,
        office=office,
        catalogued=[
            CataloguedReport(
                year,
                f"{year} Pre-Primary Report" if election else f"{year} Year-End Report",
                False,
            )
        ],
        termination_date=None,
        as_of=date(2026, 9, 13),
        evidence_read_on=date(2026, 9, 13),
    )
    kwargs.update(overrides)
    return classify(**kwargs)


@pytest.mark.parametrize("year", range(2015, 2027))
@pytest.mark.parametrize(
    "office", ["House", "Senate", "District Court", "Governor", "Appellate Court"]
)
def test_every_regular_candidate_year_has_a_source_backed_off_ballot_schedule(
    year, office
):
    answer = historical(year, office)
    assert answer.schedule_class is ScheduleClass.not_filing_for_office
    assert answer.calendar is not None
    assert (answer.calendar, year) in CALENDAR_SOURCES
    assert schedule_for_display(answer).state == "not_on_the_ballot"
    if year < 2026:
        assert answer.next_report is None
        assert schedule_for_display(answer).next_report_due_on is None


@pytest.mark.parametrize(
    "year,due",
    [
        (2016, "2016-07-25"),
        (2018, "2018-07-30"),
        (2020, "2020-07-27"),
        (2022, "2022-07-25"),
        (2024, "2024-07-29"),
        (2026, "2026-07-27"),
    ],
)
def test_absence_only_speaks_after_the_printed_first_election_report_date(year, due):
    deadline = date.fromisoformat(due)
    assert first_election_report_due(year) == deadline
    assert (
        historical(year, "House", evidence_read_on=deadline).schedule_class
        is ScheduleClass.unknown
    )
    assert (
        historical(year, "House").schedule_class is ScheduleClass.not_filing_for_office
    )
    shown = schedule_for_display(historical(year, "House", election=True))
    assert shown.state == "on_the_ballot"


@pytest.mark.parametrize("year", [2018, 2024])
def test_house_only_calendars_never_supply_a_senate_deadline(year):
    assert calendar_for(ScheduleClass.filing_for_office, "Senate", year) is None
    assert historical(year, election=True).next_report is None


def test_a_special_election_never_inherits_the_general_annual_calendar():
    answer = historical(
        2025, catalogued=[CataloguedReport(2025, "2025 Pre-Primary Report", True)]
    )
    assert answer.unknown_because is UnknownBecause.special_election_series


def test_no_historical_reports_is_not_proof_that_a_committee_existed_off_ballot():
    answer = historical(2015, catalogued=[])
    assert answer.unknown_because is UnknownBecause.no_reports_for_year
    assert schedule_for_display(answer).state == "filings_cannot_answer"


def test_a_future_calendar_is_missing_not_a_repeated_annual_schedule():
    answer = historical(2027, catalogued=[])
    assert answer.unknown_because is UnknownBecause.calendar_not_transcribed


@pytest.mark.parametrize(
    "year,office,known",
    [
        (2016, "Governor", False),
        (2018, "Governor", True),
        (2020, "Governor", False),
        (2022, "Governor", True),
        (2024, "Governor", False),
        (2026, "Gov", True),
        (2016, "Appellate Court", True),
        (2024, "Appellate Court", True),
    ],
)
def test_constitutional_and_appellate_calendar_scopes_are_year_specific(
    year, office, known
):
    assert (
        calendar_for(ScheduleClass.filing_for_office, office, year) is not None
    ) == known
