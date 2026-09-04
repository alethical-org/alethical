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

**Two honest limits on every number it prints.**

* *Cloudflare samples.* Its own ``sampleInterval`` says how heavily, and it is
  printed with the table. A percentile drawn from few measurements moves around,
  so a figure below ``--min-samples`` (50, matching what the public route already
  requires) is withheld rather than shown.
* *Unexpected layout movement appears to stop at 1.* Measured 4 Sep 2026: across
  130 address groups over 30 days, no value above 1 appeared at any percentile up
  to the slowest 1 in 1000. So read a printed 1.000 as "1 or worse", which is 10
  times the limit either way.

Reads 1 Cloudflare address. Pure standard library, no database, no paid call.

Needs 2 settings, the same 2 the website already uses
(``docs/product-onboarding/traffic-guide.md``):

* ``CLOUDFLARE_ANALYTICS_API_TOKEN`` - limited to Account Analytics Read; and
* ``CLOUDFLARE_ACCOUNT_ID``.

Run it::

    CLOUDFLARE_ANALYTICS_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \\
        python scripts/report_page_speed_by_address.py

    python scripts/report_page_speed_by_address.py --days 7 --json
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
    """What Cloudflare reported for 1 address."""

    address: Address
    main_content_ms: float | None
    main_content_samples: int
    layout_movement: float | None
    layout_movement_samples: int
    sample_interval: float | None


def build_query(addresses: tuple[Address, ...]) -> str:
    """One request asking the same question once per address.

    Each address becomes its own named selection with its own filter, so the
    percentiles come back already separated rather than needing to be
    recombined here, which is not something a percentile allows.
    """
    selections = []
    for address in addresses:
        extra = f", {address.filter_fragment}" if address.filter_fragment else ""
        selections.append(
            f"""    {address.key}: rumWebVitalsEventsAdaptiveGroups(
      limit: 1
      filter: {{ requestHost: $host, date_geq: $start, date_leq: $end{extra} }}
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


def sample_count(value: object) -> int:
    """How many measurements Cloudflare says are behind a percentile."""
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return 0
    return max(int(value), 0)


def read_group(address: Address, groups: object, min_samples: int) -> Reading:
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

    main_samples = sample_count(sums.get("lcpTotal"))
    layout_samples = sample_count(sums.get("clsTotal"))
    main_micros = measurement(quantiles.get("largestContentfulPaintP75"))
    layout = measurement(quantiles.get("cumulativeLayoutShiftP75"))
    return Reading(
        address=address,
        main_content_ms=(
            round(main_micros / 1000, 1)
            if main_micros is not None and main_samples >= min_samples
            else None
        ),
        main_content_samples=main_samples,
        layout_movement=(
            round(layout, 3)
            if layout is not None and layout_samples >= min_samples
            else None
        ),
        layout_movement_samples=layout_samples,
        sample_interval=measurement(averages.get("sampleInterval")),
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
    readings: list[Reading], started_on: date, ended_on: date, min_samples: int
) -> str:
    """The whole report, as plain text for whoever ran the command."""
    header = ("Page address", "Main content", "Layout movement", "Over the limit")
    rows = [header]
    for reading in readings:
        over = breaches(reading)
        nothing_measured = (
            reading.main_content_ms is None and reading.layout_movement is None
        )
        rows.append(
            (
                reading.address.label,
                cell(
                    reading.main_content_ms,
                    reading.main_content_samples,
                    min_samples,
                    " ms",
                ),
                cell(
                    reading.layout_movement,
                    reading.layout_movement_samples,
                    min_samples,
                    "",
                ),
                # A withheld figure is not a pass, so it never prints "no".
                ", ".join(over)
                if over
                else ("not known yet" if nothing_measured else "no"),
            )
        )
    widths = [max(len(row[column]) for row in rows) for column in range(len(header))]
    lines = [
        f"Real visits to {HOST}, {started_on} to {ended_on}, slowest 1 in 4.",
        f"Limits (issue 1966): main content {MAIN_CONTENT_LIMIT_MS} ms, layout movement"
        f" {LAYOUT_MOVEMENT_LIMIT}.",
        f"A figure with fewer than {min_samples} measurements is withheld, not shown.",
        "",
    ]
    for index, row in enumerate(rows):
        lines.append(
            "  ".join(
                value.ljust(widths[column]) for column, value in enumerate(row)
            ).rstrip()
        )
        if index == 0:
            lines.append("  ".join("-" * width for width in widths))
    intervals = [r.sample_interval for r in readings if r.sample_interval is not None]
    if intervals:
        lines.append("")
        lines.append(
            "Cloudflare keeps a sample rather than every visit: across the addresses"
            f" above it reported 1 measurement per {min(intervals):.0f} to"
            f" {max(intervals):.0f} visits."
        )
    return "\n".join(lines)


def as_json(readings: list[Reading], started_on: date, ended_on: date) -> str:
    return json.dumps(
        {
            "host": HOST,
            "periodStartedOn": started_on.isoformat(),
            "periodEndedOn": ended_on.isoformat(),
            "percentile": 75,
            "mainContentLimitMs": MAIN_CONTENT_LIMIT_MS,
            "layoutMovementLimit": LAYOUT_MOVEMENT_LIMIT,
            "addresses": [
                {
                    "address": reading.address.label,
                    "mainContentMs": reading.main_content_ms,
                    "mainContentSamples": reading.main_content_samples,
                    "layoutMovement": reading.layout_movement,
                    "layoutMovementSamples": reading.layout_movement_samples,
                    "overTheLimit": breaches(reading),
                }
                for reading in readings
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
        default=28,
        help="How many days back to read. 28 by default, matching the public route.",
    )
    parser.add_argument(
        "--min-samples",
        type=int,
        default=50,
        help="Withhold a percentile drawn from fewer measurements than this.",
    )
    parser.add_argument(
        "--json", action="store_true", help="Print the readings as JSON."
    )
    parser.add_argument(
        "--fail-on-breach",
        action="store_true",
        help="Exit 1 when a measured money address is over one of issue 1966's limits.",
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
    query = build_query(ADDRESSES)
    try:
        payload = ask_cloudflare(
            query,
            {
                "accountTag": account,
                "host": HOST,
                "start": started_on.isoformat(),
                "end": ended_on.isoformat(),
            },
            token,
        )
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        print(f"Cloudflare could not be read: {error}", file=sys.stderr)
        return 2
    if payload.get("errors"):
        print(f"Cloudflare returned errors: {payload['errors']}", file=sys.stderr)
        return 2
    accounts = (((payload.get("data") or {}).get("viewer") or {}).get("accounts")) or []
    if not accounts:
        print(
            "Cloudflare returned no account. Check CLOUDFLARE_ACCOUNT_ID.",
            file=sys.stderr,
        )
        return 2

    readings = [
        read_group(a, accounts[0].get(a.key), args.min_samples) for a in ADDRESSES
    ]
    if args.json:
        print(as_json(readings, started_on, ended_on))
    else:
        print(format_table(readings, started_on, ended_on, args.min_samples))

    if args.fail_on_breach:
        over = [
            r.address.label
            for r in readings
            if r.address.key.startswith("money") and breaches(r)
        ]
        if over:
            print(
                "\nOver a money-page limit: " + ", ".join(over),
                file=sys.stderr,
            )
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
