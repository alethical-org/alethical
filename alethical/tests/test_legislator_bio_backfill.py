"""Tests for the legislator biography parsers (House member pages + Senate LRL).

Fixtures use the REAL markup shapes fetched from the live sources — house.mn.gov
member profiles (a cleanly-authored member and Ned Carroll's quirky Family <li>),
the senate.leg.state.mn.us member_bio page (Elected/Term, no bio prose), and the
Legislative Reference Library record lrl.mn.gov/legdb/fulldetail (Senate bios) —
so the parsers are exercised against the actual source format rather than an
idealized one (a prior ingestion bug shipped a 100%-null column with green tests
that used a fabricated source format, #328).
"""

import sys

import pytest

from alethical.pipeline.legislator_bio_backfill import (
    backfill,
    bio_sentence,
    lrl_id_from_profile_url,
    main,
    parse_house_bio,
    parse_lrl_bio,
    parse_lrl_city,
    parse_senate_bio,
    strip_comments,
)

# Ned Carroll (profile/15617): the Family <li> embeds the label inside the value
# and ends in a period, so the old formatter produced
# "...University of Iowa. Family: married, 3 children.."
CARROLL_HTML = """
<h4>Biographical Information:</h4>
<ul>
  <li><strong>Occupation:</strong> Attorney</li>
  <li><strong>Education:</strong> B.S.S., economics, political science, Cornell College; M.A., public policy analysis, Rutgers University; J.D., University of Iowa</li>
  <li><strong>Elected:</strong> 2022</li>
  <li>
    <strong>Term:</strong> 2nd
  </li>
  <li><strong>Family:</strong> Family: married, 3 children.</li>
</ul>
"""

# A cleanly-authored member (profile/15301 shape): source already capitalizes
# the Family value and adds no embedded label or trailing period.
CLEAN_HTML = """
<h4>Biographical Information:</h4>
<ul>
  <li><strong>Occupation:</strong> Business owner</li>
  <li><strong>Education:</strong> B.A., University of Minnesota</li>
  <li><strong>Elected:</strong> 2020, re-elected 2022</li>
  <li><strong>Term:</strong> 2nd</li>
  <li><strong>Family:</strong> Married, spouse Faith, 3 children</li>
</ul>
"""


def test_carroll_family_label_and_double_period_removed():
    parsed = parse_house_bio(CARROLL_HTML)
    assert parsed.biography == (
        "Attorney. B.S.S., economics, political science, Cornell College; "
        "M.A., public policy analysis, Rutgers University; J.D., University of "
        "Iowa. Married, 3 children."
    )
    assert "Family:" not in parsed.biography
    assert ".." not in parsed.biography
    assert parsed.elected == "2022"
    assert parsed.term == "2nd"


def test_clean_member_bio_unchanged_by_normalization():
    parsed = parse_house_bio(CLEAN_HTML)
    assert parsed.biography == (
        "Business owner. B.A., University of Minnesota. "
        "Married, spouse Faith, 3 children."
    )


def test_bio_sentence_only_capitalizes_when_label_stripped():
    # Redundant embedded label stripped -> leading word capitalized.
    assert (
        bio_sentence("Family", "Family: married, 3 children.") == "Married, 3 children."
    )
    # No embedded label -> value preserved verbatim (no forced capitalization,
    # so acronyms like "B.S.S." are never mangled), single terminal period.
    assert (
        bio_sentence("Education", "B.S.S., Cornell College")
        == "B.S.S., Cornell College."
    )
    assert bio_sentence("Family", "Married, spouse Faith, 3 children") == (
        "Married, spouse Faith, 3 children."
    )


# ── Senate biographies (issue #499): sourced from the LRL legislator record,
# NOT the member_bio page (which carries no bio prose). Fixtures below are the
# verbatim span/`<br />` shapes from lrl.mn.gov/legdb/fulldetail.

# LRL occupation + multi-entry education: Sen. Jim Carlson (id 15245).
LRL_CARLSON = """
                                <div>
                                    <span id="ctl00_Main_ListView_bio_ctrl0_Label16" class="font-weight-bold">Occupation (when first elected): </span>

                                    <span id="ctl00_Main_ListView_bio_ctrl0_Label2">Retired Mechanical Engineer, Ecolab and 3M</span>
                                </div>
                            </div>
                            <h2 class="mb-0 mt-3">EDUCATION</h2>
                            <div class="ml-3">
                                <p class="margin_zero">
                                    <span id="ctl00_Main_ListView_bio_ctrl0_LabelEducation">Dunwoody Institute, Minneapolis, Minnesota; Vocational-Technical School; Certificate of Machine Design, 1967<br />University of Minnesota; B.M.E.; Mechanical Engineering, 1973<br /></span>
"""

# LRL education entry ending in an abbreviation with a trailing ";": the "M.D.;"
# tail must read as "M.D." — never "M.D.;." (Sen. Alice Mann, id 15525).
LRL_MANN = """
                                    <span id="ctl00_Main_ListView_bio_ctrl0_Label16" class="font-weight-bold">Occupation (when first elected): </span>
                                    <span id="ctl00_Main_ListView_bio_ctrl0_Label2">Physician</span>
                                    <span id="ctl00_Main_ListView_bio_ctrl0_LabelEducation">Johns Hopkins University; M.P.H.; Public health<br />Meharry Medical College; M.D.;<br /></span>
"""

# LRL occupation present but the education span empty → bio = occupation alone.
LRL_OCCUPATION_ONLY = """
                                    <span id="ctl00_Main_ListView_bio_ctrl0_Label16" class="font-weight-bold">Occupation (when first elected): </span>
                                    <span id="ctl00_Main_ListView_bio_ctrl0_Label2">Small Business Owner</span>
                                    <span id="ctl00_Main_ListView_bio_ctrl0_LabelEducation"></span>
"""

# LRL record with neither field populated → no bio (grounded: null stays null).
LRL_EMPTY = """
                                    <span id="ctl00_Main_ListView_bio_ctrl0_Label16" class="font-weight-bold">Occupation (when first elected): </span>
                                    <span id="ctl00_Main_ListView_bio_ctrl0_Label2"></span>
                                    <span id="ctl00_Main_ListView_bio_ctrl0_LabelEducation"></span>
"""

# Senate member_bio page: supplies Elected/Term, carries NO bio prose. Verbatim
# shape from senate.leg.state.mn.us/members/member_bio.php?leg_id=15245.
SENATE_MEMBER_BIO = """
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


def test_lrl_bio_occupation_plus_multi_education():
    assert parse_lrl_bio(LRL_CARLSON) == (
        "Retired Mechanical Engineer, Ecolab and 3M. "
        "Dunwoody Institute, Minneapolis, Minnesota; Vocational-Technical "
        "School; Certificate of Machine Design, 1967. "
        "University of Minnesota; B.M.E.; Mechanical Engineering, 1973."
    )


def test_lrl_bio_trailing_abbreviation_semicolon_reads_clean():
    bio = parse_lrl_bio(LRL_MANN)
    # "M.D.;" tail must normalize to "M.D." — no stray/doubled punctuation, and
    # each school is its own clause.
    assert bio == (
        "Physician. Johns Hopkins University; M.P.H.; Public health. "
        "Meharry Medical College; M.D."
    )
    assert ";." not in bio
    assert ".." not in bio


def test_lrl_bio_occupation_only():
    assert parse_lrl_bio(LRL_OCCUPATION_ONLY) == "Small Business Owner."


def test_lrl_bio_empty_stays_none():
    assert parse_lrl_bio(LRL_EMPTY) is None


# LRL renders a missing occupation as the literal sentinel "None listed" (real
# shape from Sen. Omar Fateh, id 15511): it must be dropped, not shown as bio.
LRL_NONE_LISTED_OCCUPATION = """
                                    <span id="ctl00_Main_ListView_bio_ctrl0_Label16" class="font-weight-bold">Occupation (when first elected): </span>
                                    <span id="ctl00_Main_ListView_bio_ctrl0_Label2">None listed</span>
                                    <span id="ctl00_Main_ListView_bio_ctrl0_LabelEducation">George Mason University<br />George Mason University; M.P.A.; Public Administration<br /></span>
"""

# A record whose ONLY content is the sentinel → no bio at all (Sen. Keri
# Heintzeman, id 15646: "None listed" occupation, empty education).
LRL_ALL_SENTINEL = """
                                    <span id="ctl00_Main_ListView_bio_ctrl0_Label16" class="font-weight-bold">Occupation (when first elected): </span>
                                    <span id="ctl00_Main_ListView_bio_ctrl0_Label2">None listed</span>
                                    <span id="ctl00_Main_ListView_bio_ctrl0_LabelEducation"></span>
"""


def test_lrl_bio_drops_none_listed_occupation_sentinel():
    bio = parse_lrl_bio(LRL_NONE_LISTED_OCCUPATION)
    # The "None listed" occupation is dropped; only the real education remains.
    assert bio == (
        "George Mason University. "
        "George Mason University; M.P.A.; Public Administration."
    )
    assert "None listed" not in bio


def test_lrl_bio_all_sentinel_stays_none():
    # No real content anywhere → null (grounded: absence is not bio text).
    assert parse_lrl_bio(LRL_ALL_SENTINEL) is None


def test_senate_member_bio_has_elected_term_but_no_biography():
    parsed = parse_senate_bio(strip_comments(SENATE_MEMBER_BIO))
    assert parsed.elected == "2006, re-elected 2012, 2016, 2020, 2022"
    assert parsed.term == "5th"
    assert parsed.biography is None


# ── City of residence (issue #551): the LRL "Terms" block lists one Residence
# per term, NEWEST FIRST, so ctrl0 is the current term. Verbatim shape from
# lrl.mn.gov/legdb/fulldetail (Sen. Melissa H. Wiklund, id 15389, SD 51).

LRL_RESIDENCE_MULTI_TERM = """
    <div> <b>Elected: </b> <span id="ctl00_Main_ListView_termdata_ctrl0_Label_elected">11/8/2022</span> </div>
    <div> <b>Residence: </b> <span id="ctl00_Main_ListView_termdata_ctrl0_Labelresidence">Bloomington</span> </div>
    <div> <b>Elected: </b> <span id="ctl00_Main_ListView_termdata_ctrl1_Label_elected">11/6/2018</span> </div>
    <div> <b>Residence: </b> <span id="ctl00_Main_ListView_termdata_ctrl1_Labelresidence">Richfield</span> </div>
"""

# A member with no Residence field at all → null (grounded: absence stays null).
LRL_NO_RESIDENCE = """
    <div> <b>Elected: </b> <span id="ctl00_Main_ListView_termdata_ctrl0_Label_elected">11/8/2022</span> </div>
"""

# A Residence rendered as the data-absence sentinel → dropped, never shown.
LRL_RESIDENCE_SENTINEL = """
    <div> <b>Residence: </b> <span id="ctl00_Main_ListView_termdata_ctrl0_Labelresidence">None listed</span> </div>
"""


def test_lrl_city_takes_current_term_residence():
    # Newest term first: the current residence wins, not a prior-term city.
    assert parse_lrl_city(LRL_RESIDENCE_MULTI_TERM) == "Bloomington"


def test_lrl_city_missing_stays_none():
    assert parse_lrl_city(LRL_NO_RESIDENCE) is None


def test_lrl_city_sentinel_stays_none():
    assert parse_lrl_city(LRL_RESIDENCE_SENTINEL) is None


def test_lrl_id_extracted_from_both_chamber_profile_urls():
    senate_url = "http://www.senate.leg.state.mn.us/members/member_bio.php?leg_id=15245"
    house_url = "https://www.house.mn.gov/members/profile/15610"
    assert lrl_id_from_profile_url(senate_url) == "15245"
    assert lrl_id_from_profile_url(house_url) == "15610"
    assert lrl_id_from_profile_url("") is None


def test_city_backfill_dry_run_handles_supported_and_missing_records(monkeypatch):
    class Row:
        elected = None
        term = None
        represented_city = None

        def __init__(self, profile_url):
            self.profile_url = profile_url

    class Member:
        biography = None

        def __init__(self, name):
            self.full_name = name

    supported = Row("https://www.house.mn.gov/members/profile/15389")
    missing = Row("https://www.house.mn.gov/members/profile/19999")
    monkeypatch.setattr(
        "alethical.pipeline.legislator_bio_backfill.current_service_rows",
        lambda *args, **kwargs: [
            (supported, Member("Supported City"), "house"),
            (missing, Member("Missing City"), "house"),
        ],
    )

    def fake_fetch(_session, url):
        if "fulldetail" not in url:
            return CLEAN_HTML
        return LRL_RESIDENCE_MULTI_TERM if "15389" in url else LRL_NO_RESIDENCE

    monkeypatch.setattr(
        "alethical.pipeline.legislator_bio_backfill.fetch_text", fake_fetch
    )

    class Db:
        commits = 0

        def commit(self):
            self.commits += 1

    db = Db()
    stats = backfill(
        db,
        dry_run=True,
        only_missing=True,
        limit=None,
        legislator=None,
        chamber=None,
    )

    assert stats.service_periods_seen == 2
    assert stats.city_parsed == 1
    assert db.commits == 0
    assert supported.represented_city is None
    assert missing.represented_city is None


def test_city_only_write_never_changes_other_profile_fields(monkeypatch):
    class Row:
        profile_url = "https://www.house.mn.gov/members/profile/15389"
        elected = "2020"
        term = "3rd"
        represented_city = None

    class Member:
        full_name = "Supported City"
        biography = "Existing official biography."

    row = Row()
    member = Member()
    monkeypatch.setattr(
        "alethical.pipeline.legislator_bio_backfill.current_service_rows",
        lambda *args, **kwargs: [(row, member, "house")],
    )

    fetched_urls = []

    def fake_fetch(_session, url):
        fetched_urls.append(url)
        return LRL_RESIDENCE_MULTI_TERM

    monkeypatch.setattr(
        "alethical.pipeline.legislator_bio_backfill.fetch_text", fake_fetch
    )

    class Db:
        commits = 0

        def commit(self):
            self.commits += 1

        def rollback(self):
            raise AssertionError("city-only write should not roll back")

    db = Db()
    stats = backfill(
        db,
        dry_run=False,
        only_missing=True,
        limit=None,
        legislator=None,
        chamber=None,
        city_only=True,
    )

    assert fetched_urls == ["https://www.lrl.mn.gov/legdb/fulldetail?id=15389"]
    assert row.represented_city == "Bloomington"
    assert row.elected == "2020"
    assert row.term == "3rd"
    assert member.biography == "Existing official biography."
    assert db.commits == 1
    assert stats.written == 1


def test_city_only_refuses_to_overwrite_existing_cities(monkeypatch):
    monkeypatch.setattr(
        sys,
        "argv",
        ["legislator_bio_backfill", "--city-only", "--dry-run"],
    )

    with pytest.raises(SystemExit, match="requires --only-missing"):
        main()
