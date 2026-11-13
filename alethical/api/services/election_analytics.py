"""Descriptive, exact-row Board funder analytics for one published election.

Amounts describe itemized source records, never complete campaign fundraising,
election-only spending, causation or return on investment. Names are display values,
never identity joins. Every source row survives the reconciliation partition.
"""

from __future__ import annotations

from collections import defaultdict
from contextlib import nullcontext
from copy import deepcopy
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
import csv
import gzip
import hashlib
import io
import json
import re
from pathlib import Path
import tempfile
from urllib.parse import quote, urlencode
import zlib

from botocore.exceptions import ClientError
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from fastapi import HTTPException

from alethical.api.problems import problem_exception
from alethical.api.services.election_source_io import (
    lazy_request_store,
    request_store,
    source_map,
)
from alethical.api.services import committee_finance, finance_versions
from alethical.api.services import election_external_finance_reads as external_reads
from alethical.api.services import election_comparison_reads as results
from alethical.api.services.election_finance_reads import _changed, _unavailable
from alethical.db import models as m
from alethical.pipeline import campaign_finance_reader as reader
from alethical.pipeline.campaign_finance import (
    CONTRIBUTION_COLUMNS,
    INDEPENDENT_COLUMNS,
)
from alethical.pipeline.election_account_reviews import candidate_identity
from alethical.pipeline.election_comparison import ComparisonImportError
from alethical.pipeline.raw_file_store import (
    StorageIntegrityError,
    StorageObjectMissingError,
    StorageReadError,
)
from alethical.api.services.election_source_io import (
    reader_store_from_env as raw_file_store_from_env,
)

DATASETS = {
    "contributions": (m.CampaignFinanceContributionRow, CONTRIBUTION_COLUMNS),
    "independent_expenditures": (
        m.CampaignFinanceIndependentExpenditureRow,
        INDEPENDENT_COLUMNS,
    ),
}
METRICS = (
    "direct_contributions",
    "independent_For",
    "independent_Against",
    "independent_unknown",
)
FUNDER_TYPES = {
    "Political Committee/Fund": "PCF",
    "Party Unit": "PTU",
    "Candidate Committee": "PCC",
    "PCF": "PCF",
    "PTU": "PTU",
    "PCC": "PCC",
}

# Published metadata bounds both network input and decompression. Ordinary
# analytics discard each raw chunk after hashing; only an explicit source
# download writes a raw temporary file. No availability survives the request.
SOURCE_CHUNK_BYTES = 1024 * 1024


@dataclass(frozen=True)
class _SourceProof:
    object_key: str
    compression: str
    compressed_hash: str
    compressed_size: int
    raw_hash: str
    raw_size: int
    prefix: bytes | None = None


def _source_read_unavailable():
    """A failed operation cannot establish a smaller set of source evidence."""
    return problem_exception(
        503, "Service Unavailable", "Records are busy", headers={"Retry-After": "1"}
    )


def _verify_original(store, proof: _SourceProof | None, output: Path | None = None):
    """Prove one exact retained original without buffering its entire body."""
    if (
        proof is None
        or proof.compression != "gzip"
        or not proof.object_key
        or not isinstance(proof.compressed_size, int)
        or proof.compressed_size <= 0
        or not isinstance(proof.raw_size, int)
        or proof.raw_size < 0
        or (proof.prefix is not None and proof.raw_size < len(proof.prefix))
        or not re.fullmatch(r"[a-f0-9]{64}", proof.compressed_hash or "")
        or not re.fullmatch(r"[a-f0-9]{64}", proof.raw_hash or "")
    ):
        return False
    try:
        with tempfile.TemporaryDirectory(
            prefix="election-analytics-proof-"
        ) as directory:
            path = Path(directory) / "original.csv.gz"
            try:
                store.get(proof.object_key, str(path), max_bytes=proof.compressed_size)
            except (
                StorageObjectMissingError,
                StorageIntegrityError,
                ComparisonImportError,
            ):
                return False
            except ClientError as error:
                code = error.response.get("Error", {}).get("Code")
                status = error.response.get("ResponseMetadata", {}).get(
                    "HTTPStatusCode"
                )
                if error.operation_name == "GetObject" and (
                    code == "NoSuchKey"
                    or (code in {"404", "NotFound"} and status == 404)
                ):
                    return False
                raise _source_read_unavailable() from None
            except Exception:
                # SDK errors may contain private endpoints and object keys.
                raise _source_read_unavailable() from None
            if path.stat().st_size != proof.compressed_size:
                return False
            compressed_hash = hashlib.sha256()
            with path.open("rb") as handle:
                for chunk in iter(lambda: handle.read(SOURCE_CHUNK_BYTES), b""):
                    compressed_hash.update(chunk)
            if compressed_hash.hexdigest() != proof.compressed_hash:
                return False
            raw_hash = hashlib.sha256()
            size = 0
            # Opening the output only for source_body avoids both a raw disk
            # copy and a full-size in-memory bytes value on normal reads.
            with (
                gzip.open(path, "rb") as raw,
                output.open("wb") if output is not None else nullcontext() as target,
            ):
                while True:
                    chunk = raw.read(min(SOURCE_CHUNK_BYTES, proof.raw_size - size + 1))
                    if not chunk:
                        break
                    if (
                        size == 0
                        and proof.prefix is not None
                        and not chunk.startswith(proof.prefix)
                    ):
                        return False
                    size += len(chunk)
                    if size > proof.raw_size:
                        return False
                    raw_hash.update(chunk)
                    if target is not None:
                        if target.write(chunk) != len(chunk):
                            raise StorageReadError(
                                "Original download write was incomplete"
                            )
            return size == proof.raw_size and raw_hash.hexdigest() == proof.raw_hash
    except (gzip.BadGzipFile, EOFError, zlib.error):
        # Complete retained bytes that cannot decode are invalid evidence.
        return False
    except HTTPException:
        raise
    except Exception:
        # Local I/O or cleanup failure also leaves the proof incomplete.
        raise _source_read_unavailable() from None


def _source_availability(proofs, requested_output=None, *, cache=None, store=None):
    """At most one bounded GET per required dataset, with no SQL in workers."""
    cache = cache if cache is not None else {}
    requested_proof = (
        proofs.get(requested_output[0]) if requested_output is not None else None
    )
    needed = {
        proof
        for proof in proofs.values()
        if proof not in cache
        or (
            requested_output is not None
            and proof == requested_proof
            and not requested_output[1].exists()
        )
    }
    if not needed:
        return {key: cache[proof] for key, proof in proofs.items()}

    def create_store():
        try:
            return raw_file_store_from_env()
        except Exception:
            # A missing configuration file is not a missing source object.
            raise _source_read_unavailable() from None

    # A missing proof needs no client; required setup failures are retryable.
    store = (
        request_store(store) if store is not None else lazy_request_store(create_store)
    )

    def checked(proof):
        return proof, _verify_original(
            store,
            proof,
            requested_output[1]
            if requested_output is not None and requested_proof == proof
            else None,
        )

    cache.update(source_map(checked, needed))
    return {key: cache[proof] for key, proof in proofs.items()}


def _money(value):
    return format(value, "f") if value is not None else None


def _measure(rows):
    known = [Decimal(row["amount"]) for row in rows if row["amount"] is not None]
    missing = len(rows) - len(known)
    subtotal = sum(known, Decimal(0)) if known else None
    return {
        "state": "no_records"
        if not rows
        else "amount_unavailable"
        if missing
        else "reported",
        "record_count": len(rows),
        "amount": _money(subtotal) if rows and not missing else None,
        "known_amount_subtotal": _money(subtotal),
        "missing_amount_count": missing,
    }


def _page(rows, limit, offset):
    return {
        "total": len(rows),
        "offset": offset,
        "limit": limit,
        "has_more": offset + limit < len(rows),
    }


def _bulk_accounts(
    db, election_key, races, *, proof_cache=None, store=None, verify_originals=True
):
    """Same latest-per-account/identity/evidence rules as applicable_accounts.

    Load decisions and unique evidence together, not once for each of 8,002
    candidates. Historical decisions participate in the version, including their
    evidence availability. Private reviewer names and reasons never leave here.

    False is an internal relationship metadata plan for the expense reader,
    whose mandatory scoped original proof runs after report selection and before
    any figures. Such accounts/stamps explicitly carry no original-proof claim.
    """
    decisions = list(
        db.scalars(
            select(m.ElectionCampaignAccountDecision)
            .where(
                m.ElectionCampaignAccountDecision.election_key == election_key,
                m.ElectionCampaignAccountDecision.authority == "mn_cfb",
            )
            .order_by(m.ElectionCampaignAccountDecision.id.desc())
        )
    )
    hashes, documents, collection_ids = set(), set(), set()
    for decision in decisions:
        for item in decision.evidence:
            (
                documents
                if item.get("kind") in {"report_cover", "report_excerpt"}
                else hashes
            ).add(item.get("sha256"))
            if item.get("collection_id"):
                collection_ids.add(item["collection_id"])
    held = (
        {
            row.content_hash: row
            for row in db.scalars(
                select(m.ElectionResultSource).where(
                    m.ElectionResultSource.content_hash.in_(hashes)
                )
            )
        }
        if hashes
        else {}
    )
    held_docs = (
        {
            row.document_hash: row
            for row in db.scalars(
                select(m.CampaignFinanceReportDocument).where(
                    m.CampaignFinanceReportDocument.document_hash.in_(documents)
                )
            )
        }
        if documents
        else {}
    )
    proofs = {}
    for kind, items in (("source", held), ("document", held_docs)):
        for fingerprint, source in items.items():
            proofs[(kind, fingerprint)] = _SourceProof(
                source.object_key,
                source.compression,
                source.compressed_hash,
                source.compressed_byte_size,
                fingerprint,
                source.byte_size,
            )
    available = (
        _source_availability(proofs, cache=proof_cache, store=store)
        if verify_originals
        else {key: True for key in proofs}
    )
    collections = (
        {
            row.id: row
            for row in db.scalars(
                select(m.ElectionFinanceCollection).where(
                    m.ElectionFinanceCollection.id.in_(collection_ids)
                )
            )
        }
        if collection_ids
        else {}
    )

    document_memberships = (
        set(
            db.execute(
                select(
                    m.ElectionFinanceReport.collection_id,
                    m.ElectionFinanceReport.document_hash,
                    m.ElectionFinanceReport.registration_number,
                ).where(
                    m.ElectionFinanceReport.collection_id.in_(collection_ids),
                    m.ElectionFinanceReport.document_hash.in_(documents),
                )
            )
        )
        if collection_ids and documents
        else set()
    )

    def evidence_held(item, registration_number):
        present = available.get(
            (
                "document"
                if item.get("kind") in {"report_cover", "report_excerpt"}
                else "source",
                item.get("sha256"),
            ),
            False,
        )
        if item.get("kind") in {"report_cover", "report_excerpt"}:
            document = held_docs.get(item.get("sha256"))
            # The same bytes may still exist after their account role changes.
            # Check this per decision, including history, not in the shared
            # byte-proof cache keyed only by the retained original.
            present = (
                present
                and document is not None
                and document.registration_number == registration_number
            )
        if item.get("collection_id"):
            collection = collections.get(item["collection_id"])
            present = (
                present
                and collection is not None
                and collection.first_published_at is not None
                and (
                    (collection.id, item.get("sha256"), registration_number)
                    in document_memberships
                    if item.get("kind") in {"report_cover", "report_excerpt"}
                    else any(
                        source.get("sha256") == item.get("sha256")
                        for source in collection.sources
                    )
                )
            )
        return bool(present)

    candidates = {
        (race.id, c["candidate_id"]): (race, c)
        for race in races
        for c in race.payload["candidates"]
        if not c.get("is_write_in_aggregate")
    }
    links = {key: {"accounts": [], "gaps": []} for key in candidates}
    seen, stamp = set(), []
    for decision in decisions:
        availability = [
            evidence_held(item, decision.registration_number)
            for item in decision.evidence
        ]
        stamp.append(
            [
                decision.id,
                availability if verify_originals else [None for _ in availability],
            ]
        )
        key = (decision.race_id, decision.candidate_id)
        account_key = (*key, decision.registration_number)
        if key not in candidates or account_key in seen:
            continue
        seen.add(account_key)
        race, candidate = candidates[key]
        state = (
            decision.decision
            if decision.decision != "confirmed"
            else (
                "identity_changed"
                if decision.identity != candidate_identity(race, candidate)
                else "sources_unavailable"
                if not all(availability)
                else "checked"
            )
        )
        if state != "checked":
            links[key]["gaps"].append(
                {"registration_number": decision.registration_number, "state": state}
            )
            continue
        public_evidence = []
        for item in decision.evidence:
            public = {
                k: v
                for k, v in item.items()
                if k
                in {
                    "kind",
                    "sha256",
                    "url",
                    "page",
                    "lines",
                    "collection_id",
                    "source_row",
                    "row_number",
                    "locator",
                }
            }
            if item.get("collection_id"):
                collection = collections[item["collection_id"]]
                suffix = (
                    ""
                    if item.get("kind") in {"report_cover", "report_excerpt"}
                    else "/raw"
                )
                public["retained_source_url"] = (
                    f"/api/v1/finance/elections/{quote(collection.election_key, safe='')}/finance/sources/{item['sha256']}{suffix}?"
                    + urlencode({"collection_id": collection.id})
                )
            public_evidence.append(public)
        links[key]["accounts"].append(
            {
                "registration_number": decision.registration_number,
                "decision_id": decision.id,
                "period_start": decision.period_start.isoformat(),
                "period_end": decision.period_end.isoformat(),
                "checked_on": decision.reviewed_at.date().isoformat(),
                "evidence": public_evidence,
                **({"originals_status": "not_checked"} if not verify_originals else {}),
            }
        )
    return links, stamp


def _outcomes(db, snapshot_id, races, *, store=None):
    # The append-only outcome adapter uses exact snapshot/candidate evidence and
    # deliberately has no vote-ranking fallback.
    from alethical.api.services.election_source_io import outcome_map

    return outcome_map(
        db, snapshot_id=snapshot_id, race_ids=[r.id for r in races], store=store
    )


def _board_context(
    db,
    election_key,
    snapshot_id=None,
    *,
    version=None,
    requested_output=None,
    allow_unavailable=False,
    outcome_store=None,
):
    election = results.snapshot(db, election_key)
    if snapshot_id is not None and election.id != snapshot_id:
        _changed()
    if election.stage != "general":
        raise problem_exception(
            422, "Unsupported Election", "Analytics currently support general elections"
        )
    money_version = finance_versions.current(db, "money")
    try:
        release = committee_finance.current_release(db)
    except reader.ReleaseNoLongerHeld:
        _unavailable()
    if release is None:
        _unavailable()
    races = list(
        db.scalars(
            select(m.ElectionComparisonRace)
            .where(m.ElectionComparisonRace.snapshot_id == election.id)
            .order_by(m.ElectionComparisonRace.id)
        )
    )
    sources = {}
    proofs = {}
    source_models = {
        "contributions": m.CampaignFinanceContributionRow,
        "independent_expenditures": m.CampaignFinanceIndependentExpenditureRow,
        "expenditures": m.CampaignFinanceExpenditureRow,
    }
    for dataset, model in source_models.items():
        source = release.file_for(m.CampaignFinanceDataset(dataset))
        original = db.get(m.CampaignFinanceSnapshot, source.snapshot_id)
        count = db.scalar(
            select(func.count())
            .select_from(model)
            .where(model.snapshot_id == source.snapshot_id)
        )
        if original is None or count != source.row_count:
            _unavailable()
        retained = db.get(m.CampaignFinanceSnapshotBody, source.snapshot_id)
        proofs[dataset] = (
            _SourceProof(
                retained.object_key,
                retained.compression,
                retained.compressed_hash,
                retained.compressed_byte_size,
                original.content_hash,
                original.byte_size,
            )
            if retained is not None
            else None
        )
        copied = release.copied_at(m.CampaignFinanceDataset(dataset))
        sources[dataset] = {
            "snapshot_id": str(source.snapshot_id),
            "content_hash": original.content_hash,
            "record_set_hash": original.record_set_hash,
            "row_count": source.row_count,
            "source_url": source.source_url,
            "copied_at": copied.isoformat() if copied else None,
            "record_number_basis": "1-based CSV record, not physical line",
        }
    proof_cache = {}
    availability = _source_availability(proofs, requested_output, cache=proof_cache)
    accounts, reviews = _bulk_accounts(db, election_key, races, proof_cache=proof_cache)
    outcomes = _outcomes(db, election.id, races, store=outcome_store)
    for dataset, available in availability.items():
        sources[dataset]["retained_original_state"] = (
            "available" if available else "unavailable"
        )
    token = hashlib.sha256(
        json.dumps(
            [
                election.id,
                money_version,
                str(release.id),
                reviews,
                outcomes,
                sources,
            ],
            sort_keys=True,
            default=str,
        ).encode()
    ).hexdigest()[:16]
    # Compare pins before refusing a now-unavailable required original: readers
    # holding the formerly valid generation must get 409, fresh readers 503.
    if version is not None and version != token:
        _changed()
    if not all(availability.values()) and not allow_unavailable:
        _unavailable()
    base = f"/api/v1/finance/elections/{quote(election_key, safe='')}/analytics"
    for dataset, source in sources.items():
        source["retained_source_url"] = (
            base
            + f"/sources/{dataset}?"
            + urlencode({"version": token, "snapshot_id": election.id})
        )
    return (
        {
            "election_key": election_key,
            "election_date": election.election_date.isoformat(),
            "snapshot_id": election.id,
            "version": token,
            "release_id": str(release.id),
            "currency": "USD",
            "reported_year": election.election_date.year,
            "year_basis": "source_reported_calendar_year",
            "election_stage_available": False,
            "complete_election_spending": False,
            "sources": sources,
            "scope_note": "Available Minnesota Board itemized records for the reported calendar year; not complete fundraising or general-election-only spending",
        },
        release,
        races,
        accounts,
        outcomes,
    )


def _context(
    db, election_key, snapshot_id=None, *, version=None, requested_output=None
):
    """Compose independently checked authorities without inventing absent Board data."""
    current = db.get(m.ElectionExternalFinanceCurrent, election_key)
    if current is None:
        board = _board_context(
            db,
            election_key,
            snapshot_id,
            version=version,
            requested_output=requested_output,
        )
        board[0]["source_scopes"] = {
            "mn_cfb": {"status": "available", "release_id": board[0]["release_id"]},
            "external": {"status": "not_published", "generation_id": None},
        }
        board[0]["external_sources"] = []
        board[0]["external_reports"] = []
        return (*board, None)
    election = results.snapshot(db, election_key)
    if snapshot_id is not None and election.id != snapshot_id:
        _changed()
    if election.stage != "general":
        raise problem_exception(
            422, "Unsupported Election", "Analytics currently support general elections"
        )
    external = None
    # The external and Board outcome adapters prove the same retained originals.
    # Share bytes within this composition, never with its later freshness check.
    outcome_store = lazy_request_store(external_reads.raw_file_store_from_env)
    external_scope = {
        "status": "unavailable",
        "generation_id": current.generation_id,
        "version": None,
        "authorities": [],
        "coverage": [],
    }
    try:
        candidate = external_reads.bulk_finance(
            db, election_key=election_key, store=outcome_store
        )
        external_scope.update(
            {
                k: deepcopy(candidate.get(k))
                for k in ("generation_id", "version", "authorities", "coverage")
            }
        )
        if candidate["snapshot_id"] != election.id:
            external_scope["status"] = "snapshot_mismatch"
        else:
            external = candidate
            external_scope["status"] = (
                "available"
                if any(c["accounts"] for c in candidate["candidates"])
                else "unavailable"
            )
    except HTTPException as error:
        if error.status_code == 503 and (error.headers or {}).get("Retry-After"):
            raise
        if error.status_code not in {404, 503}:
            raise
    board = None
    board_scope = {"status": "unavailable", "release_id": None}
    try:
        board = _board_context(
            db,
            election_key,
            election.id,
            requested_output=requested_output,
            allow_unavailable=True,
            outcome_store=outcome_store,
        )
        board_scope = {
            "status": "available"
            if all(
                s["retained_original_state"] == "available"
                for s in board[0]["sources"].values()
            )
            else "unavailable",
            "release_id": board[0]["release_id"],
        }
    except HTTPException as error:
        if error.status_code == 503 and (error.headers or {}).get("Retry-After"):
            raise
        if error.status_code != 503:
            raise
        pointer = db.get(m.CampaignFinanceCurrentRelease, True)
        board_scope["release_id"] = (
            str(pointer.release_id) if pointer and pointer.release_id else None
        )
        board_scope["status"] = (
            "unavailable" if board_scope["release_id"] else "not_published"
        )
    board_usable = board is not None and board_scope["status"] == "available"
    ctx: dict
    if board is None:
        races = list(
            db.scalars(
                select(m.ElectionComparisonRace)
                .where(m.ElectionComparisonRace.snapshot_id == election.id)
                .order_by(m.ElectionComparisonRace.id)
            )
        )
        outcomes = _outcomes(db, election.id, races, store=outcome_store)
        links = {
            (race.id, c["candidate_id"]): {"accounts": [], "gaps": []}
            for race in races
            for c in race.payload["candidates"]
            if not c.get("is_write_in_aggregate")
        }
        ctx = {
            "election_key": election_key,
            "election_date": election.election_date.isoformat(),
            "snapshot_id": election.id,
            "release_id": None,
            "currency": "USD",
            "reported_year": election.election_date.year,
            "year_basis": "source_reported_periods",
            "election_stage_available": False,
            "complete_election_spending": False,
            "sources": {},
        }
        board_stamp = {
            "scope": board_scope,
            "money": finance_versions.current(db, "money"),
            "reviews": list(
                db.execute(
                    select(
                        m.ElectionCampaignAccountDecision.id,
                        m.ElectionCampaignAccountDecision.request_key,
                    )
                    .where(
                        m.ElectionCampaignAccountDecision.election_key == election_key,
                        m.ElectionCampaignAccountDecision.authority == "mn_cfb",
                    )
                    .order_by(m.ElectionCampaignAccountDecision.id)
                ).tuples()
            ),
            "outcomes": outcomes,
        }
        release = None
    else:
        ctx, release, races, links, outcomes = board
        board_stamp = ctx["version"]
    token = hashlib.sha256(
        json.dumps(
            ["all-authority-analytics:v1", board_stamp, external_scope],
            sort_keys=True,
            default=str,
        ).encode()
    ).hexdigest()[:16]
    if version is not None and version != token:
        _changed()
    if not board_usable and external_scope["status"] != "available":
        _unavailable()
    ctx["version"] = token
    ctx["source_scopes"] = {"mn_cfb": board_scope, "external": external_scope}
    ctx["external_sources"] = (
        [
            {
                "generation_id": external["generation_id"],
                "source_sha256": source["sha256"],
                **{
                    k: deepcopy(source.get(k))
                    for k in ("authority", "url", "copied_at", "media_type")
                },
            }
            for source in external.get("sources", [])
        ]
        if external is not None
        else []
    )
    ctx["external_reports"] = []
    ctx["scope_note"] = (
        "Checked source-specific Board, federal and local records in their actual reporting periods; unavailable authorities remain gaps and this is not complete election spending"
    )
    for dataset, source in ctx["sources"].items():
        source["retained_source_url"] = (
            f"/api/v1/finance/elections/{quote(election_key, safe='')}/analytics/sources/{dataset}?"
            + urlencode({"version": token, "snapshot_id": election.id})
        )
    return ctx, release if board_usable else None, races, links, outcomes, external


def _external_funder_id(authority, account):
    return (
        "external:"
        + hashlib.sha256(
            json.dumps([authority, account], separators=(",", ":")).encode()
        ).hexdigest()
    )


_EXTERNAL_METRICS = {
    "direct_contribution": "direct_contributions",
    "independent_for": "independent_For",
    "independent_against": "independent_Against",
}


def _external_events(data, races):
    """Deduplicate authoritative payment keys, never vendor names or source totals."""
    candidates = {
        (r.id, c["candidate_id"])
        for r in races
        for c in r.payload["candidates"]
        if not c.get("is_write_in_aggregate")
    }
    groups, reports = {}, {}
    sources = {s["sha256"]: s for s in data.get("sources", [])}
    authorities = {a["key"]: a for a in data["authorities"]}
    for candidate in data["candidates"]:
        key = candidate["race_id"], candidate["candidate_id"]
        if key not in candidates:
            continue
        for report in candidate["reports"]:
            report_key = report["authority"], report["report_key"]
            if report_key not in reports:
                reports[report_key] = {
                    k: deepcopy(report.get(k))
                    for k in (
                        "authority",
                        "account_id",
                        "report_key",
                        "source_report_id",
                        "series_id",
                        "predecessor_report_key",
                        "report_type",
                        "period_start",
                        "period_end",
                        "received_date",
                        "effective",
                        "version_scope",
                        "amendment_status",
                        "version_as_of",
                        "version_sources",
                        "selection_group_key",
                        "check_status",
                        "status_basis",
                        "withheld_measures",
                        "next_action",
                        "source_sha256",
                        "figures",
                        "sources",
                    )
                }
                reports[report_key].update(
                    generation_id=data["generation_id"], claims=[]
                )
            reports[report_key]["claims"].append(
                {"race_id": key[0], "candidate_id": key[1]}
            )
        for payment in candidate["payments"]:
            identity = payment["authority"], payment["payment_key"]
            entry = groups.setdefault(identity, {"payment": payment, "claims": set()})
            entry["claims"].add(key)
    events = []
    for (authority, payment_key), item in sorted(groups.items()):
        payment = item["payment"]
        claims = [{"race_id": r, "candidate_id": c} for r, c in sorted(item["claims"])]
        bindings = deepcopy(payment["sources"])
        first = bindings[0]["source_sha256"] if bindings else None
        meta = sources.get(first, {})
        payer = payment.get("payer")
        payer_name = (
            payer.get("name")
            if payer
            and (payer.get("authority"), payer.get("account_id"))
            == (authority, payment["account_id"])
            else payment["account_id"]
        )
        memo = payment.get("nonadditive", False)
        effective = payment.get("effective")
        resolution = (
            "amendment_status_not_established"
            if effective is None
            else "nonadditive_memo"
            if memo
            else "superseded_report"
            if effective is False
            else "conflicting_claims"
            if len(claims) != 1
            else "attributed"
        )
        metric = _EXTERNAL_METRICS.get(
            payment["direction"], "external_" + payment["direction"]
        )
        events.append(
            {
                "record_id": "external:" + data["generation_id"] + ":" + payment_key,
                "source_family": "external",
                "authority": authority,
                "source_account_id": payment["account_id"],
                "external_generation_id": data["generation_id"],
                "external_payment_key": payment_key,
                "dataset": "external",
                "row_number": None,
                "funder_id": _external_funder_id(authority, payment["account_id"]),
                "funder_registration": None,
                "funder_name": payer_name,
                "funder_identity_state": "source_bound_authority_account",
                "funder_identity_evidence": None,
                "recorded_type": authorities.get(authority, {}).get("name", authority),
                "recorded_subtype": None,
                "category": "external",
                "target_registration": payment.get("target_source_candidate_id"),
                "date": payment["date"],
                "reported_year": None,
                "amount": payment["amount"],
                "currency": payment.get("currency"),
                "amount_state": "reported",
                "metric": metric,
                "direction": payment["direction"],
                "transaction_type": payment["transaction_type"],
                "amount_role": payment["amount_role"],
                "nonadditive": memo,
                "memo": deepcopy(payment.get("memo")),
                "payee_address": deepcopy(payment.get("payee_address")),
                "effective": effective,
                "version_scope": payment.get("version_scope"),
                "amendment_status": payment.get("amendment_status"),
                "version_as_of": payment.get("version_as_of"),
                "version_sources": deepcopy(payment.get("version_sources") or []),
                "report_key": payment["report_key"],
                "source_report_id": payment["source_report_id"],
                "source_row_id": payment["source_row_id"],
                "period_start": payment["period_start"],
                "period_end": payment["period_end"],
                "source_bindings": bindings,
                "resolution": resolution,
                "claims": claims if resolution == "attributed" else [],
                "related_candidacies": claims,
                "account_reviews": [],
                "sum_eligible": True,
                "source": {
                    "source_family": "external",
                    "generation_id": data["generation_id"],
                    "content_hash": first,
                    "source_sha256": first,
                    "source_url": meta.get("url"),
                    "copied_at": meta.get("copied_at"),
                    "retained_original_state": "available",
                },
                "fields": {
                    "Authority": authority,
                    "Source account": payment["account_id"],
                    "Source report": payment["source_report_id"],
                    "Source row": payment["source_row_id"],
                    "Target candidate ID": payment.get("target_source_candidate_id"),
                    "Vendor name": payment["payee"],
                    "Purpose": payment["purpose"],
                    "Direction": payment["direction"],
                    "Transaction type": payment["transaction_type"],
                },
            }
        )

    # An effective notice and periodic record, or cumulative series, cannot be
    # added merely because both are held. Keep each source report's measure.
    def overlap_key(event):
        report = reports.get((event["authority"], event["report_key"]))
        selection = external_reads.report_selection_key(
            report
            if report is not None
            else {
                "authority": event["authority"],
                "account_id": event["source_account_id"],
            }
        )
        return selection, event["metric"]

    periods = defaultdict(dict)
    for event in events:
        if event["effective"] is True and not event["nonadditive"]:
            periods[overlap_key(event)][event["report_key"]] = (
                event["period_start"],
                event["period_end"],
            )
    overlapping = set()
    for key, reports_by_key in periods.items():
        maximum, maximum_key = "", None
        for start, end, report in sorted(
            (start, end, report) for report, (start, end) in reports_by_key.items()
        ):
            if maximum_key is not None and start <= maximum:
                overlapping.update({(*key, report), (*key, maximum_key)})
            if end > maximum:
                maximum, maximum_key = end, report
    for event in events:
        event["sum_eligible"] = (
            event["effective"] is True
            and (
                *overlap_key(event),
                event["report_key"],
            )
            not in overlapping
        )
    return events, list(reports.values())


def _event(row, dataset, source, accounts):
    direct = dataset == "contributions"
    target = row.recipient_reg_num if direct else row.affected_committee_reg_num
    registration = row.contrib_reg_num if direct else row.spender_reg_num
    when = row.receipt_date if direct else row.transaction_date
    raw_direction = None if direct else row.for_against
    direction = (
        "For"
        if (raw_direction or "").lower() == "for"
        else "Against"
        if (raw_direction or "").lower() == "against"
        else "unknown"
    )
    claims = [(key, account) for key, account in accounts.get(target, [])]
    dated = {
        key
        for key, account in claims
        if when is not None
        and account["period_start"] <= when.isoformat() <= account["period_end"]
    }
    resolution = (
        "no_confirmed_account"
        if not claims
        else "missing_date"
        if when is None
        else (
            "outside_reviewed_period"
            if not dated
            else "conflicting_claims"
            if len(dated) > 1
            else "attributed"
        )
    )
    fields = {}
    for column in DATASETS[dataset][1]:
        value = getattr(row, column.attribute)
        fields[column.source] = (
            _money(value)
            if isinstance(value, Decimal)
            else value.isoformat()
            if isinstance(value, date)
            else value
        )
    return {
        "dataset": dataset,
        "row_number": row.row_number,
        "funder_id": f"record:{dataset}:{source['snapshot_id']}:{row.row_number}",
        "funder_registration": registration,
        "funder_name": row.contributor if direct else row.spender,
        "recorded_type": row.contrib_type if direct else row.spender_type,
        "recorded_subtype": None if direct else row.spender_sub_type,
        "category": FUNDER_TYPES.get(row.contrib_type if direct else row.spender_type)
        if FUNDER_TYPES.get(row.contrib_type if direct else row.spender_type)
        in {"PTU", "PCF"}
        else "other",
        "target_registration": target,
        "date": when.isoformat() if when else None,
        "reported_year": row.year,
        "amount": _money(row.amount),
        "amount_state": "missing_amount" if row.amount is None else "reported",
        "metric": "direct_contributions"
        if direct and row.receipt_type == "Contribution"
        else "other_receipts"
        if direct
        else "independent_" + direction,
        "resolution": resolution,
        "claims": [
            {"race_id": key[0], "candidate_id": key[1]} for key in sorted(dated)
        ],
        "related_candidacies": [
            {"race_id": key[0], "candidate_id": key[1]}
            for key in sorted({key for key, _ in claims})
        ],
        "account_reviews": [
            {"race_id": key[0], "candidate_id": key[1], **account}
            for key, account in claims
        ],
        "source": {**source, "row_number": row.row_number},
        "fields": fields,
    }


def _resolve_funders(db, release, context, events):
    """Require exact source type and an own-filer record before joining IDs.

    This is campaign_finance_payments.linkable_committees' existence contract,
    with the source kind and retained row locator added. Lobbyist IDs belong to
    another register; zero/negative sentinels never identify a registered filer.
    """
    wanted = {
        row["funder_registration"]
        for row in events
        if row["funder_registration"]
        and row["funder_registration"].isascii()
        and row["funder_registration"].isdigit()
        and int(row["funder_registration"]) > 0
        and row["recorded_type"] in FUNDER_TYPES
    }
    proofs = {}
    for dataset, model, number, kind in (
        (
            "contributions",
            m.CampaignFinanceContributionRow,
            m.CampaignFinanceContributionRow.recipient_reg_num,
            m.CampaignFinanceContributionRow.recipient_type,
        ),
        (
            "expenditures",
            m.CampaignFinanceExpenditureRow,
            m.CampaignFinanceExpenditureRow.committee_reg_num,
            m.CampaignFinanceExpenditureRow.entity_type,
        ),
    ):
        if not wanted:
            break
        source_id = release.file_for(m.CampaignFinanceDataset(dataset)).snapshot_id
        for registration, source_kind, row_number in db.execute(
            select(number, kind, func.min(model.row_number))
            .where(model.snapshot_id == source_id, number.in_(wanted))
            .group_by(number, kind)
            .order_by(number, kind)
        ):
            category = FUNDER_TYPES.get(source_kind)
            if category is not None:
                proofs.setdefault(
                    (registration, category),
                    {
                        **context["sources"][dataset],
                        "dataset": dataset,
                        "row_number": row_number,
                        "registration_number": registration,
                        "recorded_type": source_kind,
                    },
                )
    for row in events:
        proof = proofs.get(
            (row["funder_registration"], FUNDER_TYPES.get(row["recorded_type"]))
        )
        row["funder_identity_state"] = (
            "registered_filer" if proof else "unresolved_source_record"
        )
        row["funder_identity_evidence"] = proof
        if proof:
            row["funder_id"] = "registration:" + row["funder_registration"]


def _build(
    db,
    *,
    election_key,
    snapshot_id=None,
    version=None,
    start_date=None,
    end_date=None,
    race_id=None,
    funder_id=None,
    q="",
):
    if len(q) > 200 or "\x00" in q:
        raise problem_exception(
            422,
            "Invalid Query",
            "Search must contain at most 200 characters and no null characters",
        )
    query = " ".join(q.split())
    if start_date and end_date and start_date > end_date:
        raise problem_exception(
            422, "Invalid Period", "Start date must be on or before end date"
        )
    context, release, races, links, outcomes, external = _context(
        db, election_key, snapshot_id, version=version
    )
    if race_id is not None and race_id not in {r.id for r in races}:
        results._not_found()
    by_account = defaultdict(list)
    for key, link in links.items():
        for account in link["accounts"]:
            by_account[account["registration_number"]].append((key, account))
    events = []
    # This is a bounded annual read. Other source years reconcile in SQL and do
    # not become hundreds of thousands of ORM objects per analytics request.
    other_years = {}
    if release is not None:
        for dataset, (model, _) in DATASETS.items():
            source = context["sources"][dataset]
            source_id = release.file_for(m.CampaignFinanceDataset(dataset)).snapshot_id
            other = db.execute(
                select(
                    func.count(),
                    func.sum(model.amount),
                    func.count().filter(model.amount.is_(None)),
                ).where(
                    model.snapshot_id == source_id,
                    model.year.is_not(None),
                    model.year != context["reported_year"],
                )
            ).one()
            other_years[dataset] = {
                "record_count": other[0],
                "known_amount_subtotal": _money(other[1]),
                "missing_amount_count": other[2],
            }
            rows = db.scalars(
                select(model)
                .where(
                    model.snapshot_id == source_id,
                    (model.year == context["reported_year"]) | model.year.is_(None),
                )
                .order_by(model.row_number)
            )
            for row in rows:
                event = _event(row, dataset, source, by_account)
                if row.year is None:
                    event["resolution"] = "missing_year"
                elif event["metric"] == "other_receipts":
                    event["resolution"] = "other_receipt_type"
                elif event["date"] is None:
                    event["resolution"] = "missing_date"
                elif (start_date and event["date"] < start_date.isoformat()) or (
                    end_date and event["date"] > end_date.isoformat()
                ):
                    event["resolution"] = "outside_selected_period"
                events.append(event)
        _resolve_funders(db, release, context, events)
    external_reports = []
    if external is not None:
        native_events, external_reports = _external_events(external, races)
        for event in native_events:
            if (start_date and event["date"] < start_date.isoformat()) or (
                end_date and event["date"] > end_date.isoformat()
            ):
                event["resolution"] = "outside_selected_period"
                event["claims"] = []
        events.extend(native_events)
        own = {
            p["payment_key"]
            for c in external["candidates"]
            for p in c.get("own_payments", [])
        }
        targets = {event["external_payment_key"] for event in native_events}
        gap_counts = defaultdict(int)
        for candidate in external["candidates"]:
            for gap in candidate.get("account_gaps", []):
                gap_counts[gap["state"]] += 1
        context["external_reconciliation"] = {
            "targeted_records": len(targets),
            "own_account_records": len(own),
            "own_records_without_target_relation": len(own - targets),
            "account_gap_candidacies_by_state": dict(sorted(gap_counts.items())),
            "note": "Own-account vendor records are separate from documented funder support",
        }
    filters = {
        "start_date": start_date.isoformat() if start_date else None,
        "end_date": end_date.isoformat() if end_date else None,
        "race_id": race_id,
        "funder_id": funder_id,
        "q": query,
    }
    context["filters"] = filters
    context["other_source_years"] = other_years
    # Unknown/unlinked rows remain in the inventory even when they cannot match
    # an exact race filter. The filtered views state exactly what was excluded.
    selected = [
        _scope_event(event, race_id=race_id)
        for event in events
        if (funder_id is None or event["funder_id"] == funder_id)
        and (
            race_id is None
            or any(c["race_id"] == race_id for c in event["related_candidacies"])
        )
    ]
    if query:
        matching_funders = {
            event["funder_id"]
            for event in selected
            if query.casefold()
            in " ".join((event["funder_name"] or "").split()).casefold()
        }
        selected = [
            event for event in selected if event["funder_id"] in matching_funders
        ]
    context["reconciliation"] = _buckets(events)
    context["filtered_reconciliation"] = _buckets(selected)
    related = {
        (c["race_id"], c["candidate_id"])
        for event in selected
        for c in event["related_candidacies"]
    }
    context["external_reports"] = [
        report
        | {
            "claims": [
                claim
                for claim in report["claims"]
                if (not race_id or claim["race_id"] == race_id)
                and (
                    not funder_id
                    and not query
                    or (claim["race_id"], claim["candidate_id"]) in related
                )
            ]
        }
        for report in external_reports
        if any(
            (not race_id or claim["race_id"] == race_id)
            and (
                not funder_id
                and not query
                or (claim["race_id"], claim["candidate_id"]) in related
            )
            for claim in report["claims"]
        )
    ]
    context["definitions"] = {
        "support": "Distinct (race, candidate) with a positive-amount attributed Contribution or independent For record, counted once across both, even if negative adjustments later appear; this counts reported positive records, not net support. Zero, negative and missing amounts alone do not establish support",
        "opposition": "Distinct (race, candidate) with a positive-amount attributed independent Against record; never support for an opponent",
        "outcomes": "Explicit checked outcomes only; absent, uncertain or unavailable outcomes remain pending",
        "PCF": "Political committees and funds",
        "PTU": "Party units",
        "unregistered_funder": "Only a positive registered-filer identifier with a matching source kind and own-filer record groups rows; other identifiers and matching names never establish one funder",
        "missing_amount": "Unknown amount stays null; known subtotals exclude it",
        "unpaid": "Independent unpaid amounts are already included in reported amounts",
    }
    return context, selected, races, links, outcomes


def _scope_event(event, *, race_id=None, candidate_id=None):
    if race_id is None and candidate_id is None:
        return event

    def matches(claim):
        return (race_id is None or claim["race_id"] == race_id) and (
            candidate_id is None or claim["candidate_id"] == candidate_id
        )

    claims = [claim for claim in event["claims"] if matches(claim)]
    return {
        **event,
        "claims": claims,
        "resolution": "outside_reviewed_period"
        if event["resolution"] == "attributed" and not claims
        else event["resolution"],
        "related_candidacies": [
            claim for claim in event["related_candidacies"] if matches(claim)
        ],
        "account_reviews": [
            review for review in event["account_reviews"] if matches(review)
        ],
    }


def _buckets(events):
    buckets = defaultdict(list)
    for row in events:
        key = (row["dataset"], row["resolution"], row["amount_state"])
        if row.get("source_family") == "external":
            key += (
                row["authority"],
                row["report_key"],
                row["metric"],
                row["amount_role"],
                row.get("currency"),
            )
        buckets[key].append(row)
    return [
        {
            "dataset": key[0],
            "resolution": key[1],
            "amount_state": key[2],
            **(
                {
                    "state": "amount_unavailable",
                    "record_count": len(rows),
                    "amount": None,
                    "known_amount_subtotal": None,
                    "missing_amount_count": sum(r["amount"] is None for r in rows),
                    "withheld_reason": "amendment_status_not_established",
                }
                if any(
                    r.get("source_family") == "external" and r.get("effective") is None
                    for r in rows
                )
                else _measure(rows)
                if not any(r.get("nonadditive") for r in rows)
                else {
                    "state": "nonadditive",
                    "record_count": len(rows),
                    "amount": None,
                    "known_amount_subtotal": None,
                    "missing_amount_count": 0,
                }
            ),
            **(
                {
                    "source_family": "external",
                    "authority": key[3],
                    "report_key": key[4],
                    "metric": key[5],
                    "amount_role": key[6],
                    "currency": key[7],
                }
                if len(key) > 3
                else {}
            ),
        }
        for key, rows in sorted(
            buckets.items(), key=lambda item: tuple(str(v) for v in item[0])
        )
    ]


def _counts(keys, outcomes):
    values = [
        outcomes.get(race, {}).get("candidates", {}).get(candidate, {}).get("outcome")
        for race, candidate in keys
    ]
    return {
        "candidacies": len(keys),
        "elected": values.count("elected"),
        "not_elected": values.count("not_elected"),
        "pending": sum(value not in {"elected", "not_elected"} for value in values),
    }


def _metrics(events):
    result = {}
    for metric in METRICS:
        rows = [
            row
            for row in events
            if row["metric"] == metric and row["resolution"] == "attributed"
        ]
        result[metric] = _measure(rows)
        native_contexts = {
            (
                row["authority"],
                row["source_account_id"],
                row["report_key"],
                row["period_start"],
                row["period_end"],
                row.get("currency"),
            )
            if row.get("source_family") == "external"
            else ("mn_cfb",)
            for row in rows
        }
        if (
            any(row.get("source_family") == "external" for row in rows)
            and len(native_contexts) > 1
        ):
            result[metric].update(
                state="amount_unavailable",
                amount=None,
                known_amount_subtotal=None,
                withheld_reason="source_specific_reporting_periods",
            )
        if any(
            row.get("source_family") == "external" and row.get("currency") != "USD"
            for row in rows
        ):
            result[metric].update(
                state="amount_unavailable",
                amount=None,
                known_amount_subtotal=None,
                withheld_reason="source_currency_not_usd",
            )
        if any(not row.get("sum_eligible", True) for row in rows):
            result[metric].update(
                state="amount_unavailable",
                amount=None,
                known_amount_subtotal=None,
                withheld_reason="overlapping_source_periods",
            )
    return result


def _native_measures(events):
    groups = defaultdict(list)
    for row in events:
        if row.get("source_family") == "external":
            groups[
                (
                    row["authority"],
                    row["source_account_id"],
                    row["report_key"],
                    row["metric"],
                    row["transaction_type"],
                    row["amount_role"],
                    row["resolution"],
                    row.get("currency"),
                )
            ].append(row)
    values = []
    for key, rows in sorted(
        groups.items(), key=lambda item: tuple(str(v) for v in item[0])
    ):
        first = rows[0]
        additive = (
            first["effective"] is True
            and not first["nonadditive"]
            and first["resolution"] == "attributed"
        )
        values.append(
            {
                "authority": key[0],
                "account_id": key[1],
                "report_key": key[2],
                "source_report_id": first["source_report_id"],
                "measure": key[3],
                "label": key[4],
                "direction": first["direction"],
                "transaction_type": key[4],
                "period_start": first["period_start"],
                "period_end": first["period_end"],
                "currency": key[7],
                "basis": "checked_retained_itemized_rows",
                "effective": first["effective"],
                "version_scope": first.get("version_scope"),
                "amendment_status": first.get("amendment_status"),
                "version_as_of": first.get("version_as_of"),
                "version_sources": deepcopy(first.get("version_sources") or []),
                "nonadditive": first["nonadditive"],
                "attribution": key[6],
                "state": "reported" if additive else key[6],
                "amount": _money(
                    sum((Decimal(row["amount"]) for row in rows), Decimal(0))
                )
                if additive
                else None,
                "record_count": len(rows),
                "sources": [
                    binding for row in rows for binding in row["source_bindings"]
                ],
            }
        )
    return values


def _keys(events, metrics):
    return {
        (c["race_id"], c["candidate_id"])
        for row in events
        if row["resolution"] == "attributed"
        and row["metric"] in metrics
        and row["amount"] is not None
        and Decimal(row["amount"]) > 0
        for c in row["claims"]
    }


def _support_review(events):
    metrics = {"direct_contributions", "independent_For"}
    positive = {
        (claim["race_id"], claim["candidate_id"], row["metric"])
        for row in events
        if row["resolution"] == "attributed"
        and row["metric"] in metrics
        and row["amount"] is not None
        and Decimal(row["amount"]) > 0
        for claim in row["claims"]
    }
    negative = {
        (claim["race_id"], claim["candidate_id"], row["metric"])
        for row in events
        if row["resolution"] == "attributed"
        and row["metric"] in metrics
        and row["amount"] is not None
        and Decimal(row["amount"]) < 0
        for claim in row["claims"]
    }
    affected = positive & negative
    return {
        "state": "review_negative_records"
        if affected
        else "no_negative_adjustment_found",
        "candidacies": [
            {"race_id": race, "candidate_id": candidate, "metric": metric}
            for race, candidate, metric in sorted(affected)
        ],
        "note": "Positive-record counts remain counted when negative records also exist; review the source records before describing net support",
    }


def _evidence_url(context, **filters):
    return (
        f"/api/v1/finance/elections/{quote(context['election_key'], safe='')}/analytics/records?"
        + urlencode(
            {
                "snapshot_id": context["snapshot_id"],
                "version": context["version"],
                **{k: v for k, v in context["filters"].items() if v is not None},
                **filters,
            }
        )
    )


def funders(db: Session, *, limit=50, offset=0, **kwargs):
    context, events, _, _, outcomes = _build(db, **kwargs)
    grouped = defaultdict(list)
    for event in events:
        grouped[event["funder_id"]].append(event)
    rows = []
    for key, records in sorted(grouped.items()):
        rows.append(
            {
                "funder_id": key,
                "registration_number": records[0]["funder_registration"]
                if records[0]["funder_identity_state"] == "registered_filer"
                else None,
                "source_registration_values": sorted(
                    {
                        row["funder_registration"]
                        for row in records
                        if row["funder_registration"] is not None
                    }
                ),
                "identity_state": records[0]["funder_identity_state"],
                "identity_evidence": [
                    row["funder_identity_evidence"]
                    for row in records[:1]
                    if row["funder_identity_evidence"]
                ],
                "names": sorted(
                    {r["funder_name"] for r in records if r["funder_name"] is not None}
                ),
                "recorded_classifications": [
                    dict(
                        zip(
                            ("category", "recorded_type", "recorded_subtype"),
                            values,
                            strict=True,
                        )
                    )
                    for values in sorted(
                        {
                            (r["category"], r["recorded_type"], r["recorded_subtype"])
                            for r in records
                        },
                        key=lambda x: tuple(v or "" for v in x),
                    )
                ],
                "amounts": _metrics(records),
                **(
                    {
                        "source_family": "external",
                        "authority": records[0]["authority"],
                        "source_account_id": records[0]["source_account_id"],
                        "source_measures": _native_measures(records),
                    }
                    if records[0].get("source_family") == "external"
                    else {}
                ),
                "reconciliation": _buckets(records),
                "supported_outcomes": _counts(
                    _keys(records, {"direct_contributions", "independent_For"}),
                    outcomes,
                ),
                "support_count_review": _support_review(records),
                "opposed_outcomes": _counts(
                    _keys(records, {"independent_Against"}), outcomes
                ),
                "evidence_url": _evidence_url(context, funder_id=key),
            }
        )
    # Sort the complete result before paging; identity stays independent of names.
    rows.sort(
        key=lambda row: (
            not bool(row["names"]),
            str(row["names"][0]).casefold() if row["names"] else "",
            row["funder_id"],
        )
    )
    return {
        **context,
        "funders": rows[offset : offset + limit],
        "page": _page(rows, limit, offset),
    }


def _candidate_details(race, candidate, outcomes, records):
    key = (race.id, candidate["candidate_id"])
    return {
        "district": race.payload.get("district"),
        "candidate_source_sha256": race.payload.get("candidate_source_sha256"),
        "candidate_source_row": candidate.get("candidate_source_row"),
        "result_status": outcomes.get(race.id, {}).get("result_status"),
        "supported": key in _keys(records, {"direct_contributions", "independent_For"}),
        "opposed": key in _keys(records, {"independent_Against"}),
    }


def candidates(db: Session, *, limit=50, offset=0, **kwargs):
    context, events, races, links, outcomes = _build(db, **kwargs)
    by_candidate = defaultdict(list)
    for event in events:
        if event["resolution"] == "attributed":
            for claim in event["claims"]:
                by_candidate[(claim["race_id"], claim["candidate_id"])].append(event)
    rows = []
    for race in races:
        if context["filters"]["race_id"] not in {None, race.id}:
            continue
        for candidate in race.payload["candidates"]:
            if candidate.get("is_write_in_aggregate"):
                continue
            key = (race.id, candidate["candidate_id"])
            records = by_candidate[key]
            if (
                context["filters"]["funder_id"] is not None or context["filters"]["q"]
            ) and not records:
                continue
            outcome = (
                outcomes.get(race.id, {})
                .get("candidates", {})
                .get(
                    candidate["candidate_id"],
                    {"outcome": None, "outcome_status": "pending", "evidence": []},
                )
            )
            rows.append(
                {
                    "race_id": race.id,
                    "race_label": race.label,
                    "candidate_id": candidate["candidate_id"],
                    "name": candidate["name"],
                    "party": candidate.get("party"),
                    "votes": candidate.get("votes"),
                    **_candidate_details(race, candidate, outcomes, records),
                    **outcome,
                    "account_links": links[key],
                    "amounts": _metrics(records),
                    "evidence_url": _evidence_url(
                        context, race_id=race.id, candidate_id=candidate["candidate_id"]
                    ),
                }
            )
    return {
        **context,
        "candidates": rows[offset : offset + limit],
        "page": _page(rows, limit, offset),
    }


def records(
    db: Session,
    *,
    limit=50,
    offset=0,
    candidate_id=None,
    metric=None,
    resolution=None,
    **kwargs,
):
    context, events, races, _, _ = _build(db, **kwargs)
    _candidate_exists(context, races, candidate_id)
    rows = _record_filters(events, candidate_id, metric, resolution)
    context = _record_context(context, rows, candidate_id, metric, resolution)
    return {
        **context,
        "rows": rows[offset : offset + limit],
        "page": _page(rows, limit, offset),
    }


def _record_filters(events, candidate_id, metric, resolution):
    return [
        event
        for original in events
        for event in [_scope_event(original, candidate_id=candidate_id)]
        if (
            candidate_id is None
            or any(
                c["candidate_id"] == candidate_id for c in event["related_candidacies"]
            )
        )
        and (metric is None or event["metric"] == metric)
        and (resolution is None or event["resolution"] == resolution)
    ]


def _candidate_exists(context, races, candidate_id):
    if candidate_id is not None and not any(
        race.id == context["filters"]["race_id"]
        and any(
            c["candidate_id"] == candidate_id and not c.get("is_write_in_aggregate")
            for c in race.payload["candidates"]
        )
        for race in races
    ):
        results._not_found()


def _record_context(context, rows, candidate_id, metric, resolution):
    """Finalize selection metadata only after every record filter has run."""
    return {
        **context,
        "filters": {
            **context["filters"],
            "candidate_id": candidate_id,
            "metric": metric,
            "resolution": resolution,
        },
        "filtered_reconciliation": _buckets(rows),
    }


def _export_inventory(context, rows, races, outcomes):
    """Keep explicit selected candidate/race context, otherwise related rows only."""
    filters = context["filters"]
    if filters["candidate_id"] is not None:
        keys = {(filters["race_id"], filters["candidate_id"])}
        scope = "selected_candidate"
    elif (
        filters["race_id"] is not None
        and filters["funder_id"] is None
        and not filters["q"]
    ):
        keys = {
            (race.id, candidate["candidate_id"])
            for race in races
            if race.id == filters["race_id"]
            for candidate in race.payload["candidates"]
            if not candidate.get("is_write_in_aggregate")
        }
        scope = "selected_race"
    else:
        keys = {
            (claim["race_id"], claim["candidate_id"])
            for row in rows
            for claim in row["related_candidacies"]
        }
        scope = "related_to_selected_records"
    candidacies = [
        {"race_id": race.id, "candidate": candidate}
        for race in races
        for candidate in race.payload["candidates"]
        if (race.id, candidate["candidate_id"]) in keys
        and not candidate.get("is_write_in_aggregate")
    ]
    selected_outcomes = {}
    for race_id, outcome in outcomes.items():
        candidate_ids = {candidate for race, candidate in keys if race == race_id}
        if not candidate_ids:
            continue
        review = outcome["outcome_review"]
        selected_outcomes[race_id] = {
            **outcome,
            "candidates": {
                candidate: value
                for candidate, value in outcome["candidates"].items()
                if candidate in candidate_ids
            },
            "outcome_review": {
                **review,
                "evidence": [
                    item
                    for item in review["evidence"]
                    if item.get("candidate_id") is None
                    or item["candidate_id"] in candidate_ids
                ],
            },
        }
    return scope, candidacies, selected_outcomes


_CSV_MEASURES = {
    "direct_contributions": "Contributions",
    "independent_For": "Independent spending for",
    "independent_Against": "Independent spending against",
    "independent_unknown": "Independent spending unknown direction",
}
_FINANCE_PUBLIC_ORIGIN = "https://alethicalfinance.com"


def _app_source(
    context,
    source,
    *,
    dataset=None,
    kind="election",
    collection_id=None,
    generation_id=None,
):
    """Build only a typed Finance app address, never a request-controlled origin."""
    election = context["election_key"]
    if not re.fullmatch(
        r"mn-[0-9]{4}-[0-9]{2}-[0-9]{2}-(general|primary|special)", election
    ):
        return None
    snapshot = context["snapshot_id"]
    if dataset is not None:
        if dataset not in {"contributions", "independent_expenditures", "expenditures"}:
            return None
        if not re.fullmatch(r"[a-f0-9]{64}", snapshot) or not re.fullmatch(
            r"[a-f0-9]{16}", context["version"]
        ):
            return None
        identifier = dataset
        query = {
            "kind": "analytics",
            "snapshot_id": snapshot,
            "version": context["version"],
        }
    else:
        identifier = source
        pin = {"election": "snapshot_id", "external": "generation_id"}.get(
            kind, "collection_id"
        )
        value = (
            snapshot
            if kind == "election"
            else (generation_id if kind == "external" else collection_id)
        )
        if kind not in {"election", "finance", "report", "external"} or not all(
            isinstance(x, str) and re.fullmatch(r"[a-f0-9]{64}", x)
            for x in (identifier, value)
        ):
            return None
        query = {"kind": kind, pin: value}
    return (
        f"{_FINANCE_PUBLIC_ORIGIN}/elections/{election}/sources/{identifier}?"
        + urlencode(query)
    )


def _csv_text(value):
    text = (
        ""
        if value is None
        else "Yes"
        if value is True
        else "No"
        if value is False
        else str(value)
    )
    if (
        text.lstrip().startswith(("=", "+", "-", "@"))
        or text.startswith(("\t", "\r", "\n"))
        or (text.isdecimal() and (text.startswith("0") or len(text) > 15))
    ):
        return "'" + text
    return text


def _csv_leaves(value, path=""):
    """Keep source/review context in labelled scalar cells, not embedded JSON."""
    if isinstance(value, dict):
        if not value:
            yield path, "No entries"
        for key, child in value.items():
            label = str(key).replace("_", " ")
            yield from _csv_leaves(child, f"{path}: {label}" if path else label)
    elif isinstance(value, (list, tuple)):
        if not value:
            yield path, "No entries"
        for number, child in enumerate(value, 1):
            yield from _csv_leaves(child, f"{path} {number}")
    else:
        yield path, value


def _csv_export(data, races):
    """One payment row per source row; alternative summaries never share its amount column."""
    source_fields = list(
        dict.fromkeys(
            c.source
            for _, columns in DATASETS.values()
            for c in columns
            if c.source not in {"Amount", "Unpaid amount"}
        )
    )
    measures = [
        f"{label} {suffix}"
        for label in _CSV_MEASURES.values()
        for suffix in (
            "USD",
            "status",
            "known subtotal USD",
            "records",
            "missing amounts",
        )
    ]
    counts = [
        f"{direction} {outcome}"
        for direction in ("Supported", "Opposed")
        for outcome in ("candidacies", "elected", "not elected", "pending")
    ]
    columns = [
        "Row type",
        "Funder",
        "Funder ID",
        "Funder registration",
        "Funder identity",
        "Filed classifications",
        "Candidate",
        "Candidate ID",
        "Official party",
        "Race",
        "Race ID",
        "District",
        "Votes",
        "Result status",
        "Outcome",
        "Outcome status",
        "Supported",
        "Opposed",
        *measures,
        *counts,
        "Negative record review",
        "Payment USD",
        "Memo detail USD",
        "Superseded payment USD",
        "Native measure amount",
        "Native payment amount",
        "Native memo amount",
        "Native superseded amount",
        "Document amount",
        "Source currency",
        "Included unpaid USD",
        "Payment amount status",
        "Payment kind",
        "Attribution",
        "Payment date",
        "Reported year",
        "Target account",
        "Authority",
        "Source family",
        "Source generation",
        "Source account",
        "Source report",
        "Source payment key",
        "Source row ID",
        "Target candidate ID",
        "Reporting period start",
        "Reporting period end",
        "Effective report",
        "Version scope",
        "Listing copied at",
        "Amendment status",
        "Direction",
        "Transaction type",
        "Amount role",
        "Vendor name",
        "Purpose",
        "Measure",
        "Measure basis",
        "Measure status",
        "Dated claim",
        "Dataset",
        "Source snapshot",
        "Source SHA256",
        "Record set SHA256",
        "Source record",
        "Source record count",
        "Source copied at",
        "Source availability",
        "Source URL",
        "Original URL",
        "Source role",
        "Checked on",
        "Account period start",
        "Account period end",
        "Account decision ID",
        "Context field",
        "Context value",
        "Context status",
        "Scope",
        "Election",
        "Election date",
        "Election snapshot",
        "Version",
        "Release ID",
        "Currency",
        *[f"Filed: {name}" for name in source_fields],
    ]
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=columns, lineterminator="\n")
    writer.writeheader()
    deferred = []
    numeric = {
        "Votes",
        "Payment USD",
        "Memo detail USD",
        "Superseded payment USD",
        "Native measure amount",
        "Native payment amount",
        "Native memo amount",
        "Native superseded amount",
        "Document amount",
        "Included unpaid USD",
        "Source record",
        "Source record count",
        "Reported year",
        *counts,
        *measures,
    } - {f"{label} status" for label in _CSV_MEASURES.values()}
    common = {
        "Election": data["election_key"],
        "Election date": data["election_date"],
        "Election snapshot": data["snapshot_id"],
        "Version": data["version"],
        "Release ID": data["release_id"],
        "Currency": data["currency"],
    }

    def write(row):
        cells = {}
        for key, value in (common | row).items():
            if isinstance(value, (dict, list, tuple, set)):
                raise ValueError("CSV cells must be scalar values")
            if key in numeric and value is not None and value != "":
                if not re.fullmatch(r"-?[0-9]+(?:\.[0-9]+)?", str(value)):
                    raise ValueError("CSV numeric value is not an exact decimal")
                cells[key] = value
            else:
                cells[key] = _csv_text(value)
        # Put the useful summary and payment rows first. Full source/context
        # evidence follows them; a long metadata inventory must not hide money.
        if row["Row type"] in {"Funder", "Candidate", "Payment"} or (
            row["Row type"] == "Metadata" and row.get("Context field") == "Export"
        ):
            writer.writerow(cells)
        else:
            deferred.append(cells)

    def context_rows(kind, value, common_row=None):
        for label, value in _csv_leaves(value):
            write(
                {
                    "Row type": kind,
                    **(common_row or {}),
                    "Context field": label,
                    "Context value": value,
                    "Context status": "Unavailable" if value is None else "Present",
                }
            )

    def amounts(events):
        result = {}
        for metric, measure in _metrics(events).items():
            label = _CSV_MEASURES[metric]
            result.update(
                {
                    f"{label} USD": measure["amount"],
                    f"{label} status": measure["state"].replace("_", " "),
                    f"{label} known subtotal USD": measure["known_amount_subtotal"],
                    f"{label} records": measure["record_count"],
                    f"{label} missing amounts": measure["missing_amount_count"],
                }
            )
        return result

    def source_row(source, dataset=None):
        if source.get("source_family") == "external" or source.get("generation_id"):
            sha = source.get("source_sha256", source.get("content_hash"))
            return {
                "Source family": "external",
                "Source generation": source.get("generation_id"),
                "Source SHA256": sha,
                "Source copied at": source.get(
                    "source_copied_at", source.get("copied_at")
                ),
                "Source availability": source.get(
                    "retained_original_state", "available"
                ),
                "Source URL": _app_source(
                    data,
                    sha,
                    kind="external",
                    generation_id=source.get("generation_id"),
                ),
                "Original URL": source.get("source_url", source.get("url")),
            }
        return {
            "Dataset": dataset,
            "Source snapshot": source.get("snapshot_id"),
            "Source SHA256": source.get("content_hash", source.get("sha256")),
            "Record set SHA256": source.get("record_set_hash"),
            "Source record": source.get("row_number", source.get("source_row")),
            "Source record count": source.get("row_count"),
            "Source copied at": source.get("copied_at"),
            "Source availability": source.get("retained_original_state"),
            "Source URL": _app_source(data, source.get("sha256"), dataset=dataset)
            if dataset
            else _app_source(
                data,
                source.get("sha256"),
                kind=(
                    "report"
                    if source.get("kind") in {"report_cover", "report_excerpt"}
                    else "finance"
                )
                if source.get("collection_id")
                else "election",
                collection_id=source.get("collection_id"),
            )
            if source.get("collection_id") or source.get("kind") == "ballot_row"
            else None,
            "Original URL": source.get("source_url", source.get("url")),
        }

    write(
        {
            "Row type": "Metadata",
            "Context field": "Export",
            "Context value": "Campaign funders and exact source payments",
            "Scope": data["scope_note"],
        }
    )
    for label, text in {
        "Amounts": "Choose Funder or Candidate rows for attributed summaries, or Payment rows for individual records. These are alternative views: never add them together. Known subtotals are included in summary amounts, not extra money. Included unpaid USD is already included in Payment USD. Memo detail and Superseded payment rows are not current additive payments. Version not established rows retain an exact Document amount in its source currency; its amendment status is unknown, so it is not a current or superseded payment and is not added to totals. Native measure rows describe one source report and measure; never add overlapping reports or native measures to payment rows or report totals.",
        "Missing and zero": "Blank amounts are unavailable or have no records, as their status states. A reported zero remains numeric zero. Source rows and evidence rows carry no payment amount.",
        "Support and opposition": data["definitions"]["support"]
        + "; "
        + data["definitions"]["opposition"],
        "Source links": "Source URL opens the exact retained source in Finance; sign in if needed. Source record means a CSV record number, not a physical text line.",
        "Text values": "An initial apostrophe protects formula-like text and long or zero-prefixed identifiers in spreadsheets; it is not part of the original source value.",
    }.items():
        write({"Row type": "Guide", "Context field": label, "Context value": text})
    context_rows(
        "Metadata",
        {
            key: value
            for key, value in data.items()
            if key not in {"rows", "candidacies", "outcomes", "sources"}
        },
    )
    for dataset, source in sorted(data["sources"].items()):
        write(
            {
                "Row type": "Source",
                "Source role": "Published source file",
                **source_row(source, dataset),
            }
        )
    for source in data.get("external_sources", []):
        write(
            {
                "Row type": "Source",
                "Source role": "External retained original",
                **source_row(source),
            }
        )
    for report in data.get("external_reports", []):
        report_columns = {
            "Currency": None,
            "Authority": report["authority"],
            "Source family": "external",
            "Source generation": report["generation_id"],
            "Source account": report["account_id"],
            "Source report": report["source_report_id"],
            "Reporting period start": report["period_start"],
            "Reporting period end": report["period_end"],
            "Effective report": report["effective"],
            "Version scope": report.get("version_scope"),
            "Amendment status": report.get("amendment_status"),
            "Listing copied at": report.get("version_as_of"),
        }
        # Cover figures remain source-specific, including their measure and basis.
        context_rows("External report", report, report_columns)
        for binding in report.get("version_sources") or []:
            write(
                {
                    "Row type": "Source",
                    **report_columns,
                    "Source role": "External version evidence",
                    **source_row({**binding, "generation_id": report["generation_id"]}),
                }
            )
    events = data["rows"]
    by_funder, by_candidate = defaultdict(list), defaultdict(list)
    for event in events:
        by_funder[event["funder_id"]].append(event)
        if event["resolution"] == "attributed":
            for claim in event["claims"]:
                by_candidate[(claim["race_id"], claim["candidate_id"])].append(event)
    for funder, records in sorted(
        by_funder.items(),
        key=lambda pair: (
            not any(r["funder_name"] for r in pair[1]),
            min(
                (r["funder_name"].casefold() for r in pair[1] if r["funder_name"]),
                default="",
            ),
            pair[0],
        ),
    ):
        row = {
            "Row type": "Funder",
            "Funder ID": funder,
            "Funder": "\n".join(
                sorted({r["funder_name"] for r in records if r["funder_name"]})
            ),
            "Funder registration": records[0]["funder_registration"]
            if records[0]["funder_identity_state"] == "registered_filer"
            else None,
            "Funder identity": records[0]["funder_identity_state"].replace("_", " "),
            "Filed classifications": "\n".join(
                sorted(
                    {
                        " / ".join(
                            str(v)
                            for v in (
                                r["category"],
                                r["recorded_type"],
                                r["recorded_subtype"],
                            )
                            if v is not None
                        )
                        for r in records
                    }
                )
            ),
            "Negative record review": _support_review(records)["state"].replace(
                "_", " "
            ),
            **amounts(records),
        }
        for direction, metrics in [
            ("Supported", {"direct_contributions", "independent_For"}),
            ("Opposed", {"independent_Against"}),
        ]:
            row.update(
                {
                    f"{direction} {key.replace('_', ' ')}": value
                    for key, value in _counts(
                        _keys(records, metrics), data["outcomes"]
                    ).items()
                }
            )
        write(row)
        for measure in _native_measures(records):
            write(
                {
                    "Row type": "Native measure",
                    "Funder ID": funder,
                    "Funder": row["Funder"],
                    "Authority": measure["authority"],
                    "Source family": "external",
                    "Source account": measure["account_id"],
                    "Source report": measure["source_report_id"],
                    "Reporting period start": measure["period_start"],
                    "Reporting period end": measure["period_end"],
                    "Effective report": measure["effective"],
                    "Version scope": measure.get("version_scope"),
                    "Amendment status": measure.get("amendment_status"),
                    "Listing copied at": measure.get("version_as_of"),
                    "Direction": measure["direction"],
                    "Transaction type": measure["transaction_type"],
                    "Measure": measure["measure"],
                    "Measure basis": measure["basis"],
                    "Measure status": measure["state"],
                    "Native measure amount": measure["amount"],
                    "Source currency": measure["currency"],
                    "Currency": measure["currency"],
                }
            )
        proofs = {
            json.dumps(r["funder_identity_evidence"], sort_keys=True)
            for r in records
            if r["funder_identity_evidence"]
        }
        for encoded in sorted(proofs):
            proof = json.loads(encoded)
            write(
                {
                    "Row type": "Source",
                    "Funder ID": funder,
                    "Funder": row["Funder"],
                    "Source role": "Funder registration evidence",
                    **source_row(proof, proof["dataset"]),
                }
            )
        for encoded in sorted(proofs):
            context_rows(
                "Funder identity evidence",
                json.loads(encoded),
                {"Funder ID": funder, "Funder": row["Funder"]},
            )
        for affected in _support_review(records)["candidacies"]:
            write(
                {
                    "Row type": "Negative record context",
                    "Funder ID": funder,
                    "Funder": row["Funder"],
                    "Race ID": affected["race_id"],
                    "Candidate ID": affected["candidate_id"],
                    "Payment kind": _CSV_MEASURES[affected["metric"]],
                    "Context value": "Positive and negative records both present; support counts positive records, not net support",
                }
            )
    race_index = {r.id: r for r in races}
    candidate_rows = {}
    for item in data["candidacies"]:
        race, candidate = race_index[item["race_id"]], item["candidate"]
        key = (race.id, candidate["candidate_id"])
        detail = _candidate_details(
            race, candidate, data["outcomes"], by_candidate[key]
        )
        outcome = (
            data["outcomes"]
            .get(race.id, {})
            .get("candidates", {})
            .get(candidate["candidate_id"], {})
        )
        candidate_rows[key] = {
            "Candidate": candidate["name"],
            "Candidate ID": candidate["candidate_id"],
            "Official party": candidate.get("party"),
            "Race": race.label,
            "Race ID": race.id,
            "District": detail["district"],
        }
        write(
            {
                "Row type": "Candidate",
                **candidate_rows[key],
                **amounts(by_candidate[key]),
                "Votes": candidate.get("votes"),
                "Result status": detail["result_status"],
                "Outcome": (outcome.get("outcome") or "").replace("_", " "),
                "Outcome status": outcome.get("outcome_status", "pending"),
                "Supported": detail["supported"],
                "Opposed": detail["opposed"],
                "Source SHA256": detail["candidate_source_sha256"],
                "Source record": detail["candidate_source_row"],
                "Source URL": _app_source(data, detail["candidate_source_sha256"]),
            }
        )
        context_rows("Candidate evidence", candidate, candidate_rows[key])
    for race_id, outcome in data["outcomes"].items():
        context_rows(
            "Outcome evidence",
            outcome,
            {"Race ID": race_id, "Race": race_index[race_id].label},
        )
    accounts = {}
    for event in events:
        source = source_row(event["source"], event["dataset"])
        common_payment = {
            "Funder": event["funder_name"],
            "Funder ID": event["funder_id"],
            "Funder registration": event["funder_registration"],
            "Target account": event["target_registration"],
            "Attribution": event["resolution"].replace("_", " "),
            **source,
        }
        external = event.get("source_family") == "external"
        if external:
            common_payment.update(
                {
                    "Authority": event["authority"],
                    "Source account": event["source_account_id"],
                    "Source report": event["source_report_id"],
                    "Source payment key": event["external_payment_key"],
                    "Source row ID": event["source_row_id"],
                    "Target candidate ID": event["target_registration"],
                    "Reporting period start": event["period_start"],
                    "Reporting period end": event["period_end"],
                    "Effective report": event["effective"],
                    "Version scope": event.get("version_scope"),
                    "Amendment status": event.get("amendment_status"),
                    "Listing copied at": event.get("version_as_of"),
                    "Direction": event["direction"],
                    "Transaction type": event["transaction_type"],
                    "Amount role": event["amount_role"],
                    "Vendor name": event["fields"].get("Vendor name"),
                    "Purpose": event["fields"].get("Purpose"),
                    "Source currency": event["currency"],
                    "Currency": event["currency"],
                }
            )
        row_type = (
            "Version not established"
            if external and event["effective"] is None
            else "Memo detail"
            if external and event["nonadditive"]
            else (
                "Superseded payment"
                if external and event["effective"] is False
                else "Payment"
            )
        )
        write(
            {
                "Row type": row_type,
                **common_payment,
                **(
                    {"Document amount": event["amount"]}
                    if row_type == "Version not established"
                    else {}
                ),
                **(
                    {f"{row_type} USD": event["amount"]}
                    if row_type != "Version not established"
                    and (not external or event["currency"] == "USD")
                    else {}
                ),
                **(
                    {
                        "Native "
                        + {
                            "Payment": "payment",
                            "Memo detail": "memo",
                            "Superseded payment": "superseded",
                        }[row_type]
                        + " amount": event["amount"]
                    }
                    if external
                    and event["currency"] != "USD"
                    and row_type != "Version not established"
                    else {}
                ),
                "Included unpaid USD": event["fields"].get("Unpaid amount"),
                "Payment amount status": event["amount_state"].replace("_", " "),
                "Payment kind": event["transaction_type"]
                if external
                else _CSV_MEASURES.get(event["metric"], "Other receipts"),
                "Payment date": event["date"],
                "Reported year": event["reported_year"],
                **{
                    f"Filed: {name}": event["fields"].get(name)
                    for name in source_fields
                },
            }
        )
        if external:
            for binding in event["source_bindings"]:
                write(
                    {
                        "Row type": "Source",
                        **common_payment,
                        "Source role": "External payment evidence",
                        **source_row(
                            {
                                **binding,
                                "generation_id": event["external_generation_id"],
                            }
                        ),
                    }
                )
                context_rows(
                    "Payment source locator", binding["locator"], common_payment
                )
            context_rows("Payment memo", event["memo"], common_payment)
            context_rows("Payment address", event["payee_address"], common_payment)
        claims = {(c["race_id"], c["candidate_id"]) for c in event["claims"]}
        related = {
            (c["race_id"], c["candidate_id"]) for c in event["related_candidacies"]
        }
        for key in sorted(claims | related):
            write(
                {
                    "Row type": "Payment candidacy",
                    **common_payment,
                    **candidate_rows[key],
                    "Dated claim": key in claims,
                }
            )
        for account in event["account_reviews"]:
            key = (
                account["race_id"],
                account["candidate_id"],
                account["registration_number"],
                account["decision_id"],
            )
            accounts[key] = account
    for (race_id, candidate_id, registration, decision), account in sorted(
        accounts.items()
    ):
        common_account = {
            **candidate_rows[(race_id, candidate_id)],
            "Target account": registration,
            "Account decision ID": decision,
            "Checked on": account["checked_on"],
            "Account period start": account["period_start"],
            "Account period end": account["period_end"],
        }
        write({"Row type": "Account link", **common_account})
        for proof in account["evidence"]:
            write(
                {
                    "Row type": "Source",
                    **common_account,
                    "Source role": proof.get("kind"),
                    **source_row(proof),
                }
            )
            context_rows("Account evidence", proof, common_account)
    priority = {
        "Source": 0,
        "Account link": 1,
        "Payment candidacy": 2,
        "Negative record context": 3,
        "Guide": 4,
        "Metadata": 5,
    }
    writer.writerows(sorted(deferred, key=lambda row: priority.get(row["Row type"], 6)))
    return output.getvalue()


def export(
    db: Session,
    *,
    format="json",
    candidate_id=None,
    metric=None,
    resolution=None,
    **kwargs,
):
    context, events, races, _, outcomes = _build(db, **kwargs)
    _candidate_exists(context, races, candidate_id)
    rows = _record_filters(events, candidate_id, metric, resolution)
    context = _record_context(context, rows, candidate_id, metric, resolution)
    scope, candidacies, selected_outcomes = _export_inventory(
        context, rows, races, outcomes
    )
    data = {
        **context,
        "candidacy_context_scope": scope,
        "outcomes": selected_outcomes,
        "rows": rows,
        "candidacies": candidacies,
    }
    if format == "json":
        body = (
            json.dumps(data, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
            + "\n"
        )
    else:
        body = _csv_export(data, races)
    return (
        body,
        f"election-analytics-{context['election_date']}-{context['version']}.{format}",
    )


def source_body(db: Session, *, election_key, dataset, snapshot_id, version):
    if dataset not in {"contributions", "expenditures", "independent_expenditures"}:
        _unavailable()
    with tempfile.TemporaryDirectory(prefix="election-analytics-source-") as directory:
        path = Path(directory) / "original.csv"
        # The requested original is captured by the same proof pass used to
        # calculate this response's version. No recursive context or second GET.
        context, *_ = _context(
            db,
            election_key,
            snapshot_id,
            version=version,
            requested_output=(dataset, path),
        )
        if (
            context["sources"].get(dataset, {}).get("retained_original_state")
            != "available"
        ):
            _unavailable()
        return path.read_bytes()
