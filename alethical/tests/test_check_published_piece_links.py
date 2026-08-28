"""Tests for the published-piece link check in ``scripts/check_published_piece_links.py``.

The check exists because every soft failure this repository has measured against
``cfb.mn.gov`` answers HTTP 200 (``docs/architecture/campaign-finance-system-design.md``
§2.1 and §2.2), so a status-code checker passes a dead link. These tests pin the
distinction the check turns on: an error page that answers 200 must fail, and a
host that cannot be reached must not.
"""

from __future__ import annotations

import importlib.util
import urllib.error
from pathlib import Path

SCRIPT = (
    Path(__file__).resolve().parents[2] / "scripts" / "check_published_piece_links.py"
)
_spec = importlib.util.spec_from_file_location("check_published_piece_links", SCRIPT)
links = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(links)

# The real page cfb.mn.gov served for the dead lobbying viewer on 27 Aug 2026,
# reduced to the parts the check reads. Its status was 200.
DEAD_PAGE = """
<html><head><title>Campaign Finance Disclosure Board</title></head>
<body><h1>Self Help</h1><h1>Viewers</h1><h1>This page is not available</h1></body></html>
"""

LIVE_PAGE = """
<html><head><title>Current lists : Campaign Finance Board</title></head>
<body><h1>Current lists</h1><p>Historical spending by principals.</p></body></html>
"""


def test_reads_the_error_wording_out_of_a_page_that_answered_200():
    assert links.page_says_it_is_missing(DEAD_PAGE) == "This page is not available"


def test_leaves_a_real_page_alone():
    assert links.page_says_it_is_missing(LIVE_PAGE) is None


def test_does_not_fire_on_the_phrase_buried_in_ordinary_body_text():
    """Only a heading or the title counts, so a help article cannot fail a run."""
    page = (
        "<html><head><title>Help</title></head><body><p>If this page is not available, "
    )
    page += "try the search tool.</p></body></html>"

    assert links.page_says_it_is_missing(page) is None


def test_an_error_page_answering_200_is_a_failure(monkeypatch):
    monkeypatch.setattr(links, "fetch", lambda url, timeout: (200, DEAD_PAGE.encode()))
    failures: list[str] = []
    skipped: list[str] = []

    links.check_outward_link("https://cfb.mn.gov/gone/", 5, failures, skipped)

    assert len(failures) == 1
    assert "This page is not available" in failures[0]
    assert skipped == []


def test_a_healthy_page_is_neither_failed_nor_skipped(monkeypatch):
    monkeypatch.setattr(links, "fetch", lambda url, timeout: (200, LIVE_PAGE.encode()))
    failures: list[str] = []
    skipped: list[str] = []

    links.check_outward_link("https://cfb.mn.gov/current-lists/", 5, failures, skipped)

    assert failures == []
    assert skipped == []


def test_a_404_is_a_failure(monkeypatch):
    def gone(url, timeout):
        raise urllib.error.HTTPError(url, 404, "Not Found", {}, None)

    monkeypatch.setattr(links, "fetch", gone)
    failures: list[str] = []
    skipped: list[str] = []

    links.check_outward_link("https://cfb.mn.gov/missing/", 5, failures, skipped)

    assert len(failures) == 1
    assert "404" in failures[0]


def test_an_unreachable_host_is_skipped_rather_than_failed(monkeypatch):
    """The Board having a bad minute is not our link being wrong."""

    def unreachable(url, timeout):
        raise urllib.error.URLError("connection refused")

    monkeypatch.setattr(links, "fetch", unreachable)
    failures: list[str] = []
    skipped: list[str] = []

    links.check_outward_link("https://cfb.mn.gov/anything/", 5, failures, skipped)

    assert failures == []
    assert len(skipped) == 1


def test_a_server_error_is_skipped_rather_than_failed(monkeypatch):
    def broken(url, timeout):
        raise urllib.error.HTTPError(url, 503, "Service Unavailable", {}, None)

    monkeypatch.setattr(links, "fetch", broken)
    failures: list[str] = []
    skipped: list[str] = []

    links.check_outward_link("https://cfb.mn.gov/anything/", 5, failures, skipped)

    assert failures == []
    assert len(skipped) == 1


def test_a_pdf_is_passed_on_reaching_it(monkeypatch):
    """A PDF cannot carry an HTML error page, so decoding one would prove nothing."""
    monkeypatch.setattr(links, "fetch", lambda url, timeout: (200, b"%PDF-1.7\nbinary"))
    failures: list[str] = []
    skipped: list[str] = []

    links.check_outward_link("https://cfb.mn.gov/handbook.pdf", 5, failures, skipped)

    assert failures == []


def test_every_published_piece_still_yields_links():
    """The check covering nothing is the failure a green run would otherwise hide."""
    files = links.piece_files()

    assert files, "no published pieces found"
    for path in files:
        assert links.links_in(path), f"{path.name} yielded no links"


def test_every_internal_link_resolves_to_a_published_slug():
    files = links.piece_files()
    slugs = links.published_slugs(files)

    internal = [
        (path.name, url)
        for path in files
        for url in links.links_in(path)
        if url.startswith("/")
    ]

    assert internal, "expected the guides to cross-link each other"
    for name, url in internal:
        assert url.rstrip("/").rsplit("/", 1)[-1] in slugs, f"{name} links to {url}"
