"""Private local OCR of frozen mailer pairs; machine text never confirms identity.

Saved rows are the durable queue. A database lock serializes claims across API
replicas using row locks; a fenced lease recovers crashes. No image or OCR text reaches another provider.
"""

from __future__ import annotations

import asyncio
import csv
import hashlib
import io
import logging
import os
import re
import shutil
import subprocess
import tempfile
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

from PIL import Image, ImageOps
import numpy as np
from sqlalchemy import func, select, text, update
from sqlalchemy.dialects.postgresql import insert

from alethical.api.services import mail_upload
from alethical.api.services.mail_public_records import public_records
from alethical.api.services.mail_reading_copy import reading_copy
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
VERSION = "tesseract-english-v3"
LEASE = timedelta(minutes=10)
PAYER = re.compile(r"\b(?:prepared\s+and\s+)?paid\s+for\s+by\s+(.+)", re.I)


def disclosures(lines: list[dict], width: int, height: int) -> list[dict]:
    """Quote OCR verbatim; never fill a clipped or missing disclosure."""
    found = []
    for index, line in enumerate(lines):
        match = PAYER.search(line["text"])
        if not match:
            continue
        # One immediately following line is retained only as evidence, not silently
        # joined to a payer's name. A missing name remains an unreadable outcome.
        payer = match.group(1).strip()
        payer = re.split(
            r"[.;]|,?\s+https?://|,?\s+P\.?O\.?\s+Box\b|,\s+\d|\s+not\s+authorized",
            payer,
            maxsplit=1,
            flags=re.I,
        )[0].strip()
        box = line["box"]
        edge = box[0] <= 8 or box[1] <= 8 or box[2] >= width - 8 or box[3] >= height - 8
        found.append(
            {
                "quote": line["text"],
                "payer_text": payer or None,
                "quality": "machine_read",
                "edge_warning": edge,
                "box": box,
                "confidence": line["confidence"],
            }
        )
    return found


def parse_tsv(raw):
    grouped = {}
    for word in csv.DictReader(
        io.StringIO(raw), delimiter="\t", quoting=csv.QUOTE_NONE
    ):
        value = word.get("text", "").strip()
        confidence = float(word.get("conf", "-1"))
        if not value or confidence < 0:
            continue
        key = tuple(word[name] for name in ("block_num", "par_num", "line_num"))
        x, y, w, h = (int(word[name]) for name in ("left", "top", "width", "height"))
        grouped.setdefault(key, []).append((value, confidence, x, y, x + w, y + h))
    return [
        {
            "text": " ".join(w[0] for w in words),
            "confidence": round(sum(w[1] for w in words) / len(words), 1),
            "box": [
                min(w[2] for w in words),
                min(w[3] for w in words),
                max(w[4] for w in words),
                max(w[5] for w in words),
            ],
        }
        for words in grouped.values()
    ]


def deskew(image):
    """Local projection pass on a small disclosure crop, without changing bytes."""
    if np.median(np.asarray(image.convert("L"))) < 120:
        image = ImageOps.invert(image)
    sample = image.convert("L")
    sample.thumbnail((800, 300))
    pixels = np.asarray(sample)
    threshold = float(np.percentile(pixels, 35))
    mask = Image.fromarray(np.where(pixels < threshold, 255, 0).astype(np.uint8))
    choices = []
    for angle in range(-12, 13, 2):
        turned = np.asarray(mask.rotate(angle, expand=False, fillcolor=0), dtype=float)
        projection = turned.sum(axis=1)
        choices.append((float(np.square(np.diff(projection)).sum()), angle))
    angle = max(choices)[1]
    return image.rotate(
        angle, resample=Image.Resampling.BICUBIC, expand=True, fillcolor="white"
    ), angle


def angled_disclosure_region(size, box):
    """Keep context above/below sloped fine print, without reading the full page."""
    width, height = size
    x1, y1, x2, y2 = box
    span = x2 - x1
    left = max(0, x1 - max(600, span * 2))
    right = min(width, x2 + max(400, span))
    pad = max(200, int((right - left) * 0.22))
    return (left, max(0, y1 - pad), right, min(height, y2 + pad))


def disclosure_column(lines, start):
    """Keep only nearby lines aligned with the disclosure, not postage columns."""
    first = lines[start]
    x1, y1, x2, y2 = first["box"]
    selected = [first]
    bottom = y2
    line_height = max(1, y2 - y1)
    for line in sorted(lines, key=lambda item: item["box"][1]):
        if line is first:
            continue
        left, top, right, end = line["box"]
        if top < y1 + line_height / 2 or top > bottom + line_height * 2:
            continue
        overlap = max(0, min(x2, right) - max(x1, left))
        if (
            abs(left - x1) > max(80, line_height * 2)
            or overlap < min(x2 - x1, right - left) * 0.5
        ):
            continue
        selected.append(line)
        bottom = end
        if len(selected) == 4:
            break
    return selected


def payer_context(quote):
    """Stop a name at a separately read address/site line; retain the full quote."""
    kept = []
    for line in quote.splitlines():
        if kept and re.search(
            r"^\s*(?:https?://|www\.|P\.?\s*O\.?\s+Box\b|"
            r"\d{1,6}\s+.+\b(?:street|st|avenue|ave|boulevard|blvd|road|rd|"
            r"lane|ln|drive|dr|way|court|ct|highway|hwy)\b)",
            line,
            re.I,
        ):
            break
        kept.append(line)
    return " ".join(" ".join(kept).split())


def refine_disclosure(rotated, quote, folder, deadline):
    x1, y1, x2, y2 = quote["box"]
    pad = max(12, (y2 - y1) // 2)
    regions = [
        (
            max(0, x1 - pad),
            max(0, y1 - pad),
            min(rotated.width, x2 + pad),
            min(rotated.height, y2 + 4 * (y2 - y1)),
        ),
        (
            max(0, x1 - pad),
            max(0, y1 - pad),
            min(rotated.width, x2 + max(400, x2 - x1)),
            min(rotated.height, y2 + 4 * (y2 - y1)),
        ),
        (
            0,
            max(0, y1 - pad),
            min(rotated.width, x2 + pad),
            min(rotated.height, y2 + 4 * (y2 - y1)),
        ),
    ]
    # One extra sparse pass only when the normal disclosure read is unresolved
    # or weak. It shares the existing per-image deadline and 3-anchor limit.
    regions.append(angled_disclosure_region(rotated.size, quote["box"]))
    best = None
    try:
        for region_index, region in enumerate(regions):
            sparse = region_index == len(regions) - 1
            if (
                sparse
                and best is not None
                and best[1]["confidence"] >= 90
                and not best[1]["edge_warning"]
            ):
                break
            original_crop = rotated.crop(region)
            variants = (
                (deskew(original_crop),)
                if sparse
                else ((original_crop, 0), deskew(original_crop))
            )
            for corrected, angle in variants:
                if time.monotonic() >= deadline:
                    break
                path = Path(folder) / "disclosure.png"
                corrected.save(path)
                raw = subprocess.run(
                    [
                        "nice",
                        "-n",
                        "10",
                        "tesseract",
                        str(path.resolve()),
                        "stdout",
                        "-l",
                        "eng",
                        "--psm",
                        "11" if sparse else "6",
                        "tsv",
                    ],
                    capture_output=True,
                    check=True,
                    timeout=max(0.1, min(10, deadline - time.monotonic())),
                    env={**os.environ, "OMP_THREAD_LIMIT": "1"},
                ).stdout.decode("utf-8", errors="replace")
                lines = parse_tsv(raw)
                start = next(
                    (i for i, line in enumerate(lines) if PAYER.search(line["text"])),
                    None,
                )
                if start is None:
                    continue
                relevant = disclosure_column(lines, start) if sparse else lines[start:]
                refined = "\n".join(line["text"] for line in relevant)
                match = PAYER.search(payer_context(refined))
                split = re.split(
                    r"[.;]|,?\s+https?://|,?\s+P\.?O\.?\s+Box\b|,\s+\d|\s+not\s+authorized",
                    match.group(1),
                    maxsplit=1,
                    flags=re.I,
                )
                payer = split[0].strip()
                measured = relevant[: min(2, len(relevant))]
                confidence = sum(line["confidence"] for line in measured) / len(
                    measured
                )
                edge = any(
                    line["box"][0] <= 3 or line["box"][2] >= corrected.width - 3
                    for line in measured
                )
                score = (
                    confidence
                    - 20 * edge
                    - 15 * (len(split) == 1)
                    - 20 * (len(payer) > 100)
                )
                if best is None or score > best[0]:
                    best = (
                        score,
                        {
                            **quote,
                            "quote": refined,
                            "box": None,
                            "payer_text": payer,
                            "confidence": round(confidence, 1),
                            "edge_warning": edge or quote["edge_warning"],
                            "crop": {
                                "source_box": list(region),
                                "width": corrected.width,
                                "height": corrected.height,
                                "deskew_angle": angle,
                                "segmentation": "sparse_column" if sparse else "block",
                            },
                        },
                    )
    except (subprocess.TimeoutExpired, subprocess.CalledProcessError):
        if best is None:
            raise
        best[1]["refinement_incomplete"] = True
    chosen = best[1] if best else quote
    if chosen.get("payer_text") and len(chosen["payer_text"]) > 100:
        chosen["payer_text"] = None
        chosen["edge_warning"] = True
    return chosen


def image_fingerprint(image):
    """Private similarity hint only; never evidence of the same creative version."""
    pixels = np.asarray(image.convert("L").resize((9, 8)))
    bits = (pixels[:, 1:] > pixels[:, :-1]).flatten()
    return format(sum(int(bit) << index for index, bit in enumerate(bits)), "016x")


def read_image(path: Path) -> dict:
    """Bound work and memory; preserve original file, including its metadata."""
    best = None
    deadline = time.monotonic() + 90
    with Image.open(path) as original:
        original.draft("RGB", (4000, 4000))
        picture = ImageOps.exif_transpose(original)
        picture.thumbnail((4000, 4000))
        picture = picture.convert("RGB")
    with tempfile.TemporaryDirectory(prefix="mail-ocr-") as folder:
        try:
            for angle in (0, 90, 180, 270):
                if time.monotonic() >= deadline:
                    break
                rotated = picture.rotate(angle, expand=True)
                source = Path(folder) / "page.png"
                rotated.save(source)
                raw = subprocess.run(
                    [
                        "nice",
                        "-n",
                        "10",
                        "tesseract",
                        str(source.resolve()),
                        "stdout",
                        "-l",
                        "eng",
                        "--psm",
                        "11",
                        "tsv",
                    ],
                    capture_output=True,
                    timeout=max(0.1, min(25, deadline - time.monotonic())),
                    check=True,
                    env={**os.environ, "OMP_THREAD_LIMIT": "1"},
                ).stdout.decode("utf-8", errors="replace")
                lines = parse_tsv(raw)
                quotes = disclosures(lines, *rotated.size)
                # Sparse OCR interleaves neighboring columns. Re-read only the
                # disclosure's own column so wrapped payer names stay in order.
                for line in lines:
                    if not PAYER.search(line["text"]) and re.search(
                        r"\bpaid\b|\bprepared\b|\bexpenditure\b|\b(?:for|or|r)\s+by\b",
                        line["text"],
                        re.I,
                    ):
                        quotes.append(
                            {
                                "quote": line["text"],
                                "payer_text": None,
                                "quality": "machine_read",
                                "edge_warning": False,
                                "box": line["box"],
                                "confidence": line["confidence"],
                            }
                        )
                partial_reasons = []
                refined_quotes = []
                for quote in quotes[:3]:
                    try:
                        refined_quotes.append(
                            refine_disclosure(rotated, quote, folder, deadline)
                        )
                    except (subprocess.TimeoutExpired, subprocess.CalledProcessError):
                        refined_quotes.append(quote)
                        partial_reasons.append("disclosure_reading_stopped")
                quotes = refined_quotes
                if any(quote.get("refinement_incomplete") for quote in quotes):
                    partial_reasons.append("disclosure_reading_stopped")
                quotes = [quote for quote in quotes if quote["payer_text"]]
                readable = [line for line in lines if line["confidence"] >= 60]
                score = sum(len(line["text"]) for line in readable) + 1000 * len(quotes)
                result = {
                    "status": (
                        "partial"
                        if partial_reasons or any(q["edge_warning"] for q in quotes)
                        else "read"
                    )
                    if readable
                    else "unreadable",
                    "partial_reasons": partial_reasons
                    + (
                        ["disclosure_cut_off"]
                        if any(q["edge_warning"] for q in quotes)
                        else []
                    ),
                    "text": "\n".join(line["text"] for line in lines)[:60000],
                    "disclosures": quotes,
                    "rotation": angle,
                    "image_fingerprint": image_fingerprint(rotated),
                    "width": rotated.width,
                    "height": rotated.height,
                    "complete": False,
                }
                if best is None or score > best[0]:
                    best = (score, result)
                # A useful upright read needs no speculative rotations. Completeness
                # is still unknown, even when every recognized word is confident.
                if time.monotonic() >= deadline or (
                    quotes and readable and all(q["confidence"] >= 70 for q in quotes)
                ):
                    break
        except (subprocess.TimeoutExpired, subprocess.CalledProcessError):
            if best is None:
                raise
            best[1]["status"] = "partial"
            best[1]["partial_reasons"] = ["reading_stopped"]
    return best[1]


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


def analyze(db, submission_id) -> dict:
    submission = db.get(m.MailUploadSubmission, submission_id)
    images = mail_upload.selected_images(db, submission)
    primary, _ = mail_upload.stores()
    previous = db.get(m.MailUploadAnalysis, submission_id)
    prior_sides = (
        {side["side"]: side for side in (previous.result or {}).get("sides", [])}
        if previous
        else {}
    )
    sides = []
    with tempfile.TemporaryDirectory(prefix="mail-analysis-") as folder:
        for side in ("front", "back"):
            row = images.get(side)
            if row is None or row.verified_at is None:
                raise ValueError("Unverified image")
            prior = prior_sides.get(side)
            if (
                prior
                and prior.get("sha256") == row.sha256
                and prior.get("status") == "read"
            ):
                sides.append(prior)
                continue
            path = Path(folder) / side
            try:
                primary.get(row.object_key, path, max_bytes=mail_upload.MAX_IMAGE_BYTES)
                if hashlib.sha256(path.read_bytes()).hexdigest() != row.sha256:
                    raise ValueError("Image verification failed")
                result = read_image(path)
            except Exception:
                # Failed storage/reading affects only this side. Keep the other
                # successful side for the next bounded attempt; no provider body.
                result = {
                    "status": "unreadable",
                    "text": "",
                    "disclosures": [],
                    "complete": False,
                }
            if (
                prior
                and prior.get("sha256") == row.sha256
                and prior.get("status") == "partial"
                and prior.get("text")
                and (result["status"] == "unreadable" or not result.get("text"))
            ):
                result = {
                    **prior,
                    "status": "partial",
                    "partial_reasons": sorted(
                        set(prior.get("partial_reasons", []) + ["retry_failed"])
                    ),
                }
            sides.append({"side": side, "sha256": row.sha256, **result})
    quotes = [
        (side["side"], q)
        for side in sides
        for q in side["disclosures"]
        if q["payer_text"]
    ]
    payers = [
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
        for side, quote in quotes
    ]
    # A candidate's public records remain under that candidate; they never
    # establish that account paid for this piece. Bound distinct record reads.
    records = {}
    records_retry_needed = False
    failed_record_numbers = set()
    for payer in payers:
        for candidate in payer["candidates"] + payer["related_records"]:
            number = candidate["registration_number"]
            if number not in records and len(records) < 3:
                try:
                    records[number] = public_records(number, submission.saved_at.year)
                except Exception:
                    records_retry_needed = True
                    failed_record_numbers.add(number)
                    records[number] = {
                        "state": "unavailable",
                        "registration_number": number,
                    }
            current_records = records.get(
                number, {"state": "not_loaded", "registration_number": number}
            )
            if number in failed_record_numbers:
                # Keep evidence only under the same printed payer and candidate
                # identity. Its original fetch date and source snapshot stay intact.
                for prior_payer in (
                    (previous.result or {}).get("payers", []) if previous else []
                ):
                    if (prior_payer.get("side"), prior_payer.get("payer_text")) != (
                        payer["side"],
                        payer["payer_text"],
                    ):
                        continue
                    for prior_candidate in prior_payer.get(
                        "candidates", []
                    ) + prior_payer.get("related_records", []):
                        identity = ("registration_number", "scope", "source_url")
                        prior_records = prior_candidate.get("records", {})
                        if (
                            all(
                                prior_candidate.get(key) == candidate.get(key)
                                for key in identity
                            )
                            and prior_records.get("state") == "available"
                            and prior_records.get("year") == submission.saved_at.year
                        ):
                            current_records = {**prior_records, "refresh_failed": True}
                            break
            candidate["records"] = current_records
    return {
        "version": VERSION,
        "records_retry_needed": records_retry_needed,
        "sides": sides,
        "payers": payers,
        "payer_status": "matched"
        if len(payers) == 1 and payers[0]["official_organization"]
        else ("uncertain" if payers else "not_found"),
    }


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
            return
        row.status, row.started_at, row.attempts = "processing", now, row.attempts + 1
        submission_id, attempt = row.submission_id, row.attempts
        db.commit()
        try:
            result = analyze(db, submission_id)
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


@asynccontextmanager
async def mail_analysis_lifespan(app):
    stop = asyncio.Event()

    async def run():
        if os.getenv("ALETHICAL_MAIL_ANALYSIS_ENABLED", "").lower() == "true":
            try:
                await asyncio.to_thread(require_ocr_runtime)
            except Exception:
                logger.error("Mail analysis OCR unavailable; queue remains unclaimed")
                return
            logger.info("Mail analysis OCR ready: tesseract and English data available")
        while not stop.is_set():
            image_gate = getattr(app.state, "mail_upload_image_gate", None)
            upload_busy = image_gate is not None and image_gate.locked()
            if (
                os.getenv("ALETHICAL_MAIL_ANALYSIS_ENABLED", "").lower() == "true"
                and not upload_busy
            ):
                try:
                    await asyncio.to_thread(drain_once)
                except Exception:
                    logger.warning("Mail analysis worker unavailable")
            try:
                await asyncio.wait_for(stop.wait(), timeout=5)
            except TimeoutError:
                pass

    task = asyncio.create_task(run())
    try:
        yield
    finally:
        stop.set()
        await task


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
