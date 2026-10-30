"""Browse source spellings and saved identities without inferring who a name is.

Each queue row is 1 exact spelling in 1 source file. Its figure covers only that
file's records and is withheld when any amount is missing (the owning rule is
``campaign_finance_reader.Bucket.rows_missing_an_amount``, grounded-answers rule12). Active fingerprint
claims supply coverage; names alone never supply a confirmed identity.
"""

from __future__ import annotations

from sqlalchemy import and_, case, func, literal, select, true, union_all
from sqlalchemy.orm import Session

from alethical.api.services import identity_confirmations as identities
from alethical.db import models as m
from alethical.pipeline import campaign_finance_reader as reader

KINDS = {
    "all": ("donor_name", "payee_name", "independent_payee_name"),
    "donor": ("donor_name",),
    "payee": ("payee_name", "independent_payee_name"),
}


def _page(query, *, page, page_size, order):
    """Count and page 1 shared query, including a truthful empty last page."""
    rows = query.cte("listed")
    total = select(func.count().label("total")).select_from(rows).subquery()
    paged = (
        select(rows)
        .order_by(*(order(rows)))
        .offset((page - 1) * page_size)
        .limit(page_size)
        .subquery()
    )
    return (
        select(total.c.total, paged)
        .select_from(total.outerjoin(paged, true()))
        .order_by(*order(paged))
    )


def _pagination(total, page, page_size):
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": (total + page_size - 1) // page_size,
    }


def entities(
    db: Session,
    *,
    q: str = "",
    kind: str | None = None,
    page: int = 1,
    page_size: int = 50,
) -> dict:
    q = identities._text(q, "Search", identities.MAX_KEY) if q else ""
    entity = m.IdentityEntity
    query = select(entity.id, entity.kind, entity.name).where(entity.status == "active")
    if q:
        query = query.where(entity.name.icontains(q, autoescape=True))
    if kind:
        query = query.where(entity.kind == kind)
    results = db.execute(
        _page(
            query,
            page=page,
            page_size=page_size,
            order=lambda rows: (rows.c.name, rows.c.id),
        )
    ).all()
    return {
        **_pagination(results[0].total, page, page_size),
        "rows": [
            {"id": str(row.id), "kind": row.kind, "name": row.name}
            for row in results
            if row.id is not None
        ],
    }


def _names(kind, snapshot_id, q):
    printed = identities._PRINTED[kind]
    model = printed.model
    date = model.receipt_date if kind == "donor_name" else model.transaction_date
    where = [
        model.snapshot_id == snapshot_id,
        printed.name.is_not(None),
        func.btrim(printed.name) != "",
    ]
    if q:
        where.append(printed.name.icontains(q, autoescape=True))
    totals = (
        select(
            printed.name.label("name"),
            func.count().label("records"),
            func.sum(model.amount).label("amount"),
            (func.count() - func.count(model.amount)).label("missing_amounts"),
            func.count()
            .filter(and_(model.year.is_(None), date.is_(None)))
            .label("undated_records"),
            case(
                (func.count(date) == func.count(), "dates"),
                (func.count(model.year) == func.count(), "years"),
                else_=None,
            ).label("period_basis"),
            func.min(model.year).label("first_year"),
            func.max(model.year).label("last_year"),
            func.min(date).label("first_date"),
            func.max(date).label("last_date"),
        )
        .where(*where)
        .group_by(printed.name)
        .subquery()
    )
    # Start with actual saved claims, so a queue with no confirmations never
    # fingerprints the whole payment file. Match every repeated current row.
    coverage = (
        select(printed.name.label("name"), func.count().label("confirmed"))
        .select_from(model)
        .join(
            m.IdentityConfirmation,
            and_(
                m.IdentityConfirmation.record_kind == kind,
                m.IdentityConfirmation.record_key == printed.name,
                m.IdentityConfirmation.active,
            ),
        )
        .join(
            m.IdentityConfirmedRecord,
            and_(
                m.IdentityConfirmedRecord.confirmation_id == m.IdentityConfirmation.id,
                m.IdentityConfirmedRecord.active,
                m.IdentityConfirmedRecord.fingerprint == printed.fingerprint(kind),
            ),
        )
        .where(*where)
        .group_by(printed.name)
        .subquery()
    )
    return select(
        literal(kind).label("record_kind"),
        totals,
        func.coalesce(coverage.c.confirmed, 0).label("confirmed"),
    ).select_from(totals.outerjoin(coverage, totals.c.name == coverage.c.name))


def queue(
    db: Session,
    *,
    record_type: str = "all",
    status: str = "unconfirmed",
    q: str = "",
    page: int = 1,
    page_size: int = 50,
) -> dict:
    q = identities._text(q, "Search", identities.MAX_KEY) if q else ""
    try:
        release = reader.live_release(db)
        if release is None:
            raise identities.Unavailable("The Board's current file is not loaded")
        sources = {
            kind: release.file_for(identities._PRINTED[kind].dataset)
            for kind in KINDS[record_type]
        }
        grouped = union_all(
            *(_names(kind, source.snapshot_id, q) for kind, source in sources.items())
        ).subquery()
        query = select(grouped)
        if status == "unconfirmed":
            query = query.where(grouped.c.confirmed < grouped.c.records)
        elif status == "confirmed":
            query = query.where(grouped.c.confirmed == grouped.c.records)
        results = db.execute(
            _page(
                query,
                page=page,
                page_size=page_size,
                order=lambda rows: (
                    case(
                        (
                            and_(
                                rows.c.missing_amounts == 0,
                                rows.c.period_basis.is_not(None),
                            ),
                            rows.c.amount,
                        ),
                        else_=None,
                    )
                    .desc()
                    .nulls_last(),
                    rows.c.name,
                    rows.c.record_kind,
                ),
            )
        ).all()
        # A pruned source must not turn into a claim that no names remain.
        for source in sources.values():
            reader._refuse_if_rows_are_gone(db, release, source.dataset)
        metadata = {
            kind: {
                "snapshot_id": str(source.snapshot_id),
                "source_url": source.source_url,
                "copied_at": identities._iso(source.copied_at or release.fetched_at),
                "file": source.dataset.value,
            }
            for kind, source in sources.items()
        }
    except reader.ReleaseNoLongerHeld:
        raise identities.Unavailable("The Board's current file is not loaded") from None
    return {
        **_pagination(results[0].total, page, page_size),
        "sources": metadata,
        "rows": [
            {
                "record_kind": row.record_kind,
                "record_key": row.name,
                "name": row.name,
                "records": row.records,
                "confirmed": row.confirmed,
                "amount": str(row.amount)
                if row.amount is not None
                and not row.missing_amounts
                and row.period_basis is not None
                else None,
                "amount_state": "incomplete_amount"
                if row.missing_amounts
                else "incomplete_period"
                if row.period_basis is None
                else "reported",
                "period_basis": row.period_basis,
                "missing_amounts": row.missing_amounts,
                "undated_records": row.undated_records,
                "first_year": row.first_year,
                "last_year": row.last_year,
                "first_date": identities._iso(row.first_date),
                "last_date": identities._iso(row.last_date),
                **metadata[row.record_kind],
            }
            for row in results
            if row.record_kind is not None
        ],
    }
