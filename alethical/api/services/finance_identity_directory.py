"""Browse source spellings and saved identities without inferring who a name is.

Each queue row is 1 exact spelling in 1 source file. Its figure covers only that
file's records and is withheld when any amount is missing (the owning rule is
``campaign_finance_reader.Bucket.rows_missing_an_amount``, grounded-answers rule12). Active fingerprint
claims supply coverage; names alone never supply a confirmed identity.
"""

from __future__ import annotations

from sqlalchemy import (
    Numeric,
    and_,
    case,
    cast,
    func,
    literal,
    null,
    select,
    true,
    tuple_,
    union_all,
)
from sqlalchemy.orm import Session

from alethical.api.services import identity_confirmations as identities
from alethical.db import models as m
from alethical.pipeline import campaign_finance_name_summary as name_summary
from alethical.pipeline import campaign_finance_reader as reader

KINDS = {
    "all": ("donor_name", "employer_name", "payee_name", "independent_payee_name"),
    "employer": ("employer_name",),
    "donor": ("donor_name",),
    "payee": ("payee_name", "independent_payee_name"),
}


def _page(query, *, page, page_size, order, inline=False):
    """Count and page 1 shared query, including a truthful empty last page.

    ``inline`` lets the count and the page each plan the query on its own, so the
    page can walk an index in the requested order instead of sorting every row.
    """
    rows = query.cte("listed")
    if inline:
        rows = rows.prefix_with("NOT MATERIALIZED")
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
    query = select(entity.id, entity.reference, entity.kind, entity.name).where(
        entity.status == "active"
    )
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
            {
                "id": str(row.id),
                "reference": row.reference,
                "kind": row.kind,
                "name": row.name,
            }
            for row in results
            if row.id is not None
        ],
    }


def _where(kind, snapshot_id, q):
    """The raw rows of 1 file that print a searched name of this kind."""
    where = name_summary.named(kind, snapshot_id)
    if q:
        where.append(identities._PRINTED[kind].name.icontains(q, autoescape=True))
    return where


def _coverage(kind, snapshot_id, q):
    """Each printed name's active record-level claims, read at request time.

    Starts with actual saved claims, so a queue with no confirmations never
    fingerprints the whole payment file. Matches every repeated current row.
    """
    printed = identities._PRINTED[kind]
    return (
        select(
            literal(kind).label("record_kind"),
            printed.name.label("name"),
            func.count().label("confirmed"),
            func.array_agg(m.IdentityConfirmation.entity_id.distinct()).label(
                "identity_ids"
            ),
        )
        .select_from(printed.model)
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
        .where(*_where(kind, snapshot_id, q))
        .group_by(printed.name)
    )


def _period_basis(dated, yeared, records):
    return case(
        (dated == records, "dates"),
        (yeared == records, "years"),
        else_=None,
    )


def _names(kind, snapshot_id, q):
    """1 file's printed names of 1 kind, grouped from its raw rows."""
    printed = identities._PRINTED[kind]
    model = printed.model
    date = name_summary.NAME_KINDS[kind].date
    totals = (
        select(
            printed.name.label("name"),
            func.count().label("records"),
            func.sum(model.amount).label("amount"),
            (func.count() - func.count(model.amount)).label("missing_amounts"),
            func.count()
            .filter(and_(model.year.is_(None), date.is_(None)))
            .label("undated_records"),
            _period_basis(func.count(date), func.count(model.year), func.count()).label(
                "period_basis"
            ),
            func.min(model.year).label("first_year"),
            func.max(model.year).label("last_year"),
            func.min(date).label("first_date"),
            func.max(date).label("last_date"),
        )
        .where(*_where(kind, snapshot_id, q))
        .group_by(printed.name)
        .subquery()
    )
    coverage = _coverage(kind, snapshot_id, q).subquery()
    return select(
        literal(kind).label("record_kind"),
        totals,
        func.coalesce(coverage.c.confirmed, 0).label("confirmed"),
        coverage.c.identity_ids,
    ).select_from(totals.outerjoin(coverage, totals.c.name == coverage.c.name))


def _summarized(pairs, q):
    """The printed names of these (file, kind) pairs, from their complete builds.

    The same columns as ``_names``. Only the per-file totals come from the summary;
    confirmation coverage and identities are read now, over the raw rows.
    """
    summary = name_summary.Summary
    coverage = union_all(
        *(_coverage(kind, snapshot_id, q) for snapshot_id, kind in pairs)
    ).subquery()
    where = [tuple_(summary.snapshot_id, summary.record_kind).in_(pairs)]
    if q:
        where.append(summary.name.icontains(q, autoescape=True))
    return (
        select(
            summary.record_kind,
            summary.name,
            summary.records,
            summary.amount,
            summary.missing_amounts,
            summary.undated_records,
            _period_basis(
                summary.dated_records, summary.yeared_records, summary.records
            ).label("period_basis"),
            summary.first_year,
            summary.last_year,
            summary.first_date,
            summary.last_date,
            func.coalesce(coverage.c.confirmed, 0).label("confirmed"),
            coverage.c.identity_ids,
            summary.sort_amount,
        )
        .select_from(
            summary.__table__.outerjoin(
                coverage,
                and_(
                    coverage.c.record_kind == summary.record_kind,
                    coverage.c.name == summary.name,
                ),
            )
        )
        .where(*where)
    )


def _complete_amount(rows):
    """The amount the queue sorts by: only a complete amount over a known period."""
    return case(
        (
            and_(rows.c.missing_amounts == 0, rows.c.period_basis.is_not(None)),
            rows.c.amount,
        ),
        else_=None,
    )


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
        pairs = [(source.snapshot_id, kind) for kind, source in sources.items()]
        built = name_summary.complete(db, pairs)
        if len(built) == len(pairs):
            # Every kind has a complete build: 1 read of the summary, paged
            # through its order index.
            grouped = _summarized(pairs, q).subquery()
            order = lambda rows: (  # noqa: E731
                rows.c.sort_amount.desc().nulls_last(),
                rows.c.name,
                rows.c.record_kind,
            )
            inline = True
        else:
            # A kind without a complete build is grouped from its raw rows.
            grouped = union_all(
                *(
                    _summarized([pair], q)
                    if pair in built
                    else _names(pair[1], pair[0], q).add_columns(
                        cast(null(), Numeric).label("sort_amount")
                    )
                    for pair in pairs
                )
            ).subquery()
            order = lambda rows: (  # noqa: E731
                _complete_amount(rows).desc().nulls_last(),
                rows.c.name,
                rows.c.record_kind,
            )
            inline = False
        query = select(grouped)
        if status == "unconfirmed":
            query = query.where(grouped.c.confirmed < grouped.c.records)
        elif status == "confirmed":
            query = query.where(grouped.c.confirmed == grouped.c.records)
        results = db.execute(
            _page(query, page=page, page_size=page_size, order=order, inline=inline)
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
    # Resolve only owners on this page. A merged predecessor and its successor
    # are 1 identity today, while a later split can create several owners.
    owners = {owner for row in results for owner in (row.identity_ids or [])}
    standing = {owner: identities._today(db, owner).id for owner in owners}
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
                "identity_count": len(
                    {standing[owner] for owner in (row.identity_ids or [])}
                ),
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
