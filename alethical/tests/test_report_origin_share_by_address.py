"""Source-shaped origin-share tests, without network, database or reader tracking."""

from __future__ import annotations

import fnmatch
import importlib.util
import json
import re
import sys
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location(
    "report_origin_share_by_address",
    Path(__file__).resolve().parents[2]
    / "scripts"
    / "report_origin_share_by_address.py",
)
assert SPEC and SPEC.loader
report = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = report
SPEC.loader.exec_module(report)

ADDRESS = report.Address(
    "bill_list", "/api/v1/bills", 'clientRequestPath: "/api/v1/bills"'
)


def group(status: str, count: int, interval: float = 1.0) -> dict:
    return {
        "count": count,
        "avg": {"sampleInterval": interval},
        "dimensions": {"cacheStatus": status},
    }


def read(*groups: dict) -> report.Reading:
    return report.read_groups(ADDRESS, list(groups))


# --- what the request is allowed to ask Cloudflare for ----------------------


@pytest.mark.parametrize("include_verified_bots", [False, True])
def test_the_query_asks_for_the_cache_status_and_nothing_about_the_requester(
    include_verified_bots,
):
    """The privacy promise is in the request, not in what the report chooses to print."""
    query = report.build_query(
        report.ADDRESSES, include_verified_bots=include_verified_bots
    )
    dimensions = re.findall(r"dimensions \{([^}]*)\}", query)
    assert dimensions, "every address must group by something"
    assert {block.strip() for block in dimensions} == {"cacheStatus"}
    forbidden = (
        "clientCountryName",
        "clientDeviceType",
        "clientIP",
        "clientASNDescription",
        "clientAsn",
        "clientRequestQuery",
        "clientRequestReferer",
        "clientRefererHost",
        "coloCode",
        "userAgent",
        "userAgentBrowser",
        "userAgentOS",
        "ja3Hash",
        "ja4",
        "sessionIdHash",
        "botScore",
    )
    for field in forbidden:
        assert field not in query, f"{field} says something about the reader"


def test_verified_bots_are_excluded_unless_the_other_population_is_asked_for():
    excluded = report.build_query(report.ADDRESSES, include_verified_bots=False)
    included = report.build_query(report.ADDRESSES, include_verified_bots=True)
    assert 'verifiedBotCategory: ""' in excluded
    assert "verifiedBotCategory" not in included
    assert "verified bots excluded" in report.population_note(
        include_verified_bots=False
    )
    assert "including verified bots" in report.population_note(
        include_verified_bots=True
    )


def test_only_the_cached_api_host_and_only_reads_are_asked_about():
    """www.alethical.com is DNS-only, so Cloudflare holds no copy of the page HTML."""
    assert report.HOST == "api.alethical.com"
    query = report.build_query(report.ADDRESSES)
    assert "clientRequestHTTPHost: $host" in query
    assert query.count('clientRequestHTTPMethodName: "GET"') == len(report.ADDRESSES)


def test_every_address_is_asked_about_separately_so_no_row_limit_can_truncate_a_family():
    query = report.build_query(report.ADDRESSES)
    assert query.count("httpRequestsAdaptiveGroups(") == len(report.ADDRESSES)
    for address in report.ADDRESSES:
        assert f"{address.key}: httpRequestsAdaptiveGroups(" in query


# --- the address families ---------------------------------------------------


def conditions(fragment: str) -> list[tuple[str, str]]:
    return re.findall(r'(clientRequestPath\w*): "([^"]*)"', fragment)


def matches(fragment: str, path: str) -> bool:
    for field, value in conditions(fragment):
        pattern = value.replace("%", "*")
        if field == "clientRequestPath" and path != value:
            return False
        if field == "clientRequestPath_neq" and path == value:
            return False
        if field == "clientRequestPath_like" and not fnmatch.fnmatchcase(path, pattern):
            return False
        if field == "clientRequestPath_notlike" and fnmatch.fnmatchcase(path, pattern):
            return False
    return True


REAL_PATHS = (
    "/api/v1/bills",
    "/api/v1/bills/featured",
    "/api/v1/bills/94-2025-HF1",
    "/api/v1/bills/94-2025-HF1/votes",
    "/api/v1/bills/94-2025-HF1/versions",
    "/api/v1/bills/94-2025-HF1/versions/introduction",
    "/api/v1/legislators",
    "/api/v1/legislators/aisha-gomez",
    "/api/v1/legislators/aisha-gomez/bills",
    "/api/v1/legislators/aisha-gomez/votes",
    "/api/v1/legislators/aisha-gomez/campaign-finance",
    "/api/v1/legislators/aisha-gomez/independent-spending",
    "/api/v1/campaign-finance/committees",
    "/api/v1/campaign-finance/races",
    "/api/v1/committees/18135/finance",
    "/api/v1/committees/18135/payments",
    "/api/v1/committees/18135/filings",
    "/api/v1/meta",
    "/api/v1/sessions",
    "/api/v1/sessions/current",
    "/api/v1/policy-areas",
)


@pytest.mark.parametrize("path", REAL_PATHS)
def test_a_real_address_lands_in_exactly_one_family(path):
    """Two families that both match one address print it twice and total nothing.

    The featured bill list has a bill's own shape, so the bill row has to exclude
    it by name; this is the test that caught that.
    """
    families = [
        address.label
        for address in report.ADDRESSES
        if address.key != "all_public_reads" and matches(address.filter_fragment, path)
    ]
    assert families == [families[0]], f"{path} matched {families}"


@pytest.mark.parametrize("path", REAL_PATHS)
def test_the_whole_public_surface_row_covers_every_address(path):
    everything = next(a for a in report.ADDRESSES if a.key == "all_public_reads")
    assert matches(everything.filter_fragment, path)


def test_the_five_long_window_money_reads_each_have_their_own_row():
    """These 5 hold answers for 5 minutes plus a day; the rest hold for 6 minutes.

    Averaging the 2 windows into one row would produce a figure true of neither
    (`alethical/api/routers/public.py`, MONEY_RECORD_PATHS).
    """
    labels = {address.label for address in report.ADDRESSES}
    assert {
        "/api/v1/campaign-finance/committees",
        "/api/v1/campaign-finance/filings",
        "/api/v1/campaign-finance/outside-spending",
        "/api/v1/campaign-finance/payments-under-name",
        "/api/v1/campaign-finance/races",
    } <= labels


# --- what a share means -----------------------------------------------------


def test_the_two_origin_shares_differ_by_exactly_a_stale_copy_served_instantly():
    reading = read(group("miss", 40), group("updating", 40), group("hit", 20))
    assert reading.built_here == pytest.approx(0.8)
    assert reading.reader_waited == pytest.approx(0.4)
    assert report.BUILT_HERE_STATUSES != report.READER_WAITED_STATUSES
    assert set(report.BUILT_HERE_STATUSES) - set(report.READER_WAITED_STATUSES) == {
        "updating"
    }


def test_waiting_and_being_handed_a_copy_account_for_every_eligible_request():
    reading = read(
        group("miss", 30), group("expired", 20), group("updating", 25), group("hit", 25)
    )
    assert reading.reader_waited + reading.from_a_copy == pytest.approx(1.0)


def test_a_request_never_eligible_for_a_copy_is_counted_apart_and_in_no_share():
    """A cache window could not have helped these, so a denominator holding them lies."""
    reading = read(group("miss", 50), group("dynamic", 500), group("bypass", 40))
    assert reading.eligible_requests == 50
    assert reading.ineligible_requests == 540
    assert reading.built_here == pytest.approx(1.0)


def test_a_conditional_revalidation_is_classified_even_though_it_cannot_happen_yet():
    """The API sends no ETag and no Last-Modified, so Cloudflare cannot revalidate.

    Classifying it anyway means adding a validator later cannot quietly drop
    requests out of every share instead of moving them between shares.
    """
    assert "revalidated" in report.ELIGIBLE_STATUSES
    assert "revalidated" in report.BUILT_HERE_STATUSES
    assert "revalidated" in report.READER_WAITED_STATUSES
    reading = read(group("revalidated", 60))
    assert reading.built_here == pytest.approx(1.0)
    assert reading.reader_waited == pytest.approx(1.0)


def test_a_stale_copy_served_because_the_origin_was_unreachable_built_nothing():
    """Cloudflare's own words: it could not contact the origin, so nothing was built."""
    reading = read(group("stale", 60))
    assert reading.built_here == pytest.approx(0.0)
    assert reading.reader_waited == pytest.approx(0.0)
    assert reading.from_a_copy == pytest.approx(1.0)


# --- counts, sampling and refusals -----------------------------------------


def test_the_sampling_interval_scales_the_estimate_and_the_floor_stays_on_records():
    """Cloudflare drops records under load; the interval says how many each stands for."""
    reading = read(group("miss", 30, interval=10), group("hit", 30, interval=1))
    assert reading.eligible_requests == pytest.approx(330)
    assert reading.built_here == pytest.approx(300 / 330)
    assert reading.observations == 60


@pytest.mark.parametrize("count", [1, 25, 49])
def test_a_share_resting_on_too_few_records_is_withheld_never_printed_as_zero(count):
    reading = read(group("hit", count))
    assert reading.built_here is None
    assert reading.reader_waited is None
    assert reading.from_a_copy is None
    assert f"too few ({count})" == report.percent(None, count)


def test_an_address_nobody_asked_for_says_so_rather_than_showing_a_share():
    reading = read()
    assert reading.observations == 0
    assert reading.eligible_requests == 0
    assert reading.built_here is None
    assert report.percent(None, 0) == "no requests"
    assert report.requests_label(reading) == "0"


@pytest.mark.parametrize(
    "broken",
    [
        {"count": 60, "avg": {"sampleInterval": 1}, "dimensions": {}},
        {"count": 60, "avg": {}, "dimensions": {"cacheStatus": "miss"}},
        {
            "count": -1,
            "avg": {"sampleInterval": 1},
            "dimensions": {"cacheStatus": "miss"},
        },
        {
            "count": 1.5,
            "avg": {"sampleInterval": 1},
            "dimensions": {"cacheStatus": "miss"},
        },
        {
            "count": 60,
            "avg": {"sampleInterval": 0.5},
            "dimensions": {"cacheStatus": "miss"},
        },
        "not a group",
    ],
)
def test_one_unreadable_row_makes_the_address_unavailable_not_smaller(broken):
    """Dropping a row would move a share without changing anything a reader saw."""
    reading = read(group("hit", 200), broken)
    assert reading.built_here is None
    assert reading.observations == 0
    assert reading.by_status == {}


def test_the_printed_request_count_is_the_eligible_one_not_the_whole_traffic():
    """Printing 960 beside a 100% share would read as a cache that never worked."""
    readings = [read(group("miss", 60), group("dynamic", 900))]
    table = report.format_table(readings)
    assert report.requests_label(readings[0]) == "60"
    assert "960" not in table
    assert "900" not in table


# --- the window -------------------------------------------------------------


def test_the_default_window_is_complete_utc_days_ending_yesterday():
    now = datetime(2026, 9, 8, 3, 14, tzinfo=UTC)
    started_on, ended_on = report.complete_window(now=now)
    assert (started_on, ended_on) == (date(2026, 8, 11), date(2026, 9, 7))
    assert (ended_on - started_on) == timedelta(days=report.DEFAULT_DAYS - 1)


def test_the_window_is_read_in_utc_rather_than_the_machine_s_own_day():
    late = datetime(2026, 9, 8, 23, 30, tzinfo=UTC)
    assert report.complete_window(1, now=late) == (date(2026, 9, 7), date(2026, 9, 7))


def test_the_last_day_is_included_because_the_bound_ends_the_morning_after():
    start, end = report.window_bounds(date(2026, 8, 11), date(2026, 9, 7))
    assert start == "2026-08-11T00:00:00Z"
    assert end == "2026-09-08T00:00:00Z"


def test_the_window_cannot_be_set_past_what_cloudflare_keeps():
    """Cloudflare refused data older than 4 weeks 4 days on this account."""
    assert report.DEFAULT_DAYS < report.MAX_DAYS <= 32


# --- the report itself ------------------------------------------------------


def test_the_report_names_its_window_its_population_and_its_floor():
    readings = [read(group("miss", 60), group("hit", 40))]
    text = report.format_report(
        readings, date(2026, 8, 11), date(2026, 9, 7), include_verified_bots=False
    )
    assert "2026-08-11 to 2026-09-07" in text
    assert f"fewer than {report.MIN_OBSERVATIONS} observations is withheld" in text
    assert "verified bots excluded" in text
    assert "copy per location" in text


def test_the_json_carries_the_status_lists_so_a_share_can_be_rechecked():
    readings = [read(group("miss", 60), group("updating", 40))]
    payload = json.loads(
        report.as_json(
            readings, date(2026, 8, 11), date(2026, 9, 7), include_verified_bots=True
        )
    )
    assert payload["verifiedBotsIncluded"] is True
    assert payload["builtHereStatuses"] == list(report.BUILT_HERE_STATUSES)
    assert payload["readerWaitedStatuses"] == list(report.READER_WAITED_STATUSES)
    row = payload["addresses"][0]
    assert row["byStatus"] == {"miss": 60, "updating": 40}
    assert row["builtHere"] == pytest.approx(1.0)
    assert row["readerWaited"] == pytest.approx(0.6)


# --- the command line -------------------------------------------------------


def test_a_window_outside_what_cloudflare_keeps_is_refused_before_any_request(
    monkeypatch,
):
    monkeypatch.setattr(
        report,
        "ask_cloudflare",
        lambda *args, **kwargs: pytest.fail("asked Cloudflare anyway"),
    )
    for argv in (["--days", "0"], ["--days", str(report.MAX_DAYS + 1)]):
        with pytest.raises(SystemExit) as raised:
            report.main(argv)
        assert raised.value.code == 2


def test_missing_credentials_stop_the_run_without_printing_a_provider_value(
    monkeypatch, capsys
):
    monkeypatch.setenv("CLOUDFLARE_ANALYTICS_API_TOKEN", "")
    monkeypatch.setenv("CLOUDFLARE_ACCOUNT_ID", "an-account-nobody-should-see")
    monkeypatch.setattr(
        report,
        "ask_cloudflare",
        lambda *args, **kwargs: pytest.fail("asked Cloudflare anyway"),
    )
    assert report.main([]) == 2
    printed = capsys.readouterr()
    assert "CLOUDFLARE_ANALYTICS_API_TOKEN" in printed.err
    assert "an-account-nobody-should-see" not in printed.err + printed.out


def test_the_command_line_prints_a_table_from_one_request(monkeypatch, capsys):
    asked: dict[str, object] = {}

    def answer(query, variables, token):
        asked["query"] = query
        asked["variables"] = variables
        return {
            "data": {
                "viewer": {
                    "accounts": [
                        {
                            address.key: [group("miss", 60), group("hit", 40)]
                            for address in report.ADDRESSES
                        }
                    ]
                }
            }
        }

    monkeypatch.setenv("CLOUDFLARE_ANALYTICS_API_TOKEN", "token")
    monkeypatch.setenv("CLOUDFLARE_ACCOUNT_ID", "account")
    monkeypatch.setattr(report, "ask_cloudflare", answer)
    assert report.main([]) == 0
    printed = capsys.readouterr().out
    assert "/api/v1/bills" in printed
    assert "60.0%" in printed
    assert asked["variables"]["host"] == report.HOST
    assert asked["variables"]["end"].endswith("T00:00:00Z")


def test_a_refusal_from_cloudflare_is_reported_rather_than_printed_as_no_traffic(
    monkeypatch, capsys
):
    monkeypatch.setenv("CLOUDFLARE_ANALYTICS_API_TOKEN", "token")
    monkeypatch.setenv("CLOUDFLARE_ACCOUNT_ID", "account")
    monkeypatch.setattr(
        report,
        "ask_cloudflare",
        lambda *args, **kwargs: {"data": None, "errors": [{"message": "no access"}]},
    )
    assert report.main([]) == 1
    assert "no access" in capsys.readouterr().err
