"""Year-scoped archive coverage, using held source paths and exact versions."""

from __future__ import annotations

import re
from collections import defaultdict

from sqlalchemy import select

from alethical.api.services import tv_ads as reader
from alethical.db import models as m
from alethical.pipeline.fcc_document_text import EXTRACTOR_VERSION

FAILURES = {"partial", "failed", "unreadable", "needs_ocr"}


def _year(path):
    # The archive loader derives FCC document years from this same path segment.
    match = re.search(r"(?:^|/)(20\d{2}|19\d{2})(?:/|$)", path or "")
    return int(match[1]) if match else None


def station_years(db, facility):
    """Do not force a failed, never-saved file into the current year."""
    cache = db.info["tv_projection"]
    docs = list(cache["documents"].values())
    current = list(cache["current"].values())
    years = defaultdict(
        lambda: {
            "station_files_held": 0,
            "unique_file_contents": 0,
            "text_read_failures": 0,
            "download_failures": 0,
            "folder_failures": 0,
        }
    )
    hashes = defaultdict(set)
    for doc in docs:
        hashes[doc.year].add(doc.content_hash)
    for year, contents in hashes.items():
        years[year]["unique_file_contents"] = len(contents)
    contents = {doc.content_hash for doc in current}
    failed = set(
        db.scalars(
            select(m.FCCExtraction.content_hash).where(
                m.FCCExtraction.content_hash.in_(contents),
                m.FCCExtraction.version == EXTRACTOR_VERSION,
                m.FCCExtraction.status.in_(FAILURES),
            )
        )
    )
    failed.update(
        db.scalars(
            select(m.FCCPage.content_hash).where(
                m.FCCPage.content_hash.in_(contents),
                m.FCCPage.version == EXTRACTOR_VERSION,
                m.FCCPage.status.in_(FAILURES),
            )
        )
    )
    for doc in current:
        years[doc.year]["station_files_held"] += 1
        years[doc.year]["text_read_failures"] += doc.content_hash in failed
    observation = m.FCCObservation
    for kind in ("file", "folder"):
        identity = (
            observation.details["file_id"].astext if kind == "file" else observation.url
        )
        query = select(observation).where(
            observation.facility_id == facility, observation.kind == kind
        )
        if kind == "file":
            query = query.where(
                identity.is_not(None),
                observation.status.in_(("stored", "failed", "unavailable")),
            )
        latest = db.scalars(
            query.distinct(identity).order_by(
                identity, observation.observed_at.desc(), observation.scan_id.desc()
            )
        )
        for row in latest:
            if row.status not in (
                {"failed", "unavailable"} if kind == "file" else {"failed"}
            ):
                continue
            path = row.details.get("folder_path" if kind == "file" else "path")
            years[_year(path)][
                "download_failures" if kind == "file" else "folder_failures"
            ] += 1
    dates = defaultdict(list)
    checks = reader._original_checks(db)
    for by_version in checks.values():
        for version, rows in by_version.items():
            doc = cache["documents"].get(version)
            if doc is not None:
                dates[doc.year].extend(
                    row.checked_at for row in rows if row.checked_at is not None
                )
    return {
        year: {
            "counts": values,
            "latest_check_at": reader.iso(max(dates[year])) if dates[year] else None,
        }
        for year, values in years.items()
    }
