"""The Finance name-matching eval: its labels, its scoring and its regression floor.

No database and no network. The committed pairs are graded with the shipped
grouping rule on every run, so a change that newly separates or joins a labelled
pair fails here until the fixture's known failures are updated on purpose.
"""

from __future__ import annotations

from collections import Counter
from types import SimpleNamespace

import pytest

from alethical.api.services import finance_similar_names
from alethical.api.services.finance_name_matching import strong_spelling
from alethical.eval import finance_names as ev


def _case(left, right, label="same", condition=None, kind="person", excluded=None):
    return ev.PairCase(
        id=ev._pair_id(left, right),
        left=left,
        right=right,
        role="donor",
        label=label,
        condition=condition or ev.condition_of(left, right),
        kind=kind,
        evidence="test",
        excluded=excluded,
    )


# --- The committed fixtures --------------------------------------------------


def test_pair_fixture_cases_are_well_formed():
    data, cases = ev.load_pairs()
    assert len(cases) >= 150
    assert len({c.id for c in cases}) == len(cases)
    for c in cases:
        assert c.id == ev._pair_id(c.left, c.right)
        assert c.label in ev.LABELS and c.condition in ev.CONDITIONS
        assert c.role in ev.ROLES and c.kind in {"person", "organization"}
        assert c.evidence.startswith("Board registration")
        assert ev.normalized(c.left) != ev.normalized(c.right)
        assert c.condition == ev.condition_of(c.left, c.right)
        assert c.excluded is None or len(c.excluded) > 20
    strata = Counter((c.label, c.condition) for c in cases)
    assert strata[("same", "spelling")] and strata[("different", "spelling")]


def test_search_fixture_cases_are_well_formed():
    data, cases = ev.load_searches()
    assert len({c.id for c in cases}) == len(cases)
    conditions = Counter(c.condition for c in cases)
    assert set(conditions) == {
        "candidate_name_finds_committee",
        "lobbyist_first_last",
        "lobbyist_as_printed",
    }
    for c in cases:
        assert c.surface == "money" and c.key_field == "registration_number"
        assert c.group in {"committees", "lobbyists"}
        assert c.expect and c.typed.strip()


def test_shipped_rule_holds_the_recorded_floor():
    """Each failing pair is listed on purpose; anything else must still pass."""
    data, cases = ev.load_pairs()
    report = ev.score_pairs(cases)
    now = ev.failing_ids(report)
    known = data["known_failures"]
    newly_failing = {i: f for i, f in now.items() if known.get(i) != f}
    newly_passing = sorted(set(known) - set(now))
    assert not newly_failing, (
        f"{len(newly_failing)} labelled pairs changed result: {newly_failing}. "
        "Read them with `scripts/finance_name_eval.py pairs`, then fix the rule or "
        "record the new floor with --record-known."
    )
    assert not newly_passing, (
        f"{len(newly_passing)} known failures now pass: {newly_passing}. Record the "
        "new floor with `scripts/finance_name_eval.py pairs --record-known`."
    )


# --- Scoring -------------------------------------------------------------------


def test_eval_uses_the_page_rule_for_each_role():
    left, right = "Smith, John", "John Smith"
    assert finance_similar_names.groups_with(left, right, "donor") == strong_spelling(
        left, right, person=True
    )
    assert finance_similar_names.groups_with(
        "Example Health Association", "Example Health Assn", "payee"
    ) == strong_spelling("Example Health Association", "Example Health Assn")


def test_a_wrong_group_is_counted_apart_from_a_miss():
    cases = [
        _case("Johnson, Ann", "Jonhson, Ann", "same"),  # grouped: passes
        _case("Example, Roberta Ann", "Example, Roberta Anne", "same"),  # missed
        _case("Smith, John", "Smith, John Q", "different"),  # wrong group
        _case("Example Fund", "Example Fund (New) Committee", "same", "wording"),
        _case(
            "Example, Ann", "Example, Annie", "same", excluded="Source error kept out"
        ),
    ]
    report = ev.score_pairs(cases)
    assert report["found_spelling_variants"] == {"cases": 2, "grouped": 1, "rate": 0.5}
    assert report["wrong_groups"] == {"cases": 1, "grouped": 1, "rate": 1.0}
    assert report["found_reworded_names"]["cases"] == 1
    assert report["excluded"] == 1
    assert sorted(f["failure"] for f in report["failures"]) == ["missed", "wrong_group"]
    assert report["misses_by_pattern"] == {"shortened_word": 1}


@pytest.mark.parametrize(
    ("left", "right", "pattern"),
    [
        ("Pérez, María", "Perez, Maria", "accents_case_or_order"),
        ("District 10 DFL", "District 11 DFL", "numbers_differ"),
        ("Example Fund", "Example Fund (New)", "extra_words"),
        ("Example, Sam", "Example, Samuel", "shortened_word"),
        ("Example, Jonathan", "Example, Jonathon", "typo"),
        ("Example, Joe", "Example, Joseph", "other"),
    ],
)
def test_patterns_name_how_two_names_differ(left, right, pattern):
    assert ev.pattern_of(left, right) == pattern


def test_condition_separates_spelling_from_wording():
    assert ev.condition_of("Example, Jonathan", "Jonathon Example") == "spelling"
    assert (
        ev.condition_of("Example Fund", "Example Senate District 4 Committee")
        == "wording"
    )


# --- Harvest -------------------------------------------------------------------


class _Rows:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


def test_harvest_labels_come_from_registration_numbers(monkeypatch):
    from alethical.api.services import committee_finance

    release = SimpleNamespace(
        file_for=lambda dataset: SimpleNamespace(snapshot_id="s1")
    )
    monkeypatch.setattr(committee_finance, "current_release", lambda db: release)
    rows = [
        ("100", "Example, Jonathan", "Lobbyist", 3),
        ("100", "Example, Jonathon", "Lobbyist", 2),
        ("100", "EXAMPLE, JONATHAN", "Lobbyist", 4),  # same after normalizing
        ("100", "Example, Jon", "Lobbyist", 1),  # one row: may be a mistyped number
        ("200", "Example, Jonathen", "Lobbyist", 5),  # close spelling, other number
        *[("900", f"Placeholder Name {i}", "Party Unit", 2) for i in range(7)],
    ]
    db = SimpleNamespace(execute=lambda *a, **k: _Rows(rows))
    meta, cases = ev.harvest_pairs(db, per_stratum=10)
    pairs = {(c.label, *sorted((c.left, c.right))) for c in cases}
    assert ("same", "Example, Jonathan", "Example, Jonathon") in pairs
    assert ("different", "Example, Jonathan", "Example, Jonathen") in pairs
    assert not any("Example, Jon" in (c.left, c.right) for c in cases)
    assert not any(c.left.startswith("Placeholder") for c in cases)
    assert meta["placeholder_numbers_skipped"] == 1
    assert meta["spellings_on_fewer_rows_skipped"] == 1
    assert meta["identical_after_normalizing_skipped"] >= 1


# --- Search --------------------------------------------------------------------


def _search(expect="17", typed="Ann Example"):
    return ev.SearchCase(
        id="x",
        typed=typed,
        surface="money",
        group="committees",
        key_field="registration_number",
        expect=expect,
        condition="candidate_name_finds_committee",
        evidence="test",
    )


def test_search_rank_and_failed_reads(monkeypatch):
    from alethical.api.services import finance_suggestions

    def money(db, typed, limit):
        if typed == "broken":
            raise RuntimeError("timeout")
        return {
            "groups": [
                {"kind": "people", "results": [{"id": "17"}]},
                {
                    "kind": "committees",
                    "results": [
                        {"registration_number": "9"},
                        {"registration_number": "17"},
                    ],
                },
            ]
        }

    monkeypatch.setattr(finance_suggestions, "money", money)
    db = SimpleNamespace(rollback=lambda: None)
    results = ev.run_searches(
        db, [_search(), _search(expect="5"), _search(typed="broken")]
    )
    assert [r["rank"] for r in results] == [2, None, None]
    assert results[2]["error"].startswith("RuntimeError")
    score = ev.score_searches(results)["candidate_name_finds_committee"]
    assert score == {"cases": 3, "found": 1, "first": 0, "errors": 1, "rate": 0.333}
