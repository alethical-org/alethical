"""Source-shaped speed-report tests, without network, database or reader tracking."""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from datetime import UTC, date, datetime, timedelta, timezone
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location(
    "report_page_speed_by_address",
    Path(__file__).resolve().parents[2] / "scripts" / "report_page_speed_by_address.py",
)
assert SPEC and SPEC.loader
report = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = report
SPEC.loader.exec_module(report)
ADDRESS = report.Address("money", "/money", 'requestPath: "/money"')


def group(main_micros=1_640_000, main_count=60, layout=0.0876, layout_count=60):
    return [
        {
            "quantiles": {
                "largestContentfulPaintP75": main_micros,
                "cumulativeLayoutShiftP75": layout,
            },
            "confidence": {
                "sum": {
                    "lcpTotal": {"sampleSize": main_count},
                    "clsTotal": {"sampleSize": layout_count},
                }
            },
            # Decoys prove neither scaled totals nor average intervals determine counts.
            "sum": {"lcpTotal": 9000, "clsTotal": 9000},
            "avg": {"sampleInterval": 10},
        }
    ]


def reading(*args, min_measurements=50):
    return report.read_group(ADDRESS, group(*args), min_measurements)


def entry(result, separated=None):
    """One address's pair of readings. None means the window cannot be separated."""
    return report.AddressReadings(
        address=ADDRESS, every_client=result, separated=separated
    )


def group_with_bands(*, needs_improvement, poor, total):
    """One element row carrying Cloudflare's movement bands as actual observations.

    The decoy adaptive sums are here for the same reason they are in ``group``: to
    prove no count is ever reconstructed from an estimate.
    """
    return {
        "dimensions": {"cumulativeLayoutShiftElement": "#root>div.page-snapshot"},
        "quantiles": {"cumulativeLayoutShiftP75": 1},
        "confidence": {
            "sum": {
                "clsTotal": {"sampleSize": total},
                "clsNeedsImprovement": {"sampleSize": needs_improvement},
                "clsPoor": {"sampleSize": poor},
            }
        },
        "sum": {"clsTotal": 9000, "clsNeedsImprovement": 9000, "clsPoor": 9000},
        "avg": {"sampleInterval": 10},
    }


def test_confidence_sample_counts_override_scaled_sums():
    result = reading(2_000_000, 49, 0.1, 50)
    assert result.main_content_measurements == 49
    assert result.main_content_ms is None
    assert result.layout_movement_measurements == 50
    assert result.layout_movement == 0.1


def test_units_preserve_source_precision():
    result = reading()
    assert result.main_content_ms == 1640
    assert result.layout_movement == 0.0876
    assert result.main_content_measurements == 60


@pytest.mark.parametrize("count", [0, 1, 49, 50, 365, 1045])
def test_observation_floor_per_metric(count):
    result = reading(5_420_000, count, 1, 50)
    assert result.main_content_measurements == count
    assert result.main_content_ms == (5420 if count >= 50 else None)
    assert result.layout_movement == 1


@pytest.mark.parametrize(
    "count",
    [
        None,
        True,
        False,
        "50",
        -1,
        49.9,
        float("nan"),
        float("inf"),
        2**53,
        10**400,
        {},
        [],
    ],
)
def test_invalid_counts_are_unknown_never_zero_or_estimates(count):
    result = reading(5_420_000, count, 1, 50)
    assert result.main_content_measurements is None
    assert result.main_content_ms is None
    assert result.layout_movement_measurements == 50
    assert result.layout_movement == 1


@pytest.mark.parametrize("answer", [[], None, {}, [{}], [{}, {}], [{"confidence": []}]])
def test_missing_or_ambiguous_groups_are_unavailable(answer):
    result = report.read_group(ADDRESS, answer)
    assert result.main_content_ms is None
    assert result.layout_movement is None
    assert result.main_content_measurements is None


@pytest.mark.parametrize(
    "value", [-1, -0.1, None, True, "0.1", float("nan"), float("inf")]
)
def test_invalid_quantiles_are_not_scores(value):
    result = reading(value, 60, value, 60)
    assert result.main_content_ms is None
    assert result.layout_movement is None
    assert result.main_content_measurements == 60


def test_true_zero_quantiles_are_preserved():
    result = reading(0, 50, 0, 50)
    assert result.main_content_ms == 0
    assert result.layout_movement == 0


def test_floor_cannot_be_lowered_and_can_be_raised():
    assert reading(1_000_000, 49, 0.1, 49, min_measurements=1).main_content_ms is None
    assert reading(1_000_000, 50, 0.1, 50, min_measurements=100).main_content_ms is None


def test_limit_boundary_and_independent_breaches():
    assert report.breaches(reading(2_500_000, 50, 0.1, 50)) == []
    assert report.breaches(reading(5_420_000, 50, 1, 50)) == [
        "main content",
        "layout movement",
    ]
    assert report.breaches(reading(5_420_000, 50, 1, 2)) == ["main content"]


def test_unknown_sibling_cannot_print_a_full_pass():
    table = report.format_table(
        [entry(reading(1_000_000, 50, 0.1, None))],
        date(2026, 8, 8),
        date(2026, 9, 6),
        50,
        "DOCUMENT LOADS",
    )
    assert "unavailable" in table
    assert "not known yet" in table
    assert "50 / unavailable" in table


def test_withheld_score_does_not_print_or_pass():
    table = report.format_table(
        [entry(reading(9_000_000, 3, 1, 3))],
        date(2026, 8, 8),
        date(2026, 9, 6),
        50,
        "DOCUMENT LOADS",
    )
    assert "too few (3)" in table
    assert "9000" not in table
    assert "not known yet" in table


@pytest.mark.parametrize("builder", [report.build_query, report.build_what_moved_query])
@pytest.mark.parametrize("separate", [False, True])
def test_queries_match_public_document_population_and_actual_counts(builder, separate):
    query = builder(report.ADDRESSES, separate_automated_clients=separate)
    groups = len(report.ADDRESSES) * (2 if separate else 1)
    for navigation in report.DOCUMENT_NAVIGATION_TYPES:
        assert json.dumps(navigation) in query
    assert query.count("navigationType_in:") == groups
    assert query.count("bot: 0") == groups
    assert "confidence(level: 0.95)" in query
    assert "clsTotal { sampleSize }" in query
    assert "sampleInterval" not in query
    # Cloudflare's Poor band starts above 0.25 and our limit is 0.1, so that band is
    # never read on its own. It may only appear beside the Needs Improvement band
    # (above 0.1 up to 0.25), which is what makes the pair equal our own limit.
    assert ("clsPoor" in query) == ("clsNeedsImprovement" in query)
    assert "routing-apis" not in query
    assert "soft-navigation" not in query
    assert "deliveryType" not in query
    for word in ("country", "device", "resource", "referer", "referrer"):
        assert word not in query.lower()
    for address in report.ADDRESSES:
        assert f"{address.key}: rumWebVitalsEventsAdaptiveGroups(" in query
        assert (
            f"{report.separated_key(address)}: rumWebVitalsEventsAdaptiveGroups("
            in query
        ) is separate
    assert 'requestPath_like: "/money/committees/%"' in query
    assert query.count("requestHost: $host") == groups


@pytest.mark.parametrize("builder", [report.build_query, report.build_what_moved_query])
def test_browser_is_only_ever_a_filter_never_something_asked_about(builder):
    """The 2 words naming a browser may separate the pool and nothing else.

    Cloudflare would hand over a breakdown of readers by browser for the asking.
    This report never asks: the only mentions are the not-equal and not-in clauses
    that take the automated client pool out, so no reader is ever grouped, counted
    or printed by what they browse with.
    """
    query = builder(report.ADDRESSES, separate_automated_clients=True)
    mentions = query.lower().count("browser")
    clauses = len(report.AUTOMATED_CLIENT_POOL) * 2 * len(report.ADDRESSES)
    assert mentions == clauses
    assert "userAgentBrowser_neq:" in query
    assert "browserVersion_notin:" in query
    assert "browserVersion }" not in query
    assert "userAgentBrowser }" not in query
    assert (
        builder(report.ADDRESSES, separate_automated_clients=False)
        .lower()
        .count("browser")
        == 0
    )


def test_main_query_never_requests_element_and_element_query_does():
    assert "lcpTotal { sampleSize }" in report.build_query(report.ADDRESSES)
    assert "element" not in report.build_query(report.ADDRESSES).lower()
    query = report.build_what_moved_query(report.ADDRESSES)
    assert "cumulativeLayoutShiftElement" in query
    assert "orderBy: [sum_clsTotal_DESC]" in query


def test_what_moved_uses_actual_counts_and_withholds_thin_scores():
    rows = [group(layout=1, layout_count=49)[0], group(layout=0, layout_count=50)[0]]
    rows[0]["dimensions"] = {"cumulativeLayoutShiftElement": "#root>div.page-snapshot"}
    rows[0]["sum"]["clsPoor"] = 3000
    rows[1]["dimensions"] = {"cumulativeLayoutShiftElement": None}
    text = report.format_what_moved(
        [(ADDRESS, rows)], date(2026, 8, 8), date(2026, 9, 6)
    )
    assert (
        "49 measurements, count unknown over 0.1, 75th percentile too few (49)" in text
    )
    assert "50 measurements, count unknown over 0.1, 75th percentile 0" in text
    # Never Cloudflare's Poor band on its own. That band starts above 0.25 while our
    # limit is 0.1, so counting it alone passed every visit in between.
    assert "of them over the limit" not in text
    assert "3000" not in text
    assert "estimated measurement volume, not movement size" in text
    assert "#root>div.page-snapshot" in text
    assert "nothing moved" in text


def test_what_moved_unknown_counts_and_empty_address():
    text = report.format_what_moved(
        [(ADDRESS, [group(layout_count=None)[0]])], date(2026, 8, 8), date(2026, 9, 6)
    )
    assert (
        "unavailable measurements, count unknown over 0.1,"
        " 75th percentile unavailable" in text
    )
    assert "nothing measured" in report.format_what_moved(
        [(ADDRESS, [])], date(2026, 8, 8), date(2026, 9, 6)
    )


def test_default_window_is_30_complete_utc_days():
    start, end = report.complete_window(now=datetime(2026, 9, 7, 23, 50, tzinfo=UTC))
    assert (start, end) == (date(2026, 8, 8), date(2026, 9, 6))
    assert (end - start).days + 1 == 30


def test_window_uses_utc_not_local_date_and_supports_explicit_short_window():
    now = datetime(2026, 9, 7, 23, 50, tzinfo=timezone(timedelta(hours=-4)))
    assert report.complete_window(7, now=now) == (date(2026, 9, 1), date(2026, 9, 7))


def test_rollout_caveat_depends_on_start_not_current_date():
    assert "cannot isolate" in report.population_note(date(2026, 9, 3))
    assert "cannot isolate" not in report.population_note(date(2026, 9, 4))


def test_report_and_json_disclose_scope_and_actual_counts():
    values = [entry(reading())]
    text = report.format_report(values, date(2026, 8, 8), date(2026, 9, 6), 50)
    assert "DOCUMENT LOADS" in text
    assert "2026-08-08 to 2026-09-06" in text
    assert "2500 ms" in text and "movement 0.1" in text
    assert "confidence sample sizes" in text
    assert "not an app-ready timer" in text
    assert "cannot isolate" in text
    payload = json.loads(report.as_json(values, date(2026, 8, 8), date(2026, 9, 6)))
    assert payload["measurementScope"] == "document-loads-and-clicks"
    assert payload["sampleCountSource"] == "cloudflare-confidence"
    assert payload["knownBotsExcluded"] is True
    assert payload["minimumSamples"] == 50
    assert payload["navigationTypes"] == list(report.DOCUMENT_NAVIGATION_TYPES)
    assert payload["documentLoads"][0]["mainContentMeasurements"] == 60
    assert "sampleInterval" not in payload["documentLoads"][0]
    assert "firstLoad" not in payload


AFTER_THE_PHANTOMS = report.PHANTOM_CLICK_RECORDS_ENDED_ON + timedelta(days=1)


def test_a_click_figure_is_withheld_for_any_window_holding_the_phantom_records():
    """A window reaching back into them cannot tell our own start-up from a reader.

    Withheld rather than printed with a caveat: the caveat is what got lost when
    7,616 ms was published as the cost of clicking (issues 1988 and 2336).
    """
    for started_on in (
        date(2026, 8, 8),
        report.PHANTOM_CLICK_RECORDS_ENDED_ON - timedelta(days=1),
        report.PHANTOM_CLICK_RECORDS_ENDED_ON,
    ):
        assert report.clicks_withheld_reason(started_on) is not None
        text = report.format_report(
            [entry(reading())],
            started_on,
            date(2026, 9, 30),
            50,
            clicks=[entry(reading())],
        )
        assert "CLICKS INSIDE THE SITE" not in text
        assert "Clicks are withheld" in text
        payload = json.loads(
            report.as_json(
                [entry(reading())],
                started_on,
                date(2026, 9, 30),
                50,
                clicks=[entry(reading())],
            )
        )
        assert payload["clicks"] is None
        assert "2336" in payload["clicksWithheldReason"]

    assert report.clicks_withheld_reason(AFTER_THE_PHANTOMS) is None


def test_a_click_figure_is_reported_beside_the_document_loads_once_it_can_be():
    text = report.format_report(
        [entry(reading(), reading())],
        AFTER_THE_PHANTOMS,
        date(2026, 10, 30),
        50,
        clicks=[entry(reading(), reading())],
    )
    assert "DOCUMENT LOADS" in text
    assert "CLICKS INSIDE THE SITE" in text
    assert "last move is never reported" in text
    assert "Clicks are withheld" not in text
    payload = json.loads(
        report.as_json(
            [entry(reading(), reading())],
            AFTER_THE_PHANTOMS,
            date(2026, 10, 30),
            50,
            clicks=[entry(reading(), reading())],
        )
    )
    assert payload["clicksWithheldReason"] is None
    assert payload["clicks"][0]["mainContentMeasurements"] == 60
    assert payload["clickNavigationTypes"] == list(report.CLICK_NAVIGATION_TYPES)


def test_a_thin_click_sample_is_withheld_by_the_same_floor_as_a_first_load():
    """The floor is the whole point: 3 measurements are how this data misled us."""
    thin = report.read_group(ADDRESS, group(main_count=49, layout_count=49))
    assert thin.main_content_ms is None
    assert thin.layout_movement is None
    text = report.format_report(
        [entry(reading(), reading())],
        AFTER_THE_PHANTOMS,
        date(2026, 10, 30),
        50,
        clicks=[entry(thin, thin)],
    )
    assert "too few (49)" in text


def test_the_click_query_asks_for_moves_inside_the_page_and_nothing_else():
    query = report.build_query(
        (ADDRESS,), navigation_types=report.CLICK_NAVIGATION_TYPES
    )
    assert '"routing-apis"' in query and '"soft-navigation"' in query
    assert '"navigate"' not in query and '"reload"' not in query
    assert "confidence(level: 0.95)" in query
    assert "bot: 0" in query
    # Nothing about the reader, exactly as the document-load query promises. Browser
    # and version are the 1 exception and only as a filter, which its own test pins.
    for forbidden in ("countryName", "deviceType", "refererHost"):
        assert forbidden not in query
    assert "userAgentBrowser" not in report.build_query(
        (ADDRESS,),
        navigation_types=report.CLICK_NAVIGATION_TYPES,
        separate_automated_clients=False,
    )


def test_cli_default_query_without_live_request(monkeypatch, capsys):
    monkeypatch.setenv("CLOUDFLARE_ANALYTICS_API_TOKEN", "fake-token")
    monkeypatch.setenv("CLOUDFLARE_ACCOUNT_ID", "fake-account")
    real_window = report.complete_window

    def window(days):
        assert days == 30
        return real_window(days, now=datetime(2026, 9, 7, tzinfo=UTC))

    monkeypatch.setattr(report, "complete_window", window)

    def fake_fetch(query, variables, token):
        assert variables["start"] == "2026-08-08"
        assert variables["end"] == "2026-09-06"
        assert token == "fake-token"
        assert "confidence(level: 0.95)" in query
        return {
            "data": {
                "viewer": {
                    "accounts": [{address.key: group() for address in report.ADDRESSES}]
                }
            }
        }

    monkeypatch.setattr(report, "ask_cloudflare", fake_fetch)
    assert report.main(["--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert len(payload["documentLoads"]) == len(report.ADDRESSES)
    # A window holding the records on issue 2336 spends nothing asking about clicks.
    assert payload["clicks"] is None


def test_cli_asks_about_clicks_only_for_a_window_that_can_answer(monkeypatch, capsys):
    monkeypatch.setenv("CLOUDFLARE_ANALYTICS_API_TOKEN", "fake-token")
    monkeypatch.setenv("CLOUDFLARE_ACCOUNT_ID", "fake-account")
    real_window = report.complete_window
    monkeypatch.setattr(
        report,
        "complete_window",
        lambda days: real_window(days, now=datetime(2026, 10, 31, tzinfo=UTC)),
    )
    asked: list[tuple[str, ...]] = []

    def fake_fetch(query, variables, token):
        asked.append(
            tuple(
                kind
                for kind in (*report.DOCUMENT_NAVIGATION_TYPES, "routing-apis")
                if f'"{kind}"' in query
            )
        )
        return {
            "data": {
                "viewer": {
                    "accounts": [{address.key: group() for address in report.ADDRESSES}]
                }
            }
        }

    monkeypatch.setattr(report, "ask_cloudflare", fake_fetch)
    assert report.main(["--json", "--since", AFTER_THE_PHANTOMS.isoformat()]) == 0
    payload = json.loads(capsys.readouterr().out)

    assert len(asked) == 2
    assert asked[0] == report.DOCUMENT_NAVIGATION_TYPES
    assert asked[1] == ("routing-apis",)
    assert len(payload["clicks"]) == len(report.ADDRESSES)
    # A click is reported, never judged against a limit written for a page load.
    assert (
        payload["clicks"][0]["overTheLimit"]
        == payload["documentLoads"][0]["overTheLimit"]
    )


@pytest.mark.parametrize("args", [["--min-measurements", "49"], ["--days", "0"]])
def test_cli_rejects_false_precision_before_any_request(args, monkeypatch):
    def forbidden(*args):
        pytest.fail("network request must not run")

    monkeypatch.setattr(report, "ask_cloudflare", forbidden)
    with pytest.raises(SystemExit) as error:
        report.main(args)
    assert error.value.code == 2


def test_money_addresses_are_retained():
    assert {
        "/money",
        "/money/committees",
        "/money/races",
        "/money/outside-spending",
        "/money/search",
        "/money/committees/<committee>",
        "/money/committees/<committee>/payments",
    } <= {address.label for address in report.ADDRESSES}


def test_a_committee_page_is_asked_about_separately_from_its_payments_page():
    """Issue 2022 defect 5. Two pages with 2 speeds, averaged by one prefix match.

    ``requestPath_notlike`` with a second wildcard is what keeps a committee's own
    page to itself: it drops any address carrying a further segment, which today is
    only the payments page. Both filters were run against the live Cloudflare account
    on 7 Sep 2026 and returned 23 and 12 measurements separately.
    """
    by_key = {address.key: address for address in report.ADDRESSES}
    committee = by_key["money_committee_pages"].filter_fragment
    payments = by_key["money_committee_payments"].filter_fragment
    assert 'requestPath_like: "/money/committees/%"' in committee
    assert 'requestPath_notlike: "/money/committees/%/%"' in committee
    assert payments == 'requestPath_like: "/money/committees/%/payments"'
    assert "notlike" not in payments
    query = report.build_query(report.ADDRESSES)
    for key in ("money_committee_pages", "money_committee_payments"):
        assert f"{key}: rumWebVitalsEventsAdaptiveGroups(" in query


def test_what_moved_counts_the_middle_band_as_over_our_limit():
    """Issue 2022 defect 2. Our 0.1 limit is exactly Google's Good band's upper edge.

    So a visit over our limit is its Needs Improvement band (above 0.1 up to 0.25)
    plus its Poor band (above 0.25). Counting the Poor band alone passed every visit
    in between under a column calling them over the limit. Both counts are actual
    observations rather than adaptive estimates, and read that way the 3 bands add up
    to the total exactly: checked against the live account on 7 Sep 2026 at 495 Good,
    3 Needs Improvement and 544 Poor against a total of 1,042.
    """
    row = group_with_bands(needs_improvement=3, poor=544, total=1042)
    assert report.over_our_limit(row) == 547
    text = report.format_what_moved(
        [(ADDRESS, [row])], date(2026, 8, 8), date(2026, 9, 6)
    )
    assert "547 over 0.1" in text
    assert "Needs Improvement band (above 0.1 up to 0.25)" in text
    assert "Poor band (above 0.25)" in text


def test_a_missing_band_makes_the_over_limit_count_unknown_never_smaller():
    """Dropping a band silently would print a count that is quietly too low."""
    row = group_with_bands(needs_improvement=3, poor=544, total=1042)
    del row["confidence"]["sum"]["clsNeedsImprovement"]
    assert report.over_our_limit(row) is None
    text = report.format_what_moved(
        [(ADDRESS, [row])], date(2026, 8, 8), date(2026, 9, 6)
    )
    assert "count unknown over 0.1" in text
    assert "544 over 0.1" not in text


def test_the_element_query_asks_for_both_bands_over_our_limit():
    query = report.build_what_moved_query(report.ADDRESSES)
    assert "clsNeedsImprovement { sampleSize }" in query
    assert "clsPoor { sampleSize }" in query
    assert "clsTotal { sampleSize }" in query


def test_a_release_boundary_starts_the_day_after_the_release() -> None:
    """Issue 2022 defect 4. A window holding the release day is not post-release.

    Cloudflare's windows are whole UTC days, so the merge day still holds the hours
    before the merge. Pull request 2006 merged at 22:38 UTC on 7 Sep 2026, so the
    first whole day entirely after it is 8 Sep, not 7 Sep.
    """
    assert report.first_full_day_after(
        datetime(2026, 9, 7, 22, 38, 17, tzinfo=UTC)
    ) == date(2026, 9, 8)
    # A release just after midnight still moves the window to the next whole day.
    assert report.first_full_day_after(datetime(2026, 9, 7, 0, 4, tzinfo=UTC)) == date(
        2026, 9, 8
    )
    # A release stamped in another zone is read in UTC, where the windows live.
    assert report.first_full_day_after(
        datetime(2026, 9, 7, 20, 30, tzinfo=timezone(timedelta(hours=-6)))
    ) == date(2026, 9, 9)


def test_the_release_boundary_reads_the_date_from_git_not_from_a_guess() -> None:
    first_commit = subprocess.run(
        ["git", "rev-list", "--max-parents=0", "HEAD"],
        capture_output=True,
        text=True,
        check=True,
        cwd=Path(__file__).resolve().parents[2],
    ).stdout.split()[0]
    assert isinstance(report.release_merged_at(first_commit), datetime)
    with pytest.raises(ValueError):
        report.release_merged_at("not-a-commit-at-all")


def test_the_report_and_json_print_the_release_bound() -> None:
    bound = "Bounded to after 7f3b84ec6850, which merged 2026-09-07 22:38 UTC."
    text = report.format_report(
        [entry(reading())], date(2026, 9, 8), date(2026, 9, 11), 50, bound
    )
    assert bound in text
    assert (
        json.loads(
            report.as_json(
                [entry(reading())], date(2026, 9, 8), date(2026, 9, 11), 50, bound
            )
        )["releaseBound"]
        == bound
    )
    # Without a bound the line is absent rather than empty or reading "None".
    assert "Bounded to" not in report.format_report(
        [entry(reading())], date(2026, 8, 8), date(2026, 9, 6), 50
    )


def test_an_unstarted_release_window_reports_nothing_rather_than_a_pass(
    monkeypatch, capsys
) -> None:
    """A bound whose first whole day has not arrived yet must not print an empty
    table. Nothing measured is not the same as nothing over the limit, and with
    --fail-on-breach an empty table would exit 0 and read as a release that passed.
    """
    monkeypatch.setenv("CLOUDFLARE_ANALYTICS_API_TOKEN", "token")
    monkeypatch.setenv("CLOUDFLARE_ACCOUNT_ID", "account")
    monkeypatch.setattr(
        report,
        "release_merged_at",
        lambda commit: datetime.now(UTC),
    )

    def refuse(*args, **kwargs):
        raise AssertionError("Cloudflare must not be asked about an empty window")

    monkeypatch.setattr(report, "ask_cloudflare", refuse)
    assert report.main(["--since-release", "abc1234", "--fail-on-breach"]) == 2
    assert "No whole day has passed inside that bound yet" in capsys.readouterr().err


def test_document_navigation_allowlist_is_the_public_endpoint_population():
    assert report.DOCUMENT_NAVIGATION_TYPES == (
        "navigate",
        "reload",
        "back-forward",
        "restore",
        "prerender",
    )


@pytest.mark.parametrize("option", ["--what-moved", "--fail-on-breach"])
def test_cli_modes_preserve_count_source_and_breach_exit(option, monkeypatch, capsys):
    monkeypatch.setenv("CLOUDFLARE_ANALYTICS_API_TOKEN", "fake-token")
    monkeypatch.setenv("CLOUDFLARE_ACCOUNT_ID", "fake-account")

    def fake_fetch(query, variables, token):
        assert "confidence(level: 0.95)" in query
        assert "sampleInterval" not in query
        assert "bot: 0" in query
        assert ("cumulativeLayoutShiftElement" in query) == (option == "--what-moved")
        return {
            "data": {
                "viewer": {
                    "accounts": [
                        {
                            key: group(9_000_000, 50, 1, 49)
                            for address in report.ADDRESSES
                            for key in (address.key, report.separated_key(address))
                        }
                    ]
                }
            }
        }

    monkeypatch.setattr(report, "ask_cloudflare", fake_fetch)
    # Pinned past the day Cloudflare began recording browser version, so the run
    # scores readers rather than refusing. The refusal has its own test below.
    assert report.main([option, "--since", "2026-09-12"]) == (
        1 if option == "--fail-on-breach" else 0
    )
    output = capsys.readouterr()
    if option == "--what-moved":
        assert "too few (49)" in output.out
        assert "75th percentile 1" not in output.out
    else:
        assert "Over a money-page limit" in output.err


def test_cli_errors_do_not_print_private_provider_values(monkeypatch, capsys):
    monkeypatch.setenv("CLOUDFLARE_ANALYTICS_API_TOKEN", "fake-token")
    monkeypatch.setenv("CLOUDFLARE_ACCOUNT_ID", "fake-account")
    monkeypatch.setattr(
        report,
        "ask_cloudflare",
        lambda *args: {"errors": [{"message": "private provider detail"}]},
    )
    assert report.main([]) == 2
    assert capsys.readouterr().err == "Cloudflare returned errors.\n"


@pytest.mark.parametrize(
    ("layout", "over"), [(0.0999, []), (0.1, []), (0.1004, ["layout movement"])]
)
def test_layout_boundary_uses_unrounded_score_in_comparison_and_json(layout, over):
    result = reading(2_500_000, 50, layout, 50)
    assert report.breaches(result) == over
    assert result.layout_movement == layout
    payload = json.loads(
        report.as_json([entry(result)], date(2026, 8, 8), date(2026, 9, 6))
    )
    assert payload["documentLoads"][0]["layoutMovement"] == layout
    assert payload["documentLoads"][0]["overTheLimit"] == over


@pytest.mark.parametrize(
    ("micros", "over"),
    [(2_499_990, []), (2_500_000, []), (2_500_040, ["main content"])],
)
def test_time_boundary_uses_unrounded_score_in_comparison_and_json(micros, over):
    result = reading(micros, 50, 0.1, 50)
    assert report.breaches(result) == over
    assert result.main_content_ms == micros / 1000
    payload = json.loads(
        report.as_json([entry(result)], date(2026, 8, 8), date(2026, 9, 6))
    )
    assert payload["documentLoads"][0]["mainContentMs"] == micros / 1000
    assert payload["documentLoads"][0]["overTheLimit"] == over


def test_only_rendered_cells_round_while_verdict_keeps_both_small_breaches():
    result = reading(2_500_040, 50, 0.1004, 50)
    text = report.format_report([entry(result)], date(2026, 8, 8), date(2026, 9, 6), 50)
    assert "2500 ms" in text
    assert "main content, layout movement" in text
    assert "unrounded scores" in text
    assert report.cell(0.0876, 50, 50, "") == "0.088"
    assert result.main_content_ms == 2500.04
    assert result.layout_movement == 0.1004


def test_cli_fail_on_breach_uses_raw_scores(monkeypatch, capsys):
    monkeypatch.setenv("CLOUDFLARE_ANALYTICS_API_TOKEN", "fake-token")
    monkeypatch.setenv("CLOUDFLARE_ACCOUNT_ID", "fake-account")
    monkeypatch.setattr(
        report,
        "ask_cloudflare",
        lambda *args: {
            "data": {
                "viewer": {
                    "accounts": [
                        {
                            key: group(2_500_040, 50, 0.1004, 50)
                            for address in report.ADDRESSES
                            for key in (address.key, report.separated_key(address))
                        }
                    ]
                }
            }
        },
    )
    assert report.main(["--json", "--fail-on-breach", "--since", "2026-09-12"]) == 1
    captured = capsys.readouterr()
    row = json.loads(captured.out)["documentLoads"][0]
    assert row["mainContentMs"] == 2500.04
    assert row["layoutMovement"] == 0.1004
    assert row["overTheLimit"] == ["main content", "layout movement"]


def test_the_separation_turns_on_by_window_start_not_by_today():
    """Cloudflare recorded no browser version before 2026-09-12 for whole days.

    Read against an earlier day a "not one of these versions" filter keeps the pool
    instead of removing it, so the answer would be the unseparated figure wearing a
    reader label. The date the window starts decides this, never the date it is run.
    """
    assert report.can_separate(date(2026, 9, 12))
    assert not report.can_separate(date(2026, 9, 11))
    assert report.BROWSER_VERSION_RECORDED_FROM == date(2026, 9, 12)


def test_the_separation_keeps_a_current_browser_and_drops_only_the_pool():
    """Each browser is excluded at the pool's own versions, never as a whole."""
    fragment = report.without_automated_clients()
    for browser, versions in report.AUTOMATED_CLIENT_POOL:
        assert f'userAgentBrowser_neq: "{browser}"' in fragment
        for version in versions:
            assert f'"{version}"' in fragment
    # A reader on a current Chrome stays in: the clause pairs the browser with its
    # own version list, so no browser is removed by name alone.
    assert "userAgentBrowser: " not in fragment
    assert fragment.startswith("AND: [")


def test_a_separable_window_scores_readers_and_prints_what_it_took_out():
    readings = [
        entry(reading(4_400_000, 7495), separated=reading(644_000, 121)),
    ]
    text = report.format_report(readings, date(2026, 9, 15), date(2026, 9, 21), 50)
    assert text.startswith("Reader measurements")
    assert "644 ms" in text
    assert "4400 ms" not in text
    assert "7374 of 7495 (98%)" in text
    assert "Chrome 118, 119, 120" in text
    payload = json.loads(report.as_json(readings, date(2026, 9, 15), date(2026, 9, 21)))
    row = payload["documentLoads"][0]
    assert payload["scoredPopulation"] == "readers"
    assert payload["automatedClientsSeparated"] is True
    assert row["mainContentMs"] == 644
    assert row["mainContentMeasurements"] == 121
    assert row["everyClientMainContentMs"] == 4400
    assert row["everyClientMeasurements"] == 7495
    assert row["automatedMeasurements"] == 7374
    assert row["overTheLimit"] == []


def test_an_unseparable_window_says_so_and_never_calls_itself_readers():
    readings = [entry(reading(4_400_000, 7495))]
    text = report.format_report(readings, date(2026, 8, 23), date(2026, 9, 21), 50)
    assert text.startswith("UNSEPARATED measurements")
    assert "Do not read these as reader figures." in text
    assert "not separable" in text
    assert "4400 ms" in text
    payload = json.loads(report.as_json(readings, date(2026, 8, 23), date(2026, 9, 21)))
    assert payload["scoredPopulation"] == "every-client"
    assert payload["automatedClientsSeparated"] is False
    assert payload["documentLoads"][0]["automatedMeasurements"] is None
    assert payload["documentLoads"][0]["overTheLimit"] == ["main content"]


def test_fail_on_breach_refuses_a_window_it_cannot_separate(monkeypatch, capsys):
    """Exit 2 is "not judged", never exit 1's "over the limit" and never a pass.

    Failing a release on a window that still holds the automated client pool is the
    harm this switch exists to prevent. On 15 to 21 Sep 2026 the same committee
    pages measured 4,524 ms with the pool in and 644 ms with it out, so an
    unseparated window answers a different question from the one #1966 asks.
    """
    monkeypatch.setenv("CLOUDFLARE_ANALYTICS_API_TOKEN", "fake-token")
    monkeypatch.setenv("CLOUDFLARE_ACCOUNT_ID", "fake-account")
    monkeypatch.setattr(
        report,
        "ask_cloudflare",
        lambda *args: {
            "data": {
                "viewer": {
                    "accounts": [
                        {
                            address.key: group(9_000_000, 5000, 1, 5000)
                            for address in report.ADDRESSES
                        }
                    ]
                }
            }
        },
    )
    assert report.main(["--since", "2026-09-11", "--fail-on-breach"]) == 2
    error = capsys.readouterr().err
    assert "Not judged" in error
    assert "Over a money-page limit" not in error


def test_the_busiest_money_address_is_reported():
    """/money/payments carries more measurements than every other money address.

    Left out of this list it was the busiest address on the site and unreported,
    which is how 22,685 measurements in one week went unexamined.
    """
    assert "/money/payments" in [address.label for address in report.ADDRESSES]
