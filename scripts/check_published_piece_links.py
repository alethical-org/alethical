"""Check every outward link in Alethical's published research and guides.

The published pieces (``apps/frontend/src/lib/researchPieces/``) end in a sources
block whose whole promise is that a reader can go and check the record for
themselves. *The Money Only Goes One Way* says it outright: "Nothing here
requires trusting us. It requires looking." A link that no longer resolves takes
that promise away silently.

**Silently is the operative word, and it is why a status-code checker cannot own
this.** Every soft failure this repository has measured against ``cfb.mn.gov``
answers **HTTP 200** with a page whose only heading reads "This page is not
available" (``docs/architecture/campaign-finance-system-design.md`` §2.1 for the
downloads, §2.2 for the lobbying viewers, §9.4 for report documents). An ordinary
link checker passes all of them. So this reads each page's own words.

It has caught the same failure twice by hand in 2 days, which is why it now runs
by itself: [#1802](https://github.com/alethical-org/alethical/issues/1802) found
the lobbying principal viewer dead, and the sweep that issue asked for then found
2 more, in 2 different guides ([#1815](https://github.com/alethical-org/alethical/issues/1815)).

It fails in three directions on purpose:

* **a link that answers with an error page** - a reader following it finds
  nothing, and nothing about the response looks wrong;
* **a link that answers 404 or 410** - dead in the ordinary way;
* **a piece whose links this check can no longer find** - the extraction broke,
  or a piece stopped carrying sources. A check that quietly verifies nothing is
  worse than no check.

A host being unreachable is **not** a failure. A timeout, a refused connection or
a 5xx is the Board having a bad minute, not our link being wrong, and filing an
issue for it would train everyone to ignore this. Those are reported and skipped.

Internal links (``/read/...``) are resolved against the pieces' own slugs rather
than fetched, so a broken cross-link between 2 guides is caught with no network
at all.

Reads only public pages. No database, no credentials, no paid call. Requests are
spaced so a run is never mistaken for a crawler.
"""

from __future__ import annotations

import argparse
import html
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PIECES_DIR = ROOT / "apps/frontend/src/lib/researchPieces"

# A browser User-Agent, because cfb.mn.gov serves a different page to an unnamed
# client. Naming Alethical in it keeps the request honest in their logs.
USER_AGENT = (
    "Mozilla/5.0 (compatible; AlethicalLinkCheck/1.0; "
    "+https://www.alethical.com) Chrome/124.0 Safari/537.36"
)

# Seconds between requests. Not politeness theatre: a session tripped this
# site's bot protection with a fast loop on 27 Aug 2026, and there are fewer
# than 20 links to check, so waiting costs a run about a minute.
REQUEST_SPACING_SECONDS = 3.0

# The wording an error page shows while answering 200. Matched against the
# page's own headings and title, never against its whole body, so a piece of
# navigation furniture or a help article that happens to use the phrase cannot
# fail the run.
ERROR_PAGE_PHRASES = (
    "this page is not available",
    "page not found",
    "page unavailable",
)

_HREF_RE = re.compile(r"""href:\s*(['"])(?P<url>.+?)\1""")
_SLUG_RE = re.compile(r"""^\s*slug:\s*(['"])(?P<slug>.+?)\1""", re.MULTILINE)
_HEADING_RE = re.compile(r"<h1[^>]*>(.*?)</h1>", re.DOTALL | re.IGNORECASE)
_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.DOTALL | re.IGNORECASE)
_TAG_RE = re.compile(r"<[^>]+>")


def piece_files() -> list[Path]:
    return sorted(PIECES_DIR.glob("*.ts"))


def published_slugs(files: list[Path]) -> set[str]:
    slugs: set[str] = set()
    for path in files:
        slugs.update(
            match.group("slug") for match in _SLUG_RE.finditer(path.read_text())
        )
    return slugs


def links_in(path: Path) -> list[str]:
    """Every reader-facing href in one piece, in the order it appears.

    Only ``href:`` values count. A URL written in a code comment above a link is
    context for the next builder, not something a reader can click, and checking
    it would fail this run on an address we deliberately record as dead.
    """
    return [match.group("url") for match in _HREF_RE.finditer(path.read_text())]


def page_says_it_is_missing(body: str) -> str | None:
    """The error wording, if the page announces one in its title or a heading."""
    spoken = [_TAG_RE.sub("", raw) for raw in _HEADING_RE.findall(body)]
    title = _TITLE_RE.search(body)
    if title:
        spoken.append(_TAG_RE.sub("", title.group(1)))
    for line in spoken:
        text = html.unescape(line).strip()
        lowered = text.lower()
        for phrase in ERROR_PAGE_PHRASES:
            if phrase in lowered:
                return text
    return None


def fetch(url: str, timeout: int) -> tuple[int, bytes]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.status, response.read()


def check_outward_link(
    url: str, timeout: int, failures: list[str], skipped: list[str]
) -> None:
    try:
        status, raw = fetch(url, timeout)
    except urllib.error.HTTPError as error:
        if error.code in (404, 410):
            failures.append(
                f"{url}\n      answers HTTP {error.code}. The page is gone."
            )
        else:
            skipped.append(f"{url} (HTTP {error.code})")
        return
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        skipped.append(f"{url} ({error})")
        return

    # A PDF or a CSV cannot carry an HTML error page, and decoding one as text
    # would be meaningless. Reaching it at all is the whole check for those.
    if raw[:4] == b"%PDF" or not raw.lstrip()[:1] == b"<":
        return

    wording = page_says_it_is_missing(raw.decode("utf-8", "replace"))
    if wording:
        failures.append(
            f"{url}\n      answers HTTP {status} and says {wording!r}. "
            "A reader following it finds nothing."
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--timeout", type=int, default=45)
    parser.add_argument(
        "--offline",
        action="store_true",
        help="Check the internal links and the extraction only, and fetch nothing.",
    )
    args = parser.parse_args()

    files = piece_files()
    if not files:
        print(f"No published pieces found in {PIECES_DIR.relative_to(ROOT)}.")
        return 1

    slugs = published_slugs(files)
    failures: list[str] = []
    skipped: list[str] = []
    outward: dict[str, list[str]] = {}

    for path in files:
        found = links_in(path)
        if not found:
            failures.append(
                f"{path.name} carries no links at all. Either its sources block lost them, "
                "or this check has stopped being able to read them."
            )
            continue
        for url in found:
            if url.startswith("/"):
                # An internal link points at a piece by its own slug.
                slug = url.rstrip("/").rsplit("/", 1)[-1]
                if slug not in slugs:
                    failures.append(
                        f"{path.name} links to {url}, and no published piece has the slug "
                        f"{slug!r}."
                    )
            elif url.startswith("http"):
                outward.setdefault(url, []).append(path.name)
            else:
                failures.append(
                    f"{path.name} has a link this check cannot classify: {url!r}"
                )

    print(
        f"{len(files)} published pieces, {sum(len(v) for v in outward.values())} outward links "
        f"({len(outward)} distinct addresses)."
    )

    if not args.offline:
        for index, url in enumerate(sorted(outward)):
            if index:
                time.sleep(REQUEST_SPACING_SECONDS)
            check_outward_link(url, args.timeout, failures, skipped)

    if skipped:
        print("\nCould not reach these, so they are not treated as broken:")
        for note in skipped:
            print(f"  - {note}")

    if failures:
        print("\nPublished pieces point readers at pages that are not there:\n")
        for failure in failures:
            pieces = ", ".join(sorted(set(outward.get(failure.split("\n")[0], []))))
            where = f"  ({pieces})" if pieces else ""
            print(f"  - {failure}{where}")
        print(
            "\nA change to a posted piece is the Alethical team's to direct "
            "(.claude/rules/grounded-answers.md rule 13), so report these rather than "
            "editing a piece.\n"
            "Resolve a replacement from the Board's own index and confirm it by reading "
            "the page, never by its status code."
        )
        return 1

    print("\nEvery link in every published piece resolves to a real page.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
