"""Tests for the verified statutory effective-date extractor (#483 / #562).

Grounded-answers rule 9: a bill's EFFECTIVE {date} label may only show a date the
enacted text states unambiguously. These cases use real clause language and real
action shapes sampled from the production corpus. Tier A: the extractor returns a
single verbatim date only when every section agrees on one explicit calendar date.
Tier B (#562): a bill whose every section is "the day following final enactment"
shows the Revisor's own published "Effective date" action, cross-checked to fall
just after the governor-signature date. Anything else -> None (the UI keeps the
honest LATEST ACTION fallback of #455 / #480).
"""

from types import SimpleNamespace

from alethical.api.routers.public import (
    bill_effective_dates,
    effective_date_day_following_enactment,
    effective_date_from_sections,
    governor_approval_date,
    resolve_effective_date,
    revisor_effective_date_action,
    verified_effective_date,
)

H = "EFFECTIVE DATE."  # the parsed heading label (the date lives in raw_text)


def _action(text, description):
    return SimpleNamespace(action_text=text, action_description=description)


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


def _bill(status_key, versions):
    # verified_effective_date now gates on the precomputed status_key column (#607).
    return SimpleNamespace(status_key=status_key, actions=[], versions=versions)


def test_verified_effective_date_gates_on_enacted():
    # A non-enacted bill returns None even if its current version parsed a date.
    bill = _bill("in_committee", [SimpleNamespace(id=1, is_current=True)])
    assert verified_effective_date(db=None, bill_row=bill) is None


def test_verified_effective_date_none_without_current_version():
    bill = _bill("signed_into_law", [SimpleNamespace(id=1, is_current=False)])
    assert verified_effective_date(db=None, bill_row=bill) is None


# --- Tier B: "the day following final enactment" (#562) ---------------------


def test_day_following_shape_true_when_all_sections_match():
    # HF 4987 shape: single section, pure "day following final enactment".
    sections = [
        (
            H,
            "... is designated as a memorial highway. This section is effective "
            "the day following final enactment.",
        )
    ]
    assert effective_date_day_following_enactment(sections) is True


def test_day_following_shape_true_multi_section():
    sections = [
        (H, "This section is effective the day following final enactment."),
        (
            H,
            "The commissioner shall act. This section is effective the day "
            "following final enactment.",
        ),
    ]
    assert effective_date_day_following_enactment(sections) is True


def test_day_following_shape_false_when_a_section_is_silent():
    # A silent section falls to the statutory default -> genuinely mixed, not Tier B.
    sections = [
        (H, "This section is effective the day following final enactment."),
        (None, "Amended statute text with no effective clause."),
    ]
    assert effective_date_day_following_enactment(sections) is False


def test_day_following_shape_false_when_mixed_with_explicit_date():
    # HF 4591 shape: some sections dated, some day-following -> mixed, not Tier B.
    sections = [
        (H, "This section is effective the day following final enactment."),
        (H, "This section is effective February 1, 2028."),
    ]
    assert effective_date_day_following_enactment(sections) is False


def test_day_following_shape_false_for_tier_a_bill():
    sections = [(H, "This section is effective July 1, 2027.")]
    assert effective_date_day_following_enactment(sections) is False


def test_day_following_shape_false_when_no_parseable_clause():
    sections = [(H, "Total Appropriation $ 162,111,000 from the general fund.")]
    assert effective_date_day_following_enactment(sections) is False


def test_day_following_shape_false_for_empty():
    assert effective_date_day_following_enactment([]) is False


def test_revisor_effective_date_single_clean_date():
    # SF 3623 shape.
    date = revisor_effective_date_action([_action("Effective date", "03/28/2026")])
    assert (date.year, date.month, date.day) == (2026, 3, 28)


def test_revisor_effective_date_two_digit_year():
    date = revisor_effective_date_action([_action("Effective date", "05/09/25")])
    assert (date.year, date.month, date.day) == (2025, 5, 9)


def test_revisor_effective_date_various_dates_returns_none():
    # HF 1163 shape: one date AND a "various dates" marker -> genuinely mixed.
    actions = [
        _action("Effective date", "05/07/25"),
        _action("Effective date", "various dates"),
    ]
    assert revisor_effective_date_action(actions) is None


def test_revisor_effective_date_none_when_no_action():
    assert revisor_effective_date_action([_action("Chapter number", "111")]) is None


def test_revisor_effective_date_malformed_year_rejected():
    assert (
        revisor_effective_date_action([_action("Effective date", "05/27/226")]) is None
    )


def test_governor_approval_single_date():
    actions = [
        _action("Presented to Governor", "05/12/2026"),
        _action("Governor approval", "05/14/2026"),
        _action("Governor's action Approval", "05/14/26"),  # same event, agrees
    ]
    approval = governor_approval_date(actions)
    assert (approval.year, approval.month, approval.day) == (2026, 5, 14)


def test_governor_approval_none_when_conflicting():
    # A malformed year and a good one disagree -> refuse to guess.
    actions = [
        _action("Governor approval", "05/27/2026"),
        _action("Governor's action Approval", "05/28/26"),
    ]
    assert governor_approval_date(actions) is None


def test_governor_approval_none_when_absent():
    # A bill that became law without signature carries no approval action.
    assert governor_approval_date([_action("Chapter number", "42")]) is None


# --- resolve_effective_date: the pure Tier A/B core shared by detail + list -----


def test_resolve_effective_date_tier_a():
    sections = [(H, "This section is effective July 1, 2027.")]
    assert resolve_effective_date(sections, []) == "July 1, 2027"


def test_resolve_effective_date_tier_b_from_action_in_window():
    # Every section day-following; the Revisor "Effective date" action is a clean
    # date two days after the governor signed -> that authoritative date.
    sections = [(H, "This section is effective the day following final enactment.")]
    actions = [
        _action("Governor approval", "05/14/2026"),
        _action("Effective date", "05/16/2026"),
    ]
    assert resolve_effective_date(sections, actions) == "May 16, 2026"


def test_resolve_effective_date_tier_b_rejected_outside_window():
    # A stray effective-date action far from the signing is not corroborated.
    sections = [(H, "This section is effective the day following final enactment.")]
    actions = [
        _action("Governor approval", "05/14/2026"),
        _action("Effective date", "08/01/2026"),
    ]
    assert resolve_effective_date(sections, actions) is None


def test_resolve_effective_date_none_when_ambiguous():
    sections = [
        (H, "This section is effective January 1, 2027."),
        (H, "This section is effective July 1, 2026."),
    ]
    assert resolve_effective_date(sections, []) is None


# --- bill_effective_dates: batched list-endpoint helper ------------------------


class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _FakeDb:
    """Returns queued .all() results in call order (version query, then sections)."""

    def __init__(self, *results):
        self._results = list(results)

    def execute(self, *args, **kwargs):
        return _FakeResult(self._results.pop(0))


def _bill_action(text, description="", roll_call_text=None):
    return SimpleNamespace(
        action_text=text, action_description=description, roll_call_text=roll_call_text
    )


def _signed_bill(bill_id, *, is_omnibus=False, actions=()):
    # bill_effective_dates now gates on the precomputed status_key column (#607).
    return SimpleNamespace(
        id=bill_id,
        is_omnibus=is_omnibus,
        status_key="signed_into_law",
        actions=list(actions),
    )


def test_bill_effective_dates_empty_when_no_signed_bills():
    bill = SimpleNamespace(
        id=1, is_omnibus=False, status_key="in_committee", actions=[]
    )
    # No signed bills -> no DB queries at all.
    assert bill_effective_dates(_FakeDb(), [bill]) == {}


def test_bill_effective_dates_single_verified_date():
    bill = _signed_bill(1)
    db = _FakeDb(
        [(1, 10)],  # current version id per signed bill
        [(10, H, "This section is effective July 1, 2027.")],  # its sections
    )
    assert bill_effective_dates(db, [bill]) == {"1": "July 1, 2027"}


def test_bill_effective_dates_omnibus_falls_back_to_various():
    bill = _signed_bill(2, is_omnibus=True)
    db = _FakeDb(
        [(2, 20)],
        [
            (20, H, "This section is effective January 1, 2027."),
            (20, H, "This section is effective July 1, 2026."),
        ],
    )
    assert bill_effective_dates(db, [bill]) == {"2": "various dates"}


def test_bill_effective_dates_omnibus_prefers_verified_over_various():
    # An omnibus whose sections DO resolve to one date shows that date, not "various".
    bill = _signed_bill(4, is_omnibus=True)
    db = _FakeDb(
        [(4, 40)],
        [
            (40, H, "This section is effective August 1, 2026."),
            (40, H, "This section is effective August 1, 2026."),
        ],
    )
    assert bill_effective_dates(db, [bill]) == {"4": "August 1, 2026"}


def test_bill_effective_dates_omits_non_omnibus_without_date():
    bill = _signed_bill(3)
    db = _FakeDb([(3, 30)], [(30, None, "Amended statute text, no effective clause.")])
    assert bill_effective_dates(db, [bill]) == {}


def test_bill_effective_dates_omnibus_various_when_no_current_version():
    # No current version -> the section query is skipped entirely; an omnibus still
    # falls back to "various dates".
    bill = _signed_bill(5, is_omnibus=True)
    db = _FakeDb([])  # version query returns nothing; no second query runs
    assert bill_effective_dates(db, [bill]) == {"5": "various dates"}
