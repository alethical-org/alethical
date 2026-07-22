from __future__ import annotations

import re

from datetime import date, datetime, timedelta, timezone
from typing import Any, Literal
from uuid import UUID

import requests

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import and_, case, func, or_, select, text
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
from alethical.api.services.representative_lookup import (
    DistrictMatch,
    RepresentativeLookupNotFound,
    RepresentativeLookupService,
    RepresentativeLookupUpstreamError,
    get_representative_lookup_service,
)
from alethical.api.serializers import (
    ai_analysis_payload_for_enrichment,
    bill_list_item,
    bill_progress_payload,
    bill_status_key,
    companion_payload,
    current_bill_summary_enrichment,
    current_service_payload,
    district_payload,
    legislator_list_item,
    service_history_payload,
    sponsor_payloads,
    tracking_payload,
)
from alethical.db.schema import load_schema
from alethical.db.session import get_db
from alethical.pipeline.policy_area_counts import compute_policy_area_counts

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

    Reads the precomputed ``Bill.status_key`` column (#505), which the DB trigger
    maintains from the exact ``bill_status_key_expr`` cascade the displayed badge
    uses, and keeps only the bills whose key equals the selected status. Because
    every bill maps to exactly one status, the six
    filters are mutually exclusive and their counts sum to the session total
    (the prior per-status OR-substring match double-counted any bill whose
    latest-action text hit two stages, e.g. "Introduction and first reading,
    referred to committee" landed in both "proposed" and "in_committee"). An
    unrecognized status matches nothing, which is correct — it has no bills.
    """
    normalized = status.strip().lower().replace(" ", "_")
    # Read the precomputed status_key column (#505) rather than recomputing the
    # lower()/ILIKE cascade per row. The DB trigger maintains it from the exact
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
    policy_area: str | None = None,
    omnibus: bool | None = None,
    include: str | None = None,
    sort: Literal["latest_action", "progress", "introduced"] = "latest_action",
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
    text_query = q if (q and number_clause is None) else None
    stmt = bill_list_stmt(
        session_row.id,
        user_id=tracking_user_id(include_set, current_user),
        sort=sort,
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
        # Match any raw policy area that rolls up to the selected canonical issue
        # (alethical/api/issue_taxonomy.py) — so "Health" catches "healthcare",
        # "public health", etc. Case-folded whole-element match via unnest (a
        # whole-array cast + ILIKE would over-match and, with sort=progress, time
        # out to a 502). aliases_for falls back to the value itself for an
        # unmapped issue. Measured ~270ms on the production corpus.
        policy_area_aliases = aliases_for(policy_area)
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
    data = [
        bill_list_item(
            row,
            include_tracking="tracking" in include_set and current_user is not None,
            co_author_count=co_author_counts.get(str(row.id), 0),
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
                filing_date = datetime(year, month, day, tzinfo=timezone.utc)
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
# the whole act, so a bill has a single verified effective date ONLY when every
# section carries an explicit clause and they all resolve to the SAME date. Two
# clause shapes are groundable, both confirmed by the #483 spike over all enacted
# bills:
#   Tier A (#483/#561, ~8%): every section names the SAME explicit calendar date
#     (e.g. HF 4138 -> July 1, 2027). Handled by effective_date_from_sections().
#   Tier B (#562, ~15%): every section is "effective the day following final
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
# Everything else — differing per-section dates, a silent section that falls to
# the statutory default, or conditional/contingent language — is genuinely
# ambiguous and gets None, so the UI keeps the honest "LATEST ACTION" fallback
# (#455 / #480) rather than a guessed date.
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
        flattened = re.sub(r"\s+", " ", raw or "")
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
        flattened = re.sub(r"\s+", " ", raw or "")
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


def verified_effective_date(db: Session, bill_row) -> str | None:
    """The enacted bill's statutory effective date, verbatim, or None.

    For enacted bills only, in order of certainty:
      * Tier A (#483/#561): every section names one identical explicit date.
      * Tier B (#562): every section is "effective the day following final
        enactment" AND the Revisor's own "Effective date" action is a single clean
        date falling within a week after the governor-signature date (Minn. Stat.
        645.01) — the authoritative published date, cross-checked, never computed.
    Anything still ambiguous returns None so the caller keeps the honest LATEST
    ACTION treatment (#483 / #455 / #480).
    """
    if bill_status_key(bill_row) != "signed_into_law":
        return None
    current = next((v for v in (bill_row.versions or []) if v.is_current), None)
    if current is None:
        return None
    rows = db.execute(
        select(
            BillVersionSection.effective_date_heading, BillVersionSection.raw_text
        ).where(BillVersionSection.bill_version_id == current.id)
    ).all()
    sections = [(r[0], r[1]) for r in rows]

    tier_a = effective_date_from_sections(sections)
    if tier_a is not None:
        return tier_a

    if effective_date_day_following_enactment(sections):
        actions = bill_row.actions or []
        effective = revisor_effective_date_action(actions)
        approval = governor_approval_date(actions)
        if (
            effective is not None
            and approval is not None
            and approval
            < effective
            <= approval + timedelta(days=_ENACTMENT_EFFECTIVE_WINDOW_DAYS)
        ):
            return (
                f"{_MONTH_NAMES[effective.month - 1]} {effective.day}, {effective.year}"
            )
    return None


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
    if "ai_analysis" in include_set and ai_enrichment is None:
        raise HTTPException(status_code=404, detail="bill enrichment not found")
    payload = {
        "id": row.bill_key,
        "title": row.title,
        "description": row.description,
        "current_status": row.current_status,
        "status_key": bill_status_key(row),
        "latest_action_at": row.latest_action_at,
        # Verbatim statutory effective date, present only when the enacted text
        # states one unambiguously; otherwise absent -> UI shows LATEST ACTION
        # (#483). Never derived from latest_action_at (the #455 bug).
        "effective_date": verified_effective_date(db, row),
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
            ai_enrichment, row.official_url
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
        payload["actions"] = [
            {
                "action_number": action.action_number,
                "action_text": action.action_text,
                "action_group": action.action_group,
                "action_description": action.action_description,
                "action_at": action.action_at,
                "journal_page": action.journal_page,
                "roll_call_text": action.roll_call_text,
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
