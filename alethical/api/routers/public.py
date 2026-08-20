from __future__ import annotations

import re
from collections import Counter, defaultdict
from dataclasses import asdict
from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal
from uuid import UUID

import requests
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import and_, case, func, or_, select, text, tuple_
from sqlalchemy.orm import Session, selectinload

from alethical.api.auth import get_optional_current_user
from alethical.api.issue_taxonomy import canonical_for
from alethical.api.problems import problem_exception
from alethical.api.rate_limit import rate_limit
from alethical.api.schemas import (
    AddressSuggestionRequest,
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
from alethical.api.services.legislative_sessions import (
    current_legislature_scope,
    named_special_session,
)
from alethical.api.services.campaign_finance_payments import (
    MAX_PAYMENTS,
    ORDER_BY_AMOUNT,
    ORDER_BY_DATE,
    PaymentPage,
    independent_payments_about,
    independent_payments_to_vendor,
    payments_from_contributor,
    payments_from_donors_typing,
    payments_made,
    payments_received,
    payments_to_vendor,
)
from alethical.api.services.campaign_finance_register import (
    report_corrections,
    MAX_COMMITTEES,
    MAX_FILINGS,
    committees as register_committees,
    freshness,
    legislator_committee_confirmations,
    recent_filings,
    register_entry,
    register_summary,
)
from alethical.api.services.campaign_finance_search import (
    MAX_PER_GROUP,
    CommitteeRow,
    PaymentNameResult,
    PersonResult,
    search as search_campaign_finance_names,
)
from alethical.api.services.committee_filing_schedule import filing_schedule
from alethical.api.services.committee_finance import (
    Committee as CampaignCommittee,
    CommitteeFinance,
    ReleaseNoLongerHeld,
    committee_finance,
    current_release as current_campaign_finance_release,
    find_committee,
    independent_spending_about,
    money_in as committee_money_in,
    money_out as committee_money_out,
    pin_to_one_view as pin_campaign_finance_to_one_view,
)
from alethical.api.services.independent_spending import (
    independent_spending_for_legislator,
)
from alethical.api.services.issue_bills import MIN_ISSUE_LENGTH, matched_issue_bill_ids
from alethical.api.services.legislator_finance import (
    legislator_finance,
    split_for_committee,
)
from alethical.api.services.representative_lookup import (
    DistrictMatch,
    RepresentativeLookupChoices,
    RepresentativeLookupNotFound,
    RepresentativeLookupOutsideMinnesota,
    RepresentativeLookupService,
    RepresentativeLookupUpstreamError,
    get_representative_lookup_service,
)
from alethical.db.schema import load_schema
from alethical.db.session import get_db
from alethical.pipeline.ai_enrichment import (
    CitedSectionCandidate,
    resolve_cited_section,
)
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
RagSectionDocument = schema.RagSectionDocument
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
LARGE_OFFSET_COUNT_FIRST = 100_000


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

    An unusually large offset is counted first. When it is beyond the real end,
    this avoids making the database sort and skip millions of rows merely to
    prove the page is empty.

    Returns ``(rows, has_more, total)``. The entity stays the first result
    column, so ``selectinload`` eager-loads still fire exactly as before.
    """
    if limit == 0:
        total = db.scalar(
            select(func.count()).select_from(stmt.order_by(None).subquery())
        )
        return [], False, total
    if offset >= LARGE_OFFSET_COUNT_FIRST:
        total = db.scalar(
            select(func.count()).select_from(stmt.order_by(None).subquery())
        )
        if offset >= total:
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
        .where(
            Sponsorship.legislator_id.in_(ids),
            Sponsorship.role.in_(
                [SponsorshipRole.chief_author, SponsorshipRole.co_author]
            ),
        )
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


def current_committee_assignments(
    db: Session, legislator_ids
) -> dict[str, list[tuple[str, str | None]]]:
    ids = list(legislator_ids)
    if not ids:
        return {}
    rows = db.execute(
        select(
            CommitteeMembership.legislator_id,
            Committee.name,
            CommitteeMembership.role,
        )
        .join(Committee, Committee.id == CommitteeMembership.committee_id)
        .where(
            CommitteeMembership.legislator_id.in_(ids),
            CommitteeMembership.is_current.is_(True),
        )
        .order_by(Committee.name.asc())
    ).all()
    result: dict[str, list[tuple[str, str | None]]] = {}
    for legislator_id, name, role in rows:
        result.setdefault(str(legislator_id), []).append((name, role))
    return result


def authored_issue_areas(db: Session, legislator_ids) -> dict[str, list[str]]:
    """Issue labels from current bill summaries for author and co-author roles."""
    ids = list(legislator_ids)
    if not ids:
        return {}
    rows = db.execute(
        select(
            Sponsorship.legislator_id,
            Sponsorship.bill_id,
            AIEnrichment.content_json,
        )
        .join(AIEnrichment, AIEnrichment.bill_id == Sponsorship.bill_id)
        .where(
            Sponsorship.legislator_id.in_(ids),
            Sponsorship.role.in_(
                [SponsorshipRole.chief_author, SponsorshipRole.co_author]
            ),
            AIEnrichment.enrichment_type == EnrichmentType.bill_summary,
            AIEnrichment.is_current.is_(True),
        )
    ).all()
    bills_by_label: dict[str, dict[str, set[str]]] = defaultdict(
        lambda: defaultdict(set)
    )
    for legislator_id, bill_id, content in rows:
        values = (content or {}).get("policy_areas")
        if isinstance(values, list):
            labels = [
                canonical
                for value in values
                if isinstance(value, str)
                and value.strip()
                and (canonical := canonical_for(value)) is not None
            ]
            for label in labels:
                bills_by_label[str(legislator_id)][label].add(str(bill_id))
    return {
        legislator_id: sorted(labels, key=lambda label: (-len(labels[label]), label))
        for legislator_id, labels in bills_by_label.items()
    }


def representative_source_updated_at(db: Session, legislator_ids) -> datetime | None:
    """Oldest successful refresh among the displayed roster and authored bills."""
    ids = list(legislator_ids)
    dates: list[datetime] = []
    roster_date = db.scalar(
        select(func.max(IngestionRun.finished_at)).where(
            IngestionRun.adapter == "minnesota_live",
            IngestionRun.target_type == "legislator_roster",
            IngestionRun.status == IngestionStatus.succeeded,
        )
    )
    if roster_date:
        dates.append(roster_date)
    bill_date = db.scalar(
        select(func.min(IngestionRun.finished_at))
        .join(Bill, Bill.ingestion_run_id == IngestionRun.id)
        .join(Sponsorship, Sponsorship.bill_id == Bill.id)
        .where(
            Sponsorship.legislator_id.in_(ids),
            Sponsorship.role.in_(
                [SponsorshipRole.chief_author, SponsorshipRole.co_author]
            ),
            IngestionRun.status == IngestionStatus.succeeded,
        )
    )
    if bill_date:
        dates.append(bill_date)
    return min(dates) if dates else None


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


# Grammatical filler carries no search signal, but under the all-words-must-match
# rule above a single one of these can zero out an otherwise perfect query. The
# reported case: searching the exact headline a card displays, "Repeal of
# Political Contribution Refund Program", returned nothing for SF 3458, whose
# card shows precisely that. Every other word matched its official title
# ("repealing the political contribution refund program"); "of" appears nowhere
# in it, and one unmatched word is enough to drop the bill.
_FUNCTION_WORDS = frozenset(
    {
        "a",
        "an",
        "and",
        "at",
        "by",
        "for",
        "from",
        "in",
        "of",
        "on",
        "or",
        "the",
        "to",
        "with",
    }
)


def search_words(q: str) -> list[str]:
    """The words of ``q`` a match is actually required on.

    Filler words are dropped, but only while at least one other word survives, so
    a query made entirely of them ("of the") still searches for what was typed
    rather than silently matching every bill. Dropping a *required* word can only
    widen the match set, never shrink it — the same one-way guarantee the stemming
    and trigram branches above are built on.
    """
    words = [word for word in q.split() if word]
    significant = [word for word in words if word.lower() not in _FUNCTION_WORDS]
    return significant or words


# What a bill keyword search matches, in one place so ``/bills`` and the
# ``/search`` typeahead can never search different text. ``short_title`` is the
# plain-language headline the card displays (alembic 0033); a reader searching the
# words on screen must find the bill they are looking at, and before it was
# searched they did not. The official ``title`` and ``description`` stay, so a
# query quoting the legal wording keeps working. Ask's bill disambiguation
# (``_resolve_bill_by_content`` in routers/ask.py) deliberately reads its own
# fields and is not part of this.
BILL_SEARCH_COLUMNS = (Bill.title, Bill.short_title, Bill.description)


def keyword_search_clause(columns, q: str):
    """Case-insensitive keyword match over ``columns`` for query ``q``. Each word
    in ``q`` must match at least one column — as a raw substring, via its stemmed
    root, or (for longer words) via trigram word-similarity so typos still
    resolve. All words must match (AND), filler words excepted (``search_words``).
    Returns None for an empty query."""
    words = search_words(q)
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
    """Resolve a legislator by either its readable ``slug`` or its UUID.

    Profile URLs use the slug (``/legislators/melissa-hortman``); UUID links
    shared before the slug switch still resolve, so no redirect is needed. A
    string that parses as a UUID is looked up by primary key, otherwise by the
    (jurisdiction-unique) slug.
    """
    try:
        parsed_id = UUID(legislator_id)
    except ValueError:
        legislator = db.scalar(
            select(Legislator).where(Legislator.slug == legislator_id)
        )
    else:
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


def member_slug_by_legislator(db: Session, legislator_ids) -> dict[str, str]:
    """Readable profile-URL slug per legislator id, batched for a whole roll call
    so the /votes per-member records can link to /legislators/{slug} (#83)."""
    ids = list(legislator_ids)
    if not ids:
        return {}
    rows = db.execute(
        select(Legislator.id, Legislator.slug).where(Legislator.id.in_(ids))
    ).all()
    return {str(legislator_id): slug for legislator_id, slug in rows}


def member_party_by_legislator(db: Session, legislator_ids) -> dict[str, str | None]:
    """Current/latest party per legislator id, batched in one query for a whole
    roll call (no per-member N+1). Picks each legislator's current period, else
    the most recent one, via DISTINCT ON. Party is served raw (prod has 'DFL',
    'R', and a stray 'Republican'). Feeds the /votes per-member records (#83)."""
    ids = list(legislator_ids)
    if not ids:
        return {}
    rows = db.execute(
        select(
            LegislatorServicePeriod.legislator_id,
            LegislatorServicePeriod.party,
        )
        .join(
            LegislativeSession,
            LegislatorServicePeriod.session_id == LegislativeSession.id,
        )
        .where(LegislatorServicePeriod.legislator_id.in_(ids))
        .distinct(LegislatorServicePeriod.legislator_id)
        # Order the current period first; among non-current periods, the newest
        # session wins. service_period.start_date is always null (#343), so the
        # session's populated start_date is what makes the pick deterministic.
        # period_sequence (later period within a session) then the row id are
        # final tiebreakers so two periods in the same session never tie.
        .order_by(
            LegislatorServicePeriod.legislator_id,
            LegislatorServicePeriod.is_current.desc(),
            LegislativeSession.start_date.desc().nullslast(),
            LegislatorServicePeriod.period_sequence.desc(),
            LegislatorServicePeriod.id.desc(),
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
    service_code = match.district_code.upper()
    code_match = re.fullmatch(r"(\d{1,2})([A-Z]?)", service_code)
    database_code = (
        f"{int(code_match.group(1)):02d}{code_match.group(2)}"
        if code_match
        else service_code
    )
    return db.scalar(
        select(District)
        .join(Chamber, Chamber.id == District.chamber_id)
        .where(
            District.code == database_code,
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
            "session_number": current_session.session_number,
            "year_start": current_session.year_start,
            "year_end": current_session.year_end,
        },
        data_as_of=latest_ingested_at(db),
    )
    return DetailResponse(data=payload, links={"self": "/api/v1/meta"})


def _lastmod(*candidates: datetime | None) -> dict[str, str]:
    """The first non-null candidate as a plain "YYYY-MM-DD" string in UTC, or {} if
    every candidate is null -- never a null lastmod (see sitemap() below).

    The driver may return a timestamptz in a non-UTC session timezone (same trap
    as the session date-range check in test_api_contract.py), so the instant is
    normalized to UTC before its calendar date is read -- otherwise a date near
    midnight UTC could report the wrong day.
    """
    for candidate in candidates:
        if candidate is not None:
            return {"lastmod": candidate.astimezone(UTC).date().isoformat()}
    return {}


@router.get("/sitemap", response_model=DetailResponse)
def sitemap(db: Session = Depends(get_db), response: Response = None):  # type: ignore[assignment]
    """Every bill and legislator URL the sitemap needs, in one request (#1325).

    A Vercel function turns this into sitemap.xml; without it, building that file
    would mean paging /bills 100 rows at a time -- ~105 round trips for the
    ~10,517 bills alone. Two column-only selects, never the full ORM row or the
    normal bill serializer, keep this cheap at that size.
    """
    response.headers["Cache-Control"] = PUBLIC_CACHE_CONTROL
    bill_rows = db.execute(
        select(Bill.bill_key, Bill.latest_action_at, Bill.updated_at).order_by(
            Bill.bill_key.asc()
        )
    ).all()
    # Same roster the /legislators list serves (legislator_directory_stmt +
    # get_session_by_slug(db, None) for the current session), so the count
    # matches -- just the 2 columns a sitemap entry needs instead of the full row.
    session_row = get_session_by_slug(db, None)
    legislator_rows = db.execute(
        legislator_directory_stmt(session_row.id)
        .with_only_columns(Legislator.slug, Legislator.updated_at)
        .order_by(None)
        .order_by(Legislator.slug.asc())
    ).all()
    legislature_session_ids = current_legislature_scope(db).ids
    bill_directory_total = db.scalar(
        select(func.count()).select_from(
            bill_list_stmt(legislature_session_ids).order_by(None).subquery()
        )
    )
    return DetailResponse(
        data={
            # Directory totals deliberately differ from the full URL arrays:
            # all real detail pages belong in the sitemap, while /bills lists
            # only bills with a current plain-language summary.
            "bill_directory_total": bill_directory_total,
            "legislator_directory_total": len(legislator_rows),
            "bills": [
                {"id": bill_key, **_lastmod(latest_action_at, updated_at)}
                for bill_key, latest_action_at, updated_at in bill_rows
            ],
            "legislators": [
                {"slug": slug, **_lastmod(updated_at)}
                for slug, updated_at in legislator_rows
            ],
        }
    )


@router.get("/sessions", response_model=CollectionResponse)
def sessions(db: Session = Depends(get_db)):
    rows = db.scalars(
        select(LegislativeSession).order_by(LegislativeSession.year_start.desc())
    ).all()
    data = [
        {
            "slug": row.slug,
            "name": row.name,
            "is_current": row.is_current,
            "session_number": row.session_number,
            "year_start": row.year_start,
            "year_end": row.year_end,
        }
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
        data={
            "slug": row.slug,
            "name": row.name,
            "is_current": row.is_current,
            "session_number": row.session_number,
            "year_start": row.year_start,
            "year_end": row.year_end,
        }
    )


@router.get("/policy-areas", response_model=CollectionResponse)
def policy_areas(
    session: str | None = None,
    scope: Literal["session", "legislature"] = "session",
    limit: int = Query(default=50, le=100),
    db: Session = Depends(get_db),
):
    session_rows = (
        current_legislature_scope(db).sessions
        if scope == "legislature"
        else (get_session_by_slug(db, session),)
    )
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
    counts: Counter[str] = Counter()
    for session_row in session_rows:
        rows = db.execute(
            text(
                """
                SELECT canonical_name AS name, bill_count
                FROM policy_area_count
                WHERE session_id = :sid ::uuid
                """
            ),
            {"sid": str(session_row.id)},
        ).all()
        if not rows:
            rows = compute_policy_area_counts(db, session_row.id)
        counts.update({name: count for name, count in rows})
    ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:limit]
    data = [{"name": name, "bill_count": count} for name, count in ranked]
    return CollectionResponse(
        data=data,
        page={"limit": limit, "next_cursor": None, "has_more": False},
        links={"self": "/api/v1/policy-areas"},
    )


@router.get("/bills", response_model=CollectionResponse)
def bills(
    session: str | None = None,
    q: str | None = None,
    topic: str | None = None,
    scope: Literal["session", "legislature"] = "session",
    chamber: str | None = None,
    status: str | None = None,
    policy_area: list[str] | None = Query(default=None),
    omnibus: bool | None = None,
    include: str | None = None,
    view: Literal["cards", "directory"] = "cards",
    sort: Literal["relevance", "latest_action", "progress", "introduced"] | None = None,
    limit: int = Query(default=20, ge=0, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user=Depends(get_optional_current_user),
    response: Response = None,  # type: ignore[assignment]
):
    legislature_scope = (
        current_legislature_scope(db) if scope == "legislature" else None
    )
    session_ids = (
        legislature_scope.ids
        if legislature_scope is not None
        else (get_session_by_slug(db, session).id,)
    )
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
        session_ids,
        user_id=tracking_user_id(include_set, current_user),
        sort=effective_sort,
        text_query=text_query,
        directory=view == "directory",
    )
    if q:
        if number_clause is not None:
            # A bill-number query ("SF334", "334") is an ID lookup, not free text.
            # Match file_type/file_number exclusively so a bare number resolves the
            # bill by its badge and doesn't also pull in every bill that merely
            # mentions the digits in its title or description (#134).
            stmt = stmt.where(number_clause)
        else:
            keyword_clause = keyword_search_clause(BILL_SEARCH_COLUMNS, q)
            if keyword_clause is not None:
                stmt = stmt.where(keyword_clause)
    topic_value = (topic or "").strip()
    if topic is not None:
        # Backward compatibility for Ask links shared before the Topic badge was
        # retired. Topic now means the same hidden-label filter as Issue.
        if len(topic_value) < MIN_ISSUE_LENGTH:
            stmt = stmt.where(Bill.id.is_(None))
        else:
            stmt = stmt.where(Bill.id.in_(matched_issue_bill_ids([topic_value])))
    if chamber:
        stmt = stmt.where(Bill.chamber.has(Chamber.slug == chamber.strip().lower()))
    if status:
        stmt = stmt.where(status_filter_clause(status))
    if policy_area:
        # Ask and Search share this exact whole-label Issue rule. Multi-select is
        # OR within the Issue facet; every other active facet still intersects it.
        stmt = stmt.where(Bill.id.in_(matched_issue_bill_ids(policy_area)))
    if omnibus is not None:
        stmt = stmt.where(Bill.is_omnibus.is_(omnibus))
    rows, has_more, total = paginated_scalars_with_total(
        db, stmt, limit=limit, offset=offset
    )

    def special_session_ref(row):
        if legislature_scope is None or row.session_id == legislature_scope.primary.id:
            return None
        session_row = legislature_scope.by_id(row.session_id)
        if session_row is None:
            return None
        return {
            "slug": session_row.slug,
            "name": session_row.name,
            "is_current": session_row.is_current,
            "session_number": session_row.session_number,
            "year_start": session_row.year_start,
            "year_end": session_row.year_end,
        }

    data: list[Any]
    if view == "directory":
        short_titles = _target_short_titles(db, {row.id for row in rows})
        data = []
        for row in rows:
            data.append(
                {
                    "id": row.bill_key,
                    "current_status": row.current_status,
                    "status_key": row.status_key,
                    "session": special_session_ref(row),
                    "ai_analysis": {"short_title": short_titles.get(row.id)},
                }
            )
    else:
        co_author_counts = bill_co_author_counts(db, [row.id for row in rows])
        effective_dates = bill_effective_dates(db, rows)
        data = [
            bill_list_item(
                row,
                include_tracking="tracking" in include_set and current_user is not None,
                co_author_count=co_author_counts.get(str(row.id), 0),
                effective_date=effective_dates.get(str(row.id)),
                session=special_session_ref(row),
            )
            for row in rows
        ]
    return CollectionResponse(
        data=[
            item.model_dump(exclude_none=True) if hasattr(item, "model_dump") else item
            for item in data
        ],
        page={
            "limit": limit,
            "offset": offset,
            "next_cursor": None,
            "has_more": has_more,
            "total": total,
        },
        links={"self": "/api/v1/bills"},
    )


@router.get("/bills/featured", response_model=CollectionResponse)
def featured_bills(
    bill_id: list[str] = Query(min_length=1, max_length=10),
    db: Session = Depends(get_db),
    response: Response = None,  # type: ignore[assignment]
):
    """Return a small, ordered set of editorial bill cards across sessions.

    This is deliberately separate from ``/bills``: an editorial card can name a
    prior-session bill, while the normal list always scopes itself to 1 session.
    Missing pins are omitted so one retired card cannot hide the other card.
    """
    requested_ids = list(dict.fromkeys(bill_id))
    response.headers["Cache-Control"] = PUBLIC_CACHE_CONTROL
    rows = db.scalars(
        select(Bill)
        .where(Bill.bill_key.in_(requested_ids))
        .options(
            selectinload(Bill.stats),
            selectinload(Bill.chief_sponsorships).selectinload(Sponsorship.legislator),
            selectinload(Bill.enrichments),
            selectinload(Bill.actions),
        )
    ).all()
    rows_by_key = {row.bill_key: row for row in rows}
    ordered_rows = [rows_by_key[key] for key in requested_ids if key in rows_by_key]
    co_author_counts = bill_co_author_counts(db, [row.id for row in ordered_rows])
    effective_dates = bill_effective_dates(db, ordered_rows)

    return CollectionResponse(
        data=[
            bill_list_item(
                row,
                co_author_count=co_author_counts.get(str(row.id), 0),
                effective_date=effective_dates.get(str(row.id)),
            ).model_dump(exclude_none=True)
            for row in ordered_rows
        ]
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


def _citation_section_topics(
    db: Session,
    bill_row,
    section_orders: dict[tuple[str, str], int] | None = None,
) -> dict[str | tuple[str, str], str]:
    """Citation key -> short chip topic, for the current version's sections.

    Fills in the "· Topic" half of the Summary tab's citation chips at request time,
    so every already-enriched bill gets one rather than only the bills a future
    re-enrichment happens to touch (the stored label carries the number alone for
    the statute-amending sections, which are most of the cited ones).

    Three short text columns for one version's sections — the detail route already
    reads this table for the effective-date schedule, and citations only render on
    this endpoint (the list serializer passes no official_url, so it emits none).

    A placed citation is keyed by the same (section id, quote) pair that resolved
    its section position. That lets repeated ids name the heading of the section the
    quote actually matched (#869), rather than discarding the resolved position and
    guessing from the shared id again.

    The id-only entries remain as the safe fallback. An id naming MORE THAN ONE
    section resolves to no topic. `section_id_text` is
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
            BillVersionSection.source_order,
            BillVersionSection.section_heading,
            BillVersionSection.cite_heading,
        ).where(BillVersionSection.bill_version_id == current.id)
    ).all()
    topics: dict[str | tuple[str, str], str] = {}
    topics_by_order: dict[int, str] = {}
    seen: set[str] = set()
    for section_id_text, source_order, section_heading, cite_heading in rows:
        if not section_id_text:
            continue
        topic = section_chip_topic(section_heading, cite_heading)
        if topic:
            topics_by_order[source_order] = topic
        if section_id_text in seen:
            # A second section answering to the same id. Neither can be trusted as
            # the one cited, so the id resolves to nothing. Counting a heading-less
            # section as "seen" matters: it occupies the id too, so a later duplicate
            # that happens to have a heading must not answer on its behalf.
            topics.pop(section_id_text, None)
            continue
        seen.add(section_id_text)
        if topic:
            topics[section_id_text] = topic
    for citation_key, source_order in (section_orders or {}).items():
        if topic := topics_by_order.get(source_order):
            topics[citation_key] = topic
    return topics


def _citation_section_orders(
    db: Session, bill_row, enrichment
) -> dict[tuple[str, str], int]:
    """(section_id, quote) -> the POSITION of the section that citation cites.

    A citation stores the cited section's `section_id_text`, and that does not
    identify a section: `laws.0.1.0` is the id the Revisor hands every section
    sitting outside an article, so 66 current versions repeat one id across as many
    as 30 sections (#763, #854). Without a position the chip's jump lands on
    whichever repeat comes first, a shared link opens the wrong section, and the
    CITED IN SUMMARY badge lights every repeat. `resolve_cited_section` recovers the
    position from the citation's own verbatim quote and label; a citation it cannot
    place is simply absent from this map.

    Keyed on the PAIR because two citations on one page can carry the same
    `section_id` and still cite different sections — HF 1134 has one chip for Sec. 1
    and another for Sec. 126, both stored as `laws.0.1.0` — and the quote is what
    tells them apart.

    Two queries, and the second only when it is needed. The first reads a string and
    an integer per section, which settles the ~10,400 bills whose section ids are all
    distinct: an id naming one section resolves to it with nothing else to read. The
    second fetches the label and body text to match against, and only for the
    repeated ids a citation actually targets — loading every section's body on every
    bill page would cost megabytes on the largest bills (one version runs to 761
    sections).

    That body comes from the RAG document where there is one, falling back to the
    section's own `raw_text`. The two are not interchangeable: the RAG text is what
    the enrichment checked the quote against, so it renders the Revisor's change
    markers the same way ("[deleted: …]"). Matched against `raw_text` alone, 6 of the
    affected citations find their quote in no candidate at all. The fallback stays
    because 23,885 sections have no RAG document.
    """
    current = next((v for v in (bill_row.versions or []) if v.is_current), None)
    if current is None:
        return {}
    stored = ((enrichment.content_json or {}) if enrichment else {}).get(
        "key_point_citations"
    )
    cited = [entry for entry in stored or [] if isinstance(entry, dict)]
    if not cited:
        return {}

    positions: dict[str, list[int]] = defaultdict(list)
    for section_id_text, source_order in db.execute(
        select(BillVersionSection.section_id_text, BillVersionSection.source_order)
        .where(BillVersionSection.bill_version_id == current.id)
        .order_by(BillVersionSection.source_order.asc())
    ).all():
        if section_id_text:
            positions[section_id_text].append(source_order)

    def cited_id(entry) -> str:
        value = entry.get("section_id")
        return value.strip() if isinstance(value, str) else ""

    ambiguous = {
        section_id
        for section_id in (cited_id(entry) for entry in cited)
        if len(positions.get(section_id, ())) > 1
    }
    detail: dict[int, tuple[str | None, str | None]] = {}
    if ambiguous:
        detail = {
            source_order: (citation_label, clean_text or raw_text)
            for source_order, citation_label, clean_text, raw_text in db.execute(
                select(
                    BillVersionSection.source_order,
                    RagSectionDocument.citation_label,
                    RagSectionDocument.clean_text,
                    BillVersionSection.raw_text,
                )
                .outerjoin(
                    RagSectionDocument,
                    RagSectionDocument.bill_version_section_id == BillVersionSection.id,
                )
                .where(
                    BillVersionSection.bill_version_id == current.id,
                    BillVersionSection.section_id_text.in_(ambiguous),
                )
            ).all()
        }

    orders: dict[tuple[str, str], int] = {}
    for entry in cited:
        section_id = cited_id(entry)
        label, quote = entry.get("label"), entry.get("quote")
        if not section_id or not isinstance(quote, str):
            continue
        candidates = [
            CitedSectionCandidate(
                source_order=source_order,
                label=detail.get(source_order, (None, None))[0],
                text=detail.get(source_order, (None, None))[1],
            )
            for source_order in positions.get(section_id, ())
        ]
        match = resolve_cited_section(
            candidates, label if isinstance(label, str) else "", quote
        )
        if match is not None:
            orders[(section_id, quote.strip())] = match.source_order
    return orders


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
    ``named_special_session`` for how a name is pinned to one session and why an
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
        named = named_special_session(description, legislature)
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


def same_legislature_session_ids(db: Session, session_id) -> tuple:
    """The other sessions convened by the same Legislature as ``session_id``.

    A special session is the same Legislature as its regular session: the same
    members hold the same seats and nobody is elected in between, so a member's
    service period from either one answers for the other (#1104). Production
    records 0 service periods against the 2025 First Special Session, which is
    why all 46 of its bills served an author's name and nothing else.

    Matched on ``session_number`` within one jurisdiction, never wider. Across
    bienniums a member may have been redistricted or replaced, so a broader
    fallback would state a district they did not hold.
    """
    own = db.get(LegislativeSession, session_id)
    if own is None:
        return ()
    return tuple(
        db.scalars(
            select(LegislativeSession.id).where(
                LegislativeSession.jurisdiction_id == own.jurisdiction_id,
                LegislativeSession.session_number == own.session_number,
                LegislativeSession.id != session_id,
            )
        ).all()
    )


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
    citation_section_orders = _citation_section_orders(db, row, ai_enrichment)
    citation_section_topics = _citation_section_topics(db, row, citation_section_orders)
    # Resolved once for the whole response, not per sponsor: the sponsor payloads
    # fall back to a same-Legislature session when the bill's own session has no
    # service period, which is every special-session bill (#1104).
    biennium_session_ids = same_legislature_session_ids(db, row.session_id)
    payload = {
        "id": row.bill_key,
        "title": row.title,
        "session": {
            "slug": row.session.slug,
            "name": row.session.name,
            "is_current": row.session.is_current,
            "session_number": row.session.session_number,
            "year_start": row.session.year_start,
            "year_end": row.session.year_end,
        },
        "description": row.description,
        "current_status": row.current_status,
        "status_key": row.status_key,
        "latest_action_at": row.latest_action_at,
        # When we last pulled THIS bill from the Legislature — the finish time of
        # the ingestion run that last wrote the row. This is the page's source-line
        # date (#861): "Updated {date}" has to mean "this is how current our copy
        # is", and the two values that were available before this both said
        # something else. `latest_action_at` is the Legislature's last action on the
        # bill (a fact the bill card already states, correctly labelled), and the
        # corpus-wide max(IngestionRun.finished_at) covers every bill at once, so it
        # can post-date the very record it stamps — measured Jul 31 2026, it would
        # have claimed Jul 30 for 10,414 bills last pulled Jul 14 or 15.
        # One indexed primary-key lookup; `Bill.ingestion_run_id` is set on every
        # upsert and is populated for all 10,517 production bills.
        #
        # COALESCE to the run's start because `finished_at` is nullable and a run
        # that is still going — or one that recorded a status without a finish time,
        # as the test fixture's do — would otherwise serve nothing and silently drop
        # the date from the page. A run's start and finish sit minutes apart, so the
        # displayed day is the same either way; a missing date is the worse outcome.
        "last_pulled_at": (
            db.scalar(
                select(
                    func.coalesce(IngestionRun.finished_at, IngestionRun.created_at)
                ).where(IngestionRun.id == row.ingestion_run_id)
            )
            if row.ingestion_run_id
            else None
        ),
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
                biennium_session_ids=biennium_session_ids,
            )
        ],
        "tracking": tracking_payload(row.tracked_by).model_dump()
        if "tracking" in include_set and current_user
        else None,
        "ai_analysis": ai_analysis_payload_for_enrichment(
            ai_enrichment,
            row.official_url,
            citation_section_topics,
            citation_section_orders,
        ),
        "ai_summary": ai_enrichment.content_json if ai_enrichment else None,
    }
    if "all_sponsors" in include_set:
        payload["all_sponsors"] = [
            item.model_dump()
            for item in sponsor_payloads(
                row.sponsorships,
                session_id=row.session_id,
                biennium_session_ids=biennium_session_ids,
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
                    # The section's position in the version, 1-based. Served
                    # BESIDE `section_id` because the id does not identify a
                    # section: `laws.0.1.0` is what the Revisor hands every
                    # section sitting outside an article, so 66 current versions
                    # repeat one id across as many as 30 sections (#763, #854).
                    # `(bill_version_id, source_order)` is the row's uniqueness
                    # constraint, so this is the only value that can key a
                    # per-section HTML id or share link to one section.
                    "source_order": section.source_order,
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
    slugs = member_slug_by_legislator(db, voter_ids)
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
                    "slug": slugs.get(str(record.legislator_id)),
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
    limit: int = Query(default=20, ge=0, le=250),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    response: Response = None,  # type: ignore[assignment]
):
    response.headers["Cache-Control"] = PUBLIC_CACHE_CONTROL
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
    legislator = get_legislator_by_id(db, legislator_id)
    rows = db.scalars(
        schema.legislator_vote_history_stmt(legislator.id, session_row.id).limit(limit)
    ).all()
    chambers = chamber_slug_by_id(db, {row.vote_event.chamber_id for row in rows})
    data = [
        {
            "id": str(row.id),
            "vote_value": row.vote_value.value,
            "vote_event_id": str(row.vote_event_id),
            "bill_id": row.vote_event.bill.bill_key,
            "bill_code": (
                f"{row.vote_event.bill.file_type} {row.vote_event.bill.file_number}"
            ),
            "occurred_at": (
                row.vote_event.occurred_at.astimezone(UTC)
                if row.vote_event.occurred_at
                else None
            ),
            "chamber": chambers.get(str(row.vote_event.chamber_id)),
        }
        for row in rows
    ]
    return CollectionResponse(
        data=data, page={"limit": limit, "next_cursor": None, "has_more": False}
    )


@router.get(
    "/legislators/{legislator_id}/independent-spending",
    response_model=DetailResponse,
)
def legislator_independent_spending(
    legislator_id: str,
    year: int = Query(ge=2015, le=2100),
    db: Session = Depends(get_db),
):
    """Money spent about this legislator by groups other than their campaign.

    ``state`` is the field to read first, because only ``reported`` carries
    figures a page may print:

    * ``unavailable`` -- we hold no usable release, or we hold rows about this
      member that we cannot add up because their amount is blank. Both are facts
      about us, and neither is ever rendered as a figure about a named person.
    * ``link_unconfirmed`` -- we have not yet confirmed which registered
      committee is theirs, so no payment can be attributed to them.
    * ``reported`` -- the figures are real, and a 0 is a measured 0.

    Three figures, and they account between them for every row we hold:
    ``supporting``, ``opposing``, and ``direction_not_recorded`` for money whose
    "For" or "Against" is unreadable. The third is 0 for every committee in the
    current release, because all 41,130 rows record one or the other, so a surface
    shows it only when it is not 0 rather than reserving space for it. It exists so
    that a row the Board starts publishing differently gets a figure of its own
    instead of vanishing from the total
    (``alethical/api/services/independent_spending.py``).

    ``payment_count`` counts only the payments behind ``supporting`` and
    ``opposing``. A payment with no readable direction is in
    ``direction_not_recorded_payments`` instead, so print both or neither. Each
    figure's own count is served too (``supporting_payments``,
    ``opposing_payments``), because a page putting the combined count under both
    figures would say the same payments produced each of them.

    ``snapshot_id`` names the download that answered. **A page asking about several
    years makes several requests, each resolving the live release on its own, so it
    must compare this before printing one freshness date over all of them**: a publish
    landing between 2 requests otherwise pairs one year's money with another year's
    date. Every figure this route serves is a sum of the payments the state's file
    records, and the file is not limited to large ones -- 17,194 of its 41,130 rows are
    under $200 (measured 13 Aug 2026) -- so no caller may describe these as only the
    payments above a threshold.
    """
    legislator = get_legislator_by_id(db, legislator_id)
    spending = independent_spending_for_legislator(db, legislator.id, year=year)
    return DetailResponse(
        data={
            "legislator_id": str(legislator.id),
            "year": spending.year,
            "state": spending.state,
            "snapshot_id": spending.snapshot_id,
            "supporting": spending.supporting,
            "opposing": spending.opposing,
            "direction_not_recorded": spending.direction_not_recorded,
            "payment_count": spending.payment_count,
            "supporting_payments": spending.supporting_payments,
            "opposing_payments": spending.opposing_payments,
            "direction_not_recorded_payments": spending.direction_not_recorded_payments,
            "source_url": spending.source_url,
            "fetched_at": spending.fetched_at,
            "committees": [
                {
                    "registration_number": committee.registration_number,
                    "committee_name": committee.committee_name,
                    "office": committee.office,
                    "supporting": committee.supporting,
                    "opposing": committee.opposing,
                    "direction_not_recorded": committee.direction_not_recorded,
                    "supporting_payments": committee.supporting_payments,
                    "opposing_payments": committee.opposing_payments,
                    "direction_not_recorded_payments": (
                        committee.direction_not_recorded_payments
                    ),
                    "first_payment_on": committee.first_payment_on,
                    "last_payment_on": committee.last_payment_on,
                }
                for committee in spending.committees
            ],
        }
    )


@router.get(
    "/committees/{registration_number}/finance",
    response_model=DetailResponse,
)
def committee_finance_for_year(
    registration_number: str,
    year: int = Query(ge=2015, le=2100),
    db: Session = Depends(get_db),
):
    """One campaign committee's money in and money out for one year.

    Keyed on Minnesota's registration number, which identifies a committee on its
    own, so nothing here waits on anyone confirming which committee belongs to which
    person ([#1442](https://github.com/alethical-org/alethical/issues/1442)).

    **The itemized figures are sums of named rows, never a committee's total.**
    Minnesota names a donor only once their giving passes $200 in aggregate within a
    calendar year, so the named payments and the committee's own reported total are
    different figures -- around 4 dollars in 10 go unnamed on a typical filing. Rule
    12's second number is here too: ``money_in.reported_total`` is the filer's own
    reported figure ([#1408](https://github.com/alethical-org/alethical/issues/1408))
    with the date it runs to, and ``split`` says whether the two may be divided into
    named and unnamed money -- read ``split.state`` before drawing any composition,
    because the 7 withheld states are each a way a subtraction would state something
    false, and only 1 of them may say Minnesota's 2 publications disagree
    (``.claude/rules/grounded-answers.md`` rule 12,
    ``docs/architecture/campaign-finance-system-design.md`` §7). The full list is on
    ``GET /legislators/{legislator_id}/campaign-finance``, which serves the same
    ``split`` object from the same code.

    ``filing_schedule`` is when this committee's next report is due, and it is the field
    a page reads to say **why** a year is empty. Its ``state`` is the committee's own
    position -- on this year's ballot, not on it, or closed, with ``terminated_on`` where
    the registration has ended -- or one of 3 states that are facts about us: no filings
    published, this number absent from the copy we hold, or a day earlier than the
    evidence. Every one of them arrives with a plain ``reason``.
    **Nothing in this block can say a report is late**, because the service answers what
    is next due and never what was missed, and the signal is only readable for the year
    happening now. **A due date is never served without its printed condition**: they sit
    inside one ``next_report`` object, so a client cannot take the date and leave the
    condition behind. The 2026 pre-general report is the live case, and the condition is
    the Board's own sentence, verbatim.

    ``report_corrections`` is how many times this committee-year's report has been refiled
    with different figures: above 0 means it was corrected, ``0`` means it was not, and
    ``null`` means we hold no version history and may not say either way. It is the
    evidence behind ``split.state`` of ``reported_total_predates_a_correction``, served so
    a page can name the correction rather than infer it. **What we do not hold is the day
    the Board received it or the figure it replaced** -- both live inside report
    documents, which cost a request each and fail with a success status
    ([#1670](https://github.com/alethical-org/alethical/issues/1670)).

    ``register`` is the Board's registered-filer directory entry for this number, from
    our stored copy of the register: its verbatim kind (the only kind label a page may
    print), a candidate's office and district, and the termination date that makes a
    closed committee its own display state. Its ``state`` is independent of the money
    blocks -- ``not_registered`` means our copy of the register does not carry this
    number, which can happen while the downloads still hold its rows, and
    ``unavailable`` means we hold no register to ask.

    Read ``state`` on each block before its numbers:

    * ``reported`` -- we hold itemized rows and the figures are real.
    * ``not_reported`` -- we hold none for this committee-year, in a year the download
      does cover. **Never render this as 0.** A committee whose donors all gave $200 or
      less is never itemized, so absence here is silence rather than a zero.
      ``independent_spending`` is the one exception and says so below.
    * ``unavailable`` -- either our own copy of that download is stale, or the download
      holds nothing at all for the year asked for. Both are facts about us and never a
      figure about the committee. The downloads reach 2015 to the present while this
      route accepts years to 2100, so a request for a year past the data reads
      unavailable rather than reporting a zero for a year nobody has filed for.

    ``money_out.itemized_payment_total`` sums every row whatever its ``Type``, with
    the source's own labels in ``by_type``. A candidate committee files
    ``Campaign Expenditure`` and a party unit files ``General Expenditure`` for the
    same thing, so any single-label filter reports a whole kind of filer as having
    spent nothing.

    ``money_in.itemized_contribution_total`` counts only rows the source types
    ``Contribution``. The other 3 receipt types it carries are real money reported on
    separate schedules -- a candidate's loan to their own campaign, most often -- and
    appear under ``other_receipts`` with the source's own label. They must never be
    added to the contribution figure.

    ``independent_spending`` is money others spent supporting or opposing this
    committee, and it is the one block where a committee with no rows reads as a
    measured ``0``: nobody filed an independent expenditure about them at all, which is
    a finding rather than a gap. **Not "none over $200"** -- that qualifier was here and
    was false. The $200 in `.claude/rules/grounded-answers.md` rule 12 is a *donor's*
    yearly aggregate on the contributions file, not a floor on this one: 17,194 of the
    independent-expenditure file's 41,130 rows are under $200 and 13,393 are under $100,
    with a minimum of $0.00 (measured 13 Aug 2026). It carries a third figure,
    ``direction_not_recorded``, for money whose "For" or "Against" cannot be read --
    0 for every committee in the current release, and its own figure rather than a
    silent omission for the day that changes. ``unavailable`` on this block also
    covers rows we hold about the committee and cannot add up.

    404 means this registration number is in neither our copy of the Board's register
    nor any dataset of the current release. That is a statement about our records --
    the number may be newer than our copy, or mistyped. A committee the register lists
    with no money rows anywhere is a real committee and answers 200, each block saying
    what its absence means. 503 means we hold no usable release at all.
    """
    # Before any other statement: pins every read below to one instant of the
    # database, so 2 publishes landing mid-request cannot turn this committee's
    # spending into an absence while its income has already been read.
    pin_campaign_finance_to_one_view(db)
    unusable = HTTPException(
        status_code=503,
        detail=(
            "no usable campaign-finance release is published; "
            "this says nothing about any committee"
        ),
    )
    try:
        release = current_campaign_finance_release(db)
        if release is None:
            raise unusable
        finance = committee_finance(
            db, release, registration_number=registration_number, year=year
        )
        register = register_entry(db, registration_number)
        if finance is None and register.state == "reported":
            # The register lists this number and the downloads hold no row of its
            # money in any year -- ordinary for a newly registered filer, and true of
            # 33 committees and funds on census day (#1661). A real committee, so it
            # gets a page, with each block saying what its own absence means.
            committee = CampaignCommittee(
                registration_number, register.name or "", None, None
            )
            finance = CommitteeFinance(
                committee=committee,
                year=year,
                release_id=release.id,
                fetched_at=release.fetched_at,
                money_in=committee_money_in(
                    db, release, registration_number=registration_number, year=year
                ),
                money_out=committee_money_out(
                    db, release, registration_number=registration_number, year=year
                ),
                independent_spending=independent_spending_about(
                    db, release, committee=committee, year=year
                ),
            )
        split = (
            split_for_committee(
                db,
                release,
                registration_number=registration_number,
                year=year,
                finance=finance,
            )
            if finance is not None
            else None
        )
    except ReleaseNoLongerHeld:
        # The release exists and its rows have been replaced out from under it, so we
        # cannot name this committee at all. A 404 here would say it does not exist,
        # on the strength of our own pruning.
        raise unusable from None
    if finance is None or split is None:
        raise HTTPException(
            status_code=404,
            detail=(
                "this registration number is in neither the register we hold nor "
                "any dataset of the current campaign-finance release"
            ),
        )
    spending = finance.independent_spending
    return DetailResponse(
        data={
            "registration_number": finance.committee.registration_number,
            "committee_name": finance.committee.name,
            "entity_type": finance.committee.entity_type,
            "entity_sub_type": finance.committee.entity_sub_type,
            "year": finance.year,
            "release_id": str(finance.release_id),
            "fetched_at": finance.fetched_at,
            "filing_schedule": _filing_schedule_payload(
                filing_schedule(db, registration_number, year=year)
            ),
            # How many times this committee-year's report has been refiled with
            # different figures. Above 0 means it was corrected, 0 means it was not,
            # and `null` means we hold no version history and may not say either way --
            # a count we cannot compute is absent, never a measured zero
            # (`.claude/rules/grounded-answers.md` rule 12).
            "report_corrections": report_corrections(db, registration_number, year),
            "register": {
                "state": register.state,
                "kind": register.kind,
                "name": register.name,
                "party": register.party,
                "office": register.office,
                "district": register.district,
                "registration_date": register.registration_date,
                "termination_date": register.termination_date,
                "as_of": register.as_of,
                "reason": register.reason,
            },
            "split": {
                "state": split.state,
                "reported_total": split.reported_total,
                "reported_through": split.reported_through,
                "named_total": split.named_total,
                "named_payments": split.named_payments,
                "named_cash_total": split.named_cash_total,
                "named_in_kind_total": split.named_in_kind_total,
                "unnamed_total": split.unnamed_total,
                "stated_split_state": split.stated_split_state,
                "first_payment_on": split.first_payment_on,
                "last_payment_on": split.last_payment_on,
            },
            "money_in": {
                "state": finance.money_in.state,
                "itemized_contribution_total": (
                    finance.money_in.itemized_contribution_total
                ),
                "itemized_contribution_payments": (
                    finance.money_in.itemized_contribution_payments
                ),
                "other_receipts": [
                    {
                        "receipt_type": receipt.receipt_type,
                        "total": receipt.total,
                        "payments": receipt.payments,
                    }
                    for receipt in finance.money_in.other_receipts
                ],
                "reported_total": finance.money_in.reported_total,
                "reported_through": finance.money_in.reported_through,
                "source_url": finance.money_in.source_url,
            },
            "money_out": {
                "state": finance.money_out.state,
                "itemized_payment_total": finance.money_out.itemized_payment_total,
                "itemized_payments": finance.money_out.itemized_payments,
                "by_type": [
                    {
                        "type": entry.expenditure_type,
                        "total": entry.total,
                        "payments": entry.payments,
                    }
                    for entry in finance.money_out.by_type
                ],
                "source_url": finance.money_out.source_url,
            },
            "independent_spending": {
                "state": spending.state,
                "supporting": (
                    spending.spending.supporting if spending.spending else None
                ),
                "opposing": spending.spending.opposing if spending.spending else None,
                "direction_not_recorded": (
                    spending.spending.direction_not_recorded
                    if spending.spending
                    else None
                ),
                "supporting_payments": (
                    spending.spending.supporting_payments if spending.spending else None
                ),
                "opposing_payments": (
                    spending.spending.opposing_payments if spending.spending else None
                ),
                "direction_not_recorded_payments": (
                    spending.spending.direction_not_recorded_payments
                    if spending.spending
                    else None
                ),
                "first_payment_on": (
                    spending.spending.first_payment_on if spending.spending else None
                ),
                "last_payment_on": (
                    spending.spending.last_payment_on if spending.spending else None
                ),
                "source_url": spending.source_url,
            },
        }
    )


def _filing_schedule_payload(outcome) -> dict:
    """One committee-year's filing schedule, over HTTP.

    Net: a money page showing nothing for a year has to say **why**, and the 6 reasons
    are genuinely different facts ([#1642](https://github.com/alethical-org/alethical/issues/1642)).
    3 of them are about the committee -- it is on this year's ballot, it is not, it has
    closed -- and 3 are about us. Collapsing any 2 states something false about a named
    politician, so each arrives with its own ``state`` and its own plain ``reason``.

    **Two things this shape refuses to do, and both are refusals rather than
    conventions.**

    * **Nothing here can say a report is late.** ``committee_filing_schedule`` answers
      what is *next* due and never what was missed, so there is no lateness to serialize.
      The signal is only readable for the year happening now, and the same code run over
      an older year would accuse people of missing deadlines they never had.
    * **A due date is never servable without its printed condition.** They travel inside
      one ``next_report`` object rather than as siblings, so a client cannot fetch the
      date and leave the condition behind by omission. The 2026 pre-general report is the
      live case: everyone who advances past the primary owes it and everyone who lost
      does not, and no record we hold says which happened, so the Board's own printed
      sentence is the only honest form of that date.

    ``terminated_on`` is the registration's own end date and is read from the filer
    rather than from a report, because the catalogue copies it onto every report a
    terminated committee ever filed, including ones filed years earlier. Paul Novotny's
    committee (18472) closed on 28 Jul 2026 and is the one sitting member's committee
    affected.
    """
    schedule_class = getattr(outcome, "schedule_class", None)
    state = (
        schedule_class.value
        if schedule_class is not None
        else getattr(outcome, "state")
    )
    calendar = getattr(outcome, "calendar", None)
    entry = getattr(outcome, "next_report", None)
    return {
        "state": state,
        "reason": outcome.reason,
        "calendar": calendar.value if calendar is not None else None,
        "terminated_on": getattr(outcome, "terminated_on", None),
        "next_report": (
            {
                "report_name": entry.report_name,
                "period_start": entry.period_start,
                "period_end": entry.period_end,
                "due_date": entry.due_date,
                # Verbatim, and in the same object as the date it qualifies.
                "condition": entry.condition,
            }
            if entry is not None
            else None
        ),
    }


def _payment_page_payload(page: PaymentPage) -> dict:
    """One block of payments, over HTTP.

    A detail envelope rather than a collection envelope, deliberately. ``state`` decides
    whether ``payments`` may be read at all -- an empty list is 3 different facts and only
    2 of them are about the record -- and a top-level ``data: []`` invites a client to
    render the list without reading the state, which is the missing-versus-zero failure
    ``.claude/rules/grounded-answers.md`` rule 12 forbids. So ``state`` is a sibling of
    ``payments`` and the paging keys keep the names and the place
    ``docs/architecture/backend-api-system-design.md`` (Pagination -- offset, deliberately)
    already gives them.

    ``asdict`` rather than a hand-written mapping per payment shape: the 3 shapes are the
    3 downloads' own columns, and a hand-written mapping is where a column quietly stops
    being served after the source gains one.
    """
    return {
        "state": page.state,
        "payments": [asdict(payment) for payment in page.payments],
        "page": {
            "limit": page.limit,
            "offset": page.offset,
            "has_more": page.has_more,
            # How many rows match in all, counted with the same filter as the rows, so
            # "Showing 250 of 1,284" is measured. ``None`` where no count is served: on
            # any page that is not ``reported``, and on the name-keyed lookups.
            "total_payments": page.total_payments,
        },
        "linkable_registration_numbers": sorted(page.linkable_registration_numbers),
        "dataset": page.dataset.value,
        "source_url": page.source_url,
        "release_id": str(page.release_id),
        "fetched_at": page.fetched_at,
    }


def _resolve_campaign_finance_release(db: Session):
    """The one release this request reads, pinned so nothing can shift under it.

    Raises the same 503 the aggregate route raises when nothing usable is published,
    because "we hold no release" is a fact about us and must never reach a page as a
    committee's or a donor's zero.
    """
    pin_campaign_finance_to_one_view(db)
    release = current_campaign_finance_release(db)
    if release is None:
        raise HTTPException(
            status_code=503,
            detail=(
                "no usable campaign-finance release is published; "
                "this says nothing about any committee or donor"
            ),
        )
    return release


def _refuse_a_committee_we_hold_no_record_of(
    db: Session, release, registration_number: str
) -> None:
    """404 a registration number we hold nothing about, rather than reporting its silence.

    "This committee reported no itemized payments" and "we have never seen this
    registration number" are different facts, and the payment reader cannot tell them
    apart: both come back as no rows, which it correctly calls ``not_reported``. Serving
    that for an unknown number invents a subject and then attributes silence to it, which
    is `.claude/rules/grounded-answers.md` rule 12's missing-versus-zero failure with the
    committee itself as the missing value. Found by an automated review (Greptile).

    Live case: ``30161`` circulates as "Alliance for a Better MN" and appears in no dataset
    of the current release (its real committees are 41360 and 80024), so a page asking for
    its payments would have printed "reported no payments received" about a committee we
    hold no record of.

    Resolved with ``find_committee`` and then our stored copy of the Board's
    registered-filer directory, the same pair the aggregate ``/finance`` route reads, so
    2 routes about one committee cannot disagree about whether it exists. A committee the
    register lists with no money rows anywhere answers ``not_reported`` rather than 404:
    it is a real committee whose silence is the record's. The 404 that remains is a
    statement about **our records** -- the number is in neither place we hold.

    A stale release deliberately does **not** 404. When the rows have been replaced out
    from under this release, ``find_committee`` cannot say whether we hold this committee,
    and denying its existence on the strength of our own pruning is the same failure one
    level up. The read that follows reports ``unavailable`` instead, which is a fact about
    us.
    """
    try:
        if find_committee(db, release, registration_number) is not None:
            return
    except ReleaseNoLongerHeld:
        return
    if register_entry(db, registration_number).state == "reported":
        return
    raise HTTPException(
        status_code=404,
        detail=(
            "this registration number is in neither the register we hold nor "
            "any dataset of the current campaign-finance release"
        ),
    )


@router.get(
    "/committees/{registration_number}/payments",
    response_model=DetailResponse,
)
def committee_payments(
    registration_number: str,
    direction: Literal["received", "made", "independent"],
    year: int | None = Query(default=None, ge=2015, le=2100),
    sort: Literal["date", "amount"] = Query(default="date"),
    limit: int = Query(default=50, ge=1, le=MAX_PAYMENTS),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    """The individual payments behind one committee's figures, one direction at a time.

    Keyed on Minnesota's registration number, which identifies a committee on its own, so
    nothing here waits on anyone confirming whose committee it is
    ([#1331](https://github.com/alethical-org/alethical/issues/1331)). The aggregate
    figures live on ``/committees/{registration_number}/finance``; **this route returns no
    total of any kind**, only rows with their own amounts, dates and labels.

    ``direction``:

    * ``received`` -- who paid this committee, from its own contributions filing. Every
      ``receipt_type`` is listed, including the loans and miscellaneous income that are
      real money reported on separate schedules. They must not be added to a contribution
      figure, which is why no figure is returned.
    * ``made`` -- who this committee paid, every ``expenditure_type`` included. A
      candidate committee files ``Campaign Expenditure`` and a party unit files
      ``General Expenditure`` for the same thing, so a caller filtering on one label would
      report a whole kind of filer as having spent nothing. Most rows name a vendor, which
      is a supplier; the ``Contribution``-typed rows name another committee instead.
    * ``independent`` -- what others spent for or against this committee. It passed
      through no filing of theirs.

    Read ``state`` before the rows: ``reported`` means the rows are real, ``not_reported``
    means we hold none and **is never a zero** (only donors passing $200 in aggregate for
    the year are named at all), and ``unavailable`` means our own copy is stale or the
    download does not reach the year asked for.

    ``sort=date`` (the default) pages newest first; ``sort=amount`` pages largest first.
    Largest-first is honest here and only here: ranking payments inside one committee is
    a fact about that committee, not a comparison between filers on different filing
    calendars (``docs/architecture/campaign-finance-system-design.md`` §7).
    ``page.total_payments`` counts every matching row with the same filter, so a capped
    list can say how much it is not showing.

    ``linkable_registration_numbers`` lists the counterparty numbers on this page that
    this release also holds as a filer. Only those may be rendered as links: 912 lobbyist
    numbers arrive on contribution rows and none of them is a committee.

    Omit ``year`` for every year the download holds, which is 2015 to 2026 today.

    404 means this registration number is in neither our copy of the Board's register nor
    any dataset of the current release, which is a statement about our records rather than
    about Minnesota's: without it an unknown number would come back as ``not_reported``,
    inventing a committee and then reporting its silence. 503 means we hold no usable
    release, also a fact about us.
    """
    release = _resolve_campaign_finance_release(db)
    _refuse_a_committee_we_hold_no_record_of(db, release, registration_number)
    reader_for = {
        "received": payments_received,
        "made": payments_made,
        "independent": independent_payments_about,
    }[direction]
    page = reader_for(
        db,
        release,
        registration_number=registration_number,
        year=year,
        limit=limit,
        offset=offset,
        order=ORDER_BY_AMOUNT if sort == "amount" else ORDER_BY_DATE,
    )
    return DetailResponse(
        data={
            "registration_number": registration_number,
            "direction": direction,
            "year": year,
            **_payment_page_payload(page),
        }
    )


@router.get("/campaign-finance/payments-under-name", response_model=DetailResponse)
def payments_under_one_printed_name(
    name: str = Query(min_length=1, max_length=200),
    role: Literal["contributor", "vendor", "independent_vendor", "employer"] = Query(),
    year: int | None = Query(default=None, ge=2015, le=2100),
    limit: int = Query(default=50, ge=1, le=MAX_PAYMENTS),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    """Every payment recorded under exactly one printed name.

    **The match is exact, character for character, and that is the design.** A person, an
    employer and a vendor carry no identifier in Minnesota's data, so the printed string
    is the whole of the key
    (``docs/architecture/campaign-finance-system-design.md`` §5). The live release holds
    "Messinger, Alida" (121 payments to 39 committees), "Messinger, Alida R" (10 to 6) and
    "Messinger, Alida Rockefelle" (4 to 1) as 3 separate strings. Joining them is a guess,
    and the same file holds "Messinger, William Frye" and "Messinger, Wiiiam Frey", which
    any rule loose enough to join the first three would join to each other.

    So a surface labels this result with the string it asked for, never with a person, and
    never says it is everything that person gave.

    ``role`` picks which column the name is matched against:

    * ``contributor`` -- who the money came from. Each row names the committee that
      received it, and those numbers are linkable because these are those committees' own
      filings.
    * ``vendor`` -- a supplier a committee paid, from the expenditures download.
    * ``independent_vendor`` -- a supplier paid out of independent spending, from the
      independent-expenditures download. **A separate request on purpose.** 491 rows there
      share a spender, vendor, amount and date with an expenditures row, and whether that
      is one payment filed twice or two payments that coincide is not established, so the
      2 lists are never combined.
    * ``employer`` -- payments whose donor typed this string in the employer box. It is
      free text holding statuses and occupations as much as employers: its 4 commonest
      values are "Not Employed", "Retired", "Self employed Retired" and "Lawyer". Never
      present it as a company's giving or as a count of its employees.

    ``state`` of ``not_reported`` means no row carries this exact string, which is a fact
    about the spelling and our records, never about a person's giving.
    """
    release = _resolve_campaign_finance_release(db)
    if role == "contributor":
        page = payments_from_contributor(
            db, release, contributor=name, year=year, limit=limit, offset=offset
        )
    elif role == "vendor":
        page = payments_to_vendor(
            db, release, vendor=name, year=year, limit=limit, offset=offset
        )
    elif role == "independent_vendor":
        page = independent_payments_to_vendor(
            db, release, vendor=name, year=year, limit=limit, offset=offset
        )
    else:
        page = payments_from_donors_typing(
            db, release, employer=name, year=year, limit=limit, offset=offset
        )
    return DetailResponse(
        data={
            "name": name,
            "role": role,
            "year": year,
            **_payment_page_payload(page),
        }
    )


@router.get("/campaign-finance/summary", response_model=DetailResponse)
def campaign_finance_summary(db: Session = Depends(get_db)):
    """What our campaign-finance records hold right now: 3 counted blocks and 2 dates.

    What the ``/money`` landing page opens with, and every figure in it is counted at read
    time rather than written into the page. A pasted count is how that page once said
    1,336 registered filers on a day the register held 1,603
    ([#1661](https://github.com/alethical-org/alethical/issues/1661)).

    **No amount of any kind is served here**, so no total summed across members or filers
    can reach a lane card (``.claude/rules/grounded-answers.md`` rule 12, and
    ``docs/architecture/campaign-finance-system-design.md`` §7, which forbids ranking
    members whose filing calendars differ).

    Three blocks, each with its own ``state``, deliberately rather than one state for the
    response. They come from 3 independent places -- the Board's register, our own
    confirmation log, and the bulk downloads -- and one missing piece must not blank the
    other 2 lanes, which is the same per-block rule
    ``/committees/{registration_number}/finance`` follows.

    * ``register`` -- how many filers Minnesota's register holds, and how many of each of
      its 3 kinds, so the committees lane and its filters label themselves from the data.
    * ``legislator_committee_confirmations`` -- how many sitting members have a committee
      a person has confirmed is theirs, out of how many are sitting. **The only figure on
      the product that speaks about the whole set**; every per-member surface speaks about
      that member alone. ``newest_confirmation_at`` dates it and is ``null`` while nobody
      has confirmed anything, which is today.
    * ``freshness`` -- ``downloads_fetched_at`` is the landing's "files last copied" date
      (#861), and ``register_fetched_at`` is when the register and report catalogue were
      copied. Two sources, copied on the same day today, so both are named rather than one
      standing in for both. Neither is the period any money covers: every period ends
      earlier.

    **A count we could not compute is ``null``, never 0**, and the block's ``reason`` says
    which of our gaps it was: ``no_filings_snapshot`` (we have loaded no register at all),
    ``rows_replaced`` (the register we resolved has been replaced under this read), or
    ``no_current_legislative_session``. A **0 confirmed** is served as ``0``, because the
    confirmation log is ours and its emptiness is a fact we know rather than a gap.

    No 503: unlike the committee routes, a missing download release only empties the
    freshness dates here, and an explicit ``null`` beside a ``reason`` cannot be read as a
    zero.
    """
    pin_campaign_finance_to_one_view(db)
    try:
        release = current_campaign_finance_release(db)
    except ReleaseNoLongerHeld:
        # The published release names a pruned snapshot. That is a fact about our copy of
        # the downloads and says nothing about the register, which is a different run, so
        # the other 2 blocks still answer.
        release = None
    summary = register_summary(db)
    confirmations = legislator_committee_confirmations(db)
    dates = freshness(db, release)
    return DetailResponse(
        data={
            "register": {
                "state": summary.state,
                "filer_count": summary.filer_count,
                "by_kind": summary.by_kind,
                "as_of": summary.as_of,
                "snapshot_id": (
                    str(summary.snapshot_id) if summary.snapshot_id else None
                ),
                "reason": summary.reason,
            },
            "legislator_committee_confirmations": {
                "state": confirmations.state,
                "confirmed_member_count": confirmations.confirmed_member_count,
                "sitting_member_count": confirmations.sitting_member_count,
                "newest_confirmation_at": confirmations.newest_confirmation_at,
                "reason": confirmations.reason,
            },
            "freshness": {
                "downloads_fetched_at": dates.downloads_fetched_at,
                "register_fetched_at": dates.register_fetched_at,
                "release_id": str(dates.release_id) if dates.release_id else None,
            },
        }
    )


@router.get("/campaign-finance/filings", response_model=DetailResponse)
def campaign_finance_filings(
    limit: int = Query(default=10, ge=1, le=MAX_FILINGS),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    """The filed reports we hold with the latest periods, newest period end first.

    The honest form of a "what's new" list: whose committee filed, which report, and the
    period it covers. **No row carries an amount and no parameter sorts by one** -- 5 rows
    with 5 dollar figures is a ranking whether anyone sorted it or not, and these rows are
    the reason it would mislead: 2 periods can end 20 Jul 2026 while 2 more end 31 Dec
    2025, nearly 7 months earlier.

    **``ordered_by`` is served because the order is not the one the design asked for.**
    The Board's report catalogue serves 17 fields per report and none of them is the date
    a report was filed (``docs/architecture/campaign-finance-system-design.md`` §9.6); the
    "Received by the Board" date is printed inside the report document, which is served
    only from 2023 and answers a failure with HTTP 200 and an HTML page. So this is
    ordered by ``period_end``, the period end the catalogue does serve, and **no filing
    date field exists here at all** -- a period end relabelled as a filing date would be a
    fabricated fact about a named committee. Storing a real one is
    [#1670](https://github.com/alethical-org/alethical/issues/1670), and until it lands no
    surface may print "filed on" beside these rows.

    **Only reports somebody actually filed.** The catalogue is a schedule: it lists a
    report from the moment its filing period opens, filed or not, and 7 of the 1,261
    catalogued 2026 pre-primary reports were unfiled when the filing-calendars module
    measured them. An unfiled report carries no amendment record while every filed one
    carries at least ``['0']`` (§9.6), so rows with no amendment record are excluded.
    That also drops genuinely filed reports from 2002 to 2007, whose amendment record the
    catalogue does not serve, which is the safe direction on a list of the newest filings.

    **Only periods that have ended.** A terminating committee files its final report at
    termination rather than waiting for the period to close, so on 19 Aug 2026 the 5
    newest rows were 2026 year-end reports covering "1 Jan - 31 Dec 2026" -- 7 such rows
    against 1,261 catalogued 2026 pre-primary reports. Real filings, and a top row
    covering 4 months of the future reads as an error or as a claim about money nobody has
    raised. With no filing date, "newest" can only mean the latest period, and an
    unfinished period outranks every finished one, so the cutoff is served as
    ``periods_ended_on_or_before``.

    ``period_start`` is ``null`` on many rows and that is a designed state, not a gap: the
    row then reads "covers through {period_end}". §7 forbids hardcoding 1 January, so a
    start is only served when one of the Board's own transcribed disclosure calendars
    prints it against that period end (``period_start_source: "board_calendar"``), and
    never for a filer with a special-election report that year -- filer 19223's 2025
    period opens 11 July, not 1 January (§9.5).

    ``state`` decides whether ``filings`` may be read: ``reported`` means the rows are
    real, and ``unavailable`` with a ``reason`` means we hold no register at all
    (``no_filings_snapshot``) or the snapshot we resolved has been replaced under this read
    (``rows_replaced``). An empty list is never a claim that nobody has filed.

    **Two counts, and they are not interchangeable.** ``page.total`` counts the whole
    set the rows page through -- every filed report whose period has ended, 33,612 on
    production -- so it is true of the list and says nothing about any one period.
    ``newest_period`` carries the newest period end **and** the number of filings
    covering it, served as one block because a count of filings is meaningless without
    the period it counts them for (``.claude/rules/grounded-answers.md`` rule 12: every
    total states the period it covers). Measured on production 20 Aug 2026: 1,203
    filings carry the newest period end of 20 Jul 2026, against ``page.total``'s
    33,612. **Only ``newest_period.filing_count`` may appear in a sentence about "this
    period"**; ``page.total`` there would overstate one period 28-fold on a public
    page.
    """
    pin_campaign_finance_to_one_view(db)
    page = recent_filings(db, limit=limit, offset=offset)
    return DetailResponse(
        data={
            "state": page.state,
            "ordered_by": page.ordered_by,
            "periods_ended_on_or_before": page.periods_ended_on_or_before,
            "filings": [
                {
                    "registration_number": row.registration_number,
                    "filer_name": row.filer_name,
                    "filer_kind": row.filer_kind,
                    "report_name": row.report_name,
                    "report_type": row.report_type,
                    "filing_year": row.filing_year,
                    "period_end": row.period_end,
                    "period_start": row.period_start,
                    "period_start_source": row.period_start_source,
                    "special_election": row.special_election,
                    "amendment_count": row.amendment_count,
                    "effective_amendment_index": row.effective_amendment_index,
                }
                for row in page.filings
            ],
            "page": {
                "limit": page.limit,
                "offset": page.offset,
                "has_more": page.has_more,
                # Counted over the identical filter the rows came from, so it describes
                # exactly the list under it (#1677): every filed report whose period has
                # ended, 33,612 on production. Without it, 5 rows beginning "100 Percent
                # Future Fund" read as a shortlist of the newest or the biggest. `null`
                # whenever the rows are unavailable, never 0.
                #
                # NOT the landing's "N committees filed for this period" number, which is
                # `newest_period.filing_count` below. An earlier version of this comment
                # said it was, and it was wrong by 28-fold: 1,203 filings carry the newest
                # period end against this figure's 33,612.
                "total": page.total,
            },
            # The newest period and its filing count, served as one block because a count
            # of filings is meaningless without the period it counts them for
            # (`.claude/rules/grounded-answers.md` rule 12: every total states the period
            # it covers). Pairing them is the guard -- a bare count is what gets printed
            # beside the wrong period.
            "newest_period": {
                "period_end": page.newest_period_end,
                "filing_count": page.newest_period_filing_count,
            },
            "as_of": page.as_of,
            "snapshot_id": str(page.snapshot_id) if page.snapshot_id else None,
            "reason": page.reason,
        }
    )


@router.get("/campaign-finance/committees", response_model=DetailResponse)
def campaign_finance_committees(
    kind: Literal["candidate_committee", "party_unit", "political_committee_or_fund"]
    | None = Query(default=None),
    q: str | None = Query(default=None, min_length=1, max_length=200),
    limit: int = Query(default=25, ge=1, le=MAX_COMMITTEES),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    """Everyone registered to raise or spend money in Minnesota state politics.

    The whole register, ordered by the name as filed, A to Z. **No row carries an amount
    and no parameter sorts by one, ever.** These filers file to different calendars, so 2
    dollar figures side by side would set one period against another rather than compare
    money (``.claude/rules/grounded-answers.md`` rule 12, and
    ``docs/architecture/campaign-finance-system-design.md`` §7). Money lives on each
    committee's own page, where the period it belongs to is stated.

    **``kind`` offers 3 values because the register holds 3, and that is the Board's own
    shape rather than something our loader threw away.** The directory is 3 separate
    lists, and independent-expenditure committees, ballot-question committees and
    political funds all arrive on one of them carrying no type marker at all (§9.7). The
    finer kind exists only on the money rows, so a caller must not offer a finer filter
    here ([#1661](https://github.com/alethical-org/alethical/issues/1661)).

    **``sub_type`` is that finer kind, as the Board's own code and never as a label.**
    It is what makes a ballot-question committee knowable at all, and it is served
    because the committee page already reads it: without it the same filer would read
    "Political committee or fund" on this list and "Ballot question committee" on its own
    page, and a reader who noticed would trust neither. The label is derived in exactly
    one place -- ``committeeEyebrow`` in ``apps/frontend/src/lib/committeeMoney.ts``,
    which the committee page ships -- so the 2 surfaces cannot diverge. 6 codes are
    documented (``PC``, ``PF``, ``IEC``, ``IEF``, ``BC``, ``BF``) and only those are
    served; ``PCN``, ``PFN`` and ``BCN`` are documented nowhere by the Board or by us, so
    they arrive as ``null`` rather than as a code somebody might expand. ``null`` is also
    the answer for the 33 registered filers with no money row at all, and a caller shows
    the register's kind for every one of them.

    Read from the download release rather than the register, which is a **second copy of
    Minnesota's data behind one response**, so ``release_id`` names it beside the
    register's ``snapshot_id``. No release held means every ``sub_type`` is ``null`` and
    nothing else changes.

    **``office`` and ``district`` are ``null`` on most rows, and that is the register, not
    a gap.** A candidate row carries office, district and party; a party-unit row and a
    committee-or-fund row carry a name, a number and 2 dates. Measured on the live
    register: 778 of 1,603 rows carry an office and **0 party units carry one**. A party
    unit's geography is legible only inside its printed name, and #1661 rules that
    reading it out of the name is a mapping a person confirms rather than a column we
    hold -- so nothing here derives one, and a row's meta line is the kind alone.

    **Two totals, deliberately.** ``page.total`` counts the filter the rows came from, so
    "showing 8 of 778 candidate committees" is true of the list on screen.
    ``register_total`` counts the whole register, so the lane card can say 1,603 whatever
    filter is applied. ``by_kind`` is unfiltered for the same reason: the 3 filter chips
    label themselves from it, and counts that moved when a filter was applied would read
    as the filter having found fewer of a kind than exist.

    ``q`` is the screen's "find a committee by name" box: case-insensitive containment of
    exactly what was typed, and **no closest-spelling suggestion of any kind**. 178
    registered names sit a single character apart from another registered name and every
    one of those pairs is a different organisation, so a correction would quietly swap
    one for another (``campaign_finance_register.name_contains``).

    ``state`` decides whether ``committees`` may be read: ``unavailable`` with a
    ``reason`` means we hold no register (``no_filings_snapshot``) or the snapshot we
    resolved has been replaced under this read (``rows_replaced``). An empty list is
    never a claim that Minnesota registers nobody.
    """
    pin_campaign_finance_to_one_view(db)
    try:
        release = current_campaign_finance_release(db)
    except ReleaseNoLongerHeld:
        # The published release names a pruned snapshot. That is a fact about our copy of
        # the downloads, and the register is a different run, so the list still answers
        # in full -- only the sub-type codes, which are read from the downloads, go
        # absent. No 503: refusing the whole register over a missing label would report a
        # gap in one source as an absence in the other.
        release = None
    page = register_committees(
        db, limit=limit, offset=offset, kind=kind, query=q, release=release
    )
    return DetailResponse(
        data={
            "state": page.state,
            "ordered_by": page.ordered_by,
            "kind": kind,
            "q": q,
            "committees": [_committee_payload(row) for row in page.committees],
            "page": {
                "limit": page.limit,
                "offset": page.offset,
                "has_more": page.has_more,
                "total": page.total,
            },
            "register_total": page.register_total,
            "by_kind": page.by_kind,
            "as_of": page.as_of,
            "snapshot_id": str(page.snapshot_id) if page.snapshot_id else None,
            "release_id": str(page.release_id) if page.release_id else None,
            "reason": page.reason,
        }
    )


@router.get("/campaign-finance/search", response_model=DetailResponse)
def campaign_finance_search(
    q: str = Query(min_length=1, max_length=200),
    limit: int = Query(default=5, ge=1, le=MAX_PER_GROUP),
    db: Session = Depends(get_db),
):
    """One typed name, matched across 4 kinds of record and grouped by what each one is.

    **Exactly what was typed, and no did-you-mean anywhere.** Case-insensitive
    containment, no closest spelling, no similarity, no suggestion. Not caution: 178
    registered filer names sit a single character apart from another registered name, and
    every one of those pairs is a different organisation -- the Green Party and the
    Republican Party of the same district among them (#1661). A correction on this data
    does not fix a typo, it hands a reader one organisation's money under another's name
    with nothing on screen to reveal it.

    Five groups, always all 5, always in this order, even when empty -- so a caller can
    never read a missing group as "no matches" when it meant "we did not look":

    * ``people`` -- **the 200 sitting legislators, and only them.** A person is a result
      only where we hold a record of them beyond these filings. Everybody else on a
      filing resolves to what they filed, because a page about a donor would be a page
      about a *spelling* that still reads as a page about a human being (§5).
    * ``committees`` -- the register. The one group whose rows carry an identifier that
      survives a name change, so these are the rows that open a page.
    * ``gave`` -- distinct names in the contributions download. A private donor's name is
      searchable and is deliberately not a profile.
    * ``got_paid`` and ``got_paid_independent`` -- distinct vendor names, from the
      expenditures download and the independent-expenditures download. **Two groups on
      purpose, and a caller must never add their counts.** They are 2 separate filings,
      and 491 rows of the independent file share a spender, vendor, amount and date with
      an expenditures row; whether that is one payment filed twice or two that coincide
      is not established.

    A name row carries the ``role`` that ``/campaign-finance/payments-under-name`` takes,
    verbatim, so a caller opens that name's payments without translating anything.
    ``payment_count`` counts records in one download and is never an amount.

    **The employer column is not searched and has no group.** It is free text a donor
    filled in, and its 4 commonest values are "Not Employed" (67,342 rows), "Retired"
    (36,517), "Self employed Retired" and "Lawyer" -- a result row for "retired" would
    present a status as something to open.

    ``total`` on the 3 name groups is exact up to ``counted_up_to`` distinct names and
    ``null`` past it, with ``at_least`` saying how far the count got. A broad query
    genuinely matches thousands, and a capped number printed as a total is a fabricated
    fact in the largest type on the page (rule 11). A ``total`` of 0 is different: we
    searched and nothing carried that string, which is a fact about the spelling and our
    records rather than about anybody's giving.

    Below ``min_query_length`` characters the answer is ``unavailable`` with
    ``query_too_short`` and every group empty. A served state rather than an error, so
    the page says "type at least 3 characters" instead of "nothing found", which would be
    a false claim about the records. The floor is the index's: a trigram index holds no
    whole trigram for a 2-character query, so it would fall back to reading all 583,152
    contribution rows
    ([#1486](https://github.com/alethical-org/alethical/issues/1486)).

    No 503 when nothing is published: the 3 name groups go ``unavailable`` with
    ``no_release`` while the register and the legislators still answer, because one
    missing copy of the data must not blank the groups that do not depend on it.
    """
    pin_campaign_finance_to_one_view(db)
    try:
        release = current_campaign_finance_release(db)
    except ReleaseNoLongerHeld:
        # The published release names a pruned snapshot. A fact about our copy of the
        # downloads that says nothing about the register, which is a separate run, so the
        # other 2 groups still answer.
        release = None
    answer = search_campaign_finance_names(db, release, query=q, limit=limit)
    return DetailResponse(
        data={
            "state": answer.state,
            "q": answer.query,
            "matched_on": answer.matched_on,
            "min_query_length": answer.min_query_length,
            "counted_up_to": answer.counted_up_to,
            "groups": [
                {
                    "kind": group.kind,
                    "state": group.state,
                    "results": [_search_result_payload(row) for row in group.results],
                    "total": group.total,
                    "at_least": group.at_least,
                    "has_more": group.has_more,
                    "reason": group.reason,
                }
                for group in answer.groups
            ],
            "as_of": answer.as_of,
            "snapshot_id": str(answer.snapshot_id) if answer.snapshot_id else None,
            "release_id": str(answer.release_id) if answer.release_id else None,
            "reason": answer.reason,
        }
    )


def _committee_payload(row: CommitteeRow) -> dict:
    """One register row. ``is_closed`` ships beside its date, never instead of it.

    ``sub_type`` is the Board's own code and deliberately not a label, so the wording a
    reader sees stays owned in one place and this list cannot label a filer differently
    from its own committee page -- the same field, spelled the same way, that
    ``/committees/{registration_number}/finance`` already serves as ``entity_sub_type``.
    """
    return {
        "registration_number": row.registration_number,
        "name": row.name,
        "kind": row.kind,
        "sub_type": row.sub_type,
        "office": row.office,
        "district": row.district,
        "is_closed": row.is_closed,
        "termination_date": row.termination_date,
    }


def _search_result_payload(row) -> dict:
    """Serialise whichever of the 3 result shapes a group holds.

    Each carries its own ``kind`` so a caller reads the row rather than inferring its
    shape from the group it arrived in -- which is what would break the day a group holds
    more than one shape.
    """
    if isinstance(row, PersonResult):
        return {
            "kind": "person",
            "id": row.id,
            "slug": row.slug,
            "full_name": row.full_name,
            "chamber": row.chamber,
            "district_code": row.district_code,
            "party": row.party,
        }
    if isinstance(row, PaymentNameResult):
        return {
            "kind": "payment_name",
            "name": row.name,
            "role": row.role,
            "payment_count": row.payment_count,
        }
    payload = _committee_payload(row)
    # 2 different meanings of "kind" meet here: what this result *is*, and which of the
    # register's 3 kinds the committee is. The register's moves aside to `filer_kind`,
    # because a caller reading `kind` to decide how to draw a row would otherwise get
    # "candidate_committee" where every other group hands it a shape name.
    return {"kind": "committee", "filer_kind": payload.pop("kind"), **payload}


@router.get(
    "/legislators/{legislator_id}/campaign-finance",
    response_model=DetailResponse,
)
def legislator_campaign_finance(
    legislator_id: str,
    year: int = Query(ge=2015, le=2100),
    db: Session = Depends(get_db),
):
    """One legislator's own campaign money for one year, per committee.

    Money others spent about them is a separate question with a separate answer, and
    it lives on ``/legislators/{legislator_id}/independent-spending``. The two are
    drawn together on the profile and are kept apart here because a committee's own
    receipts and a third party's spending are different records that must never be
    added (``docs/architecture/campaign-finance-system-design.md`` §3).

    **Read ``link_state`` before reading ``committees``, always.** An empty
    ``committees`` list is not a statement about this person:

    * ``unconfirmed`` -- nobody has yet checked which registered committee is theirs.
      Minnesota publishes no link between a committee and a human, so a person
      confirms each one by hand (§5, Identity). On the day this shipped every sitting
      member was in this state, so it is the ordinary state rather than an edge case.
    * ``reviewed_none_confirmed`` -- someone read this member's candidate committees
      and confirmed none of them. Kept apart from the above because "we looked" and
      "nobody has looked" are different facts, but **a reader-facing surface words the
      two the same way**: all 200 sitting members do appear in the Board's
      registered-filer directory, so on a sitting member's profile this means their
      committee exists and we failed to surface it, never that none is registered
      (§7).
    * ``confirmed`` -- at least one committee is confirmed as theirs. A committee whose
      reviewed period does not cover ``year`` is still correctly absent from
      ``committees``, which is how a race for an office they no longer hold stays off
      the page.

    Every committee carries a ``split``: how much of the year's money reached this
    committee with a donor's name attached and how much did not. **Read
    ``split.state`` before its numbers**, because the split is derived and is withheld
    whenever the derivation cannot be honest:

    * ``shown`` -- ``unnamed_total`` is real. It is the committee's own reported total
      minus the named **cash** payments we hold, and it is usually large: Minnesota
      names a donor only once their giving passes $200 in aggregate within a calendar
      year, so roughly 4 dollars in 10 have no name on a typical filing. Cash only,
      because the Board's reported contributions figure excludes donated goods and
      services while our itemized rows include them; ``named_in_kind_total`` carries
      that difference so it is neither added in nor silently dropped.
    * ``no_reported_total`` -- no official total this page may print for this year, so
      there is no whole to divide. The named payments stand alone, labelled as named
      payments.
    * ``periods_differ`` -- the reported total and our named payments cover different
      periods, so their difference is not a fact about donors. Measured on the live
      release, 36 of 835 committee-years for 2026.
    * ``sources_disagree`` -- Minnesota's own report and Minnesota's own spreadsheet
      contradict each other for this committee-year, on the evidence of the one check
      that compares them. Both figures are shown and neither is subtracted from the
      other, and no wording may say which of the two is the larger: 33 of the 76
      disagreeing committee-years run one way and 43 the other. 62 committee-years on
      the live release, measured 19 Aug 2026.
    * ``no_named_payments`` -- the filing reports money and we hold no named payment
      of it, and nobody has read the filing to find out whether it named any. Never
      rendered as "this money had no names", which is the claim it would silently
      become. 468 committee-years.
    * ``named_payments_not_in_our_copy`` -- the committee's own filed report names
      donors and our copy of the download carries no row at all for this committee-year,
      so the emptiness is provably on our side. A different fact from
      ``no_named_payments``, and it may never be explained by the filing calendar: the
      report was filed and the money is public. 14 committee-years
      ([#1682](https://github.com/alethical-org/alethical/issues/1682)).
    * ``reported_total_predates_a_correction`` -- the subtraction refuses to run and the
      Board's report catalogue records that the committee refiled this year's report, so
      the official total we hold is the superseded version's. Our refresh gap, not a
      contradiction in Minnesota's records. 1 committee-year
      ([#1648](https://github.com/alethical-org/alethical/issues/1648)).
    * ``figures_do_not_line_up`` -- the subtraction refuses to run and nothing we hold
      says why. Weaker than ``sources_disagree`` on purpose: it establishes that these 2
      numbers cannot be subtracted and nothing about whether the 2 publications
      disagree. 0 committee-years today.

    Each committee also carries ``filing_schedule`` and ``report_corrections``, the same
    2 blocks the committee route serves and documented there. They key on the
    registration number, so both are correct before anyone confirms whose committee it
    is, and they are what lets an empty year be explained in this committee's own terms
    instead of by one fixed sentence about Minnesota's calendar
    ([#1642](https://github.com/alethical-org/alethical/issues/1642)).

    **``filing_schedule`` and ``money_in.state`` answer different questions and may
    disagree, which is the point of keeping them apart.** Kristin Robbins's governor
    committee filed its 2025 report on time naming $553,925.86, and our copy of the
    donation list holds no row of it: the schedule is in order and the money block is
    empty, and a single field would have to be false about one of them.

    ``committees`` carries only committees for a **legislative** office. A member may
    have confirmed committees for a run at something else, and §7 forbids that race's
    money appearing under their legislative profile; ``other_office_committees`` counts
    them so a page can say they exist without reporting a dollar of them. A committee
    whose reviewed office is blank is kept, because absence is not evidence of another
    race and hiding real money on a blank field is the worse error.

    ``stated_split_state`` says whether the committee's own filed report was checked
    against our rows for this year. ``agrees`` means the two match and a page may say
    the split is verified against the filing itself; ``not_checked`` means the
    comparison has not been made, which is a fact about us and never a verdict about the
    committee. A page shows the figures either way and must not let the second read as
    the first. ``disagrees`` never reaches a page as a split at all: it becomes
    ``sources_disagree`` above, or ``named_payments_not_in_our_copy`` where we hold no
    row for the year to have disagreed with anything.

    ``first_payment_on`` and ``last_payment_on`` describe the payments we hold and are
    **not** a coverage period. No surface may turn them into one, or assume a period
    starts on 1 January: filer 19223 reports from 11 July 2025 (§9.5).

    503 means we hold no usable release at all, which is a fact about us and never a
    figure about a named person.
    """
    # First statement in the transaction, exactly as the committee route does: this
    # request reads 3 datasets plus the filings snapshot, and 2 publishes landing
    # between its statements would otherwise take the named release's rows away
    # halfway through.
    pin_campaign_finance_to_one_view(db)
    legislator = get_legislator_by_id(db, legislator_id)
    unusable = HTTPException(
        status_code=503,
        detail=(
            "no usable campaign-finance release is published; "
            "this says nothing about any legislator"
        ),
    )
    try:
        release = current_campaign_finance_release(db)
        if release is None:
            raise unusable
        finance = legislator_finance(
            db, release, legislator_id=legislator.id, year=year
        )
    except ReleaseNoLongerHeld:
        raise unusable from None
    return DetailResponse(
        data={
            "legislator_id": str(legislator.id),
            "year": finance.year,
            "link_state": finance.link_state,
            # Confirmed committees this page leaves out because they are for a race
            # other than a legislative seat. Served rather than dropped in silence: a
            # reader who knows their member ran for Attorney General should be told the
            # money exists and is not this, instead of concluding we missed it.
            "other_office_committees": finance.other_office_committees,
            "release_id": str(release.id),
            "fetched_at": release.fetched_at,
            "committees": [
                {
                    "registration_number": entry.registration_number,
                    # What the reviewer read when they confirmed the link, and what the
                    # release names the same number today. They can legitimately
                    # differ: the Board publishes a committee's *current* name against
                    # all of its history, so a rename is a thing to notice rather than
                    # a contradiction (§5.1).
                    "committee_name_as_reviewed": entry.committee_name_as_reviewed,
                    "committee_name": (
                        entry.finance.committee.name if entry.finance else None
                    ),
                    "office": entry.office_as_reviewed,
                    # The same 2 blocks the committee route serves, per committee, so a
                    # profile can say why a year is empty in the committee's own terms
                    # rather than printing one sentence about Minnesota in general
                    # ([#1642](https://github.com/alethical-org/alethical/issues/1642)).
                    # Both key on the registration number, so neither waits on anyone
                    # confirming whose committee it is.
                    "filing_schedule": _filing_schedule_payload(
                        filing_schedule(db, entry.registration_number, year=year)
                    ),
                    "report_corrections": report_corrections(
                        db, entry.registration_number, year
                    ),
                    "money_in": (
                        {
                            "state": entry.finance.money_in.state,
                            "itemized_contribution_total": (
                                entry.finance.money_in.itemized_contribution_total
                            ),
                            "itemized_contribution_payments": (
                                entry.finance.money_in.itemized_contribution_payments
                            ),
                            "other_receipts": [
                                {
                                    "receipt_type": receipt.receipt_type,
                                    "total": receipt.total,
                                    "payments": receipt.payments,
                                }
                                for receipt in entry.finance.money_in.other_receipts
                            ],
                            "source_url": entry.finance.money_in.source_url,
                        }
                        if entry.finance
                        else None
                    ),
                    "money_out": (
                        {
                            "state": entry.finance.money_out.state,
                            "itemized_payment_total": (
                                entry.finance.money_out.itemized_payment_total
                            ),
                            "itemized_payments": (
                                entry.finance.money_out.itemized_payments
                            ),
                            "by_type": [
                                {
                                    "type": bucket.expenditure_type,
                                    "total": bucket.total,
                                    "payments": bucket.payments,
                                }
                                for bucket in entry.finance.money_out.by_type
                            ],
                            "source_url": entry.finance.money_out.source_url,
                        }
                        if entry.finance
                        else None
                    ),
                    "split": {
                        "state": entry.split.state,
                        "reported_total": entry.split.reported_total,
                        "reported_through": entry.split.reported_through,
                        "named_total": entry.split.named_total,
                        "named_payments": entry.split.named_payments,
                        "named_cash_total": entry.split.named_cash_total,
                        "named_in_kind_total": entry.split.named_in_kind_total,
                        "unnamed_total": entry.split.unnamed_total,
                        "stated_split_state": entry.split.stated_split_state,
                        "first_payment_on": entry.split.first_payment_on,
                        "last_payment_on": entry.split.last_payment_on,
                    },
                }
                for entry in finance.committees
            ],
        }
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


@router.post("/address-suggestions", response_model=DetailResponse)
def address_suggestions(
    request: AddressSuggestionRequest,
    lookup_service: RepresentativeLookupService = Depends(
        get_representative_lookup_service
    ),
    _rate_limited: None = Depends(
        rate_limit("address_suggestion_limiter", "address-suggestion")
    ),
):
    try:
        suggestions = lookup_service.suggest_addresses(request.address_text)
    except (RepresentativeLookupUpstreamError, requests.RequestException) as exc:
        raise problem_exception(
            502,
            "Bad Gateway",
            f"Address suggestions upstream failed: {exc}",
            type_slug="address-suggestions-upstream-error",
        ) from None

    return DetailResponse(
        data={
            "suggestions": [
                {
                    "matched_address": suggestion.matched_address,
                    "latitude": suggestion.latitude,
                    "longitude": suggestion.longitude,
                    "state_code": suggestion.state_code,
                }
                for suggestion in suggestions
            ]
        }
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
    except RepresentativeLookupChoices as exc:
        return DetailResponse(
            data={
                "status": "address-choice",
                "resolved_place": {
                    "input_mode": "address",
                    "address_text": request.address_text,
                },
                "address_choices": [
                    {
                        "matched_address": choice.matched_address,
                        "latitude": choice.latitude,
                        "longitude": choice.longitude,
                        "state_code": choice.state_code,
                    }
                    for choice in exc.choices
                ],
            }
        )
    except RepresentativeLookupOutsideMinnesota as exc:
        raise problem_exception(
            422,
            "Outside Minnesota",
            str(exc),
            type_slug="representative-lookup-outside-minnesota",
        ) from None
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
    legislator_ids = [
        period.legislator.id
        for period in (house_period, senate_period)
        if period is not None
    ]
    committee_assignments = current_committee_assignments(db, legislator_ids)
    issue_areas = authored_issue_areas(db, legislator_ids)
    source_updated_at = representative_source_updated_at(db, legislator_ids)
    geocoded = lookup_result.geocoded_address
    payload = {
        "status": "found",
        "session": {
            "slug": current_session.slug,
            "name": current_session.name,
            "is_current": current_session.is_current,
            "session_number": current_session.session_number,
            "year_start": current_session.year_start,
            "year_end": current_session.year_end,
        },
        "source_updated_at": source_updated_at,
        "resolved_place": {
            "input_mode": input_mode,
            "address_text": request.address_text,
            "matched_address": geocoded.matched_address,
            "latitude": geocoded.latitude,
            "longitude": geocoded.longitude,
            "state_code": geocoded.state_code,
            "house_district": house_district.code if house_district else None,
            "senate_district": senate_district.code if senate_district else None,
            "other_house_district": (
                f"{lookup_result.senate_district.district_code}{'B' if lookup_result.house_district and lookup_result.house_district.district_code.endswith('A') else 'A'}"
                if lookup_result.senate_district and lookup_result.house_district
                else None
            ),
            "congressional_district": lookup_result.congressional_district,
            "house_geometry": lookup_result.house_district.geometry
            if lookup_result.house_district
            else None,
            "senate_geometry": lookup_result.senate_district.geometry
            if lookup_result.senate_district
            else None,
        },
        "house_legislator": legislator_list_item(
            house_period.legislator,
            total_bill_count=rep_counts.get(str(house_period.legislator.id), (0, 0))[0],
            chief_bill_count=rep_counts.get(str(house_period.legislator.id), (0, 0))[1],
            committee_assignments=committee_assignments.get(
                str(house_period.legislator.id), []
            ),
            current_service=house_period,
            election_history=house_period.legislator.election_history,
            issue_areas=issue_areas.get(str(house_period.legislator.id)),
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
            committee_assignments=committee_assignments.get(
                str(senate_period.legislator.id), []
            ),
            current_service=senate_period,
            election_history=senate_period.legislator.election_history,
            issue_areas=issue_areas.get(str(senate_period.legislator.id)),
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
            keyword_clause = keyword_search_clause(BILL_SEARCH_COLUMNS, q)
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
