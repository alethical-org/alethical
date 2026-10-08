"""Documentation should record decisions without turning conversations into evidence."""

import importlib.util
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location(
    "check_timeless_docs", Path(__file__).parents[2] / "scripts/check_timeless_docs.py"
)
assert SPEC and SPEC.loader
checker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(checker)


@pytest.mark.parametrize(
    "text",
    [
        "Eugene requested a proposal.",
        "Angel wants to trace commissions.",
        "Approved by Eugene on 8 October 2026.",
        "A scoped decision (Eugene, Aug 25 2026).",
        "The maintainer instructed: “collect the sources first”.",
        "Then instructed: “collect the sources first”.",
    ],
)
def test_internal_attribution_and_chat_quotes_are_rejected(text):
    assert checker.line_findings("docs/implementation/example.md", text)
    assert checker.line_findings("docs/research/example.md", text)
    assert checker.line_findings(".claude/skills/example/SKILL.md", text)


@pytest.mark.parametrize(
    "text",
    [
        "Alethical collects source files before building the public feature.",
        "Publication remains on hold pending the maintainer's approval.",
        "Angel Zierden moderates the event.",
        "Eugene Lopin is a co-founder.",
        "The FCC said: “political files”.",
        "Use angel@alethical.com for the services contact.",
        "The button says “Save”.",
    ],
)
def test_source_quotes_factual_roles_and_fixed_words_are_preserved(text):
    assert not checker.line_findings("docs/implementation/example.md", text)


def test_history_escape_does_not_hide_personal_attribution():
    text = "Eugene decided this. <!-- timeless-check-ignore: dated evidence -->"
    assert checker.line_findings("docs/research/example.md", text)
    assert not checker.line_findings(
        "docs/research/example.md", "We previously used to work differently."
    )


def test_wrapped_quote_is_rejected(monkeypatch, capsys):
    monkeypatch.setattr(
        checker,
        "added_doc_lines",
        lambda _: [
            ("docs/example.md", 3, "The maintainer instructed:"),
            ("docs/example.md", 4, "“collect the sources first”."),
        ],
    )
    assert checker.main() == 1
    assert "quoted instruction" in capsys.readouterr().err


def test_separate_hunks_are_not_joined(monkeypatch):
    monkeypatch.setattr(
        checker,
        "added_doc_lines",
        lambda _: [
            ("docs/example.md", 3, "The maintainer instructed:"),
            ("docs/example.md", 10, "“Save” is the button label."),
        ],
    )
    assert checker.main() == 0
