"""Tests for the verified statutory effective-date extractor (#483).

Grounded-answers rule 9: a bill's EFFECTIVE {date} label may only show a date the
enacted text states unambiguously. These cases use real clause language sampled
from the production corpus; the extractor must return a single verbatim date only
when every section agrees on one explicit calendar date, and None otherwise (so
the UI keeps the honest LATEST ACTION fallback of #455 / #480).
"""

from types import SimpleNamespace

from alethical.api.routers.public import (
    effective_date_from_sections,
    verified_effective_date,
)

H = "EFFECTIVE DATE."  # the parsed heading label (the date lives in raw_text)


def test_hf4138_single_explicit_date():
    # HF 4138 (2026 Ch. 111): both sections effective July 1, 2027.
    sections = [
        (H, "... This section is effective July 1, 2027."),
        (
            H,
            "... This section is effective July 1, 2027, and applies to accounts "
            "created before, on, or after that date.",
        ),
    ]
    assert effective_date_from_sections(sections) == "July 1, 2027"


def test_hf4133_identical_dates_with_applicability_tail():
    sections = [
        (
            H,
            "This section is effective January 1, 2027, and applies to homeowner's "
            "insurance policies offered, issued, or renewed on or after that date.",
        ),
        (
            H,
            "This section is effective January 1, 2027, and applies to homeowner's "
            "insurance policies offered, issued, or renewed on or after that date.",
        ),
    ]
    assert effective_date_from_sections(sections) == "January 1, 2027"


def test_silent_section_makes_bill_mixed():
    # SF 334 shape: one explicit section + a silent section (defaults to Aug 1).
    sections = [
        (H, "This section is effective the day following final enactment."),
        (None, "Some amended statute text with no effective clause."),
    ]
    assert effective_date_from_sections(sections) is None


def test_multiple_distinct_dates_across_sections():
    # SF 856 shape: several different per-section dates -> no single answer.
    sections = [
        (H, "This section is effective January 1, 2027."),
        (H, "This section is effective July 1, 2026."),
        (H, "This section is effective July 1, 2027."),
    ]
    assert effective_date_from_sections(sections) is None


def test_day_following_final_enactment_excluded():
    sections = [(H, "This section is effective the day following final enactment.")]
    assert effective_date_from_sections(sections) is None


def test_conditional_clause_excluded():
    sections = [
        (
            H,
            "This section is effective the day after the governing body of the city "
            "of Example complies with Minnesota Statutes, section 645.021.",
        )
    ]
    assert effective_date_from_sections(sections) is None


def test_two_dates_in_one_clause_excluded():
    sections = [
        (
            H,
            "This section is effective July 1, 2026, for policies and January 1, "
            "2027, for claims.",
        )
    ]
    assert effective_date_from_sections(sections) is None


def test_clause_section_without_parseable_sentence_excluded():
    # A heading present but the body has no "this section is effective ..." sentence.
    sections = [
        (H, "Total Appropriation $ 162,111,000 from the outdoor heritage fund.")
    ]
    assert effective_date_from_sections(sections) is None


def test_no_sections_returns_none():
    assert effective_date_from_sections([]) is None


def test_normalizes_whitespace_and_day_padding():
    sections = [(H, "This\n  section   is effective  August 1,  2026.")]
    assert effective_date_from_sections(sections) == "August 1, 2026"


def _bill(status, versions):
    return SimpleNamespace(current_status=status, actions=[], versions=versions)


def test_verified_effective_date_gates_on_enacted():
    # A non-enacted bill returns None even if its current version parsed a date.
    bill = _bill("Referred to committee", [SimpleNamespace(id=1, is_current=True)])
    assert verified_effective_date(db=None, bill_row=bill) is None


def test_verified_effective_date_none_without_current_version():
    bill = _bill("Chapter number", [SimpleNamespace(id=1, is_current=False)])
    assert verified_effective_date(db=None, bill_row=bill) is None
