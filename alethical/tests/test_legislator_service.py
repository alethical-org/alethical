"""Parser tests for the Legislative Service history scrape (issue #486).

Every fixture below is copied VERBATIM from the live official bio pages (Senate
senate.mn/members/member_bio, House house.mn.gov/members/profile) — including the
real tag structure and tab whitespace — because a prior ingestion bug shipped a
100%-null column with green tests that used a fabricated source format (#328).
"""

from __future__ import annotations

from alethical.pipeline.legislator_service import (
    parse_biography,
    parse_service_history,
)

# ── Senate, multi-chamber: Sen. Steve Green (mem_id 1251) — House then Senate.
# Verbatim from senate.mn/members/member_bio.html?mem_id=1251.
SENATE_MULTI_CHAMBER = """
<div class="container mt-3 pl-0">
    <h4>Legislative Service:</h4>
    <table class='ml-2'>
\t\t\t\t<tr>
\t\t\t\t\t<td class='pb-0 pl-2 pt-1'>
\t\t\t\t\t<strong>Elected:</strong> to the House 2012, re-elected 2014, 2016, 2018, 2020
\t\t\t\t\t</td>
\t\t\t\t</tr>
\t\t\t\t
\t\t\t\t<tr>
\t\t\t\t\t<td class='pb-0 pl-2 pt-1'>
\t\t\t\t\t\t<strong>Elected:</strong>  to the Senate 2022
\t\t\t\t\t</td>
\t\t\t\t</tr>
\t\t\t\t
\t\t\t\t<tr>
\t\t\t\t\t<td class='pb-0 pl-2 pt-1'>
\t\t\t\t\t<strong>Term:</strong> 1st
\t\t\t\t\t
\t\t\t\t</td>
\t\t\t</tr></table><!-- End Legislative Service Table -->                </div>
"""

# ── Senate, single-chamber (leg_id 15245): no "to the {chamber}" qualifier.
# Verbatim from the redirected senate.mn member_bio page.
SENATE_SINGLE_CHAMBER = """
                <div class="container mt-3 pl-0">
                    <h4>Legislative Service:</h4>
                    <table class='ml-2'>
    <tr>
     <td class='pb-0 pl-2 pt-1'>
     <strong>Elected:</strong> 2006, re-elected 2012, 2016, 2020, 2022
     </td>
    </tr>

    <tr>
     <td class='pb-0 pl-2 pt-1'>
     <strong>Term:</strong> 5th

    </td>
   </tr></table><!-- End Legislative Service Table -->                </div>
"""

# ── House, single-chamber: Rep. Patti Anderson (id 15610). House embeds
# Elected/Term in "Biographical Information" and lists only the initial year.
# Verbatim from house.mn.gov/members/profile/15610.
HOUSE_SINGLE_CHAMBER = """
        <div class="card-body pl-0">
            <h4>Biographical Information:</h4>
            <ul class="list-group p-0">
                <li class="list-group-item border-0 p-0 pl-3"><strong>Occupation:</strong> Business owner</li>
                <li class="list-group-item border-0 p-0 pl-3"><strong>Education:</strong> B.A., University of Minnesota; M.A., Hamline University</li>
                <li class="list-group-item border-0 p-0 pl-3"><strong>Elected:</strong> 2022</li>
                <li class="list-group-item border-0 p-0 pl-3">
                    <strong>Term:</strong> 2nd
                </li>
                <li class="list-group-item border-0 p-0 pl-3"><strong>Family:</strong> Married, spouse Doug, 6 children</li>
            </ul>
        </div>
"""

# ── House, long-serving (id 15301): initial year only, high term count.
HOUSE_LONG_SERVING = """
            <h4>Biographical Information:</h4>
            <ul class="list-group p-0">
                <li class="list-group-item border-0 p-0 pl-3"><strong>Elected:</strong> 2008</li>
                <li class="list-group-item border-0 p-0 pl-3">
                    <strong>Term:</strong> 9th
                </li>
            </ul>
"""


def test_senate_multi_chamber_orders_house_then_senate():
    history = parse_service_history(SENATE_MULTI_CHAMBER, "senate")
    assert len(history.periods) == 2
    house, senate = history.periods
    assert house.chamber_type == "house"
    assert house.initial_year == 2012
    assert house.reelection_years == [2014, 2016, 2018, 2020]
    assert senate.chamber_type == "senate"
    assert senate.initial_year == 2022
    assert senate.reelection_years == []
    # Term counts the CURRENT (Senate) chamber only — the five House terms are
    # not added in.
    assert history.term == 1


def test_senate_single_chamber_defaults_chamber_and_reads_reelections():
    history = parse_service_history(SENATE_SINGLE_CHAMBER, "senate")
    assert len(history.periods) == 1
    (period,) = history.periods
    # No "to the Senate" qualifier in the source → defaults to current chamber.
    assert period.chamber_type == "senate"
    assert period.initial_year == 2006
    assert period.reelection_years == [2012, 2016, 2020, 2022]
    assert history.term == 5


def test_house_single_chamber_initial_year_only():
    history = parse_service_history(HOUSE_SINGLE_CHAMBER, "house")
    assert len(history.periods) == 1
    (period,) = history.periods
    assert period.chamber_type == "house"
    assert period.initial_year == 2022
    # House bios never list re-elections.
    assert period.reelection_years == []
    # Term is authoritative even though only one election year is listed.
    assert history.term == 2


def test_house_long_serving_reads_high_term():
    history = parse_service_history(HOUSE_LONG_SERVING, "house")
    assert len(history.periods) == 1
    (period,) = history.periods
    assert period.chamber_type == "house"
    assert period.initial_year == 2008
    assert history.term == 9


def test_house_biography_joins_fields_into_prose():
    bio = parse_biography(HOUSE_SINGLE_CHAMBER, "house")
    assert bio == (
        "Business owner. "
        "B.A., University of Minnesota; M.A., Hamline University. "
        "Married, spouse Doug, 6 children."
    )


def test_senate_biography_is_none():
    # Senate member_bio pages carry no biographical fields — House-only (#499).
    assert parse_biography(SENATE_MULTI_CHAMBER, "senate") is None
    assert parse_biography(SENATE_SINGLE_CHAMBER, "senate") is None


def test_missing_block_returns_empty_without_crashing():
    history = parse_service_history("<html><body>No bio here.</body></html>", "house")
    assert history.periods == []
    assert history.term is None
