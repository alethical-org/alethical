"""Current registrations and dated spending, read from one published pair.

The number joins records; names remain exactly as filed. No amount is summed across
rows, years, principals or committees. Explicit projections keep contact fields out
of both the response and the objects used to prepare it.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import String, cast, func, or_, select, text, union_all
from sqlalchemy.orm import Session

from alethical.api.services.campaign_finance_register import name_contains
from alethical.api.services.committee_finance import current_release
from alethical.db import models as schema
from alethical.pipeline.campaign_finance_reader import (
    ReleaseNoLongerHeld,
    _refuse_if_rows_are_gone,
)

REPORTED = "reported"
NOT_REPORTED = "not_reported"
UNAVAILABLE = "unavailable"
MAX_LIST_ROWS = 50
MONEY_COLUMNS = (
    "puc_lobbying_amount",
    "legislative_lobbying_amount",
    "administrative_lobbying_amount",
    "mgu_lobbying_amount",
    "general_lobbying_amount",
    "total_spent",
)


@dataclass(frozen=True)
class PublishedPair:
    id: UUID
    expenditure_snapshot_id: UUID
    lobbyist_snapshot_id: UUID
    copied_at: datetime
    expenditure_source_url: str
    lobbyist_source_url: str


def published_pair(db: Session) -> PublishedPair | None:
    """Resolve the pair once; reject pruned copies instead of claiming an absence."""
    release = schema.LobbyingRelease
    spending = schema.LobbyingExpenditureSnapshot
    active = schema.LobbyistSnapshot
    row = db.execute(
        select(release, spending, active)
        .join(
            schema.LobbyingCurrentRelease,
            schema.LobbyingCurrentRelease.release_id == release.id,
        )
        .join(spending, spending.id == release.expenditure_snapshot_id)
        .join(active, active.id == release.lobbyist_snapshot_id)
        .where(schema.LobbyingCurrentRelease.id.is_(True))
    ).one_or_none()
    if row is None:
        return None
    release_row, spending_row, active_row = row
    loaded = schema.CampaignFinanceSnapshotStatus.loaded
    if spending_row.status != loaded or active_row.status != loaded:
        return None
    for model, snapshot in (
        (schema.LobbyingExpenditureRow, spending_row),
        (schema.LobbyistRow, active_row),
    ):
        held = db.scalar(
            select(func.count())
            .select_from(model)
            .where(model.snapshot_id == snapshot.id)
        )
        if snapshot.row_count is None or held != snapshot.row_count:
            return None
    associations_held = db.scalar(
        select(func.count())
        .select_from(schema.LobbyistAssociation)
        .where(schema.LobbyistAssociation.snapshot_id == active_row.id)
    )
    if associations_held != active_row.association_count:
        return None
    return PublishedPair(
        id=release_row.id,
        expenditure_snapshot_id=spending_row.id,
        lobbyist_snapshot_id=active_row.id,
        copied_at=release_row.copied_at,
        expenditure_source_url=spending_row.source_url,
        lobbyist_source_url=active_row.source_url,
    )


def _stamp(pair: PublishedPair | None) -> dict:
    return {
        "release_id": str(pair.id) if pair else None,
        "copied_at": pair.copied_at if pair else None,
        "sources": {
            "expenditures": pair.expenditure_source_url if pair else None,
            "lobbyists": pair.lobbyist_source_url if pair else None,
        },
    }


def _latest_year(
    db: Session, pair: PublishedPair, entity_id: int | None = None
) -> int | None:
    row = schema.LobbyingExpenditureRow
    return db.scalar(
        select(func.max(row.report_year)).where(
            row.snapshot_id == pair.expenditure_snapshot_id,
            or_(*(getattr(row, name).is_not(None) for name in MONEY_COLUMNS)),
            *((row.entity_id == str(entity_id),) if entity_id is not None else ()),
        )
    )


def _principal_names(pair: PublishedPair):
    """One ID, the newest spending name, or an as-filed list name if unresolved."""
    spending = schema.LobbyingExpenditureRow
    association = schema.LobbyistAssociation
    choices = union_all(
        select(
            spending.entity_id.label("entity_id"),
            spending.principal.label("name"),
            spending.report_year.label("year"),
            spending.row_number.label("position"),
            cast(0, String).label("source"),
        ).where(
            spending.snapshot_id == pair.expenditure_snapshot_id,
            spending.entity_id.is_not(None),
        ),
        select(
            cast(association.entity_id, String).label("entity_id"),
            association.principal_name.label("name"),
            cast(None, schema.LobbyingExpenditureRow.report_year.type).label("year"),
            association.position.label("position"),
            cast(1, String).label("source"),
        ).where(association.snapshot_id == pair.lobbyist_snapshot_id),
    ).subquery()
    ranked = select(
        choices,
        func.row_number()
        .over(
            partition_by=choices.c.entity_id,
            order_by=(
                choices.c.source,
                choices.c.year.desc().nulls_last(),
                choices.c.position.desc(),
                choices.c.name,
            ),
        )
        .label("choice"),
    ).subquery()
    latest = (
        select(func.max(spending.report_year))
        .where(
            spending.snapshot_id == pair.expenditure_snapshot_id,
            spending.entity_id == ranked.c.entity_id,
            or_(*(getattr(spending, name).is_not(None) for name in MONEY_COLUMNS)),
        )
        .scalar_subquery()
    )
    return (
        select(
            ranked.c.entity_id,
            ranked.c.name,
            ranked.c.source,
            latest.label("latest_reported_year"),
        )
        .where(ranked.c.choice == 1)
        .subquery()
    )


def principals_page(
    db: Session, pair: PublishedPair | None, *, limit: int, offset: int, query: str = ""
) -> dict:
    base = {
        **_stamp(pair),
        "limit": limit,
        "offset": offset,
        "q": query,
        "matched_on": "substring_of_the_filed_name",
    }
    if pair is None:
        return {
            **base,
            "state": UNAVAILABLE,
            "principals": [],
            "total": None,
            "has_more": False,
            "latest_reported_year": None,
        }
    names = _principal_names(pair)
    where = (name_contains(names.c.name, query.strip()),) if query.strip() else ()
    total = db.scalar(select(func.count()).select_from(names).where(*where))
    rows = db.execute(
        select(names)
        .where(*where)
        .order_by(names.c.name, names.c.entity_id)
        .limit(limit)
        .offset(offset)
    ).all()
    return {
        **base,
        "state": REPORTED if total else NOT_REPORTED,
        "total": total,
        "has_more": offset + len(rows) < total,
        "latest_reported_year": _latest_year(db, pair),
        "principals": [
            {
                "entity_id": int(row.entity_id),
                "name": row.name,
                "state": REPORTED if row.source == "0" else "no_spending_rows",
                "linkable": row.source == "0",
                "latest_reported_year": row.latest_reported_year,
            }
            for row in rows
        ],
    }


def lobbyists_page(
    db: Session, pair: PublishedPair | None, *, limit: int, offset: int, query: str = ""
) -> dict:
    base = {
        **_stamp(pair),
        "limit": limit,
        "offset": offset,
        "q": query,
        "matched_on": "substring_of_the_filed_name",
    }
    if pair is None:
        return {
            **base,
            "state": UNAVAILABLE,
            "lobbyists": [],
            "total": None,
            "has_more": False,
        }
    lobbyist = schema.LobbyistRow
    association = schema.LobbyistAssociation
    where = [lobbyist.snapshot_id == pair.lobbyist_snapshot_id]
    if query.strip():
        where.append(name_contains(lobbyist.name, query.strip()))
    total = db.scalar(select(func.count()).select_from(lobbyist).where(*where))
    counts = (
        select(func.count(func.distinct(association.entity_id)))
        .where(
            association.snapshot_id == pair.lobbyist_snapshot_id,
            association.registration_number == lobbyist.registration_number,
        )
        .scalar_subquery()
    )
    rows = db.execute(
        select(
            lobbyist.registration_number,
            lobbyist.name,
            lobbyist.formatted_name,
            counts.label("principal_count"),
        )
        .where(*where)
        .order_by(lobbyist.name, lobbyist.registration_number)
        .limit(limit)
        .offset(offset)
    ).all()
    return {
        **base,
        "state": REPORTED if total else NOT_REPORTED,
        "total": total,
        "has_more": offset + len(rows) < total,
        "lobbyists": [dict(row._mapping) for row in rows],
    }


def summary(db: Session, pair: PublishedPair | None) -> dict:
    base = _stamp(pair)
    if pair is None:
        return {
            **base,
            "state": UNAVAILABLE,
            "registered_lobbyists": None,
            "principals_reporting": None,
            "latest_reported_year": None,
            "first_year": None,
            "last_year": None,
        }
    latest = _latest_year(db, pair)
    row = schema.LobbyingExpenditureRow
    principals = (
        db.scalar(
            select(func.count(func.distinct(row.entity_id))).where(
                row.snapshot_id == pair.expenditure_snapshot_id,
                row.report_year == latest,
                or_(*(getattr(row, name).is_not(None) for name in MONEY_COLUMNS)),
            )
        )
        if latest is not None
        else 0
    )
    lobbyists = db.scalar(
        select(func.count(func.distinct(schema.LobbyistRow.registration_number))).where(
            schema.LobbyistRow.snapshot_id == pair.lobbyist_snapshot_id
        )
    )
    first_year, last_year = db.execute(
        select(func.min(row.report_year), func.max(row.report_year)).where(
            row.snapshot_id == pair.expenditure_snapshot_id
        )
    ).one()
    return {
        **base,
        "first_year": first_year,
        "last_year": last_year,
        "state": REPORTED,
        "registered_lobbyists": lobbyists,
        "principals_reporting": principals,
        "latest_reported_year": latest,
    }


def principal(db: Session, pair: PublishedPair | None, entity_id: int) -> dict:
    base = {**_stamp(pair), "entity_id": entity_id}
    if pair is None:
        return {
            **base,
            "state": UNAVAILABLE,
            "name": None,
            "latest_reported_year": None,
            "source_latest_year": None,
            "spending": {"state": UNAVAILABLE, "rows": []},
            "lobbyists": {"state": UNAVAILABLE, "rows": [], "total": None},
        }
    row = schema.LobbyingExpenditureRow
    spending = db.execute(
        select(
            row.principal,
            row.report_year,
            row.row_number,
            *(getattr(row, name) for name in MONEY_COLUMNS),
        )
        .where(
            row.snapshot_id == pair.expenditure_snapshot_id,
            row.entity_id == str(entity_id),
        )
        .order_by(row.report_year.desc().nulls_last(), row.row_number.desc())
    ).all()
    association = schema.LobbyistAssociation
    lobbyist = schema.LobbyistRow
    registered = db.execute(
        select(
            lobbyist.registration_number,
            lobbyist.name,
            lobbyist.formatted_name,
            association.principal_name,
        )
        .join(
            association,
            (association.snapshot_id == lobbyist.snapshot_id)
            & (association.registration_number == lobbyist.registration_number),
        )
        .where(
            lobbyist.snapshot_id == pair.lobbyist_snapshot_id,
            association.entity_id == entity_id,
        )
        .distinct()
        .order_by(
            lobbyist.name, lobbyist.registration_number, association.principal_name
        )
    ).all()
    name = spending[0].principal if spending else None
    return {
        **base,
        "state": REPORTED if spending else "no_spending_rows",
        "name": name,
        "latest_reported_year": _latest_year(db, pair, entity_id),
        "source_latest_year": _latest_year(db, pair),
        "spending": {
            "state": REPORTED if spending else "no_spending_rows",
            "rows": [
                {
                    "year": item.report_year,
                    "record_number": item.row_number,
                    **{
                        key: str(getattr(item, key))
                        if getattr(item, key) is not None
                        else None
                        for key in MONEY_COLUMNS
                    },
                }
                for item in spending
            ],
        },
        "lobbyists": {
            "state": REPORTED if registered else NOT_REPORTED,
            "total": len({item.registration_number for item in registered}),
            "rows": [
                {
                    "registration_number": item.registration_number,
                    "name": item.name,
                    "formatted_name": item.formatted_name,
                    "principal_name_as_listed": item.principal_name,
                    "principal_name_differs": name is not None
                    and item.principal_name != name,
                }
                for item in registered
            ],
        },
    }


def _contributions(db: Session, registration_number: str) -> dict:
    try:
        release = current_release(db)
    except ReleaseNoLongerHeld:
        release = None
    if release is None:
        return {
            "state": UNAVAILABLE,
            "years": [],
            "payment_count": None,
            "committee_count": None,
            "release_id": None,
            "copied_at": None,
            "source_url": None,
        }
    row = schema.CampaignFinanceContributionRow
    columns = (
        "row_number",
        "recipient_reg_num",
        "recipient",
        "recipient_type",
        "contributor",
        "contrib_employer_name",
        "amount",
        "receipt_date",
        "year",
        "in_kind",
        "in_kind_descr",
    )
    rows = db.execute(
        select(*(getattr(row, column) for column in columns))
        .where(
            row.snapshot_id == release.contributions.snapshot_id,
            row.contrib_reg_num == registration_number,
            row.contrib_type == "Lobbyist",
            row.receipt_type == "Contribution",
        )
        .order_by(
            row.year.desc().nulls_last(),
            row.receipt_date.desc().nulls_last(),
            row.row_number.desc(),
        )
    ).all()
    if not rows:
        try:
            _refuse_if_rows_are_gone(
                db, release, schema.CampaignFinanceDataset.contributions
            )
        except ReleaseNoLongerHeld:
            return {
                "state": UNAVAILABLE,
                "years": [],
                "payment_count": None,
                "committee_count": None,
                "release_id": str(release.id),
                "copied_at": release.fetched_at,
                "source_url": release.contributions.source_url,
            }
    numbers = sorted(
        {item.recipient_reg_num for item in rows if item.recipient_reg_num}
    )
    # These numbers are recipients already observed in this pinned contribution
    # snapshot, which proves they have held committee rows. Re-reading all their
    # donations and expenditures to establish that same fact takes seconds.
    linkable = frozenset(numbers)
    kinds = (
        dict(
            db.execute(
                text(
                    "SELECT f.registration_number, f.kind FROM cf_filer f JOIN cf_filing_current c ON c.snapshot_id = f.snapshot_id WHERE c.id = true AND f.registration_number = ANY(:numbers)"
                ),
                {"numbers": numbers},
            ).all()
        )
        if numbers
        else {}
    )
    years: dict[int | None, dict] = {}
    for item in rows:
        year = years.setdefault(
            item.year, {"year": item.year, "payment_count": 0, "committees": {}}
        )
        # A missing number is not an identity shared by every unnamed recipient.
        key = item.recipient_reg_num or (None, item.recipient)
        group = year["committees"].setdefault(
            key,
            {
                "registration_number": item.recipient_reg_num,
                "name": item.recipient,
                "kind": kinds.get(item.recipient_reg_num),
                "recipient_type": item.recipient_type,
                "linkable": item.recipient_reg_num in linkable,
                "payments": [],
                "payment_count": 0,
            },
        )
        group["payments"].append(
            {
                "record_number": item.row_number,
                "contributor_name": item.contributor,
                "employer": item.contrib_employer_name,
                "amount": str(item.amount) if item.amount is not None else None,
                "received_on": item.receipt_date,
                "in_kind": item.in_kind,
                "in_kind_description": item.in_kind_descr,
            }
        )
        group["payment_count"] += 1
        year["payment_count"] += 1
    return {
        "state": REPORTED if rows else NOT_REPORTED,
        "payment_count": len(rows),
        "committee_count": len(numbers),
        "release_id": str(release.id),
        "copied_at": release.fetched_at,
        "source_url": release.contributions.source_url,
        "years": [
            {
                **year,
                "committee_count": len(year["committees"]),
                "committees": list(year["committees"].values()),
            }
            for year in years.values()
        ],
    }


def lobbyist(db: Session, pair: PublishedPair | None, registration_number: str) -> dict:
    base = {**_stamp(pair), "registration_number": registration_number}
    contributions = _contributions(db, registration_number)
    if pair is None:
        return {
            **base,
            "state": UNAVAILABLE,
            "name": None,
            "formatted_name": None,
            "principals": {"state": UNAVAILABLE, "rows": [], "total": None},
            "contributions": contributions,
        }
    row = schema.LobbyistRow
    person = db.execute(
        select(row.name, row.formatted_name).where(
            row.snapshot_id == pair.lobbyist_snapshot_id,
            row.registration_number == registration_number,
        )
    ).one_or_none()
    association = schema.LobbyistAssociation
    spending = schema.LobbyingExpenditureRow
    spending_name = (
        select(spending.principal)
        .where(
            spending.snapshot_id == pair.expenditure_snapshot_id,
            spending.entity_id == cast(association.entity_id, String),
        )
        .order_by(spending.report_year.desc().nulls_last(), spending.row_number.desc())
        .limit(1)
        .scalar_subquery()
    )
    resolves = (
        select(spending.row_number)
        .where(
            spending.snapshot_id == pair.expenditure_snapshot_id,
            spending.entity_id == cast(association.entity_id, String),
        )
        .exists()
    )
    associations = db.execute(
        select(
            association.entity_id,
            association.principal_name,
            association.position,
            spending_name.label("spending_name"),
            resolves.label("linkable"),
        )
        .where(
            association.snapshot_id == pair.lobbyist_snapshot_id,
            association.registration_number == registration_number,
        )
        .order_by(association.position)
    ).all()
    return {
        **base,
        "state": REPORTED if person else "not_registered_today",
        "name": person.name if person else None,
        "formatted_name": person.formatted_name if person else None,
        "latest_reported_year": _latest_year(db, pair),
        "principals": {
            "state": REPORTED if associations else "not_registered_today",
            "total": len({item.entity_id for item in associations}),
            "rows": [
                {
                    "entity_id": item.entity_id,
                    "name": item.principal_name,
                    "spending_name": item.spending_name,
                    "position": item.position,
                    "linkable": item.linkable,
                    "state": REPORTED if item.linkable else "no_spending_rows",
                }
                for item in associations
            ],
        },
        "contributions": contributions,
    }
