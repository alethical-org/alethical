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
    close = collect.latest_state(
        [outcome("missing", 0, h=404), outcome("missing", GAP - 1, h=404)]
    )
    assert collect.settled(close["TV|1|f"]) is None
    apart = collect.latest_state(
        [outcome("missing", 0, h=404), outcome("unreadable", GAP, h=200, v=2)]
    )
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


# ---------------------------------------------------------------- source answers

MANAGER = "0e069b78-34f1-2c57-5a3f-340160a7ea54"
ALTERNATE = "1e069b78-34f1-2c57-5a3f-340160a7ea55"


def pdf_bytes(pages=1):
    import io

    from pypdf import PdfWriter

    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=72, height=72)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


class FakeStore:
    def __init__(self):
        self.saved = []

    def save_pdf(self, path, sha, size):
        assert path.read_bytes()[:5] == b"%PDF-"
        self.saved.append((sha, size))


def run_check(tmp_path, routes, monkeypatch, limit=collect.MAX_FILE_BYTES):
    import httpx

    monkeypatch.setattr(collect.Pace, "wait", lambda self: None)
    seen = []

    def handler(request):
        seen.append(str(request.url))
        for prefix, answer in routes.items():
            if str(request.url).startswith(prefix):
                return answer() if callable(answer) else answer
        return httpx.Response(599)

    store = FakeStore()
    row = {"k": "TV|1|file-1", "m": MANAGER, "f": "file-1", "e": "1"}
    with httpx.Client(transport=httpx.MockTransport(handler)) as http:
        result = collect.check(row, http, collect.Pace(8, 8), store, tmp_path, limit)
    return result, store, seen


def download_url(manager):
    return collect.DOWNLOAD.format(manager=manager)


DETAIL = "https://publicfiles.fcc.gov/api/manager/file/id/file-1.json"


def test_refusal_with_no_other_address_is_a_missing_candidate(tmp_path, monkeypatch):
    import httpx

    result, store, seen = run_check(
        tmp_path,
        {
            download_url(MANAGER): httpx.Response(401),
            DETAIL: httpx.Response(400, json={"statusMessage": "Invalid File ID"}),
        },
        monkeypatch,
    )
    assert (result["o"], result["h"], result["v"]) == ("missing", 401, 2)
    assert store.saved == [] and len(seen) == 2


def test_unreadable_bytes_try_the_fcc_file_record_before_any_verdict(
    tmp_path, monkeypatch
):
    import httpx

    good = pdf_bytes(3)
    result, store, _ = run_check(
        tmp_path,
        {
            download_url(MANAGER): httpx.Response(200, content=b"%PDF-1.4 broken"),
            DETAIL: httpx.Response(
                200, json={"file": {"file_id": "file-1", "file_manager_id": ALTERNATE}}
            ),
            download_url(ALTERNATE): httpx.Response(200, content=good),
        },
        monkeypatch,
    )
    assert (result["o"], result["p"], result["mg"]) == ("saved", 3, ALTERNATE)
    assert store.saved == [(result["sha"], len(good))]


def test_unreadable_without_an_alternate_is_marked_with_this_version(
    tmp_path, monkeypatch
):
    import httpx

    result, _, _ = run_check(
        tmp_path,
        {
            download_url(MANAGER): httpx.Response(200, content=b"not a pdf at all"),
            DETAIL: httpx.Response(
                200, json={"file": {"file_id": "file-1", "file_manager_id": MANAGER}}
            ),
        },
        monkeypatch,
    )
    assert (result["o"], result["v"]) == ("unreadable", 2)


@pytest.mark.parametrize(
    "answer, reason",
    [
        (
            {
                "status_code": 200,
                "headers": {"content-type": "text/html"},
                "content": b"<html>Please verify you are human</html>",
            },
            "web page",
        ),
        ({"status_code": 400}, "unexpected HTTP 400"),
        (
            {
                "status_code": 403,
                "headers": {"content-type": "text/html"},
                "content": b"<html>Forbidden</html>",
            },
            "unexpected HTTP 403",
        ),
        (
            {"status_code": 302, "headers": {"location": "https://example.com/x"}},
            "redirect away",
        ),
        ({"status_code": 502}, "HTTP 502"),
        (
            {
                "status_code": 200,
                "headers": {"content-length": "999"},
                "content": b"%PDF-short",
            },
            "ended early",
        ),
    ],
)
def test_answers_that_say_nothing_about_the_filing_are_retried(
    tmp_path, monkeypatch, answer, reason
):
    import httpx

    result, _, _ = run_check(
        tmp_path, {download_url(MANAGER): httpx.Response(**answer)}, monkeypatch
    )
    assert result["o"] == "retry" and reason in result["err"]


def test_large_files_go_to_their_own_lane_and_never_count_as_refusals(
    tmp_path, monkeypatch
):
    import httpx

    result, _, _ = run_check(
        tmp_path,
        {
            download_url(MANAGER): httpx.Response(
                200, headers={"content-length": "4096"}, content=b"x" * 4096
            )
        },
        monkeypatch,
        limit=10,
    )
    assert (result["o"], result["b"]) == ("oversize", 4096)
    state = collect.latest_state([result])["TV|1|file-1"]
    assert collect.settled(state) is None and state["verdicts"] == []
    assert not collect.due(state, 10**10) and collect.due(state, 0, oversize_lane=True)


def test_outcomes_from_the_first_version_are_rechecked_not_confirmed():
    old = [
        outcome("unreadable", 0, h=200),
        outcome("unreadable", GAP, h=200),
        outcome("missing", 2 * GAP, h="redirect-away"),
    ]
    state = collect.latest_state(old)["TV|1|f"]
    assert state["verdicts"] == [] and collect.settled(state) is None
    assert collect.due(state, 3 * GAP)
    replayed = collect.latest_state(old + old)["TV|1|f"]
    assert replayed["verdicts"] == []
