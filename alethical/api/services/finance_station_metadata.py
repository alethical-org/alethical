"""Year-scoped archive coverage, using held source paths and exact versions."""

from __future__ import annotations

import re
from collections import defaultdict

from sqlalchemy import select, tuple_

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
    file_id = observation.details["file_id"].astext
    for row in db.scalars(
        select(observation)
        .where(
            observation.facility_id == facility,
            observation.kind == "file",
            file_id.is_not(None),
            observation.status.in_(("stored", "failed", "unavailable")),
        )
        .distinct(file_id)
        .order_by(file_id, observation.observed_at.desc(), observation.scan_id.desc())
    ):
        if row.status in {"failed", "unavailable"}:
            path = row.details.get("folder_path")
            years[_year(path)]["download_failures"] += 1
    # Each folder's newest status comes from the station folder index alone; a
    # whole row per observation fetched about 54,000 rows for KSTP-TV's 229
    # folders and took 11 s. Only a failed folder needs its path.
    latest_folders = db.execute(
        select(observation.url, observation.scan_id, observation.status)
        .where(observation.facility_id == facility, observation.kind == "folder")
        .distinct(observation.url)
        .order_by(
            observation.url, observation.observed_at.desc(), observation.scan_id.desc()
        )
    ).all()
    failed = [(scan, url) for url, scan, status in latest_folders if status == "failed"]
    if failed:
        for details in db.scalars(
            select(observation.details).where(
                tuple_(observation.scan_id, observation.url).in_(failed)
            )
        ):
            years[_year(details.get("path"))]["folder_failures"] += 1
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
