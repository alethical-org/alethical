"""Bind stored PDF comparison proof to the reader and its installed dependencies."""

from __future__ import annotations

import hashlib
import importlib.metadata
import json
import sys
from functools import lru_cache
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import Session

READER_KEY = "money_check_reader_identity"
# NULL verdicts remain readable during rolling deployment until a new checker
# establishes its actual reader. Thereafter they cannot count as current proof.
READER_PREDICATE = """(
    NOT EXISTS (SELECT 1 FROM cf_refresh_state WHERE key = 'money_check_reader_identity')
    OR reader_identity = (SELECT value->>'fingerprint' FROM cf_refresh_state
                           WHERE key = 'money_check_reader_identity')
)"""


@lru_cache(maxsize=1)
def reader_identity() -> str:
    directory = Path(__file__).parent
    digest = hashlib.sha256()
    for name in (
        "campaign_finance_check_identity.py",
        "campaign_finance_report_documents.py",
        "campaign_finance_report_document_store.py",
        "campaign_finance_stated_split.py",
        "campaign_finance_stated_spending.py",
        "campaign_finance_reader.py",
        "campaign_finance_filings.py",
    ):
        digest.update(name.encode())
        digest.update((directory / name).read_bytes())
    versions = {"python": ".".join(str(part) for part in sys.version_info[:3])}
    for package in ("pypdf", "fonttools", "cryptography"):
        try:
            versions[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            versions[package] = "absent"
    digest.update(json.dumps(versions, sort_keys=True).encode())
    return digest.hexdigest()


def stage_reader_identity(
    db: Session, fingerprint: str, *, record_verdict: bool = True
) -> None:
    """Stage proof activation with the caller's verdict/progress transaction."""
    if (
        db.scalar(text("SELECT release_id FROM cf_current_release WHERE id IS TRUE"))
        is None
    ):
        return
    prior = db.scalar(
        text("SELECT value->>'fingerprint' FROM cf_refresh_state WHERE key = :key"),
        {"key": READER_KEY},
    )
    if prior == fingerprint and not record_verdict:
        return
    db.execute(
        text(
            "INSERT INTO cf_refresh_state (key, value) VALUES (:key, CAST(:value AS jsonb)) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()"
        ),
        {"key": READER_KEY, "value": json.dumps({"fingerprint": fingerprint})},
    )

    from alethical.pipeline import campaign_finance_refresh as refresh
    from alethical.pipeline.cache_purge import A_MONEY_CHECK_VERDICT_SET

    pending = refresh.state_get(db, refresh.CLEARING_PENDING_KEY) or {}
    events = list(
        dict.fromkeys([*pending.get("events", []), A_MONEY_CHECK_VERDICT_SET])
    )
    refresh._stage_state_update(
        db, set_values={refresh.CLEARING_PENDING_KEY: refresh._clearing_marker(events)}
    )

    if prior != fingerprint:
        # A reader change retires proof for both files, even when only1 source
        # changed or a hand-run checker chose only1 of them.
        from alethical.pipeline.cache_purge import when_the_money_checks_finish

        refresh.stage_publication_followups(db, when_the_money_checks_finish())
