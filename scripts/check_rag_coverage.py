#!/usr/bin/env python3
"""Report any bill whose text is stored but not searchable (#844).

Net: a bill becomes answerable in two stages -- ingestion stores its text, then
embedding makes it findable. When stage two has not run, the bill sits on the
site looking completely normal and Grounded Ask cannot find or cite a word of it,
so a reader gets an honest refusal about a bill we are holding in full. Nothing
inside the product shows this, which is why the check exists.

It costs one query and fetches nothing. No paid API, no writes.

Exits 1 when any bill is unsearchable, so it can gate a script or a job.

Usage (run from the repo root; PYTHONPATH=. so `alethical` imports as a file)::

    ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. uv run \\
        python scripts/check_rag_coverage.py

**Why a schedule is the only place this can live.** The job-queue path already
embeds -- ``BillSyncChunkWorker`` (``alethical/pipeline/oban_workers.py``) calls
``build_rag_rows_for_bill_keys`` whenever ``include_rag`` is true, the default. Two
paths do not, and between them they produced every one of the 69 bills #844 found:

  * ``scripts/load_minnesota_data.py`` -- ingests text and never embeds.
  * ``scripts/repair_missing_bill_sections.py`` -- inserts sections and prints a
    line telling a person to embed them afterwards.

Both run by hand from a laptop, so no CI run can see one happen, and the second
depends on somebody reading a printed instruction. That is what went wrong: #844
was found only because someone finishing #763 happened to follow that line.

It asks the same question the pipeline asks itself, by importing the pipeline's
own staleness query (``STALE_RAG_BILL_KEYS_SQL`` in ``alethical/pipeline/rag.py``)
rather than restating it -- so a change to what "searchable" means cannot leave
this check quietly measuring the old definition.
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
from alethical.pipeline import rag as rag_text

MODEL = "text-embedding-3-small"

# What each unsearchable bill would cost to fix, so the report carries the number
# somebody needs to decide with rather than sending them to work it out.
SIZE_SQL = """
select b.bill_key,
       count(*) as sections,
       coalesce(sum(length(s.raw_text)), 0) as characters
  from bill b
  join bill_version v on v.bill_id = b.id and v.is_current
  join bill_version_section s on s.bill_version_id = v.id
 where b.bill_key = any(cast(:keys as text[]))
 group by b.bill_key
 order by count(*) desc, b.bill_key
"""


def main() -> int:
    database_url = normalize_database_url(
        os.environ.get("DATABASE_URL")
        or database_url_for_target(os.environ.get("ALETHICAL_DATABASE_TARGET"))
    )
    engine = create_engine(
        database_url, echo=False, connect_args=NO_PREPARED_STATEMENTS
    )
    params = {
        "cleaning_version": rag_text.CLEANING_VERSION,
        "chunking_version": rag_text.CHUNKING_VERSION,
        "model": MODEL,
    }

    with Session(engine) as session:
        keys = list(session.scalars(text(rag_text.STALE_RAG_BILL_KEYS_SQL), params))
        rows = session.execute(text(SIZE_SQL), {"keys": keys}).all() if keys else []

    if not keys:
        print("OK — every bill on the site is searchable.")
        return 0

    characters = sum(int(row.characters) for row in rows)
    sections = sum(int(row.sections) for row in rows)
    print(
        f"UNSEARCHABLE — {len(keys)} bills are stored but cannot be found or "
        f"cited, covering {sections:,} sections:"
    )
    for row in rows:
        print(
            f"    {row.bill_key:20} {int(row.sections):5} sections, "
            f"{int(row.characters):9,} characters"
        )
    # ~4 characters a token for English prose; $0.02 per million input tokens for
    # text-embedding-3-small. Close enough to decide with.
    print(
        f"\nFix (~${characters / 4 / 1_000_000 * 0.02:.4f}, dry run first):\n"
        "    ALETHICAL_DATABASE_TARGET=production PYTHONPATH=. uv run python \\\n"
        "        scripts/backfill_rag_bulk.py --source-target production"
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
