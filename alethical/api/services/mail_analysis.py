"""Private local OCR of frozen mailer pairs; machine text never confirms identity.

Saved rows are the durable queue. A database lock serializes claims across API
replicas using row locks; a fenced lease recovers crashes. No image or OCR text reaches another provider.
"""

from __future__ import annotations

import asyncio
from copy import deepcopy
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
import hashlib
import logging
import os
import shutil
import subprocess
import tempfile
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import func, select, text, update
from sqlalchemy.dialects.postgresql import insert

from alethical.api.services import mail_upload
from alethical.api.services.mail_ocr import (
    PAYER as PAYER,
    disclosures as disclosures,
    parse_tsv as parse_tsv,
    deskew as deskew,
    angled_disclosure_region as angled_disclosure_region,
    disclosure_column as disclosure_column,
    payer_context as payer_context,
    refine_disclosure as refine_disclosure,
    image_fingerprint as image_fingerprint,
    read_image as read_image,
)
from alethical.api.services.mail_public_records import public_records
from alethical.api.services.mail_reading_copy import reading_copy, reading_disclosure
from alethical.api.services.mail_payer_sources import (
    corroborate,
    related_records,
    sourced_candidates,
)
from alethical.db import models as m
from alethical.db.session import get_session_factory
from alethical.pipeline.campaign_finance_filings import (
    live_filings_snapshot,
    viewer_url,
)

logger = logging.getLogger(__name__)
VERSION = "tesseract-english-v5"
LEASE = timedelta(minutes=10)


def candidate_records(db, payer: str) -> list[dict]:
    snapshot = live_filings_snapshot(db)
    curated = sourced_candidates(payer)
    if snapshot is None:
        return curated
    # Exact case-insensitive spelling only. A candidate is not a confirmed match.
    rows = db.scalars(
        select(m.CampaignFinanceFiler)
        .where(
            m.CampaignFinanceFiler.snapshot_id == snapshot.id,
            func.lower(m.CampaignFinanceFiler.name) == payer.lower(),
        )
        .limit(10)
    )
    return [
        {
            "name": row.name,
            "registration_number": row.registration_number,
            "snapshot_id": str(snapshot.id),
            "scope": "candidate_record",
            "basis": "same_committee_name",
            "source_url": viewer_url(row.kind).removesuffix("api")
            + row.registration_number
            + "/",
        }
        for row in rows
        if row.registration_number
        not in {item["registration_number"] for item in curated}
    ] + curated


# Only image-derived fields may move between submissions with identical files.
# Keep ownership, reactions, matching decisions and assembled records out.
EXTRACTION_FIELDS = frozenset(
    {
        "status",
        "text",
        "disclosures",
        "complete",
        "partial_reasons",
        "rotation",
        "image_fingerprint",
        "width",
        "height",
        "reading_lines",
        "display_text",
        "reading_incomplete",
        "deskew_angle",
        "recovery_canvas",
    }
)
INPUT_FIELDS = ("sha256", "byte_count", "content_type", "width", "height")


def extraction_copy(value):
    result = {key: deepcopy(value[key]) for key in EXTRACTION_FIELDS if key in value}

    # Nested objects are image evidence too, not an escape hatch for assembled
    # identity, feedback or credentials from a different submission.
    def fields(item, names):
        return {key: deepcopy(item[key]) for key in names if key in item}

    if "recovery_canvas" in result:
        result["recovery_canvas"] = fields(
            value["recovery_canvas"], ("source_size", "size", "resample")
        )
    if "disclosures" in result:
        result["disclosures"] = []
        for quote in value["disclosures"]:
            clean = fields(
                quote,
                (
                    "quote",
                    "payer_text",
                    "quality",
                    "edge_warning",
                    "box",
                    "confidence",
                    "refinement_incomplete",
                    "display_quote",
                    "display_quote_normalization",
                ),
            )
            if isinstance(quote.get("crop"), dict):
                clean["crop"] = fields(
                    quote["crop"],
                    (
                        "source_box",
                        "width",
                        "height",
                        "deskew_angle",
                        "segmentation",
                    ),
                )
            result["disclosures"].append(clean)
    if "reading_lines" in result:
        result["reading_lines"] = []
        for line in value["reading_lines"]:
            clean = fields(line, ("text", "confidence", "box"))
            if "words" in line:
                clean["words"] = [
                    fields(word, ("text", "confidence", "box"))
                    for word in line["words"]
                ]
            result["reading_lines"].append(clean)
    return result


def same_input(side, image):
    return side.get("input") == {key: image[key] for key in INPUT_FIELDS}


def reusable_reading(db, submission_id, image):
    """Reuse only an extraction of bytes this submission has already provided.

    The hash index bounds candidates; strict metadata and reader version are part
    of the key. No user-facing lookup by hash or other submission is exposed.
    """
    rows = db.execute(
        select(m.MailUploadAnalysis.result, m.MailUploadImage.side)
        .join(
            m.MailUploadImage,
            m.MailUploadImage.submission_id == m.MailUploadAnalysis.submission_id,
        )
        .join(
            m.MailUploadSubmission,
            m.MailUploadSubmission.id == m.MailUploadImage.submission_id,
        )
        .where(
            m.MailUploadAnalysis.submission_id != submission_id,
            m.MailUploadAnalysis.status.in_(("ready", "partial")),
            m.MailUploadAnalysis.result["version"].as_string() == VERSION,
            m.MailUploadSubmission.saved_at.is_not(None),
            m.MailUploadImage.selected.is_(True),
            m.MailUploadImage.verified_at.is_not(None),
            *(getattr(m.MailUploadImage, key) == image[key] for key in INPUT_FIELDS),
        )
        .order_by(m.MailUploadAnalysis.completed_at.desc())
        .limit(20)
    )
    for result, source_side in rows:
        for side in result.get("sides", []):
            if (
                side.get("side") == source_side
                and side.get("sha256") == image["sha256"]
                and side.get("status") == "read"
                and side.get("reader_version") == VERSION
                and same_input(side, image)
            ):
                return extraction_copy(side)
    return None


def read_side(image, side, cached, prior):
    reader_version = VERSION
    if cached is not None:
        result = cached
    else:
        with tempfile.TemporaryDirectory(prefix="mail-analysis-") as folder:
            path = Path(folder) / side
            try:
                primary, _ = mail_upload.stores()
                started = time.monotonic()
                primary.get(
                    image["object_key"], path, max_bytes=mail_upload.MAX_IMAGE_BYTES
                )
                body = path.read_bytes()
                if (
                    len(body) != image["byte_count"]
                    or hashlib.sha256(body).hexdigest() != image["sha256"]
                ):
                    raise ValueError("Image verification failed")
                logger.info(
                    "Mail reading timing stage=fetch_verify elapsed_ms=%.1f",
                    (time.monotonic() - started) * 1000,
                )
                started = time.monotonic()
                result = read_image(path)
                logger.info(
                    "Mail reading timing stage=image_read elapsed_ms=%.1f",
                    (time.monotonic() - started) * 1000,
                )
            except Exception:
                result = {
                    "status": "unreadable",
                    "text": "",
                    "disclosures": [],
                    "complete": False,
                }
    if (
        prior
        and prior.get("sha256") == image["sha256"]
        and ("input" not in prior or same_input(prior, image))
        and prior.get("status") in {"read", "partial"}
        and prior.get("text")
        and (result["status"] == "unreadable" or not result.get("text"))
    ):
        reader_version = prior.get("reader_version")
        result = {
            **extraction_copy(prior),
            "status": "partial",
            "partial_reasons": sorted(
                set(prior.get("partial_reasons", []) + ["retry_failed"])
            ),
        }
    return {
        **extraction_copy(result),
        "side": side,
        "reader_version": reader_version,
        "sha256": image["sha256"],
        "input": {key: image[key] for key in INPUT_FIELDS},
    }


def previous_records(previous, payer, candidate, year):
    for prior_payer in previous.get("payers", []):
        if (prior_payer.get("side"), prior_payer.get("payer_text")) != (
            payer["side"],
            payer["payer_text"],
        ):
            continue
        for prior_candidate in prior_payer.get("candidates", []) + prior_payer.get(
            "related_records", []
        ):
            records = prior_candidate.get("records", {})
            if (
                all(
                    prior_candidate.get(key) == candidate.get(key)
                    for key in ("registration_number", "scope", "source_url")
                )
                and records.get("state") == "available"
                and records.get("year") == year
            ):
                return deepcopy(records)
    return None


def analyze(db, submission_id, *, publish=None) -> dict:
    submission = db.get(m.MailUploadSubmission, submission_id)
    selected = mail_upload.selected_images(db, submission)
    images = {}
    for side in ("front", "back"):
        row = selected.get(side)
        if row is None or row.verified_at is None:
            raise ValueError("Unverified image")
        images[side] = {key: getattr(row, key) for key in (*INPUT_FIELDS, "object_key")}
    year = submission.saved_at.year
    previous_row = db.get(m.MailUploadAnalysis, submission_id)
    previous = deepcopy(previous_row.result or {}) if previous_row else {}
    # Old same-input evidence can survive a failed fresh read, but cannot skip
    # this reader's work or become a current-version reusable extraction.
    prior_sides = {
        side["side"]: {
            **side,
            "reader_version": side.get("reader_version", previous.get("version")),
        }
        for side in previous.get("sides", [])
        if side.get("side") in images
        and side.get("sha256") == images[side["side"]]["sha256"]
        and ("input" not in side or same_input(side, images[side["side"]]))
    }
    cached = {}
    for side, image in images.items():
        prior = prior_sides.get(side)
        cached[side] = (
            extraction_copy(prior)
            if prior
            and prior.get("status") == "read"
            and prior.get("reader_version") == VERSION
            and same_input(prior, image)
            else reusable_reading(db, submission_id, image)
        )
    db.rollback()  # No database connection stays checked out during image work.
    sides = {side: deepcopy(value) for side, value in prior_sides.items()}
    completed = set()
    active = set()
    payers_by_side = {}
    records = {}
    failed_records = set()
    resolved_records = set()
    records_retry_needed = False

    def payers_for(side):
        return [
            {
                "side": side,
                **quote,
                "candidates": candidate_records(db, quote["payer_text"]),
                "related_records": related_records(quote["quote"], quote["payer_text"]),
                "official_organization": corroborate(
                    quote["payer_text"],
                    quote["quote"],
                    edge_warning=quote["edge_warning"],
                    confidence=quote["confidence"],
                ),
            }
            for quote in sides[side].get("disclosures", [])
            if quote.get("payer_text")
        ]

    def snapshot(*, final=False):
        payers = deepcopy(
            [
                payer
                for side in ("front", "back")
                for payer in payers_by_side.get(side, [])
            ]
        )
        for payer in payers:
            for candidate in payer["candidates"] + payer["related_records"]:
                number = candidate["registration_number"]
                value = records.get(number)
                old = previous_records(previous, payer, candidate, year)
                if number in failed_records and old:
                    value = {**old, "refresh_failed": True}
                elif value is None:
                    value = (
                        old
                        if old
                        else {
                            "state": "not_loaded" if final else "loading",
                            "registration_number": number,
                        }
                    )
                candidate["records"] = deepcopy(value)
        result = {
            "version": VERSION,
            "snapshot_version": 1,
            "progress": {
                "active_sides": [side for side in ("front", "back") if side in active],
                "completed_sides": [
                    side for side in ("front", "back") if side in completed
                ],
                "reading_complete": len(completed) == 2,
                "records_complete": final,
            },
            "records_retry_needed": records_retry_needed,
            "sides": [
                deepcopy(sides[side]) for side in ("front", "back") if side in sides
            ],
            "payers": payers,
        }
        if len(completed) == 2:
            result["payer_status"] = (
                "matched"
                if len(payers) == 1 and payers[0]["official_organization"]
                else ("uncertain" if payers else "not_found")
            )
        return result

    def emit():
        if publish is not None and not publish(snapshot()):
            raise RuntimeError("Mail reading lease was replaced")

    # Keep useful same-input evidence visible through a retry while recomputing
    # identity/records from current approved sources, never copying another result.
    for side in sides:
        payers_by_side[side] = payers_for(side)
    db.rollback()
    try:
        concurrency = min(
            2, max(1, int(os.getenv("ALETHICAL_MAIL_READ_CONCURRENCY", "1")))
        )
    except ValueError:
        concurrency = 1

    def load_records(number):
        started = time.monotonic()
        try:
            return public_records(number, year)
        finally:
            logger.info(
                "Mail reading timing stage=public_records elapsed_ms=%.1f",
                (time.monotonic() - started) * 1000,
            )

    # A slow public-record query must not hide another completed image. Its
    # service owns a separate short-lived DB session; image workers use none.
    with (
        ThreadPoolExecutor(max_workers=concurrency) as pool,
        ThreadPoolExecutor(max_workers=1) as record_pool,
    ):
        futures = {}

        def read_started(image, side, signal):
            # Signal execution, not queueing; the main thread persists progress.
            signal.set_result(side)
            return read_side(image, side, cached[side], prior_sides.get(side))

        for side, image in images.items():
            signal = Future()
            futures[signal] = ("started", side)
            futures[pool.submit(read_started, image, side, signal)] = ("side", side)
        while futures:
            done, _ = wait(futures, return_when=FIRST_COMPLETED)
            for future in done:
                kind, key = futures.pop(future)
                if kind == "started":
                    if key not in completed:
                        active.add(key)
                        emit()
                    continue
                if kind == "records":
                    try:
                        records[key] = future.result()
                    except Exception:
                        records_retry_needed = True
                        failed_records.add(key)
                        records[key] = {
                            "state": "unavailable",
                            "registration_number": key,
                        }
                    emit()
                    continue
                sides[key] = future.result()
                active.discard(key)
                completed.add(key)
                payers_by_side[key] = payers_for(key)
                db.rollback()
                emit()
                for payer in payers_by_side[key]:
                    for candidate in payer["candidates"] + payer["related_records"]:
                        number = candidate["registration_number"]
                        if number in resolved_records or len(resolved_records) >= 3:
                            continue
                        resolved_records.add(number)
                        futures[record_pool.submit(load_records, number)] = (
                            "records",
                            number,
                        )
    return snapshot(final=True)


def publish_progress(submission_id, attempt, started_at, result):
    """Short fenced write; no shared ORM state or private assignment changes."""
    with get_session_factory()() as db:
        updated = db.execute(
            update(m.MailUploadAnalysis)
            .where(
                m.MailUploadAnalysis.submission_id == submission_id,
                m.MailUploadAnalysis.status == "processing",
                m.MailUploadAnalysis.attempts == attempt,
                m.MailUploadAnalysis.started_at == started_at,
            )
            .values(result=deepcopy(result))
        )
        db.commit()
        return updated.rowcount == 1


def drain_once():
    factory = get_session_factory()
    with factory() as db:
        db.execute(
            insert(m.MailUploadAnalysis)
            .from_select(
                ["submission_id", "status", "attempts", "result"],
                select(
                    m.MailUploadSubmission.id,
                    text("'pending'"),
                    text("0"),
                    text("'{}'::jsonb"),
                ).where(m.MailUploadSubmission.saved_at.is_not(None)),
            )
            .on_conflict_do_nothing()
        )
        db.commit()
        now = datetime.now(timezone.utc)
        db.execute(
            update(m.MailUploadAnalysis)
            .where(
                m.MailUploadAnalysis.status == "processing",
                m.MailUploadAnalysis.attempts >= 3,
                m.MailUploadAnalysis.started_at < now - LEASE,
            )
            .values(status="failed")
        )
        row = db.scalar(
            select(m.MailUploadAnalysis)
            .where(
                m.MailUploadAnalysis.attempts < 3,
                (m.MailUploadAnalysis.status == "pending")
                | (
                    (m.MailUploadAnalysis.status == "processing")
                    & (m.MailUploadAnalysis.started_at < now - LEASE)
                ),
            )
            .join(
                m.MailUploadSubmission,
                m.MailUploadSubmission.id == m.MailUploadAnalysis.submission_id,
            )
            .order_by(
                m.MailUploadSubmission.saved_at, m.MailUploadAnalysis.submission_id
            )
            .limit(1)
            .with_for_update(skip_locked=True)
        )
        if row is None:
            db.commit()
            return False
        row.status, row.started_at, row.attempts = "processing", now, row.attempts + 1
        submission_id, attempt = row.submission_id, row.attempts
        db.commit()
        try:
            result = analyze(
                db,
                submission_id,
                publish=lambda result: publish_progress(
                    submission_id, attempt, now, result
                ),
            )
            status = (
                "partial"
                if any(side["status"] != "read" for side in result["sides"])
                or result.get("records_retry_needed")
                else "ready"
            )
        except Exception:
            db.rollback()
            result = None
            status = "failed" if attempt >= 3 else "pending"
            logger.warning("Mail analysis attempt failed; private originals retained")
        # Group assignments and this final write use the same lock order.
        db.execute(
            text("SELECT pg_advisory_xact_lock(hashtext('mail_creative_assignment'))")
        )
        # Fencing rejects a stale worker if a lease was recovered or replaced.
        row = db.scalar(
            select(m.MailUploadAnalysis)
            .where(
                m.MailUploadAnalysis.submission_id == submission_id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if (
            row.status == "processing"
            and row.attempts == attempt
            and row.started_at == now
        ):
            row.status = status
            if result is not None:
                row.result = result
                row.completed_at = datetime.now(timezone.utc)
                inherit_reviewed_creative(db, row)
            db.commit()
        return True


def response(db, submission):
    row = db.get(m.MailUploadAnalysis, submission.id)
    if row is None:
        return {
            "data": {
                "status": "pending",
                "sides": [],
                "payers": [],
                "matching_mailers": {"count": None},
            }
        }
    return {
        "data": {
            **row.result,
            "sides": [reading_copy(side) for side in row.result.get("sides", [])],
            "payers": [
                reading_disclosure(payer) for payer in row.result.get("payers", [])
            ],
            "status": row.status,
            "can_retry": row.status in {"failed", "partial"} and row.attempts < 3,
            "matching_mailers": {
                "count": db.scalar(
                    select(func.count())
                    .select_from(m.MailUploadAnalysis)
                    .join(
                        m.MailUploadSubmission,
                        m.MailUploadSubmission.id == m.MailUploadAnalysis.submission_id,
                    )
                    .where(
                        m.MailUploadSubmission.saved_at.is_not(None),
                        m.MailUploadAnalysis.creative_id == row.creative_id,
                        m.MailUploadAnalysis.excluded_from_counts.is_(False),
                    )
                )
                if row.creative_id and not row.excluded_from_counts
                else None,
                "basis": row.creative_evidence.get("method")
                if row.creative_id and not row.excluded_from_counts
                else None,
            },
            "confirmed_entity_id": str(row.confirmed_entity_id)
            if row.confirmed_entity_id
            else None,
            "confirmation_evidence": row.confirmation_evidence,
        }
    }


def require_ocr_runtime():
    """Check the local reader before any saved submission uses an attempt."""
    if not shutil.which("tesseract") or not shutil.which("nice"):
        raise RuntimeError("Mail analysis OCR executable unavailable")
    result = subprocess.run(
        ["tesseract", "--list-langs"],
        capture_output=True,
        text=True,
        timeout=10,
        check=True,
    )
    if "eng" not in result.stdout.splitlines():
        raise RuntimeError("Mail analysis English data unavailable")


def wake_worker(app):
    """Notify the lifespan loop after a committed save, including sync routes."""
    loop = getattr(app.state, "mail_analysis_loop", None)
    wake = getattr(app.state, "mail_analysis_wake", None)
    if loop is not None and wake is not None and not loop.is_closed():
        loop.call_soon_threadsafe(wake.set)


@asynccontextmanager
async def mail_analysis_lifespan(app):
    stop = asyncio.Event()
    wake = asyncio.Event()
    app.state.mail_analysis_loop = asyncio.get_running_loop()
    app.state.mail_analysis_wake = wake

    async def run():
        if os.getenv("ALETHICAL_MAIL_ANALYSIS_ENABLED", "").lower() == "true":
            try:
                await asyncio.to_thread(require_ocr_runtime)
            except Exception:
                logger.error("Mail analysis OCR unavailable; queue remains unclaimed")
                return
            logger.info("Mail analysis OCR ready: tesseract and English data available")
        while not stop.is_set():
            # Clear before claiming. A save during/after the claim then remains
            # signaled; clearing after an empty claim could lose that wake.
            wake.clear()
            image_gate = getattr(app.state, "mail_upload_image_gate", None)
            upload_busy = image_gate is not None and image_gate.locked()
            claimed = False
            if (
                os.getenv("ALETHICAL_MAIL_ANALYSIS_ENABLED", "").lower() == "true"
                and not upload_busy
            ):
                try:
                    claimed = await asyncio.to_thread(drain_once)
                except Exception:
                    logger.warning("Mail analysis worker unavailable")
            if claimed:
                # Drain ready backlog; the existing claim fence still owns work.
                continue
            try:
                await asyncio.wait_for(wake.wait(), timeout=5)
            except TimeoutError:
                pass

    task = asyncio.create_task(run())
    try:
        yield
    finally:
        stop.set()
        wake.set()
        await task
        app.state.mail_analysis_loop = None
        app.state.mail_analysis_wake = None


def assign_creative(db, submission_id, *, matching_submission_id, excluded, evidence):
    """Record an administrator's comparison of both sides and payer/version.

    A separate submission of the same creative counts once; a network retry keeps
    its original submission id. Test exclusions are explicit, never inferred from
    a reaction, recipient, filename or date.
    """
    import uuid

    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext('mail_creative_assignment'))")
    )
    submission = db.get(m.MailUploadSubmission, submission_id)
    if submission is None or submission.saved_at is None:
        raise mail_upload.fail(404, "Saved mail not found")
    row = db.get(m.MailUploadAnalysis, submission_id)
    if row is None:
        row = m.MailUploadAnalysis(submission_id=submission_id)
        db.add(row)
        db.flush()
    history = list((row.creative_evidence or {}).get("history", []))
    decision = {
        "matching_submission_id": str(matching_submission_id)
        if matching_submission_id
        else None,
        "excluded": excluded,
        "evidence": evidence,
    }
    same_decision = bool(history) and all(
        history[-1].get(key) == value for key, value in decision.items()
    )
    if same_decision and matching_submission_id is None:
        return row
    if matching_submission_id is not None:
        other = db.get(m.MailUploadAnalysis, matching_submission_id)
        other_submission = db.get(m.MailUploadSubmission, matching_submission_id)
        if (
            other is None
            or other.creative_id is None
            or other.excluded_from_counts
            or other_submission is None
            or other_submission.saved_at is None
        ):
            raise mail_upload.fail(409, "Matching mail needs a recorded creative")
        creative_id = other.creative_id
        if same_decision and row.creative_id == creative_id:
            return row
    else:
        other_members = (
            db.scalar(
                select(func.count())
                .select_from(m.MailUploadAnalysis)
                .where(
                    m.MailUploadAnalysis.creative_id == row.creative_id,
                    m.MailUploadAnalysis.submission_id != submission_id,
                )
            )
            if row.creative_id
            else 0
        )
        creative_id = (
            uuid.uuid4()
            if other_members
            else (
                row.creative_id
                or uuid.uuid5(uuid.NAMESPACE_URL, f"mail-creative:{submission_id}")
            )
        )
    history.append(
        {
            "at": datetime.now(timezone.utc).isoformat(),
            "previous_creative_id": str(row.creative_id) if row.creative_id else None,
            "creative_id": str(creative_id),
            "matching_submission_id": str(matching_submission_id)
            if matching_submission_id
            else None,
            "excluded": excluded,
            "evidence": evidence,
        }
    )
    row.creative_id = creative_id
    row.excluded_from_counts = excluded
    row.creative_evidence = {"method": "reviewed_creative", "history": history}
    db.flush()
    reconcile_automatic_copies(db, row)
    return row


def inherit_reviewed_creative(db, row):
    """Copies inherit a reviewed content/version decision, never a name match.

    Near images produce private administrator hints only. They cannot establish
    unchanged wording, payer or version. Conflicting reviewed references yield no
    automatic assignment. No other uploader's identifiers enter reader responses.
    """
    if row.creative_id is not None:
        if row.creative_evidence.get("method") == "reviewed_creative":
            db.flush()
            reconcile_automatic_copies(db, row)
        return
    if row.excluded_from_counts:
        return
    sides = {side["side"]: side for side in row.result.get("sides", [])}
    if set(sides) != {"front", "back"}:
        return
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext('mail_creative_assignment'))")
    )
    base = (
        select(m.MailUploadAnalysis)
        .join(
            m.MailUploadSubmission,
            m.MailUploadSubmission.id == m.MailUploadAnalysis.submission_id,
        )
        .where(
            m.MailUploadAnalysis.submission_id != row.submission_id,
            m.MailUploadAnalysis.creative_id.is_not(None),
            m.MailUploadAnalysis.creative_evidence["method"].astext
            == "reviewed_creative",
            m.MailUploadAnalysis.excluded_from_counts.is_(False),
            m.MailUploadSubmission.saved_at.is_not(None),
        )
    )
    if not all(side.get("sha256") for side in sides.values()):
        return
    exact_query = base.where(
        m.MailUploadAnalysis.result["sides"].contains(
            [{"side": side, "sha256": item["sha256"]} for side, item in sides.items()]
        )
    )
    groups = list(
        db.scalars(
            exact_query.with_only_columns(m.MailUploadAnalysis.creative_id)
            .distinct()
            .limit(2)
        )
    )
    if len(groups) == 1:
        reference = db.scalar(exact_query.limit(1))
        row.creative_id = groups[0]
        row.creative_evidence = {
            "method": "reviewed_creative_same_originals",
            "automatic": True,
            "assignment_history": row.creative_evidence.get("assignment_history", []),
            "reference_submission_id": str(reference.submission_id),
            "compared_at": datetime.now(timezone.utc).isoformat(),
            "both_original_hashes_match": True,
        }
        return
    references = list(
        db.scalars(base.order_by(m.MailUploadAnalysis.completed_at.desc()).limit(500))
    )
    near = []
    for reference in references:
        if reference.creative_evidence.get("method") != "reviewed_creative":
            continue
        other = {side["side"]: side for side in reference.result.get("sides", [])}
        if set(other) != {"front", "back"}:
            continue
        if all(
            sides[side].get("image_fingerprint")
            and other[side].get("image_fingerprint")
            for side in sides
        ):
            distances = {
                side: (
                    int(sides[side]["image_fingerprint"], 16)
                    ^ int(other[side]["image_fingerprint"], 16)
                ).bit_count()
                for side in sides
            }
            if max(distances.values()) <= 8:
                near.append(
                    {
                        "submission_id": str(reference.submission_id),
                        "distances": distances,
                        "basis": "image_similarity_only",
                    }
                )
    row.creative_evidence = {
        "method": "unresolved",
        "automatic": True,
        "assignment_history": row.creative_evidence.get("assignment_history", []),
        "similarity_candidates": near[:10],
        "candidate_search_limit": 500,
        "conflicting_exact_references": len(groups) > 1,
    }


def reconcile_automatic_copies(db, reference):
    """Re-check derived groups when reviewed evidence moves or conflicts."""
    sides = reference.result.get("sides", [])
    if len(sides) != 2 or not all(side.get("sha256") for side in sides):
        return
    copies = list(
        db.scalars(
            select(m.MailUploadAnalysis).where(
                m.MailUploadAnalysis.submission_id != reference.submission_id,
                m.MailUploadAnalysis.creative_evidence["automatic"]
                .as_boolean()
                .is_(True),
                m.MailUploadAnalysis.result["sides"].contains(
                    [{"side": side["side"], "sha256": side["sha256"]} for side in sides]
                ),
            )
        )
    )
    for copy in copies:
        history = list(copy.creative_evidence.get("assignment_history", []))
        history.append(
            {
                "at": datetime.now(timezone.utc).isoformat(),
                "previous_creative_id": str(copy.creative_id)
                if copy.creative_id
                else None,
                "previous_method": copy.creative_evidence.get("method"),
                "reason": "reviewed_reference_changed",
            }
        )
        copy.creative_id = None
        copy.creative_evidence = {
            "method": "unresolved",
            "automatic": True,
            "assignment_history": history,
        }
        db.flush()
        inherit_reviewed_creative(db, copy)
    db.flush()
