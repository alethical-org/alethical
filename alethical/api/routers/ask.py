from __future__ import annotations

from dataclasses import dataclass
import hashlib
import os
import re

from fastapi import APIRouter, Depends
from sqlalchemy import String, and_, cast, func, or_, select, text
from sqlalchemy.orm import Session

from alethical.api.auth import get_optional_current_user
from alethical.api.problems import problem_exception
from alethical.api.routers.me import (
    BillTextCoverage,
    DEFAULT_RAG_CHAT_MODEL,
    build_query_embedding,
    rag_chat_prompt_fingerprint,
    synthesize_grounded_answer,
)
from alethical.api.schemas import (
    AskAnswerPayload,
    AskBillTextAnswer,
    AskCitation,
    AskClassificationPayload,
    AskClassifyRequest,
    AskLegislatorBillRef,
    AskLegislatorRow,
    AskPassageCoverage,
    AskSessionRef,
    AskTopicBillsAnswer,
    AskTopicLegislatorsAnswer,
    AskVoteDeflectionAnswer,
    DetailResponse,
)
from alethical.api.rate_limit import rate_limit
from alethical.api.serializers import (
    bill_list_item,
    current_bill_summary_enrichment,
    section_chip_topic,
)
from alethical.api.services.legislative_sessions import (
    LegislatureScope,
    current_legislature_scope,
    named_special_session_in_question,
)
from alethical.api.services.ask_router import (
    AskIntent,
    classify_query,
    pick_bill_from_candidates,
)
from alethical.db.schema import load_schema
from alethical.db.session import get_db
from alethical.pipeline.rag_ingest import DEFAULT_RAG_MODEL, effective_embedding_model

schema = load_schema()
Bill = schema.Bill
BillVersion = schema.BillVersion
BillVersionSection = schema.BillVersionSection
RagChunk = schema.RagChunk
RagSectionDocument = schema.RagSectionDocument
AIEnrichment = schema.AIEnrichment
AskSuggestedAnswerCache = schema.AskSuggestedAnswerCache
SourceArtifact = schema.SourceArtifact
Chamber = schema.Chamber
District = schema.District
EnrichmentType = schema.EnrichmentType
IngestionRun = schema.IngestionRun
IngestionStatus = schema.IngestionStatus
LegislativeSession = schema.LegislativeSession
Legislator = schema.Legislator
LegislatorServicePeriod = schema.LegislatorServicePeriod
Sponsorship = schema.Sponsorship
SponsorshipRole = schema.SponsorshipRole
bill_list_stmt = schema.bill_list_stmt
retrievable_chunk_count_stmt = schema.retrievable_chunk_count_stmt
semantic_rag_chunk_stmt = schema.semantic_rag_chunk_stmt

router = APIRouter()

# Both Ask endpoints can make a paid model call, so they share one budget (#98).
# Exact public suggestions skip classification and reuse a saved answer, but their
# first request still writes one and must remain inside the same abuse limit.
_ask_rate_limit = rate_limit("ask_limiter", "ask")

# Display order per docs/product-onboarding/grounded-ask-spec.md §4.2 (topic_bills formatter):
# legislative progress first, then most recent action (tie-broken in
# _progress_sort_key so a shared ?q= link re-renders identically). The stage rank
# is the precomputed ``Bill.status_rank`` column (``_STATUS_KEY_RANK``), so this
# ordering, the sort=progress ordering, and the badge all agree.

# Cap the rendered list; overflow routes to Search pre-filtered to the topic.
_DISPLAY_LIMIT = 6

# ILIKE on one or two characters matches almost everything; below this the
# topic carries too little signal and the ask gets the NO MATCHES state.
_MIN_TOPIC_LENGTH = 3

# Only chief/co-authorship counts toward the authored/co-authored numbers.
# The `sponsor` role and committee-target rows are held out until the §5.3
# spike confirms their semantics (docs/product-onboarding/grounded-ask-spec.md §4.2).
_AUTHORSHIP_ROLES = (SponsorshipRole.chief_author, SponsorshipRole.co_author)

# A House/Senate file citation in free text: "HF 2136", "H.F. 2136", "SF1832",
# "S. F. 1832". The high-precision half of §4.6 bill resolution (HF/SF-number
# regex + fuzzy title); fuzzy title match lands with the bill_text path, where
# a titled bill is the realistic input. Leading zeros are tolerated and dropped.
_BILL_REFERENCE_RE = re.compile(r"\b([HS])\.?\s*F\.?\s*0*(\d{1,5})\b", re.IGNORECASE)

# The exact shape ``scopedChipQuery`` emits before a public suggestion. This cheap
# gate keeps ordinary reader-written questions out before any cache lookup query.
_SUGGESTED_QUERY_PREFIX_RE = re.compile(
    r"^(?:HF|SF) [1-9]\d{0,4}(?: in the \w+ special session)?$"
)


def _scope_session_ref(scope: LegislatureScope) -> AskSessionRef:
    """How an answer names the ground it covered.

    Always the Legislature's regular session, in every answer shape. A single-bill
    answer additionally carries the resolved bill's OWN session on the bill payload,
    so the page can say which session that bill is from without this field ever
    meaning two different things depending on the answer (#810).
    """
    return AskSessionRef(slug=scope.primary.slug, name=scope.primary.name)


def _bill_session_ref(scope: LegislatureScope, bill) -> AskSessionRef | None:
    """The session a single bill belongs to, for the bill payload.

    ``None`` for a bill of the Legislature's regular session, which is what a reader
    already assumes; served only when the bill comes from somewhere else, so a
    special-session bill can never be shown under the biennium's name.
    """
    return _session_ref_for(scope, bill.session_id)


def _session_ref_for(scope: LegislatureScope, session_id) -> AskSessionRef | None:
    row = scope.by_id(session_id)
    if row is None or row.id == scope.primary.id:
        return None
    return AskSessionRef(slug=row.slug, name=row.name)


def _progress_sort_key(bill):
    rank = bill.status_rank if bill.status_rank is not None else 99
    action_ts = (
        bill.latest_action_at.timestamp() if bill.latest_action_at else float("-inf")
    )
    return (rank, -action_ts, bill.file_number, bill.bill_key)


def _matched_bill_ids_select(session_ids, topic_value: str):
    """Bill ids matching a topic in the current Legislature — the single predicate
    both topic answer paths share so their result sets stay in lockstep.

    A bill matches on a policy-area tag OR a title/description keyword hit,
    restricted to bills of the sessions in scope that carry an AI summary. Scope is
    every session of the Legislature sitting, not just the regular one, so a reader
    asking about 2025 law reaches its special session too (#810)."""
    pattern = f"%{topic_value}%"
    matching_policy_area_bills = select(AIEnrichment.bill_id).where(
        AIEnrichment.enrichment_type == EnrichmentType.bill_summary,
        AIEnrichment.is_current.is_(True),
        cast(AIEnrichment.content_json["policy_areas"], String).ilike(pattern),
    )
    return select(Bill.id).where(
        Bill.session_id.in_(tuple(session_ids)),
        # Precomputed gate (#505) — identical to the semi-join it replaces.
        Bill.has_current_summary.is_(True),
        or_(
            Bill.id.in_(matching_policy_area_bills),
            Bill.title.ilike(pattern),
            Bill.description.ilike(pattern),
        ),
    )


def _topic_bills_answer(
    db: Session, topic: str | None, *, session_ids=None
) -> AskTopicBillsAnswer:
    # ``session_ids`` narrows the list to a session the QUESTION named, so a
    # degraded answer to "education bills in the first special session" does not
    # come back full of regular-session bills. Defaults to the whole Legislature.
    scope = current_legislature_scope(db)
    session_ids = tuple(session_ids) if session_ids else scope.ids
    data_as_of = db.scalar(
        select(func.max(IngestionRun.finished_at)).where(
            IngestionRun.status == IngestionStatus.succeeded
        )
    )
    session_ref = _scope_session_ref(scope)

    topic_value = (topic or "").strip()
    if len(topic_value) < _MIN_TOPIC_LENGTH:
        return AskTopicBillsAnswer(
            topic=topic_value or None,
            session=session_ref,
            data_as_of=data_as_of,
            total_matches=0,
            bills=[],
        )

    stmt = bill_list_stmt(session_ids).where(
        Bill.id.in_(_matched_bill_ids_select(session_ids, topic_value))
    )
    rows = db.scalars(stmt).all()
    ranked = sorted(rows, key=_progress_sort_key)
    return AskTopicBillsAnswer(
        topic=topic_value,
        session=session_ref,
        data_as_of=data_as_of,
        total_matches=len(rows),
        bills=[
            bill_list_item(bill, session=_bill_session_ref(scope, bill))
            for bill in ranked[:_DISPLAY_LIMIT]
        ],
    )


def _topic_legislators_answer(
    db: Session, topic: str | None
) -> AskTopicLegislatorsAnswer:
    scope = current_legislature_scope(db)
    data_as_of = db.scalar(
        select(func.max(IngestionRun.finished_at)).where(
            IngestionRun.status == IngestionStatus.succeeded
        )
    )
    session_ref = _scope_session_ref(scope)

    topic_value = (topic or "").strip()
    empty = AskTopicLegislatorsAnswer(
        topic=topic_value or None,
        session=session_ref,
        data_as_of=data_as_of,
        total_matches=0,
        total_bills=0,
        legislators=[],
    )
    if len(topic_value) < _MIN_TOPIC_LENGTH:
        return empty

    matched_bill_ids = _matched_bill_ids_select(scope.ids, topic_value)
    total_bills = db.scalar(
        select(func.count()).select_from(matched_bill_ids.subquery())
    )
    if not total_bills:
        return empty

    # Matched bills → authorship rows → legislators, joined to their current
    # service period so we can group by chamber. The inner join to the current
    # period drops non-current members (who have no chamber to group under) and
    # the legislator_id join drops committee-target sponsorship rows.
    rows = db.execute(
        select(
            Legislator.id,
            Legislator.slug,
            Legislator.full_name,
            Legislator.sort_name,
            LegislatorServicePeriod.party,
            LegislatorServicePeriod.profile_url,
            Chamber.slug.label("chamber"),
            District.code.label("district"),
            Sponsorship.role,
            Bill.id.label("bill_id"),
            Bill.session_id,
            Bill.bill_key,
            Bill.file_type,
            Bill.file_number,
            Bill.title,
        )
        .select_from(Sponsorship)
        .join(Bill, Bill.id == Sponsorship.bill_id)
        .join(Legislator, Legislator.id == Sponsorship.legislator_id)
        .join(
            LegislatorServicePeriod,
            and_(
                LegislatorServicePeriod.legislator_id == Legislator.id,
                # The REGULAR session, deliberately, while the bills above span
                # the whole Legislature: service periods exist only for the regular
                # session (206 rows; zero for the special one), and this join is what
                # supplies each author's chamber and party (#810).
                LegislatorServicePeriod.session_id == scope.primary.id,
                LegislatorServicePeriod.is_current.is_(True),
            ),
        )
        .join(Chamber, Chamber.id == LegislatorServicePeriod.chamber_id)
        .join(District, District.id == LegislatorServicePeriod.district_id)
        .where(
            Bill.id.in_(matched_bill_ids),
            Sponsorship.role.in_(_AUTHORSHIP_ROLES),
        )
    ).all()

    legislators: dict[str, dict] = {}
    for row in rows:
        key = str(row.id)
        entry = legislators.get(key)
        if entry is None:
            entry = {
                "id": key,
                "slug": row.slug,
                "full_name": row.full_name,
                "sort_name": row.sort_name,
                "party": row.party,
                "district": row.district,
                "chamber": row.chamber,
                "profile_url": row.profile_url,
                "authored": set(),
                "coauthored": set(),
                "bills": {},
            }
            legislators[key] = entry
        if row.role is SponsorshipRole.chief_author:
            entry["authored"].add(row.bill_id)
        else:
            entry["coauthored"].add(row.bill_id)
        entry["bills"][row.bill_id] = AskLegislatorBillRef(
            id=row.bill_key,
            file_type=row.file_type,
            file_number=row.file_number,
            title=row.title,
            # Same rule as a bill card: served only when the bill is not from the
            # regular session, so two references both reading "HF 5" are not
            # presented as one bill (#810).
            session=_session_ref_for(scope, row.session_id),
        )

    # Deterministic order for the shareable ?q= link: most bills first, then
    # name, then id. Cap the rendered list; the overflow points to Search.
    ordered = sorted(
        legislators.values(),
        key=lambda e: (
            -(len(e["authored"]) + len(e["coauthored"])),
            e["sort_name"],
            e["id"],
        ),
    )
    displayed = [
        AskLegislatorRow(
            id=e["id"],
            slug=e["slug"],
            full_name=e["full_name"],
            party=e["party"],
            district=e["district"],
            chamber=e["chamber"],
            profile_url=e["profile_url"],
            authored_count=len(e["authored"]),
            coauthored_count=len(e["coauthored"]),
            bills=sorted(e["bills"].values(), key=lambda b: b.file_number),
        )
        for e in ordered[:_DISPLAY_LIMIT]
    ]
    return AskTopicLegislatorsAnswer(
        topic=topic_value,
        session=session_ref,
        data_as_of=data_as_of,
        total_matches=len(legislators),
        total_bills=total_bills,
        legislators=displayed,
    )


def _ambiguous_number_answer(
    db: Session, scope: LegislatureScope, collisions
) -> AskTopicBillsAnswer:
    """The bills a colliding number names, shown instead of an answer about one.

    Rendered by the same list the topic paths return, with ``ambiguous_reference``
    set so the page says what happened rather than presenting two bills as topic
    matches. This is the honest shape for a question we cannot resolve: the reader
    named a number that means two different laws, and both are one click away.
    """
    data_as_of = db.scalar(
        select(func.max(IngestionRun.finished_at)).where(
            IngestionRun.status == IngestionStatus.succeeded
        )
    )
    first = collisions[0]
    return AskTopicBillsAnswer(
        topic=None,
        session=_scope_session_ref(scope),
        data_as_of=data_as_of,
        total_matches=len(collisions),
        bills=[
            bill_list_item(bill, session=_bill_session_ref(scope, bill))
            for bill in collisions
        ],
        ambiguous_reference=f"{first.file_type} {first.file_number}",
    )


def _parse_bill_reference(content: str) -> tuple[str, int] | None:
    """Extract an ``(file_type, file_number)`` HF/SF citation from free text, or
    ``None``. First match wins — a vote question names at most one bill."""
    match = _BILL_REFERENCE_RE.search(content)
    if match is None:
        return None
    return f"{match.group(1).upper()}F", int(match.group(2))


@dataclass(frozen=True)
class _NumberMatch:
    """What an HF/SF number in a question resolved to.

    ``bill`` is the one bill it names. ``collisions`` is the set it names when the
    number alone cannot choose between sessions — the caller shows them and lets the
    reader pick, rather than answering about one and hoping it was the right one.
    """

    bill: object | None = None
    collisions: tuple = ()
    # Whether the question actually wrote an HF/SF number. Distinguishes "no number
    # to look up" from "the number you gave matches nothing", which have to end
    # differently: the first falls through to title and meaning-based matching, and
    # the second must not. "HF 99: K-12 education funding" naming no HF 99 would
    # otherwise be answered by the title match with some other bill entirely.
    searched: bool = False


def _question_session_ids(scope: LegislatureScope, content: str):
    """Which sessions a question is asking about, decided ONCE for every resolver.

    Three outcomes:

    * the whole Legislature — the question names no session, which is almost every
      question;
    * one session's id — the question names a session we hold ("in the first special
      session"), so nothing outside it may answer;
    * ``None`` — it names a session we cannot pin down to exactly one, so the caller
      refuses.

    Deciding this once, above the resolvers, is the point. When the number step alone
    owned the session name, a question naming a session we do not hold declined *there*
    and then fell straight through to title and semantic resolution, which knew nothing
    about the name and would happily answer from either session — the decline bought
    nothing (caught in review before shipping, #810).
    """
    named = named_special_session_in_question(content, scope.primary.session_number)
    if named is False:
        return scope.ids
    if named is None:
        return None
    ids = tuple(row.id for row in scope.sessions if row.slug == named)
    return ids or None


def _resolve_bill(db: Session, session_ids, content: str) -> _NumberMatch:
    """Resolve a free-text ask to a single bill by its HF/SF number (§4.6).

    A Legislature numbers its special-session files from 1 all over again, so "HF 5"
    names a tax bill in the 94th's regular session and the K-12 education finance act
    in its first special session (#746). Within the sessions ``_question_session_ids``
    settled on, two outcomes:

    * the number matches once — resolved, which is every one of the 10,471
      regular-session bills whose number the special session never reused;
    * it matches more than once — returned as collisions, NOT resolved.

    That last case is why this returns a result object rather than a bill. Preferring
    the regular session would answer about a tax bill for a reader asking about
    schools, with every trust signal firing correctly on the wrong bill — the failure
    #868 is named after. There is no evidence in a bare number to break the tie with,
    so nothing here breaks it (grounded rule 1, cite or refuse).

    Unlike ``bill_list_stmt`` this does not require a bill-summary enrichment —
    the resolved-bill card (§9.4) is records, not a generated summary. It does
    require ``official_url`` so a resolved card always carries its citation
    (grounded rule 1, cite-or-refuse); a bill without one degrades instead."""
    reference = _parse_bill_reference(content)
    if reference is None:
        return _NumberMatch()
    file_type, file_number = reference
    matches = tuple(
        db.scalars(
            select(Bill)
            .where(
                Bill.session_id.in_(tuple(session_ids)),
                Bill.file_type == file_type,
                Bill.file_number == file_number,
                Bill.official_url.isnot(None),
            )
            .order_by(Bill.bill_key)
        ).all()
    )
    if len(matches) == 1:
        return _NumberMatch(bill=matches[0], searched=True)
    if len(matches) > 1:
        return _NumberMatch(collisions=matches, searched=True)
    return _NumberMatch(searched=True)


@dataclass(frozen=True)
class _SuggestedQuestionMatch:
    """One request proven to equal a current public suggestion for one bill."""

    bill: object
    bill_version: object
    enrichment: object
    suggestion_index: int
    suggestion_fingerprint: str
    bill_text_fingerprint: str


def _suggested_question_match(
    db: Session, content: str
) -> _SuggestedQuestionMatch | None:
    """Match only the bill-scoped questions Alethical placed on bill pages.

    The text after the first colon must equal a current ``question_prompts`` item
    byte for byte after trimming its outer whitespace. Nothing from an unmatched
    request is hashed or stored.
    """
    prefix, separator, suggested_question = content.partition(":")
    if (
        not separator
        or not _SUGGESTED_QUERY_PREFIX_RE.fullmatch(prefix.strip())
        or not suggested_question.strip()
    ):
        return None

    scope = current_legislature_scope(db)
    session_ids = _question_session_ids(scope, content)
    if session_ids is None:
        return None
    match = _resolve_bill(db, session_ids, content)
    if match.bill is None or match.collisions:
        return None

    expected_prefix = f"{match.bill.file_type} {match.bill.file_number}"
    bill_session = scope.by_id(match.bill.session_id)
    if bill_session is not None and bill_session.id != scope.primary.id:
        special = re.search(r"\b(\w+)\s+special session\b", bill_session.name, re.I)
        if special is None:
            return None
        expected_prefix += f" in the {special.group(1).lower()} special session"
    if prefix.strip() != expected_prefix:
        return None

    enrichment = current_bill_summary_enrichment(match.bill.enrichments)
    if enrichment is None:
        return None
    prompts = (enrichment.content_json or {}).get("question_prompts")
    if not isinstance(prompts, list):
        return None
    requested = suggested_question.strip()
    suggestion_index = next(
        (
            index
            for index, prompt in enumerate(prompts)
            if isinstance(prompt, str) and prompt.strip() == requested
        ),
        None,
    )
    if suggestion_index is None:
        return None

    bill_version = db.scalar(
        select(BillVersion).where(
            BillVersion.bill_id == match.bill.id,
            BillVersion.is_current.is_(True),
        )
    )
    if bill_version is None:
        return None
    bill_text_fingerprint = db.scalar(
        select(SourceArtifact.content_hash).where(
            SourceArtifact.id == bill_version.source_artifact_id
        )
    )
    if not bill_text_fingerprint:
        return None
    suggestion = prompts[suggestion_index].strip()
    return _SuggestedQuestionMatch(
        bill=match.bill,
        bill_version=bill_version,
        enrichment=enrichment,
        suggestion_index=suggestion_index,
        suggestion_fingerprint=hashlib.sha256(suggestion.encode("utf-8")).hexdigest(),
        bill_text_fingerprint=bill_text_fingerprint,
    )


# Question scaffolding stripped to isolate the bill's title phrase for a fuzzy
# match: leading interrogatives and a trailing "bill"/"law"/"act" noun.
_BILL_TITLE_LEAD_RE = re.compile(
    r"^\s*(what(?:'s| is| does| are)?|tell me about|explain|describe|summari[sz]e|"
    r"in|about|the|a|an)\b\s*",
    re.IGNORECASE,
)
_BILL_TITLE_TRAIL_RE = re.compile(
    r"\s*\b(bill|law|act|statute|legislation)\b\s*$", re.IGNORECASE
)
# Below this the phrase carries too little signal to name a single bill safely.
_MIN_TITLE_PHRASE_LENGTH = 4


def _bill_title_phrase(content: str) -> str | None:
    """Isolate the core title phrase from a bill_text question by peeling off the
    question scaffolding ("what's in the … bill?"). Heuristic on purpose — the
    single-match rule in ``_resolve_bill_by_title`` is what keeps it safe."""
    phrase = content.strip().rstrip("?.! ")
    prev = None
    while phrase and phrase != prev:
        prev = phrase
        phrase = _BILL_TITLE_LEAD_RE.sub("", phrase)
    phrase = _BILL_TITLE_TRAIL_RE.sub("", phrase).strip()
    return phrase or None


def _resolve_bill_by_title(db: Session, session_ids, content: str):
    """Fuzzy title/description match, but only a *single* confident match
    resolves (docs/product-onboarding/grounded-ask-spec.md §4.1, v1 fuzzy title match). An ambiguous
    phrase (2+ matches) or none returns ``None`` so the caller refuses rather
    than risk answering about the wrong bill — the worst failure (grounded rule
    1). Requires ``official_url`` so the answer is always citable."""
    phrase = _bill_title_phrase(content)
    if phrase is None or len(phrase) < _MIN_TITLE_PHRASE_LENGTH:
        return None
    pattern = f"%{phrase}%"
    rows = db.scalars(
        select(Bill)
        .where(
            Bill.session_id.in_(tuple(session_ids)),
            Bill.official_url.isnot(None),
            or_(Bill.title.ilike(pattern), Bill.description.ilike(pattern)),
        )
        .limit(2)
    ).all()
    return rows[0] if len(rows) == 1 else None


# bill_text RAG retrieval: how many of the resolved bill's passages to feed the
# synthesizer (docs/product-onboarding/grounded-ask-spec.md §4.1 / §9.4). No cosine-distance gate —
# once the bill is *resolved* by number/title, retrieval is scoped to that bill,
# so its top passages ARE the answer material; the synthesis prompt says "the
# bill doesn't address that" when a specific question isn't covered. An earlier
# 0.6 distance gate over-filtered generic "what's in this bill?" queries into a
# false refuse in production (#255) — the query is semantically far from the
# specific text even though the bill is the right one. A relevance threshold
# belongs on *content-based* resolution (finding the bill by meaning), not here.
_BILL_TEXT_CHUNK_LIMIT = 4

# A question that asks for EVERYTHING of a kind cannot be answered from a fixed
# handful of passages, which is the failure behind #868: asked which cities and
# counties HF 719 names for grants, the four nearest-by-meaning passages of a
# 102-passage bonding bill each listed a few city grants and no counties, so the
# answer enumerated nineteen cities as though that were the set and stated the bill
# named no counties at all. It names 98 and 20.
#
# No selection strategy fixes that — the seventy passages that each say "for a grant
# to the city of X" are all equally on-topic, so there is no "best four" to find.
# What is left is to read more of the bill, or to say the read was a sample. This
# does the first; the served coverage fact and the page's note (§9.5 decision 11) do
# the second.
#
# Detection is deliberately loose: a false positive costs a slower, more complete
# answer, while a false negative puts the confident-wrong answer back. So "all" and
# "each" are in, even though they catch questions that are not really enumerations.
_LIST_QUESTION_RE = re.compile(
    r"\b(which|list|every|each|all|how many|name the|what are the|who are)\b",
    re.IGNORECASE,
)

# Words of bill text one list question may read. Measured over all 10,433 production
# bills with retrievable text (Jul 31 2026): median 302 words, 90th percentile 2,339,
# 99th percentile 20,977, largest 241,551. So 20,000 reads 99% of bills in full —
# including HF 719 at 16,894 — and the ~1% that overflow are reported as partial
# instead of read as if complete. The median bill is unaffected either way: at 2
# passages it already fits inside the fixed limit of 4.
_LIST_QUESTION_WORD_BUDGET = 20_000

# Ceiling on rows fetched before the word budget is applied. The budget is the real
# gate (20,000 words is ~120 passages at production's ~166 words each); this only
# stops the largest omnibus bill, at 1,484 passages, from loading every row to throw
# most of them away.
_LIST_QUESTION_CHUNK_CEILING = 200

# How many passages the answer SHOWS as citations, however many it read. Reading and
# showing are different jobs: the synthesizer gets everything inside the word budget,
# while a citation is something a person checks the answer against, and the first
# live run of this change served 102 excerpt cards for one HF 719 question, which
# nobody checks. The coverage fact carries "how much did you read" instead. Rule 1
# (cite or refuse) asks whether a resolvable official source backs the answer, not
# how many do, so this never threatens it and never reaches zero.
_SERVED_CITATION_LIMIT = 8

# Longest citation excerpt we serve, in characters. The synthesis still reads the
# whole chunk (synthesize_grounded_answer passes chunk_text unbounded) — this caps
# only what the reader is shown.
_EXCERPT_MAX_CHARS = 220

# Header lines rag chunking prepends to every chunk body (compact_chunk_prefix in
# alethical/pipeline/rag.py) so the embedded text carries its own location. "Bill
# title" is the one label that prefix has never emitted; it belonged to the
# section-level full_section_prefix, which only ever fed
# rag_section_document.search_text and went with it (#715). Left in the pattern as
# cheap defence, not because any chunk carries it.
# They are retrieval metadata, not bill text: the citation chip
# already states the location, so printing them again fills the card and pushes
# the actual quote out of view (#835).
_CHUNK_PREFIX_LINE_RE = re.compile(
    r"^(?:Bill|Bill title|Article|Section|Statute heading|Citation heading):\s",
)


def _citation_excerpt(chunk_text: str) -> str:
    """One chunk as a short display quote: no retrieval header, cut at a word.

    Only strips the prefix and shortens — the surviving characters, their
    punctuation and their capitalization pass through verbatim, so this can never
    introduce a claim the bill text didn't make (.claude/rules/grounded-answers.md
    rule 1). Mirrors the frontend's citationExcerpt cleaner, which stays in place
    as defense-in-depth.
    """
    lines = (chunk_text or "").strip().splitlines()
    # Drop the leading header lines only — stop at the first line that isn't one,
    # so a chunk without a prefix keeps every word of its body.
    start = 0
    while start < len(lines) and _CHUNK_PREFIX_LINE_RE.match(lines[start].strip()):
        start += 1
    body = " ".join(line.strip() for line in lines[start:] if line.strip())
    if len(body) <= _EXCERPT_MAX_CHARS:
        return body
    cut = body[:_EXCERPT_MAX_CHARS]
    # Back up to the last whole word. A chunk with no space in its first 220
    # characters (a long table row) keeps the hard cut rather than losing itself.
    space = cut.rfind(" ")
    if space > 0:
        cut = cut[:space]
    # The ellipsis is the only terminal mark the quote carries, so a comma or
    # dash the source left at the cut goes with it.
    cut = re.sub(r"[,;:\s]+$", "", cut)
    cut = re.sub(r"\s*[—–-]$", "", cut)
    return f"{cut}…"


def _bill_passage_total(db: Session, bill_id, model: str) -> int | None:
    """How many retrievable passages the bill's CURRENT version has, or None.

    Paired with the number retrieval actually used, this is what lets the answer
    page say above a long-bill answer that it covers part of the bill
    (docs/product-onboarding/grounded-ask-spec.md §9.5 decision 11; #883). On HF
    719 it is 102 against the 4 the writer sees.

    Scoped to the current version the SAME way ``semantic_rag_chunk_stmt``'s
    ``current_version_only`` scopes retrieval (#285). Counting every version's
    chunks would inflate the total on a bill with several engrossments and make the
    ratio a different, wrong number.

    **Also scoped to the embedding model retrieval filters on** (#868). Retrieval
    only ever returns chunks embedded under the model the query vector was built
    with — a distance between vectors from two different models is meaningless
    (#221) — so counting chunks embedded under any other model, or chunks with no
    embedding at all, inflates the denominator the same way a stale version does.
    Uncorrected, a bill could report itself partially read when every passage
    retrieval can reach had already gone in, which is how a *complete* read gets
    labelled a sample. ``model`` is taken as an argument rather than resolved here,
    so it is provably the same value the retrieval call used — resolving it twice is
    a second way for the two halves to disagree.
    ``retrievable_chunk_count_stmt`` keeps the joins in lockstep
    with the retrieval statement so the two halves of the ratio cannot disagree
    about what "all of this bill's passages" means.
    """
    total = db.scalar(retrievable_chunk_count_stmt(bill_id, embedding_model=model))
    return total or None


def _chunk_sections(db: Session, chunks) -> dict:
    """``bill_version_section_id`` -> ``(section_id_text, source_order, chip topic)``
    for the retrieved chunks' sections.

    These are what let a citation card link to the quoted passage inside our own
    Bill Text tab, which anchors each section on ``#ft-<section_id>-<source_order>``
    (#854; the scheme is described in
    docs/product-onboarding/bill-text-tab-spec.md § "Jumping to a section") —
    .claude/rules/grounded-answers.md rule 5, and
    docs/product-onboarding/grounded-ask-spec.md §9.5 (The chip-reached answer page —
    decided web design) decision 4. One extra query for at most four sections.

    **The position is required, not optional.** ``section_id_text`` cannot identify a
    section on its own: it is what the Revisor hands every section sitting outside an
    article, so 66 current versions repeat one id across several sections and 30
    sections of ``94-2025-SF3492`` share ``laws.0.1.0``. An id-only anchor lands the
    reader on the first of those, which on a long omnibus is very likely the wrong
    grant — the exact rule 5 failure the deep link exists to avoid.

    Unlike the bill page's key-point citations, which have to be matched back to a
    section by their quote, a retrieval chunk holds the section's own foreign key. So
    the position here is EXACT, and the pair always names one section.

    A chunk whose section document has no section row (a whole-version document)
    yields nothing, and the card falls back to the official source URL.
    """
    section_ids = {
        chunk.rag_section_document.bill_version_section_id
        for chunk in chunks
        if chunk.rag_section_document.bill_version_section_id is not None
    }
    if not section_ids:
        return {}
    rows = db.execute(
        select(
            BillVersionSection.id,
            BillVersionSection.section_id_text,
            BillVersionSection.source_order,
            BillVersionSection.section_heading,
            BillVersionSection.cite_heading,
        ).where(BillVersionSection.id.in_(section_ids))
    ).all()
    return {
        row.id: (
            row.section_id_text,
            row.source_order,
            section_chip_topic(row.section_heading, row.cite_heading),
        )
        for row in rows
        if row.section_id_text
    }


# Content-based (semantic) bill resolution — the third resolution step, when
# HF/SF-number and title matching both fail (docs/product-onboarding/grounded-ask-spec.md §4.1, the
# semantic half of fuzzy resolution; #266). Semantic search surfaces the top
# candidate bills, then the LLM picks the single best (or none): reasoning
# separates a real-but-loose match from a nonsense one, and the enacted bill from
# its companion — which distance/count heuristics couldn't (#271 / #273).
# Real-model-only: hash-fallback distances are arbitrary. The classifier already
# routes out-of-scope questions to `refuse`, so this only sees "about a bill/law"
# questions; the distance cap trims the candidate pool. Tuned live (#255).
_BILL_TEXT_RESOLVE_CHUNK_LIMIT = 25
_BILL_TEXT_RESOLVE_CANDIDATES = 6
_BILL_TEXT_RESOLVE_MAX_DISTANCE = 0.6


def _semantic_candidate_bills(db: Session, session_ids, model: str, embedding):
    """Top distinct current-session, citable, AI-summarized bills by best matching
    passage — the candidate pool the LLM chooses from. Real-model-only."""
    if model != DEFAULT_RAG_MODEL:
        return []
    chunks = db.scalars(
        semantic_rag_chunk_stmt(
            embedding,
            # Scoped in the QUERY, not after it: this statement takes the nearest
            # N chunks, so filtering the results instead would let a bill outside
            # the scope spend a slot an in-scope bill needed (#810).
            session_id=tuple(session_ids),
            embedding_model=model,
            limit=_BILL_TEXT_RESOLVE_CHUNK_LIMIT,
            max_distance=_BILL_TEXT_RESOLVE_MAX_DISTANCE,
        )
    ).all()
    ordered_ids = list(
        dict.fromkeys(chunk.rag_section_document.bill_id for chunk in chunks)
    )
    candidates = []
    for bill_id in ordered_ids:
        bill = db.scalar(bill_list_stmt(tuple(session_ids)).where(Bill.id == bill_id))
        if bill is not None and bill.official_url:
            candidates.append(bill)
        if len(candidates) >= _BILL_TEXT_RESOLVE_CANDIDATES:
            break
    return candidates


def _resolve_bill_by_content(db: Session, session_ids, model: str, content, embedding):
    """Resolve a colloquial description ("the new social media law for kids") to a
    single bill when number/title resolution failed (§4.1 / #266): the LLM picks
    the best of the top semantic candidates, or none → the caller degrades /
    refuses. Real-model-only; on the hash fallback (tests) it is a no-op."""
    candidates = _semantic_candidate_bills(db, session_ids, model, embedding)
    if not candidates:
        return None
    catalog = []
    for bill in candidates:
        item = bill_list_item(bill)
        # Deliberately the FORMAL summary, not the reader-facing one the display
        # surfaces switched to in #766. This text is a disambiguation aid for the
        # LLM choosing between similar bills, not something a person reads, and the
        # formal phrasing carries the specifics that distinguish near-duplicates
        # (fund names, exact figures, the statute being amended) which the
        # plain-language rewrite deliberately drops. Changing what this step reasons
        # over would move an eval-gated path (grounded-answers rule 1's acceptance
        # suite; retrieval quality tracked on #400), so it stays pinned and is
        # changed only behind that eval.
        enrichment = current_bill_summary_enrichment(bill.enrichments)
        content = (enrichment.content_json or {}) if enrichment else {}
        formal = content.get("summary")
        summary = formal if isinstance(formal, str) and formal.strip() else None
        catalog.append((bill.bill_key, bill.title, item.current_status, summary))
    chosen_key = pick_bill_from_candidates(content, catalog)
    if chosen_key is None:
        return None
    return next((b for b in candidates if b.bill_key == chosen_key), None)


def _retrieve_bill_text(db: Session, bill, model: str, embedding, *, enumerating: bool):
    """One resolved bill's passages for the synthesizer, and how much of the bill
    they are (#868).

    Two retrieval shapes, chosen by what the question asks for:

    * **A specific question** (``enumerating=False``) keeps the fixed
      ``_BILL_TEXT_CHUNK_LIMIT`` sample. Four passages is the right size for "when
      does this take effect?", and feeding a hundred would cost money and make every
      reader wait for nothing.
    * **An enumerate-everything question** reads as much of the bill as
      ``_LIST_QUESTION_WORD_BUDGET`` allows, because a list is only right when it is
      either complete or admits it is not.

    Passages stay in relevance order rather than being re-sorted into bill order.
    Bill order would read more naturally and be easier to check against the source,
    but it needs each section's ``source_order``, which retrieval does not load, and
    it changes nothing about whether the answer is correct or honest. Answer
    *quality* is measured by the eval on
    [#865](https://github.com/alethical-org/alethical/issues/865); a change like that
    belongs there, behind a measurement.
    """
    total = _bill_passage_total(db, bill.id, model) or 0
    if not enumerating:
        chunks = db.scalars(
            semantic_rag_chunk_stmt(
                embedding,
                bill_id=bill.id,
                embedding_model=model,
                limit=_BILL_TEXT_CHUNK_LIMIT,
            )
        ).all()
        return chunks, BillTextCoverage(searched=len(chunks), total=total)

    ranked = db.scalars(
        semantic_rag_chunk_stmt(
            embedding,
            bill_id=bill.id,
            embedding_model=model,
            limit=_LIST_QUESTION_CHUNK_CEILING,
        )
    ).all()
    budgeted: list = []
    words = 0
    for chunk in ranked:
        words += chunk.word_count
        # ``budgeted`` guards the first passage: one passage longer than the whole
        # budget still gets read, because returning nothing would refuse a question
        # the bill can answer.
        if budgeted and words > _LIST_QUESTION_WORD_BUDGET:
            break
        budgeted.append(chunk)
    return budgeted, BillTextCoverage(searched=len(budgeted), total=total)


def _bill_text_answer(
    db: Session, content: str
) -> AskBillTextAnswer | AskTopicBillsAnswer | None:
    """Scenario 1 single-bill RAG answer (docs/product-onboarding/grounded-ask-spec.md §4.1 / §9.4).

    Resolve one bill — by HF/SF number, then title, then semantic content match
    (#266) — retrieve its passages, and synthesize a cited prose answer, reusing
    the bill-scoped chat machinery. If the question names no *single* bill,
    degrade to the cited topic_bills list when the phrase still names a topic
    with matches (§4.1 fallback); otherwise, or when the resolved bill has no
    passage, refuse (return ``None``) rather than stretch (cite-or-refuse, §4.5).
    """
    scope = current_legislature_scope(db)
    model = effective_embedding_model(DEFAULT_RAG_MODEL)
    embedding = build_query_embedding(content)
    # HNSW ANN search tuning (#584). ef_search is the search-beam width; it must
    # exceed the retrieval LIMIT (25 here) for good recall — 100 gives headroom at
    # negligible latency. (Was ivfflat.probes=10; the ivfflat index was replaced by
    # HNSW, which recovered recall and cut ~9s search latency.)
    db.execute(text("SET LOCAL hnsw.ef_search = 100"))

    session_ids = _question_session_ids(scope, content)
    if session_ids is None:
        # Names a session we cannot pin down to one we hold. Refusing here rather
        # than in the number step is what makes the refusal stick: title and
        # semantic resolution below know nothing about the name, so falling through
        # to them would answer from a session the reader did not ask about.
        return None
    by_number = _resolve_bill(db, session_ids, content)
    if by_number.collisions:
        # One number, two bills, no evidence to choose. Hand the reader both.
        return _ambiguous_number_answer(db, scope, by_number.collisions)
    if by_number.searched and by_number.bill is None:
        # The reader named a bill number and we do not have it. Title and
        # meaning-based matching would happily return a different bill, which is a
        # wrong answer wearing a correct citation. Refuse instead (grounded rule 1).
        return None
    resolved = (
        by_number.bill
        or _resolve_bill_by_title(db, session_ids, content)
        or _resolve_bill_by_content(db, session_ids, model, content, embedding)
    )
    if resolved is None:
        phrase = _bill_title_phrase(content)
        if phrase:
            degraded = _topic_bills_answer(db, phrase, session_ids=session_ids)
            if degraded.total_matches:
                return degraded
        return None

    enumerating = bool(_LIST_QUESTION_RE.search(content))
    chunks, coverage = _retrieve_bill_text(
        db, resolved, model, embedding, enumerating=enumerating
    )
    if not chunks:
        return None

    prose = synthesize_grounded_answer(
        content, chunks, bill_key=resolved.bill_key, coverage=coverage
    )
    # Cited passages are a SUBSET of what the answer was written from — see
    # _SERVED_CITATION_LIMIT. The coverage fact below carries how much was read.
    cited = chunks[:_SERVED_CITATION_LIMIT]
    sections = _chunk_sections(db, cited)
    citations = []
    for chunk in cited:
        section_id, section_order, section_topic = sections.get(
            chunk.rag_section_document.bill_version_section_id, ("", None, "")
        )
        citations.append(
            AskCitation(
                label=chunk.citation_label,
                bill_id=resolved.bill_key,
                excerpt=_citation_excerpt(chunk.chunk_text),
                url=resolved.official_url,
                section_id=section_id,
                section_order=section_order,
                section_topic=section_topic,
            )
        )
    data_as_of = db.scalar(
        select(func.max(IngestionRun.finished_at)).where(
            IngestionRun.status == IngestionStatus.succeeded
        )
    )
    return AskBillTextAnswer(
        answer=prose,
        citations=citations,
        bill=bill_list_item(resolved, session=_bill_session_ref(scope, resolved)),
        session=_scope_session_ref(scope),
        data_as_of=data_as_of,
        coverage=(
            AskPassageCoverage(
                used=coverage.searched,
                total=coverage.total,
                # Whether the reader asked for EVERY instance of something. The page
                # needs it because a complete read is not a complete list: reading all
                # 102 passages of HF 719 still produced 26-35 of its 98 cities, so
                # "used == total" alone would take the page's caveat away on exactly
                # the answer that most needs one (#868).
                enumerating=enumerating,
            )
            if coverage.total
            else None
        ),
    )


def _suggested_cache_identity(match: _SuggestedQuestionMatch) -> dict:
    """Every input that can change a generated answer, with no request text."""
    return {
        "bill_id": match.bill.id,
        "bill_version_id": match.bill_version.id,
        "bill_summary_enrichment_id": match.enrichment.id,
        "suggestion_index": match.suggestion_index,
        "suggestion_fingerprint": match.suggestion_fingerprint,
        "bill_text_fingerprint": match.bill_text_fingerprint,
        "prompt_fingerprint": rag_chat_prompt_fingerprint(),
        "answer_model": os.environ.get(
            "OPENAI_RAG_CHAT_MODEL", DEFAULT_RAG_CHAT_MODEL
        ).strip(),
        "embedding_model": effective_embedding_model(DEFAULT_RAG_MODEL),
    }


def _suggested_cache_row(db: Session, identity: dict):
    return db.scalar(
        select(AskSuggestedAnswerCache).where(
            *(
                getattr(AskSuggestedAnswerCache, field) == value
                for field, value in identity.items()
            )
        )
    )


def _suggested_cache_lock_key(identity: dict) -> int:
    """A transaction lock key derived only from the public cache identity."""
    material = "\0".join(str(value) for value in identity.values())
    digest = hashlib.sha256(material.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], byteorder="big", signed=True)


def _hydrate_suggested_answer(
    db: Session, scope: LegislatureScope, bill, payload: dict
) -> AskBillTextAnswer:
    """Combine saved prose/evidence with the bill's live status and date."""
    data_as_of = db.scalar(
        select(func.max(IngestionRun.finished_at)).where(
            IngestionRun.status == IngestionStatus.succeeded
        )
    )
    return AskBillTextAnswer.model_validate(
        {
            **payload,
            "bill": bill_list_item(bill, session=_bill_session_ref(scope, bill)),
            "session": _scope_session_ref(scope),
            "data_as_of": data_as_of,
        }
    )


def _suggested_bill_text_answer(
    db: Session, content: str, match: _SuggestedQuestionMatch
) -> AskBillTextAnswer | None:
    """Return a saved public answer, or generate and save it exactly once.

    The transaction-scoped database lock makes simultaneous first visits wait for
    the same answer instead of paying for several copies. The second lookup after
    the lock is essential: another request may have filled the cache while this one
    waited.
    """
    identity = _suggested_cache_identity(match)
    scope = current_legislature_scope(db)
    cached = _suggested_cache_row(db, identity)
    if cached is not None:
        return _hydrate_suggested_answer(db, scope, match.bill, cached.answer_payload)

    db.execute(
        text("SELECT pg_advisory_xact_lock(:lock_key)"),
        {"lock_key": _suggested_cache_lock_key(identity)},
    )
    cached = _suggested_cache_row(db, identity)
    if cached is not None:
        return _hydrate_suggested_answer(db, scope, match.bill, cached.answer_payload)

    answer = _bill_text_answer(db, content)
    if not isinstance(answer, AskBillTextAnswer):
        return None
    answer_payload = answer.model_dump(
        mode="json", include={"answer", "citations", "coverage"}
    )
    db.add(AskSuggestedAnswerCache(**identity, answer_payload=answer_payload))
    db.commit()
    return answer


def _vote_deflection_answer(
    db: Session, content: str, topic: str | None
) -> AskVoteDeflectionAnswer:
    """Scenario 4 v1 honest deflection (docs/product-onboarding/grounded-ask-spec.md §4.5 / §9.4).

    Never a vote answer. If the ask names a resolvable bill, carry its card so
    the frontend can deep-link the Votes tab (§9.3); otherwise degrade to the
    cited topic_bills list. No tallies or vote positions in either shape — those
    are records on the Votes tab, not a generated answer (grounded rule 4)."""
    scope = current_legislature_scope(db)
    data_as_of = db.scalar(
        select(func.max(IngestionRun.finished_at)).where(
            IngestionRun.status == IngestionStatus.succeeded
        )
    )
    session_ref = _scope_session_ref(scope)

    session_ids = _question_session_ids(scope, content)
    if session_ids is None:
        # Names a session we cannot pin down. An unrestricted topic list here would
        # answer a question about the fourth special session with bills from the
        # sessions we do hold, which is the same wrong answer the bill path refuses.
        return AskVoteDeflectionAnswer(
            session=session_ref,
            data_as_of=data_as_of,
            resolved_bill=None,
            topic_bills=None,
        )
    by_number = _resolve_bill(db, session_ids, content)
    if by_number.collisions:
        return AskVoteDeflectionAnswer(
            session=session_ref,
            data_as_of=data_as_of,
            resolved_bill=None,
            topic_bills=_ambiguous_number_answer(db, scope, by_number.collisions),
        )
    if by_number.bill is not None:
        return AskVoteDeflectionAnswer(
            session=session_ref,
            data_as_of=data_as_of,
            resolved_bill=bill_list_item(
                by_number.bill, session=_bill_session_ref(scope, by_number.bill)
            ),
            topic_bills=None,
        )
    return AskVoteDeflectionAnswer(
        session=session_ref,
        data_as_of=data_as_of,
        resolved_bill=None,
        topic_bills=_topic_bills_answer(db, topic, session_ids=session_ids),
    )


@router.post("/ask/classify", response_model=DetailResponse, status_code=200)
def classify_ask_query(
    request: AskClassifyRequest,
    _current_user=Depends(get_optional_current_user),
    _rate_limited: None = Depends(_ask_rate_limit),
):
    """Identify which Ask view/intent a free-form query should route to."""
    content = request.content.strip()
    if not content:
        raise problem_exception(400, "Bad Request", "content must not be empty")

    result = classify_query(content)
    return DetailResponse(
        data=AskClassificationPayload(
            intent=result.intent.value,
            auth_required=result.auth_required,
            source=result.source,
            confidence=result.confidence,
            topic=result.topic,
        ),
        links={"self": "/api/v1/ask/classify"},
    )


@router.post("/ask", response_model=DetailResponse, status_code=200)
def ask(
    request: AskClassifyRequest,
    db: Session = Depends(get_db),
    _rate_limited: None = Depends(_ask_rate_limit),
):
    """Classify an Ask and build its answer body.

    Answered intents: topic_bills / topic_legislators (cited lists) and
    legislator_vote (the §4.5 honest deflection — a resolved-bill card or a
    topic_bills degrade, never a vote answer) and bill_text (the §4.1 single-bill
    RAG answer, or a refuse when the bill doesn't resolve / has no relevant
    text). Anonymous by design — every v1 answer path is signed-out-accessible
    (docs/product-onboarding/grounded-ask-spec.md §9.1). refuse returns no answer body.
    """
    content = request.content.strip()
    if not content:
        raise problem_exception(400, "Bad Request", "content must not be empty")

    suggested = _suggested_question_match(db, content)
    if suggested is not None:
        suggested_answer = _suggested_bill_text_answer(db, content, suggested)
        if suggested_answer is not None:
            return DetailResponse(
                data=AskAnswerPayload(
                    intent=AskIntent.BILL_TEXT.value,
                    source="predefined",
                    confidence=1.0,
                    answer=suggested_answer,
                ),
                links={"self": "/api/v1/ask"},
            )

    result = classify_query(content)
    answer = None
    if result.intent is AskIntent.BILL_TEXT:
        answer = _bill_text_answer(db, content)
    elif result.intent is AskIntent.TOPIC_BILLS:
        answer = _topic_bills_answer(db, result.topic)
    elif result.intent is AskIntent.TOPIC_LEGISLATORS:
        answer = _topic_legislators_answer(db, result.topic)
    elif result.intent is AskIntent.LEGISLATOR_VOTE:
        answer = _vote_deflection_answer(db, content, result.topic)

    return DetailResponse(
        data=AskAnswerPayload(
            intent=result.intent.value,
            source=result.source,
            confidence=result.confidence,
            answer=answer,
        ),
        links={"self": "/api/v1/ask"},
    )
