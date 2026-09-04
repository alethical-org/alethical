"""Pin the reading and reporting rules in ``scripts/report_page_speed_by_address.py``.

Every case here is about a way the tool could print a wrong number rather than no
number, because a wrong page-speed figure is what would send someone optimizing
the wrong page. The Cloudflare request itself is not exercised: it needs a private
account token, and what a test can check without one is exactly the arithmetic and
the withholding rules.
"""

from __future__ import annotations

import importlib.util
import sys
from datetime import date
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "report_page_speed_by_address",
    Path(__file__).resolve().parents[2] / "scripts" / "report_page_speed_by_address.py",
)
assert SPEC and SPEC.loader
report = importlib.util.module_from_spec(SPEC)
# Registered before it runs because the module defines dataclasses, and
# ``dataclass`` looks its own module up in ``sys.modules`` while processing them.
sys.modules[SPEC.name] = report
SPEC.loader.exec_module(report)


def group(
    main_micros: object, main_samples: object, layout: object, layout_samples: object
) -> list:
    return [
        {
            "quantiles": {
                "largestContentfulPaintP75": main_micros,
                "cumulativeLayoutShiftP75": layout,
            },
            "sum": {"lcpTotal": main_samples, "clsTotal": layout_samples},
            "avg": {"sampleInterval": 1.5},
        }
    ]


ADDRESS = report.Address("money", "/money", 'requestPath: "/money"')


def test_microseconds_become_milliseconds() -> None:
    reading = report.read_group(ADDRESS, group(1_640_000, 60, 0.0876, 60), 50)
    assert reading.main_content_ms == 1640.0
    assert reading.layout_movement == 0.088
    assert reading.main_content_samples == 60


def test_minus_one_is_no_measurement_not_a_speed() -> None:
    """Cloudflare answers -1 where it measured nothing, and -1 ms is not a speed."""
    reading = report.read_group(ADDRESS, group(-1, 200, -1, 200), 50)
    assert reading.main_content_ms is None
    assert reading.layout_movement is None


def test_a_percentile_from_too_few_measurements_is_withheld() -> None:
    reading = report.read_group(ADDRESS, group(5_420_000, 49, 1, 49), 50)
    assert reading.main_content_ms is None
    assert reading.layout_movement is None
    assert reading.main_content_samples == 49


def test_each_metric_is_withheld_on_its_own_sample_count() -> None:
    """Layout movement and main content are counted separately by Cloudflare."""
    reading = report.read_group(ADDRESS, group(5_420_000, 160, 1, 10), 50)
    assert reading.main_content_ms == 5420.0
    assert reading.layout_movement is None


def test_an_empty_answer_reads_as_no_measurement() -> None:
    for answer in ([], None, {}, [{}]):
        reading = report.read_group(ADDRESS, answer, 50)
        assert reading.main_content_ms is None
        assert reading.layout_movement is None
        assert reading.main_content_samples == 0


def test_breaches_name_only_the_limits_actually_exceeded() -> None:
    over_both = report.read_group(ADDRESS, group(5_420_000, 200, 1, 200), 50)
    assert report.breaches(over_both) == ["main content", "layout movement"]

    fast_but_jumpy = report.read_group(ADDRESS, group(1_640_000, 200, 1, 200), 50)
    assert report.breaches(fast_but_jumpy) == ["layout movement"]

    within_both = report.read_group(ADDRESS, group(2_500_000, 200, 0.1, 200), 50)
    assert report.breaches(within_both) == []


def test_a_withheld_figure_never_counts_as_within_the_limit() -> None:
    """Silence is not a pass: nothing may report a limit met on no measurements."""
    withheld = report.read_group(ADDRESS, group(9_000_000, 3, 1, 3), 50)
    assert report.breaches(withheld) == []
    table = report.format_table([withheld], date(2026, 8, 8), date(2026, 9, 4), 50)
    assert "too few (3)" in table
    assert "9000" not in table


def test_the_table_says_the_window_the_percentile_and_both_limits() -> None:
    reading = report.read_group(ADDRESS, group(1_640_000, 60, 1, 60), 50)
    table = report.format_table([reading], date(2026, 8, 8), date(2026, 9, 4), 50)
    assert "2026-08-08 to 2026-09-04" in table
    assert "slowest 1 in 4" in table
    assert "2500 ms" in table
    assert "layout movement 0.1" in table


def test_the_request_asks_for_no_reader_facts() -> None:
    """A page address is the page. Country, device and browser are the person."""
    query = report.build_query(report.ADDRESSES)
    for word in (
        "country",
        "device",
        "browser",
        "element",
        "resource",
        "referer",
        "referrer",
    ):
        assert word not in query.lower()


def test_every_address_gets_its_own_selection_and_the_sitewide_one_no_filter() -> None:
    query = report.build_query(report.ADDRESSES)
    for address in report.ADDRESSES:
        assert f"{address.key}: rumWebVitalsEventsAdaptiveGroups(" in query
    assert 'requestPath_like: "/money/committees/%"' in query
    assert query.count("requestHost: $host") == len(report.ADDRESSES)


def test_the_money_addresses_the_release_limit_is_written_about_are_all_asked_for() -> (
    None
):
    labels = {address.label for address in report.ADDRESSES}
    assert {
        "/money",
        "/money/committees",
        "/money/races",
        "/money/outside-spending",
        "/money/search",
        "/money/committees/<committee>",
    } <= labels
