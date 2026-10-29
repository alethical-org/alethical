"""Direct, source-backed relations. No traversal or combined money across edges."""

from __future__ import annotations

import hashlib
import json
from typing import Literal

from sqlalchemy import String, case, cast, func, literal, or_, select

from alethical.api.services import (
    committee_finance,
    identity_confirmations as identities,
)
from alethical.api.services import lobbying, tv_ads as station_reader
from alethical.api.services.campaign_finance_search import name_contains
from alethical.api.services.campaign_finance_payments import linkable_committees
from alethical.db import models as m
from alethical.pipeline import campaign_finance_reader as reader

Relationship = Literal[
    "all",
    "contributions",
    "payments",
    "lobbying_representation",
    "campaign_account",
    "station_advertiser",
    "station_payer",
    "station_named",
    "station_agency",
]
RELATIONSHIPS = [
    "contributions",
    "payments",
    "lobbying_representation",
    "campaign_account",
    "station_advertiser",
    "station_payer",
    "station_named",
    "station_agency",
]


def _identity_maps(db):
    confirmations = list(
        db.scalars(select(m.IdentityConfirmation).where(m.IdentityConfirmation.active))
    )
    entities = {
        str(c.entity_id): identities._today(db, c.entity_id) for c in confirmations
    }
    entities = {
        key: entity for key, entity in entities.items() if entity.status == "active"
    }
    identifiers = {
        (c.record_kind, c.record_key): entities[str(c.entity_id)]
        for c in confirmations
        if str(c.entity_id) in entities and c.record_kind not in identities._PRINTED
    }
    printed_entities = {
        kind: {
            str(c.entity_id): entities[str(c.entity_id)]
            for c in confirmations
            if c.record_kind == kind and str(c.entity_id) in entities
        }
        for kind in identities._PRINTED
    }
    return printed_entities, identifiers


def _target(kind, record_id, role=None, version=None):
    if kind in {"person", "organization"}:
        return {"kind": "identity", "id": record_id}
    if kind == "printed_name":
        if role in {"donor", "vendor", "independent_vendor"}:
            return {"kind": "printed_name", "id": record_id, "role": role}
        if role == "agency":
            return {"kind": "agency", "id": station_reader.agency_key(record_id)}
        return None
    if kind == "election":
        # A checked election connection names a specific held race, not a route slug.
        return None
    return {"kind": kind, "id": record_id, **({"version": version} if version else {})}


def _node(kind, record_id, label, *, role=None, version=None, identifiers=None):
    record_id = str(record_id)
    entity = (identifiers or {}).get((kind, record_id))
    if entity:
        kind, record_id, label = entity.kind, str(entity.id), entity.name
    prefix = "identity" if kind in {"person", "organization"} else kind
    key = f"{prefix}:{role + ':' if kind == 'printed_name' and role else ''}{record_id}"
    if version:
        key += ":" + version
    return {
        "key": key,
        "kind": kind,
        "record_id": record_id,
        "label": label,
        "role": role,
        "unresolved": kind == "printed_name",
        **({"version_id": version} if version else {}),
        "target": _target(kind, record_id, role, version),
    }


def _edge(
    relation,
    start,
    end,
    source,
    *,
    key,
    count=1,
    amount=None,
    amount_state="not_applicable",
    first=None,
    last=None,
    undated=0,
    first_year=None,
    last_year=None,
    period_basis="not_applicable",
):
    return {
        "id": relation + ":" + str(key),
        "from": start["key"],
        "to": end["key"],
        "relationship": relation,
        "amount": str(amount) if amount is not None else None,
        "amount_state": amount_state,
        "record_count": count,
        "first_date": first,
        "last_date": last,
        "undated_count": undated,
        "first_year": first_year,
        "last_year": last_year,
        "period_basis": period_basis,
        "source": source,
        "_nodes": [start, end],
    }


def _matches(edge, query, focus):
    return (
        not query
        or any(query.casefold() in n["label"].casefold() for n in edge["_nodes"])
    ) and (not focus or focus in (edge["from"], edge["to"]))


def _column_node(kind, record_id, label, role, identifiers):
    """Five SQL columns for a node, using only explicit identifier confirmations."""
    record_id = cast(record_id, String)
    prefix = "printed_name:" + role + ":" if kind == "printed_name" else kind + ":"
    defaults = [
        literal(prefix) + record_id,
        literal(kind),
        record_id,
        label,
        literal(role),
    ]
    mapped = {
        key: entity
        for (held_kind, key), entity in identifiers.items()
        if held_kind == kind
    }
    if not mapped:
        return defaults
    values = [
        {key: "identity:" + str(e.id) for key, e in mapped.items()},
        {key: e.kind for key, e in mapped.items()},
        {key: str(e.id) for key, e in mapped.items()},
        {key: e.name for key, e in mapped.items()},
    ]
    return [
        case(value, value=record_id, else_=default)
        for value, default in zip(values, defaults)
    ] + [literal(role)]


def _money(db, release, kind, *, entities, identifiers, query, year, focus, take):
    spec = identities._PRINTED[kind]
    model = spec.model
    source = release.file_for(spec.dataset)
    is_gift = kind == "donor_name"
    role = {
        "donor_name": "donor",
        "payee_name": "vendor",
        "independent_payee_name": "independent_vendor",
    }[kind]
    name = model.contributor if is_gift else model.vendor_name
    date = model.receipt_date if is_gift else model.transaction_date
    number = (
        model.recipient_reg_num
        if is_gift
        else model.committee_reg_num
        if kind == "payee_name"
        else model.spender_reg_num
    )
    account_name = (
        model.recipient
        if is_gift
        else model.committee_name
        if kind == "payee_name"
        else model.spender
    )
    account = _column_node(
        "committee",
        number,
        func.coalesce(account_name, literal("Committee ") + number),
        "committee",
        identifiers,
    )
    unnamed_account = _column_node(
        "printed_name", account_name, account_name, "recipient", identifiers
    )
    account = [
        case((number.is_not(None), a), else_=b)
        for a, b in zip(account, unnamed_account)
    ]
    printed = _column_node("printed_name", name, name, role, identifiers)
    if is_gift:
        held_filers = linkable_committees(
            db,
            release,
            db.scalars(
                select(model.contrib_reg_num)
                .where(
                    model.snapshot_id == source.snapshot_id,
                    model.contrib_reg_num.is_not(None),
                )
                .distinct()
            ).all(),
        )
        registered = _column_node(
            "committee",
            model.contrib_reg_num,
            func.coalesce(name, literal("Committee ") + model.contrib_reg_num),
            "committee",
            identifiers,
        )
        printed = [
            case((model.contrib_reg_num.in_(held_filers), a), else_=b)
            for a, b in zip(registered, printed)
        ]
    confirmation, record = m.IdentityConfirmation, m.IdentityConfirmedRecord
    entity_key = cast(confirmation.entity_id, String)
    if entities:
        values = [
            {key: "identity:" + str(e.id) for key, e in entities.items()},
            {key: e.kind for key, e in entities.items()},
            {key: str(e.id) for key, e in entities.items()},
            {key: e.name for key, e in entities.items()},
        ]
        printed = [
            case(value, value=entity_key, else_=default)
            for value, default in zip(values, printed)
        ] + [literal(role)]
    start, end = (printed, account) if is_gift else (account, printed)
    names = [
        f"{side}_{field}"
        for side in ("from", "to")
        for field in ("key", "kind", "id", "label", "role")
    ]
    columns = [value.label(label) for value, label in zip(start + end, names)]
    base = (
        select(*columns, model.amount, date.label("date"), model.year)
        .select_from(model)
        .where(
            model.snapshot_id == source.snapshot_id,
            name.is_not(None),
            or_(number.is_not(None), account_name.is_not(None)),
        )
    )
    if entities:
        base = base.outerjoin(
            record, (record.fingerprint == spec.fingerprint(kind)) & record.active
        ).outerjoin(
            confirmation,
            (confirmation.id == record.confirmation_id)
            & confirmation.active
            & (confirmation.record_kind == kind)
            & (confirmation.record_key == name),
        )
    if is_gift:
        base = base.where(model.receipt_type == "Contribution")
    if year is not None:
        base = base.where(model.year == year)
    rows = base.subquery()
    where = []
    if query:
        where.append(
            or_(
                name_contains(rows.c.from_label, query),
                name_contains(rows.c.to_label, query),
            )
        )
    if focus:
        where.append(or_(rows.c.from_key == focus, rows.c.to_key == focus))
    all_amounts = func.count(rows.c.amount) == func.count()
    all_dates = func.count(rows.c.date) == func.count()
    all_years = func.count(rows.c.year) == func.count()
    whole_period = all_dates | all_years
    grouped = (
        select(
            *(rows.c[name] for name in names),
            func.count().label("count"),
            case(
                (all_amounts & whole_period, func.sum(rows.c.amount)),
                else_=None,
            ).label("amount"),
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
            func.min(rows.c.date).label("first"),
            func.max(rows.c.date).label("last"),
            (func.count() - func.count(rows.c.date)).label("undated"),
        )
        .where(*where)
        .group_by(*(rows.c[name] for name in names))
        .subquery()
    )
    total = db.scalar(select(func.count()).select_from(grouped))
    selected = db.execute(
        select(grouped)
        .order_by(
            grouped.c.from_key,
            grouped.c.to_key,
            grouped.c.from_label,
            grouped.c.to_label,
        )
        .limit(take)
    )
    result = []
    relation = "contributions" if is_gift else "payments"
    for row in selected:
        data = row._mapping
        nodes = [
            _node(
                data[side + "_kind"],
                data[side + "_id"],
                data[side + "_label"],
                role=data[side + "_role"],
            )
            for side in ("from", "to")
        ]
        key = hashlib.sha256(
            json.dumps(
                [source.dataset.value, year] + [data[n] for n in names],
                ensure_ascii=False,
            ).encode()
        ).hexdigest()
        result.append(
            _edge(
                relation,
                nodes[0],
                nodes[1],
                {
                    "dataset": source.dataset.value,
                    "snapshot_id": str(source.snapshot_id),
                    "url": source.source_url,
                    "copied_at": release.copied_at(spec.dataset),
                },
                key=key,
                count=data["count"],
                amount=data["amount"],
                amount_state=data["amount_state"],
                first=data["first"],
                last=data["last"],
                undated=data["undated"],
                first_year=data["first_year"],
                last_year=data["last_year"],
                period_basis=data["period_basis"],
            )
        )
    years = db.scalars(
        select(model.year)
        .where(model.snapshot_id == source.snapshot_id, model.year.is_not(None))
        .distinct()
    ).all()
    return result, total, years


def _accounts(db, identifiers, year):
    link = m.LegislatorCampaignCommittee
    edges = []
    for row, person in db.execute(
        select(link, m.Legislator)
        .join(m.Legislator, m.Legislator.id == link.legislator_id)
        .where(
            link.decision == m.CommitteeLinkReviewDecision.confirmed,
            link.withdrawn_at.is_(None),
        )
    ):
        first, last = row.first_year_as_reviewed, row.last_year_as_reviewed
        if year is not None and not (
            first
            and last
            and first.isdigit()
            and last.isdigit()
            and int(first) <= year <= int(last)
        ):
            continue
        edges.append(
            _edge(
                "campaign_account",
                _node(
                    "legislator", person.id, person.full_name, identifiers=identifiers
                ),
                _node(
                    "committee",
                    row.registration_number,
                    row.committee_name_as_reviewed,
                    role="committee",
                    identifiers=identifiers,
                ),
                {
                    "dataset": "campaign_committee_confirmation",
                    "url": None,
                    "copied_at": row.reviewed_at,
                    "first_year": first,
                    "last_year": last,
                },
                key=row.id,
            )
        )
    return edges


def _lobbying(db, identifiers, year):
    pair = lobbying.published_pair(db)
    if pair is None:
        return [], False
    # The active list does not establish a historical representation interval.
    if year is not None:
        return [], True
    edges = []
    for association, lobbyist in db.execute(
        select(m.LobbyistAssociation, m.LobbyistRow)
        .join(
            m.LobbyistRow,
            (m.LobbyistRow.snapshot_id == m.LobbyistAssociation.snapshot_id)
            & (
                m.LobbyistRow.registration_number
                == m.LobbyistAssociation.registration_number
            ),
        )
        .where(m.LobbyistAssociation.snapshot_id == pair.lobbyist_snapshot_id)
    ):
        edges.append(
            _edge(
                "lobbying_representation",
                _node(
                    "lobbyist",
                    lobbyist.registration_number,
                    lobbyist.formatted_name,
                    identifiers=identifiers,
                ),
                _node(
                    "principal",
                    association.entity_id,
                    association.principal_name,
                    identifiers=identifiers,
                ),
                {
                    "dataset": "lobbyist_register",
                    "snapshot_id": str(pair.lobbyist_snapshot_id),
                    "url": pair.lobbyist_source_url,
                    "copied_at": pair.copied_at,
                },
                key=f"{lobbyist.registration_number}:{association.position}",
            )
        )
    return edges, True


@station_reader.projection
def _station_edges(db, identifiers, year):
    documents = db.info["tv_projection"]["documents"]
    checks = station_reader._original_checks(db)
    edges, years = [], set()
    fields = {
        "agency_name": ("station_agency", "agency"),
        "advertiser": ("station_advertiser", "advertiser"),
        "payer": ("station_payer", "payer"),
    }
    for version, document in documents.items():
        if document.year is not None:
            years.add(document.year)
        if year is not None and year != document.year:
            continue
        file_key = station_reader.file_key(document.facility_id, document.file_id)
        file = _node("file", file_key, document.name, version=document.content_hash)
        source = {
            "dataset": "station_file",
            "url": document.url,
            "copied_at": document.first_seen_at,
            "file_key": file_key,
            "version_id": document.content_hash,
        }
        for fact in checks["facts"].get(version, []):
            if fact.status != "checked" or fact.field not in fields:
                continue
            relation, role = fields[fact.field]
            edges.append(
                _edge(
                    relation,
                    _node("printed_name", fact.value, fact.value, role=role),
                    file,
                    {**source, "page": fact.page, "quote": fact.quote},
                    key=fact.id,
                )
            )
        for connection in checks["connections"].get(version, []):
            if connection.status != "checked" or connection.kind not in {
                "committee",
                "candidate",
                "principal",
                "election",
            }:
                continue
            snapshot = connection.target_snapshot or {}
            role = str(snapshot.get("role") or "named").casefold()
            relation = "station_" + (
                role if role in {"advertiser", "payer"} else "named"
            )
            edges.append(
                _edge(
                    relation,
                    _node(
                        connection.kind,
                        connection.target_id,
                        str(snapshot.get("label") or connection.target_id),
                        identifiers=identifiers,
                    ),
                    file,
                    {**source, "page": connection.page, "quote": connection.quote},
                    key=connection.id,
                )
            )
    return edges, years


def connections(
    db,
    *,
    query="",
    year=None,
    relationship: Relationship = "all",
    focus=None,
    limit=100,
    offset=0,
):
    committee_finance.pin_to_one_view(db)
    entities, identifiers = _identity_maps(db)
    edges, total, years, unavailable = [], 0, set(), []
    release = None
    take = offset + limit
    if relationship in {"all", "contributions", "payments"}:
        try:
            release = committee_finance.current_release(db)
            if release is None:
                unavailable.append("campaign_finance")
            else:
                for kind in ("donor_name", "payee_name", "independent_payee_name"):
                    if relationship != "all" and (kind == "donor_name") != (
                        relationship == "contributions"
                    ):
                        continue
                    try:
                        reader._refuse_if_rows_are_gone(
                            db, release, identities._PRINTED[kind].dataset
                        )
                    except reader.ReleaseNoLongerHeld:
                        unavailable.append(identities._PRINTED[kind].dataset.value)
                        continue
                    found, count, held_years = _money(
                        db,
                        release,
                        kind,
                        entities=entities[kind],
                        identifiers=identifiers,
                        query=query,
                        year=year,
                        focus=focus,
                        take=take,
                    )
                    edges.extend(found)
                    total += count
                    years.update(held_years)
        except reader.ReleaseNoLongerHeld:
            unavailable.append("campaign_finance")
    other = []
    if relationship in {"all", "campaign_account"}:
        other.extend(_accounts(db, identifiers, year))
    if relationship in {"all", "lobbying_representation"}:
        found, available = _lobbying(db, identifiers, year)
        other.extend(found)
        if not available:
            unavailable.append("lobbying")
    if relationship == "all" or relationship.startswith("station_"):
        found, held_years = _station_edges(db, identifiers, year, originals=True)
        other.extend(found)
        years.update(held_years)
    other = [
        e
        for e in other
        if (relationship == "all" or e["relationship"] == relationship)
        and _matches(e, query, focus)
    ]
    total += len(other)
    edges.extend(other)
    # Same node-key ordering as each bounded payment query; no omitted edge can
    # sort before the selected global page. Sources and IDs break all ties.
    edges.sort(
        key=lambda e: (
            e["from"],
            e["to"],
            e["_nodes"][0]["label"],
            e["_nodes"][1]["label"],
            e["source"]["dataset"],
            e["id"],
        )
    )
    selected = edges[offset : offset + limit]
    nodes = {n["key"]: n for e in selected for n in e["_nodes"]}
    if release is not None:
        money_nodes = {
            n["key"]: n
            for e in selected
            if e["relationship"] in {"contributions", "payments"}
            for n in e["_nodes"]
            if n["kind"] == "committee"
        }
        linkable = linkable_committees(
            db, release, [n["record_id"] for n in money_nodes.values()]
        )
        for key, node in money_nodes.items():
            if node["record_id"] not in linkable:
                nodes[key]["target"] = None
    return {
        "state": "partial"
        if unavailable and total
        else "unavailable"
        if unavailable
        else "reported"
        if total
        else "not_reported",
        "nodes": list(nodes.values()),
        "edges": [{k: v for k, v in e.items() if k != "_nodes"} for e in selected],
        "total": total,
        "has_more": offset + len(selected) < total,
        "limit": limit,
        "offset": offset,
        "q": query,
        "year": year,
        "relationship": relationship,
        "focus": focus,
        "years": sorted(years, reverse=True),
        "relationships": RELATIONSHIPS,
        "unavailable_sources": unavailable,
    }
