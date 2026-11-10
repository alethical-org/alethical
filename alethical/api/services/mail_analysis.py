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
import subprocess
import tempfile
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

from PIL import Image, ImageOps
from sqlalchemy import func, select, text, update
from sqlalchemy.dialects.postgresql import insert

from alethical.api.services import mail_upload
from alethical.api.services.mail_payer_sources import corroborate
from alethical.db import models as m
from alethical.db.session import get_session_factory
from alethical.pipeline.campaign_finance_filings import live_filings_snapshot

logger = logging.getLogger(__name__)
VERSION = "tesseract-english-v1"
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


def read_image(path: Path) -> dict:
    """Bound work and memory; preserve original file, including its metadata."""
    best = None
    with Image.open(path) as original:
        original.draft("RGB", (4000, 4000))
        picture = ImageOps.exif_transpose(original)
        picture.thumbnail((4000, 4000))
        picture = picture.convert("RGB")
    with tempfile.TemporaryDirectory(prefix="mail-ocr-") as folder:
        for angle in (0, 90, 180, 270):
            rotated = picture.rotate(angle, expand=True)
            source = Path(folder) / "page.png"
            rotated.save(source)
            raw = subprocess.run(
                [
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
                timeout=25,
                check=True,
                env={**os.environ, "OMP_THREAD_LIMIT": "1"},
            ).stdout.decode("utf-8", errors="replace")
            grouped = {}
            for word in csv.DictReader(
                io.StringIO(raw), delimiter="\t", quoting=csv.QUOTE_NONE
            ):
                value = word.get("text", "").strip()
                confidence = float(word.get("conf", "-1"))
                if not value or confidence < 0:
                    continue
                key = tuple(word[name] for name in ("block_num", "par_num", "line_num"))
                x, y, w, h = (
                    int(word[name]) for name in ("left", "top", "width", "height")
                )
                grouped.setdefault(key, []).append(
                    (value, confidence, x, y, x + w, y + h)
                )
            lines = [
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
            quotes = disclosures(lines, *rotated.size)
            # Sparse OCR interleaves neighboring columns. Re-read only the
            # disclosure's own column so wrapped payer names stay in order.
            for line in lines:
                if not PAYER.search(line["text"]) and re.search(
                    r"independent expenditure|prepared and|for by", line["text"], re.I
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
            for quote in quotes:
                x1, y1, x2, y2 = quote["box"]
                pad = max(12, (y2 - y1) // 2)
                region = (
                    max(0, x1 - pad),
                    max(0, y1 - pad),
                    min(rotated.width, x2 + pad),
                    min(rotated.height, y2 + 4 * (y2 - y1)),
                )
                crop = Path(folder) / "disclosure.png"
                rotated.crop(region).save(crop)
                refined = (
                    subprocess.run(
                        [
                            "tesseract",
                            str(crop.resolve()),
                            "stdout",
                            "-l",
                            "eng",
                            "--psm",
                            "6",
                        ],
                        capture_output=True,
                        timeout=10,
                        check=True,
                        env={**os.environ, "OMP_THREAD_LIMIT": "1"},
                    )
                    .stdout.decode("utf-8", errors="replace")
                    .strip()
                )
                flattened = " ".join(refined.split())
                match = PAYER.search(flattened)
                if match:
                    # Preserve the full machine quote; punctuation marks the end
                    # of the printed name. Never complete words from a registry.
                    quote["quote"] = refined
                    quote["payer_text"] = re.split(
                        r"[.;]|,?\s+https?://|,?\s+P\.?O\.?\s+Box\b|,\s+\d|\s+not\s+authorized",
                        match.group(1),
                        maxsplit=1,
                        flags=re.I,
                    )[0].strip()
            quotes = [quote for quote in quotes if quote["payer_text"]]
            readable = [line for line in lines if line["confidence"] >= 60]
            score = sum(len(line["text"]) for line in readable) + 1000 * len(quotes)
            result = {
                "status": "read" if readable else "unreadable",
                "text": "\n".join(line["text"] for line in lines)[:60000],
                "disclosures": quotes,
                "rotation": angle,
                "width": rotated.width,
                "height": rotated.height,
                "complete": False,
            }
            if best is None or score > best[0]:
                best = (score, result)
            # A useful upright read needs no speculative rotations. Completeness
            # is still unknown, even when every recognized word is confident.
            if quotes and readable and all(q["confidence"] >= 70 for q in quotes):
                break
    return best[1]


def candidate_records(db, payer: str) -> list[dict]:
    snapshot = live_filings_snapshot(db)
    if snapshot is None:
        return []
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
            "source_url": "https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/",
        }
        for row in rows
    ]


def analyze(db, submission_id) -> dict:
    submission = db.get(m.MailUploadSubmission, submission_id)
    images = mail_upload.selected_images(db, submission)
    primary, _ = mail_upload.stores()
    sides = []
    with tempfile.TemporaryDirectory(prefix="mail-analysis-") as folder:
        for side in ("front", "back"):
            row = images.get(side)
            if row is None or row.verified_at is None:
                raise ValueError("Unverified image")
            path = Path(folder) / side
            primary.get(row.object_key, path, max_bytes=mail_upload.MAX_IMAGE_BYTES)
            if hashlib.sha256(path.read_bytes()).hexdigest() != row.sha256:
                raise ValueError("Image verification failed")
            try:
                result = read_image(path)
            except (subprocess.SubprocessError, OSError, ValueError):
                result = {
                    "status": "unreadable",
                    "text": "",
                    "disclosures": [],
                    "complete": False,
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
            "official_organization": corroborate(
                quote["payer_text"],
                quote["quote"],
                edge_warning=quote["edge_warning"],
                confidence=quote["confidence"],
            ),
        }
        for side, quote in quotes
    ]
    return {
        "version": VERSION,
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
            .order_by(m.MailUploadAnalysis.submission_id)
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
                if any(side["status"] == "unreadable" for side in result["sides"])
                else "ready"
            )
        except Exception:
            db.rollback()
            result = None
            status = "failed" if attempt >= 3 else "pending"
            logger.warning("Mail analysis attempt failed; private originals retained")
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
    # Exact-pair count is explicitly scoped to the same photos. It does not
    # establish creative identity across recaptures, distinct people or reach.
    images = mail_upload.selected_images(db, submission)
    hashes = {image.sha256 for image in images.values()}
    matching = (
        select(m.MailUploadImage.submission_id)
        .join(
            m.MailUploadSubmission,
            m.MailUploadSubmission.id == m.MailUploadImage.submission_id,
        )
        .where(
            m.MailUploadSubmission.saved_at.is_not(None),
            m.MailUploadImage.selected.is_(True),
            m.MailUploadImage.sha256.in_(hashes),
        )
        .group_by(m.MailUploadImage.submission_id)
        .having(
            func.count() == 2,
            func.count(func.distinct(m.MailUploadImage.sha256)) == len(hashes),
        )
        .subquery()
    )
    count = (
        db.scalar(select(func.count()).select_from(matching))
        if len(images) == 2
        else None
    )

    return {
        "data": {
            **row.result,
            "status": row.status,
            "can_retry": row.status in {"failed", "partial"} and row.attempts < 3,
            "matching_mailers": {
                "count": count,
                "basis": "same_photo_pair" if count is not None else None,
            },
            "confirmed_entity_id": str(row.confirmed_entity_id)
            if row.confirmed_entity_id
            else None,
            "confirmation_evidence": row.confirmation_evidence,
        }
    }


@asynccontextmanager
async def mail_analysis_lifespan(app):
    stop = asyncio.Event()

    async def run():
        while not stop.is_set():
            if os.getenv("ALETHICAL_MAIL_ANALYSIS_ENABLED", "").lower() == "true":
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
