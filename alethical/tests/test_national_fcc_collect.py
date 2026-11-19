from __future__ import annotations

from pathlib import Path

import pytest

from scripts import national_fcc_collect as collect

GAP = collect.CONFIRM_GAP_SECONDS


def outcome(o, t, **extra):
    return {"k": "TV|1|f", "o": o, "t": t, **extra}


def test_a_saved_pdf_settles_the_filing_even_after_earlier_refusals():
    state = collect.latest_state(
        [outcome("missing", 0), outcome("saved", 10, sha="a" * 64, b=5, p=1)]
    )["TV|1|f"]
    assert collect.settled(state) == "saved"


def test_one_refusal_never_confirms_a_filing_unavailable():
    state = collect.latest_state([outcome("missing", 0, h=401)])["TV|1|f"]
    assert collect.settled(state) is None
    assert not collect.due(state, GAP - 1)
    assert collect.due(state, GAP)


def test_two_refusals_must_be_far_enough_apart():
    close = collect.latest_state([outcome("missing", 0), outcome("missing", GAP - 1)])
    assert collect.settled(close["TV|1|f"]) is None
    apart = collect.latest_state([outcome("missing", 0), outcome("unreadable", GAP)])
    assert collect.settled(apart["TV|1|f"]) == "unavailable"


def test_temporary_failures_prove_nothing_and_are_retried_with_backoff():
    rows = [outcome("retry", 0, err="HTTP 503") for _ in range(20)]
    state = collect.latest_state(rows)["TV|1|f"]
    assert collect.settled(state) is None
    assert state["verdicts"] == []
    assert not collect.due(state, 60)
    assert collect.due(state, 6 * 3600)


def test_pdf_check_rejects_html_and_counts_pages(tmp_path: Path):
    from pypdf import PdfWriter

    html = tmp_path / "error.part"
    html.write_bytes(b"<html>Not found</html>")
    with pytest.raises(ValueError):
        collect.pdf_pages(html)
    pdf = tmp_path / "ok.part"
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    writer.add_blank_page(width=72, height=72)
    with pdf.open("wb") as out:
        writer.write(out)
    assert collect.pdf_pages(pdf) == 2


def test_run_ids_cannot_escape_the_recovery_folder():
    assert collect.run_prefix("census-20261119").endswith("/recovery/census-20261119")
    with pytest.raises(ValueError):
        collect.run_prefix("../originals")


def test_compressed_outcome_files_round_trip():
    rows = [outcome("saved", 1, sha="b" * 64, b=9, p=3), outcome("retry", 2)]
    assert list(collect.read_gz_lines(collect.gz_lines(rows))) == rows
