"""Source-wide itemized independent spending, without candidate attribution.

The Board's bulk file supplies a reported year, not a primary/general election
stage. Every row remains in this inventory regardless of whether its target is
blank, negative, registered today, or linked to a person. Dates and unpaid amounts
keep their own meaning; unpaid is already part of the reported amount.
"""

from __future__ import annotations

from decimal import Decimal
import gzip
import hashlib
from pathlib import Path
import tempfile
from typing import NoReturn
from uuid import UUID

from sqlalchemy import case, extract, func, select
from sqlalchemy.orm import Session

from alethical.api.problems import problem_exception
from alethical.api.services import committee_finance, finance_versions
from alethical.api.services.election_comparison_reads import snapshot
from alethical.db import models as m
from alethical.pipeline import campaign_finance_reader as reader
from alethical.pipeline.campaign_finance import INDEPENDENT_COLUMNS
from alethical.pipeline.raw_file_store import raw_file_store_from_env

R = m.CampaignFinanceIndependentExpenditureRow
DATASET = m.CampaignFinanceDataset.independent_expenditures
SCOPE_NOTE = (
    "Available itemized independent spending for the source's reported calendar year; "
    "the file does not distinguish primary from general election spending"
)
SOURCE_COLUMNS = {column.source: column.attribute for column in INDEPENDENT_COLUMNS}


def _unavailable() -> NoReturn:
    raise problem_exception(
        503, "Service Unavailable", "These spending records are unavailable. Try again."
    )


def _changed() -> NoReturn:
    raise problem_exception(
        409,
        "Records Changed",
        "The spending records changed. Reload before continuing.",
        type_slug="records-changed",
    )


def _money(value: Decimal | None) -> str | None:
    return format(value, "f") if value is not None else None


def _direction():
    # Same case-insensitive source words as independent_spending.py. Unknown
    # spellings remain a third group rather than disappearing or being guessed.
    return case(
        (func.lower(R.for_against) == "for", "For"),
        (func.lower(R.for_against) == "against", "Against"),
        else_="unknown",
    )


def _category():
    return case(
        (R.spender_type == "PCF", "PCF"),
        (R.spender_type == "PTU", "PTU"),
        else_="other",
    )


def _measure_columns():
    return (
        func.count().label("record_count"),
        func.sum(R.amount).label("amount_sum"),
        func.count().filter(R.amount.is_(None)).label("missing_amount_count"),
        func.sum(R.unpaid_amount).label("unpaid_sum"),
        func.count().filter(R.unpaid_amount.is_(None)).label("missing_unpaid_count"),
        func.count().filter(R.transaction_date.is_(None)).label("missing_date_count"),
        func.count().filter(R.year.is_(None)).label("missing_year_count"),
        func.count()
        .filter(
            R.year.is_not(None),
            R.transaction_date.is_not(None),
            R.year != extract("year", R.transaction_date),
        )
        .label("date_year_conflict_count"),
        func.min(R.transaction_date).label("first_known_date"),
        func.max(R.transaction_date).label("last_known_date"),
    )


def _measures(row) -> dict:
    count = row["record_count"]
    missing = row["missing_amount_count"]
    state = (
        "no_records" if count == 0 else "amount_unavailable" if missing else "reported"
    )
    return {
        "state": state,
        "record_count": count,
        "amount": _money(row["amount_sum"]) if state == "reported" else None,
        "known_amount_subtotal": _money(row["amount_sum"]),
        "missing_amount_count": missing,
        "included_unpaid_amount": _money(row["unpaid_sum"])
        if count and not row["missing_unpaid_count"]
        else None,
        "known_unpaid_subtotal": _money(row["unpaid_sum"]),
        "missing_unpaid_count": row["missing_unpaid_count"],
        "missing_date_count": row["missing_date_count"],
        "missing_year_count": row["missing_year_count"],
        "date_year_conflict_count": row["date_year_conflict_count"],
        "date_coverage": "no_records"
        if not count
        else "incomplete"
        if row["missing_date_count"]
        else "dates_present",
        "first_known_date": row["first_known_date"].isoformat()
        if row["first_known_date"]
        else None,
        "last_known_date": row["last_known_date"].isoformat()
        if row["last_known_date"]
        else None,
    }


def _aggregate(db: Session, *filters) -> dict:
    return _measures(
        db.execute(select(*_measure_columns()).where(*filters)).mappings().one()
    )


def _context(
    db: Session,
    *,
    election_key: str,
    election_snapshot_id: str | None,
    version: str | None,
    release_id: UUID | None,
) -> tuple[dict, reader.Release]:
    election = snapshot(db, election_key, election_snapshot_id)
    token = finance_versions.check(db, version, "money")
    try:
        release = committee_finance.current_release(db)
    except reader.ReleaseNoLongerHeld as error:
        raise problem_exception(
            503,
            "Service Unavailable",
            "These spending records are unavailable. Try again.",
        ) from error
    if release is None:
        _unavailable()
    if release_id is not None and release.id != release_id:
        _changed()
    source = release.independent_expenditures
    held_count = db.scalar(
        select(func.count()).select_from(R).where(R.snapshot_id == source.snapshot_id)
    )
    if held_count != source.row_count:
        # The existing reader rejects a wholly pruned source. This count also
        # rejects a partially lost current file before serving plausible totals.
        _unavailable()
    original = db.get(m.CampaignFinanceSnapshot, source.snapshot_id)
    if original is None:
        _unavailable()
    copied = release.copied_at(DATASET)
    return {
        "election_key": election_key,
        "election_snapshot_id": election.id,
        "reported_year": election.election_date.year,
        "year_basis": "source_reported_calendar_year",
        "election_stage_available": False,
        "scope_note": SCOPE_NOTE,
        "complete_election_spending": False,
        "candidate_attribution": "not_attributed",
        "currency": "USD",
        "version": token,
        "release_id": str(release.id),
        "source": {
            "snapshot_id": str(source.snapshot_id),
            "content_hash": original.content_hash,
            "record_set_hash": original.record_set_hash,
            "source_url": source.source_url,
            "copied_at": copied.isoformat() if copied else None,
            "row_count": source.row_count,
            "record_number_basis": "1-based CSV record, not physical line",
        },
    }, release


def source_body(
    db: Session,
    *,
    election_key,
    election_snapshot_id,
    version,
    release_id,
    source_hash=None,
):
    """Return the exact published CSV, not a newly ordered vendor download."""
    context, release = _context(
        db,
        election_key=election_key,
        election_snapshot_id=election_snapshot_id,
        version=version,
        release_id=release_id,
    )
    original = db.get(
        m.CampaignFinanceSnapshot, release.independent_expenditures.snapshot_id
    )
    if original is None:
        _unavailable()
    if source_hash is not None and source_hash != original.content_hash:
        _changed()
    retained = db.get(m.CampaignFinanceSnapshotBody, original.id)
    if retained is None or retained.compression != "gzip":
        _unavailable()
    try:
        with tempfile.TemporaryDirectory(
            prefix="election-spending-source-"
        ) as directory:
            path = Path(directory) / "source.csv.gz"
            raw_file_store_from_env().get(
                retained.object_key, str(path), max_bytes=retained.compressed_byte_size
            )
            compressed = path.read_bytes()
            if (
                len(compressed) != retained.compressed_byte_size
                or hashlib.sha256(compressed).hexdigest() != retained.compressed_hash
            ):
                _unavailable()
            with gzip.open(path, "rb") as handle:
                body = handle.read(original.byte_size + 1)
        if (
            len(body) != original.byte_size
            or hashlib.sha256(body).hexdigest() != original.content_hash
        ):
            _unavailable()
    except Exception as error:
        raise problem_exception(
            503,
            "Service Unavailable",
            "This retained source is unavailable. Try again.",
        ) from error
    finance_versions.check(db, context["version"], "money")
    return body


def _filters(
    *,
    snapshot_id: UUID,
    year: int,
    scope: str,
    spender_type: str | None,
    direction: str | None,
    spender_registration: str | None,
    target_registration: str | None,
) -> list:
    filters = [
        R.snapshot_id == snapshot_id,
        R.year.is_(None) if scope == "missing_year" else R.year == year,
    ]
    if spender_type is not None:
        filters.append(_category() == spender_type)
    if direction is not None:
        filters.append(_direction() == direction)
    if spender_registration is not None:
        filters.append(R.spender_reg_num == spender_registration)
    if target_registration is not None:
        filters.append(R.affected_committee_reg_num == target_registration)
    return filters


def summary(
    db: Session,
    *,
    election_key: str,
    election_snapshot_id: str | None = None,
    version: str | None = None,
    release_id: UUID | None = None,
    spender_type: str | None = None,
    direction: str | None = None,
    spender_registration: str | None = None,
    target_registration: str | None = None,
) -> dict:
    context, release = _context(
        db,
        election_key=election_key,
        election_snapshot_id=election_snapshot_id,
        version=version,
        release_id=release_id,
    )
    source_filter = R.snapshot_id == release.independent_expenditures.snapshot_id
    year = context["reported_year"]
    inventory = {
        "all_source_records": _aggregate(db, source_filter),
        "reported_year": _aggregate(db, source_filter, R.year == year),
        "missing_year": _aggregate(db, source_filter, R.year.is_(None)),
        "other_years": _aggregate(
            db, source_filter, R.year.is_not(None), R.year != year
        ),
    }
    if (
        sum(
            inventory[k]["record_count"]
            for k in ("reported_year", "missing_year", "other_years")
        )
        != inventory["all_source_records"]["record_count"]
    ):
        _unavailable()
    filters = _filters(
        snapshot_id=release.independent_expenditures.snapshot_id,
        year=year,
        scope="year",
        spender_type=spender_type,
        direction=direction,
        spender_registration=spender_registration,
        target_registration=target_registration,
    )
    direction_column, category_column = _direction(), _category()
    groups = (
        db.execute(
            select(
                R.spender_type,
                R.spender_sub_type,
                direction_column.label("direction"),
                *_measure_columns(),
            )
            .where(*filters)
            .group_by(R.spender_type, R.spender_sub_type, direction_column)
            .order_by(
                R.spender_type.nulls_last(),
                R.spender_sub_type.nulls_last(),
                direction_column,
            )
        )
        .mappings()
        .all()
    )
    categories = (
        db.execute(
            select(
                category_column.label("category"),
                direction_column.label("direction"),
                *_measure_columns(),
            )
            .where(*filters)
            .group_by(category_column, direction_column)
            .order_by(category_column, direction_column)
        )
        .mappings()
        .all()
    )
    return {
        **context,
        "inventory": inventory,
        "filters": {
            "spender_type": spender_type,
            "direction": direction,
            "spender_registration": spender_registration,
            "target_registration": target_registration,
        },
        "filtered_total": _aggregate(db, *filters),
        "category_totals": [
            {
                "category": row["category"],
                "direction": row["direction"],
                **_measures(row),
            }
            for row in categories
        ],
        "groups": [
            {
                "spender_type": row["spender_type"],
                "spender_sub_type": row["spender_sub_type"],
                "direction": row["direction"],
                **_measures(row),
            }
            for row in groups
        ],
        "definitions": {
            "PCF": "Political committees and funds",
            "PTU": "Party units",
            "other": "Other or missing source filer type",
            "unknown": "Direction not recorded as For or Against",
            "unpaid": "Unpaid amounts are included in reported amounts, not added again",
            "missing_year": "Source rows with no reported year are not assigned to this election year",
        },
    }


def _record(row: m.CampaignFinanceIndependentExpenditureRow) -> dict:
    values = {}
    for label, attribute in SOURCE_COLUMNS.items():
        value = getattr(row, attribute)
        if isinstance(value, Decimal):
            value = _money(value)
        elif attribute == "transaction_date" and value is not None:
            value = value.isoformat()
        values[label] = value
    return {
        "row_number": row.row_number,
        "resolution": "not_attributed",
        "fields": values,
    }


def records(
    db: Session,
    *,
    election_key: str,
    election_snapshot_id: str | None,
    version: str,
    release_id: UUID,
    scope: str,
    spender_type: str | None,
    direction: str | None,
    spender_registration: str | None,
    target_registration: str | None,
    limit: int,
    offset: int,
) -> dict:
    context, release = _context(
        db,
        election_key=election_key,
        election_snapshot_id=election_snapshot_id,
        version=version,
        release_id=release_id,
    )
    filters = _filters(
        snapshot_id=release.independent_expenditures.snapshot_id,
        year=context["reported_year"],
        scope=scope,
        spender_type=spender_type,
        direction=direction,
        spender_registration=spender_registration,
        target_registration=target_registration,
    )
    total = db.execute(select(func.count()).select_from(R).where(*filters)).scalar_one()
    rows = db.scalars(
        select(R).where(*filters).order_by(R.row_number).offset(offset).limit(limit)
    ).all()
    return {
        **context,
        "scope": scope,
        "rows": [_record(row) for row in rows],
        "page": {
            "total": total,
            "offset": offset,
            "limit": limit,
            "has_more": offset + len(rows) < total,
        },
    }
