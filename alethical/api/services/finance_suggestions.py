"""The Finance dropdown's names and links, without full-directory calculations.

Name matching, source eligibility and ordering stay shared with complete searches.
Bill suggestions use literal words; the full bill search retains spelling expansion.
Counts, donation totals and bill-card details are not part of this projection.
Every group reads the same pinned database view; missing sources stay unavailable.
"""

from sqlalchemy import and_, func, literal, or_, select, union_all
from sqlalchemy.orm import load_only, selectinload

from alethical.api.routers.public import (
    BILL_SEARCH_COLUMNS,
    bill_number_clause,
    get_session_by_slug,
    search_words,
)
from alethical.api.serializers import ai_analysis_payload
from alethical.api.services import campaign_finance_register as register
from alethical.api.services import campaign_finance_search as search
from alethical.api.services import committee_finance, lobbying
from alethical.api.services.finance_name_matching import indexed_discovery_match
from alethical.db import models as m
from alethical.pipeline import campaign_finance_name_summary as summaries
from alethical.pipeline.campaign_finance_reader import ReleaseNoLongerHeld


def _group(kind, rows=(), *, reason=None):
    return {
        "kind": kind,
        "state": "unavailable" if reason else "reported" if rows else "not_reported",
        "reason": reason,
        "results": list(rows),
    }


def money(db, typed: str, limit: int):
    committee_finance.pin_to_one_view(db)
    if len(typed) < search.MIN_QUERY_LENGTH:
        return {
            "state": "unavailable",
            "groups": [
                _group(kind, reason=search.QUERY_TOO_SHORT)
                for kind in (
                    search.PEOPLE,
                    search.COMMITTEES,
                    search.GAVE,
                    search.GOT_PAID,
                    search.GOT_PAID_INDEPENDENT,
                    search.LOBBYISTS,
                    search.PRINCIPALS,
                )
            ],
        }
    try:
        release = committee_finance.current_release(db)
    except ReleaseNoLongerHeld:
        release = None
    groups = [_people(db, typed, limit), _committees(db, typed, limit)]
    groups.extend(_payment_names(db, release, typed, limit))
    pair = lobbying.published_pair(db)
    groups.extend(_lobbying(db, pair, typed, limit))
    return {"state": "reported", "groups": groups}


def _people(db, typed, limit):
    session_id = db.scalar(
        select(m.LegislativeSession.id).where(m.LegislativeSession.is_current.is_(True))
    )
    if session_id is None:
        return _group(search.PEOPLE, reason=search.NO_CURRENT_SESSION)
    person, service, district, chamber = (
        m.Legislator,
        m.LegislatorServicePeriod,
        m.District,
        m.Chamber,
    )
    rows = db.execute(
        select(
            person.id,
            person.full_name,
            chamber.slug.label("chamber"),
            district.code.label("district_code"),
        )
        .join(service, service.legislator_id == person.id)
        .join(district, district.id == service.district_id)
        .join(chamber, chamber.id == service.chamber_id)
        .where(
            service.session_id == session_id,
            service.is_current.is_(True),
            district.code.not_like("%-unknown"),
            indexed_discovery_match(person.full_name, typed),
        )
        .order_by(
            register.name_words_contain(person.full_name, typed).desc(),
            person.sort_name,
            person.id,
        )
        .limit(limit)
    ).all()
    return _group(
        search.PEOPLE,
        [{"kind": "person", **dict(row._mapping), "id": str(row.id)} for row in rows],
    )


def _committees(db, typed, limit):
    # This shared read preserves the register's replaced-row guard and its exact
    # current-only population. Directory filters and subtype inference are unused.
    summary = register.register_summary(db)
    if summary.state != "reported":
        return _group(search.COMMITTEES, reason=summary.reason)
    filer = m.CampaignFinanceFiler
    rows = db.execute(
        select(filer.registration_number, filer.name, filer.kind)
        .where(
            filer.snapshot_id == summary.snapshot_id,
            filer.retained_from_snapshot_id.is_(None),
            indexed_discovery_match(filer.name, typed),
        )
        .order_by(
            register.name_words_contain(filer.name, typed).desc(),
            *register._committee_order(filer, register.SORT_BY_NAME),
        )
        .limit(limit)
    ).all()
    return _group(
        search.COMMITTEES,
        [
            {
                "kind": "committee",
                "registration_number": row.registration_number,
                "name": row.name,
                "filer_kind": row.kind.value,
            }
            for row in rows
        ],
    )


def _payment_names(db, release, typed, limit):
    kinds = {
        search.GAVE: "donor_name",
        search.GOT_PAID: "payee_name",
        search.GOT_PAID_INDEPENDENT: "independent_payee_name",
    }
    if release is None:
        return [
            _group(kind, reason=search.NO_RELEASE) for kind, *_ in search._NAME_GROUPS
        ]
    # Check all complete-build markers in one trip. Complete summaries retain the
    # same per-file row-count guard as the full search, also in one statement.
    built = summaries.complete(
        db,
        [
            (release.file_for(dataset).snapshot_id, kinds[kind])
            for kind, _, dataset, _, _ in search._NAME_GROUPS
        ],
    )
    checks = [
        (kind, release.file_for(dataset), model)
        for kind, _, dataset, model, _ in search._NAME_GROUPS
        if (release.file_for(dataset).snapshot_id, kinds[kind]) in built
    ]
    held = (
        dict(
            zip(
                (kind for kind, _, _ in checks),
                db.execute(
                    select(
                        *[
                            select(func.count())
                            .select_from(model)
                            .where(model.snapshot_id == file.snapshot_id)
                            .scalar_subquery()
                            for _, file, model in checks
                        ]
                    )
                ).one(),
            )
        )
        if checks
        else {}
    )
    groups = []
    for kind, role, dataset, model, column in search._NAME_GROUPS:
        file = release.file_for(dataset)
        if kind in held:
            if held[kind] != file.row_count:
                groups.append(_group(kind, reason="incomplete_source"))
                continue
            summary = summaries.Summary
            column = summary.name
            stmt = select(column).where(
                summary.snapshot_id == file.snapshot_id,
                summary.record_kind == kinds[kind],
            )
        else:
            stmt = (
                select(column)
                .where(model.snapshot_id == file.snapshot_id, column.is_not(None))
                .group_by(column)
            )
        direct_match = register.name_words_contain(column, typed)
        # Direct names always lead. Once they fill the dropdown, spelling work
        # cannot change its answer. The scalar count is a one-time SQL condition,
        # so the expensive branch is not executed at all for that common case.
        direct = (
            stmt.where(direct_match, indexed_discovery_match(column, typed))
            .order_by(column)
            .limit(limit)
            .cte("direct_names")
        )
        direct_count = select(func.count()).select_from(direct).scalar_subquery()
        indirect = (
            stmt.where(
                direct_count < limit,
                ~direct_match,
                indexed_discovery_match(column, typed),
            )
            .order_by(column)
            .limit(limit - direct_count)
            .subquery()
        )
        candidates = union_all(
            select(direct.c[0].label("name"), literal(True).label("direct")),
            select(indirect.c[0].label("name"), literal(False).label("direct")),
        ).subquery()
        names = db.scalars(
            select(candidates.c.name)
            .order_by(candidates.c.direct.desc(), candidates.c.name)
            .limit(limit)
        ).all()
        groups.append(
            _group(
                kind,
                [
                    {"kind": "payment_name", "role": role, "name": name}
                    for name in names
                ],
            )
        )
    return groups


def _lobbying(db, pair, typed, limit):
    if pair is None:
        return [
            _group(kind, reason="no_lobbying_release")
            for kind in (search.LOBBYISTS, search.PRINCIPALS)
        ]
    lobbyist = m.LobbyistRow
    rows = db.execute(
        select(lobbyist.registration_number, lobbyist.name)
        .where(
            lobbyist.snapshot_id == pair.lobbyist_snapshot_id,
            indexed_discovery_match(lobbyist.name, typed),
        )
        .order_by(
            register.name_words_contain(lobbyist.name, typed).desc(),
            lobbyist.name,
            lobbyist.registration_number,
        )
        .limit(limit)
    ).all()
    people = _group(
        search.LOBBYISTS, [{"kind": "lobbyist", **dict(row._mapping)} for row in rows]
    )
    names = lobbying._principal_names(pair)
    rows = db.execute(
        select(names.c.entity_id, names.c.name)
        .where(indexed_discovery_match(names.c.name, typed))
        .order_by(
            register.name_words_contain(names.c.name, typed).desc(),
            names.c.name,
            names.c.entity_id,
        )
        .limit(limit)
    ).all()
    return [
        people,
        _group(
            search.PRINCIPALS,
            [
                {"kind": "principal", "entity_id": int(row.entity_id), "name": row.name}
                for row in rows
            ],
        ),
    ]


def bills(db, typed: str, limit: int):
    if len(typed) < search.MIN_QUERY_LENGTH:
        return []
    session = get_session_by_slug(db, None)
    number = bill_number_clause(typed)
    stmt = m.bill_list_stmt(
        session.id, text_query=typed if number is None else None, directory=True
    )
    # A name fragment must not expand into unrelated bill words. Each significant
    # word matches literally in any of the same three bill text fields. The shared
    # contains predicate escapes %, _ and backslash instead of treating wildcards
    # as a request for unrelated results.
    clause = (
        number
        if number is not None
        else and_(
            *(
                or_(
                    *(
                        register.name_contains(column, word)
                        for column in BILL_SEARCH_COLUMNS
                    )
                )
                for word in search_words(typed)
            )
        )
    )
    if clause is not None:
        stmt = stmt.where(clause)
    stmt = stmt.options(
        load_only(m.Bill.bill_key, m.Bill.file_type, m.Bill.file_number),
        selectinload(
            m.Bill.enrichments.and_(
                m.AIEnrichment.enrichment_type == m.EnrichmentType.bill_summary,
                m.AIEnrichment.is_current.is_(True),
            )
        ),
    ).limit(limit)
    rows = []
    for bill in db.scalars(stmt):
        analysis = ai_analysis_payload(bill.enrichments)
        rows.append(
            {
                "id": bill.bill_key,
                "file_type": bill.file_type,
                "file_number": bill.file_number,
                "ai_analysis": {"short_title": analysis.short_title}
                if analysis
                else None,
            }
        )
    return rows
