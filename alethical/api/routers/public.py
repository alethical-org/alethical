from __future__ import annotations

import re
from collections import Counter, defaultdict
from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal
from uuid import UUID

import requests
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import and_, case, func, or_, select, text, tuple_
from sqlalchemy.orm import Session

from alethical.api.auth import get_optional_current_user
from alethical.api.issue_taxonomy import aliases_for
from alethical.api.problems import problem_exception
from alethical.api.rate_limit import rate_limit
from alethical.api.schemas import (
    CollectionResponse,
    DetailResponse,
    MetaPayload,
    RepresentativeLookupRequest,
)
from alethical.api.serializers import (
    ai_analysis_payload_for_enrichment,
    bill_list_item,
    bill_progress_payload,
    companion_payload,
    current_bill_summary_enrichment,
    current_service_payload,
    district_payload,
    legislator_list_item,
    section_chip_topic,
    service_history_payload,
    sponsor_payloads,
    tracking_payload,
)
from alethical.api.services.representative_lookup import (
    DistrictMatch,
    RepresentativeLookupNotFound,
    RepresentativeLookupService,
    RepresentativeLookupUpstreamError,
    get_representative_lookup_service,
)
from alethical.db.schema import load_schema
from alethical.db.session import get_db
from alethical.pipeline.policy_area_counts import compute_policy_area_counts
from alethical.pipeline.sessions import SESSION_DEFINITIONS, special_session_number

schema = load_schema()
Bill = schema.Bill
BillAction = schema.BillAction
AIEnrichment = schema.AIEnrichment
BillVersion = schema.BillVersion
BillVersionSection = schema.BillVersionSection
Chamber = schema.Chamber
ChamberType = schema.ChamberType
Committee = schema.Committee
CommitteeMembership = schema.CommitteeMembership
District = schema.District
EnrichmentType = schema.EnrichmentType
IngestionRun = schema.IngestionRun
IngestionStatus = schema.IngestionStatus
Jurisdiction = schema.Jurisdiction
LegislativeSession = schema.LegislativeSession
Legislator = schema.Legislator
LegislatorServicePeriod = schema.LegislatorServicePeriod
Sponsorship = schema.Sponsorship
SponsorshipRole = schema.SponsorshipRole
bill_detail_stmt = schema.bill_detail_stmt
bill_list_stmt = schema.bill_list_stmt
find_my_legislator_stmt = schema.find_my_legislator_stmt
legislator_directory_stmt = schema.legislator_directory_stmt
legislator_profile_stmt = schema.legislator_profile_stmt
legislator_sponsored_bills_stmt = schema.legislator_sponsored_bills_stmt

router = APIRouter()

# Public record reads (bills/legislators lists and detail) change only when
# ingestion runs — human-triggered and infrequent — so they carry a short
# shared-cache TTL with a longer stale-while-revalidate window. This lets the
# browser serve repeat loads instantly and lets a CDN, once in front of the API,
# absorb the first hit for everyone (the ~1s cost today is the DB query, not the
# network). Responses that vary by user (tracking state) are never cached.
PUBLIC_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=300"
PRIVATE_CACHE_CONTROL = "private, no-store"


def paginated_scalars(db: Session, stmt, *, limit: int, offset: int):
    if limit == 0:
        return [], False
    rows = db.scalars(stmt.offset(offset).limit(limit + 1)).all()
    return rows[:limit], len(rows) > limit


def paginated_scalars_with_total(db: Session, stmt, *, limit: int, offset: int):
    """Fetch a page of entities *and* the full filtered total in one round trip.

    Appends ``count(*) OVER ()`` as a trailing column so the total for the whole
    filtered set rides back with the page rows -- avoiding a separate
    ``COUNT(*)`` query, which re-evaluates the same (potentially expensive)
    WHERE and costs an extra cross-region round trip. On the Search Bills page,
    where every filter-chip tap fires a fresh request, dropping that second
    round trip measurably cuts the per-tap latency (#492).

    Returns ``(rows, has_more, total)``. The entity stays the first result
    column, so ``selectinload`` eager-loads still fire exactly as before.
    """
    if limit == 0:
        total = db.scalar(
            select(func.count()).select_from(stmt.order_by(None).subquery())
        )
        return [], False, total
    windowed = stmt.add_columns(func.count().over()).offset(offset).limit(limit + 1)
    result = db.execute(windowed).all()
    if not result:
        # An empty page (e.g. offset past the end, or a genuinely zero-result
        # filter) carries no window row to read the count from, so fall back to
        # a standalone COUNT for a correct total. Rare and cheap -- the common
        # path (rows present) stays a single round trip.
        total = db.scalar(
            select(func.count()).select_from(stmt.order_by(None).subquery())
        )
        return [], False, total
    rows = [row[0] for row in result[:limit]]
    has_more = len(result) > limit
    total = result[0][1]
    return rows, has_more, total


def authored_bill_counts(db: Session, legislator_ids) -> dict[str, tuple[int, int]]:
    """Live authored-bill counts (total, chief) for the given rows, counted
    directly from Sponsorship in one grouped query -- no per-row N+1. Returns
    {legislator_id: (total_bill_count, chief_bill_count)}.

    Since #302 merged the duplicate bill-author rows into their roster row, every
    member's sponsorships live on the single canonical row, so this counts
    Sponsorship on each requested id directly (no more suffix self-join to a
    separate placeholder row)."""
    ids = list(legislator_ids)
    if not ids:
        return {}
    rows = db.execute(
        select(
            Sponsorship.legislator_id,
            func.count(func.distinct(Sponsorship.bill_id)).label("total"),
            func.count(
                func.distinct(
                    case(
                        (
                            Sponsorship.role == SponsorshipRole.chief_author,
                            Sponsorship.bill_id,
                        )
                    )
                )
            ).label("chief"),
        )
        .where(Sponsorship.legislator_id.in_(ids))
        .group_by(Sponsorship.legislator_id)
    ).all()
    return {str(row.legislator_id): (row.total, row.chief) for row in rows}


def bill_co_author_counts(db: Session, bill_ids) -> dict[str, int]:
    """Co-author count per bill -- distinct legislators with a co_author-role
    sponsorship, excluding the chief author and the distinct 'sponsor' role
    (grounded-answers rule 3, MN author/co-author terminology). Computed set-wise
    in one grouped query for the whole page (no per-row N+1). Feeds the Search
    Bills card's "+N co-authors" line (#295). Returns {bill_id: count}."""
    ids = list(bill_ids)
    if not ids:
        return {}
    rows = db.execute(
        select(
            Sponsorship.bill_id,
            func.count(func.distinct(Sponsorship.legislator_id)),
        )
        .where(
            Sponsorship.bill_id.in_(ids),
            Sponsorship.role == SponsorshipRole.co_author,
        )
        .group_by(Sponsorship.bill_id)
    ).all()
    return {str(bill_id): count for bill_id, count in rows}


def current_committee_names(db: Session, legislator_ids) -> dict[str, list[str]]:
    """Current committee names per directory row, in one grouped query (no N+1).

    Unlike sponsorships (which live on the bill-author row, see
    authored_bill_counts), committee memberships are scraped onto the roster row
    shown in the directory, so we read them directly off the requested ids.
    Returns {legislator_id: [committee_name, ...]} ordered by name."""
    ids = list(legislator_ids)
    if not ids:
        return {}
    rows = db.execute(
        select(CommitteeMembership.legislator_id, Committee.name)
        .join(Committee, Committee.id == CommitteeMembership.committee_id)
        .where(
            CommitteeMembership.legislator_id.in_(ids),
            CommitteeMembership.is_current.is_(True),
        )
        .order_by(Committee.name.asc())
    ).all()
    result: dict[str, list[str]] = {}
    for legislator_id, name in rows:
        result.setdefault(str(legislator_id), []).append(name)
    return result


_BILL_NUMBER_QUERY_RE = re.compile(r"^\s*([A-Za-z]{2})?\s*0*(\d+)\s*$")


def bill_number_clause(q: str):
    """Match a bill-number query against file_type + file_number so bill-number
    searches resolve (#134). The chamber prefix is optional: "HF 2904" / "HF2904"
    / "SF 1832" resolve that chamber's bill, while a bare number ("5209") resolves
    the bill with that file number in either chamber — users need not know the
    HF/SF prefix. Returns None when the query isn't a bill number, leaving keyword
    search untouched."""
    match = _BILL_NUMBER_QUERY_RE.match(q)
    if match is None:
        return None
    file_type, file_number = match.group(1), int(match.group(2))
    if file_type is None:
        return Bill.file_number == file_number
    return and_(
        func.lower(Bill.file_type) == file_type.lower(),
        Bill.file_number == file_number,
    )


# Keyword search normalization (#571, #573). A raw ``ILIKE %q%`` is a contiguous
# substring match, so "plumbing" finds nothing when the text says "plumbers"
# even though both share the root "plumb", and "school funding" only matches when
# those two words are adjacent. We instead (a) split the query into words and
# require each to match at least one column (order-independent), (b) match a
# conservatively stemmed root of each word as well, so inflected variants
# (plurals, -ing/-ed/-er) resolve to the same stem, and (c) match a trigram
# word-similarity ("%>") branch so a misspelling ("plumbign") still resolves via
# the pg_trgm GIN indexes (0011). Every clause is ORed against the raw word too,
# so the match set is a strict superset of the old behavior — no result that
# matched before can disappear.

# Common English inflectional suffixes, longest first. Stripped only when the
# word is long enough (>= _MIN_STEM_WORD) and the remaining root stays
# meaningful (>= _MIN_ROOT_LEN), so short words ("tax", "art") are left alone.
_INFLECTION_SUFFIXES = ("ings", "ing", "ers", "er", "ies", "es", "ed", "s")
_MIN_STEM_WORD = 5
_MIN_ROOT_LEN = 4
# Only add the fuzzy trigram branch for words this long: short words have too few
# trigrams for word-similarity to be meaningful (it would over-match), and a
# typo in a 3-letter word is cheap to just retype. Longer words are where a
# misspelling actually costs the user a "0 results".
_MIN_FUZZY_WORD = 5


def _stem_root(word: str) -> str | None:
    """Return a conservatively stemmed root for ``word``, or None when no safe
    stem applies. Used only to broaden matching (never to replace the raw word),
    so an over-eager stem can add a few extra matches but can't hide one."""
    lowered = word.lower()
    if len(lowered) < _MIN_STEM_WORD:
        return None
    for suffix in _INFLECTION_SUFFIXES:
        if lowered.endswith(suffix):
            root = lowered[: -len(suffix)]
            if len(root) >= _MIN_ROOT_LEN:
                return root
    return None


def _like_escape(value: str) -> str:
    """Escape LIKE wildcards so a user's literal % or _ isn't treated as one."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def keyword_search_clause(columns, q: str):
    """Case-insensitive keyword match over ``columns`` for query ``q``. Each word
    in ``q`` must match at least one column — as a raw substring, via its stemmed
    root, or (for longer words) via trigram word-similarity so typos still
    resolve. All words must match (AND). Returns None for an empty query."""
    words = [word for word in q.split() if word]
    if not words:
        return None
    per_word = []
    for word in words:
        patterns = [f"%{_like_escape(word)}%"]
        root = _stem_root(word)
        if root is not None:
            patterns.append(f"%{_like_escape(root)}%")
        clauses = [
            col.ilike(pattern, escape="\\") for col in columns for pattern in patterns
        ]
        if len(word) >= _MIN_FUZZY_WORD:
            # ``col %> word`` is ``word_similarity(word, col) > threshold`` — a
            # trigram fuzzy match served by the pg_trgm GIN index (0011). It
            # catches misspellings the substring/root branches miss.
            clauses.extend(col.op("%>")(word) for col in columns)
        per_word.append(or_(*clauses))
    return and_(*per_word)


def latest_ingested_at(db: Session):
    """Newest succeeded-ingestion finish time — the "Data as of" provenance
    timestamp shown on the bill search screen and Ask answer pages (#134)."""
    return db.scalar(
        select(func.max(IngestionRun.finished_at)).where(
            IngestionRun.status == IngestionStatus.succeeded
        )
    )


def get_session_by_slug(db: Session, slug: str | None):
    if slug:
        session_row = db.scalar(
            select(LegislativeSession).where(LegislativeSession.slug == slug)
        )
    else:
        session_row = db.scalar(
            select(LegislativeSession).where(LegislativeSession.is_current.is_(True))
        )
    if session_row is None:
        raise HTTPException(status_code=404, detail="session not found")
    return session_row


def get_bill_by_key(db: Session, bill_key: str):
    bill = db.scalar(select(Bill).where(Bill.bill_key == bill_key))
    if bill is None:
        raise HTTPException(status_code=404, detail="bill not found")
    return bill


def get_legislator_by_id(db: Session, legislator_id: str):
    try:
        parsed_id = UUID(legislator_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="legislator not found") from None
    legislator = db.scalar(select(Legislator).where(Legislator.id == parsed_id))
    if legislator is None:
        raise HTTPException(status_code=404, detail="legislator not found")
    return legislator


def member_name_by_legislator(db: Session, legislator_ids) -> dict[str, str]:
    """Full name per legislator id, batched in one query for a whole roll call
    (no per-member N+1). Feeds the /votes per-member records (#83)."""
    ids = list(legislator_ids)
    if not ids:
        return {}
    rows = db.execute(
        select(Legislator.id, Legislator.full_name).where(Legislator.id.in_(ids))
    ).all()
    return {str(legislator_id): full_name for legislator_id, full_name in rows}


def member_party_by_legislator(db: Session, legislator_ids) -> dict[str, str | None]:
    """Current/latest party per legislator id, batched in one query for a whole
    roll call (no per-member N+1). Picks each legislator's current period, else
    the most recent one (ORDER BY is_current DESC, start_date DESC NULLS LAST),
    via DISTINCT ON. Party is served raw (prod has 'DFL', 'R', and a stray
    'Republican'). Feeds the /votes per-member records (#83)."""
    ids = list(legislator_ids)
    if not ids:
        return {}
    rows = db.execute(
        select(
            LegislatorServicePeriod.legislator_id,
            LegislatorServicePeriod.party,
        )
        .where(LegislatorServicePeriod.legislator_id.in_(ids))
        .distinct(LegislatorServicePeriod.legislator_id)
        .order_by(
            LegislatorServicePeriod.legislator_id,
            LegislatorServicePeriod.is_current.desc(),
            LegislatorServicePeriod.start_date.desc().nullslast(),
        )
    ).all()
    return {str(legislator_id): party for legislator_id, party in rows}


def chamber_slug_by_id(db: Session, chamber_ids) -> dict[str, str | None]:
    """Chamber slug ("house"/"senate") per chamber id, batched for a whole roll
    call. VoteEvent.chamber_id is NOT NULL, so every roll call resolves to a
    definitive chamber — the reliable signal for the Votes tab's chamber label
    and consistent per-member honorifics (Sen./Rep.), far safer than inferring
    chamber from the tally total (a sparse House roll can total < 100)."""
    ids = {cid for cid in chamber_ids if cid is not None}
    if not ids:
        return {}
    rows = db.execute(select(Chamber.id, Chamber.slug).where(Chamber.id.in_(ids))).all()
    return {str(chamber_id): slug for chamber_id, slug in rows}


def tracking_user_id(include_set: set[str], current_user):
    if "tracking" not in include_set:
        return None
    if current_user is None:
        raise problem_exception(
            401, "Unauthorized", "Authentication required to include tracking state"
        )
    return current_user.id


def district_for_match(db: Session, match: DistrictMatch | None):
    if match is None:
        return None
    if match.chamber == "house":
        chamber_type = ChamberType.house
    elif match.chamber == "senate":
        chamber_type = ChamberType.senate
    else:
        return None
    return db.scalar(
        select(District)
        .join(Chamber, Chamber.id == District.chamber_id)
        .where(
            District.code == match.district_code.upper(),
            Chamber.chamber_type == chamber_type,
        )
    )


def status_filter_clause(status: str):
    """Filter bills to a single status, matching the list-card badge exactly.

    Reads the precomputed ``Bill.status_key`` column, which the DB triggers
    maintain from the exact ``bill_status_key_expr`` cascade the displayed badge
    uses, and keeps only the bills whose key equals the selected status. Because
    every bill maps to exactly one status, the filters are mutually exclusive and
    their counts sum to the session total. An unrecognized status matches
    nothing, which is correct — it has no bills. "Passed both chambers" (with a
    space, from the frontend dropdown) normalizes to ``passed_both_chambers``
    (#607).
    """
    normalized = status.strip().lower().replace(" ", "_")
    # Read the precomputed status_key column (#505) rather than recomputing the
    # cascade per row. The DB triggers maintain it from the exact
    # ``bill_status_key_expr`` cascade, so the classification is identical.
    return Bill.status_key == normalized


@router.get("/meta", response_model=DetailResponse)
def meta(db: Session = Depends(get_db)):
    jurisdiction = db.scalar(
        select(Jurisdiction).where(Jurisdiction.slug == "minnesota")
    )
    current_session = db.scalar(
        select(LegislativeSession).where(LegislativeSession.is_current.is_(True))
    )
    payload = MetaPayload(
        api_version="v1",
        jurisdiction={"slug": jurisdiction.slug, "name": jurisdiction.name},
        current_session={
            "slug": current_session.slug,
            "name": current_session.name,
            "is_current": current_session.is_current,
        },
        data_as_of=latest_ingested_at(db),
    )
    return DetailResponse(data=payload, links={"self": "/api/v1/meta"})


@router.get("/sessions", response_model=CollectionResponse)
def sessions(db: Session = Depends(get_db)):
    rows = db.scalars(
        select(LegislativeSession).order_by(LegislativeSession.year_start.desc())
    ).all()
    data = [
        {"slug": row.slug, "name": row.name, "is_current": row.is_current}
        for row in rows
    ]
    return CollectionResponse(
        data=data, page={"limit": len(data), "next_cursor": None, "has_more": False}
    )


@router.get("/sessions/current", response_model=DetailResponse)
def current_session(db: Session = Depends(get_db)):
    row = db.scalar(
        select(LegislativeSession).where(LegislativeSession.is_current.is_(True))
    )
    return DetailResponse(
        data={"slug": row.slug, "name": row.name, "is_current": row.is_current}
    )


@router.get("/policy-areas", response_model=CollectionResponse)
def policy_areas(
    session: str | None = None,
    limit: int = Query(default=50, le=100),
    db: Session = Depends(get_db),
):
    session_row = get_session_by_slug(db, session)
    # The AI enrichment emits ~7,600 distinct free-text policy areas with heavy
    # casing/synonym fragmentation; each raw value rolls up to a curated canonical
    # issue (alethical/api/issue_taxonomy.py) and we count distinct bills per
    # canonical. The canonical display name is what the frontend shows and sends
    # back as the /bills policy_area filter, so the chip count and the filtered
    # total must agree (grounded-answers rule 2). That ~278ms live rollup is
    # precomputed into policy_area_count (refreshed at the end of enrichment --
    # alethical/pipeline/policy_area_counts.py), so read the prepared table here.
    # The stored counts are byte-identical to the live rollup; fall back to
    # computing live for any session never refreshed, so a missing precompute
    # degrades safely to the correct-but-slower path rather than serving nothing.
    rows = db.execute(
        text(
            """
            SELECT canonical_name AS name, bill_count
            FROM policy_area_count
            WHERE session_id = :sid ::uuid
            ORDER BY bill_count DESC, name ASC
            LIMIT :limit
            """
        ),
        {"sid": str(session_row.id), "limit": limit},
    ).all()
    if not rows:
        rows = compute_policy_area_counts(db, session_row.id)[:limit]
    data = [{"name": name, "bill_count": count} for name, count in rows]
    return CollectionResponse(
        data=data,
        page={"limit": limit, "next_cursor": None, "has_more": False},
        links={"self": "/api/v1/policy-areas"},
    )


@router.get("/bills", response_model=CollectionResponse)
def bills(
    session: str | None = None,
    q: str | None = None,
    chamber: str | None = None,
    status: str | None = None,
    policy_area: list[str] | None = Query(default=None),
    omnibus: bool | None = None,
    include: str | None = None,
    sort: Literal["relevance", "latest_action", "progress", "introduced"] | None = None,
    limit: int = Query(default=20, ge=0, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_optional_current_user),
    response: Response = None,  # type: ignore[assignment]
):
    session_row = get_session_by_slug(db, session)
    include_set = {item.strip() for item in include.split(",")} if include else set()
    # Cacheable only when the response carries no per-user data: anonymous and
    # no tracking include. (Anonymous + tracking already 401s upstream.)
    response.headers["Cache-Control"] = (
        PUBLIC_CACHE_CONTROL
        if current_user is None and "tracking" not in include_set
        else PRIVATE_CACHE_CONTROL
    )
    number_clause = bill_number_clause(q) if q else None
    # Relevance-rank only a free-text search — never a bill-number ID lookup.
    free_text = q if (q and number_clause is None) else None
    # Relevance is opt-in via sort=relevance ("Best match"), so an explicit
    # progress / latest_action / introduced sort genuinely reorders the results.
    # Prepending relevance to every sort made all three Search Bills options
    # return one identical ordering (#573 shipped the ranking; the sort control
    # needs it scoped to its own option). No sort given + a free-text query still
    # leads with the closest match, so the ranking stays the search default.
    effective_sort = sort or ("relevance" if free_text else "latest_action")
    text_query = free_text if effective_sort == "relevance" else None
    stmt = bill_list_stmt(
        session_row.id,
        user_id=tracking_user_id(include_set, current_user),
        sort=effective_sort,
        text_query=text_query,
    )
    if q:
        if number_clause is not None:
            # A bill-number query ("SF334", "334") is an ID lookup, not free text.
            # Match file_type/file_number exclusively so a bare number resolves the
            # bill by its badge and doesn't also pull in every bill that merely
            # mentions the digits in its title or description (#134).
            stmt = stmt.where(number_clause)
        else:
            keyword_clause = keyword_search_clause([Bill.title, Bill.description], q)
            if keyword_clause is not None:
                stmt = stmt.where(keyword_clause)
    if chamber:
        stmt = stmt.where(Bill.chamber.has(Chamber.slug == chamber.strip().lower()))
    if status:
        stmt = stmt.where(status_filter_clause(status))
    if policy_area:
        # Match any raw policy area that rolls up to a selected canonical issue
        # (alethical/api/issue_taxonomy.py) — so "Health" catches "healthcare",
        # "public health", etc. Case-folded whole-element match via unnest (a
        # whole-array cast + ILIKE would over-match and, with sort=progress, time
        # out to a 502). aliases_for falls back to the value itself for an
        # unmapped issue. Measured ~270ms on the production corpus.
        #
        # Multi-select is OR *across* issues: unioning each selected issue's
        # aliases into one match set returns bills tagged ANY of them (the
        # existing IN already OR'd the aliases *within* one issue). Duplicate
        # aliases across issues fold away in the set.
        policy_area_aliases = sorted(
            {alias for issue in policy_area for alias in aliases_for(issue)}
        )
        element = func.jsonb_array_elements_text(
            AIEnrichment.content_json["policy_areas"]
        ).table_valued("value")
        element_matches = (
            select(1)
            .select_from(element)
            .where(func.lower(func.btrim(element.c.value)).in_(policy_area_aliases))
            .exists()
        )
        matching_policy_area_bills = select(AIEnrichment.bill_id).where(
            AIEnrichment.enrichment_type == EnrichmentType.bill_summary,
            AIEnrichment.is_current.is_(True),
            element_matches,
        )
        stmt = stmt.where(Bill.id.in_(matching_policy_area_bills))
    if omnibus is not None:
        stmt = stmt.where(Bill.is_omnibus.is_(omnibus))
    rows, has_more, total = paginated_scalars_with_total(
        db, stmt, limit=limit, offset=offset
    )
    co_author_counts = bill_co_author_counts(db, [row.id for row in rows])
    effective_dates = bill_effective_dates(db, rows)
    data = [
        bill_list_item(
            row,
            include_tracking="tracking" in include_set and current_user is not None,
            co_author_count=co_author_counts.get(str(row.id), 0),
            effective_date=effective_dates.get(str(row.id)),
        )
        for row in rows
    ]
    return CollectionResponse(
        data=[item.model_dump(exclude_none=True) for item in data],
        page={
            "limit": limit,
            "offset": offset,
            "next_cursor": None,
            "has_more": has_more,
            "total": total,
        },
        links={"self": "/api/v1/bills"},
    )


# A signed Minnesota bill's Laws-of-Minnesota chapter lives in its actions, not
# in any text version: Revisor's text_versions stop at the highest engrossment
# and carry no session-law entry. Two actions hold what we need — a
# "Chapter number" action whose description is the chapter (e.g. "45"), and a
# "Secretary of State" action carrying the filing date ("Chapter 45 03/01/26").
_CHAPTER_ACTION_TEXT = "chapter number"
_SECRETARY_ACTION_TEXTS = ("secretary of state, filed", "secretary of state")
# Extracts MM/DD/YY or MM/DD/YYYY from a Secretary-of-State action description.
_FILING_DATE_RE = re.compile(r"(\d{1,2})/(\d{1,2})/(\d{2,4})")
# The bill's Revisor URL encodes /bills/{session_number}/{year}/{session_type}/…;
# the session_type segment (0 = regular) also indexes the Laws volume.
_BILL_SESSION_TYPE_RE = re.compile(r"/bills/\d+/\d+/(\d+)/")


def session_law_version(bill_row) -> dict[str, Any] | None:
    """Synthesize a "Session Law" version for an enacted bill from its already-
    ingested actions, or None if the bill never became law (grounded-answers
    rule 7 — only enacted bills carry this).

    Derived at serialization time rather than stored, so the ``bill_version``
    table, the one-current-version invariant (#285/#287), and RAG retrieval are
    all untouched. The Laws-of-Minnesota chapter is genuine primary-source data
    (rule 9): the number comes from the "Chapter number" action, and the Laws
    volume year from the "Secretary of State" filing date — which can differ
    from the bill's session year (a 2025-session bill signed in 2026 is Laws
    2026), so we never take the year from the session.
    """
    actions = list(bill_row.actions or [])

    chapter = next(
        (
            desc
            for action in actions
            if (action.action_text or "").strip().lower() == _CHAPTER_ACTION_TEXT
            and (desc := (action.action_description or "").strip()).isdigit()
        ),
        None,
    )
    if chapter is None:
        return None

    filing_date: datetime | None = None
    for action in actions:
        if (action.action_text or "").strip().lower() in _SECRETARY_ACTION_TEXTS:
            match = _FILING_DATE_RE.search(action.action_description or "")
            if match:
                month, day, year = (int(part) for part in match.groups())
                if year < 100:
                    year += 2000
                filing_date = datetime(year, month, day, tzinfo=UTC)
                break

    # "Read the full law" links straight to the official Laws chapter page. We
    # emit it only when the filing year is known; a chapter number alone can't
    # locate the right yearly volume, and a wrong citation is worse than none
    # (rule 1). The session-type segment comes from the bill's own Revisor URL.
    html_url = None
    if filing_date is not None:
        type_match = _BILL_SESSION_TYPE_RE.search(bill_row.official_url or "")
        session_type = type_match.group(1) if type_match else "0"
        html_url = (
            f"https://www.revisor.mn.gov/laws/{filing_date.year}/{session_type}"
            f"/Session+Law/Chapter/{chapter}/"
        )

    return {
        "version_code": "session-law",
        "version_name": f"Session Law — Chapter {chapter}",
        "document_date": filing_date,
        "html_url": html_url,
        "pdf_url": None,
        "is_current": False,
    }


# A statutory effective date is only shown when the enacted bill's own text
# states one unambiguously (grounded-answers rule 9). MN bills specify effective
# dates section-by-section ("This section is effective July 1, 2027."), never for
# the whole act, so a bill has a single verified effective date ONLY when its
# sections cannot disagree: either every section carries an explicit clause that
# resolves to the SAME date, or no section carries one at all and the whole act
# falls to the statutory default. Three shapes are groundable, all confirmed
# against the Revisor's published dates over every enacted bill in the corpus:
#   Tier A (#483/#561, ~8%): every section names the SAME explicit calendar date
#     (e.g. HF 4138 -> July 1, 2027). Handled by effective_date_from_sections().
#   Tier B (#562, ~14%): every section is "effective the day following final
#     enactment" — no calendar date in the text to read. MN Revisor publishes the
#     resolved date directly as an "Effective date" bill action, so we take THAT
#     authoritative value (rule 9) rather than compute it: the naive
#     "governor-signature + 1 day" is wrong in practice (HF 4987 signed 5/14 is
#     effective 5/16, tracking the 5/15 filing, not 5/15), and no single offset
#     fits every bill. To ship it we require two independent signals to agree —
#     the section text is uniformly "day following final enactment" (guards out
#     mixed bills whose Effective-date action is just a July 1 / Aug 1 statutory
#     default, e.g. HF 4138) AND the Effective-date action is one clean date
#     falling just after the governor-signature date (its "various dates" flags a
#     genuinely mixed bill; the signature window rejects a stray typo year like
#     SF 1552's "03/18/2024"). Handled by effective_date_day_following_enactment()
#     + revisor_effective_date_action() + governor_approval_date().
#   Tier C (#706, ~30%): NO section states an effective date, so Minn. Stat.
#     645.02 sets one date for the whole act — Aug 1 next following final
#     enactment, or July 1 for an act carrying appropriation items. Same
#     two-signal shape as Tier B: the text must be uniformly silent AND the
#     Revisor's own "Effective date" action must be a single clean date equal to
#     one of those two statutory defaults, so we publish the Revisor's value and
#     never have to classify an act as appropriating money ourselves. Verified
#     over the 40 uniformly-silent enacted bills in prod: 39 agree exactly, and
#     the 1 that does not is flagged "various dates" by the Revisor and falls
#     back. Handled by effective_date_all_sections_silent() +
#     statutory_default_effective_dates().
# Everything else — differing per-section dates, SOME sections silent while
# others state a date (e.g. SF 334 / 2026 ch. 120: 1 of 14 sections is effective
# the day following enactment, the other 13 fall to Aug 1), or
# conditional/contingent language — is genuinely ambiguous and gets None, so the
# UI keeps the honest "LATEST ACTION" fallback (#455 / #480) rather than assert
# one of several dates as the whole act's.
_EFFECTIVE_SENTENCE_RE = re.compile(
    r"this (?:section|article|subdivision|paragraph)\b[^.]*?\beffective\b[^.]*?\.",
    re.IGNORECASE,
)
_EFFECTIVE_DATE_RE = re.compile(
    r"\b(January|February|March|April|May|June|July|August|September|October"
    r"|November|December)\s+(\d{1,2}),\s+((?:19|20)\d{2})\b"
)
_EFFECTIVE_CONDITIONAL_RE = re.compile(
    r"\b(?:if |contingent|provided that|only if|upon (?:the )?|the day after)\b",
    re.IGNORECASE,
)


def effective_date_from_sections(
    sections: list[tuple[str | None, str | None]],
) -> str | None:
    """Resolve one verbatim effective date from a version's sections, or None.

    ``sections`` is ``(effective_date_heading, raw_text)`` per section, in any
    order. Returns a date string (e.g. "July 1, 2027") only when every section
    carries an explicit effective clause and they all name one identical calendar
    date; any silent section, differing date, "day following final enactment", or
    conditional clause yields None. Pure/DB-free so it is unit-testable.
    """
    if not sections:
        return None
    clause_texts = [raw for (heading, raw) in sections if (heading or "").strip()]
    # Every section must carry an explicit clause; a silent section would fall to
    # the statutory default (a different date), making the bill genuinely mixed.
    if not clause_texts or len(clause_texts) != len(sections):
        return None
    dates: set[str] = set()
    for raw in clause_texts:
        flattened = normalize_section_text(raw)
        clauses = _EFFECTIVE_SENTENCE_RE.findall(flattened)
        if not clauses:
            return None  # a clause section we cannot parse -> not unambiguous
        for clause in clauses:
            if (
                "day following final enactment" in clause.lower()
                or _EFFECTIVE_CONDITIONAL_RE.search(clause)
            ):
                return None
            matches = _EFFECTIVE_DATE_RE.findall(clause)
            if len(matches) != 1:
                return None  # zero or multiple dates in one clause -> ambiguous
            month, day, year = matches[0]
            dates.add(f"{month} {int(day)}, {year}")
    return next(iter(dates)) if len(dates) == 1 else None


_DAY_FOLLOWING_PHRASE = "day following final enactment"
# MN Revisor records the governor signing ("final enactment", Minn. Stat. 645.01
# subd. 2) under either label, and the resolved effective date as an "Effective
# date" action; all carry an MM/DD/YY[YY] date in their description. A "Presented
# to Governor" or "Secretary of State, Filed" action is a DIFFERENT event.
_GOVERNOR_APPROVAL_ACTION_TEXTS = ("governor approval", "governor's action approval")
_EFFECTIVE_DATE_ACTION_TEXT = "effective date"
_ACTION_DATE_RE = _FILING_DATE_RE  # MM/DD/YY or MM/DD/YYYY inside a description
# A Tier-B effective date must fall within a few days after the governor signed
# (the signing, or its 1-day-later Secretary-of-State filing, +1). This window
# both corroborates the Revisor date and rejects a stray/typo year (e.g. SF 1552's
# "03/18/2024" against a 2025 signing) that would ship a wrong statutory date.
_ENACTMENT_EFFECTIVE_WINDOW_DAYS = 7
_MONTH_NAMES = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)


def _parse_action_date(description: str | None) -> date | None:
    """Parse an MM/DD/YY[YY] date from an action description, or None.

    Rejects a 2-digit year by adding 2000 and any year outside 2000-2099 (a
    malformed source value such as "05/27/226"), so a bad parse never becomes a
    trusted date.
    """
    match = _ACTION_DATE_RE.search(description or "")
    if not match:
        return None
    month, day, year = (int(part) for part in match.groups())
    if year < 100:
        year += 2000
    if not (2000 <= year <= 2099):
        return None
    try:
        return date(year, month, day)
    except ValueError:
        return None  # impossible day (e.g. 02/30)


def effective_date_day_following_enactment(
    sections: list[tuple[str | None, str | None]],
) -> bool:
    """True iff every section's effective clause is "the day following final
    enactment" and nothing else — the Tier-B shape (#562).

    Same gate as :func:`effective_date_from_sections`: every section must carry an
    explicit, parseable effective clause. Returns False if any clause also names an
    explicit calendar date or uses conditional language (that bill is genuinely
    mixed/ambiguous), or if any section is silent. Pure/DB-free — the concrete date
    is taken from the Revisor "Effective date" action, never guessed from text.
    """
    if not sections:
        return False
    clause_texts = [raw for (heading, raw) in sections if (heading or "").strip()]
    if not clause_texts or len(clause_texts) != len(sections):
        return False
    for raw in clause_texts:
        flattened = normalize_section_text(raw)
        clauses = _EFFECTIVE_SENTENCE_RE.findall(flattened)
        if not clauses:
            return False  # a clause section we cannot parse -> not unambiguous
        for clause in clauses:
            lowered = clause.lower()
            if _DAY_FOLLOWING_PHRASE not in lowered:
                return False  # some other effective shape -> not pure Tier B
            # A "day following" clause that ALSO carries a calendar date or a
            # conditional trigger is ambiguous, not the clean Tier-B case.
            if _EFFECTIVE_DATE_RE.search(clause) or _EFFECTIVE_CONDITIONAL_RE.search(
                clause
            ):
                return False
    return True


def effective_date_all_sections_silent(
    sections: list[tuple[str | None, str | None]],
) -> bool:
    """True iff NO section states an effective date — the Tier-C shape (#706).

    The inverse gate of :func:`effective_date_from_sections`: no section may carry
    an "EFFECTIVE DATE" heading, and no section's text may contain an effective
    clause sentence. Both are required because either signal alone can be absent —
    a heading with unparsed text, or a clause the source did not head. When both
    are clear, the act specifies no date anywhere, so Minn. Stat. 645.02 supplies
    one date for the whole act. Pure/DB-free; the concrete date still comes from
    the Revisor's published "Effective date" action, never guessed.
    """
    if not sections:
        return False
    for heading, raw in sections:
        if (heading or "").strip():
            return False
        flattened = normalize_section_text(raw)
        if _EFFECTIVE_SENTENCE_RE.search(flattened):
            return False
    return True


def statutory_default_effective_dates(enactment: date) -> set[date]:
    """The two dates Minn. Stat. 645.02 allows an act that specifies none itself.

    An act takes effect "August 1 next following its final enactment", or July 1
    for "an appropriation act or an act having appropriation items". Both are
    returned so the caller can accept whichever the Revisor published, rather than
    us classifying an act as appropriating money — a judgment the Revisor has
    already made and recorded. "Next following" rolls to the next year when the
    act was enacted on or after that date.
    """
    return {
        date(
            enactment.year + (1 if enactment >= date(enactment.year, month, 1) else 0),
            month,
            1,
        )
        for month in (7, 8)
    }


def governor_approval_date(actions) -> date | None:
    """The date the governor signed the bill, from its actions, or None.

    Grounded-critical (rule 9): returns a date only when the approval actions
    resolve to exactly one plausible calendar date. Zero approval actions (a bill
    that became law without signature, or a veto override) or conflicting/malformed
    dates yield None so the caller falls back rather than assert a wrong anchor.
    """
    dates: set[date] = set()
    for action in actions or []:
        text = (action.action_text or "").strip().lower()
        if text in _GOVERNOR_APPROVAL_ACTION_TEXTS:
            parsed = _parse_action_date(action.action_description)
            if parsed is not None:
                dates.add(parsed)
    return next(iter(dates)) if len(dates) == 1 else None


def revisor_effective_date_action(actions) -> date | None:
    """The Revisor-published effective date from the bill's "Effective date"
    actions, or None.

    Returns a date only when the bill carries exactly one clean effective date:
    any "various dates" marker (a genuinely mixed bill) or more than one distinct
    parsed date yields None, so the caller falls back rather than assert one of
    several dates as the whole-act effective date.
    """
    saw_action = False
    dates: set[date] = set()
    for action in actions or []:
        if (action.action_text or "").strip().lower() != _EFFECTIVE_DATE_ACTION_TEXT:
            continue
        saw_action = True
        description = (action.action_description or "").strip()
        if "various" in description.lower():
            return None  # Revisor flags a genuinely mixed bill
        parsed = _parse_action_date(description)
        if parsed is not None:
            dates.add(parsed)
    if not saw_action:
        return None
    return next(iter(dates)) if len(dates) == 1 else None


def _format_effective_date(value: date) -> str:
    """Format as e.g. July 1, 2027 — the display form every tier returns."""
    return f"{_MONTH_NAMES[value.month - 1]} {value.day}, {value.year}"


def resolve_effective_date(
    sections: list[tuple[str | None, str | None]], actions
) -> str | None:
    """The verbatim statutory effective date from a bill's sections + actions, or
    None. Pure/DB-free tier logic shared by the detail path (verified_effective_date)
    and the list path (bill_effective_dates) so the card and the bill page never
    disagree. Order of certainty:
      * Tier A (#483/#561): every section names one identical explicit date.
      * Tier B (#562): every section is "effective the day following final
        enactment" AND the Revisor's own "Effective date" action is a single clean
        date falling within a week after the governor-signature date (Minn. Stat.
        645.01) — the authoritative published date, cross-checked, never computed.
      * Tier C (#706): no section states a date at all AND the Revisor's
        "Effective date" action is a single clean date equal to a Minn. Stat.
        645.02 default (Aug 1, or July 1 for an act with appropriation items) —
        again the published value, cross-checked against the statute.
    Anything still ambiguous returns None so the caller keeps the honest LATEST
    ACTION treatment (#483 / #455 / #480).
    """
    tier_a = effective_date_from_sections(sections)
    if tier_a is not None:
        return tier_a

    revisor = revisor_effective_date_action(actions or [])
    approval = governor_approval_date(actions or [])
    if revisor is None or approval is None:
        return None

    if effective_date_day_following_enactment(sections):
        if (
            approval
            < revisor
            <= approval + timedelta(days=_ENACTMENT_EFFECTIVE_WINDOW_DAYS)
        ):
            return _format_effective_date(revisor)
    elif effective_date_all_sections_silent(sections):
        if revisor in statutory_default_effective_dates(approval):
            return _format_effective_date(revisor)
    return None


# A law whose sections start on DIFFERENT days is the common case, not the edge
# case: 45 of the 131 enacted bills in production prove two or more distinct
# effective moments from their own text. The three tiers above all require the
# sections to be UNABLE to disagree, so every one of those 45 falls through to
# None and the UI prints the honest-but-useless LATEST ACTION line, which merely
# restates the "Signed into Law" stage label above it. This block resolves that
# fourth shape — PHASED — under one hard constraint: every date shown must come
# from the law's own text, never from a date we inferred.
#
# What we deliberately do NOT compute, and why (measured over the corpus, Jul
# 2026): a section that states no date falls to the Minn. Stat. 645.02 default,
# which is Aug 1 normally but July 1 for "an appropriation act or an act having
# appropriation items". Deciding which applies is a legal classification, and no
# textual signal reproduces the Revisor's own answer: the best of five candidate
# signals (an APPROPRIATION section heading) scored 34/35 against the Revisor's
# published dates, barely beating "always guess Aug 1" on a positive class of 3,
# and it erred in BOTH directions (HF 3875 appropriates with no such heading;
# HF 2184 / HF 2551 / HF 3741 / SF 3958 carry "is appropriated" yet the Revisor
# published Aug 1). A wrong guess does not merely print a wrong day — it
# MANUFACTURES phasing on a law that has none: HF 2130 has 24 sections, 4 stating
# Aug 1, 2025 and 20 silent, and the Revisor publishes one clean Aug 1, 2025, so
# guessing July would split a single-date law in two. So the undated sections get
# a plain note naming BOTH candidates and no timeline row of their own.
#
# The rail therefore leads with the EARLIEST date the law states about itself
# ("From May 28, 2026"), which makes the caption's "some sections later" true by
# construction rather than by per-law logic — the reworded caption is a
# structural fix, not a copy tweak. Where even the earliest is not provable
# (a stated date that falls after one of the two candidate defaults, so an
# undated section might start first — 5 of the 45), the value is the plain
# "Various dates", the same words the search cards already use.
#
# Two parsing rules earn their strictness:
#   * Only the Revisor's canonical sentence shape counts ("This section is
#     effective ..."). Matching "effective" loosely reads dates out of the
#     STATUTE BEING AMENDED and reports them as the bill's own — it surfaced an
#     April 1, 1996 date on HF 2115 and a January 1, 2014 date on SF 4476, both
#     current-biennium bills. That is silent wrongness of the worst kind.
#   * "Effective retroactively from {date}" is NOT an effective date. The law
#     took effect on enactment and merely APPLIES to earlier events, so SF 3637's
#     "retroactively from July 1, 2025" must never print as its start date.
# Where the bill text and the Revisor's published date disagree, the TEXT WINS —
# the published value is unreliable in both directions (it gives the earliest
# date for SF 334, the latest for HF 3827, and "various dates" for 38 of the 48
# it cannot summarize). HF 4138 (text July 1, 2027 vs published July 1, 2026)
# and SF 1552 (published year typo "03/18/2024" against a 2025 signing) are the
# reference cases: do not "fix" this parser back toward the published value.
_STRICT_EFFECTIVE_RE = re.compile(
    r"(?:^|(?<=[.;] ))(?:This|These)\s+"
    r"(?:section|sections|article|articles|subdivision|subdivisions|paragraph"
    r"|paragraphs)\s+(?:is|are)\s+effective\b([^.]*)\.",
    re.IGNORECASE,
)
_EFFECTIVE_RETROACTIVE_RE = re.compile(r"\bretroactive", re.IGNORECASE)
# An APPLICABILITY tail says what the law covers, not when it starts, and the two
# routinely disagree: SF 3720 is "effective the day following final enactment and
# applies to dates of injury on or after October 1, 2024", so reading the whole
# clause hands back a 2024 start date for a 2026 law. Everything from the first
# marker on is cut before any date is read — which also correctly leaves a clause
# that states ONLY coverage ("effective for taxable years beginning after
# December 31, 2024", HF 2446) with no start date at all, rather than printing the
# tax-year boundary as the day the section begins.
_APPLICABILITY_TAIL_RE = re.compile(
    r"\b(?:and\s+)?applies\b|\bfor\s+(?:taxable|fiscal|calendar|assessment)\s+years?\b"
    r"|\bfor\s+(?:dates?|reports?|aids?|claims?|grants?|revenue|refunds?|orders?)\b",
    re.IGNORECASE,
)
# The Revisor publishes amendments as a redline: "deleted text begin 2025deleted
# text end 2026" means the date is 2026, but reading it verbatim yields 2025 — the
# very language the amendment REMOVES. HF 3022 carries exactly that shape. Every
# clause is normalized through this before any date is read, so no surface can
# report struck-through text as current law.
_DELETED_TEXT_RE = re.compile(
    r"deleted text begin.*?deleted text end", re.IGNORECASE | re.DOTALL
)
_NEW_TEXT_MARKER_RE = re.compile(r"new text (?:begin|end)", re.IGNORECASE)


def normalize_section_text(raw: str | None) -> str:
    """A section's text with the Revisor's redline markup resolved and whitespace
    flattened — struck-through language dropped, inserted language kept."""
    flattened = re.sub(r"\s+", " ", raw or "")
    flattened = _DELETED_TEXT_RE.sub(" ", flattened)
    flattened = _NEW_TEXT_MARKER_RE.sub(" ", flattened)
    return re.sub(r"\s+", " ", flattened).strip()


def effective_clause_date(tail: str, day_following: date | None) -> date | None:
    """The date one canonical effective clause states, or None when it states none.

    ``tail`` is the text after "... is effective". Returns None for a retroactive
    or conditional clause, for a clause that names only a coverage window, and for
    one naming several dates — in each case the section has no single provable
    start date and the caller counts it unresolved.
    """
    head = _APPLICABILITY_TAIL_RE.split(tail, maxsplit=1)[0]
    if _EFFECTIVE_RETROACTIVE_RE.search(head) or _EFFECTIVE_CONDITIONAL_RE.search(head):
        return None
    matches = _EFFECTIVE_DATE_RE.findall(head)
    if len(matches) == 1:
        month, day, year = matches[0]
        return date(int(year), _MONTH_NAMES.index(month) + 1, int(day))
    if not matches and _DAY_FOLLOWING_PHRASE in head.lower():
        return day_following
    return None


def day_following_final_enactment(actions) -> date | None:
    """The date a "day following final enactment" section starts, or None.

    It is the Secretary of State FILING date plus one day, which reproduced the
    Revisor's own published date on all 18 enacted bills where it could be checked.
    The governor-signature date plus one day does not: HF 4987 was signed 5/14,
    filed 5/15, and is effective 5/16. Returns None unless the filing actions
    resolve to exactly one date, so a conflicting or malformed source never
    becomes a printed date (grounded-answers rule 9).
    """
    dates: set[date] = set()
    for action in actions or []:
        if (action.action_text or "").strip().lower().startswith("secretary of state"):
            parsed = _parse_action_date(action.action_description)
            if parsed is not None:
                dates.add(parsed)
    if len(dates) != 1:
        return None
    return next(iter(dates)) + timedelta(days=1)


def section_effective_dates(
    sections: list[tuple[str | None, str | None]], actions
) -> tuple[Counter[date], int, int]:
    """Per-section effective dates from the sections' own canonical clauses.

    Returns ``(stated, undated, unresolved)`` — how many sections state each
    resolved date, how many state nothing at all, and how many carry a clause we
    will not resolve (a conditional trigger, a retroactive application, or an
    unparseable shape). Pure/DB-free so it is unit-testable.

    A date falling BEFORE the law was enacted counts as unresolved, never as a
    start date: a law cannot begin before it exists, so such a clause is
    describing retroactive reach. HF 3022 was signed in May 2025 and carries a
    section "effective August 1, 2024"; leading its rail with "From Aug 1, 2024"
    would date the law nine months before the governor signed it.
    """
    day_following = day_following_final_enactment(actions)
    enactment = governor_approval_date(actions)
    stated: Counter[date] = Counter()
    undated = 0
    unresolved = 0
    for heading, raw in sections:
        tails = [
            m.group(1)
            for m in _STRICT_EFFECTIVE_RE.finditer(normalize_section_text(raw))
        ]
        if not tails:
            # An "EFFECTIVE DATE." heading with no canonical clause means the
            # source carries a date we did not parse — not a silent section.
            if (heading or "").strip():
                unresolved += 1
            else:
                undated += 1
            continue
        resolved = {
            value
            for tail in tails
            if (value := effective_clause_date(tail, day_following)) is not None
            and (enactment is None or value >= enactment)
        }
        # One section naming several dates cannot be attributed to one of them.
        if len(resolved) == 1:
            stated[next(iter(resolved))] += 1
        else:
            unresolved += 1
    return stated, undated, unresolved


def resolve_phased_effective_dates(
    sections: list[tuple[str | None, str | None]], actions
) -> dict[str, Any] | None:
    """The PHASED payload for a law whose sections start on different days, or None.

    None means the law is not PROVABLY phased — either it resolves to one date
    through Tier A/B/C above, or its stated date could coincide with the statutory
    default its undated sections take, so we cannot assert a split (HF 2130).
    Mutually exclusive with resolve_effective_date by construction: each tier there
    requires uniformity across the sections, which a phased law never has.
    """
    if not sections:
        return None
    approval = governor_approval_date(actions or [])
    if approval is None:
        return None  # no anchor for the statutory candidates -> stay on fallback
    stated, undated, unresolved = section_effective_dates(sections, actions)
    if not stated:
        return None
    candidates = statutory_default_effective_dates(approval)
    phased = len(stated) > 1 or (
        undated > 0 and any(value not in candidates for value in stated)
    )
    if not phased:
        return None
    ordered = sorted(stated)
    earliest = ordered[0]
    # The earliest is only provable when no undated section could start sooner.
    earliest_provable = undated == 0 or earliest < min(candidates)
    day_following = day_following_final_enactment(actions)
    return {
        "value": _format_effective_date(earliest) if earliest_provable else None,
        # Newest first, matching every other row on the Actions timeline. Dates
        # carry the same display form as `value` so both platforms parse one shape.
        "rows": [
            {
                "date": _format_effective_date(value),
                "sections": stated[value],
                "from_enactment": value == day_following,
            }
            for value in reversed(ordered)
        ],
        "total_sections": len(sections),
        "undated_sections": undated,
        "default_candidates": [
            _format_effective_date(value) for value in sorted(candidates)
        ],
    }


def _current_version_sections(
    db: Session, bill_row
) -> list[tuple[str | None, str | None]] | None:
    """The current version's (effective-date heading, raw text) per section, or None."""
    current = next((v for v in (bill_row.versions or []) if v.is_current), None)
    if current is None:
        return None
    rows = db.execute(
        select(
            BillVersionSection.effective_date_heading, BillVersionSection.raw_text
        ).where(BillVersionSection.bill_version_id == current.id)
    ).all()
    return [(r[0], r[1]) for r in rows]


def _citation_section_topics(db: Session, bill_row) -> dict[str, str]:
    """section_id_text -> short chip topic, for the current version's sections.

    Fills in the "· Topic" half of the Summary tab's citation chips at request time,
    so every already-enriched bill gets one rather than only the bills a future
    re-enrichment happens to touch (the stored label carries the number alone for
    the statute-amending sections, which are most of the cited ones).

    Three short text columns for one version's sections — the detail route already
    reads this table for the effective-date schedule, and citations only render on
    this endpoint (the list serializer passes no official_url, so it emits none).

    An id naming MORE THAN ONE section resolves to no topic. `section_id_text` is
    not unique within a version — 66 (version, id) pairs in production name several
    sections, and on HF 1134 the single id "laws.0.1.0" covers three: "Sec. 126. OAK
    GROVE; COMPREHENSIVE PLAN.", "Sec. 46. NOWTHEN; COMPREHENSIVE PLAN." and a bare
    "Section 1." Building the map with last-row-wins therefore captioned 58 chips with
    a topic belonging to a section the citation does not point at (HF 1134's Sec. 1
    chip read "Sec. 1 · Nowthen"; HF 1012's read "Sec. 1 · Forest land off-highway
    vehicle use reclassification", which is Sec. 167's subject). Which section is meant
    is genuinely unknowable from the id, so the honest answer is none: the chip renders
    the number alone, its designed empty state, rather than naming a subject the cited
    section may not have (.claude/rules/grounded-answers.md rule 1 — a confident wrong
    caption is the worst failure, and being right by luck on the duplicates that happen
    to agree is not being right).
    """
    current = next((v for v in (bill_row.versions or []) if v.is_current), None)
    if current is None:
        return {}
    rows = db.execute(
        select(
            BillVersionSection.section_id_text,
            BillVersionSection.section_heading,
            BillVersionSection.cite_heading,
        ).where(BillVersionSection.bill_version_id == current.id)
    ).all()
    topics: dict[str, str] = {}
    seen: set[str] = set()
    for section_id_text, section_heading, cite_heading in rows:
        if not section_id_text:
            continue
        if section_id_text in seen:
            # A second section answering to the same id. Neither can be trusted as
            # the one cited, so the id resolves to nothing. Counting a heading-less
            # section as "seen" matters: it occupies the id too, so a later duplicate
            # that happens to have a heading must not answer on its behalf.
            topics.pop(section_id_text, None)
            continue
        seen.add(section_id_text)
        topic = section_chip_topic(section_heading, cite_heading)
        if topic:
            topics[section_id_text] = topic
    return topics


def verified_effective_date(db: Session, bill_row) -> str | None:
    """The enacted bill's statutory effective date, verbatim, or None (detail page).

    Loads the current version's sections and delegates the tier logic to
    resolve_effective_date. Only enacted bills carry a date; everything else keeps
    the honest LATEST ACTION treatment.
    """
    if bill_row.status_key != "signed_into_law":
        return None
    sections = _current_version_sections(db, bill_row)
    if sections is None:
        return None
    return resolve_effective_date(sections, bill_row.actions or [])


# A cross-reference action's ``action_text`` is "See" / "See Also" / "(Non-revisor
# companion)"; its ``action_description`` names where the language went.
_CROSS_REFERENCE_LABEL = re.compile(r"^(?:see\b|\(non-revisor companion\))", re.I)
# House/Senate file references inside that description. Leading zeros and any
# spacing are tolerated, so "HF2446", "HF 2446" and "SF0334" all resolve.
_FILE_REFERENCE = re.compile(r"\b(HF|SF)\s*0*(\d+)\b", re.I)
# A description that names a session is naming a DIFFERENT one — the citing bill's
# own session is never restated. 465 production rows qualify their file this way
# ("First Special Session, HF 5"), and resolving those against the regular session
# would link to the unrelated regular-session bill that happens to share the number:
# a confidently wrong link, which is worse than the plain text we render instead.
#
# Until #746 those rows were skipped outright, because the bills they name were not
# in the corpus at all. Now that they are, the row is resolved against the session it
# NAMES instead — but only when that name maps to exactly one session we hold, and
# never by falling back to the citing bill's session (see ``_named_special_session``).
_OTHER_SESSION = re.compile(r"\bsession\b", re.I)
# The session a description names. Every one of the 465 production rows names a
# SPECIAL session; none names a different regular one, which makes sense — a regular
# session is identified by its biennium, and these rows point sideways within one.
#
# Both optional groups are genuinely optional in the source data: 48 rows carry a
# year ("2025 1st Special Session SF3, Chapter 1, …") and 417 do not
# ("First Special Session, HF 5"), while 5 rows give no ordinal at all
# ("See Special Session, HF5"). Missing pieces widen the candidate set rather than
# guessing at one, and a widened set that stays ambiguous is declined.
_NAMED_SPECIAL_SESSION = re.compile(
    r"(?:(?P<year>(?:19|20)\d{2})\s+)?"
    r"(?:(?P<qualifier>[A-Za-z0-9]+)\s+)?"
    r"special\s+session\b",
    re.I,
)
# Ordinals run to 7th because Minnesota has gone that far: the Revisor's own session
# code ``7912020`` is the 91st Legislature's 2020 **7th** Special Session
# (``special_session_number``). Listing the whole real range matters — an ordinal
# missing from this map is treated as unrecognised and the row is declined, which is
# the safe outcome, but only if the ones that exist are actually here.
#
# "frist" is not a typo of ours: 2 production rows spell it that way ("Frist Special
# Session, HF9"). Accepting it cannot produce a wrong link, because the uniqueness
# check still has to pass; refusing it would drop 2 real references over a
# misspelling in the source feed.
_SPECIAL_SESSION_ORDINALS = {
    "first": 1,
    "1st": 1,
    "frist": 1,
    "second": 2,
    "2nd": 2,
    "third": 3,
    "3rd": 3,
    "fourth": 4,
    "4th": 4,
    "fifth": 5,
    "5th": 5,
    "sixth": 6,
    "6th": 6,
    "seventh": 7,
    "7th": 7,
}


def _known_special_sessions() -> list[tuple[int, int, int, str]]:
    """Every special session we can name, as ``(legislature, ordinal, year, slug)``.

    Read from ``SESSION_DEFINITIONS`` rather than from the database so there is one
    source of truth for what "First Special Session" means, shared with the ingestion
    that creates these rows. The ordinal is the discovery code's leading digit, which
    is what ``special_session_number`` decodes.
    """
    return sorted(
        {
            (
                definition.session_number,
                special_session_number(code),
                definition.year_start,
                definition.slug,
            )
            for code, definition in SESSION_DEFINITIONS.items()
            if definition.session_type == "special"
        }
    )


def _named_special_session(description: str, legislature: int) -> str | None | bool:
    """Which session slug a cross-reference names, if it names one unambiguously.

    Three outcomes, deliberately distinct:

    * ``False`` — the description names no session, so the caller resolves the
      reference inside the citing bill's own session exactly as before.
    * a slug — it names exactly one session we hold.
    * ``None`` — it names a session we cannot pin down to exactly one. The caller
      skips the row and it renders as plain text.

    The last case is the important one, and it is why this never falls back to the
    citing bill's session: "First Special Session, HF 5" resolved against the regular
    session lands a reader on an unrelated tax bill instead of the K-12 education
    finance bill they asked for (#745, #746). A link we decline to draw costs a
    reader one click they have to make themselves; a wrong link costs them the truth.

    **Candidates are confined to the citing bill's own Legislature.** A bare "First
    Special Session" is only meaningful relative to the Legislature doing the citing,
    and once #359 loads prior bienniums there will be several sessions answering to
    that name. Confining the search means those can never bleed in; and if one
    Legislature ever holds two special sessions in different years, an unqualified
    reference to it becomes ambiguous and is declined rather than guessed.
    """
    if not _OTHER_SESSION.search(description):
        return False
    match = _NAMED_SPECIAL_SESSION.search(description)
    if match is None:
        # Says "session" but not in a shape we recognise. Unknown, so declined.
        return None
    year = int(match.group("year")) if match.group("year") else None
    qualifier = match.group("qualifier")
    if qualifier is None:
        ordinal = None
    elif qualifier.lower() in _SPECIAL_SESSION_ORDINALS:
        ordinal = _SPECIAL_SESSION_ORDINALS[qualifier.lower()]
    else:
        # A word we do not recognise sits where an ordinal would. Treating that as
        # "no ordinal given" is how a wrong link gets made: "Fourth Special Session"
        # would fall through to the Legislature's only special session and link the
        # first one. Unrecognised means declined.
        #
        # This is also why the 5 rows reading "See Special Session, HF5" stay plain
        # text — "See" lands in the qualifier slot. Resolving them would mean the
        # only special session of that Legislature, which the uniqueness check below
        # would confirm, but it is not worth a lead-in word list to win 5 rows out of
        # 465. They keep the behaviour they have today, which is correct, just not
        # linked.
        return None
    candidates = {
        slug
        for candidate_legislature, candidate_ordinal, candidate_year, slug in (
            _known_special_sessions()
        )
        if candidate_legislature == legislature
        and (ordinal is None or candidate_ordinal == ordinal)
        and (year is None or candidate_year == year)
    }
    return candidates.pop() if len(candidates) == 1 else None


def action_cross_references(
    db: Session, bill_row
) -> dict[int, list[dict[str, str]]] | None:
    """The bills a cross-reference action points at, keyed by ``action_number``.

    A "See also HF 2446" row names another bill we very likely serve a page for, so
    the file number wants to be a link — but turning it into one needs the target's
    ``bill_key``, and only the server can do that lookup: the browser holds no index
    of the corpus. Same job and payload shape as ``companion_payload`` — ``code`` is
    what the row displays, ``id`` is the ``bill_key`` behind ``/bills/{id}`` (#745).

    Each resolved target also carries the two facts we already store ABOUT it: its
    plain-language ``title`` (the AI short title) and its ``status_key`` (#757). Two
    bare codes gave a reader no reason to follow either one; "HF 2446 — Agriculture
    and Broadband Development Budget Bill · Signed into Law" answers the question
    they actually came with. Both are records of the TARGET, never a claim about the
    relationship: the source row states a pointer, not a mechanism (#744), so
    nothing here may say this bill's language moved into that one. Verified in
    production: all 87 distinct resolvable targets carry both fields, so this is not
    a field that shows up on a lucky few.

    Resolved inside ONE session — the one the row names, or the citing bill's own
    when it names none. Within a single session ``(file_type, file_number)`` is
    unique (verified against production: 0 colliding pairs across all 10,517 bills),
    so a reference resolves to exactly one bill or to none. A reference we cannot
    resolve is simply absent from the result and the frontend renders it as plain
    text, which is why a miss always degrades to the old behaviour and can never
    produce a link that goes nowhere.

    **A named session is never silently swapped for the citing bill's.** The 465 rows
    reading "First Special Session, HF 5" are why: HF 5 exists in both the 2025
    regular session (a tax bill) and the 2025 first special session (the K-12
    education finance bill), so resolving the row against the wrong one sends a
    reader somewhere plausible and wrong. Until #746 those rows were skipped
    outright because the special session was not in the corpus; now they resolve
    against it, and anything still unmappable keeps being skipped. See
    ``_named_special_session`` for how a name is pinned to one session and why an
    ambiguous one is declined.

    One row can legitimately name files in two different sessions —
    ``First Special Session, HF18; HF719`` (10 production rows name 2+ files). Each
    reference carries its own session, and HF 719 has no special-session counterpart,
    so it stays text rather than resolving to the regular-session bill of that
    number. A partial link is the correct outcome there, not a bug.

    Still TWO queries for the whole bill (targets, then their short titles) — the
    session slug is matched inside the same tuple as the file, so a second session
    costs a join rather than a round trip — and no query at all for the ~93% of bills
    that carry no cross-reference row, so this cannot become an N+1 on the detail
    route.
    """
    # Which actions are cross-references at all, before touching ``bill_row.session``:
    # that attribute is lazy, and the ~93% of bills with no cross-reference row must
    # still cost zero queries here.
    candidates = [
        (action.action_number, action.action_description or "")
        for action in bill_row.actions
        if _CROSS_REFERENCE_LABEL.match((action.action_text or "").strip())
    ]
    if not candidates:
        return None
    own_slug = bill_row.session.slug
    legislature = bill_row.session.session_number
    # Each reference carries the slug of the session it must be looked up in, so one
    # row's files can never be resolved against a session the row did not name.
    per_action: dict[int, list[tuple[str, str, int]]] = {}
    for action_number, description in candidates:
        named = _named_special_session(description, legislature)
        if named is None:
            # Names a session we cannot pin to exactly one row. Stays plain text.
            continue
        # ``False`` means no session named, so the citing bill's own session applies.
        target_slug = own_slug if named is False else named
        refs = [
            (target_slug, file_type.upper(), int(digits))
            for file_type, digits in _FILE_REFERENCE.findall(description)
        ]
        if refs:
            per_action[action_number] = refs
    if not per_action:
        return None
    wanted = {ref for refs in per_action.values() for ref in refs}
    # Still ONE query for every target whichever session each belongs to, because the
    # slug is matched inside the same tuple as the file: naming another session costs
    # a join, not a second round trip.
    resolved = {
        (row.slug, row.file_type.upper(), row.file_number): row
        for row in db.execute(
            select(
                Bill.id,
                Bill.file_type,
                Bill.file_number,
                Bill.bill_key,
                Bill.status_key,
                LegislativeSession.slug,
            )
            .join(LegislativeSession, Bill.session_id == LegislativeSession.id)
            .where(
                tuple_(LegislativeSession.slug, Bill.file_type, Bill.file_number).in_(
                    wanted
                )
            )
        )
    }
    short_titles = _target_short_titles(db, {row.id for row in resolved.values()})
    out: dict[int, list[dict[str, str]]] = {}
    for action_number, refs in per_action.items():
        links = [
            _cross_reference_link(
                f"{file_type} {number}",
                resolved[(slug, file_type, number)],
                short_titles,
            )
            # Deduplicated in source order: 11 production rows name the same file
            # twice ("HF2115, HF2115"), and one link per target is enough.
            for slug, file_type, number in dict.fromkeys(refs)
            # A reference to the citing bill itself is dropped: SF 2372's feed
            # carries "See SF2372", and a link back to the page you are already on
            # is a dead end. The title still quotes the target as the source wrote
            # it — we decline to link it, we do not re-author it.
            if (slug, file_type, number) in resolved
            and resolved[(slug, file_type, number)].bill_key != bill_row.bill_key
        ]
        if links:
            out[action_number] = links
    return out or None


def _target_short_titles(db: Session, bill_ids: set[UUID]) -> dict[UUID, str]:
    """Each target bill's plain-language short title, by bill id.

    Same choice of enrichment row as ``current_bill_summary_enrichment`` (current
    ``bill_summary`` with a non-empty summary, newest wins) so a cross-reference
    line and the target's own page can never name the bill two different ways.
    Selects the one JSON key rather than the whole ``content_json``, which keeps a
    multi-kilobyte blob per target off the wire.
    """
    if not bill_ids:
        return {}
    titles: dict[UUID, str] = {}
    for bill_id, short_title in db.execute(
        select(
            AIEnrichment.bill_id,
            AIEnrichment.content_json["short_title"].as_string(),
        )
        .where(
            AIEnrichment.bill_id.in_(bill_ids),
            AIEnrichment.enrichment_type == EnrichmentType.bill_summary,
            AIEnrichment.is_current.is_(True),
            AIEnrichment.content_json["summary"].as_string() != "",
        )
        # Newest last, so a later row overwrites an earlier one — the same
        # max(created_at) rule the serializer applies.
        .order_by(AIEnrichment.created_at)
    ):
        if short_title and short_title.strip():
            titles[bill_id] = short_title.strip()
    return titles


def _cross_reference_link(
    code: str, target, short_titles: dict[UUID, str]
) -> dict[str, str]:
    """One resolved pointer target, as the payload the timeline row renders.

    ``title`` / ``status_key`` are omitted when we hold neither, so a target we
    know nothing about beyond its code stays exactly as bare as it is today.
    """
    link = {"code": code, "id": target.bill_key}
    title = short_titles.get(target.id)
    if title:
        link["title"] = title
    if target.status_key:
        link["status_key"] = target.status_key
    return link


def effective_schedule_payload(db: Session, bill_row) -> dict[str, Any] | None:
    """What the bill page shows for EFFECTIVE, as one payload for both platforms.

    ``kind`` is "single" when every section shares one date (Tier A/B/C) and
    "phased" when the law's own text proves two or more. Absent (None) means the
    honest LATEST ACTION fallback: an in-progress or vetoed bill, or a signed law
    whose source carries no groundable effective-date information at all.
    """
    if bill_row.status_key != "signed_into_law":
        return None
    sections = _current_version_sections(db, bill_row)
    if sections is None:
        return None
    actions = bill_row.actions or []
    single = resolve_effective_date(sections, actions)
    if single is not None:
        return {
            "kind": "single",
            "value": single,
            # One row, which the timeline labels "Law effective" with no per-section
            # meta line — every section shares this date, so there is nothing to count.
            "rows": [
                {"date": single, "sections": len(sections), "from_enactment": False}
            ],
            "total_sections": len(sections),
            "undated_sections": 0,
            "default_candidates": [],
        }
    phased = resolve_phased_effective_dates(sections, actions)
    if phased is None:
        return None
    return {"kind": "phased", **phased}


def bill_effective_dates(db: Session, rows) -> dict[str, str]:
    """Effective-date display value per SIGNED bill on a list page, computed set-wise
    in at most two grouped queries (no per-row N+1) — the list-endpoint counterpart
    to verified_effective_date.

    The value is either the verified single statutory date (Tier A/B/C, the SAME source
    as the bill-detail page, so the card and the page agree — grounded-answers rule 9)
    or, when an omnibus bill's provisions don't resolve to one shared date, the plain
    "various dates" (an omnibus by definition bundles multiple articles that generally
    take effect at different times). Signed bills with no groundable date that are not
    omnibus are omitted — the card then shows no Effective line rather than a guessed
    date. Returns {bill_id: value}."""
    signed = [row for row in rows if row.status_key == "signed_into_law"]
    if not signed:
        return {}
    # One query: the current version id for each signed bill.
    current_version_to_bill = {
        version_id: bill_id
        for bill_id, version_id in db.execute(
            select(BillVersion.bill_id, BillVersion.id).where(
                BillVersion.bill_id.in_([row.id for row in signed]),
                BillVersion.is_current.is_(True),
            )
        ).all()
    }
    # One query: all sections for those current versions, grouped back per bill.
    sections_by_bill: dict[Any, list[tuple[str | None, str | None]]] = defaultdict(list)
    if current_version_to_bill:
        for version_id, heading, raw_text in db.execute(
            select(
                BillVersionSection.bill_version_id,
                BillVersionSection.effective_date_heading,
                BillVersionSection.raw_text,
            ).where(
                BillVersionSection.bill_version_id.in_(list(current_version_to_bill))
            )
        ).all():
            sections_by_bill[current_version_to_bill[version_id]].append(
                (heading, raw_text)
            )

    out: dict[str, str] = {}
    for row in signed:
        value = resolve_effective_date(
            sections_by_bill.get(row.id, []), row.actions or []
        )
        if value is None and row.is_omnibus:
            value = "various dates"
        if value is not None:
            out[str(row.id)] = value
    return out


def bill_version_payloads(bill_row) -> list[dict[str, Any]]:
    """Serialize a bill's versions, appending a synthesized "Session Law"
    version (the final "this is now law" entry) for enacted bills (#438)."""
    payloads = [
        {
            "version_code": version.version_code,
            "version_name": version.version_name,
            "document_date": version.document_date,
            "html_url": version.html_url,
            "pdf_url": version.pdf_url,
            "is_current": version.is_current,
        }
        for version in bill_row.versions
    ]
    session_law = session_law_version(bill_row)
    if session_law is not None:
        payloads.append(session_law)
    return payloads


@router.get("/bills/{bill_id}", response_model=DetailResponse)
def bill_detail(
    bill_id: str,
    include: str | None = None,
    db: Session = Depends(get_db),
    current_user=Depends(get_optional_current_user),
    response: Response = None,  # type: ignore[assignment]
):
    bill_row = get_bill_by_key(db, bill_id)
    include_set = {item.strip() for item in include.split(",")} if include else set()
    # Cacheable unless the response carries per-user tracking state (see /bills).
    response.headers["Cache-Control"] = (
        PUBLIC_CACHE_CONTROL
        if current_user is None and "tracking" not in include_set
        else PRIVATE_CACHE_CONTROL
    )
    row = db.scalar(
        bill_detail_stmt(
            bill_row.id,
            user_id=tracking_user_id(include_set, current_user),
            # The detail payload never reads the roll-call tree (votes come from
            # the separate /bills/{id}/votes endpoint), so skip eager-loading
            # vote_events -> records -> legislator: three fewer round trips.
            load_votes=False,
        )
    )
    ai_enrichment = None
    if {"ai_summary", "ai_analysis"} & include_set:
        ai_enrichment = current_bill_summary_enrichment(row.enrichments)
    # A bill with no enrichment yet still EXISTS, so it serves 200 with the
    # generated fields absent rather than 404. This used to raise (#44), which was
    # harmless only while every bill happened to be enriched. Ingesting the 2025
    # first special session (#746) put 46 real, unenriched bills in production —
    # the only unenriched rows in the whole corpus — and every one of them 404'd
    # the entire detail route, because the frontend requests
    # ``include=...,ai_analysis`` on every bill page. The site rendered "We
    # couldn't find that bill" for bills it demonstrably carries. Enrichment is a
    # separate paid step that always lags ingestion, so that lag must degrade to a
    # page missing its summary, never to a page denying the bill exists.
    # ``ai_analysis_payload_for_enrichment`` already returns None here and the
    # return below drops null fields, so the absence flows through on its own.
    # Both effective-date fields come from ONE resolve so the rail's value and the
    # timeline's rows can never disagree, and the sections load only once.
    schedule = effective_schedule_payload(db, row)
    payload = {
        "id": row.bill_key,
        "title": row.title,
        "session": {
            "slug": row.session.slug,
            "name": row.session.name,
            "is_current": row.session.is_current,
        },
        "description": row.description,
        "current_status": row.current_status,
        "status_key": row.status_key,
        "latest_action_at": row.latest_action_at,
        # Verbatim statutory effective date, present only when the enacted text
        # states one unambiguously; otherwise absent -> UI shows LATEST ACTION
        # (#483). Never derived from latest_action_at (the #455 bug).
        "effective_date": (
            schedule["value"] if schedule and schedule["kind"] == "single" else None
        ),
        # The full EFFECTIVE story for the rail and the Actions timeline: one shared
        # date for a single-date law, or one row per date a phased law states about
        # itself plus the count of sections that state nothing (#715).
        "effective_schedule": schedule,
        "official_url": row.official_url,
        "is_omnibus": row.is_omnibus,
        "companion": (
            payload_model.model_dump()
            if (payload_model := companion_payload(row)) is not None
            else None
        ),
        "chief_sponsors": [
            item.model_dump()
            for item in sponsor_payloads(
                row.chief_sponsorships,
                session_id=row.session_id,
            )
        ],
        "tracking": tracking_payload(row.tracked_by).model_dump()
        if "tracking" in include_set and current_user
        else None,
        "ai_analysis": ai_analysis_payload_for_enrichment(
            ai_enrichment, row.official_url, _citation_section_topics(db, row)
        ),
        "ai_summary": ai_enrichment.content_json if ai_enrichment else None,
    }
    if "all_sponsors" in include_set:
        payload["all_sponsors"] = [
            item.model_dump()
            for item in sponsor_payloads(
                row.sponsorships,
                session_id=row.session_id,
            )
        ]
    if "progress" in include_set:
        payload["progress"] = [item.model_dump() for item in bill_progress_payload(row)]
    if "actions" in include_set:
        # Resolved once for the whole bill, then attached per row, so the Actions
        # timeline can link a "See also HF 2446" to that bill's page (#745).
        cross_references = action_cross_references(db, row) or {}
        payload["actions"] = [
            {
                "action_number": action.action_number,
                "action_text": action.action_text,
                "action_group": action.action_group,
                "action_description": action.action_description,
                "committee_name": action.committee_name,
                "action_at": action.action_at,
                "journal_page": action.journal_page,
                "roll_call_text": action.roll_call_text,
                # Omitted entirely on the ~97% of rows that name no bill, rather
                # than sent as null on every one of them.
                **(
                    {"cross_references": links}
                    if (links := cross_references.get(action.action_number))
                    else {}
                ),
            }
            for action in row.actions
        ]
    if "versions" in include_set:
        payload["versions"] = bill_version_payloads(row)
    return DetailResponse(
        data={key: value for key, value in payload.items() if value is not None}
    )


@router.get("/bills/{bill_id}/actions", response_model=CollectionResponse)
def bill_actions(bill_id: str, db: Session = Depends(get_db)):
    bill_row = get_bill_by_key(db, bill_id)
    row = db.scalar(bill_detail_stmt(bill_row.id))
    data = [
        {
            "action_number": action.action_number,
            "action_text": action.action_text,
            "action_group": action.action_group,
            "action_description": action.action_description,
            "committee_name": action.committee_name,
            "action_at": action.action_at,
            "journal_page": action.journal_page,
            "roll_call_text": action.roll_call_text,
        }
        for action in row.actions
    ]
    return CollectionResponse(
        data=data, page={"limit": len(data), "next_cursor": None, "has_more": False}
    )


@router.get("/bills/{bill_id}/versions", response_model=CollectionResponse)
def bill_versions(bill_id: str, db: Session = Depends(get_db)):
    bill_row = get_bill_by_key(db, bill_id)
    row = db.scalar(bill_detail_stmt(bill_row.id))
    data = bill_version_payloads(row)
    return CollectionResponse(
        data=data, page={"limit": len(data), "next_cursor": None, "has_more": False}
    )


@router.get("/bills/{bill_id}/versions/{version_code}", response_model=DetailResponse)
def bill_version_detail(bill_id: str, version_code: str, db: Session = Depends(get_db)):
    bill_row = get_bill_by_key(db, bill_id)
    version = db.scalar(
        select(BillVersion).where(
            BillVersion.bill_id == bill_row.id, BillVersion.version_code == version_code
        )
    )
    if version is None:
        raise HTTPException(status_code=404, detail="bill version not found")
    return DetailResponse(
        data={
            "version_code": version.version_code,
            "version_name": version.version_name,
            "document_date": version.document_date,
            "html_url": version.html_url,
            "pdf_url": version.pdf_url,
            "is_current": version.is_current,
        }
    )


@router.get(
    "/bills/{bill_id}/versions/{version_code}/text", response_model=DetailResponse
)
def bill_version_text(
    bill_id: str,
    version_code: str,
    format: str = "structured",
    db: Session = Depends(get_db),
):
    bill_row = get_bill_by_key(db, bill_id)
    version = db.scalar(
        select(BillVersion).where(
            BillVersion.bill_id == bill_row.id, BillVersion.version_code == version_code
        )
    )
    if version is None:
        raise HTTPException(status_code=404, detail="bill version not found")
    sections = db.scalars(
        select(BillVersionSection)
        .where(BillVersionSection.bill_version_id == version.id)
        .order_by(BillVersionSection.source_order.asc())
    ).all()
    if format == "plain":
        return DetailResponse(
            data={
                "version_code": version.version_code,
                "text": "\n\n".join(section.raw_text for section in sections),
            }
        )
    return DetailResponse(
        data={
            "version_code": version.version_code,
            "sections": [
                {
                    "section_id": section.section_id_text,
                    "heading": section.section_heading,
                    "article_heading": section.article_heading,
                    "text": section.raw_text,
                    # The same body with the subdivision numbers, added-text
                    # marks and appropriation-table shape the flat text loses
                    # (#741). Null until the section has been re-read from the
                    # Revisor, so a reader falls back to `text`. Both are served:
                    # blocks run ~1.2x the flat text, which only matters on the
                    # 51 bills of 10,433 carrying over 100 sections.
                    "body_blocks": section.body_blocks,
                }
                for section in sections
            ],
        }
    )


@router.get("/bills/{bill_id}/votes", response_model=CollectionResponse)
def bill_votes(
    bill_id: str,
    db: Session = Depends(get_db),
    response: Response = None,  # type: ignore[assignment]
):
    # Vote records carry no per-user data — always publicly cacheable.
    response.headers["Cache-Control"] = PUBLIC_CACHE_CONTROL
    bill_row = get_bill_by_key(db, bill_id)
    row = db.scalar(bill_detail_stmt(bill_row.id))
    # Resolve each voter's name + party once for the whole roll call, batched
    # across every vote event, so party-grouped attribution renders (#83).
    voter_ids = {
        record.legislator_id
        for vote_event in row.vote_events
        for record in vote_event.records
    }
    names = member_name_by_legislator(db, voter_ids)
    parties = member_party_by_legislator(db, voter_ids)
    chambers = chamber_slug_by_id(
        db, {vote_event.chamber_id for vote_event in row.vote_events}
    )
    data = [
        {
            "id": str(vote_event.id),
            "motion_text": vote_event.motion_text,
            "result_text": vote_event.result_text,
            # Definitive chamber for this roll call (never inferred from tallies).
            "chamber": chambers.get(str(vote_event.chamber_id)),
            "yes_count": vote_event.yes_count,
            "no_count": vote_event.no_count,
            "absent_count": vote_event.absent_count,
            "excused_count": vote_event.excused_count,
            "present_count": vote_event.present_count,
            "occurred_at": vote_event.occurred_at,
            "official_url": vote_event.official_url,
            # Per-member roll call (#83). Records are eager-loaded by
            # bill_detail_stmt; only yes/no records are ingested today, so a
            # "did-not-vote" state is deliberately not synthesized here.
            "records": [
                {
                    "legislator_id": str(record.legislator_id),
                    "legislator_name": names.get(str(record.legislator_id)),
                    "party": parties.get(str(record.legislator_id)),
                    "vote_value": record.vote_value.value,
                }
                for record in vote_event.records
            ],
        }
        for vote_event in row.vote_events
    ]
    return CollectionResponse(
        data=data, page={"limit": len(data), "next_cursor": None, "has_more": False}
    )


@router.get("/legislators", response_model=CollectionResponse)
def legislators(
    session: str | None = None,
    q: str | None = None,
    chamber: str | None = None,
    limit: int = Query(default=20, ge=0, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    session_row = get_session_by_slug(db, session)
    stmt = legislator_directory_stmt(session_row.id)
    if q:
        name_clause = keyword_search_clause([Legislator.full_name], q)
        if name_clause is not None:
            stmt = stmt.where(name_clause)
    if chamber:
        stmt = stmt.where(
            LegislatorServicePeriod.chamber.has(Chamber.slug == chamber.strip().lower())
        )
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery()))
    rows, has_more = paginated_scalars(db, stmt, limit=limit, offset=offset)
    row_ids = [row.id for row in rows]
    counts = authored_bill_counts(db, row_ids)
    committees = current_committee_names(db, row_ids)
    data = [
        legislator_list_item(
            row,
            total_bill_count=counts.get(str(row.id), (0, 0))[0],
            chief_bill_count=counts.get(str(row.id), (0, 0))[1],
            committee_names=committees.get(str(row.id), []),
        ).model_dump(exclude_none=True)
        for row in rows
    ]
    return CollectionResponse(
        data=data,
        page={
            "limit": limit,
            "offset": offset,
            "next_cursor": None,
            "has_more": has_more,
            "total": total,
        },
        links={"self": "/api/v1/legislators"},
    )


@router.get("/legislators/{legislator_id}", response_model=DetailResponse)
def legislator_detail(
    legislator_id: str,
    session: str | None = None,
    include: str | None = None,
    db: Session = Depends(get_db),
):
    include_set = {item.strip() for item in include.split(",")} if include else set()
    session_row = get_session_by_slug(db, session)
    legislator = get_legislator_by_id(db, legislator_id)
    row = db.scalar(legislator_profile_stmt(legislator.id, session_row.id))
    current_service = next(iter(row.service_periods), None)
    payload = {
        "id": str(row.id),
        "slug": row.slug,
        "full_name": row.full_name,
        "biography": row.biography,
    }
    if "current_service" in include_set:
        payload["current_service"] = (
            current_service_payload(current_service).model_dump()
            if current_service
            else None
        )
    if "stats" in include_set:
        stats = row.stats[0] if row.stats else None
        total_bill_count, chief_bill_count = authored_bill_counts(db, [row.id]).get(
            str(row.id), (0, 0)
        )
        if stats or total_bill_count or chief_bill_count:
            payload["stats"] = {
                "chief_bill_count": chief_bill_count,
                "total_bill_count": total_bill_count,
                "vote_record_count": stats.vote_record_count if stats else 0,
                "committee_count": stats.committee_count if stats else 0,
            }
    if "committees" in include_set:
        payload["committees"] = [
            {"name": membership.committee.name, "role": membership.role}
            for membership in row.committee_memberships
        ]
    if "service_history" in include_set:
        service_history = service_history_payload(row.election_history)
        if service_history:
            payload["service_history"] = service_history.model_dump()
    return DetailResponse(
        data={key: value for key, value in payload.items() if value is not None}
    )


@router.get("/legislators/{legislator_id}/bills", response_model=CollectionResponse)
def legislator_bills(
    legislator_id: str,
    session: str | None = None,
    role: str | None = None,
    limit: int = Query(default=20, ge=0, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    session_row = get_session_by_slug(db, session)
    legislator = get_legislator_by_id(db, legislator_id)
    role_filter: SponsorshipRole | None = None
    if role is not None:
        try:
            role_filter = SponsorshipRole(role)
        except ValueError as exc:
            raise HTTPException(
                status_code=422, detail=f"Unknown role: {role}"
            ) from exc
    rows, has_more = paginated_scalars(
        db,
        legislator_sponsored_bills_stmt(
            legislator.id, session_row.id, role=role_filter
        ),
        limit=limit,
        offset=offset,
    )
    co_author_counts = bill_co_author_counts(db, [row.id for row in rows])
    data = [
        bill_list_item(
            row,
            co_author_count=co_author_counts.get(str(row.id), 0),
            include_companion=True,
        ).model_dump(exclude_none=True)
        for row in rows
    ]
    return CollectionResponse(
        data=data,
        page={
            "limit": limit,
            "offset": offset,
            "next_cursor": None,
            "has_more": has_more,
        },
    )


@router.get("/legislators/{legislator_id}/votes", response_model=CollectionResponse)
def legislator_votes(
    legislator_id: str,
    session: str | None = None,
    limit: int = Query(default=20, le=100),
    db: Session = Depends(get_db),
):
    session_row = get_session_by_slug(db, session)
    rows = db.scalars(
        schema.legislator_vote_history_stmt(legislator_id, session_row.id).limit(limit)
    ).all()
    data = [
        {
            "id": str(row.id),
            "vote_value": row.vote_value.value,
            "vote_event_id": str(row.vote_event_id),
        }
        for row in rows
    ]
    return CollectionResponse(
        data=data, page={"limit": limit, "next_cursor": None, "has_more": False}
    )


@router.get("/districts", response_model=CollectionResponse)
def districts(limit: int = Query(default=50, le=200), db: Session = Depends(get_db)):
    rows = db.scalars(select(District).order_by(District.code.asc()).limit(limit)).all()
    data = [district_payload(row).model_dump() for row in rows]
    return CollectionResponse(
        data=data, page={"limit": limit, "next_cursor": None, "has_more": False}
    )


@router.get("/districts/{district_id}", response_model=DetailResponse)
def district_detail(district_id: str, db: Session = Depends(get_db)):
    row = db.scalar(select(District).where(District.id == district_id))
    if row is None:
        raise HTTPException(status_code=404, detail="district not found")
    return DetailResponse(data=district_payload(row).model_dump())


@router.get("/districts/{district_id}/legislators", response_model=CollectionResponse)
def district_legislators(
    district_id: str,
    session: str | None = None,
    db: Session = Depends(get_db),
):
    session_row = get_session_by_slug(db, session)
    rows = db.scalars(find_my_legislator_stmt(session_row.id, [district_id])).all()
    counts = authored_bill_counts(db, [row.legislator.id for row in rows])
    data = [
        legislator_list_item(
            row.legislator,
            total_bill_count=counts.get(str(row.legislator.id), (0, 0))[0],
            chief_bill_count=counts.get(str(row.legislator.id), (0, 0))[1],
        ).model_dump(exclude_none=True)
        for row in rows
    ]
    return CollectionResponse(
        data=data, page={"limit": len(data), "next_cursor": None, "has_more": False}
    )


@router.post("/representative-lookups", response_model=DetailResponse)
def representative_lookup(
    request: RepresentativeLookupRequest,
    db: Session = Depends(get_db),
    lookup_service: RepresentativeLookupService = Depends(
        get_representative_lookup_service
    ),
    _rate_limited: None = Depends(rate_limit("lookup_limiter", "lookup")),
):
    current_session = get_session_by_slug(db, None)
    try:
        if request.address_text:
            lookup_result = lookup_service.lookup(request.address_text)
            input_mode = "address"
        else:
            assert request.latitude is not None
            assert request.longitude is not None
            lookup_result = lookup_service.lookup_coordinates(
                latitude=request.latitude,
                longitude=request.longitude,
            )
            input_mode = "coordinates"
    except RepresentativeLookupNotFound as exc:
        raise problem_exception(
            404, "Not Found", str(exc), type_slug="representative-lookup-not-found"
        ) from None
    except (RepresentativeLookupUpstreamError, requests.RequestException) as exc:
        raise problem_exception(
            502,
            "Bad Gateway",
            f"Representative lookup upstream failed: {exc}",
            type_slug="representative-lookup-upstream-error",
        ) from None

    house_district = district_for_match(db, lookup_result.house_district)
    senate_district = district_for_match(db, lookup_result.senate_district)
    district_ids = [
        district.id
        for district in [house_district, senate_district]
        if district is not None
    ]
    if not district_ids:
        raise problem_exception(
            404,
            "Not Found",
            "resolved districts are not available in the database",
            type_slug="representative-districts-not-found",
        )

    periods = db.scalars(
        find_my_legislator_stmt(current_session.id, district_ids)
    ).all()
    house_period = next(
        (
            period
            for period in periods
            if period.chamber.chamber_type == ChamberType.house
        ),
        None,
    )
    senate_period = next(
        (
            period
            for period in periods
            if period.chamber.chamber_type == ChamberType.senate
        ),
        None,
    )
    if house_period is None and senate_period is None:
        raise problem_exception(
            404,
            "Not Found",
            "no current legislators found for resolved districts",
            type_slug="representative-legislators-not-found",
        )

    rep_counts = authored_bill_counts(
        db,
        [
            period.legislator.id
            for period in (house_period, senate_period)
            if period is not None
        ],
    )
    geocoded = lookup_result.geocoded_address
    payload = {
        "resolved_place": {
            "input_mode": input_mode,
            "address_text": request.address_text,
            "matched_address": geocoded.matched_address,
            "latitude": geocoded.latitude,
            "longitude": geocoded.longitude,
            "state_code": geocoded.state_code,
            "house_district": house_district.code if house_district else None,
            "senate_district": senate_district.code if senate_district else None,
        },
        "house_legislator": legislator_list_item(
            house_period.legislator,
            total_bill_count=rep_counts.get(str(house_period.legislator.id), (0, 0))[0],
            chief_bill_count=rep_counts.get(str(house_period.legislator.id), (0, 0))[1],
        ).model_dump(exclude_none=True)
        if house_period
        else None,
        "senate_legislator": legislator_list_item(
            senate_period.legislator,
            total_bill_count=rep_counts.get(str(senate_period.legislator.id), (0, 0))[
                0
            ],
            chief_bill_count=rep_counts.get(str(senate_period.legislator.id), (0, 0))[
                1
            ],
        ).model_dump(exclude_none=True)
        if senate_period
        else None,
    }
    return DetailResponse(data=payload)


@router.get("/search", response_model=DetailResponse)
def search(
    q: str,
    types: str = "bills,legislators",
    session: str | None = None,
    limit: int = Query(default=5, le=20),
    db: Session = Depends(get_db),
):
    type_set = {item.strip() for item in types.split(",")}
    session_row = get_session_by_slug(db, session)
    payload: dict[str, list[dict]] = {"bills": [], "legislators": []}
    if "bills" in type_set:
        number_clause = bill_number_clause(q)
        # Relevance-rank a free-text search; a bill-number lookup stays exact.
        text_query = q if number_clause is None else None
        bills_stmt = bill_list_stmt(session_row.id, text_query=text_query)
        if number_clause is not None:
            # Bill-number query → exclusive ID lookup, not free text (see /bills).
            bills_stmt = bills_stmt.where(number_clause)
        else:
            keyword_clause = keyword_search_clause([Bill.title, Bill.description], q)
            if keyword_clause is not None:
                bills_stmt = bills_stmt.where(keyword_clause)
        payload["bills"] = [
            bill_list_item(row).model_dump(exclude_none=True)
            for row in db.scalars(bills_stmt.limit(limit)).all()
        ]
    if "legislators" in type_set:
        legislators_stmt = legislator_directory_stmt(session_row.id)
        name_clause = keyword_search_clause([Legislator.full_name], q)
        if name_clause is not None:
            legislators_stmt = legislators_stmt.where(name_clause)
        legislator_rows = db.scalars(legislators_stmt.limit(limit)).all()
        counts = authored_bill_counts(db, [row.id for row in legislator_rows])
        payload["legislators"] = [
            legislator_list_item(
                row,
                total_bill_count=counts.get(str(row.id), (0, 0))[0],
                chief_bill_count=counts.get(str(row.id), (0, 0))[1],
            ).model_dump(exclude_none=True)
            for row in legislator_rows
        ]
    return DetailResponse(data=payload)
