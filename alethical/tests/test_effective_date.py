"""Tests for the verified statutory effective-date extractor (#483 / #562 / #706).

Grounded-answers rule 9: a bill's EFFECTIVE {date} label may only show a date the
enacted text states unambiguously. These cases use real clause language and real
action shapes sampled from the production corpus. Tier A: the extractor returns a
single verbatim date only when every section agrees on one explicit calendar date.
Tier B (#562): a bill whose every section is "the day following final enactment"
shows the Revisor's own published "Effective date" action, cross-checked to fall
just after the governor-signature date. Tier C (#706): a bill whose sections state
no date at all falls to the Minn. Stat. 645.02 default for the whole act, again
taken from the Revisor's published action and cross-checked against the statute's
two defaults. Anything else -> None (the UI keeps the honest LATEST ACTION
fallback of #455 / #480).
"""

from collections import Counter
from datetime import date
from types import SimpleNamespace

from alethical.api.routers.public import (
    bill_effective_dates,
    effective_date_all_sections_silent,
    effective_date_day_following_enactment,
    effective_date_from_sections,
    effective_schedule_payload,
    governor_approval_date,
    resolve_effective_date,
    resolve_phased_effective_dates,
    revisor_effective_date_action,
    section_effective_dates,
    statutory_default_effective_dates,
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


# --- Tier C: no section states a date -> Minn. Stat. 645.02 default (#706) ------


def test_all_sections_silent_true_for_uniformly_silent_bill():
    # HF 286 (2025 Ch. 22) shape: amended statute text, no effective clause anywhere.
    sections = [
        (None, "Section 1. Minnesota Statutes 2024, section 299C.62, is amended ..."),
        ("", "Sec. 2. A local unit of government may conduct a background check ..."),
    ]
    assert effective_date_all_sections_silent(sections) is True


def test_all_sections_silent_false_when_a_section_states_a_date():
    # SF 334 (2026 Ch. 120) shape: 1 of 14 sections carries a clause.
    sections = [
        (H, "This section is effective the day following final enactment."),
        (None, "Amended statute text with no effective clause."),
    ]
    assert effective_date_all_sections_silent(sections) is False


def test_all_sections_silent_false_when_clause_present_without_heading():
    # Belt-and-braces: an unheaded clause still disqualifies the silent shape.
    sections = [(None, "... This section is effective July 1, 2027.")]
    assert effective_date_all_sections_silent(sections) is False


def test_all_sections_silent_ignores_substantive_effective_wording():
    # Real prod text (HF 4075, HF 3298): "effective" in the statute's own substance
    # is not an effective-date clause for the act.
    sections = [
        (
            None,
            "the order granting relief becomes effective upon the referee's signature.",
        ),
        (None, "a donation of an interest in real property is not effective until ..."),
    ]
    assert effective_date_all_sections_silent(sections) is True


def test_all_sections_silent_false_for_empty():
    # A bill whose text we never parsed must not be claimed as silent.
    assert effective_date_all_sections_silent([]) is False


def test_statutory_defaults_are_next_following_july_and_august():
    # HF 286 signed 05/15/2025 -> Aug 1, 2025 (or July 1, 2025 if appropriating).
    assert statutory_default_effective_dates(date(2025, 5, 15)) == {
        date(2025, 7, 1),
        date(2025, 8, 1),
    }


def test_statutory_defaults_roll_to_next_year_after_the_default_date():
    # A special-session act signed in September: "next following" is a year out.
    assert statutory_default_effective_dates(date(2025, 9, 10)) == {
        date(2026, 7, 1),
        date(2026, 8, 1),
    }


def test_resolve_effective_date_tier_c_august_default():
    # HF 286 (2025 Ch. 22): silent text, Revisor publishes 08/01/2025.
    sections = [(None, "Amended statute text, no effective clause.")]
    actions = [
        _action("Governor approval", "05/15/2025"),
        _action("Effective date", "08/01/2025"),
    ]
    assert resolve_effective_date(sections, actions) == "August 1, 2025"


def test_resolve_effective_date_tier_c_july_default_for_appropriations():
    # HF 5074 (2026 Ch. 105) appropriates money: Revisor publishes 07/01/2026, the
    # 645.02 appropriation default. We accept the Revisor's pick rather than judge
    # whether the act appropriates.
    sections = [
        (None, "Settlement of certain claims against the state; appropriating money.")
    ]
    actions = [
        _action("Governor approval", "05/19/26"),
        _action("Effective date", "07/01/2026"),
    ]
    assert resolve_effective_date(sections, actions) == "July 1, 2026"


def test_resolve_effective_date_tier_c_rejects_non_default_date():
    # Silent text but a Revisor date that is neither statutory default: something
    # else is going on, so fall back rather than assert it.
    sections = [(None, "Amended statute text, no effective clause.")]
    actions = [
        _action("Governor approval", "05/15/2025"),
        _action("Effective date", "05/16/2025"),
    ]
    assert resolve_effective_date(sections, actions) is None


def test_resolve_effective_date_tier_c_rejects_various_dates():
    # HF 3900 shape: uniformly silent sections, but the Revisor itself flags the act
    # as taking effect on various dates.
    sections = [(None, "Amended statute text, no effective clause.")]
    actions = [
        _action("Governor approval", "05/26/2026"),
        _action("Effective date", "Various dates"),
    ]
    assert resolve_effective_date(sections, actions) is None


def test_resolve_effective_date_sf334_mixed_bill_still_falls_back():
    # SF 334 (2026 Ch. 120) is the case that must NOT show a date: 1 of 14 sections
    # is effective the day following enactment (May 28, 2026, which the Revisor
    # publishes) while the other 13 are silent and fall to Aug 1, 2026. Labeling the
    # whole act "EFFECTIVE May 28, 2026" would be wrong for 13 of its 14 sections.
    sections = [(H, "This section is effective the day following final enactment.")] + [
        (None, "Amended statute text, no effective clause.")
    ] * 13
    actions = [
        _action("Governor approval", "05/27/2026"),
        _action("Effective date", "05/28/2026"),
    ]
    assert resolve_effective_date(sections, actions) is None


# --- resolve_effective_date: the pure Tier A/B/C core shared by detail + list ----


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
    # Silent sections AND no actions -> nothing to cross-check Tier C against.
    bill = _signed_bill(3)
    db = _FakeDb([(3, 30)], [(30, None, "Amended statute text, no effective clause.")])
    assert bill_effective_dates(db, [bill]) == {}


def test_bill_effective_dates_tier_c_reaches_list_cards():
    # A card and the bill page must agree, so Tier C flows through the batched
    # list helper too (grounded-answers rule 9).
    bill = _signed_bill(
        6,
        actions=[
            _bill_action("Governor approval", "05/15/2025"),
            _bill_action("Effective date", "08/01/2025"),
        ],
    )
    db = _FakeDb([(6, 60)], [(60, None, "Amended statute text, no effective clause.")])
    assert bill_effective_dates(db, [bill]) == {"6": "August 1, 2025"}


def test_bill_effective_dates_omnibus_various_when_no_current_version():
    # No current version -> the section query is skipped entirely; an omnibus still
    # falls back to "various dates".
    bill = _signed_bill(5, is_omnibus=True)
    db = _FakeDb([])  # version query returns nothing; no second query runs
    assert bill_effective_dates(db, [bill]) == {"5": "various dates"}


# ---------------------------------------------------------------------------
# PHASED laws (#715) — a law whose sections start on different days. Every date
# shown must come from the law's own text; the sections that state nothing get a
# note naming both Minn. Stat. 645.02 candidates, never a guessed date. Cases use
# real clause language and action shapes sampled from the production corpus.
# ---------------------------------------------------------------------------

SIGNED_SF334 = [
    _action("Governor approval", "05/27/2026"),
    _action("Secretary of State, Filed", "05/27/2026"),
    _action("Secretary of State", "Chapter 120 05/27/26"),
    _action("Effective date", "05/28/2026"),
]


def test_sf334_phased_one_stated_date_rest_undated():
    # SF 334 (2026 ch. 120): Sec. 4 is "the day following final enactment", the
    # other 13 sections state nothing. Value is the earliest date the law states.
    sections = [(None, "Amended statute text, no effective clause.")] * 13
    sections.append(
        (H, "Expiration. This section is effective the day following final enactment.")
    )
    result = resolve_phased_effective_dates(sections, SIGNED_SF334)
    assert result is not None
    assert result["value"] == "May 28, 2026"  # filing 05/27 + 1 day
    assert result["rows"] == [
        {"date": "May 28, 2026", "sections": 1, "from_enactment": True}
    ]
    assert result["total_sections"] == 14
    assert result["undated_sections"] == 13
    assert result["default_candidates"] == ["July 1, 2026", "August 1, 2026"]
    # And it never resolves to a single whole-act date (the withdrawn majority rule).
    assert resolve_effective_date(sections, SIGNED_SF334) is None


def test_hf2130_stated_date_matching_the_default_is_not_provably_phased():
    # HF 2130: 4 sections state Aug 1, 2025 and 20 state nothing. Aug 1 is exactly
    # the statutory default those 20 may take, so we cannot assert a split — the
    # Revisor publishes one clean Aug 1, 2025. Guessing July here would MANUFACTURE
    # phasing on a single-date law.
    actions = [
        _action("Governor approval", "05/22/2025"),
        _action("Secretary of State, Filed", "05/22/2025"),
    ]
    stated = (
        H,
        "This section is effective August 1, 2025, and applies to crimes committed "
        "on or after that date.",
    )
    sections = [stated] * 4 + [(None, "Amended statute text.")] * 20
    assert resolve_phased_effective_dates(sections, actions) is None


def test_hf3827_earliest_not_provable_reads_various_dates():
    # HF 3827: only Sec. 4 states a date (Jan 1, 2027) and 5 sections state
    # nothing. Both statutory candidates (July 1 / Aug 1, 2026) fall BEFORE it, so
    # an undated section may start first and the earliest is not provable.
    actions = [
        _action("Governor approval", "05/05/2026"),
        _action("Secretary of State, Filed", "05/05/2026"),
    ]
    sections = [(None, "Amended statute text.")] * 5
    sections.append((H, "This section is effective January 1, 2027."))
    result = resolve_phased_effective_dates(sections, actions)
    assert result is not None
    assert result["value"] is None  # the UI shows "Various dates"
    assert result["undated_sections"] == 5


def test_two_stated_dates_emit_rows_newest_first():
    actions = [
        _action("Governor approval", "05/20/2025"),
        _action("Secretary of State, Filed", "05/20/2025"),
    ]
    sections = [
        (H, "This section is effective May 21, 2025."),
        (H, "This section is effective August 1, 2025."),
        (H, "This section is effective August 1, 2025."),
    ]
    result = resolve_phased_effective_dates(sections, actions)
    assert result is not None
    assert result["value"] == "May 21, 2025"
    # May 21 IS the day after filing, so the row is flagged from_enactment even
    # though the section named the calendar date outright — the two are the same
    # day, so the timeline's "day after ..." gloss stays true either way.
    assert result["rows"] == [
        {"date": "August 1, 2025", "sections": 2, "from_enactment": False},
        {"date": "May 21, 2025", "sections": 1, "from_enactment": True},
    ]
    assert result["undated_sections"] == 0


def test_retroactive_clause_is_not_an_effective_date():
    # SF 3637: "effective retroactively from July 1, 2025" means the law APPLIES to
    # earlier events, not that it started then. With no other stated date there is
    # nothing to phase.
    actions = [
        _action("Governor approval", "04/10/2026"),
        _action("Secretary of State, Filed", "04/10/2026"),
    ]
    sections = [
        (
            H,
            "This section is effective retroactively from July 1, 2025, and applies "
            "to prescriptions issued on or after that date.",
        )
    ]
    stated, undated, unresolved = section_effective_dates(sections, actions)
    assert stated == Counter()
    assert (undated, unresolved) == (0, 1)
    assert resolve_phased_effective_dates(sections, actions) is None


def test_statutory_text_being_amended_never_supplies_a_date():
    # Loose "effective" matching read an April 1, 1996 date off HF 2115 and a
    # January 1, 2014 date off SF 4476 — both current-biennium bills quoting the
    # statute they amend. Only the Revisor's canonical sentence shape counts.
    actions = [
        _action("Governor approval", "05/20/2026"),
        _action("Secretary of State, Filed", "05/20/2026"),
    ]
    sections = [
        (
            None,
            "The nursing facility's property-related payment rate resulting from the "
            "project authorized in this paragraph shall become effective no earlier "
            "than April 1, 1996.",
        ),
        (
            None,
            "(f) Effective for services rendered on or after January 1, 2014, the "
            "commissioner shall withhold three percent of managed care plan payments "
            "under section 256B.",
        ),
    ]
    stated, undated, unresolved = section_effective_dates(sections, actions)
    assert stated == Counter()
    assert (undated, unresolved) == (2, 0)


def test_undated_count_excludes_sections_carrying_an_unresolved_clause():
    # A conditional clause is neither a stated date nor silence, so it must not be
    # swept into the undated tally the note prints — the note says "1 of the 3
    # sections state no date" here, never "2".
    actions = [
        _action("Governor approval", "05/20/2026"),
        _action("Secretary of State, Filed", "05/20/2026"),
    ]
    sections = [
        (H, "This section is effective May 25, 2026."),
        (H, "This section is effective if the commissioner certifies the transfer."),
        (None, "Amended statute text."),
    ]
    result = resolve_phased_effective_dates(sections, actions)
    assert result is not None
    assert result["value"] == "May 25, 2026"
    assert result["total_sections"] == 3
    assert result["undated_sections"] == 1


def test_phased_needs_a_signing_anchor():
    # No governor-approval action -> no statutory candidates to compare against, so
    # we cannot prove a split and the UI keeps LATEST ACTION.
    sections = [
        (H, "This section is effective the day following final enactment."),
        (None, "Amended statute text."),
    ]
    assert resolve_phased_effective_dates(sections, []) is None


def _detail_bill(actions=()):
    """A bill row shaped for the DETAIL path (its current version's sections load)."""
    return SimpleNamespace(
        status_key="signed_into_law",
        actions=list(actions),
        versions=[SimpleNamespace(id=1, is_current=True)],
    )


def test_effective_schedule_single_date_law():
    bill = _detail_bill(
        [
            _action("Governor approval", "05/26/2026"),
            _action("Effective date", "07/01/2026"),
        ]
    )
    db = _FakeDb([(H, "This section is effective July 1, 2027.")])
    assert effective_schedule_payload(db, bill) == {
        "kind": "single",
        "value": "July 1, 2027",
        "rows": [{"date": "July 1, 2027", "sections": 1, "from_enactment": False}],
        "total_sections": 1,
        "undated_sections": 0,
        "default_candidates": [],
    }


def test_effective_schedule_phased_law():
    bill = _detail_bill(
        [
            _action("Governor approval", "05/27/2026"),
            _action("Secretary of State, Filed", "05/27/2026"),
        ]
    )
    db = _FakeDb(
        [
            (None, "Amended statute text."),
            (H, "This section is effective the day following final enactment."),
        ]
    )
    payload = effective_schedule_payload(db, bill)
    assert payload is not None
    assert payload["kind"] == "phased"
    assert payload["value"] == "May 28, 2026"
    assert payload["undated_sections"] == 1


def test_effective_schedule_absent_for_unresolvable_signed_law():
    bill = _detail_bill()
    db = _FakeDb([(None, "Amended statute text.")])
    assert effective_schedule_payload(db, bill) is None


def test_revisor_redline_markup_never_supplies_a_struck_date():
    # HF 3022 carries "effective August 1, deleted text begin 2025deleted text end
    # 2026": reading it verbatim yields 2025, the very year the amendment REMOVES.
    actions = [
        _action("Governor approval", "05/15/2026"),
        _action("Secretary of State, Filed", "05/15/2026"),
    ]
    sections = [
        (
            H,
            "This section is effective August 1, deleted text begin 2025deleted "
            "text end new text begin 2026new text end .",
        )
    ]
    stated, undated, unresolved = section_effective_dates(sections, actions)
    assert stated == Counter({date(2026, 8, 1): 1})
    assert (undated, unresolved) == (0, 0)


def test_applicability_window_is_not_a_start_date():
    # HF 2446: "effective for taxable years beginning after December 31, 2024" says
    # what the section COVERS, not when it starts, so it states no start date.
    actions = [
        _action("Governor approval", "05/23/2025"),
        _action("Secretary of State, Filed", "05/23/2025"),
    ]
    sections = [
        (
            H,
            "This section is effective for taxable years beginning after December 31, 2024.",
        ),
        (
            H,
            "This section is effective for dates of injury on or after October 1, 2026.",
        ),
    ]
    stated, undated, unresolved = section_effective_dates(sections, actions)
    assert stated == Counter()
    assert (undated, unresolved) == (0, 2)


def test_day_following_wins_over_the_applies_to_date():
    # SF 3720 §9: "effective the day following final enactment and applies to dates
    # of injury on or after October 1, 2024" started May 19, 2026 — reading the
    # whole clause handed back a 2024 start date for a 2026 law.
    actions = [
        _action("Governor approval", "05/18/2026"),
        _action("Secretary of State, Filed", "05/18/2026"),
    ]
    sections = [
        (
            H,
            "This section is effective the day following final enactment and applies "
            "to dates of injury on or after October 1, 2024.",
        )
    ]
    stated, _, _ = section_effective_dates(sections, actions)
    assert stated == Counter({date(2026, 5, 19): 1})


def test_a_date_before_enactment_is_not_a_start_date():
    # HF 3022 was signed May 15, 2025 and carries a section "effective August 1,
    # 2024" — a law cannot begin nine months before the governor signed it.
    actions = [
        _action("Governor approval", "05/15/2025"),
        _action("Secretary of State, Filed", "05/15/2025"),
    ]
    sections = [
        (H, "This section is effective August 1, 2024."),
        (H, "This section is effective the day following final enactment."),
        (None, "Amended statute text."),
    ]
    stated, undated, unresolved = section_effective_dates(sections, actions)
    assert stated == Counter({date(2025, 5, 16): 1})
    assert (undated, unresolved) == (1, 1)


def test_phased_value_is_various_dates_when_the_earliest_is_unprovable():
    # HF 3827: the one stated date falls after both Minn. Stat. 645.02 defaults, so
    # a silent section may well start first and we cannot name the earliest.
    actions = [
        _action("Governor approval", "05/20/2026"),
        _action("Secretary of State, Filed", "05/20/2026"),
    ]
    sections = [
        (H, "This section is effective January 1, 2027."),
        (None, "Amended statute text."),
    ]
    result = resolve_phased_effective_dates(sections, actions)
    assert result is not None
    assert result["value"] is None
    assert result["undated_sections"] == 1


def test_single_and_phased_are_mutually_exclusive():
    # Every tier in resolve_effective_date needs the sections to be unable to
    # disagree, which a phased law never is — so no bill can resolve as both.
    actions = [
        _action("Governor approval", "05/20/2026"),
        _action("Secretary of State, Filed", "05/20/2026"),
        _action("Effective date", "05/21/2026"),
    ]
    for sections in (
        [(H, "This section is effective July 1, 2027.")] * 3,
        [(H, "This section is effective the day following final enactment.")] * 3,
        [(None, "Amended statute text.")] * 3,
    ):
        assert (
            resolve_effective_date(sections, actions) is None
            or resolve_phased_effective_dates(sections, actions) is None
        )
