"""Precomputed per-session canonical issue counts for GET /policy-areas (#501).

The /policy-areas endpoint rolls the ~7,600 free-text ``ai_enrichment``
``policy_areas`` up to curated canonical issues (``alethical/api/issue_taxonomy.py``)
and counts distinct bills per canonical -- a ~278ms LATERAL/jsonb aggregation that
runs once per Search Bills page load. This module precomputes those counts into the
``policy_area_count`` table so the endpoint reads a prepared table instead of
recomputing live.

Accuracy is the contract (#501, grounded-answers rule 2): the stored counts MUST be
byte-identical to the live aggregation -- same canonical issues, same ``bill_count``,
same ordering (``bill_count`` DESC, name ASC). The refresh reuses the EXACT query the
endpoint falls back to (``compute_policy_area_counts``), so a precomputed count can
never disagree with a fresh recompute. For any session that was never refreshed the
endpoint recomputes live, so a missing precompute degrades safely to today's
correct-but-slower path rather than serving nothing.

Refresh runs automatically at the end of the enrichment apply step
(``alethical/pipeline/ai_enrichment.py``) and can be re-run on demand:

    uv run python -m alethical.pipeline.policy_area_counts [--target production] [--session SLUG]
    just refresh-policy-area-counts [target] [--session SLUG]

The backfill is zero-cost: the counts are derived entirely from
``ai_enrichment.content_json`` already in the database (no API calls, no paid run).
"""

from __future__ import annotations

import argparse
import json
import os

from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

from alethical.api.issue_taxonomy import alias_canonical_arrays
from alethical.db import models as schema
from alethical.db.session import (
    NO_PREPARED_STATEMENTS,
    database_url_for_target,
    normalize_database_url,
)

# The single source of truth for the canonical rollup. The /policy-areas endpoint's
# live-fallback path and the refresh both run this exact SQL, so a stored count can
# never diverge from a freshly computed one (#501). Mirrors the aggregation that used
# to live inline in the endpoint; the only difference is no LIMIT -- the full set is
# stored and the endpoint applies its LIMIT on read.
_AGGREGATION_SQL = text(
    """
    WITH m(alias, canonical) AS (
        SELECT * FROM unnest(:aliases ::text[], :canonicals ::text[])
    ),
    bill_area AS (
        SELECT b.id AS bill_id, lower(btrim(e)) AS area
        FROM ai_enrichment ae
        JOIN bill b ON b.id = ae.bill_id,
             LATERAL jsonb_array_elements_text(
                 ae.content_json -> 'policy_areas'
             ) AS e
        WHERE b.session_id = :sid ::uuid
          AND ae.enrichment_type = 'bill_summary'
          AND ae.is_current IS true
          AND btrim(e) <> ''
    )
    SELECT m.canonical AS name, count(DISTINCT ba.bill_id) AS bill_count
    FROM bill_area ba
    JOIN m ON m.alias = ba.area
    GROUP BY m.canonical
    ORDER BY bill_count DESC, name ASC
    """
)


def compute_policy_area_counts(db, session_id) -> list[tuple[str, int]]:
    """Live canonical ``(name, bill_count)`` rollup for a session, count DESC/name ASC.

    The unlimited form of the /policy-areas aggregation; callers apply any LIMIT on
    the returned list. Reused by both the endpoint's live fallback and the refresh so
    stored counts stay byte-identical to a live recompute (#501). Accepts a Session or
    a Connection -- it only issues ``text()`` SQL."""
    aliases, canonicals = alias_canonical_arrays()
    rows = db.execute(
        _AGGREGATION_SQL,
        {"aliases": aliases, "canonicals": canonicals, "sid": str(session_id)},
    ).all()
    return [(name, count) for name, count in rows]


def refresh_session_counts(db, session_id) -> int:
    """Replace ``policy_area_count`` rows for one session with a fresh computation.

    Delete-then-insert (not upsert) so a canonical that dropped to zero bills leaves
    no stale row behind. Does not commit -- the caller owns the transaction. Returns
    the number of canonical rows written."""
    counts = compute_policy_area_counts(db, session_id)
    db.execute(
        text("DELETE FROM policy_area_count WHERE session_id = :sid ::uuid"),
        {"sid": str(session_id)},
    )
    if counts:
        db.execute(
            text(
                "INSERT INTO policy_area_count "
                "(session_id, canonical_name, bill_count) "
                "VALUES (:sid ::uuid, :name, :count)"
            ),
            [
                {"sid": str(session_id), "name": name, "count": count}
                for name, count in counts
            ],
        )
    return len(counts)


def _sessions_with_enrichments(db) -> list:
    return list(
        db.execute(
            text(
                """
                SELECT DISTINCT b.session_id
                FROM ai_enrichment ae
                JOIN bill b ON b.id = ae.bill_id
                WHERE ae.enrichment_type = 'bill_summary'
                  AND ae.is_current IS true
                """
            )
        ).scalars()
    )


def refresh_all_counts(db) -> dict[str, int]:
    """Refresh every session that has current ``bill_summary`` enrichments.

    Does not commit -- the caller owns the transaction. Returns ``{session_id:
    canonical_row_count}``."""
    return {
        str(session_id): refresh_session_counts(db, session_id)
        for session_id in _sessions_with_enrichments(db)
    }


def _build_engine(target: str | None, database_url: str | None):
    url = normalize_database_url(database_url) if database_url else None
    return create_engine(
        database_url_for_target(target, url),
        pool_pre_ping=True,
        connect_args=NO_PREPARED_STATEMENTS,
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Refresh precomputed /policy-areas issue-chip counts (#501)."
    )
    parser.add_argument(
        "--target",
        default=os.environ.get("ALETHICAL_DATABASE_TARGET", "local"),
        help="Database target: local (default) or production.",
    )
    parser.add_argument(
        "--database-url", default=None, help="Explicit URL, overriding --target."
    )
    parser.add_argument(
        "--session",
        default=None,
        help="Session slug to refresh; default all sessions with enrichments.",
    )
    args = parser.parse_args()
    engine = _build_engine(args.target, args.database_url)
    with Session(engine) as db:
        if args.session:
            row = db.scalar(
                select(schema.LegislativeSession).where(
                    schema.LegislativeSession.slug == args.session
                )
            )
            if row is None:
                raise SystemExit(f"Unknown session slug: {args.session}")
            summary = {args.session: refresh_session_counts(db, row.id)}
        else:
            summary = refresh_all_counts(db)
        db.commit()
    print(json.dumps({"refreshed": summary}, indent=2))


if __name__ == "__main__":
    main()
