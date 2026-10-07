"""Keep an unapproved donor audit and its inputs privately, without activation."""

from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path
import tarfile
from tempfile import TemporaryDirectory

from sqlalchemy import text

from alethical.api.services.lobbying_donations import last_completed_year
from alethical.pipeline.campaign_finance_recheck import FIRST_SUPPORTED_YEAR
from alethical.pipeline.campaign_finance_refresh import live_versions
from alethical.pipeline.lobbyist_evidence_publication import audit_digest, prepare_run
from alethical.pipeline.lobbyist_report_collection import collect_reports
from alethical.pipeline.raw_file_store import sha256_of_file


def supported_years() -> list[int]:
    return list(range(FIRST_SUPPORTED_YEAR, last_completed_year() + 1))


def retain_candidate(store, directory: Path, run: dict) -> dict:
    """Keep all inputs needed by the existing reviewed-publication command.

    This deliberately writes no database records, including report identities. The
    private bundle is a review input, never a positive donor proof or public claim.
    """
    audit = json.dumps(run, sort_keys=True, default=str).encode()
    files = {}
    hashes = {"audit.json": hashlib.sha256(audit).hexdigest()}
    for path in sorted(directory.iterdir()):
        if path.is_symlink() or not path.is_file():
            raise ValueError("unexpected_source_path")
        digest = sha256_of_file(str(path))
        # Collected PDFs are named by their bytes; refuse corruption before saving.
        if path.suffix == ".pdf" and digest != path.stem:
            raise ValueError("source_document_changed")
        files[f"sources/{path.name}"] = path
        hashes[f"sources/{path.name}"] = digest
    # Requiring all referenced PDFs also catches a silently incomplete local copy.
    for recipient in run["recipients"] + run.get("failures", []):
        documents = recipient.get("documents", []) + (
            recipient.get("coverage") or {}
        ).get("documents", [])
        for doc in documents:
            if f"sources/{doc['document_hash']}.pdf" not in files:
                raise ValueError("source_document_missing")
    manifest = {
        "audit_hash": audit_digest(run),
        "release_id": run["release_id"],
        "filings_snapshot_id": run["filings_snapshot_id"],
        "years": run["years"],
        "approved": False,
        "files": hashes,
    }
    metadata = {
        "audit.json": audit,
        "manifest.json": json.dumps(manifest, sort_keys=True).encode(),
    }
    with TemporaryDirectory() as temp:
        archive = Path(temp) / "candidate.tar.gz"
        with tarfile.open(archive, "w:gz") as bundle:
            for name, body in metadata.items():
                info = tarfile.TarInfo(name)
                info.size = len(body)
                info.mode = 0o600
                bundle.addfile(info, io.BytesIO(body))
            for name, path in files.items():
                with path.open("rb") as source:
                    info = tarfile.TarInfo(name)
                    info.size = path.stat().st_size
                    info.mode = 0o600
                    bundle.addfile(info, source)
                if sha256_of_file(str(path)) != hashes[name]:
                    raise ValueError("source_changed_during_storage")
        digest = sha256_of_file(str(archive))
        key = f"campaign-finance/lobbyist-evidence/prepared/{digest}.tar.gz"
        store.put_and_verify(key, str(archive), digest)
    return {
        k: manifest[k]
        for k in (
            "audit_hash",
            "release_id",
            "filings_snapshot_id",
            "years",
            "approved",
        )
    } | {
        "object_key": key,
        "compressed_hash": digest,
        "checked_recipient_years": len(run["recipients"]),
        "unavailable_recipient_years": len(run.get("failures", [])),
    }


def prepare_candidate(db, store, years: list[int] | None = None) -> dict:
    years = sorted(set(supported_years() if years is None else years))
    if not years or not set(years).issubset(supported_years()):
        raise ValueError("choose_supported_completed_years")
    with TemporaryDirectory() as temp:
        directory = Path(temp)
        # Collection releases its read transaction before network work and uses at
        # most 2 concurrent official reads. No previously retained local files.
        db.execute(text("SET TRANSACTION READ ONLY"))
        before = live_versions(db)
        db.rollback()
        db.execute(text("SET TRANSACTION READ ONLY"))
        collection = collect_reports(db, directory, years)
        db.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"))
        try:
            run = prepare_run(db, directory, years)
            if (
                run["release_id"] != before.payments_release_id
                or run["filings_snapshot_id"] != before.filings_snapshot_id
            ):
                raise ValueError("sources_changed_during_collection")
        finally:
            db.rollback()
        return retain_candidate(store, directory, run) | {"collection": collection}
