#!/usr/bin/env python3
"""Detect new official session codes for review; never guess their database mapping."""

from __future__ import annotations

import argparse
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import create_engine  # noqa: E402
from alethical.db.session import NO_PREPARED_STATEMENTS, database_url_for_target  # noqa: E402
from alethical.pipeline.minnesota import fetch_text  # noqa: E402
from alethical.pipeline.sessions import SESSION_DEFINITIONS  # noqa: E402
from alethical.pipeline.votes import rate_limited_source_session  # noqa: E402
from scripts.load_minnesota_data import _validated_database_target  # noqa: E402

URL = "https://www.revisor.mn.gov/bills/status_search.php"


class SessionOptions(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_session = False
        self.codes = set()

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == "select":
            self.in_session = attributes.get("name") == "session"
        if tag == "option" and self.in_session:
            value = attributes.get("value") or ""
            if re.fullmatch(r"\d{7,8}", value):
                self.codes.add(value)

    def handle_endtag(self, tag):
        if tag == "select":
            self.in_session = False


def unreviewed_session_codes(html: str) -> list[str]:
    parser = SessionOptions()
    parser.feed(html)
    if not parser.codes:
        raise ValueError("The official session selector could not be read")
    current_start = min(
        definition.year_start
        for definition in SESSION_DEFINITIONS.values()
        if definition.is_current
    )
    return sorted(
        code
        for code in parser.codes
        if int(code[-4:]) >= current_start and code not in SESSION_DEFINITIONS
    )


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=("local", "production"), required=True)
    args = parser.parse_args(argv)
    url = database_url_for_target(args.target)
    _validated_database_target(args.target, url)
    engine = create_engine(url, connect_args=NO_PREPARED_STATEMENTS)
    source = rate_limited_source_session(engine, target=args.target)
    try:
        codes = unreviewed_session_codes(fetch_text(source, URL))
        print(json.dumps({"source": URL, "unreviewed_session_codes": codes}))
        return 2 if codes else 0
    finally:
        source.close()
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
