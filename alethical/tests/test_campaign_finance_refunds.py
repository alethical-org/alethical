"""Reading Minnesota's yearly refund summaries off the printed page (#2147).

Every fixture here is **real text taken from the Board's own files**, including its
no-break spaces and its non-breaking hyphens, because the failures this parser exists to
survive are all invisible in a hand-typed approximation: 2015 and 2017 separate every word
with U+00A0 and reached an earlier version of this parser as 0 rows.

No network and no PDF bytes. The parser takes page text, which is what makes the 6 printed
layouts testable as literals rather than as a folder of 2 MB fixtures.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from alethical.pipeline import campaign_finance_refunds as refunds

# --- Real lines, exactly as pypdf reads them out of the Board's files ----------------

# 2025: the count, then the amount, then a party code -- and on the second row the party
# code runs straight into the amount with no space.
LINES_2025 = [
    "2025 Contribution Refund Summary for Candidate Committees",
    "Note: Contributions from a married couple filing jointly are reported as one contribution",
    "Candidate Name Office Sought Contributions ",
    "Refunded AmountParty",
    "DFL",
    "Ellison, Keith Attorney General 612 $34,115.10 DFL",
    "Hemmingsen-Jaeger, Amand Senate - 47 66 $4,640.85DFL",
    "12 $726.64Party Total",
]

# 2024: an amount and a party and **no count at all**, for every row and for the total.
LINES_2024 = [
    "2024 Contribution Refund Summary for Candidate Committees",
    "Candidate Name Office Sought Contributions ",
    "Refunded AmountParty",
    "RPM",
    "Abeler, Jim Senate - 35 $10,508.22 RPM",
    "Blaha, Julie State Auditor $500.00 DFL",
    "$475.00Party Total",
]

# 2015: the amount **before** the count, every word separated by U+00A0, and the seat
# written with a non-breaking hyphen.
LINES_2015 = [
    "2015\xa0Contribution\xa0Refund\xa0Summary\xa0for\xa0Candidate\xa0Committees",
    "DFL",
    "Anzelc,\xa0Tom House\xa0‐\xa0\xa05B $50.00 1",
    "Bakk,\xa0Thomas\xa0(Tom) Senate\xa0‐\xa0\xa03 $4,250.00 55",
    "Blaha,\xa0Julie State\xa0Auditor $500.00 9",
    "7,054 $460,940.69",
]

# 2013: whole dollars with no cents, and "Senate" reaching us as "Senat e" because the
# PDF kerned it.
LINES_2013 = [
    "2013 Contribution Refund Summary for Principal Campaign Committees",
    "DFL",
    "Anzelc,\xa0Tom House\xa0‐\xa0\xa05B 9 $462",
    "Scalze,\xa0Bev Senat e\xa0‐\xa042 21 $1,250",
    "7,109 $462,465",
]

# 2021: 9 rows print a chamber with no district at all.
LINES_2021 = [
    "2021 Contribution Refund Summary for Candidate Committees",
    "DFL",
    "Hemmingsen-Jaeger, Amand House 1 $50.00",
    "Abeler, Jim Senate - 35 54 $4,158.33",
    "3,761 $254,558.65Party Total",
]

# The party-unit shape: the amount and the count run together with no separator.
LINES_PARTY_2025 = [
    "2025 Contribution Refund Summary for Political Party Units",
    "Party Units Contributions Refunded Amount",
    "Democratic Farmer Labor Party",
    "1st Congressional District DFL $613.829",
    "24B House District DFL (Olmsted 20/24) $687.4617",
    "17,363 $1,672,824.33Subtotals:",
]

# The 2013 party file puts the count first and prints no cents, so the run-together
# reading would be wrong for it.
LINES_PARTY_2013 = [
    "2013 Contribution Refund Summary for Political Party Units",
    "Democratic Farmer Labor Party",
    "1st Congressional District DFL 12 $850",
]


def rows_of(lines, *, year, kind=refunds.CANDIDATE):
    return refunds.parse_pages(["\n".join(lines)], year=year, kind=kind)


# --- The 6 printed layouts ------------------------------------------------------------


def test_the_count_comes_before_the_amount_and_a_party_code_may_touch_it():
    parsed = rows_of(LINES_2025, year=2025)

    assert [
        (row.printed_name, row.contribution_count, row.refunded_amount)
        for row in parsed.rows
    ] == [
        ("Ellison, Keith", 612, Decimal("34115.10")),
        ("Hemmingsen-Jaeger, Amand", 66, Decimal("4640.85")),
    ]
    # The party code that ran into the amount is still read as the party.
    assert parsed.rows[1].party == "DFL"
    assert (parsed.rows[1].office, parsed.rows[1].district) == ("Senate", "47")
    # A statewide office carries no district rather than a made-up one.
    assert (parsed.rows[0].office, parsed.rows[0].district) == (
        "Attorney General",
        None,
    )


def test_the_2024_summary_publishes_no_count_and_none_is_invented():
    parsed = rows_of(LINES_2024, year=2024)

    assert [row.contribution_count for row in parsed.rows] == [None, None]
    assert [row.refunded_amount for row in parsed.rows] == [
        Decimal("10508.22"),
        Decimal("500.00"),
    ]
    # The district must not be read off the seat's own number, which is the specific way
    # a right-to-left reading of this line goes wrong.
    assert (parsed.rows[0].office, parsed.rows[0].district) == ("Senate", "35")
    assert parsed.totals[-1].contribution_count is None


def test_2015_prints_the_amount_before_the_count_and_separates_words_with_no_break_spaces():
    parsed = rows_of(LINES_2015, year=2015)

    assert [
        (row.printed_name, row.contribution_count, row.refunded_amount)
        for row in parsed.rows
    ] == [
        ("Anzelc, Tom", 1, Decimal("50.00")),
        ("Bakk, Thomas (Tom)", 55, Decimal("4250.00")),
        ("Blaha, Julie", 9, Decimal("500.00")),
    ]
    assert parsed.rows[1].district == "3"
    # A section total printed with no word at all is still a total, not a row.
    assert parsed.totals[-1].refunded_amount == Decimal("460940.69")
    assert parsed.totals[-1].contribution_count == 7054


def test_2013_prints_whole_dollars_and_a_kerned_office_word_is_repaired():
    parsed = rows_of(LINES_2013, year=2013)

    assert [(row.printed_name, row.office, row.district) for row in parsed.rows] == [
        ("Anzelc, Tom", "House", "5B"),
        ("Scalze, Bev", "Senate", "42"),
    ]
    assert [row.refunded_amount for row in parsed.rows] == [
        Decimal("462"),
        Decimal("1250"),
    ]
    assert refunds.prints_cents(parsed) is False


def test_a_seat_with_no_district_is_kept_rather_than_dropped_or_guessed_at():
    parsed = rows_of(LINES_2021, year=2021)

    missing, abeler = parsed.rows
    assert (missing.office, missing.district) == ("House", None)
    # The number on that line is the count, and reading it as a district would lose $50.
    assert missing.contribution_count == 1
    assert missing.refunded_amount == Decimal("50.00")
    assert (abeler.office, abeler.district, abeler.contribution_count) == (
        "Senate",
        "35",
        54,
    )


def test_a_lower_case_district_letter_settles_to_the_form_the_register_uses():
    parsed = rows_of(["DFL", "Greene, Julie House - 50a 8 $399.99"], year=2023)

    row = parsed.rows[0]
    assert row.district == "50A"
    # And the line as printed is kept beside it, so nothing is lost by settling it.
    assert row.office_sought == "House - 50a"


def test_a_party_unit_amount_and_count_are_printed_with_no_separator():
    parsed = rows_of(LINES_PARTY_2025, year=2025, kind=refunds.PARTY_UNIT)

    assert [
        (row.printed_name, row.refunded_amount, row.contribution_count)
        for row in parsed.rows
    ] == [
        ("1st Congressional District DFL", Decimal("613.82"), 9),
        ("24B House District DFL (Olmsted 20/24)", Decimal("687.46"), 17),
    ]
    assert parsed.rows[0].section_heading == "Democratic Farmer Labor Party"


def test_a_party_unit_file_printing_no_cents_puts_its_count_first():
    parsed = rows_of(LINES_PARTY_2013, year=2013, kind=refunds.PARTY_UNIT)

    row = parsed.rows[0]
    assert (row.printed_name, row.refunded_amount, row.contribution_count) == (
        "1st Congressional District DFL",
        Decimal("850"),
        12,
    )


def test_an_amount_with_no_cents_and_digits_after_it_is_recorded_rather_than_split():
    # Neither reading is safe here, so the line is reported instead of guessed at.
    parsed = rows_of(["Some Party Unit $8501"], year=2013, kind=refunds.PARTY_UNIT)

    assert parsed.rows == []
    assert "either" in parsed.unreadable[0].reason


def test_an_amount_the_file_printed_as_hashes_is_recorded_not_swallowed():
    parsed = rows_of(
        [
            "Democratic Farmer Labor Party",
            "Minn DFL State Central Committee ###########20766",
        ],
        year=2024,
        kind=refunds.PARTY_UNIT,
    )

    assert parsed.rows == []
    assert len(parsed.unreadable) == 1
    assert "# characters" in parsed.unreadable[0].reason
    # And it must not have been mistaken for a section heading, which would have made the
    # rows under it belong to a heading that is really a committee.
    assert parsed.unreadable[0].printed_line.startswith("Minn DFL State Central")


def test_an_office_this_parser_does_not_know_is_reported_rather_than_guessed_at():
    parsed = rows_of(["Someone, New Dogcatcher - 4 3 $100.00"], year=2025)

    assert parsed.rows == []
    assert parsed.unreadable[0].reason == "no office this parser knows"


# --- Which files exist ----------------------------------------------------------------

INDEX_HTML = """
<a href="/pdf/publications/public_subsidy/historical/2015_refunds_cand.pdf">2015</a>
<a href="/pdf/publications/public_subsidy/historical/2015_refunds_party.pdf">2015</a>
<a href="/pdf/publications/public_subsidy/historical/2017_refunds_cand.pdf">2017</a>
<a href="/pdf/publications/public_subsidy/historical/2025_refunds_cand.pdf">2025</a>
<a href="/pdf/publications/public_subsidy/historical/historical_payments_and_pcr_refunds_by_year.pdf">all</a>
"""


def test_the_links_come_from_the_page_and_2016_is_not_among_them():
    links = refunds.resolve_refund_files(INDEX_HTML)

    assert [(link.year, link.kind) for link in links] == [
        (2015, refunds.CANDIDATE),
        (2015, refunds.PARTY_UNIT),
        (2017, refunds.CANDIDATE),
        (2025, refunds.CANDIDATE),
    ]
    assert links[0].url.startswith("https://cfb.mn.gov/pdf/")


def test_an_error_page_served_as_a_pdf_is_not_a_document():
    # The 2016 addresses answer HTTP 200 with the Board's HTML shell. A status code
    # decides nothing; the bytes do.
    assert refunds.looks_like_refund_pdf(b"%PDF-1.4\n...") is True
    assert (
        refunds.looks_like_refund_pdf(
            b'<?xml version="1.0"?><html><h1>This page is not available</h1>'
        )
        is False
    )


# --- What blocks a file, and what is only recorded ------------------------------------


def status_of(checks, name):
    return next(check.status for check in checks if check.name == name)


def test_a_section_total_disagreeing_with_its_own_rows_blocks_the_file():
    parsed = rows_of(
        ["DFL", "One, Person House - 1A 2 $100.00", "3 $999.00Party Total"], year=2025
    )
    checks = refunds.validate(parsed)

    assert status_of(checks, "section_totals") == refunds.FAILED
    assert any(check.blocks_publishing for check in checks)


def test_a_file_disagreeing_with_itself_is_recorded_and_still_publishes():
    # The 2022 candidate summary in miniature: the rows match every section total and the
    # grand total is larger than the sum of those sections. That is Minnesota's
    # inconsistency, not a misreading, so the file is worth publishing with it on record.
    parsed = rows_of(
        [
            "DFL",
            "One, Person House - 1A 2 $100.00",
            "2 $100.00Party Total",
            "RPM",
            "Two, Person House - 2A 3 $200.00",
            "3 $200.00Party Total",
            "6 $500.00Grand Total",
        ],
        year=2022,
    )
    checks = refunds.validate(parsed)

    assert status_of(checks, "section_totals") == refunds.OK
    assert status_of(checks, "file_total") == refunds.RECORDED
    assert not any(check.blocks_publishing for check in checks)


def test_a_file_printing_no_cents_has_its_counts_checked_and_its_money_skipped():
    # The real 2013 shape: each row's amount is printed rounded to whole dollars, so the
    # rows cannot add up to the section's own total however well they were read, while the
    # counts add up exactly. 9 + 21 is 30 contributions, and $462 + $1,250 is $1,712
    # against a printed $1,711. A check that demanded both would quarantine a file that
    # was read perfectly.
    parsed = rows_of(LINES_2013[:-1] + ["30 $1,711"], year=2013)
    checks = refunds.validate(parsed)

    assert refunds.prints_cents(parsed) is False
    assert status_of(checks, "section_totals") == refunds.OK
    assert "no cents" in next(
        check.detail for check in checks if check.name == "section_totals"
    )


def test_a_count_that_disagrees_still_blocks_a_file_printing_no_cents():
    parsed = rows_of(LINES_2013[:-1] + ["31 $1,711"], year=2013)

    assert status_of(refunds.validate(parsed), "section_totals") == refunds.FAILED


def test_an_unreadable_line_never_lets_a_total_check_quietly_pass():
    parsed = rows_of(
        [
            "Democratic Farmer Labor Party",
            "A Unit $100.001",
            "Minn DFL State Central Committee ###########20766",
            "20,767 $9,999.00Subtotals:",
        ],
        year=2024,
        kind=refunds.PARTY_UNIT,
    )
    checks = refunds.validate(parsed)

    assert status_of(checks, "every_line_read") == refunds.RECORDED
    assert status_of(checks, "section_totals") == refunds.SKIPPED
    assert not any(check.blocks_publishing for check in checks)


def test_a_row_count_far_outside_the_band_stops_the_run():
    parsed = rows_of(["DFL", "One, Person House - 1A 2 $100.00"], year=2025)

    assert status_of(
        refunds.validate(parsed, previous_row_count=400), "row_count_band"
    ) == (refunds.FAILED)
    assert status_of(
        refunds.validate(parsed, previous_row_count=2), "row_count_band"
    ) == (refunds.OK)


def test_a_file_that_yielded_nothing_never_publishes():
    checks = refunds.validate(rows_of(["DFL"], year=2025))

    assert status_of(checks, "rows_found") == refunds.FAILED


# --- Identity -------------------------------------------------------------------------

ABELER = refunds.RegisteredCandidate(
    registration_number="17868",
    candidate_name="Abeler, Jim",
    party="RPM",
    office="Senate",
    district="35",
)


def one_row(line, year=2025):
    parsed = rows_of(["RPM", line], year=year)
    return parsed.rows[0]


def test_all_three_agreeing_attaches_the_row():
    verdict = refunds.match_row(
        one_row("Abeler, Jim Senate - 35 180 $14,216.47"), [ABELER]
    )

    assert verdict.registration_number == "17868"
    assert verdict.name_evidence == refunds.NAME_EXACT
    assert verdict.register_verdict == refunds.SEAT_AGREES
    assert verdict.party_agreement == refunds.PARTY_AGREES


@pytest.mark.parametrize(
    "line, failing",
    [
        # The same person's earlier House committee. Attaching it would publish one
        # committee's refunds on another committee's card.
        ("Abeler II, Jim House - 35A 19 $1,450.00", "register_verdict"),
        # Right person, right party, wrong seat -- which is what the 2022 redistricting
        # does to every member's older rows.
        ("Abeler, Jim Senate - 34 10 $500.00", "register_verdict"),
        # Right seat, different name. A near-name is not a name.
        ("Abeler, James Senate - 35 10 $500.00", "name_evidence"),
    ],
)
def test_a_row_failing_any_one_of_the_three_attaches_to_nothing(line, failing):
    verdict = refunds.match_row(one_row(line), [ABELER])

    assert verdict.registration_number is None
    assert verdict.attached is False
    # The row still says which of the 3 went wrong, so an unattached row is diagnosable.
    assert getattr(verdict, failing) in (
        refunds.NAME_DIFFERS,
        refunds.SEAT_DIFFERS,
        refunds.PARTY_DIFFERS,
    )


def test_a_row_whose_party_differs_attaches_to_nothing():
    parsed = rows_of(["DFL", "Abeler, Jim Senate - 35 10 $500.00"], year=2021)
    verdict = refunds.match_row(parsed.rows[0], [ABELER])

    assert verdict.registration_number is None
    assert verdict.party_agreement == refunds.PARTY_DIFFERS


def test_a_row_matching_nothing_in_an_empty_register_attaches_to_nothing():
    verdict = refunds.match_row(one_row("Abeler, Jim Senate - 35 180 $14,216.47"), [])

    assert verdict.attached is False
