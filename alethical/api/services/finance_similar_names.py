"""Similar printed spellings, never inferred identities or combined money.

Candidate matching spans the role's held files, not the selected year. Only the
counts use that year. Three indexed search probes cover the printed name and
expanded/short organization words; returned keys always stay exactly as held.
"""

from __future__ import annotations

import re
from collections import defaultdict
from typing import Literal

from sqlalchemy import false, func, or_, select, text, union
from sqlalchemy.orm import Session

from alethical.api.services import committee_finance, finance_versions
from alethical.api.services import identity_confirmations as identities
from alethical.api.services.finance_payments_under_name import _claims
from alethical.db import models as m
from alethical.pipeline.campaign_finance_reader import ReleaseNoLongerHeld

Role = Literal["donor", "payee", "employer"]
KINDS = {
    "donor": ("donor_name",),
    "payee": ("payee_name", "independent_payee_name"),
    "employer": ("employer_name",),
}
# Search alternatives only. These never rewrite a source key or prove identity.
WORDS = (
    ("association", "assn", "assoc"),
    ("company", "co"),
    ("corporation", "corp"),
    ("incorporated", "inc"),
    ("limited", "ltd"),
)
EXPANDED = {word: group[0] for group in WORDS for word in group}
SHORT = {word: group[1] for group in WORDS for word in group}
SIMILARITY = "0.35"
QUERY_TIMEOUT_MS = "3000"


def probes(name: str) -> tuple[str, ...]:
    """At most 3 probes, independent of name length or abbreviation count."""
    identities._text(name, "Name", identities.MAX_KEY)
    tokens = re.findall(
        r"[^\W_]+", re.sub(r"\bl\s*\.\s*l\s*\.\s*c\b", "llc", name.casefold())
    )
    if not tokens:
        return ()
    expanded = " ".join(EXPANDED.get(word, word) for word in tokens)
    shortened = " ".join(SHORT.get(word, word) for word in tokens)
    return tuple(dict.fromkeys(p for p in (name, expanded, shortened) if p.strip()))


def read(
    db: Session,
    *,
    name: str,
    role: Role,
    year: int | None,
    limit: int,
    offset: int,
    version: str | None,
) -> dict:
    searches = probes(name)
    version = finance_versions.check(db, version, "money", "identity")
    db.execute(
        text(
            "SELECT set_config('statement_timeout', :timeout, true), set_config('pg_trgm.similarity_threshold', :threshold, true)"
        ),
        {"timeout": QUERY_TIMEOUT_MS, "threshold": SIMILARITY},
    )
    release = committee_finance.current_release(db)
    if release is None:
        raise ReleaseNoLongerHeld("No payment files are published")
    candidates = []
    sources = []
    for kind in KINDS[role]:
        printed = identities._PRINTED[kind]
        source = release.file_for(printed.dataset)
        model = printed.model
        # A partially removed file cannot support absence claims or row counts.
        held = db.scalar(
            select(func.count())
            .select_from(model)
            .where(model.snapshot_id == source.snapshot_id)
        )
        if held != source.row_count:
            raise ReleaseNoLongerHeld("The published payment file is not fully held")
        candidates.append(
            select(printed.name.label("name")).where(
                model.snapshot_id == source.snapshot_id,
                printed.name != name,
                or_(*(printed.name.op("%")(query) for query in searches))
                if searches
                else false(),
            )
        )
        sources.append(
            {
                "dataset": printed.dataset.value,
                "snapshot_id": str(source.snapshot_id),
                "source_url": source.source_url,
                "copied_at": release.copied_at(printed.dataset),
            }
        )
    # UNION deduplicates exact spellings, not normalized names. No candidate cap
    # precedes this global alphabetical page; the extra row only proves has_more.
    all_names = (
        union(*candidates).subquery()
        if len(candidates) > 1
        else candidates[0].distinct().subquery()
    )
    names = list(
        db.scalars(
            select(all_names.c.name)
            .order_by(all_names.c.name.collate("C"))
            .offset(offset)
            .limit(limit + 1)
        )
    )
    more = len(names) > limit
    names = names[:limit]
    counts = defaultdict(int)
    confirmed = defaultdict(lambda: defaultdict(int))
    for kind in KINDS[role] if names else ():
        printed = identities._PRINTED[kind]
        model = printed.model
        source = release.file_for(printed.dataset)
        scope = [model.snapshot_id == source.snapshot_id, printed.name.in_(names)]
        if year is not None:
            scope.append(model.year == year)
        for key, count in db.execute(
            select(printed.name, func.count()).where(*scope).group_by(printed.name)
        ):
            counts[key] += count
        # Avoid fingerprinting popular spellings with no active confirmations.
        claimed = list(
            db.scalars(
                select(m.IdentityConfirmation.record_key)
                .where(
                    m.IdentityConfirmation.record_kind == kind,
                    m.IdentityConfirmation.record_key.in_(names),
                    m.IdentityConfirmation.active,
                )
                .distinct()
            )
        )
        if not claimed:
            continue
        claims = _claims(
            kind, printed.name, [*scope, printed.name.in_(claimed)]
        ).subquery()
        for key, entity_id, count in db.execute(
            select(printed.name, claims.c.entity_id, func.count())
            .join(claims, claims.c.row_number == model.row_number)
            .where(*scope, claims.c.entity_id.is_not(None))
            .group_by(printed.name, claims.c.entity_id)
        ):
            confirmed[key][entity_id] += count
    standing = {
        entity_id: identities._today(db, entity_id)
        for by_identity in confirmed.values()
        for entity_id in by_identity
    }
    rows = []
    for key in names:
        totals = defaultdict(int)
        current = {}
        for entity_id, count in confirmed[key].items():
            entity = standing[entity_id]
            current[entity.id] = entity
            totals[entity.id] += count
        rows.append(
            {
                "name": key,
                "records": counts[key],
                "identities": [
                    {**identities._summary(current[entity_id]), "records": count}
                    for entity_id, count in sorted(
                        totals.items(),
                        key=lambda pair: (current[pair[0]].name, str(pair[0])),
                    )
                ],
            }
        )
    return {
        "name": name,
        "role": role,
        "year": year,
        "version": version,
        "release_id": str(release.id),
        "sources": sources,
        "limit": limit,
        "offset": offset,
        "has_more": more,
        "rows": rows,
    }
