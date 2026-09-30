#!/usr/bin/env python3
"""Confirm the seven private report feeds refuse signed-out reads.

This deliberately sends no credentials and never prints a response body. It cannot
measure provider freshness now that the feeds require an administrator session.
"""

from __future__ import annotations

import argparse
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from scripts.check_site_metrics_health import SOURCES


# Previously cached query variants must also refuse unsigned reads after purge.
READ_URLS = SOURCES + (
    ("google-default", "https://www.alethical.com/api/traffic-google"),
    ("google-28-day", "https://www.alethical.com/api/traffic-google?window=28"),
    ("actions-default", "https://api.alethical.com/api/v1/site-metrics"),
    ("actions-v1", "https://api.alethical.com/api/v1/site-metrics?version=1"),
)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def denies_unsigned_read(url: str) -> bool:
    request = Request(url, headers={"Accept": "application/json"}, method="GET")
    try:
        with build_opener(NoRedirect()).open(request, timeout=10):
            return False
    except HTTPError as error:
        status = error.code
        error.close()
        return status in (401, 403)
    except (URLError, OSError):
        return False


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--summary", type=Path)
    args = parser.parse_args(argv)
    lines = []
    failed = False
    for name, url in READ_URLS:
        passed = denies_unsigned_read(url)
        failed = failed or not passed
        line = f"{name}: {'private' if passed else 'FAILED: signed-out access was not denied'}"
        print(line)
        lines.append(f"- {line}")
    if args.summary:
        args.summary.write_text(
            "## Site Metrics private access\n\n" + "\n".join(lines) + "\n",
            encoding="utf-8",
        )
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
