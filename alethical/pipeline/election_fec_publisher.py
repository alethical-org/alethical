"""Bind the federal publisher to its retained, official About page.

This proves the publisher's identity only. It cannot prove a candidate link,
filing coverage, a payment or an election outcome.
"""

import hashlib
import json
from urllib.parse import urlsplit

from alethical.pipeline.election_comparison import ComparisonImportError
from alethical.pipeline.election_external_finance import CheckedExtraction

ADAPTER_ID = "fec_publisher:v1"
URL = "https://www.fec.gov/about/"
TITLE = "Federal Election Commission | United States of America"
DESCRIPTION = (
    "The FEC is an independent government agency, created by Congress in 1974."
)


def extract_publisher(body: bytes, source: dict, locator: dict) -> CheckedExtraction:
    """Return exact selected source lines and their narrowly defined identity."""
    parsed = urlsplit(source.get("url", ""))
    if (
        source.get("authority") != "fec"
        or source.get("sha256") != hashlib.sha256(body).hexdigest()
        or parsed.geturl() != URL
        or source.get("media_type", "").split(";")[0] != "text/html"
        or locator != {"kind": "publisher"}
    ):
        raise ComparisonImportError(
            "FEC publisher needs its retained official About page"
        )
    try:
        lines = body.decode("utf-8", errors="strict").splitlines()
    except UnicodeDecodeError as error:
        raise ComparisonImportError(
            "FEC publisher page is not readable UTF-8"
        ) from error
    name = next(
        (
            (index, line)
            for index, line in enumerate(lines, 1)
            if TITLE in line and 'class="site-title"' in line and 'href="/"' in line
        ),
        None,
    )
    agency = next(
        ((index, line) for index, line in enumerate(lines, 1) if DESCRIPTION in line),
        None,
    )
    if name is None or agency is None:
        raise ComparisonImportError(
            "FEC publisher identity is missing from the About page"
        )
    return CheckedExtraction(
        facts={
            "key": "fec",
            "name": "Federal Election Commission",
            # The source's full country name and this namespace's established
            # short name denote the same jurisdiction, not a state or district.
            "jurisdiction": "United States",
            "publisher_url": "https://www.fec.gov",
        },
        quote=json.dumps(
            {
                "format": "selected-source-lines-v1",
                "lines": [{"line": n, "text": text} for n, text in (name, agency)],
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ),
    )
