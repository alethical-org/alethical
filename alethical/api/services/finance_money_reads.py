"""Finance-only grouped money reads, preserving each source row and exact spelling."""

from __future__ import annotations

from dataclasses import asdict
from decimal import Decimal
import re
from collections import defaultdict
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import String, case, cast, func, select
from sqlalchemy.orm import Session

from alethical.api.services import (
    campaign_finance_payments as payments,
    committee_finance,
    identity_confirmations as identities,
)
from alethical.db import models as m
from alethical.pipeline import campaign_finance_reader as reader

CONTRIBUTIONS = m.CampaignFinanceContributionRow


def _release(db: Session, release_id: UUID | None = None):
    committee_finance.pin_to_one_view(db)
    release = committee_finance.current_release(db)
    if release_id and (release is None or release.id != release_id):
        raise HTTPException(409, "The Board's file changed. Reload the records.")
    if release:
        reader._refuse_if_rows_are_gone(db, release, reader.Dataset.contributions)
    return release


def _source(release):
    if release is None:
        return {
            "release_id": None,
            "snapshot_id": None,
            "fetched_at": None,
            "source_url": None,
        }
    source = release.contributions
    return {
        "release_id": str(release.id),
        "snapshot_id": str(source.snapshot_id),
        "fetched_at": release.copied_at(reader.Dataset.contributions),
        "source_url": source.source_url,
    }


def _page(limit, offset, total):
    return {
        "limit": limit,
        "offset": offset,
        "has_more": total is not None and offset + limit < total,
    }


def _unavailable(*, limit, offset, **scope):
    return {
        **scope,
        "state": "unavailable",
        "rows": [],
        "total": None,
        "total_payments": None,
        "page": _page(limit, offset, None),
        **_source(None),
    }


def _organization_claim_ids(db):
    confirmation = m.IdentityConfirmation
    found = db.scalars(
        select(confirmation.entity_id)
        .where(
            confirmation.record_kind == "employer_name",
            confirmation.active,
        )
        .distinct()
    ).all()
    return [
        entity_id
        for entity_id in found
        if (current := identities._today(db, entity_id)).kind == "organization"
        and current.status == "active"
    ]


def employers(db: Session, *, q: str, limit: int, offset: int) -> dict:
    try:
        release = _release(db)
        if release is None:
            return _unavailable(limit=limit, offset=offset, q=q)
        row = CONTRIBUTIONS
        claimed = (
            select(m.IdentityConfirmedRecord.fingerprint)
            .join(
                m.IdentityConfirmation,
                m.IdentityConfirmation.id == m.IdentityConfirmedRecord.confirmation_id,
            )
            .where(
                m.IdentityConfirmation.active,
                m.IdentityConfirmation.record_kind == "employer_name",
                m.IdentityConfirmation.record_key == row.contrib_employer_name,
                m.IdentityConfirmation.entity_id.in_(_organization_claim_ids(db)),
                m.IdentityConfirmedRecord.active,
                m.IdentityConfirmedRecord.fingerprint
                == identities._PRINTED["employer_name"].fingerprint("employer_name"),
            )
            .exists()
        )
        groups = (
            select(
                row.contrib_employer_name.label("name"),
                func.count().label("record_count"),
                func.count(row.contributor.distinct()).label("donor_name_count"),
                func.count().filter(row.contributor.is_(None)).label("unnamed_records"),
                func.count().filter(claimed).label("confirmed_records"),
            )
            .where(
                row.snapshot_id == release.contributions.snapshot_id,
                row.contrib_employer_name.icontains(q, autoescape=True),
            )
            .group_by(row.contrib_employer_name)
            .subquery()
        )
        total = db.scalar(select(func.count()).select_from(groups))
        rows = db.execute(
            select(groups).order_by(groups.c.name).limit(limit).offset(offset)
        ).all()
        return {
            "state": "reported" if total else "not_reported",
            "q": q,
            "rows": [
                {**dict(r._mapping), "confirmed_organization": r.confirmed_records > 0}
                for r in rows
            ],
            "total": total,
            "page": _page(limit, offset, total),
            **_source(release),
        }
    except reader.ReleaseNoLongerHeld:
        return _unavailable(limit=limit, offset=offset, q=q)


def _donor_key():
    row = CONTRIBUTIONS
    return case(
        (
            row.contributor.is_(None),
            func.concat("record:", cast(row.row_number, String)),
        ),
        else_=func.concat("name:", row.contributor),
    )


def _donor_rows(db, release, *, name, donor, record_number, limit, offset):
    row = CONTRIBUTIONS
    where = [
        row.snapshot_id == release.contributions.snapshot_id,
        row.contrib_employer_name == name,
    ]
    where.append(
        row.contributor == donor if donor is not None else row.contributor.is_(None)
    )
    if donor is None:
        where.append(row.row_number == record_number)
    total = db.scalar(select(func.count()).select_from(row).where(*where))
    download = payments._CONTRIBUTIONS
    columns = [getattr(row, column.strip()) for column in download.columns.split(",")]
    selected = db.execute(
        select(*columns)
        .where(*where)
        .order_by(
            row.receipt_date.desc().nulls_last(),
            row.row_number.desc(),
        )
        .limit(limit)
        .offset(offset)
    ).all()
    values = [asdict(download.build(record)) for record in selected]
    for value in values:
        # These are a recipient's own filed rows, so its number is a held filer.
        value["recipient_is_filer"] = bool(value["recipient_registration_number"])
    return {
        "payments": values,
        "payment_count": total,
        "page": {**_page(limit, offset, total), "total_payments": total},
    }


def _donor_previews(db, release, *, name, keys):
    """Read the first 50 payments of every selected group in one bounded query."""
    if not keys:
        return {}
    row = CONTRIBUTIONS
    download = payments._CONTRIBUTIONS
    columns = [getattr(row, column.strip()) for column in download.columns.split(",")]
    ranked = (
        select(
            *columns,
            _donor_key().label("group_key"),
            func.row_number()
            .over(
                partition_by=_donor_key(),
                order_by=(
                    row.receipt_date.desc().nulls_last(),
                    row.row_number.desc(),
                ),
            )
            .label("position"),
        )
        .where(
            row.snapshot_id == release.contributions.snapshot_id,
            row.contrib_employer_name == name,
            _donor_key().in_(keys),
        )
        .subquery()
    )
    result = defaultdict(list)
    for record in db.execute(
        select(ranked)
        .where(ranked.c.position <= 50)
        .order_by(ranked.c.group_key, ranked.c.position)
    ):
        value = asdict(download.build(record[: len(columns)]))
        value["recipient_is_filer"] = bool(value["recipient_registration_number"])
        result[record.group_key].append(value)
    return result


def employer_donors(
    db: Session, *, name: str, limit: int, offset: int, release_id: UUID | None = None
) -> dict:
    try:
        release = _release(db, release_id)
        if release is None:
            return _unavailable(limit=limit, offset=offset, name=name)
        row = CONTRIBUTIONS
        key = _donor_key()
        groups = (
            select(
                key.label("key"),
                row.contributor.label("name"),
                case((row.contributor.is_(None), row.row_number), else_=None).label(
                    "record_number"
                ),
                func.count().label("payment_count"),
                func.max(row.receipt_date).label("latest_on"),
            )
            .where(
                row.snapshot_id == release.contributions.snapshot_id,
                row.contrib_employer_name == name,
            )
            .group_by(
                key,
                row.contributor,
                case((row.contributor.is_(None), row.row_number), else_=None),
            )
            .subquery()
        )
        total, total_payments = db.execute(
            select(
                func.count(), func.coalesce(func.sum(groups.c.payment_count), 0)
            ).select_from(groups)
        ).one()
        selected = db.execute(
            select(groups)
            .order_by(groups.c.latest_on.desc().nulls_last(), groups.c.key)
            .limit(limit)
            .offset(offset)
        ).all()
        previews = _donor_previews(
            db, release, name=name, keys=[group.key for group in selected]
        )
        return {
            "state": "reported" if total else "not_reported",
            "name": name,
            "rows": [
                {
                    **dict(group._mapping),
                    "payments": previews.get(group.key, []),
                    "page": {
                        **_page(50, 0, group.payment_count),
                        "total_payments": group.payment_count,
                    },
                }
                for group in selected
            ],
            "total": total,
            "total_payments": int(total_payments),
            "page": _page(limit, offset, total),
            **_source(release),
        }
    except reader.ReleaseNoLongerHeld:
        return _unavailable(limit=limit, offset=offset, name=name)


def employer_donor_payments(
    db: Session,
    *,
    name: str,
    donor: str | None,
    record_number: int | None,
    limit: int,
    offset: int,
    release_id: UUID | None = None,
) -> dict:
    if (donor is None) == (record_number is None):
        raise HTTPException(422, "Choose a printed donor name or one unnamed record")
    try:
        release = _release(db, release_id)
        if release is None:
            return {
                **_unavailable(limit=limit, offset=offset, name=name),
                "payments": [],
            }
        result = _donor_rows(
            db,
            release,
            name=name,
            donor=donor,
            record_number=record_number,
            limit=limit,
            offset=offset,
        )
        return {
            "state": "reported" if result["payment_count"] else "not_reported",
            "name": name,
            "donor": donor,
            "record_number": record_number,
            **result,
            **_source(release),
        }
    except reader.ReleaseNoLongerHeld:
        return {**_unavailable(limit=limit, offset=offset, name=name), "payments": []}


def _committee_rows(release, registration, year, direction):
    from sqlalchemy import literal

    if direction == "received":
        model, download = CONTRIBUTIONS, payments._CONTRIBUTIONS
        name = model.contributor
        number = func.nullif(model.contrib_reg_num, "0")
        kind = model.contrib_type
        tab = case(
            (kind.ilike("Individual%"), "individuals"),
            (kind.ilike("%lobbyist%"), "lobbyists"),
            (
                kind.ilike("%candidate committee%")
                | kind.ilike("%political committee%")
                | kind.ilike("%political fund%")
                | kind.ilike("%committee/fund%"),
                "committees",
            ),
            (kind.ilike("%party unit%"), "party"),
            else_="other",
        )
        where = [
            model.recipient_reg_num == registration,
            model.receipt_type == "Contribution",
        ]
    else:
        model, download = m.CampaignFinanceExpenditureRow, payments._EXPENDITURES
        transfer = model.type == "Contribution"
        name = case(
            (transfer, func.coalesce(model.affected_committee_name, model.vendor_name)),
            else_=model.vendor_name,
        )
        number = case(
            (transfer, func.nullif(model.affected_committee_reg_num, "0")), else_=None
        )
        kind = model.type
        tab = literal("expenditures")
        where = [model.committee_reg_num == registration]
    key = cast(
        func.jsonb_build_array(
            tab, number, name, case((name.is_(None), model.row_number), else_=None)
        ),
        String,
    )
    statement = select(
        *[getattr(model, column.strip()) for column in download.columns.split(",")],
        key.label("group_key"),
        name.label("group_name"),
        number.label("group_registration"),
        tab.label("tab"),
        kind.label("group_kind"),
        getattr(model, download.date_column).label("group_date"),
    ).where(
        model.snapshot_id == release.file_for(download.dataset).snapshot_id,
        model.year == year,
        *where,
    )
    return model, download, statement.subquery()


def _committee_release(db, registration, year, direction, release_id):
    release = _release(db, release_id)
    if release is None:
        return None
    dataset = (
        reader.Dataset.contributions
        if direction == "received"
        else reader.Dataset.expenditures
    )
    reader._refuse_if_rows_are_gone(db, release, dataset)
    if committee_finance.find_committee(db, release, registration) is None:
        raise HTTPException(404, "Committee not found")
    return release


def _committee_source(release, direction):
    dataset = (
        reader.Dataset.contributions
        if direction == "received"
        else reader.Dataset.expenditures
    )
    source = release.file_for(dataset)
    return {
        "release_id": str(release.id),
        "snapshot_id": str(source.snapshot_id),
        "dataset": dataset.value,
        "fetched_at": release.copied_at(dataset),
        "source_url": source.source_url,
    }


def _group_previews(db, base, download, keys):
    if not keys:
        return {}
    ranked = (
        select(
            base,
            func.row_number()
            .over(
                partition_by=base.c.group_key,
                order_by=(
                    base.c.group_date.desc().nulls_last(),
                    base.c.row_number.desc(),
                ),
            )
            .label("position"),
        )
        .where(base.c.group_key.in_(keys))
        .subquery()
    )
    result = defaultdict(list)
    width = len(download.columns.split(","))
    for row in db.execute(
        select(ranked)
        .where(ranked.c.position <= 50)
        .order_by(ranked.c.group_key, ranked.c.position)
    ):
        result[row.group_key].append(download.build(row[:width]))
    return result


def _statement_fields(db, release, registration, year, found):
    from alethical.api.services.committee_notices import (
        attached_statements,
        statement_links,
        statements_copied_on,
    )

    statements = attached_statements(
        statement_links(db, registration, year, release.contributions.snapshot_id),
        found,
    )
    return {
        "disclosure_statements": [asdict(item) for item in statements],
        "statements_copied_on": statements_copied_on(
            db, [item.statement_id for item in statements]
        )
        if statements
        else None,
    }


def committee_groups(
    db: Session,
    *,
    registration: str,
    year: int,
    direction: str,
    tab: str | None,
    q: str,
    sort: str,
    limit: int,
    offset: int,
    release_id: UUID | None = None,
    record_number: int | None = None,
):
    scope = {
        "registration_number": registration,
        "year": year,
        "direction": direction,
        "tab": tab,
        "q": q,
        "sort": sort,
        "record_number": record_number,
        "located_record": None,
        "amount": None,
        "missing_amounts": None,
        "period_basis": None,
        "first_date": None,
        "last_date": None,
        "first_year": None,
        "last_year": None,
    }
    try:
        release = _committee_release(db, registration, year, direction, release_id)
        if release is None:
            return _unavailable(limit=limit, offset=offset, **scope)
        _, download, base = _committee_rows(release, registration, year, direction)
        amount = case(
            (func.count(base.c.amount) == func.count(), func.sum(base.c.amount)),
            else_=None,
        )
        grouped = (
            select(
                base.c.group_key.label("key"),
                base.c.group_name.label("name"),
                base.c.group_registration.label("registration_number"),
                base.c.tab,
                func.count().label("payment_count"),
                amount.label("amount"),
                (func.count() - func.count(base.c.amount)).label("missing_amounts"),
                func.min(base.c.group_date).label("first_date"),
                func.max(base.c.group_date).label("last_date"),
                case(
                    (func.count(base.c.group_date) == func.count(), "dates"),
                    else_="years",
                ).label("period_basis"),
                func.array_agg(base.c.group_kind.distinct()).label("kinds"),
                func.bool_or(base.c.in_kind == "Yes").label("in_kind"),
            )
            .group_by(
                base.c.group_key,
                base.c.group_name,
                base.c.group_registration,
                base.c.tab,
            )
            .subquery()
        )
        tab_counts = {
            tab: count
            for tab, count in db.execute(
                select(grouped.c.tab, func.sum(grouped.c.payment_count)).group_by(
                    grouped.c.tab
                )
            ).all()
        }
        where = []
        if tab:
            where.append(grouped.c.tab == tab)
        if q:
            where.append(grouped.c.name.icontains(q, autoescape=True))
        if record_number is not None:
            # Locate the whole group, not just the notice-matched row inside it.
            where.append(
                grouped.c.key
                == select(base.c.group_key)
                .where(base.c.row_number == record_number)
                .scalar_subquery()
            )
        total, count, raw_amount, missing_amounts, first_date, last_date, all_dated = (
            db.execute(
                select(
                    func.count(),
                    func.coalesce(func.sum(grouped.c.payment_count), 0),
                    func.sum(grouped.c.amount),
                    func.coalesce(func.sum(grouped.c.missing_amounts), 0),
                    func.min(grouped.c.first_date),
                    func.max(grouped.c.last_date),
                    func.bool_and(grouped.c.period_basis == "dates"),
                )
                .where(*where)
                .select_from(grouped)
            ).one()
        )
        located_record = None
        if record_number is not None and total:
            ranked = (
                select(
                    base.c.row_number,
                    base.c.group_key,
                    (
                        func.row_number().over(
                            order_by=(
                                base.c.group_date.desc().nulls_last(),
                                base.c.row_number.desc(),
                            )
                        )
                        - 1
                    ).label("offset"),
                )
                .where(
                    base.c.group_key
                    == select(base.c.group_key)
                    .where(base.c.row_number == record_number)
                    .scalar_subquery()
                )
                .subquery()
            )
            located = db.execute(
                select(ranked.c.group_key, ranked.c.offset).where(
                    ranked.c.row_number == record_number
                )
            ).one()
            located_record = {
                "record_number": record_number,
                "group_key": located.group_key,
                "offset": located.offset,
            }
        order = {
            "name": (),
            "total": (grouped.c.amount.desc().nulls_last(),),
            "records": (grouped.c.payment_count.desc(),),
        }[sort]
        selected = db.execute(
            select(grouped)
            .where(*where)
            .order_by(*order, grouped.c.name.nulls_last(), grouped.c.key)
            .limit(limit)
            .offset(offset)
        ).all()
        preview = _group_previews(db, base, download, [row.key for row in selected])
        found = [payment for values in preview.values() for payment in values]
        linkable = payments.linkable_committees(
            db,
            release,
            [row.registration_number for row in selected if row.registration_number],
        )
        state = (
            "reported"
            if total
            else payments._empty_state(db, release, download.dataset, year)
        )
        return {
            **scope,
            "state": state,
            "located_record": located_record,
            "total": total if state != "unavailable" else None,
            "total_payments": int(count) if state != "unavailable" else None,
            "amount": str(raw_amount)
            if raw_amount is not None and not missing_amounts
            else None,
            "missing_amounts": int(missing_amounts) if state != "unavailable" else None,
            "period_basis": ("dates" if all_dated else "years") if count else None,
            "first_date": first_date,
            "last_date": last_date,
            "first_year": year if count else None,
            "last_year": year if count else None,
            "tab_counts": {key: int(value) for key, value in tab_counts.items()},
            "rows": [
                {
                    **dict(row._mapping),
                    "amount": str(row.amount) if row.amount is not None else None,
                    "kinds": sorted(kind for kind in row.kinds if kind is not None),
                    "first_year": year,
                    "last_year": year,
                    "payments": [
                        asdict(payment) for payment in preview.get(row.key, [])
                    ],
                    "page": {
                        **_page(50, 0, row.payment_count),
                        "total_payments": row.payment_count,
                    },
                }
                for row in selected
            ],
            "page": _page(limit, offset, total),
            "linkable_registration_numbers": sorted(linkable),
            **(
                _statement_fields(db, release, registration, year, found)
                if direction == "received"
                else {}
            ),
            **_committee_source(release, direction),
        }
    except reader.ReleaseNoLongerHeld:
        return _unavailable(limit=limit, offset=offset, **scope)


def committee_group_payments(
    db: Session,
    *,
    registration: str,
    year: int,
    direction: str,
    key: str,
    limit: int,
    offset: int,
    release_id: UUID | None = None,
):
    scope = {
        "registration_number": registration,
        "year": year,
        "direction": direction,
        "key": key,
    }
    try:
        release = _committee_release(db, registration, year, direction, release_id)
        if release is None:
            return {**_unavailable(limit=limit, offset=offset, **scope), "payments": []}
        _, download, base = _committee_rows(release, registration, year, direction)
        total = db.scalar(
            select(func.count()).select_from(base).where(base.c.group_key == key)
        )
        selected = db.execute(
            select(base)
            .where(base.c.group_key == key)
            .order_by(base.c.group_date.desc().nulls_last(), base.c.row_number.desc())
            .limit(limit)
            .offset(offset)
        ).all()
        width = len(download.columns.split(","))
        found = [download.build(row[:width]) for row in selected]
        numbers = (
            [payment.contributor_registration_number for payment in found]
            if direction == "received"
            else [payment.affected_committee_registration_number for payment in found]
        )
        state = (
            "reported"
            if total
            else payments._empty_state(db, release, download.dataset, year)
        )
        count = total if state != "unavailable" else None
        return {
            **scope,
            "state": state,
            "payments": [asdict(payment) for payment in found],
            "page": {**_page(limit, offset, count), "total_payments": count},
            "linkable_registration_numbers": sorted(
                payments.linkable_committees(
                    db, release, [number for number in numbers if number]
                )
            ),
            **(
                _statement_fields(db, release, registration, year, found)
                if direction == "received"
                else {}
            ),
            **_committee_source(release, direction),
        }
    except reader.ReleaseNoLongerHeld:
        return {**_unavailable(limit=limit, offset=offset, **scope), "payments": []}


def report_figures(db: Session, *, registration: str, year: int):
    """Held report names and figures, never a latest total relabelled as an older report."""
    from alethical.pipeline import campaign_finance_filings as filings
    from alethical.pipeline.campaign_finance_filing_calendars import (
        printed_period_start_for_end,
    )

    committee_finance.pin_to_one_view(db)
    snapshot = filings.live_filings_snapshot(db)
    scope = {"registration_number": registration, "year": year}
    missing = {
        **scope,
        "state": "unavailable",
        "reports": [],
        "snapshot_id": None,
        "copied_at": None,
        "source_url": filings.directory_url(),
    }
    if snapshot is None:
        return missing
    report = m.CampaignFinanceFilingReport
    if (
        snapshot.report_count
        and db.scalar(
            select(report.row_number).where(report.snapshot_id == snapshot.id).limit(1)
        )
        is None
    ):
        return missing
    catalogued = db.scalars(
        select(report)
        .where(
            report.snapshot_id == snapshot.id,
            report.registration_number == registration,
            report.filing_year == year,
            report.effective_amendment_index.is_not(None),
        )
        .order_by(report.cut_off_date.desc().nulls_last(), report.row_number)
    ).all()
    filing = db.scalar(
        select(m.CampaignFinanceFiling).where(
            m.CampaignFinanceFiling.snapshot_id == snapshot.id,
            m.CampaignFinanceFiling.registration_number == registration,
            m.CampaignFinanceFiling.filing_year == year,
        )
    )
    matches = [
        item
        for item in catalogued
        if filing is not None
        and filing.reported_through is not None
        and not item.special_election
        and item.cut_off_date == filing.reported_through
    ]
    amounts = {line.line_key: line.amount for line in filing.figures} if filing else {}
    labels = (
        {line.line_key: line.label_as_served for line in filing.figures}
        if filing
        else {}
    )
    contribution_keys = (
        filings.CONTRIBUTION_LINE_KEYS.get(filing.filer_kind, ()) if filing else ()
    )
    contributions = (
        sum((amounts[key] for key in contribution_keys), Decimal("0"))
        if (contribution_keys and all(key in amounts for key in contribution_keys))
        else None
    )

    def balance_date(key):
        # Balance labels carry their own date, which need not be the flow period's start.
        dates = re.findall(r"\b\d{1,2}/\d{1,2}/\d{4}\b", labels.get(key, ""))
        return filings.parse_us_date(dates[0]) if len(dates) == 1 else None

    beginning_as_of = balance_date("beginning_cash_balance")
    ending_as_of = balance_date("ending_cash_balance")
    rows = []
    for item in catalogued:
        matched = len(matches) == 1 and matches[0].row_number == item.row_number
        start = (
            printed_period_start_for_end(item.cut_off_date)
            if matched and item.cut_off_date is not None
            else None
        )
        rows.append(
            {
                "record_number": item.row_number,
                "report_name": item.report_name,
                "report_type": item.report_type,
                "cut_off_date": item.cut_off_date,
                "filed_date": item.filed_date,
                "effective_amendment_index": item.effective_amendment_index,
                "special_election": item.special_election,
                "period_start": start,
                "beginning_cash_balance": amounts.get("beginning_cash_balance")
                if matched and beginning_as_of
                else None,
                "beginning_balance_as_of": beginning_as_of if matched else None,
                "ending_balance_as_of": ending_as_of if matched else None,
                "contributions": contributions if matched and start else None,
                "total_expenditures": amounts.get("total_expenditures")
                if matched and start
                else None,
                # The held source names expenditures, not a total of all disbursements.
                "total_disbursements": None,
                "total_receipts": amounts.get("total_receipts")
                if matched and start
                else None,
                "ending_cash_balance": amounts.get("ending_cash_balance")
                if matched and ending_as_of
                else None,
                "figures_state": "reported" if matched else "unavailable",
                "figures_copied_at": (filing.captured_at or snapshot.fetch_completed_at)
                if matched and filing is not None
                else None,
                "figures_source_url": filings.viewer_url(filing.filer_kind)
                if matched and filing is not None
                else None,
            }
        )
    return {
        **scope,
        "state": "reported" if rows else "not_reported",
        "reports": rows,
        "snapshot_id": str(snapshot.id),
        "copied_at": snapshot.fetch_completed_at,
        "source_url": filings.directory_url(),
    }


def _candidate_accounts(db: Session, candidate_id: str):
    """Reviewed identity plus election/year/seat evidence; never a name comparison."""
    from datetime import date, datetime
    from zoneinfo import ZoneInfo
    from alethical.api.services import (
        candidate_lookup,
        candidate_legislators,
        independent_spending,
    )
    from alethical.pipeline import campaign_finance_filings as filings

    committee_finance.pin_to_one_view(db)
    profile = candidate_lookup.load_profile(db, candidate_id)
    if profile is None:
        raise HTTPException(404, "No such candidacy is held")
    connection = candidate_legislators.confirmed_legislator(
        db, profile, today=datetime.now(ZoneInfo("America/Chicago")).date()
    )
    try:
        election_year = date.fromisoformat(profile["election"]["date"]).year
    except (KeyError, TypeError, ValueError):
        election_year = None
    scope = {
        "candidate_id": candidate_id,
        "election_year": election_year,
        "link_state": "unconfirmed",
    }
    snapshot = filings.live_filings_snapshot(db)
    if connection is None or election_year is None or snapshot is None:
        return scope, None, set()
    links = independent_spending.confirmed_committees(
        db, UUID(connection["id"]), year=election_year
    )
    filers = (
        db.scalars(
            select(m.CampaignFinanceFiler).where(
                m.CampaignFinanceFiler.snapshot_id == snapshot.id,
                m.CampaignFinanceFiler.registration_number.in_(
                    [link.registration_number for link in links]
                ),
                m.CampaignFinanceFiler.kind
                == m.CampaignFinanceFilerKind.candidate_committee,
            )
        ).all()
        if links
        else []
    )
    numbers = {
        filer.registration_number
        for filer in filers
        if filer.office in {"House", "Senate"}
        and filer.district
        and candidate_legislators._same_legislative_seat(
            profile.get("office", ""), filer.office.lower(), filer.district
        )
    }
    scope["link_state"] = "confirmed" if numbers else "unconfirmed"
    return scope, connection["id"], numbers


def candidate_campaign_finance(db: Session, *, candidate_id: str, year: int):
    from alethical.api.routers import public

    scope, legislator_id, numbers = _candidate_accounts(db, candidate_id)
    empty = {
        **scope,
        "year": year,
        "committees": [],
        "committees_outside_this_year": [],
    }
    if not numbers:
        return empty
    answer = public.legislator_campaign_finance(legislator_id, year=year, db=db).data
    return {
        **answer,
        **scope,
        "committees": [
            item
            for item in answer["committees"]
            if item["registration_number"] in numbers
        ],
        "committees_outside_this_year": [
            item
            for item in answer["committees_outside_this_year"]
            if item["registration_number"] in numbers
        ],
        # The parent person's other races are outside this candidacy's scope.
        "other_office_committees": 0,
    }


def candidate_campaign_finance_years(
    db: Session, *, candidate_id: str, from_year: int, to_year: int
):
    from alethical.api.routers import public

    if from_year > to_year or to_year - from_year + 1 > 20:
        raise HTTPException(422, "Select an ascending span of at most 20 years")
    scope, legislator_id, numbers = _candidate_accounts(db, candidate_id)
    if not numbers:
        return {
            **scope,
            "years": [
                {"year": year, "committees": []}
                for year in range(from_year, to_year + 1)
            ],
        }
    answer = public.legislator_campaign_finance_years(
        legislator_id, from_year=from_year, to_year=to_year, db=db
    ).data
    return {
        **answer,
        **scope,
        "years": [
            {
                **entry,
                "committees": [
                    item
                    for item in entry["committees"]
                    if item["registration_number"] in numbers
                ],
            }
            for entry in answer["years"]
        ],
    }
