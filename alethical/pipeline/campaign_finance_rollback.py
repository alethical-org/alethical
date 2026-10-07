"""Exact retained-row rollback for a reviewed campaign totals release.

Capture while the baseline is live. Restore only that identical retained baseline,
from the expected replacement, while the payment release is unchanged. Callers own
transactions and the normal full-run lease. No row reconstruction or pruning.
"""

from __future__ import annotations

import hashlib
import json
from tempfile import TemporaryDirectory
from uuid import UUID

from sqlalchemy import text

from alethical.db import models as schema
from alethical.pipeline import campaign_finance_filings as filings
from alethical.pipeline.campaign_finance_refresh import (
    live_versions,
    stage_publication_followups,
)
from alethical.pipeline.cache_purge import when_a_filings_release_lands

TABLES = ("cf_filer", "cf_filing_report", "cf_filing", "cf_filing_figure")


def retained_rows(db, snapshot_id: str) -> dict:
    result = {}
    for table in TABLES:
        predicate = (
            "r.filing_id IN (SELECT id FROM cf_filing WHERE snapshot_id=:snapshot)"
            if table == "cf_filing_figure"
            else "r.snapshot_id=:snapshot"
        )
        # Hash each complete row, including provenance and dates. Order has no
        # meaning, but duplicate row hashes remain represented in the final hash.
        hashes = sorted(
            hashlib.sha256(json.dumps(row, sort_keys=True).encode()).hexdigest()
            for row in db.scalars(
                text(f"SELECT to_jsonb(r) FROM {table} r WHERE {predicate}"),
                {"snapshot": UUID(snapshot_id)},
            )
        )
        result[table] = {
            "count": len(hashes),
            "hash": hashlib.sha256("\n".join(hashes).encode()).hexdigest(),
        }
    return result


def capture_baseline(db, store) -> dict:
    live = live_versions(db)
    if not live.filings_snapshot_id or not live.payments_release_id:
        raise ValueError("both_live_sources_required")
    snapshot = db.get(
        schema.CampaignFinanceFilingSnapshot, UUID(live.filings_snapshot_id)
    )
    rows = retained_rows(db, live.filings_snapshot_id)
    for table, expected in (
        ("cf_filer", snapshot.filer_count),
        ("cf_filing_report", snapshot.report_count),
        ("cf_filing", snapshot.filing_count),
        ("cf_filing_figure", snapshot.figure_count),
    ):
        if expected is None or rows[table]["count"] < expected:
            raise ValueError("baseline_rows_incomplete")
    archives = []
    pending = {snapshot.id}
    # Retained rows can point into older source archives. Prove those too.
    for table in ("cf_filer", "cf_filing"):
        pending.update(
            db.scalars(
                text(
                    f"SELECT DISTINCT retained_from_snapshot_id FROM {table} "
                    "WHERE snapshot_id=:snapshot AND retained_from_snapshot_id IS NOT NULL"
                ),
                {"snapshot": snapshot.id},
            )
        )
    with TemporaryDirectory() as temp:
        for source_id in sorted(pending, key=str):
            source = db.get(schema.CampaignFinanceFilingSnapshot, source_id)
            if source is None or not source.compressed_hash:
                raise ValueError("baseline_archive_missing")
            run = filings.FilingsRun(
                years=list(source.years),
                segments=[tuple(s) for s in source.segments],
                fetch_started_at=source.fetch_started_at,
                fetch_completed_at=source.fetch_completed_at,
            )
            filings.rebuild_run_from_retained_archive(db, run, source, store, temp)
            archives.append(
                {
                    "snapshot_id": str(source.id),
                    "object_key": source.object_key,
                    "compressed_hash": source.compressed_hash,
                }
            )
    return {
        "baseline_snapshot_id": str(snapshot.id),
        "baseline_hash": snapshot.record_set_hash,
        "payments_release_id": live.payments_release_id,
        "rows": rows,
        "archives": archives,
    }


def restore_baseline(
    db, proof: dict, *, expected_current: str, apply: bool = False
) -> None:
    """Restore the pointer in the caller's transaction; refuse changed/pruned rows."""
    if apply:
        db.execute(
            text("SELECT pg_advisory_xact_lock(:key)"),
            {"key": filings.PUBLISH_LOCK_KEY},
        )
    pointer = db.execute(
        text(
            "SELECT snapshot_id FROM cf_filing_current WHERE id=true"
            + (" FOR UPDATE" if apply else "")
        )
    ).scalar_one()
    if str(pointer) != expected_current:
        raise ValueError("unexpected_live_totals")
    if live_versions(db).payments_release_id != proof["payments_release_id"]:
        raise ValueError("payment_release_changed")
    baseline = db.get(
        schema.CampaignFinanceFilingSnapshot, UUID(proof["baseline_snapshot_id"])
    )
    if baseline is None or baseline.record_set_hash != proof["baseline_hash"]:
        raise ValueError("baseline_identity_changed")
    if retained_rows(db, proof["baseline_snapshot_id"]) != proof["rows"]:
        raise ValueError("baseline_rows_changed_or_pruned")
    if apply:
        db.execute(
            text("UPDATE cf_filing_current SET snapshot_id=:baseline WHERE id=true"),
            {"baseline": baseline.id},
        )

        stage_publication_followups(db, when_a_filings_release_lands())
