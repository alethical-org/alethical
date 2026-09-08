#!/usr/bin/env python3
"""Privately report how often a public read reached our own server, by address.

Every public page reports 2 speeds: one when Cloudflare already holds a copy of
the answer at a nearby location, and one when Railway has to build it. This says
how often each one happens, per API address, which is the number every speed
decision rested on and nobody had measured
([issue 2045](https://github.com/alethical-org/alethical/issues/2045)).

It reads aggregates Cloudflare already records for its own cache and adds no
tracking of readers: the only thing asked for per address is Cloudflare's cache
status. No country, device, browser, element, referrer, query string, network or
reader identity is requested, and ``test_report_origin_share_by_address.py`` pins
that. Verified bots are excluded by default because the reader-facing decisions
this informs are about people; ``--include-verified-bots`` reads the other
population, which is what our own server actually built.

Only ``api.alethical.com`` is behind Cloudflare's cache. The Vercel records for
``www.alethical.com`` are DNS-only, so Cloudflare sees none of the page HTML and
this tool cannot speak for it (`docs/operations/api-cdn-setup.md`).

Three shares are printed per address, and the first 2 differ by exactly one
Cloudflare status, so they are never the same question. Cloudflare's own
definitions, read at
https://developers.cloudflare.com/cache/concepts/cache-responses/ :

    built here    miss + expired + revalidated + updating. Our own server ran the
                  request. ``updating`` is in here because Cloudflare served the
                  reader a stale copy *and* refreshed it behind them.
    reader waited miss + expired + revalidated. The reader was the one who paid
                  for the origin read.
    from a copy   hit + updating + stale. The reader waited on no origin read.

``revalidated`` cannot occur here: the API sends no ``ETag`` and no
``Last-Modified`` (checked at the live origin, 8 Sep 2026), so Cloudflare has no
validator to make a conditional request with. It is classified anyway rather than
dropped, so adding validators later cannot silently move requests out of every
share.

``bypass``, ``dynamic`` and ``none`` are counted separately and excluded from all
3 shares: those requests were never eligible for a stored copy, so a cache window
could not have helped them and putting them in a denominator understates the
cache.

A share resting on fewer than 50 observations is withheld rather than printed,
because a percentage of 6 requests is not a measurement. ``count`` is Cloudflare's
own estimate of whole traffic, already scaled up for the records it dropped under
load; the records it actually kept are ``confidence.count.sampleSize``, and that is
what the floor is applied to. Multiplying ``count`` by the sampling interval would
scale it twice, and because each cache status is its own group with its own
interval, the double scaling moves the shares as well as the totals (measured
8 Sep 2026 on the bill list: 1.08 on misses against 1.12 on hits;
https://developers.cloudflare.com/analytics/graphql-api/features/confidence-intervals/).

Standard library only. Needs CLOUDFLARE_ANALYTICS_API_TOKEN (Account Analytics
Read) and CLOUDFLARE_ACCOUNT_ID. No database or paid API calls.

Run it::

    python scripts/report_origin_share_by_address.py
    python scripts/report_origin_share_by_address.py --days 7 --json
    python scripts/report_origin_share_by_address.py --include-verified-bots
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

ENDPOINT = "https://api.cloudflare.com/client/v4/graphql"
HOST = "api.alethical.com"
MIN_OBSERVATIONS = 50
STATUSES_PER_ADDRESS = 25
#: Cloudflare refused data older than 4 weeks 4 days on this account (read
#: 8 Sep 2026), so 28 complete days leaves a whole day of headroom whatever hour
#: the report is run at.
DEFAULT_DAYS = 28
MAX_DAYS = 30

#: Requests Cloudflare judged eligible for a stored copy. Everything outside this
#: set was never cacheable, so it belongs in no share.
ELIGIBLE_STATUSES = ("hit", "miss", "expired", "updating", "stale", "revalidated")
#: Our own server ran the request, whether or not the reader waited for it.
BUILT_HERE_STATUSES = ("miss", "expired", "revalidated", "updating")
#: The reader was the one who paid for that origin read.
READER_WAITED_STATUSES = ("miss", "expired", "revalidated")


@dataclass(frozen=True)
class Address:
    """One API address to ask about, and how to name it to a person."""

    key: str
    label: str
    #: A Cloudflare filter fragment. ``clientRequestPath_like`` with ``%`` covers a
    #: family of addresses that differ only by the record they carry.
    filter_fragment: str


#: The public read addresses, one family per row. A family whose members differ
#: only by which record they carry is matched by pattern, and the patterns are
#: written so no address is counted under 2 rows: a bill's own address excludes
#: anything with a further segment and excludes the featured list, which shares
#: its shape. The last row is every public read together.
ADDRESSES: tuple[Address, ...] = (
    Address("bill_list", "/api/v1/bills", 'clientRequestPath: "/api/v1/bills"'),
    Address(
        "bill_featured",
        "/api/v1/bills/featured",
        'clientRequestPath: "/api/v1/bills/featured"',
    ),
    Address(
        "bill_detail",
        "/api/v1/bills/<bill>",
        'clientRequestPath_like: "/api/v1/bills/%",'
        ' clientRequestPath_notlike: "/api/v1/bills/%/%",'
        ' clientRequestPath_neq: "/api/v1/bills/featured"',
    ),
    Address(
        "bill_votes",
        "/api/v1/bills/<bill>/votes",
        'clientRequestPath_like: "/api/v1/bills/%/votes"',
    ),
    Address(
        "bill_versions",
        "/api/v1/bills/<bill>/versions",
        'clientRequestPath_like: "/api/v1/bills/%/versions%"',
    ),
    Address(
        "legislator_list",
        "/api/v1/legislators",
        'clientRequestPath: "/api/v1/legislators"',
    ),
    Address(
        "legislator_detail",
        "/api/v1/legislators/<who>",
        'clientRequestPath_like: "/api/v1/legislators/%",'
        ' clientRequestPath_notlike: "/api/v1/legislators/%/%"',
    ),
    Address(
        "legislator_bills",
        "/api/v1/legislators/<who>/bills",
        'clientRequestPath_like: "/api/v1/legislators/%/bills"',
    ),
    Address(
        "legislator_votes",
        "/api/v1/legislators/<who>/votes",
        'clientRequestPath_like: "/api/v1/legislators/%/votes"',
    ),
    Address(
        "legislator_money",
        "/api/v1/legislators/<who>/campaign-finance",
        'clientRequestPath_like: "/api/v1/legislators/%/campaign-finance"',
    ),
    Address(
        "legislator_outside_spending",
        "/api/v1/legislators/<who>/independent-spending",
        'clientRequestPath_like: "/api/v1/legislators/%/independent-spending"',
    ),
    Address(
        "money_committees",
        "/api/v1/campaign-finance/committees",
        'clientRequestPath: "/api/v1/campaign-finance/committees"',
    ),
    Address(
        "money_filings",
        "/api/v1/campaign-finance/filings",
        'clientRequestPath: "/api/v1/campaign-finance/filings"',
    ),
    Address(
        "money_outside_spending",
        "/api/v1/campaign-finance/outside-spending",
        'clientRequestPath: "/api/v1/campaign-finance/outside-spending"',
    ),
    Address(
        "money_payments_under_name",
        "/api/v1/campaign-finance/payments-under-name",
        'clientRequestPath: "/api/v1/campaign-finance/payments-under-name"',
    ),
    Address(
        "money_races",
        "/api/v1/campaign-finance/races",
        'clientRequestPath: "/api/v1/campaign-finance/races"',
    ),
    Address(
        "money_search",
        "/api/v1/campaign-finance/search",
        'clientRequestPath: "/api/v1/campaign-finance/search"',
    ),
    Address(
        "money_summary",
        "/api/v1/campaign-finance/summary",
        'clientRequestPath: "/api/v1/campaign-finance/summary"',
    ),
    Address(
        "committee_finance",
        "/api/v1/committees/<n>/finance",
        'clientRequestPath_like: "/api/v1/committees/%/finance"',
    ),
    Address(
        "committee_payments",
        "/api/v1/committees/<n>/payments",
        'clientRequestPath_like: "/api/v1/committees/%/payments"',
    ),
    Address(
        "committee_filings",
        "/api/v1/committees/<n>/filings",
        'clientRequestPath_like: "/api/v1/committees/%/filings"',
    ),
    Address("meta", "/api/v1/meta", 'clientRequestPath: "/api/v1/meta"'),
    Address(
        "sessions", "/api/v1/sessions", 'clientRequestPath_like: "/api/v1/sessions%"'
    ),
    Address(
        "policy_areas",
        "/api/v1/policy-areas",
        'clientRequestPath: "/api/v1/policy-areas"',
    ),
    Address("search", "/api/v1/search", 'clientRequestPath: "/api/v1/search"'),
    Address(
        "all_public_reads", "every /api/v1 read", 'clientRequestPath_like: "/api/v1/%"'
    ),
)


@dataclass(frozen=True)
class Reading:
    """One address's counts; a share is None when too few requests were observed."""

    address: Address
    observations: int
    eligible_requests: float
    ineligible_requests: float
    built_here: float | None
    reader_waited: float | None
    from_a_copy: float | None
    by_status: dict[str, float]


def build_query(
    addresses: tuple[Address, ...], *, include_verified_bots: bool = False
) -> str:
    """Ask for each address's cache statuses, and for nothing about the requester.

    One aliased selection per address rather than one grouped query, for the same
    reason ``report_page_speed_by_address.py`` does it: a single grouped query is
    capped at a row limit, and the cap silently truncates the long tail of bill
    and committee addresses, so a family's total would be a share of whatever fit.
    """
    bot_filter = "" if include_verified_bots else '\n        verifiedBotCategory: ""'
    selections = []
    for address in addresses:
        selections.append(
            f"""    {address.key}: httpRequestsAdaptiveGroups(
      limit: {STATUSES_PER_ADDRESS}
      orderBy: [count_DESC]
      filter: {{
        datetime_geq: $start
        datetime_lt: $end
        clientRequestHTTPHost: $host
        clientRequestHTTPMethodName: "GET"{bot_filter}
        {address.filter_fragment}
      }}
    ) {{
      count
      confidence(level: 0.95) {{ count {{ sampleSize }} }}
      dimensions {{ cacheStatus }}
    }}"""
        )
    body = "\n".join(selections)
    return (
        "query OriginShareByAddress("
        "$accountTag: string!, $host: string!, $start: Time!, $end: Time!) {\n"
        "  viewer {\n"
        "    accounts(filter: { accountTag: $accountTag }) {\n"
        f"{body}\n"
        "    }\n"
        "  }\n"
        "}"
    )


def whole_number(value: object) -> int | None:
    """A non-negative whole number Cloudflare returned; anything else is unreadable."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(value) or value < 0 or value > 2**53 - 1:
        return None
    return int(value) if int(value) == value else None


def request_estimate(group: object) -> int | None:
    """Cloudflare's ``count``: its own estimate of whole traffic, already scaled."""
    return whole_number(group.get("count")) if isinstance(group, dict) else None


def kept_records(group: object) -> int | None:
    """``confidence.count.sampleSize``: the records Cloudflare actually kept."""
    value: object = group
    for key in ("confidence", "count", "sampleSize"):
        value = value.get(key) if isinstance(value, dict) else None
    return whole_number(value)


def read_groups(address: Address, groups: object) -> Reading:
    """Total one address's statuses, refusing a share that rests on too little.

    A malformed row makes the whole address unavailable rather than smaller: a
    dropped row would move a share without changing anything a reader could see.
    """
    rows = groups if isinstance(groups, list) else []
    by_status: dict[str, float] = {}
    observations = 0
    for group in rows:
        if not isinstance(group, dict):
            return Reading(address, 0, 0.0, 0.0, None, None, None, {})
        dimensions = group.get("dimensions")
        status = dimensions.get("cacheStatus") if isinstance(dimensions, dict) else None
        estimate = request_estimate(group)
        kept = kept_records(group)
        if (
            not isinstance(status, str)
            or not status
            or estimate is None
            or kept is None
        ):
            return Reading(address, 0, 0.0, 0.0, None, None, None, {})
        # ``count`` is already Cloudflare's whole-traffic estimate. Scaling it by
        # the sampling interval counted every dropped record twice, and moved the
        # shares because each status carries its own interval (issue 2121).
        by_status[status] = by_status.get(status, 0.0) + estimate
        observations += kept

    eligible = sum(by_status.get(status, 0.0) for status in ELIGIBLE_STATUSES)
    ineligible = sum(
        requests
        for status, requests in by_status.items()
        if status not in ELIGIBLE_STATUSES
    )
    measurable = observations >= MIN_OBSERVATIONS and eligible > 0

    def share(statuses: tuple[str, ...]) -> float | None:
        if not measurable:
            return None
        return sum(by_status.get(status, 0.0) for status in statuses) / eligible

    return Reading(
        address=address,
        observations=observations,
        eligible_requests=eligible,
        ineligible_requests=ineligible,
        built_here=share(BUILT_HERE_STATUSES),
        reader_waited=share(READER_WAITED_STATUSES),
        from_a_copy=share(("hit", "updating", "stale")),
        by_status=by_status,
    )


def complete_window(
    days: int = DEFAULT_DAYS, *, now: datetime | None = None
) -> tuple[date, date]:
    """Inclusive full UTC days, excluding the day currently in progress."""
    today = (now or datetime.now(UTC)).astimezone(UTC).date()
    return today - timedelta(days=days), today - timedelta(days=1)


def window_bounds(started_on: date, ended_on: date) -> tuple[str, str]:
    """Cloudflare wants a half-open range, so the end is the morning after."""
    start = datetime.combine(started_on, datetime.min.time(), UTC)
    end = datetime.combine(ended_on + timedelta(days=1), datetime.min.time(), UTC)
    return (start.strftime("%Y-%m-%dT%H:%M:%SZ"), end.strftime("%Y-%m-%dT%H:%M:%SZ"))


def percent(value: float | None, observations: int) -> str:
    if value is None:
        return f"too few ({observations})" if observations else "no requests"
    return f"{100 * value:.1f}%"


def requests_label(reading: Reading) -> str:
    if reading.observations == 0:
        return "0"
    return str(round(reading.eligible_requests))


def format_table(readings: list[Reading]) -> str:
    header = (
        "API address",
        "Requests",
        "Built here",
        "Reader waited",
        "From a copy",
    )
    rows = [header]
    for reading in readings:
        rows.append(
            (
                reading.address.label,
                requests_label(reading),
                percent(reading.built_here, reading.observations),
                percent(reading.reader_waited, reading.observations),
                percent(reading.from_a_copy, reading.observations),
            )
        )
    widths = [max(len(row[column]) for row in rows) for column in range(len(header))]
    lines = []
    for index, row in enumerate(rows):
        lines.append(
            "  ".join(
                value.ljust(widths[column]) for column, value in enumerate(row)
            ).rstrip()
        )
        if index == 0:
            lines.append("  ".join("-" * width for width in widths))
    return "\n".join(lines)


def population_note(*, include_verified_bots: bool) -> str:
    return (
        "Population: GET reads of "
        + HOST
        + ", "
        + (
            "every requester including verified bots."
            if include_verified_bots
            else "verified bots excluded."
        )
        + " Requests never eligible for a stored copy (bypass, dynamic, none) are"
        " counted apart and are in no share."
    )


def format_report(
    readings: list[Reading],
    started_on: date,
    ended_on: date,
    *,
    include_verified_bots: bool,
) -> str:
    return "\n".join(
        [
            f"How often a public read reached our own server, {started_on} to {ended_on}.",
            '"Built here" is every request our own server ran; "reader waited" is the'
            " part of it the reader paid for, and the difference is a stale copy"
            " served instantly while Cloudflare refreshed it behind them.",
            f"A share resting on fewer than {MIN_OBSERVATIONS} observations is"
            " withheld, not a pass.",
            "Cloudflare holds a copy per location, so these are shares of real"
            " requests rather than a property of the cache window.",
            "",
            format_table(readings),
            "",
            population_note(include_verified_bots=include_verified_bots),
        ]
    )


def as_json(
    readings: list[Reading],
    started_on: date,
    ended_on: date,
    *,
    include_verified_bots: bool,
) -> str:
    return json.dumps(
        {
            "host": HOST,
            "periodStartedOn": started_on.isoformat(),
            "periodEndedOn": ended_on.isoformat(),
            "verifiedBotsIncluded": include_verified_bots,
            "minimumObservations": MIN_OBSERVATIONS,
            "eligibleStatuses": list(ELIGIBLE_STATUSES),
            "builtHereStatuses": list(BUILT_HERE_STATUSES),
            "readerWaitedStatuses": list(READER_WAITED_STATUSES),
            "populationNote": population_note(
                include_verified_bots=include_verified_bots
            ),
            "addresses": [
                {
                    "address": reading.address.label,
                    "observations": reading.observations,
                    "eligibleRequests": reading.eligible_requests,
                    "ineligibleRequests": reading.ineligible_requests,
                    "builtHere": reading.built_here,
                    "readerWaited": reading.reader_waited,
                    "fromACopy": reading.from_a_copy,
                    "byStatus": reading.by_status,
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
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__ or "")
    parser.add_argument(
        "--days",
        type=int,
        default=DEFAULT_DAYS,
        help=(
            f"Complete UTC days ending yesterday; {DEFAULT_DAYS} by default."
            f" Cloudflare keeps about 32 days, so {MAX_DAYS} is the ceiling here."
        ),
    )
    parser.add_argument(
        "--include-verified-bots",
        action="store_true",
        help="Count verified bots too, which is what our own server really built.",
    )
    parser.add_argument("--json", action="store_true", help="Print readings as JSON.")
    args = parser.parse_args(argv)
    if args.days < 1:
        parser.error("--days must be at least 1")
    if args.days > MAX_DAYS:
        parser.error(f"--days must be at most {MAX_DAYS}; Cloudflare keeps no more")

    token = (os.environ.get("CLOUDFLARE_ANALYTICS_API_TOKEN") or "").strip()
    account = (os.environ.get("CLOUDFLARE_ACCOUNT_ID") or "").strip()
    if not token or not account:
        print(
            "Set CLOUDFLARE_ANALYTICS_API_TOKEN (Account Analytics Read) and"
            " CLOUDFLARE_ACCOUNT_ID first.",
            file=sys.stderr,
        )
        return 2

    started_on, ended_on = complete_window(args.days)
    start, end = window_bounds(started_on, ended_on)
    query = build_query(ADDRESSES, include_verified_bots=args.include_verified_bots)
    try:
        answer = ask_cloudflare(
            query,
            {"accountTag": account, "host": HOST, "start": start, "end": end},
            token,
        )
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        print(f"Cloudflare could not be read: {type(error).__name__}", file=sys.stderr)
        return 1
    if answer.get("errors"):
        messages = "; ".join(
            str(item.get("message", "unknown")) for item in answer["errors"]
        )
        print(f"Cloudflare refused the request: {messages}", file=sys.stderr)
        return 1
    accounts = ((answer.get("data") or {}).get("viewer") or {}).get("accounts")
    if not isinstance(accounts, list) or len(accounts) != 1:
        print("Cloudflare returned no account data.", file=sys.stderr)
        return 1

    readings = [
        read_groups(address, accounts[0].get(address.key)) for address in ADDRESSES
    ]
    print(
        as_json(
            readings,
            started_on,
            ended_on,
            include_verified_bots=args.include_verified_bots,
        )
        if args.json
        else format_report(
            readings,
            started_on,
            ended_on,
            include_verified_bots=args.include_verified_bots,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
