#!/usr/bin/env python3
"""Privately report existing Cloudflare page-speed measurements by address.

This reads aggregates already held by Cloudflare; it adds no browser tracking and
publishes nothing. The public /site-metrics page stays sitewide. No country,
device, browser, resource, referrer or reader identity is requested. The optional
--what-moved report groups by an element of our own page.

Counts come directly from confidence.sum.<metric>.sampleSize, Cloudflare's actual
observations behind that metric. Adaptive sums estimate traffic; dividing them by
an average sampling interval cannot recover an exact count. Missing or malformed
counts are unavailable, never zero. Scores require at least 50 observations.
https://developers.cloudflare.com/analytics/graphql-api/features/confidence-intervals/

The default is the last 30 complete UTC days, ending yesterday. The population
matches api/traffic-performance.ts: navigate, reload, back-forward, restore and
prerender, with known bots excluded. Cached and prefetched deliveries remain in
scope. Native soft navigation and routing-apis events are excluded.
https://developers.cloudflare.com/web-analytics/data-metrics/dimensions/

Before Cloudflare completed its navigation-classification rollout on 4 Sep 2026,
the navigate bucket could contain older soft-navigation events. A window reaching
before that date cannot isolate document loads even with today's filter.
Alethical found startup address rewrites producing routing-apis artifacts on
4 Sep 2026 (https://github.com/alethical-org/alethical/issues/1988).

The limits are 2500 ms for main content and 0.1 for unexpected layout movement
(https://github.com/alethical-org/alethical/issues/1966). Main content is the
browser's largest-content measurement, not an app-ready timer. On 4 Sep 2026,
3 browser runs selected the server-written snapshot; that observation does not
identify every reader's largest element. The 75th percentile is not an average
of the slowest quarter. Element rows rank by estimated measurement volume, not
movement magnitude; no count above the 0.1 limit is inferred from Cloudflare's
different poor-category threshold.

Standard library only. Needs CLOUDFLARE_ANALYTICS_API_TOKEN (Account Analytics
Read) and CLOUDFLARE_ACCOUNT_ID. No database or paid API calls.

Run it::

    python scripts/report_page_speed_by_address.py
    python scripts/report_page_speed_by_address.py --days 7 --json
    python scripts/report_page_speed_by_address.py --fail-on-breach
    python scripts/report_page_speed_by_address.py --what-moved
"""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

ENDPOINT = "https://api.cloudflare.com/client/v4/graphql"
HOST = "www.alethical.com"
MAIN_CONTENT_LIMIT_MS = 2500
LAYOUT_MOVEMENT_LIMIT = 0.1
MIN_MEASUREMENTS = 50
WHAT_MOVED_ROWS = 6
DOCUMENT_NAVIGATION_TYPES = (
    "navigate",
    "reload",
    "back-forward",
    "restore",
    "prerender",
)
NAVIGATION_ROLLOUT_COMPLETED_ON = date(2026, 9, 4)


@dataclass(frozen=True)
class Address:
    """One page address to ask about, and how to name it to a person."""

    key: str
    label: str
    #: A Cloudflare filter fragment. ``requestPath_like`` with a trailing ``%``
    #: covers a family of addresses that differ only by the record they show.
    filter_fragment: str


#: The money addresses #1966's limit is written about, then the read surfaces
#: that share the same page shell, then the whole site for comparison. A
#: committee's own page is a family, not 1 address, so it is matched by prefix.
ADDRESSES: tuple[Address, ...] = (
    Address("money", "/money", 'requestPath: "/money"'),
    Address(
        "money_committees", "/money/committees", 'requestPath: "/money/committees"'
    ),
    Address("money_races", "/money/races", 'requestPath: "/money/races"'),
    Address(
        "money_outside_spending",
        "/money/outside-spending",
        'requestPath: "/money/outside-spending"',
    ),
    Address("money_search", "/money/search", 'requestPath: "/money/search"'),
    Address(
        "money_committee_pages",
        "/money/committees/<committee>",
        # The second wildcard is what keeps a committee's own page to itself. A
        # plain prefix match also swept in the payments page below, and 2 pages
        # with 2 speeds average into a figure true of neither. Both filters were
        # run against the live account on 7 Sep 2026 and returned separate counts.
        'requestPath_like: "/money/committees/%",'
        ' requestPath_notlike: "/money/committees/%/%"',
    ),
    Address(
        "money_committee_payments",
        "/money/committees/<committee>/payments",
        'requestPath_like: "/money/committees/%/payments"',
    ),
    Address("bills", "/bills", 'requestPath: "/bills"'),
    Address("home", "/", 'requestPath: "/"'),
    Address("sitewide", "every address", ""),
)


@dataclass(frozen=True)
class Reading:
    """Per-metric observations and scores; unavailable counts remain unknown."""

    address: Address
    main_content_ms: float | None
    main_content_measurements: int | None
    layout_movement: float | None
    layout_movement_measurements: int | None


def build_query(addresses: tuple[Address, ...], *, what_moved: bool = False) -> str:
    """Get each address's percentile over all allowed document kinds together.

    Never recombine per-kind percentiles. Element rows are ordered by estimated
    observation volume, but displayed counts are actual confidence sample sizes.

    The element rows also ask for 2 of Cloudflare's 3 movement bands, which is what
    lets a count of observations over issue 1966's own 0.1 limit be read rather than
    inferred. Google calls a visit Good at 0.1 or less, Needs Improvement above 0.1
    up to 0.25, and Poor above 0.25, so 0.1 is exactly the Good band's upper edge and
    everything outside it is over our limit. Counting the Poor band alone, as a first
    version did, passed every visit between 0.1 and 0.25 under a column calling them
    over the limit. Read as confidence sample sizes the 3 bands add up to the total
    exactly, checked against the live account on 7 Sep 2026: 495 Good, 3 Needs
    Improvement and 544 Poor against a total of 1,042.
    """
    selections = []
    for address in addresses:
        extra = f", {address.filter_fragment}" if address.filter_fragment else ""
        order = "orderBy: [sum_clsTotal_DESC]" if what_moved else ""
        fields = (
            "dimensions { cumulativeLayoutShiftElement }\n"
            "      quantiles { cumulativeLayoutShiftP75 }\n"
            "      confidence(level: 0.95) { sum { clsTotal { sampleSize }"
            " clsNeedsImprovement { sampleSize } clsPoor { sampleSize } } }"
            if what_moved
            else "quantiles { largestContentfulPaintP75 cumulativeLayoutShiftP75 }\n"
            "      confidence(level: 0.95) { sum { lcpTotal { sampleSize } clsTotal { sampleSize } } }"
        )
        selections.append(f"""    {address.key}: rumWebVitalsEventsAdaptiveGroups(
      limit: {WHAT_MOVED_ROWS if what_moved else 1}
      {order}
      filter: {{
        requestHost: $host
        date_geq: $start
        date_leq: $end
        bot: 0
        navigationType_in: {json.dumps(DOCUMENT_NAVIGATION_TYPES)}{extra}
      }}
    ) {{
      {fields}
    }}""")
    body = "\n".join(selections)
    return (
        "query PageSpeedByAddress("
        "$accountTag: string!, $host: string!, $start: Date!, $end: Date!) {\n"
        "  viewer {\n"
        "    accounts(filter: { accountTag: $accountTag }) {\n"
        f"{body}\n"
        "    }\n"
        "  }\n"
        "}"
    )


def build_what_moved_query(addresses: tuple[Address, ...]) -> str:
    """Use exactly the same population and count source for the element report."""
    return build_query(addresses, what_moved=True)


def measurement(value: object) -> float | None:
    """A finite nonnegative score; Cloudflare's -1 means no measurement."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        number = float(value)
    except OverflowError:
        return None
    return number if math.isfinite(number) and number >= 0 else None


def sample_count(group: dict, metric: str) -> int | None:
    """Read actual observations; never reconstruct them from adaptive estimates."""
    value: object = group
    for key in ("confidence", "sum", metric, "sampleSize"):
        value = value.get(key) if isinstance(value, dict) else None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if (
        value < 0
        or value > 2**53 - 1
        or not math.isfinite(value)
        or int(value) != value
    ):
        return None
    return int(value)


def over_our_limit(group: dict) -> int | None:
    """Observations Cloudflare puts outside its Good band, which ends at our limit.

    That is the Needs Improvement band (above 0.1 up to 0.25) plus the Poor band
    (above 0.25). Both counts are actual observations, never adaptive estimates, so
    this is read from the records rather than inferred from a threshold that is not
    ours. Either band missing makes the answer unknown rather than smaller.
    """
    total = 0
    for band in ("clsNeedsImprovement", "clsPoor"):
        count = sample_count(group, band)
        if count is None:
            return None
        total += count
    return total


def read_group(
    address: Address, groups: object, min_measurements: int = MIN_MEASUREMENTS
) -> Reading:
    """Keep unrounded source scores for comparisons and JSON; format only at display."""
    group = groups[0] if isinstance(groups, list) and len(groups) == 1 else None
    group = group if isinstance(group, dict) else {}
    quantiles = group.get("quantiles")
    quantiles = quantiles if isinstance(quantiles, dict) else {}
    main_count = sample_count(group, "lcpTotal")
    layout_count = sample_count(group, "clsTotal")
    main_micros = measurement(quantiles.get("largestContentfulPaintP75"))
    layout = measurement(quantiles.get("cumulativeLayoutShiftP75"))
    minimum = max(MIN_MEASUREMENTS, min_measurements)
    return Reading(
        address=address,
        main_content_ms=(
            main_micros / 1000
            if main_micros is not None
            and main_count is not None
            and main_count >= minimum
            else None
        ),
        main_content_measurements=main_count,
        layout_movement=(
            layout
            if layout is not None
            and layout_count is not None
            and layout_count >= minimum
            else None
        ),
        layout_movement_measurements=layout_count,
    )


def complete_window(
    days: int = 30, *, now: datetime | None = None
) -> tuple[date, date]:
    """Inclusive full UTC days, excluding the day currently in progress."""
    today = (now or datetime.now(UTC)).astimezone(UTC).date()
    return today - timedelta(days=days), today - timedelta(days=1)


def first_full_day_after(released_at: datetime) -> date:
    """The first whole UTC day that lies entirely after a release went out.

    Cloudflare's windows are whole UTC days, so the day a release merged still
    holds the hours before it merged. A reading meant to say how the site behaves
    now has to start the day after, or it averages a fix together with the thing
    it fixed. Issue 2022 was filed on exactly that: a 5 to 7 September window was
    being read as post-release for a change that shipped on 7 September.
    """
    return released_at.astimezone(UTC).date() + timedelta(days=1)


def release_merged_at(commit: str) -> datetime:
    """When a commit landed, read from git rather than typed in by hand."""
    result = subprocess.run(
        ["git", "show", "-s", "--format=%cI", commit],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0 or not result.stdout.strip():
        raise ValueError(f"git does not know the commit {commit!r}")
    return datetime.fromisoformat(result.stdout.strip().splitlines()[-1])


def population_note(started_on: date) -> str:
    note = (
        "Document navigation types: "
        + ", ".join(DOCUMENT_NAVIGATION_TYPES)
        + ". Known bots excluded; cached and prefetched deliveries included."
        " Native soft navigation and routing-apis records are excluded."
    )
    if started_on < NAVIGATION_ROLLOUT_COMPLETED_ON:
        note += (
            " Before 2026-09-04, Cloudflare's navigate bucket could include older"
            " soft-navigation records; this window cannot isolate them."
        )
    return note


def breaches(reading: Reading) -> list[str]:
    """Name only a limit that has a score measured above it."""
    over = []
    if (
        reading.main_content_ms is not None
        and reading.main_content_ms > MAIN_CONTENT_LIMIT_MS
    ):
        over.append("main content")
    if (
        reading.layout_movement is not None
        and reading.layout_movement > LAYOUT_MOVEMENT_LIMIT
    ):
        over.append("layout movement")
    return over


def cell(
    value: float | None,
    samples: int | None,
    min_samples: int,
    suffix: str,
    *,
    precision: int = 3,
) -> str:
    if value is None:
        if samples is None:
            return "unavailable"
        if samples < max(MIN_MEASUREMENTS, min_samples):
            return f"too few ({samples})"
        return "not measured"
    return f"{round(value, precision):g}{suffix}"


def count_label(count: int | None) -> str:
    return str(count) if count is not None else "unavailable"


def format_table(
    readings: list[Reading],
    started_on: date,
    ended_on: date,
    min_measurements: int,
    title: str,
) -> str:
    header = (
        "Page address",
        "Main content",
        "Layout movement",
        "Measurements",
        "Over the limit",
    )
    rows = [header]
    for reading in readings:
        over = breaches(reading)
        incomplete = reading.main_content_ms is None or reading.layout_movement is None
        counts = count_label(reading.main_content_measurements)
        if reading.main_content_measurements != reading.layout_movement_measurements:
            counts += " / " + count_label(reading.layout_movement_measurements)
        rows.append(
            (
                reading.address.label,
                cell(
                    reading.main_content_ms,
                    reading.main_content_measurements,
                    min_measurements,
                    " ms",
                    precision=1,
                ),
                cell(
                    reading.layout_movement,
                    reading.layout_movement_measurements,
                    min_measurements,
                    "",
                ),
                counts,
                ", ".join(over) if over else ("not known yet" if incomplete else "no"),
            )
        )
    widths = [max(len(row[column]) for row in rows) for column in range(len(header))]
    lines = [title, ""]
    for index, row in enumerate(rows):
        lines.append(
            "  ".join(
                value.ljust(widths[column]) for column, value in enumerate(row)
            ).rstrip()
        )
        if index == 0:
            lines.append("  ".join("-" * width for width in widths))
    return "\n".join(lines)


def format_report(
    document_loads: list[Reading],
    started_on: date,
    ended_on: date,
    min_measurements: int,
    bound: str | None = None,
) -> str:
    return "\n".join(
        [
            f"Real-visitor measurements for {HOST}, {started_on} to {ended_on}, 75th percentile.",
            f"Limits (https://github.com/alethical-org/alethical/issues/1966): main content {MAIN_CONTENT_LIMIT_MS} ms, layout movement {LAYOUT_MOVEMENT_LIMIT}.",
            f"A figure resting on fewer than {max(MIN_MEASUREMENTS, min_measurements)} observations is withheld, not a pass.",
            *([bound] if bound else []),
            "Main content is the browser's largest-content measurement, not an app-ready timer. September 4 browser checks selected the server-written snapshot.",
            "Counts are actual observations from Cloudflare confidence sample sizes.",
            "Limits use unrounded scores; displayed figures are rounded.",
            "",
            format_table(
                document_loads,
                started_on,
                ended_on,
                min_measurements,
                "DOCUMENT LOADS (including reloads and browser-history restores)",
            ),
            "",
            population_note(started_on),
        ]
    )


def format_what_moved(
    blamed: list[tuple[Address, list[dict]]],
    started_on: date,
    ended_on: date,
    min_measurements: int = MIN_MEASUREMENTS,
) -> str:
    lines = [
        f"What visitors' browsers blamed for movement, {HOST}, {started_on} to {ended_on}.",
        "Counts are Cloudflare confidence sample sizes. Rows rank by estimated measurement volume, not movement size.",
        f'"Over {LAYOUT_MOVEMENT_LIMIT}" counts observations Cloudflare places above'
        " its Good band, whose upper edge is that same limit: its Needs Improvement"
        " band (above 0.1 up to 0.25) plus its Poor band (above 0.25).",
        "An element is part of our own page; nothing about the reader is asked for.",
        population_note(started_on),
    ]
    for address, rows in blamed:
        lines.extend(["", address.label])
        if not rows:
            lines.append("  nothing measured")
        for row in rows:
            count = sample_count(row, "clsTotal")
            quantiles = row.get("quantiles")
            value = (
                measurement(quantiles.get("cumulativeLayoutShiftP75"))
                if isinstance(quantiles, dict)
                else None
            )
            if count is None or count < max(MIN_MEASUREMENTS, min_measurements):
                value = None
            dimensions = row.get("dimensions")
            element = (
                dimensions.get("cumulativeLayoutShiftElement")
                if isinstance(dimensions, dict)
                else None
            )
            movement = cell(value, count, min_measurements, "")
            over = over_our_limit(row)
            over_label = "count unknown" if over is None else str(over)
            lines.append(
                f"  {count_label(count)} measurements,"
                f" {over_label} over {LAYOUT_MOVEMENT_LIMIT},"
                f" 75th percentile {movement} {element or 'nothing moved'}"
            )
    return "\n".join(lines)


def as_json(
    document_loads: list[Reading],
    started_on: date,
    ended_on: date,
    min_measurements: int = MIN_MEASUREMENTS,
    bound: str | None = None,
) -> str:
    return json.dumps(
        {
            "host": HOST,
            "periodStartedOn": started_on.isoformat(),
            "periodEndedOn": ended_on.isoformat(),
            "percentile": 75,
            "mainContentLimitMs": MAIN_CONTENT_LIMIT_MS,
            "layoutMovementLimit": LAYOUT_MOVEMENT_LIMIT,
            "measurementScope": "document-loads",
            "navigationTypes": DOCUMENT_NAVIGATION_TYPES,
            "knownBotsExcluded": True,
            "sampleCountSource": "cloudflare-confidence",
            "minimumSamples": max(MIN_MEASUREMENTS, min_measurements),
            "populationNote": population_note(started_on),
            "releaseBound": bound,
            "documentLoads": [
                {
                    "address": reading.address.label,
                    "mainContentMs": reading.main_content_ms,
                    "mainContentMeasurements": reading.main_content_measurements,
                    "layoutMovement": reading.layout_movement,
                    "layoutMovementMeasurements": reading.layout_movement_measurements,
                    "overTheLimit": breaches(reading),
                }
                for reading in document_loads
            ],
        },
        indent=2,
    )


def ask_cloudflare(query: str, variables: dict[str, str], token: str) -> dict:
    request = urllib.request.Request(
        ENDPOINT,
        data=json.dumps({"query": query, "variables": variables}).encode("utf-8"),
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__ or "")
    parser.add_argument(
        "--days",
        type=int,
        default=30,
        help="Complete UTC days ending yesterday; 30 by default.",
    )
    parser.add_argument(
        "--since-release",
        metavar="COMMIT",
        help=(
            "Read only the days after this commit went live. The window starts on"
            " the first whole UTC day after it merged, because the merge day itself"
            " still holds the hours before it. Overrides --days."
        ),
    )
    parser.add_argument(
        "--since",
        metavar="YYYY-MM-DD",
        help=(
            "Read from this date onwards. Overrides --days. For a release boundary"
            " that is a date rather than a commit in this repository."
        ),
    )
    parser.add_argument(
        "--min-measurements",
        type=int,
        default=MIN_MEASUREMENTS,
        help="Actual observations required for a score; at least 50.",
    )
    parser.add_argument("--json", action="store_true", help="Print readings as JSON.")
    parser.add_argument(
        "--what-moved",
        action="store_true",
        help="Print the page elements blamed for movement instead.",
    )
    parser.add_argument(
        "--fail-on-breach",
        action="store_true",
        help="Exit 1 when a measured money-page score exceeds a limit.",
    )
    args = parser.parse_args(argv)
    if args.days < 1:
        parser.error("--days must be at least 1")
    if args.min_measurements < MIN_MEASUREMENTS:
        parser.error("--min-measurements must be at least 50")
    token = (os.environ.get("CLOUDFLARE_ANALYTICS_API_TOKEN") or "").strip()
    account = (os.environ.get("CLOUDFLARE_ACCOUNT_ID") or "").strip()
    if not token or not account:
        print(
            "Set CLOUDFLARE_ANALYTICS_API_TOKEN (Account Analytics Read) and CLOUDFLARE_ACCOUNT_ID first.",
            file=sys.stderr,
        )
        return 2
    started_on, ended_on = complete_window(args.days)
    bound: str | None = None
    if args.since_release and args.since:
        print("Give either --since-release or --since, not both.", file=sys.stderr)
        return 2
    if args.since_release:
        try:
            merged_at = release_merged_at(args.since_release)
        except ValueError as error:
            print(str(error), file=sys.stderr)
            return 2
        started_on = first_full_day_after(merged_at)
        bound = (
            f"Bounded to after {args.since_release[:12]}, which merged"
            f" {merged_at.astimezone(UTC):%Y-%m-%d %H:%M} UTC, so the window starts"
            f" on the first whole day after it, {started_on}."
        )
    elif args.since:
        try:
            started_on = date.fromisoformat(args.since)
        except ValueError:
            print(
                f"--since needs a date like 2026-09-08, not {args.since!r}.",
                file=sys.stderr,
            )
            return 2
        bound = f"Bounded to {started_on} onwards, as asked for."
    if started_on > ended_on:
        print(
            "No whole day has passed inside that bound yet: it starts on"
            f" {started_on} and the last complete day is {ended_on}. Nothing is"
            " reported, because an empty reading is not a pass.",
            file=sys.stderr,
        )
        return 2
    variables = {
        "accountTag": account,
        "host": HOST,
        "start": started_on.isoformat(),
        "end": ended_on.isoformat(),
    }
    query = (
        build_what_moved_query(ADDRESSES) if args.what_moved else build_query(ADDRESSES)
    )
    try:
        payload = ask_cloudflare(query, variables, token)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        print("Cloudflare could not be read.", file=sys.stderr)
        return 2
    if payload.get("errors"):
        print("Cloudflare returned errors.", file=sys.stderr)
        return 2
    accounts = (((payload.get("data") or {}).get("viewer") or {}).get("accounts")) or []
    if not accounts:
        print(
            "Cloudflare returned no account. Check CLOUDFLARE_ACCOUNT_ID.",
            file=sys.stderr,
        )
        return 2
    if args.what_moved:
        blamed = [
            (
                address,
                [
                    row
                    for row in (accounts[0].get(address.key) or [])
                    if isinstance(row, dict)
                ],
            )
            for address in ADDRESSES
        ]
        print(format_what_moved(blamed, started_on, ended_on, args.min_measurements))
        return 0
    readings = [
        read_group(address, accounts[0].get(address.key), args.min_measurements)
        for address in ADDRESSES
    ]
    print(
        as_json(readings, started_on, ended_on, args.min_measurements, bound)
        if args.json
        else format_report(readings, started_on, ended_on, args.min_measurements, bound)
    )
    if args.fail_on_breach:
        over = [
            reading.address.label
            for reading in readings
            if reading.address.key.startswith("money") and breaches(reading)
        ]
        if over:
            print("\nOver a money-page limit: " + ", ".join(over), file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
