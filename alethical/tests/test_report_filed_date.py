"""Reading the day the Board received a report, and refusing to invent one (#1670).

We hold every report Minnesota catalogues and, until this, no record of when any of them
was filed, so the newest-filings feed ordered by the period a report covers. Every 2026
pre-primary report shares the period end 20 Jul 2026, so the top of that feed was one
enormous tie broken alphabetically rather than a chronology of arrivals.

The date exists in exactly one place: printed inside the report document, on its own
line, as ``Received by the Board July 24, 2026``. Every test here stands in for a way
reading it could produce a plausible wrong date on a named committee's real filing:

* **The line 1 below it is a different fact.** Filer 11880's 2026 pre-primary was
  received 24 Jul 2026 and printed 27 Jul 2026, so a reader scanning for any date in the
  header is 3 days wrong and nothing looks broken.
* **The day is sometimes zero-padded and sometimes not.** Filer 12339's 2025 year-end
  reads ``July 01, 2026`` and filer 11880's 2022 year-end reads ``June 1, 2023``. A
  pattern that takes only 1 of the 2 silently drops half the corpus.
* **The stamp is not at a fixed line.** It sits at line 31 of one document and line 29 of
  another, because the header above it varies by filer kind.
* **A served document is not a readable one.** Filer 13481's 2025 year-end is a
  1,511,095-byte, 1-page scan that ``pypdf`` reads as 0 lines.
* **No date at all must stay no date.** The one substitution nobody could catch is the
  period end wearing a "filed" label, because it is a real date on a real report.

Documents here are genuine PDFs built by ``pdf_of`` rather than mocked, so
``extract_lines`` -- the step that turns bytes into the lines this reads -- is really
exercised. Every quoted registration number and date is from the live service, measured
31 Aug 2026; §8 of ``docs/architecture/campaign-finance-system-design.md`` is explicit
that a measured count is never a thing to assert, so none is asserted.

Needs no database and makes no request.
"""

from __future__ import annotations

from datetime import date

import pytest

from alethical.pipeline.campaign_finance_report_documents import (
    PRINTED_STAMP,
    extract_lines,
    filed_date_from_lines,
)
from alethical.tests.test_campaign_finance_stated_split import pdf_of

# The header the Board really prints above the stamp, trimmed to the lines that matter.
# The "Printed" line is the near-miss: on filer 11880's 2026 pre-primary it is 3 days
# later than the received date, and on filer 12682's 2023 year-end it is the same day.
HEADER = [
    "Campaign Finance And Public Disclosure Board",
    "Report of Receipts and Expenditures for",
    "Principal Campaign Committee",
    "Period Covered: 01/01/2026 through 07/20/2026",
    "Registration Number: 11880",
    "Committee Name: Senator (John) Marty Volunteer Committee",
    # The real document prints a ballot-box glyph in front of this; the glyph is dropped
    # here only because ``pdf_of`` writes latin-1, and nothing under test reads it.
    "Amendment This report amends a previously filed report for the same period.",
]
PRINTED = (
    "Campaign Finance Reporter Online 1.0.4439 XSD Version: 2.6 Printed 07/27/2026"
)


def _document(*extra: str) -> list[str]:
    return extract_lines(pdf_of([*HEADER, *extra, PRINTED]))[0]


def test_the_received_stamp_is_read_out_of_a_real_document() -> None:
    """The whole point, end to end: bytes in, one date out.

    Filer 11880's 2026 pre-primary really reads this, and its period ended 20 Jul 2026 --
    4 days earlier -- which is what makes the filing date a different fact from the
    period and worth storing at all.
    """
    filed_date, errors = filed_date_from_lines(
        _document("Received by the Board July 24, 2026")
    )

    assert filed_date == date(2026, 7, 24)
    assert errors == []


def test_the_printed_line_really_carries_a_date_that_is_not_the_filing_date() -> None:
    """The near-miss is measured, not imagined, which is what gives the next test force.

    The line 1 below the stamp genuinely parses as a date, and on filer 11880's 2026
    pre-primary that date is 27 Jul 2026 while the Board received the report on 24 Jul.
    So a reader widening the search to "any date in the header" gets a plausible answer
    that is 3 days wrong on a real filing — and on filer 12682's 2023 year-end the 2
    agree, which is what makes it hard to notice.
    """
    match = PRINTED_STAMP.search(PRINTED)

    assert match is not None
    assert (match.group(3), match.group(1), match.group(2)) == ("2026", "07", "27")


def test_the_printed_line_is_never_read_as_the_filing_date() -> None:
    """3 days wrong on a real filing, and nothing about the answer would look wrong.

    The document prints ``Printed 07/27/2026`` one line below a stamp reading 24 Jul
    2026. Both are dates, both are in the header, and only one is when the Board received
    the report. With the stamp removed the honest answer is no date at all, so a reader
    that has quietly widened to "any date near the header" fails here rather than in
    production.
    """
    filed_date, errors = filed_date_from_lines(_document())

    assert filed_date is None
    assert errors == []


@pytest.mark.parametrize(
    "stamp,expected",
    [
        # Zero-padded, as filer 12339's 2025 year-end prints it.
        ("Received by the Board July 01, 2026", date(2026, 7, 1)),
        # Bare, as filer 11880's 2022 year-end prints it.
        ("Received by the Board June 1, 2023", date(2023, 6, 1)),
        # An amendment carries its own later date: filer 20008's 2025 year-end reads
        # 30 Jan 2026 at index 0 and this at index 2.
        ("Received by the Board July 28, 2026", date(2026, 7, 28)),
        ("Received by the Board January 30, 2026", date(2026, 1, 30)),
        ("Received by the Board December 31, 2025", date(2025, 12, 31)),
    ],
)
def test_both_day_forms_the_board_prints_are_read(stamp: str, expected: date) -> None:
    filed_date, errors = filed_date_from_lines(_document(stamp))

    assert filed_date == expected
    assert errors == []


def test_the_stamp_is_found_wherever_it_sits_rather_than_at_a_fixed_line() -> None:
    """Line 31 on a candidate committee, line 29 on a party unit, because the header
    above it differs by filer kind. A positional read is right on one and wrong on the
    other, which is the same failure §9.4 records for reading schedule totals by offset.
    """
    early, _ = filed_date_from_lines(
        extract_lines(pdf_of(["Received by the Board July 24, 2026", *HEADER]))[0]
    )
    late, _ = filed_date_from_lines(
        extract_lines(
            pdf_of([*HEADER, *["filler"] * 40, "Received by the Board July 24, 2026"])
        )[0]
    )

    assert early == date(2026, 7, 24)
    assert late == date(2026, 7, 24)


def test_a_scanned_document_with_no_readable_text_yields_no_date() -> None:
    """Filer 13481's 2025 year-end is 1.5 MB over 1 page and reads as 0 lines.

    A served document is not a readable one, and this is the shape that proves ``None``
    has to be an ordinary answer rather than an error: the Board did serve the filing, we
    simply cannot read it.
    """
    filed_date, errors = filed_date_from_lines([])

    assert filed_date is None
    assert errors == []


@pytest.mark.parametrize(
    "stamp",
    [
        # An abbreviated month. All 36 measured documents print the full name, so this
        # would be the Board changing what it prints -- worth reporting, not absorbing.
        "Received by the Board Jul 24, 2026",
        "Received by the Board Julyy 24, 2026",
    ],
)
def test_a_stamp_naming_a_month_that_is_not_one_is_reported_rather_than_guessed(
    stamp: str,
) -> None:
    """A changed or mangled stamp is a shape to report, never a date to approximate.

    The line is plainly the stamp -- it opens with the Board's own words -- so falling
    silent would let a change in what the Board prints look like a corpus where nothing
    is dated. An operator gets the line back verbatim instead.
    """
    filed_date, errors = filed_date_from_lines(_document(stamp))

    assert filed_date is None
    assert errors and "cannot read" in errors[0]
    assert stamp in errors[0]


def test_two_stamps_disagreeing_refuse_rather_than_taking_the_first() -> None:
    """2 received dates in 1 document is a shape nothing has been seen to serve.

    Taking the first would silently choose between 2 filing dates for the same report.
    Every one of the 36 documents measured carried the stamp exactly once, so a second
    one means the source changed, and the honest answer is that this document does not
    say when it was filed.
    """
    filed_date, errors = filed_date_from_lines(
        _document(
            "Received by the Board July 24, 2026",
            "Received by the Board August 10, 2026",
        )
    )

    assert filed_date is None
    assert errors and "2 different received stamps" in errors[0]


def test_the_same_stamp_printed_twice_is_still_one_date() -> None:
    """A repeated header is not a disagreement. §9.6 records the catalogue serving a
    duplicated amendment list (``['1','0','1','0']``) on filer 17868, so a duplicated
    line is a shape this source really produces and must not be read as a conflict.
    """
    filed_date, errors = filed_date_from_lines(
        _document(
            "Received by the Board July 24, 2026",
            "Received by the Board July 24, 2026",
        )
    )

    assert filed_date == date(2026, 7, 24)
    assert errors == []


def test_a_sentence_mentioning_the_phrase_is_not_a_stamp() -> None:
    """The stamp is a whole line, and prose containing the words must not date a feed.

    The start is anchored by reading the line with ``match`` rather than ``search``, and
    the pattern carries ``^`` as well so the anchoring survives someone changing that
    call. Both halves are needed: with only one of them this line hands back a date.
    """
    filed_date, errors = filed_date_from_lines(
        _document(
            "The report was Received by the Board July 24, 2026 after the deadline"
        )
    )

    assert filed_date is None
    assert errors == []


def test_a_stamp_with_anything_after_the_year_is_refused_rather_than_trimmed() -> None:
    """A line that opens like the stamp and carries more is not a shape we have seen.

    All 36 measured documents print the stamp alone on its line, so trailing text means
    either the extraction merged 2 lines or the Board changed its layout. The end anchor
    refuses it, which costs a date we might have salvaged and rules out returning one
    from a line we do not understand. That is the right way round: silence on 1 report is
    honest, and a filing date invented from a mangled line is the harm
    [#1670](https://github.com/alethical-org/alethical/issues/1670) exists to prevent.
    """
    filed_date, errors = filed_date_from_lines(
        _document(
            "Received by the Board July 24, 2026 Amendment #1 for the same period"
        )
    )

    assert filed_date is None
    assert errors == []
