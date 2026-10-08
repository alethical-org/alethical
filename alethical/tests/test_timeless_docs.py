"""Documentation should record decisions without turning conversations into evidence."""

import importlib.util
import subprocess
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
        "User authorization: “build all”.",
        "Approval: “bd approved”.",
        "Approved by Eugene on 8 October 2026.",
        "A scoped decision (Eugene, Aug 25 2026).",
        "The maintainer instructed: “collect the sources first”.",
        "Then instructed: “collect the sources first”.",
    ],
)
def test_internal_attribution_and_chat_quotes_are_rejected(text):
    assert checker.line_findings("docs/implementation/fcc-political-files.md", text)
    assert checker.line_findings(
        "docs/research/retrieval/retrieval-strategy-research.md", text
    )
    assert checker.line_findings(".claude/skills/design-review/SKILL.md", text)


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
        "Request: `POST /api/v1/search`",
    ],
)
def test_source_quotes_factual_roles_and_fixed_words_are_preserved(text):
    assert not checker.line_findings("docs/implementation/fcc-political-files.md", text)


def test_history_escape_does_not_hide_personal_attribution():
    text = "Eugene decided this. <!-- timeless-check-ignore: dated evidence -->"
    assert checker.line_findings(
        "docs/research/retrieval/retrieval-strategy-research.md", text
    )
    assert not checker.line_findings(
        "docs/research/retrieval/retrieval-strategy-research.md",
        "We previously used to work differently.",
    )


def test_wrapped_quote_is_rejected(monkeypatch, capsys):
    monkeypatch.setattr(
        checker,
        "added_doc_lines",
        lambda _: [
            ("docs/README.md", 3, "The maintainer instructed:"),
            ("docs/README.md", 4, "“collect the sources first”."),
        ],
    )
    assert checker.main() == 1
    assert "quoted instruction" in capsys.readouterr().err


def test_separate_hunks_are_not_joined(monkeypatch):
    monkeypatch.setattr(
        checker,
        "added_doc_lines",
        lambda _: [
            ("docs/README.md", 3, "The maintainer instructed:"),
            ("docs/README.md", 10, "“Save” is the button label."),
        ],
    )
    assert checker.main() == 0


def test_public_source_quote_requires_explicit_source_marker():
    quote = "Angel said: “Welcome”, in the public event transcript."
    assert checker.line_findings("docs/README.md", quote)
    assert not checker.line_findings(
        "docs/README.md",
        quote + " <!-- doc-voice-source: https://example.org/transcript -->",
    )
    assert checker.line_findings(
        "docs/README.md", quote + " <!-- doc-voice-source: trust me -->"
    )


def test_real_git_diff_checks_added_markdown_including_skill_files(
    tmp_path, monkeypatch
):
    monkeypatch.chdir(tmp_path)

    def git(*args):
        return subprocess.run(
            ["git", *args], check=True, capture_output=True, text=True
        )

    git("init", "-q")
    git("config", "user.email", "test@example.org")
    git("config", "user.name", "Test author")
    p = tmp_path / "docs" / "README.md"
    p.parent.mkdir()
    p.write_text("Eugene requested an older change.\n")
    git("add", ".")
    git("commit", "-qm", "Base")
    git("branch", "base")
    p.write_text(p.read_text() + "Approval: “build all”.\n")
    skill = tmp_path / ".claude" / "skills" / "example.md"
    skill.parent.mkdir(parents=True)
    skill.write_text("The maintainer instructed:\n“collect sources first”.\n")
    git("add", ".")
    git("commit", "-qm", "Added documentation")
    lines = checker.added_doc_lines("base")
    assert ("docs/README.md", 2, "Approval: “build all”.") in lines
    assert not any("older change" in line for _, _, line in lines)
    assert len(lines) == 3
    monkeypatch.setenv("TIMELESS_BASE_REF", "base")
    assert checker.main() == 1
