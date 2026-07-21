"""Tests for the House member-page biography parser.

Fixtures use the REAL markup shapes fetched from house.mn.gov member profiles
(a cleanly-authored member and Ned Carroll's quirky Family <li>), so the parser
is exercised against the actual source format rather than an idealized one.
"""

from alethical.pipeline.legislator_bio_backfill import bio_sentence, parse_house_bio

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
