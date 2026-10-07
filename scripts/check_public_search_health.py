#!/usr/bin/env python3
"""Bounded, credential-free reads of public search files and initial page HTML.

This proves response health, never that Google or Bing indexed a page. No browser,
AI, sign-in, submitted search, user address, API writes, or paid provider is used.
The origin is fixed. Redirects are refused before following them. Remote response
text and exception messages never enter logs or retained evidence.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import date, datetime, timezone
from html.parser import HTMLParser
from http.client import HTTPException
import json
from pathlib import Path
import re
import time
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, unquote, urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
from urllib.robotparser import RobotFileParser
from xml.etree import ElementTree

ORIGIN = "https://www.alethical.com"
NAMESPACE = "http://www.sitemaps.org/schemas/sitemap/0.9"
SECTIONS = (
    "pages",
    "bills",
    "legislators",
    "committees",
    "races",
    "lobbying-principals",
    "lobbying-lobbyists",
)
SITEMAPS = tuple(f"{ORIGIN}/sitemaps/{name}.xml" for name in SECTIONS)
FIXED_PATHS = (
    "/",
    "/bills",
    "/legislators",
    "/money",
    "/blog",
    "/candidates",
    "/privacy",
    "/terms",
)
# Public profile addresses established from current held records. /candidates is
# an address lookup, not a catalogue, so it need not link these unrelated people.
CANDIDATES = (
    "/candidates/677e8bb6e927a5df33d9b486844b2e8dbf3b31bd49816bdc0627fba488ba185f",
    "/candidates/2aac573ec752af687b5d9d024cfc1530ae61127d9a5e90f7a6dc43721465cc1b",
)
MISSING_PATHS = (
    "/bills/94-2025-HF999999",
    "/legislators/alethical-search-health-nonexistent-legislator",
)
PRIVATE_CHECKS = ("/admin/candidate-claims", "/email-preferences")
PRIVATE_SEGMENTS = {
    "admin",
    "api",
    "ask",
    "chat",
    "me",
    "account",
    "auth",
    "oauth",
    "callback",
    "sign-in",
    "sign-up",
    "login",
    "confirm",
    "reset",
    "forgot-password",
    "email-preferences",
    "unsubscribe",
    "comment-emails",
    "claim",
    "manage",
    "site-metrics",
    "preview",
    "drafts",
}
SEARCH_AGENTS = (
    "Googlebot",
    "bingbot",
    "OAI-SearchBot",
    "Claude-SearchBot",
    "PerplexityBot",
)
MAX_BYTES = 4 * 1024 * 1024
MAX_REQUESTS = 160  # Includes retries. Daily runs usually use fewer than 50.
MAX_SECONDS = 300
MAX_URLS = 50_000
SHA = re.compile(r"^[0-9a-f]{40}$")
PLACEHOLDERS = {"loading", "loading…", "loading...", "please wait", "alethical"}


class HealthFailure(Exception):
    """Only fixed, locally authored reasons belong here."""


def require(condition: bool, reason: str) -> None:
    if not condition:
        raise HealthFailure(reason)


def safe_url(url: str, *, private_check: bool = False) -> str:
    """Validate before a request, and before a discovered URL enters evidence."""
    try:
        parsed = urlsplit(url)
        require(
            parsed.scheme == "https"
            and parsed.netloc == "www.alethical.com"
            and not parsed.fragment
            and len(url) <= 2048,
            "address is not a canonical public HTTPS address",
        )
        path = unquote(parsed.path)
        require(
            path.startswith("/")
            and not path.startswith("//")
            and not re.search(r"[\\\s\x00-\x1f\x7f%]", path)
            and not any(part in (".", "..") for part in path.split("/")),
            "address has an unsafe path",
        )
        is_private = any(part.lower() in PRIVATE_SEGMENTS for part in path.split("/"))
        require(
            not is_private or (private_check and path in PRIVATE_CHECKS),
            "private address appeared in public discovery",
        )
        if parsed.query:
            pairs = parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=True)
            directory = path in (
                "/bills",
                "/legislators",
                "/money/committees",
                "/money/lobbying/principals",
                "/money/lobbying/lobbyists",
                "/blog/research",
                "/blog/guides",
                "/blog/short-posts",
            ) or re.fullmatch(r"/blog/topics/[a-z0-9-]+", path)
            require(
                bool(directory)
                and len(pairs) == 1
                and pairs[0][0] == "page"
                and re.fullmatch(r"[1-9][0-9]{0,5}", pairs[0][1]) is not None,
                "private or filtered query appeared in public discovery",
            )
        return url
    except ValueError:
        raise HealthFailure("address is malformed") from None


def discovery_key(url: str) -> str:
    parsed = urlsplit(url)
    return unquote(parsed.path) + ("?" + parsed.query if parsed.query else "")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


@dataclass
class Response:
    status: int
    headers: dict[str, str]
    body: bytes

    def text(self) -> str:
        try:
            return self.body.decode("utf-8")
        except UnicodeError:
            raise HealthFailure("response is not UTF-8") from None


class Fetcher:
    def __init__(self):
        # Avoid ambient proxies or credentials. No cookies or authentication.
        self.opener = build_opener(ProxyHandler({}), NoRedirect())
        self.requests = 0
        self.deadline = time.monotonic() + MAX_SECONDS

    def fetch(self, url: str, *, private_check: bool = False) -> Response:
        safe_url(url, private_check=private_check)
        for attempt in range(2):
            require(self.requests < MAX_REQUESTS, "request budget exhausted")
            remaining = self.deadline - time.monotonic()
            require(remaining > 0, "time budget exhausted")
            self.requests += 1
            request = Request(
                url,
                headers={
                    "Accept": "text/html,application/xml,text/plain",
                    "User-Agent": "Alethical-public-search-health/1",
                },
                method="GET",
            )
            try:
                try:
                    stream = self.opener.open(request, timeout=min(10, remaining))
                except HTTPError as error:
                    stream = error
                with stream:
                    status = stream.code
                    require(
                        not 300 <= status < 400,
                        "redirect refused; canonical address should respond directly",
                    )
                    if 500 <= status < 600 and not attempt:
                        time.sleep(min(1, max(0, self.deadline - time.monotonic())))
                        continue
                    body = bytearray()
                    while True:
                        require(
                            time.monotonic() < self.deadline, "time budget exhausted"
                        )
                        chunk = stream.read(min(65_536, MAX_BYTES + 1 - len(body)))
                        if not chunk:
                            break
                        body.extend(chunk)
                        require(len(body) <= MAX_BYTES, "response exceeds size limit")
                    return Response(
                        status,
                        {
                            key: stream.headers.get(key, "")
                            for key in ("Content-Type", "X-Robots-Tag", "Cache-Control")
                        },
                        bytes(body),
                    )
            except (URLError, OSError, HTTPException):
                if attempt:
                    raise HealthFailure(
                        "network request failed after 1 retry"
                    ) from None
                time.sleep(min(1, max(0, self.deadline - time.monotonic())))
        raise HealthFailure("source request failed")


def xml_urls(response: Response, *, index: bool) -> list[str]:
    require(response.status == 200, f"sitemap returned HTTP {response.status}")
    content_type = (
        response.headers.get("Content-Type", "").split(";", 1)[0].lower().strip()
    )
    require(content_type in ("application/xml", "text/xml"), "sitemap is not XML")
    require(
        b"<!DOCTYPE" not in response.body.upper()
        and b"<!ENTITY" not in response.body.upper(),
        "XML document declarations are not allowed",
    )
    try:
        root = ElementTree.fromstring(response.body)
    except (ElementTree.ParseError, ValueError):
        raise HealthFailure("sitemap XML is malformed") from None
    tag = "sitemapindex" if index else "urlset"
    require(root.tag == f"{{{NAMESPACE}}}{tag}", "sitemap root or namespace is wrong")
    entry_tag = f"{{{NAMESPACE}}}{'sitemap' if index else 'url'}"
    require(
        all(child.tag == entry_tag for child in root), "sitemap entry shape is wrong"
    )
    require(
        0 < len(root) <= (7 if index else MAX_URLS),
        "sitemap entry count is outside bounds",
    )
    urls = []
    for entry in root:
        locations = entry.findall(f"{{{NAMESPACE}}}loc")
        require(
            len(locations) == 1 and bool(locations[0].text),
            "sitemap entry needs exactly 1 address",
        )
        urls.append(safe_url(locations[0].text or ""))
    require(
        len({discovery_key(url) for url in urls}) == len(urls),
        "sitemap contains duplicate addresses",
    )
    if index:
        require(
            set(urls) == set(SITEMAPS),
            "sitemap index does not contain exactly the 7 expected children",
        )
    return urls


VOID = {
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
}


class PageHTML(HTMLParser):
    """Read first-response main content, excluding scripts and hidden elements.

    This is not a CSS engine or an accessibility/visual audit. Semantic checks
    deliberately accept short useful pages rather than imposing a word count.
    """

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack: list[tuple[str, bool]] = []
        self.title: list[str] = []
        self.canonicals: list[str] = []
        self.robots: list[str] = []
        self.release: str | None = None
        self.headings: list[str] = []
        self.heading_count = 0
        self.content: list[str] = []
        self.anchors: list[str] = []
        self.has_base = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "base":
            self.has_base = True
        if tag == "link" and "canonical" in (attrs.get("rel") or "").lower().split():
            self.canonicals.append(attrs.get("href") or "")
        if tag == "meta":
            name = (attrs.get("name") or "").lower()
            if name in ("robots", "googlebot", "bingbot"):
                self.robots.append(attrs.get("content") or "")
            if name == "alethical-release-commit":
                value = attrs.get("content") or ""
                self.release = value if SHA.fullmatch(value) else None
        style = (attrs.get("style") or "").replace(" ", "").lower()
        hidden = bool(self.stack and self.stack[-1][1]) or (
            tag in ("script", "style", "template")
            or "hidden" in attrs
            or attrs.get("aria-hidden") == "true"
            or "display:none" in style
            or "visibility:hidden" in style
        )
        if tag not in VOID:
            self.stack.append((tag, hidden))
        if tag == "h1" and not hidden and any(t == "main" for t, _ in self.stack):
            self.heading_count += 1
        if tag == "a" and not hidden and any(t == "main" for t, _ in self.stack):
            self.anchors.append(attrs.get("href") or "")

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break

    def handle_data(self, data):
        text = " ".join(data.split())
        if not text or not self.stack or self.stack[-1][1]:
            return
        tags = [tag for tag, _ in self.stack]
        if "title" in tags:
            self.title.append(text)
        if "main" in tags:
            if "h1" in tags:
                self.headings.append(text)
            elif not any(tag in tags for tag in ("nav", "button")) and (
                any(tag in tags for tag in ("li", "td", "dd"))
                or not any(tag in tags for tag in ("h2", "h3", "h4", "a"))
            ):
                self.content.append(text)


def tokens(values: list[str]) -> set[str]:
    return set(re.findall(r"[a-z]+", " ".join(values).lower()))


def validate_page(
    url: str, response: Response, robots: RobotFileParser, *, mode: str = "public"
) -> PageHTML:
    expected = 404 if mode == "missing" else 200
    require(
        response.status == expected,
        f"page returned HTTP {response.status}; expected {expected}",
    )
    require(
        response.headers.get("Content-Type", "").lower().startswith("text/html"),
        "page is not HTML",
    )
    page = PageHTML()
    page.feed(response.text())
    directives = tokens(page.robots + [response.headers.get("X-Robots-Tag", "")])
    if mode != "public":
        require(
            "noindex" in directives or "none" in directives,
            "excluded page is missing noindex",
        )
        if mode == "missing":
            require(not page.canonicals, "missing page has a canonical address")
        else:
            require(
                "nofollow" in directives or "none" in directives,
                "private page is missing nofollow",
            )
            cache = response.headers.get("Cache-Control", "").lower()
            require(
                "private" in cache and "no-store" in cache,
                "private page may be publicly cached",
            )
        return page
    require(
        not directives.intersection({"noindex", "none"}),
        "public page excludes search indexing",
    )
    require(not page.has_base, "page changes anchor address resolution")
    require(
        page.canonicals == [url], "page does not have exactly 1 self-canonical address"
    )
    require(
        bool(" ".join(page.title).strip())
        and " ".join(page.title).strip().lower() != "alethical",
        "page title is missing or generic",
    )
    require(
        bool(page.headings) and page.heading_count == 1,
        "page needs exactly 1 visible main heading",
    )
    meaningful = [
        text for text in page.content if text.lower().rstrip(".") not in PLACEHOLDERS
    ]
    require(bool(meaningful), "page has no meaningful initial main content")
    require(
        all(robots.can_fetch(agent, url) for agent in SEARCH_AGENTS),
        "robots.txt blocks a search crawler",
    )
    # Require links where the approved surface offers navigation. Policy text
    # and address lookup need no arbitrary links or catalogue of unrelated people.
    path = urlsplit(url).path
    if path not in ("/privacy", "/terms", "/candidates") and not path.startswith(
        "/candidates/"
    ):
        anchors = []
        for href in page.anchors:
            if not href or href.startswith("#"):
                continue
            candidate = urljoin(url, href)
            try:
                anchors.append(safe_url(candidate))
            except HealthFailure:
                # External official sources and intentional private controls are
                # not fetched; they never enter the public crawl sample.
                continue
        require(
            any(anchor != url for anchor in anchors),
            "page has no usable public main anchor",
        )
        expected_prefix = {
            "/bills": "/bills/",
            "/legislators": "/legislators/",
            "/money/committees": "/money/committees/",
            "/money/races": "/money/races/",
            "/money/lobbying/principals": "/money/lobbying/principals/",
            "/money/lobbying/lobbyists": "/money/lobbying/lobbyists/",
        }.get(path)
        if expected_prefix:
            require(
                any(
                    urlsplit(anchor).path.startswith(expected_prefix)
                    for anchor in anchors
                ),
                "directory has no real record anchors",
            )
    return page


def page_family(url: str) -> str:
    path = urlsplit(url).path
    if path.startswith("/blog/"):
        return "/".join(path.split("/")[:3])
    return path if path in FIXED_PATHS else "other-public-pages"


def select_samples(
    sections: dict[str, list[str]], today: date, *, broader: bool
) -> list[str]:
    groups = {key: values for key, values in sections.items() if key != "pages"}
    for url in sections.get("pages", []):
        groups.setdefault(f"pages:{page_family(url)}", []).append(url)
    selected = {ORIGIN + path for path in FIXED_PATHS + CANDIDATES}
    week = (today - date(2026, 1, 5)).days // 7
    for values in groups.values():
        ordered = sorted(values)
        count = min(4 if broader else 2, len(ordered))
        start = (week * count) % len(ordered)
        selected.update(
            ordered[(start + offset) % len(ordered)] for offset in range(count)
        )
    require(len(selected) <= 60, "page sample exceeds bounded limit")
    return sorted(selected)


def run_checks(
    fetcher: Fetcher,
    *,
    today: date,
    broader: bool,
    checked_commit: str | None,
    report: dict | None = None,
) -> dict:
    if report is None:
        report = {}
    report.update(
        {
            "schema_version": 1,
            "phase": "public-http-read",
            "passed": False,
            "started_at": datetime.now(timezone.utc).isoformat(),
            "target_origin": ORIGIN,
            "checked_commit": checked_commit,
            "served_commit": None,
            "release_match": "not-compared",
            "sample": "weekly-broader" if broader else "daily",
            "scope": "All 7 sitemap files and bounded initial-HTML samples; not proof of indexing, browser rendering, or numeric accuracy",
            "checks": [],
            "request_count": 0,
        }
    )

    def check(name, work):
        row = {"name": name, "passed": False, "failure": "check did not finish"}
        report["checks"].append(row)
        try:
            work(row)
            row["passed"] = True
            row.pop("failure")
        except HealthFailure as error:
            row["failure"] = str(error)

    robots = RobotFileParser()

    def read_robots(row):
        response = fetcher.fetch(ORIGIN + "/robots.txt")
        require(response.status == 200, f"robots.txt returned HTTP {response.status}")
        require(
            response.headers.get("Content-Type", "").lower().startswith("text/plain"),
            "robots.txt is not plain text",
        )
        robots.parse(response.text().splitlines())
        require(
            robots.site_maps() == [ORIGIN + "/sitemap.xml"],
            "robots.txt does not name the canonical sitemap once",
        )

    check("robots.txt", read_robots)
    check(
        "sitemap-index",
        lambda row: xml_urls(fetcher.fetch(ORIGIN + "/sitemap.xml"), index=True),
    )
    sections: dict[str, list[str]] = {}
    seen = set()
    for section, url in zip(SECTIONS, SITEMAPS, strict=True):

        def read_section(row, section=section, url=url):
            urls = xml_urls(fetcher.fetch(url), index=False)
            prefixes = {
                "bills": "/bills/",
                "legislators": "/legislators/",
                "committees": "/money/committees/",
                "races": "/money/races/",
                "lobbying-principals": "/money/lobbying/principals/",
                "lobbying-lobbyists": "/money/lobbying/lobbyists/",
            }
            if section in prefixes:
                require(
                    all(
                        urlsplit(url).path.startswith(prefixes[section])
                        and not urlsplit(url).query
                        for url in urls
                    ),
                    "sitemap contains an address from the wrong page family",
                )
            keys = {discovery_key(url) for url in urls}
            require(
                not seen.intersection(keys),
                "address appears in more than 1 sitemap child",
            )
            seen.update(keys)
            sections[section] = urls
            row["addresses"] = len(urls)

        check(f"sitemap:{section}", read_section)
    for path in FIXED_PATHS:
        check(
            f"discovery:{path}",
            lambda row, path=path: require(
                path in seen, "important public address is missing from sitemap"
            ),
        )
    samples = select_samples(sections, today, broader=broader)
    for url in samples:

        def read_page(row, url=url):
            response = fetcher.fetch(url)
            row["status"] = response.status
            page = validate_page(url, response, robots)
            if url == ORIGIN + "/":
                report["served_commit"] = page.release

        check(f"page:{url.removeprefix(ORIGIN)}", read_page)
    for path, mode in [(p, "missing") for p in MISSING_PATHS] + [
        (p, "private") for p in PRIVATE_CHECKS
    ]:
        check(
            f"{mode}:{path}",
            lambda row, path=path, mode=mode: validate_page(
                ORIGIN + path,
                fetcher.fetch(ORIGIN + path, private_check=mode == "private"),
                robots,
                mode=mode,
            ),
        )
    report["request_count"] = fetcher.requests
    report["passed"] = all(row["passed"] for row in report["checks"])
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output", type=Path, default=Path("public-search-health-results.json")
    )
    parser.add_argument("--checked-commit")
    parser.add_argument(
        "--broader",
        action="store_true",
        help="4 deterministic samples per family instead of 2",
    )
    args = parser.parse_args(argv)
    report: dict = {
        "schema_version": 1,
        "phase": "not-started",
        "passed": False,
        "checks": [],
    }
    fetcher = None
    try:
        require(
            args.checked_commit is None or bool(SHA.fullmatch(args.checked_commit)),
            "checked commit is not a full hash",
        )
        fetcher = Fetcher()
        report = run_checks(
            fetcher,
            today=datetime.now(timezone.utc).date(),
            broader=args.broader,
            checked_commit=args.checked_commit,
            report=report,
        )
    except HealthFailure as error:
        report["failure"] = str(error)
    except Exception:
        # Unexpected failures still preserve evidence without exposing remote
        # text, response headers, personal data or authentication addresses.
        report["failure"] = "unexpected checker failure"
    finally:
        if fetcher is not None:
            report["request_count"] = fetcher.requests
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(report, sort_keys=True, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )
    failed = [row for row in report["checks"] if not row["passed"]]
    print(
        f"Public search health: {'passed' if report['passed'] else 'FAILED'}; {len(failed)} failed checks; {len(report['checks'])} checks"
    )
    for row in failed:
        print(f"{row['name']}: {row['failure']}")
    if report.get("failure"):
        print(report["failure"])
    return int(not report["passed"])


if __name__ == "__main__":
    raise SystemExit(main())
