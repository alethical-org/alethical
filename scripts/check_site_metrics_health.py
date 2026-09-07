#!/usr/bin/env python3
"""Read the 7 cached public metric sources without generating reader activity.

No vendor/admin APIs, credentials, browser, search, sign-in, or event POSTs.
Only fixed source names and fixed failure reasons leave this process. Never log
response bodies, headers, URLs from responses, or exception messages.

Freshness budgets deliberately exceed normal caches: 2h for five-minute caches,
3h for completed-hour boundaries, 48h for six-hour search caches plus 24h stale
refresh. Search periods may lag 7 calendar days (normal finalization is 3 days).
Uptime uses the measurement's age: 15m provider tolerance + 5m cache + 1m refresh.
These are source-health limits, not audience, speed, or availability targets.
"""

from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta, timezone
from http.client import HTTPException
import json
import math
from pathlib import Path
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener


SOURCES = (
    ("traffic", "https://www.alethical.com/api/traffic"),
    ("google", "https://www.alethical.com/api/traffic-google?window=30"),
    ("bing", "https://www.alethical.com/api/traffic-bing"),
    ("uptime", "https://www.alethical.com/api/traffic-uptime"),
    ("performance", "https://www.alethical.com/api/traffic-performance"),
    ("actions", "https://api.alethical.com/api/v1/site-metrics?version=2"),
    ("accounts", "https://api.alethical.com/api/v1/site-metrics/accounts"),
)
MAX_BYTES = 65_536
ACTIONS = (
    "billSearchesWithResults",
    "legislatorSearchesWithResults",
    "findMyLegislatorWithResults",
    "officialSourceLinksOpened",
    "moneySearchesWithResults",
    "newReaderAccounts",
    "newBillWatches",
    "newCommitteeWatches",
)
CREATIONS = ("newReaderAccounts", "newBillWatches", "newCommitteeWatches")
COVERAGE_FLAGS = (
    "current7dComplete",
    "current30dComplete",
    "previous7dComplete",
    "previous30dComplete",
)
READERS = (
    "registeredReaders",
    "currentReaderAccounts",
    "currentBillWatches",
    "differentBillsCurrentlyWatched",
    "currentBillFollowingReaders",
    "currentCommitteeFollowingReaders",
    "currentCommitteeWatches",
    "differentCommitteesCurrentlyWatched",
)
DESTINATIONS = (
    "home",
    "billSearch",
    "billProfiles",
    "legislatorSearch",
    "legislatorProfiles",
    "findMyLegislator",
    "money",
    "moneySearch",
    "moneyByRace",
    "moneyCommitteeList",
    "moneyCommitteeProfiles",
    "moneyPayments",
    "moneyOutsideSpending",
    "moneyOther",
    "read",
    "legacyAsk",
    "other",
)
ACCOUNT_COUNTS = (
    "currentAccountsCreated",
    "currentConfirmedAccounts",
    "currentUnconfirmedAccounts",
    "created7d",
    "created30d",
    "previousCreated7d",
    "previousCreated30d",
)
NAVIGATION_TYPES = ("navigate", "reload", "back-forward", "restore", "prerender")
DAY = timedelta(days=1)


class HealthFailure(Exception):
    """A fixed local reason, safe for public logs. Never wrap remote text."""


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def require(condition: bool, reason: str) -> None:
    if not condition:
        raise HealthFailure(reason)


def record(value: Any) -> dict[str, Any]:
    require(isinstance(value, dict), "missing or invalid measurement object")
    return value


def number(value: Any, *, integer: bool = False) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    return (
        0 <= value <= 2**53 - 1
        and math.isfinite(value)
        and (not integer or isinstance(value, int))
    )


def counts(value: Any, keys: tuple[str, ...]) -> dict[str, Any]:
    data = record(value)
    require(
        all(number(data.get(key), integer=True) for key in keys),
        "missing or invalid count",
    )
    return data


def timestamp(value: Any) -> datetime:
    require(isinstance(value, str), "missing or invalid timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        require(parsed.utcoffset() is not None, "timestamp has no timezone")
        return parsed.astimezone(timezone.utc)
    except ValueError:
        raise HealthFailure("missing or invalid timestamp") from None


def calendar_date(value: Any) -> date:
    require(
        isinstance(value, str) and len(value) == 10, "missing or invalid calendar date"
    )
    try:
        result = date.fromisoformat(value)
        require(result.isoformat() == value, "missing or invalid calendar date")
        return result
    except ValueError:
        raise HealthFailure("missing or invalid calendar date") from None


def fresh(value: Any, now: datetime, maximum: timedelta, name: str) -> datetime:
    parsed = timestamp(value)
    require(now - parsed >= -timedelta(minutes=1), f"{name} is in the future")
    require(now - parsed <= maximum, f"{name} is stale; restore source refresh")
    return parsed


def hour_end(value: Any, now: datetime) -> datetime:
    end = fresh(value, now, timedelta(hours=3), "completed-hour window")
    require(
        end.minute == end.second == end.microsecond == 0 and end <= now,
        "invalid completed-hour boundary",
    )
    return end


def periods(data: dict[str, Any], now: datetime) -> dict[int, dict[str, datetime]]:
    result = {}
    for days in (7, 30):
        raw = record(data.get(f"periods{days}d"))
        period = {
            key: timestamp(raw.get(key))
            for key in ("startsAt", "endsAt", "previousStartsAt", "previousEndsAt")
        }
        hour_end(raw.get("endsAt"), now)
        require(
            period["endsAt"] - period["startsAt"] == days * DAY
            and period["previousEndsAt"] == period["startsAt"]
            and period["previousEndsAt"] - period["previousStartsAt"] == days * DAY,
            "creation/action periods are not equal and adjacent",
        )
        result[days] = period
    require(result[7]["endsAt"] == result[30]["endsAt"], "period end dates disagree")
    return result


def search(data: dict[str, Any], now: datetime) -> str:
    keys = (
        "clicks30d",
        "impressions30d",
        "previousClicks30d",
        "previousImpressions30d",
    )
    require(
        all(number(data.get(key)) for key in keys),
        "missing or invalid search measurement",
    )
    fresh(data.get("fetchedAt"), now, timedelta(hours=48), "search response")
    start, end, previous_start, previous_end = (
        calendar_date(data.get(key))
        for key in (
            "periodStartedOn",
            "periodEndedOn",
            "previousPeriodStartedOn",
            "previousPeriodEndedOn",
        )
    )
    require(
        timedelta(0) < now.date() - end <= 7 * DAY,
        "search period is future or older than 7 days",
    )
    require(
        end - start == previous_end - previous_start == 29 * DAY
        and previous_end + DAY == start,
        "search periods are not equal and adjacent 30-day windows",
    )
    return "healthy"


def traffic(data: dict[str, Any], now: datetime) -> str:
    keys = (
        "pageViews24h",
        "pageViews7d",
        "pageViews30d",
        "estimatedVisitors24h",
        "estimatedVisitors7d",
        "estimatedVisitors30d",
    )
    counts(data, keys)
    hour_end(data.get("windowEndedAt"), now)
    require(
        timestamp(data.get("countingStartedAt")) <= now,
        "traffic counting start is in the future",
    )
    require(
        data.get("teamExclusionConfigured") is True, "team exclusion is not configured"
    )
    for window in ("24h", "7d", "30d"):
        require(
            data[f"estimatedVisitors{window}"] <= data[f"pageViews{window}"],
            "visitor and page-view totals disagree",
        )
    require(
        data["pageViews24h"] <= data["pageViews7d"] <= data["pageViews30d"],
        "traffic window totals disagree",
    )
    for days in (7, 30):
        breakdown = record(data.get(f"trafficBreakdown{days}d"))
        destinations = counts(breakdown.get("destinationPageViews"), DESTINATIONS)
        require(
            sum(destinations[key] for key in DESTINATIONS) == data[f"pageViews{days}d"],
            "traffic destination totals do not add up",
        )
        for key in ("billProfiles", "legislatorProfiles", "committeeProfiles"):
            profiles = counts(breakdown.get(key), ("pageViews",))
            distinct = counts(profiles.get("differentProfilesViewed"), ("count", "cap"))
            require(
                distinct["cap"] > 0
                and distinct["count"] <= distinct["cap"]
                and type(distinct.get("capped")) is bool
                and distinct["count"]
                <= profiles["pageViews"]
                == destinations[
                    "moneyCommitteeProfiles" if key == "committeeProfiles" else key
                ],
                "profile-view measurements disagree",
            )
    return "healthy"


def uptime(data: dict[str, Any], now: datetime) -> str:
    measured = record(data.get("measuredAt"))
    started = record(data.get("monitoringStartedAt"))
    source = record(data.get("measurementSource"))
    missing = []
    for monitor, key in (
        ("website", "websiteAvailability30d"),
        ("api", "apiAvailability30d"),
    ):
        require(key in data, "missing availability field")
        value = data[key]
        if value is None:
            missing.append(monitor)
            require(
                all(
                    monitor in part and part[monitor] is None
                    for part in (measured, started, source)
                ),
                "missing uptime measurement has contradictory source details",
            )
            continue
        require(number(value) and value <= 100, "invalid availability measurement")
        require(
            source.get(monitor) == "status-page",
            "uptime measurement source is missing or changed",
        )
        at = fresh(
            measured.get(monitor),
            now,
            timedelta(minutes=21),
            f"{monitor} uptime measurement",
        )
        require(
            timestamp(started.get(monitor)) <= at,
            "uptime monitoring start is after measurement",
        )
    require(
        not missing,
        f"degraded: {', '.join(missing)} measurement missing; restore uptime source",
    )
    return "healthy"


def performance(data: dict[str, Any], now: datetime) -> str:
    require(
        data.get("measurementScope") == "document-loads"
        and data.get("knownBotsExcluded") is True
        and data.get("sampleCountSource") == "cloudflare-confidence"
        and data.get("minimumSamples") == 50
        and data.get("navigationTypes") == list(NAVIGATION_TYPES),
        "page-speed measurement scope or sample source changed",
    )
    require(number(data.get("sampleInterval")), "missing or invalid sample interval")
    start, end = (
        calendar_date(data.get("periodStartedOn")),
        calendar_date(data.get("periodEndedOn")),
    )
    require(
        end - start == 29 * DAY
        and end == timestamp(data.get("fetchedAt")).date() - DAY,
        "page-speed period is not 30 complete UTC days",
    )
    building = False
    for score, samples in (
        ("lcpP75Ms", "lcpSamples"),
        ("inpP75Ms", "inpSamples"),
        ("clsP75", "clsSamples"),
    ):
        counts(data, (samples,))
        require(score in data, "page-speed measurement is missing")
        if data[samples] < 50:
            require(
                data[score] is None,
                "page-speed score published with fewer than 50 samples",
            )
            building = True
        else:
            require(
                number(data[score]),
                "page-speed score missing despite sufficient samples",
            )
    return "building sample" if building else "healthy"


def actions(data: dict[str, Any], now: datetime) -> str:
    bounds = periods(data, now)
    require(
        data.get("teamExclusionConfigured") is True, "team exclusion is not configured"
    )
    counts(data.get("readers"), READERS)
    counts(data.get("totalsSinceStart"), CREATIONS)
    history = record(data.get("history"))
    for days in (7, 30):
        counts(data.get(f"actions{days}d"), ACTIONS)
        previous = record(data.get(f"previousActions{days}d"))
        for key in ACTIONS:
            coverage = record(history.get(key))
            require("recordingStartedAt" in coverage, "recording start is missing")
            started = coverage["recordingStartedAt"]
            if started is not None:
                started = timestamp(started)
                require(started <= now, "recording start is in the future")
            for label, bound in (
                (f"current{days}dComplete", "startsAt"),
                (f"previous{days}dComplete", "previousStartsAt"),
            ):
                require(
                    type(coverage.get(label)) is bool
                    and coverage[label]
                    == (started is not None and started <= bounds[days][bound]),
                    "recording coverage disagrees with period dates",
                )
            complete = coverage[f"previous{days}dComplete"]
            require(
                key in previous
                and (
                    number(previous[key], integer=True)
                    if complete
                    else previous[key] is None
                ),
                "previous action count does not match recording coverage",
            )
    return "healthy"


def accounts(data: dict[str, Any], now: datetime) -> str:
    counts(data, ACCOUNT_COUNTS)
    periods(data, now)
    require(
        data["currentConfirmedAccounts"] + data["currentUnconfirmedAccounts"]
        == data["currentAccountsCreated"],
        "confirmed and unconfirmed account totals do not add up",
    )
    require(
        data["created7d"] <= data["created30d"] <= data["currentAccountsCreated"],
        "account creation totals disagree",
    )
    require(
        data.get("source") == "supabase"
        and data.get("scope") == "current_surviving_reader_accounts"
        and isinstance(data.get("definition"), str)
        and bool(data["definition"])
        and data.get("historyLimitation")
        == "Deleted accounts are not included, so past creation totals can decrease.",
        "account creation source or surviving-account limitation is missing",
    )
    return "healthy"


def validate(source: str, payload: Any, now: datetime) -> str:
    data = record(payload)
    if source == "actions":
        data = record(data.get("data"))
    if source in ("google", "bing"):
        return search(data, now)
    fresh(
        data.get("asOf" if source == "accounts" else "fetchedAt"),
        now,
        timedelta(hours=2),
        "response",
    )
    return {
        "traffic": traffic,
        "uptime": uptime,
        "performance": performance,
        "actions": actions,
        "accounts": accounts,
    }[source](data, now)


def reject_nonfinite(_value: str) -> None:
    raise HealthFailure("response is not valid JSON")


def fetch_json(url: str) -> Any:
    opener = build_opener(NoRedirect())
    request = Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "Alethical-site-metrics-health/1",
        },
        method="GET",
    )
    for attempt in range(2):
        try:
            with opener.open(request, timeout=10) as response:
                content_type = (
                    response.headers.get("Content-Type", "")
                    .split(";", 1)[0]
                    .strip()
                    .lower()
                )
                require(content_type == "application/json", "response is not JSON")
                body = response.read(MAX_BYTES + 1)
                require(len(body) <= MAX_BYTES, "response exceeds size limit")
                try:
                    return json.loads(body, parse_constant=reject_nonfinite)
                except (ValueError, UnicodeError, RecursionError):
                    raise HealthFailure("response is not valid JSON") from None
        except HTTPError as error:
            status = error.code
            error.close()
            if status < 500 or status >= 600 or attempt:
                raise HealthFailure(
                    f"HTTP {status}; restore source availability"
                ) from None
        except (URLError, OSError, HTTPException):
            if attempt:
                raise HealthFailure("network request failed after 1 retry") from None
        time.sleep(1)
    raise HealthFailure("source request failed")


def main(argv: list[str] | None = None, *, now: datetime | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--summary", type=Path, help="Write a count-free health summary"
    )
    args = parser.parse_args(argv)
    lines = []
    failed = False
    for source, url in SOURCES:
        try:
            payload = fetch_json(url)
            status = validate(source, payload, now or datetime.now(timezone.utc))
        except HealthFailure as error:
            status = str(error)  # Only locally written fixed reasons enter this type.
            failed = True
        line = f"{source}: {status}"
        print(line)
        lines.append(f"- {line}")
    if args.summary:
        args.summary.write_text(
            "## Site metrics source health\n\n" + "\n".join(lines) + "\n",
            encoding="utf-8",
        )
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
