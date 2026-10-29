"""Finance's payee directory: filed strings or exactly confirmed records.

The expenditure files stay separate because a record can occur in both. A sum is
itemized, keeps refunds signed, and is withheld if any amount is missing. Identity
coverage is joined by the same fingerprints the confirmation service writes.
"""

from __future__ import annotations

from typing import Literal

from sqlalchemy import String, case, cast, func, literal, select, union_all
from sqlalchemy.orm import Session

from alethical.api.services import (
    committee_finance,
    identity_confirmations as identities,
)
from alethical.api.services.campaign_finance_search import name_contains
from alethical.db import models as m
from alethical.pipeline import campaign_finance_reader as reader

PayeeTab = Literal["all", "confirmed", "printed"]
PayeeSort = Literal["name", "amount", "records"]
KINDS = (("payee_name", "vendor"), ("independent_payee_name", "independent_vendor"))


def _rows(db: Session, release: reader.Release):
    confirmation, record = m.IdentityConfirmation, m.IdentityConfirmedRecord
    # Confirmations can retain the ID of an identity later merged into another.
    # Resolve using the confirmation service, then apply that mapping before sums.
    entity_ids = db.scalars(
        select(confirmation.entity_id)
        .where(
            confirmation.active,
            confirmation.record_kind.in_([kind for kind, _ in KINDS]),
        )
        .distinct()
    ).all()
    standing = {
        str(entity_id): identities._today(db, entity_id) for entity_id in entity_ids
    }
    entities = {
        old: entity
        for old, entity in standing.items()
        if entity.kind in {"person", "organization"} and entity.status == "active"
    }
    parts = []
    for kind, role in KINDS:
        printed = identities._PRINTED[kind]
        model = printed.model
        key = cast(confirmation.entity_id, String)
        identity_id = (
            case(
                {old: str(entity.id) for old, entity in entities.items()},
                value=key,
                else_=None,
            )
            if entities
            else literal(None, String)
        )
        identity_name = (
            case(
                {old: entity.name for old, entity in entities.items()},
                value=key,
                else_=None,
            )
            if entities
            else literal(None, String)
        )
        identity_kind = (
            case(
                {old: entity.kind for old, entity in entities.items()},
                value=key,
                else_=None,
            )
            if entities
            else literal(None, String)
        )
        statement = (
            select(
                literal(printed.dataset.value).label("dataset"),
                literal(role).label("role"),
                model.vendor_name.label("printed_name"),
                identity_id.label("identity_id"),
                identity_kind.label("identity_kind"),
                func.coalesce(identity_name, model.vendor_name).label("name"),
                model.amount,
                model.transaction_date.label("paid_on"),
                model.year,
                model.type.label("payment_type"),
            )
            .select_from(model)
            .where(
                model.snapshot_id == release.file_for(printed.dataset).snapshot_id,
                model.vendor_name.is_not(None),
            )
        )
        if entities:
            statement = statement.outerjoin(
                record,
                (record.fingerprint == printed.fingerprint(kind)) & record.active,
            ).outerjoin(
                confirmation,
                (confirmation.id == record.confirmation_id)
                & confirmation.active
                & (confirmation.record_kind == kind)
                & (confirmation.record_key == model.vendor_name),
            )
        parts.append(statement)
    return union_all(*parts).subquery()


def directory(
    db: Session,
    *,
    query: str = "",
    year: int | None = None,
    payment_type: str | None = None,
    tab: PayeeTab = "all",
    sort: PayeeSort = "name",
    limit: int = 50,
    offset: int = 0,
) -> dict:
    committee_finance.pin_to_one_view(db)
    base = {
        "state": "unavailable",
        "rows": [],
        "total": None,
        "counts": {"all": None, "confirmed": None, "printed": None},
        "payment_count": None,
        "has_more": False,
        "limit": limit,
        "offset": offset,
        "q": query,
        "year": year,
        "payment_type": payment_type,
        "tab": tab,
        "sort": sort,
        "years": [],
        "payment_types": [],
        "release_id": None,
        "fetched_at": None,
        "sources": [],
    }
    try:
        release = committee_finance.current_release(db)
        if release is None:
            return base
        for kind, _ in KINDS:
            reader._refuse_if_rows_are_gone(
                db, release, identities._PRINTED[kind].dataset
            )
    except reader.ReleaseNoLongerHeld:
        return base
    sources = {
        kind: release.file_for(identities._PRINTED[kind].dataset) for kind, _ in KINDS
    }
    base.update(
        release_id=str(release.id),
        fetched_at=release.fetched_at,
        sources=[
            {
                "dataset": source.dataset.value,
                "snapshot_id": str(source.snapshot_id),
                "source_url": source.source_url,
                "fetched_at": release.copied_at(source.dataset),
            }
            for source in sources.values()
        ],
    )
    rows = _rows(db, release)
    # Facets use the files directly; calculating identity fingerprints cannot
    # change a year or payment type and would repeat expensive work.
    facets = union_all(
        *(
            select(
                identities._PRINTED[kind].model.year.label("year"),
                identities._PRINTED[kind].model.type.label("payment_type"),
            ).where(
                identities._PRINTED[kind].model.snapshot_id == sources[kind].snapshot_id
            )
            for kind, _ in KINDS
        )
    ).subquery()
    years, types = db.execute(
        select(
            func.array_agg(facets.c.year.distinct()),
            func.array_agg(facets.c.payment_type.distinct()),
        )
    ).one()
    base["years"] = sorted(
        (value for value in years or [] if value is not None), reverse=True
    )
    base["payment_types"] = sorted(value for value in types or [] if value is not None)
    where = []
    if query.strip():
        where.append(name_contains(rows.c.name, query.strip()))
    if year is not None:
        where.append(rows.c.year == year)
    if payment_type is not None:
        where.append(rows.c.payment_type == payment_type)
    all_amounts = func.count(rows.c.amount) == func.count()
    all_dates = func.count(rows.c.paid_on) == func.count()
    all_years = func.count(rows.c.year) == func.count()
    whole_period = all_dates | all_years
    amount = case((all_amounts & whole_period, func.sum(rows.c.amount)), else_=None)
    grouped = (
        select(
            rows.c.dataset,
            rows.c.role,
            rows.c.identity_id,
            rows.c.identity_kind,
            rows.c.name,
            func.count().label("payment_count"),
            amount.label("amount"),
            case(
                (~all_amounts, "incomplete"),
                (whole_period, "reported"),
                else_="incomplete_period",
            ).label("amount_state"),
            case((all_dates, "dates"), (all_years, "years"), else_="unknown").label(
                "period_basis"
            ),
            func.min(rows.c.year).label("first_year"),
            func.max(rows.c.year).label("last_year"),
            func.min(rows.c.paid_on).label("first_payment_on"),
            func.max(rows.c.paid_on).label("last_payment_on"),
            (func.count() - func.count(rows.c.paid_on)).label("undated_payment_count"),
        )
        .where(*where)
        .group_by(
            rows.c.dataset,
            rows.c.role,
            rows.c.identity_id,
            rows.c.identity_kind,
            rows.c.name,
        )
        .subquery()
    )
    selected_tab = {
        "all": literal(True),
        "confirmed": grouped.c.identity_kind == "organization",
        "printed": grouped.c.identity_id.is_(None),
    }[tab]
    all_count, confirmed_count, printed_count, total, payments = db.execute(
        select(
            func.count(),
            func.count().filter(grouped.c.identity_kind == "organization"),
            func.count().filter(grouped.c.identity_id.is_(None)),
            func.count().filter(selected_tab),
            func.coalesce(func.sum(grouped.c.payment_count).filter(selected_tab), 0),
        ).select_from(grouped)
    ).one()
    ordering = {
        "name": (),
        "amount": (grouped.c.amount.desc().nulls_last(),),
        "records": (grouped.c.payment_count.desc(),),
    }[sort]
    selected = db.execute(
        select(grouped)
        .where(selected_tab)
        .order_by(
            *ordering,
            grouped.c.name,
            grouped.c.dataset,
            grouped.c.identity_id.nulls_last(),
        )
        .limit(limit)
        .offset(offset)
    ).all()
    source_by_dataset = {source.dataset.value: source for source in sources.values()}
    answer = []
    for row in selected:
        source = source_by_dataset[row.dataset]
        answer.append(
            {
                **dict(row._mapping),
                "key": f"{row.dataset}:{row.identity_id or 'printed'}:{row.name}",
                "record_kind": "confirmed_vendor"
                if row.identity_kind == "organization"
                else "confirmed_person"
                if row.identity_kind == "person"
                else "printed_name",
                "identity": {
                    "id": row.identity_id,
                    "kind": row.identity_kind,
                    "name": row.name,
                }
                if row.identity_id
                else None,
                "amount": str(row.amount) if row.amount is not None else None,
                "snapshot_id": str(source.snapshot_id),
                "source_url": source.source_url,
                "fetched_at": release.copied_at(source.dataset),
            }
        )
    return {
        **base,
        "state": "reported" if total else "not_reported",
        "rows": answer,
        "total": total,
        "counts": {
            "all": all_count,
            "confirmed": confirmed_count,
            "printed": printed_count,
        },
        "payment_count": int(payments),
        "has_more": offset + len(answer) < total,
    }
