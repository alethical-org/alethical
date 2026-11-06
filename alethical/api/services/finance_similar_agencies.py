"""Similar agency labels over the same held originals as Finance's agency list."""

from __future__ import annotations

import json
from collections import defaultdict
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.orm import Session

from alethical.api.services import finance_similar_names as spelling
from alethical.api.services import finance_versions
from alethical.api.services import tv_ads as reader
from alethical.api.services.identity_confirmations import IdentityError
from alethical.api.services.finance_name_matching import closeness, strong_spelling

MAX_NAMES = 20_000
MINNESOTA = ZoneInfo("America/Chicago")


class Unavailable(Exception):
    """The full candidate catalogue cannot be served within this read's bounds."""


@reader.projection
def _read(db, key, limit, offset, excluded_keys=(), strong_only=False):
    # Reuse the exact same names/version/check rules as the agency browse list.
    # A check for one name, address, file or version never checks another.
    groups = defaultdict(set)
    unchecked = defaultdict(bool)
    # The Minnesota days a name's shown checks were made on, across its files; a
    # checked file with no shown check time adds None.
    checked_on = defaultdict(set)
    for current in reader._latest_copies(db):
        for name, (version, pending) in reader._names_by_version(db, current).items():
            groups[name].add((current.facility_id, current.file_id))
            unchecked[name] |= pending
            if not pending:
                times = reader.agency_check_times(db, version, name)
                checked_on[name] |= {
                    when.astimezone(MINNESOTA).date() for when in times
                } or {None}
            if len(groups) > MAX_NAMES:
                raise Unavailable
    name = next((value for value in groups if reader.agency_key(value) == key), None)
    if name is None:
        raise LookupError("Not found")
    # The complete catalogue is already held and bounded. A weak-similarity
    # cutoff must never discard a spelling accepted by the stronger rule.
    strong = {
        label for label in groups if label != name and strong_spelling(name, label)
    }
    if strong_only:
        return {"key": key, "name": name, "names": sorted(strong)}
    try:
        probes = spelling.probes(name)
    except IdentityError as exc:
        raise Unavailable from exc
    names = []
    if probes:
        # Search the complete held set before A-Z paging. This bounded in-memory
        # catalogue adds no unindexed similarity scan over a source table.
        predicate = " OR ".join(f"name % :probe{i}" for i in range(len(probes)))
        names = list(
            db.scalars(
                text(
                    "SELECT name FROM jsonb_array_elements_text(CAST(:names AS jsonb)) AS n(name) "
                    "WHERE name != :name AND (" + predicate + ") "
                    'ORDER BY name COLLATE "C"'
                ),
                {
                    "names": json.dumps(list(groups)),
                    "name": name,
                    **{f"probe{i}": probe for i, probe in enumerate(probes)},
                },
            )
        )
    names = list(set(names) | strong)
    excluded = set(excluded_keys)
    names = [label for label in names if reader.agency_key(label) not in excluded]
    names.sort(key=lambda label: (-closeness(name, label), label))
    names = names[offset : offset + limit + 1]
    return {
        "key": key,
        "name": name,
        "limit": limit,
        "offset": offset,
        "excluded_keys": sorted(excluded),
        "has_more": len(names) > limit,
        "rows": [
            {
                "key": reader.agency_key(label),
                "label": label,
                "file_count": len(groups[label]),
                "stations": sorted(
                    {
                        reader.STATIONS[facility].call_sign
                        for facility, _ in groups[label]
                    }
                ),
                "unchecked": unchecked[label],
                # A date only when every file is checked and all were checked on
                # the same Minnesota day; 1 date is never a check of other files.
                "checked_on": next(iter(checked_on[label])).isoformat()
                if not unchecked[label]
                and len(checked_on[label]) == 1
                and None not in checked_on[label]
                else None,
            }
            for label in names[:limit]
        ],
    }


@reader.projection
def _complete_read(db, key, limit, offset, excluded_keys=(), strong_only=False):
    result = _read(db, key, limit, offset, excluded_keys, strong_only, originals=True)
    if strong_only:
        result["spellings"] = [
            reader.agency_detail(db, reader.agency_key(name), originals=True)
            for name in result.pop("names")
        ]
    return result


def read(
    db: Session,
    *,
    key: str,
    limit: int,
    offset: int,
    version: str | None,
    excluded_keys: tuple[str, ...] | list[str] = (),
    strong_only: bool = False,
) -> dict:
    token = finance_versions.check(db, version, "station")
    if version is None:
        excluded_keys = ()
    db.execute(
        text(
            "SELECT set_config('statement_timeout', :timeout, true), set_config('pg_trgm.similarity_threshold', :threshold, true)"
        ),
        {"timeout": spelling.QUERY_TIMEOUT_MS, "threshold": spelling.SIMILARITY},
    )
    result = _complete_read(
        db, key, limit, offset, excluded_keys, strong_only, originals=True
    )
    return {"version": token, **result}
