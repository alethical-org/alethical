"""Pin the reading and reporting rules in ``scripts/report_page_speed_by_address.py``.

Every case here is about a way the tool could print a wrong number rather than no
number, because a wrong page-speed figure is what would send someone optimizing the
wrong page. The Cloudflare request itself is not exercised: it needs a private account
token, and what a test can check without one is exactly the arithmetic and the
withholding rules.

Two of these cases exist because the first version of this tool got them wrong, and both
failures printed a confident number rather than an error:

* it treated Cloudflare's reported totals as measurement counts, when they are those
  counts multiplied by the sampling interval, so a 50-measurement floor let through a
  percentile resting on 4 real measurements; and
* it mixed first loads with clicks inside the site in one percentile, so an address
  people mostly click into scored as though it were instant.
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

ADDRESS = report.Address("money", "/money", 'requestPath: "/money"')


def group(
    main_micros: object,
    main_reported: object,
    layout: object,
    layout_reported: object,
    interval: object = 1,
) -> list:
    """One address's answer, in the shape Cloudflare returns it.

    ``*_reported`` are Cloudflare's own totals, which are already multiplied by
    ``interval``, exactly as the live API returns them.
    """
    return [
        {
            "quantiles": {
                "largestContentfulPaintP75": main_micros,
                "cumulativeLayoutShiftP75": layout,
            },
            "sum": {"lcpTotal": main_reported, "clsTotal": layout_reported},
            "avg": {"sampleInterval": interval},
        }
    ]


def reading(*args, min_measurements: int = 50, **kwargs):
    return report.read_group(
        ADDRESS, report.FIRST_LOAD, group(*args, **kwargs), min_measurements
    )


def test_microseconds_become_milliseconds() -> None:
    result = reading(1_640_000, 60, 0.0876, 60)
    assert result.main_content_ms == 1640.0
    assert result.layout_movement == 0.088
    assert result.main_content_measurements == 60


def test_a_sampled_window_reports_real_measurements_not_cloudflares_estimate() -> None:
    """The failure that made a first version's figures unreconcilable.

    Cloudflare reported 60 with a sampling interval of 15, which is 4 real
    measurements. A floor of 50 must withhold the figure rather than let a
    percentile drawn from 4 readings through as a number.
    """
    result = reading(48_000, 60, 0.006, 60, interval=15)
    assert result.main_content_measurements == 4
    assert result.main_content_ms is None
    assert result.layout_movement is None


def test_an_unsampled_window_leaves_the_count_alone() -> None:
    result = reading(4_300_000, 365, 1, 365, interval=1.01)
    assert result.main_content_measurements == 361
    assert result.main_content_ms == 4300.0


def test_a_missing_interval_never_invents_measurements() -> None:
    """No interval means no group came back, so the total is taken as it stands."""
    result = reading(1_000_000, 80, 0.5, 80, interval=None)
    assert result.sample_interval == 1.0
    assert result.main_content_measurements == 80


def test_minus_one_is_no_measurement_not_a_speed() -> None:
    """Cloudflare answers -1 where it measured nothing, and -1 ms is not a speed."""
    result = reading(-1, 200, -1, 200)
    assert result.main_content_ms is None
    assert result.layout_movement is None


def test_a_percentile_from_too_few_measurements_is_withheld() -> None:
    result = reading(5_420_000, 49, 1, 49)
    assert result.main_content_ms is None
    assert result.layout_movement is None
    assert result.main_content_measurements == 49


def test_each_metric_is_withheld_on_its_own_count() -> None:
    """Layout movement and main content are counted separately by Cloudflare."""
    result = reading(5_420_000, 160, 1, 10)
    assert result.main_content_ms == 5420.0
    assert result.layout_movement is None


def test_an_empty_answer_reads_as_no_measurement() -> None:
    for answer in ([], None, {}, [{}]):
        result = report.read_group(ADDRESS, report.FIRST_LOAD, answer, 50)
        assert result.main_content_ms is None
        assert result.layout_movement is None
        assert result.main_content_measurements == 0


def test_breaches_name_only_the_limits_actually_exceeded() -> None:
    assert report.breaches(reading(5_420_000, 200, 1, 200)) == [
        "main content",
        "layout movement",
    ]
    assert report.breaches(reading(1_640_000, 200, 1, 200)) == ["layout movement"]
    assert report.breaches(reading(2_500_000, 200, 0.1, 200)) == []


def test_a_withheld_figure_never_counts_as_within_the_limit() -> None:
    """Silence is not a pass: nothing may report a limit met on no measurements."""
    withheld = reading(9_000_000, 3, 1, 3)
    assert report.breaches(withheld) == []
    table = report.format_table(
        [withheld], date(2026, 8, 29), date(2026, 9, 4), 50, "FIRST LOAD"
    )
    assert "too few (3)" in table
    assert "9000" not in table


def test_the_report_separates_first_loads_from_clicks_inside_the_site() -> None:
    """A percentile over both at once is not a percentile of anything a reader does."""
    first = report.read_group(
        ADDRESS, report.FIRST_LOAD, group(1_536_000, 115, 1, 115), 50
    )
    clicked = report.read_group(
        ADDRESS, report.IN_APP_CLICK, group(58_000, 65, 0.006, 65), 50
    )
    text = report.format_report(
        [first], [clicked], date(2026, 8, 29), date(2026, 9, 4), 50
    )
    assert "FIRST LOAD" in text
    assert "CLICKED INSIDE THE SITE" in text
    assert "1536 ms" in text
    assert "58 ms" in text
    assert "only the first block is judged" in text


def test_the_report_says_the_window_the_percentile_and_both_limits() -> None:
    text = report.format_report(
        [reading(1_640_000, 60, 1, 60)],
        [],
        date(2026, 8, 29),
        date(2026, 9, 4),
        50,
    )
    assert "2026-08-29 to 2026-09-04" in text
    assert "slowest 1 in 4" in text
    assert "2500 ms" in text
    assert "movement 0.1" in text


def test_the_table_names_the_sampling_only_when_the_window_was_sampled() -> None:
    sampled = reading(600, 600, 1, 600, interval=10.13)
    unsampled = reading(600, 600, 1, 600, interval=1)
    assert "Cloudflare sampled this window" in report.format_table(
        [sampled], date(2026, 8, 8), date(2026, 9, 4), 50, "FIRST LOAD"
    )
    assert "Cloudflare sampled this window" not in report.format_table(
        [unsampled], date(2026, 8, 29), date(2026, 9, 4), 50, "FIRST LOAD"
    )


def test_the_request_asks_for_one_kind_of_page_load_and_no_reader_facts() -> None:
    """A page address is the page. Country, device and browser are the person."""
    query = report.build_query(report.ADDRESSES, report.FIRST_LOAD)
    assert 'navigationType: "navigate"' in query
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


def test_every_address_gets_its_own_selection_and_the_sitewide_one_no_path() -> None:
    query = report.build_query(report.ADDRESSES, report.FIRST_LOAD)
    for address in report.ADDRESSES:
        assert f"{address.key}: rumWebVitalsEventsAdaptiveGroups(" in query
    assert 'requestPath_like: "/money/committees/%"' in query
    assert query.count("requestHost: $host") == len(report.ADDRESSES)
    assert query.count('navigationType: "navigate"') == len(report.ADDRESSES)


def test_the_money_addresses_the_limit_is_written_about_are_all_asked_for() -> None:
    labels = {address.label for address in report.ADDRESSES}
    assert {
        "/money",
        "/money/committees",
        "/money/races",
        "/money/outside-spending",
        "/money/search",
        "/money/committees/<committee>",
    } <= labels
