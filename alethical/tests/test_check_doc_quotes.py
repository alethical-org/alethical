"""Tests for the exact-quote drift check in ``scripts/check_doc_quotes.py``."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "check_doc_quotes.py"
_spec = importlib.util.spec_from_file_location("check_doc_quotes", SCRIPT)
check_doc_quotes = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_doc_quotes)


@pytest.mark.parametrize(
    "quoted",
    (
        '"View roll call →"',
        '"THINGS YOU CAN ASK"',
        '"Ask about bills or legislators by issue or name…"',
        '"Author: Patti Anderson · +42 co-authors"',
        '"4 recorded votes · data as of {date}"',
        "`#6f756f`",
        '"Overview · Full Text · Votes · Authors"',
        '`effort: "minimal"`',
    ),
)
def test_extracts_each_historical_drift_shape(quoted):
    candidates = check_doc_quotes.extract_candidates(f"The guide says {quoted}.\n")

    assert [candidate.value for candidate in candidates]


@pytest.mark.parametrize(
    "quoted",
    (
        '"browse the library"',
        '"what bills help teachers?"',
        "`school funding`",
        "`HF 2904`",
        '"HF 5"',
        '"1 VOTE"',
    ),
)
def test_ignores_examples_that_are_not_literal_code_claims(quoted):
    assert check_doc_quotes.extract_candidates(f"For example, {quoted}.\n") == []


def _write_opted_in_doc(root: Path, body: str) -> None:
    docs = root / "docs"
    docs.mkdir()
    (docs / "guide.md").write_text(
        f"<!-- describes: app.py -->\n<!-- check-quoted-code: true -->\n{body}",
        encoding="utf-8",
    )


def test_missing_quote_reports_doc_line_and_nearest_code_string(tmp_path):
    _write_opted_in_doc(tmp_path, 'The button says "View roll call →".\n')
    (tmp_path / "app.py").write_text(
        'BUTTON_LABEL = "Official record →"\n', encoding="utf-8"
    )

    problems = check_doc_quotes.find_problems(tmp_path)

    assert len(problems) == 1
    expected_path = Path("docs") / "guide.md"
    assert f"{expected_path}:3" in problems[0]
    assert "View roll call →" in problems[0]
    assert "Official record →" in problems[0]


def test_exact_match_passes(tmp_path):
    _write_opted_in_doc(tmp_path, 'The button says "Official record →".\n')
    (tmp_path / "app.py").write_text(
        'BUTTON_LABEL = "Official record →"\n', encoding="utf-8"
    )

    assert check_doc_quotes.find_problems(tmp_path) == []


def test_deliberate_historical_quote_has_a_reasoned_escape_hatch(tmp_path):
    _write_opted_in_doc(
        tmp_path,
        'The old button said "View roll call →".\n'
        "<!-- quote-check-ignore: View roll call → | historical label, kept for context -->\n",
    )
    (tmp_path / "app.py").write_text(
        'BUTTON_LABEL = "Official record →"\n', encoding="utf-8"
    )

    assert check_doc_quotes.find_problems(tmp_path) == []


def test_unreasoned_escape_fails(tmp_path):
    _write_opted_in_doc(
        tmp_path,
        'The old button said "View roll call →".\n'
        "<!-- quote-check-ignore: View roll call → -->\n",
    )
    (tmp_path / "app.py").write_text(
        'BUTTON_LABEL = "Official record →"\n', encoding="utf-8"
    )

    problems = check_doc_quotes.find_problems(tmp_path)

    assert any("needs a reason" in problem for problem in problems)


def test_non_opted_in_doc_is_ignored(tmp_path):
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "guide.md").write_text(
        '<!-- describes: app.py -->\nThe old button says "View roll call →".\n',
        encoding="utf-8",
    )
    (tmp_path / "app.py").write_text(
        'BUTTON_LABEL = "Official record →"\n', encoding="utf-8"
    )

    assert check_doc_quotes.find_problems(tmp_path) == []


def test_measurement_mode_includes_only_docs_with_declarations(tmp_path):
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "declared.md").write_text(
        '<!-- describes: app.py -->\nThe old button says "View roll call →".\n',
        encoding="utf-8",
    )
    (docs / "record.md").write_text(
        'A frozen record says "OLD DESIGN…".\n', encoding="utf-8"
    )
    (tmp_path / "app.py").write_text(
        'BUTTON_LABEL = "Official record →"\n', encoding="utf-8"
    )

    problems = check_doc_quotes.find_problems(tmp_path, include_all_declared=True)

    assert len(problems) == 1
    assert "declared.md" in problems[0]


def test_declared_glob_searches_every_matching_code_file(tmp_path):
    docs = tmp_path / "docs"
    code = tmp_path / "components"
    docs.mkdir()
    code.mkdir()
    (docs / "guide.md").write_text(
        "<!-- describes: components/*.tsx -->\n"
        "<!-- check-quoted-code: true -->\n"
        'The empty state says "NO RESULTS…".\n',
        encoding="utf-8",
    )
    (code / "One.tsx").write_text('const unrelated = "Other";\n', encoding="utf-8")
    (code / "Two.tsx").write_text('const message = "NO RESULTS…";\n', encoding="utf-8")

    assert check_doc_quotes.find_problems(tmp_path) == []


def test_real_opted_in_docs_are_current():
    assert check_doc_quotes.find_problems(check_doc_quotes.ROOT) == []


def test_existing_pull_request_job_runs_the_quote_check():
    workflow = (check_doc_quotes.ROOT / ".github/workflows/ci.yml").read_text(
        encoding="utf-8"
    )

    assert workflow.count("python scripts/check_doc_quotes.py") == 1


def test_launch_enables_exact_quote_check_for_one_guide():
    opted_in = []
    for doc in (check_doc_quotes.ROOT / "docs").rglob("*.md"):
        text = check_doc_quotes._without_fences(doc.read_text(encoding="utf-8"))
        if check_doc_quotes.OPT_IN.search(text):
            opted_in.append(str(doc.relative_to(check_doc_quotes.ROOT)))

    assert opted_in == ["docs/product-onboarding/search-bills-guide.md"]
