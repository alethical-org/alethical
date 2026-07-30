#!/usr/bin/env python3
"""Report any bill version storing fewer sections than its page published (#763).

Net: run this after any bill ingest to find out whether a bill's stored text is
complete. It costs one query and fetches nothing.

Why it can tell without fetching the page: `bill_version_section.source_order`
holds the section's position on the page, written as the importer walks the page
top to bottom. So the highest stored position IS the page's section count, and a
version that lost sections ends up with a highest position larger than its row
count. That gap is the exact fingerprint of a lost section, with no false
positives — the positions a complete version stores are 1..N with nothing missing.

The bug that produced the fingerprint is fixed (rows are keyed on position now,
not on the section id, which a page may repeat — see #763), and
`scripts/repair_missing_bill_sections.py` restores the sections already lost. This
is the standing check that the next occurrence does not go unnoticed: an
incomplete Bill Text tab is invisible from inside the product, because the
sections that survive look perfectly normal.

Exits 1 when any current version has a gap, so it can gate a script or a job.
Superseded versions are reported separately and never fail the check — nothing in
the product reads them.

Usage (run from the repo root; PYTHONPATH=. so `alethical` imports as a file):
    ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. uv run \
        python scripts/check_bill_section_gaps.py
"""

from __future__ import annotations

import os
import sys

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from alethical.db.session import (
    NO_PREPARED_STATEMENTS,
    database_url_for_target,
    normalize_database_url,
)

GAPS_SQL = """
select b.bill_key, v.version_code, v.is_current,
       count(*) as stored, max(s.source_order) as page_sections
from bill_version_section s
join bill_version v on v.id = s.bill_version_id
join bill b on b.id = v.bill_id
group by 1, 2, 3
having max(s.source_order) > count(*)
order by (max(s.source_order) - count(*)) desc, b.bill_key
"""


def main() -> int:
    database_url = normalize_database_url(
        os.environ.get("DATABASE_URL")
        or database_url_for_target(os.environ.get("ALETHICAL_DATABASE_TARGET"))
    )
    engine = create_engine(
        database_url, echo=False, connect_args=NO_PREPARED_STATEMENTS
    )

    with Session(engine) as session:
        rows = session.execute(text(GAPS_SQL)).all()

    current = [row for row in rows if row.is_current]
    superseded = [row for row in rows if not row.is_current]

    if not current:
        print(
            "OK — every current bill version stores every section its page published."
        )
    else:
        missing = sum(row.page_sections - row.stored for row in current)
        print(
            f"INCOMPLETE — {len(current)} current versions are missing "
            f"{missing} sections between them:"
        )
        for row in current:
            print(
                f"    {row.bill_key} v{row.version_code}: page has "
                f"{row.page_sections} sections, {row.stored} stored, "
                f"{row.page_sections - row.stored} missing"
            )
        print(
            "\nFix: scripts/repair_missing_bill_sections.py (dry run first). "
            "If it reports a bill as needing a re-ingest instead, the page has "
            "changed since ingest — re-ingest that bill."
        )

    if superseded:
        missing = sum(row.page_sections - row.stored for row in superseded)
        print(
            f"\n{len(superseded)} superseded versions are missing {missing} sections. "
            f"Not a failure — nothing in the product reads a superseded version."
        )

    return 1 if current else 0


if __name__ == "__main__":
    sys.exit(main())
