#!/usr/bin/env python3
"""Report what real visitors waited for, one page address at a time.

Alethical already measures the speed of real visits. Cloudflare Web Analytics
runs on every page (``apps/frontend/public/index.html`` loads its public beacon)
and records the 3 Core Web Vitals, and ``api/traffic-performance.ts`` publishes
the **sitewide** figures on the public Site metrics page. So nothing new has to
be built or loaded into the browser to measure a real visit, and this file loads
nothing: it reads what Cloudflare already holds.

What the sitewide figure cannot do is answer a limit written per address.
`Issue #1966 <https://github.com/alethical-org/alethical/issues/1966>`_ sets one
for the money pages: main content within 2.5 seconds and unexpected layout
movement at 0.1 or less, for the slowest 1 in 4 visits. A single number covering
every page on the site cannot be checked against it, because a fast page and a
slow one average into something true of neither. This asks Cloudflare the same
question one address at a time.

**Why the answer is not simply added to the public page.** Alethical's own
privacy policy (``apps/frontend/src/screens/LegalScreens.tsx``) tells readers
twice that "Alethical publishes only sitewide speed totals" and "only sitewide
30-day speed scores and sample counts". Publishing a per-address breakdown there
would contradict a promise a reader has already read, and changing that promise
is the Alethical team's decision, not a side effect of a measurement job. So this
is a command-line tool: it reads privately, prints to whoever ran it, and
publishes nothing. ``docs/product-onboarding/traffic-guide.md`` carries the same
distinction.

Nothing here identifies a reader. A page address describes the page, not the
person who opened it; Cloudflare already receives these paths (with the question
text after ``?`` removed) and the privacy policy says so. This asks for 2 timing
percentiles and 2 sample counts per address, and for no country, device, browser,
element, resource or referrer.

**Two things this gets right that a first version got wrong**, both found on
4 Sep 2026 when the numbers could not be reconciled with a browser measurement of
the same page:

* *Cloudflare's reported totals are estimates, not measurement counts.* ``lcpTotal``
  is the raw number of measurements multiplied by ``sampleInterval``. Over 28 days
  that interval was about 10, and every reported total came back a round multiple
  of 10; over 7 days it was about 1 and the totals were not round. So a floor
  applied to the reported total lets through a percentile drawn from 4 real
  measurements while appearing to require 50. Every count here is the reported
  total divided by the interval, and the floor applies to that.
* *A percentile mixes first loads with clicks inside the site, and those are
  different events.* Cloudflare's ``navigationType`` separates them, and on the
  money addresses over 7 days a first load measured 1,536 ms against 58 ms for an
  in-app click. A release limit about first-load speed has to filter to first
  loads, or a page that people mostly click into scores as though it were instant.

The default window is 7 days because Cloudflare keeps that period unsampled, which
is what makes a small address's count trustworthy. A longer window buys more visits
and pays for them in sampling.

*One remaining honest limit.* Unexpected layout movement appears to stop at 1.
Measured 4 Sep 2026: across 130 address groups over 30 days, no value above 1
appeared at any percentile up to the slowest 1 in 1000. So read a printed 1.000 as
"1 or worse", which is 10 times the limit either way.

Reads 1 Cloudflare address. Pure standard library, no database, no paid call.

Needs 2 settings, the same 2 the website already uses
(``docs/product-onboarding/traffic-guide.md``):

* ``CLOUDFLARE_ANALYTICS_API_TOKEN`` - limited to Account Analytics Read; and
* ``CLOUDFLARE_ACCOUNT_ID``.

Run it::

    CLOUDFLARE_ANALYTICS_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \\
        python scripts/report_page_speed_by_address.py

    python scripts/report_page_speed_by_address.py --days 28 --json
    python scripts/report_page_speed_by_address.py --fail-on-breach
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import date, timedelta

ENDPOINT = "https://api.cloudflare.com/client/v4/graphql"
HOST = "www.alethical.com"

#: Issue #1966's release limits, for the slowest 1 in 4 visits.
MAIN_CONTENT_LIMIT_MS = 2500
LAYOUT_MOVEMENT_LIMIT = 0.1

#: Cloudflare writes "no measurement" as -1 rather than leaving the field out.
NO_MEASUREMENT = -1

#: Cloudflare's name for a real page load, where the browser fetches the document.
#: This is the event issue 1966's limit is about.
FIRST_LOAD = "navigate"
#: Cloudflare's name for a move between addresses made by the program already
#: running in the page. Fast for the same reason it is not a first load.
IN_APP_CLICK = "routing-apis"


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
        'requestPath_like: "/money/committees/%"',
    ),
    Address("bills", "/bills", 'requestPath: "/bills"'),
    Address("home", "/", 'requestPath: "/"'),
    Address("sitewide", "every address", ""),
)


@dataclass(frozen=True)
class Reading:
    """What Cloudflare reported for 1 address, with counts made honest.

    ``*_measurements`` are real measurement counts, not Cloudflare's reported
    totals: it multiplies those by ``sample_interval`` before returning them.
    """

    address: Address
    navigation: str
    main_content_ms: float | None
    main_content_measurements: int
    layout_movement: float | None
    layout_movement_measurements: int
    sample_interval: float


def build_query(addresses: tuple[Address, ...], navigation: str) -> str:
    """One request asking the same question once per address.

    Each address becomes its own named selection with its own filter, so the
    percentiles come back already separated rather than needing to be
    recombined here, which is not something a percentile allows.

    ``navigation`` restricts every selection to one kind of page load. Leaving it
    out is what made a first version's figures unreconcilable with a browser
    measurement of the same page: a percentile over both kinds at once is not a
    percentile of anything a reader does.
    """
    selections = []
    for address in addresses:
        extra = f", {address.filter_fragment}" if address.filter_fragment else ""
        selections.append(
            f"""    {address.key}: rumWebVitalsEventsAdaptiveGroups(
      limit: 1
      filter: {{
        requestHost: $host
        date_geq: $start
        date_leq: $end
        navigationType: "{navigation}"{extra}
      }}
    ) {{
      quantiles {{ largestContentfulPaintP75 cumulativeLayoutShiftP75 }}
      sum {{ lcpTotal clsTotal }}
      avg {{ sampleInterval }}
    }}"""
        )
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


def measurement(value: object) -> float | None:
    """A number Cloudflare actually measured, or nothing.

    Cloudflare answers -1 where it has no measurement, so a caller that only
    checked for ``None`` would print minus one millisecond as a speed.
    """
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return None
    number = float(value)
    if number == NO_MEASUREMENT or number < 0:
        return None
    return number


def real_measurements(reported_total: object, sample_interval: float) -> int:
    """How many measurements are actually behind a percentile.

    Cloudflare's ``lcpTotal`` and ``clsTotal`` are the raw count multiplied by
    ``sampleInterval``, so they are estimates of visits rather than counts of
    measurements. Dividing puts the count back. Over 28 days the interval was
    about 10 and every reported total came back a round multiple of 10; over 7
    days, which Cloudflare keeps unsampled, the interval was about 1 and the
    totals were not round.
    """
    if not isinstance(reported_total, (int, float)) or isinstance(reported_total, bool):
        return 0
    if sample_interval <= 0:
        return 0
    return max(round(float(reported_total) / sample_interval), 0)


def read_group(
    address: Address, navigation: str, groups: object, min_measurements: int
) -> Reading:
    """Turn 1 address's answer into a reading, withholding thin percentiles."""
    group: dict[str, object] = {}
    if isinstance(groups, list) and groups and isinstance(groups[0], dict):
        group = groups[0]

    def part(name: str) -> dict[str, object]:
        value = group.get(name)
        return value if isinstance(value, dict) else {}

    quantiles = part("quantiles")
    sums = part("sum")
    averages = part("avg")

    # An absent interval means Cloudflare returned no group at all, and 1 is the
    # only safe reading: it leaves the reported total alone rather than inventing
    # measurements that were never taken.
    interval = measurement(averages.get("sampleInterval")) or 1.0
    main_count = real_measurements(sums.get("lcpTotal"), interval)
    layout_count = real_measurements(sums.get("clsTotal"), interval)
    main_micros = measurement(quantiles.get("largestContentfulPaintP75"))
    layout = measurement(quantiles.get("cumulativeLayoutShiftP75"))
    return Reading(
        address=address,
        navigation=navigation,
        main_content_ms=(
            round(main_micros / 1000, 1)
            if main_micros is not None and main_count >= min_measurements
            else None
        ),
        main_content_measurements=main_count,
        layout_movement=(
            round(layout, 3)
            if layout is not None and layout_count >= min_measurements
            else None
        ),
        layout_movement_measurements=layout_count,
        sample_interval=interval,
    )


def breaches(reading: Reading) -> list[str]:
    """Which of #1966's 2 limits this address is measured to be over."""
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


def cell(value: float | None, samples: int, min_samples: int, suffix: str) -> str:
    """A measured figure, or why there is none."""
    if value is None:
        if samples < min_samples:
            return f"too few ({samples})"
        return "not measured"
    return f"{value:g}{suffix}"


def format_table(
    readings: list[Reading],
    started_on: date,
    ended_on: date,
    min_measurements: int,
    title: str,
) -> str:
    """One block of the report, as plain text for whoever ran the command."""
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
        nothing_measured = (
            reading.main_content_ms is None and reading.layout_movement is None
        )
        counts = (
            f"{reading.main_content_measurements}"
            if reading.main_content_measurements == reading.layout_movement_measurements
            else f"{reading.main_content_measurements} / "
            f"{reading.layout_movement_measurements}"
        )
        rows.append(
            (
                reading.address.label,
                cell(
                    reading.main_content_ms,
                    reading.main_content_measurements,
                    min_measurements,
                    " ms",
                ),
                cell(
                    reading.layout_movement,
                    reading.layout_movement_measurements,
                    min_measurements,
                    "",
                ),
                counts,
                # A withheld figure is not a pass, so it never prints "no".
                ", ".join(over)
                if over
                else ("not known yet" if nothing_measured else "no"),
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
    intervals = [r.sample_interval for r in readings]
    if intervals and max(intervals) > 1.05:
        lines.append("")
        lines.append(
            "Cloudflare sampled this window: it kept 1 measurement per"
            f" {min(intervals):.1f} to {max(intervals):.1f} visits, so the counts"
            " above are its reported totals divided back down. A shorter window is"
            " sampled less."
        )
    return "\n".join(lines)


def format_report(
    first_loads: list[Reading],
    in_app_clicks: list[Reading],
    started_on: date,
    ended_on: date,
    min_measurements: int,
) -> str:
    """Both blocks, with the limits and the withholding rule stated once."""
    preamble = [
        f"Real visits to {HOST}, {started_on} to {ended_on}, slowest 1 in 4.",
        f"Limits (issue 1966): main content {MAIN_CONTENT_LIMIT_MS} ms, layout"
        f" movement {LAYOUT_MOVEMENT_LIMIT}. They are about a first load, so only the"
        " first block is judged against them.",
        f"A figure resting on fewer than {min_measurements} real measurements is"
        " withheld, not shown, and a withheld figure never counts as a limit met.",
        "",
    ]
    return "\n".join(
        preamble
        + [
            format_table(
                first_loads,
                started_on,
                ended_on,
                min_measurements,
                "FIRST LOAD (the browser fetched the page)",
            ),
            "",
            format_table(
                in_app_clicks,
                started_on,
                ended_on,
                min_measurements,
                "CLICKED INSIDE THE SITE (the program already running drew the page)",
            ),
        ]
    )


def as_json(
    first_loads: list[Reading],
    in_app_clicks: list[Reading],
    started_on: date,
    ended_on: date,
) -> str:
    def block(readings: list[Reading]) -> list[dict]:
        return [
            {
                "address": reading.address.label,
                "mainContentMs": reading.main_content_ms,
                "mainContentMeasurements": reading.main_content_measurements,
                "layoutMovement": reading.layout_movement,
                "layoutMovementMeasurements": reading.layout_movement_measurements,
                "sampleInterval": round(reading.sample_interval, 2),
                "overTheLimit": breaches(reading),
            }
            for reading in readings
        ]

    return json.dumps(
        {
            "host": HOST,
            "periodStartedOn": started_on.isoformat(),
            "periodEndedOn": ended_on.isoformat(),
            "percentile": 75,
            "mainContentLimitMs": MAIN_CONTENT_LIMIT_MS,
            "layoutMovementLimit": LAYOUT_MOVEMENT_LIMIT,
            "firstLoad": block(first_loads),
            "clickedInsideTheSite": block(in_app_clicks),
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
        default=7,
        help=(
            "How many days back to read. 7 by default, because Cloudflare keeps"
            " that period unsampled, which is what makes a small address's count"
            " trustworthy."
        ),
    )
    parser.add_argument(
        "--min-measurements",
        type=int,
        default=50,
        help=(
            "Withhold a percentile resting on fewer real measurements than this."
            " Counted after dividing out Cloudflare's sampling."
        ),
    )
    parser.add_argument(
        "--json", action="store_true", help="Print the readings as JSON."
    )
    parser.add_argument(
        "--fail-on-breach",
        action="store_true",
        help=(
            "Exit 1 when a money address's first-load figure is over one of issue"
            " 1966's limits."
        ),
    )
    args = parser.parse_args(argv)

    token = (os.environ.get("CLOUDFLARE_ANALYTICS_API_TOKEN") or "").strip()
    account = (os.environ.get("CLOUDFLARE_ACCOUNT_ID") or "").strip()
    if not token or not account:
        print(
            "Set CLOUDFLARE_ANALYTICS_API_TOKEN (Account Analytics Read) and"
            " CLOUDFLARE_ACCOUNT_ID first. Both are listed in"
            " docs/product-onboarding/traffic-guide.md.",
            file=sys.stderr,
        )
        return 2

    ended_on = date.today()
    started_on = ended_on - timedelta(days=max(args.days, 1) - 1)
    variables = {
        "accountTag": account,
        "host": HOST,
        "start": started_on.isoformat(),
        "end": ended_on.isoformat(),
    }

    blocks: dict[str, list[Reading]] = {}
    for navigation in (FIRST_LOAD, IN_APP_CLICK):
        try:
            payload = ask_cloudflare(
                build_query(ADDRESSES, navigation), variables, token
            )
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            print(f"Cloudflare could not be read: {error}", file=sys.stderr)
            return 2
        if payload.get("errors"):
            print(f"Cloudflare returned errors: {payload['errors']}", file=sys.stderr)
            return 2
        accounts = (
            ((payload.get("data") or {}).get("viewer") or {}).get("accounts")
        ) or []
        if not accounts:
            print(
                "Cloudflare returned no account. Check CLOUDFLARE_ACCOUNT_ID.",
                file=sys.stderr,
            )
            return 2
        blocks[navigation] = [
            read_group(
                address,
                navigation,
                accounts[0].get(address.key),
                args.min_measurements,
            )
            for address in ADDRESSES
        ]

    first_loads = blocks[FIRST_LOAD]
    in_app_clicks = blocks[IN_APP_CLICK]
    if args.json:
        print(as_json(first_loads, in_app_clicks, started_on, ended_on))
    else:
        print(
            format_report(
                first_loads,
                in_app_clicks,
                started_on,
                ended_on,
                args.min_measurements,
            )
        )

    if args.fail_on_breach:
        # First loads only: the limits are about the wait before a page appears,
        # and a click inside the site is a different event with its own numbers.
        over = [
            reading.address.label
            for reading in first_loads
            if reading.address.key.startswith("money") and breaches(reading)
        ]
        if over:
            print("\nOver a money-page limit: " + ", ".join(over), file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
