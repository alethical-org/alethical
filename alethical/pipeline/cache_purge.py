"""Clear the saved copies of a money answer when the answer stops being true (#1979).

Net: Cloudflare keeps a copy of every public money answer so a reader does not wait
on the database. Nothing in this repository ever asked Cloudflare to throw one away,
so a copy expired on a timer and on nothing else. This module decides *which* copies
an event makes false, and asks Cloudflare to discard exactly those.

**It is built and deliberately not armed.** Two separate things must both be true
before a single request leaves this process, and neither is true today:

* a Cloudflare API token with the **Cache Purge** permission on the ``alethical.com``
  zone, as ``CLOUDFLARE_API_TOKEN``, together with ``CLOUDFLARE_ZONE_ID``;
* ``ALETHICAL_CLEAR_SAVED_ANSWERS=on``.

Two conditions rather than one on purpose: a token turning up in an environment for
some other reason must not start clearing production caches by itself. Until both
hold, every call here reports the exact prefixes it *would* have cleared and returns
success, so wiring it in changes nothing a reader can see.

WHY PREFIXES AND NOT ADDRESSES. A money answer's address carries a query string --
year, page, office, committee, direction, name, search text -- and the space of those
is far too large to list. Cloudflare's purge-by-prefix discards every saved copy under
a path *whatever its query string*, which is the only shape that can clear an answer
completely. It is available on every Cloudflare plan including Free, since Cloudflare
opened all 5 purge methods to all plans on 1 April 2025
(https://developers.cloudflare.com/changelog/post/2025-04-01-purge-for-all/), and the
limits that bind us are 100 prefixes per request and, on Free, 5 requests a minute.
Hence ``PREFIXES_PER_REQUEST`` and the chunking below: a review sitting that decides
50 links produces about 150 prefixes, and sending one request per decision would hit
that rate limit inside a minute.

WHAT THIS DOES NOT TOUCH. There are 2 stores in front of a money page and Cloudflare
is only one of them. Vercel holds the page HTML, and since #1966 that HTML carries the
records it read. Measured 8 Sep 2026: ``www.alethical.com`` answers with ``server:
Vercel`` and no ``cf-ray`` at all, so the site host is not behind Cloudflare's cache
and no Cloudflare purge can reach it. Vercel's own window is 300 s plus 300 s of
background refresh (``api/page.ts``), so its worst case is 10 minutes against
Cloudflare's 24 hours, which is why this module starts with Cloudflare. Clearing
Vercel's copies needs ``Cache-Tag`` headers on ``api/page.ts`` first and is its own
piece of work.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Iterable, Mapping, Optional

import requests

#: The one hostname Cloudflare caches for us. The site host is deliberately DNS-only
#: (grey cloud) so Vercel keeps its own TLS and CDN --
#: ``docs/operations/api-cdn-setup.md`` § "Status (2026-07-20)" -- so every saved copy
#: a purge can reach is under this host.
CACHED_API_HOST = "api.alethical.com"

#: Cloudflare's own limits, both from
#: https://developers.cloudflare.com/cache/how-to/purge-cache/ : 100 operations per
#: request on Free, Pro and Business, and 5 purge requests a minute on Free.
PREFIXES_PER_REQUEST = 100

PURGE_URL = "https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache"

#: The switch. Spelled out rather than a truthy check, so a leftover ``0``, ``false``
#: or empty string can never read as "on".
ENABLE_SETTING = "ALETHICAL_CLEAR_SAVED_ANSWERS"
ENABLE_VALUE = "on"
TOKEN_SETTING = "CLOUDFLARE_API_TOKEN"
ZONE_SETTING = "CLOUDFLARE_ZONE_ID"

#: Plain names for the 4 events the issue lists, plus the 5th the issue does not: the
#: 2 money checks a load re-runs against what it just published. Those write the
#: verdicts ``/committees/{n}/finance`` and ``/legislators/{id}/campaign-finance``
#: serve as ``stated_split_state`` and ``stated_spending_state``, and they finish about
#: 72 minutes after the publish, so a load that cleared only once would leave a fresh
#: copy saying "not checked" for the rest of the window.
A_MONEY_DOWNLOAD_RELEASE = "a new campaign-money download release"
A_FILINGS_RELEASE = "a new filed-totals or registered-filer release"
A_MONEY_CHECK_VERDICT_SET = "the 2 money checks finished against the new release"
LINK_DECISIONS_WRITTEN = "committee-to-legislator link decisions written"

#: A path segment that cannot break out of the prefix it sits in. Registration numbers
#: are digits and sometimes a leading minus (the Board's own export carries
#: ``-2139399989``); a legislator is addressed by slug or by UUID, and both routes
#: accept either (``get_legislator_by_id``), so both forms are saved separately and
#: both have to be cleared.
_SAFE_SEGMENT = re.compile(r"^[A-Za-z0-9_.~-]+$")

#: Every read whose answer changes when a *release* lands. Three prefixes rather than
#: a list of routes, because a release moves every figure on every money read and
#: those reads live under 3 paths:
#:
#: * ``campaign-finance`` -- the 5 dated record reads plus search, summary and races.
#: * ``committees`` -- ``/committees/{n}/finance`` and ``/committees/{n}/filings``,
#:   every year variant of each.
#: * ``legislators`` -- ``/legislators/{id}/campaign-finance`` and
#:   ``/legislators/{id}/independent-spending``, for whichever ids readers asked for.
#:
#: The third one over-reaches: it also discards the bill-and-roster reads
#: ``/legislators`` and ``/legislators/{id}``, which a release does not change. Named
#: rather than avoided, because the cost is one origin read on answers whose own
#: window is 60 seconds fresh plus 300 seconds of grace, and the alternative is
#: enumerating a prefix per member per id form, which is 400 prefixes for 200 sitting
#: members and needs a database read to build.
_RELEASE_PREFIX_PATHS = (
    "api/v1/campaign-finance",
    "api/v1/committees",
    "api/v1/legislators",
)

#: The 2 reads a link decision changes that are not about one committee or one member.
#: Found by grepping every backend reader of the ``legislator_campaign_committee``
#: table rather than by reading addresses:
#:
#: * ``/campaign-finance/summary`` counts how many sitting members have a confirmed
#:   committee (``legislator_committee_confirmations``).
#: * ``/campaign-finance/outside-spending`` serves ``about.confirmed_member`` /
#:   ``spender.confirmed_member`` for a subject view
#:   (``alethical/api/services/outside_spending.py``, ``confirmed_member_for_committee``),
#:   which is the sentence "Someone at Alethical confirmed this committee is <name>'s"
#:   in ``apps/frontend/src/lib/outsideSpending.ts``.
_LINK_SHARED_PREFIX_PATHS = (
    "api/v1/campaign-finance/summary",
    "api/v1/campaign-finance/outside-spending",
)


class UnsafePrefix(ValueError):
    """A prefix that would not clear what it names, so it is refused before sending.

    Cloudflare's purge-by-prefix takes a hostname and a path and **no query string**;
    a prefix carrying one is rejected by the API, and a prefix carrying a scheme
    silently matches nothing. Both are caught here rather than at the edge, because a
    purge that quietly clears nothing is the exact failure #1979 says is worse than
    having no purge at all.
    """


def _prefix(*segments: str) -> str:
    for segment in segments:
        if not segment or not _SAFE_SEGMENT.match(segment):
            raise UnsafePrefix(
                f"{segment!r} is not usable as one path segment of a cache prefix; "
                "a segment carries no slash, no query string and no scheme"
            )
    return "/".join((CACHED_API_HOST, *segments))


def _path_prefix(path: str) -> str:
    return f"{CACHED_API_HOST}/{path}"


@dataclass(frozen=True)
class Clearing:
    """One event's answer to "which saved copies stopped being true?".

    ``event`` is the plain name of what happened, so a report and a proof read the
    same words. ``prefixes`` are hostname-and-path prefixes in Cloudflare's own
    format: no scheme, no query string, and every saved copy under the path goes.
    """

    event: str
    prefixes: tuple[str, ...]

    def __post_init__(self) -> None:
        for prefix in self.prefixes:
            if "?" in prefix or "#" in prefix or "://" in prefix:
                raise UnsafePrefix(
                    f"{prefix!r} carries a scheme, a query string or a fragment; "
                    "Cloudflare's purge-by-prefix takes a hostname and a path only"
                )
            if not prefix.startswith(f"{CACHED_API_HOST}/"):
                raise UnsafePrefix(
                    f"{prefix!r} is not under {CACHED_API_HOST}, and no other host on "
                    "this zone is behind Cloudflare's cache"
                )

    def requests(self) -> tuple[tuple[str, ...], ...]:
        """The prefixes split into as many purge calls as Cloudflare's limit needs."""
        return tuple(
            tuple(self.prefixes[start : start + PREFIXES_PER_REQUEST])
            for start in range(0, len(self.prefixes), PREFIXES_PER_REQUEST)
        )


def when_a_money_download_release_lands() -> Clearing:
    """Event 1: ``scripts/load_campaign_finance.py`` published a new set."""
    return Clearing(
        event=A_MONEY_DOWNLOAD_RELEASE,
        prefixes=tuple(_path_prefix(path) for path in _RELEASE_PREFIX_PATHS),
    )


def when_a_filings_release_lands() -> Clearing:
    """Event 2: ``scripts/load_campaign_finance_filings.py`` published a new set.

    The same prefixes as a download release. A filed-totals set moves
    ``money_in.reported_total`` and the register moves every committee's kind, office
    and termination date, and those are served from the same 3 paths.
    """
    return Clearing(
        event=A_FILINGS_RELEASE,
        prefixes=tuple(_path_prefix(path) for path in _RELEASE_PREFIX_PATHS),
    )


def when_the_money_checks_finish() -> Clearing:
    """The 5th event, which #1979 does not list.

    A load re-runs both money checks against what it just published and takes about
    72 minutes over it, so the verdicts land long after the figures. Clearing only at
    publish time would replace a stale copy with a fresh copy that says nobody
    compared this committee's figures, and leave that standing for the rest of the
    window.
    """
    return Clearing(
        event=A_MONEY_CHECK_VERDICT_SET,
        prefixes=tuple(_path_prefix(path) for path in _RELEASE_PREFIX_PATHS),
    )


def link_prefixes(
    *,
    registration_number: str,
    legislator_slug: Optional[str] = None,
    legislator_id: Optional[str] = None,
) -> tuple[str, ...]:
    """Every prefix one committee-to-legislator decision makes false.

    A whole prefix per committee and per member rather than the exact reads: the
    committee's finance answer has a year variant per filing year and the member's has
    the same, and ``/legislators/{id}`` accepts a slug *or* a UUID
    (``get_legislator_by_id``), so 2 saved copies exist per member. A prefix covers
    every one of those in one entry.
    """
    prefixes = [_prefix("api", "v1", "committees", registration_number)]
    for identifier in (legislator_slug, legislator_id):
        if identifier:
            prefixes.append(_prefix("api", "v1", "legislators", identifier))
    return tuple(prefixes)


@dataclass(frozen=True)
class LinkDecision:
    """One row a review sitting wrote, in the shape a clearing needs.

    ``decision`` is the stored word -- ``confirmed``, ``rejected`` or ``withdrawn`` --
    and it is carried so the report says which kind of decision cleared what, rather
    than only how many.
    """

    registration_number: str
    decision: str
    legislator_slug: Optional[str] = None
    legislator_id: Optional[str] = None


def when_link_decisions_are_written(
    decisions: Iterable[LinkDecision],
) -> Optional[Clearing]:
    """One clearing for a whole review sitting.

    A sitting writes one row per keystroke and can write dozens, and Cloudflare's Free
    plan allows 5 purge requests a minute, so one request per decision would be refused
    partway through a batch. Collecting the sitting's rows and clearing once at the end
    fits inside that limit; the cost, named rather than hidden, is that the first
    decision's copies stay saved until the sitting ends.

    Every decision counts, a rejection included: a rejection moves the served
    ``link_state`` from ``unconfirmed`` to ``reviewed_none_confirmed``
    (``alethical/api/services/legislator_finance.py``). No reader-facing sentence
    changes on that move, so skipping rejections would be defensible -- and it would
    mean this function had to know which decisions change which fields, which is a
    second copy of a rule that already lives in the handlers.

    ``None`` when nothing was decided, so a caller cannot send an empty purge.
    """
    rows = list(decisions)
    if not rows:
        return None
    prefixes: list[str] = []
    for row in rows:
        for prefix in link_prefixes(
            registration_number=row.registration_number,
            legislator_slug=row.legislator_slug,
            legislator_id=row.legislator_id,
        ):
            if prefix not in prefixes:
                prefixes.append(prefix)
    prefixes.extend(_path_prefix(path) for path in _LINK_SHARED_PREFIX_PATHS)
    counted = ", ".join(
        f"{sum(1 for row in rows if row.decision == word)} {word}"
        for word in sorted({row.decision for row in rows})
    )
    return Clearing(
        event=f"{LINK_DECISIONS_WRITTEN}: {counted}", prefixes=tuple(prefixes)
    )


@dataclass(frozen=True)
class Arming:
    """Whether a real purge may leave this process, and in plain words why not."""

    armed: bool
    reason: str


def arming(env: Optional[Mapping[str, str]] = None) -> Arming:
    """Read the 2 conditions. Both must hold; neither implies the other.

    Reported as one sentence rather than a boolean so a half-configured environment
    says which half is missing, instead of looking like a purge that did nothing.
    """
    values = os.environ if env is None else env
    missing = [name for name in (TOKEN_SETTING, ZONE_SETTING) if not values.get(name)]
    switch = (values.get(ENABLE_SETTING) or "").strip().lower()
    # "X not set" rather than "X is/are not set", so one missing setting and two read
    # the same way with no singular-or-plural branch to get wrong.
    if missing and switch != ENABLE_VALUE:
        return Arming(
            False,
            f"{' and '.join(missing)} not set, and "
            f"{ENABLE_SETTING} is not {ENABLE_VALUE!r}",
        )
    if missing:
        return Arming(False, f"{' and '.join(missing)} not set")
    if switch != ENABLE_VALUE:
        return Arming(False, f"{ENABLE_SETTING} is not {ENABLE_VALUE!r}")
    return Arming(True, "")


@dataclass(frozen=True)
class ClearingResult:
    """What happened, in a shape a script can print and exit on.

    ``ok`` is False only for a purge that was armed and failed. An unarmed run is
    ``ok`` and ``armed=False``: nothing was asked of Cloudflare, so nothing failed.
    Keeping those apart is what stops "we are not armed yet" from reading as an
    outage, and stops a real failure from reading as "not armed yet".
    """

    clearing: Clearing
    armed: bool
    ok: bool
    detail: str

    @property
    def failed(self) -> bool:
        return self.armed and not self.ok

    def report(self) -> str:
        head = f"clearing saved answers after {self.clearing.event}:"
        listed = "\n".join(f"    {prefix}" for prefix in self.clearing.prefixes)
        if not self.armed:
            return (
                f"{head}\n"
                f"  NOT ARMED, so nothing was cleared: {self.detail}\n"
                f"  would have cleared every saved copy under "
                f"{len(self.clearing.prefixes)} prefix(es):\n{listed}"
            )
        if self.ok:
            return (
                f"{head}\n"
                f"  cleared every saved copy under {len(self.clearing.prefixes)} "
                f"prefix(es):\n{listed}\n"
                f"  {self.detail}"
            )
        return (
            f"{head}\n"
            f"  🚨 FAILED, so readers may keep being served the previous answer for "
            f"as long as the window allows: {self.detail}\n"
            f"  the {len(self.clearing.prefixes)} prefix(es) that are still saved:"
            f"\n{listed}"
        )


def clear(
    clearing: Clearing,
    *,
    env: Optional[Mapping[str, str]] = None,
    post=None,
    timeout: float = 20.0,
) -> ClearingResult:
    """Ask Cloudflare to discard every saved copy under ``clearing``'s prefixes.

    Never raises for a Cloudflare failure. A load has already published by the time
    this runs, and an exception here would lose the report of what was published; the
    caller prints ``report()`` and exits non-zero instead.

    ``post`` is the seam a test drives, so a test exercises this exact code path
    rather than a re-implementation of it. Left at ``None`` it is ``requests.post``.
    """
    values = os.environ if env is None else env
    state = arming(values)
    if not state.armed:
        return ClearingResult(
            clearing=clearing, armed=False, ok=True, detail=state.reason
        )

    send = requests.post if post is None else post
    url = PURGE_URL.format(zone_id=values[ZONE_SETTING])
    headers = {
        "Authorization": f"Bearer {values[TOKEN_SETTING]}",
        "Content-Type": "application/json",
    }
    calls = clearing.requests()
    sent = 0
    for chunk in calls:
        try:
            response = send(
                url, headers=headers, json={"prefixes": list(chunk)}, timeout=timeout
            )
        except requests.RequestException as error:
            return ClearingResult(
                clearing=clearing,
                armed=True,
                ok=False,
                detail=(
                    f"Cloudflare could not be reached on request {sent + 1} of "
                    f"{len(calls)}: {error}"
                ),
            )
        failure = _failure(response)
        if failure is not None:
            return ClearingResult(
                clearing=clearing, armed=True, ok=False, detail=failure
            )
        sent += 1
    return ClearingResult(
        clearing=clearing,
        armed=True,
        ok=True,
        detail=f"Cloudflare accepted {sent} purge request(s)",
    )


def clear_after_publish(
    clearing: Clearing,
    *,
    published: bool,
    log=print,
    env: Optional[Mapping[str, str]] = None,
    post=None,
) -> bool:
    """Clear only when something actually went live, and report whether it FAILED.

    The "only when published" rule lives here rather than in each loader, so both
    loaders answer it the same way and a change to it cannot land in one and not the
    other. A quarantined or unchanged run leaves the previous set live, and every
    saved copy of it is still the right answer, so clearing then would spend an origin
    read on every money route for nothing.

    Returns whether a clearing was armed and failed, which is what makes a loader exit
    non-zero. It never raises: the publish has already happened by the time this runs,
    and an exception here would lose the report of what was published.
    """
    if not published:
        return False
    result = clear(clearing, env=env, post=post)
    log(result.report())
    return result.failed


def _failure(response) -> Optional[str]:
    """One line naming why Cloudflare refused, or ``None`` when it did not.

    Cloudflare answers 200 with ``{"success": false, "errors": [...]}`` for a request
    it understood and declined -- a token without the Cache Purge permission among
    them -- so the status code alone is not the answer.
    """
    if response.status_code != 200:
        return (
            f"Cloudflare answered HTTP {response.status_code}: {_body_text(response)}"
        )
    try:
        payload = response.json()
    except ValueError:
        return f"Cloudflare answered 200 with a body that is not JSON: {_body_text(response)}"
    if not isinstance(payload, dict) or payload.get("success") is not True:
        return f"Cloudflare answered 200 but refused the purge: {_body_text(response)}"
    return None


def _body_text(response) -> str:
    try:
        return (response.text or "")[:500]
    except Exception:  # pragma: no cover - a body a test double did not give us
        return "(no body)"
