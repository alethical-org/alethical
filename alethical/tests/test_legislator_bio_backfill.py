"""Tests for the legislator biography parsers (House member pages + Senate LRL).

Fixtures use the REAL markup shapes fetched from the live sources — house.mn.gov
member profiles (a cleanly-authored member and Ned Carroll's quirky Family <li>),
the senate.leg.state.mn.us member_bio page (Elected/Term, no bio prose), and the
Legislative Reference Library record lrl.mn.gov/legdb/fulldetail (Senate bios) —
so the parsers are exercised against the actual source format rather than an
idealized one (a prior ingestion bug shipped a 100%-null column with green tests
that used a fabricated source format, #328).
"""

from alethical.pipeline.legislator_bio_backfill import (
    bio_sentence,
    leg_id_from_url,
    parse_house_bio,
    parse_lrl_bio,
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


def test_senate_member_bio_has_elected_term_but_no_biography():
    parsed = parse_senate_bio(strip_comments(SENATE_MEMBER_BIO))
    assert parsed.elected == "2006, re-elected 2012, 2016, 2020, 2022"
    assert parsed.term == "5th"
    assert parsed.biography is None


def test_leg_id_extracted_from_senate_profile_url():
    url = "http://www.senate.leg.state.mn.us/members/member_bio.php?leg_id=15245"
    assert leg_id_from_url(url) == "15245"
    assert leg_id_from_url("https://www.house.mn.gov/members/profile/15610") is None
    assert leg_id_from_url("") is None
