#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import uuid
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import requests
from sqlalchemy import create_engine, select, update
from sqlalchemy.orm import Session, selectinload

from alethical.api.serializers import section_chip_topic
from alethical.db import models as schema
from alethical.pipeline.sessions import CURRENT_SESSION_SLUG
from alethical.db.session import (
    NO_PREPARED_STATEMENTS,
    get_database_url,
    normalize_database_url,
)
from alethical.db.session import supabase_database_url as _supabase_database_url


AIEnrichment = schema.AIEnrichment
Bill = schema.Bill
BillVersion = schema.BillVersion
BillVersionSection = schema.BillVersionSection
EnrichmentType = schema.EnrichmentType
LegislativeSession = schema.LegislativeSession
RagSectionDocument = schema.RagSectionDocument
Sponsorship = schema.Sponsorship

OPENAI_API_BASE = "https://api.openai.com/v1"
DEFAULT_MODEL = "gpt-5.2"
# Short-title generation runs on the cheap model regardless of --model. It reads
# only bill metadata (no bill text), so it stays inexpensive; pin it here so a
# drifted DEFAULT_MODEL never leaks into the title backfill.
TITLE_MODEL = "gpt-4o-mini"
DEFAULT_OUTPUT_DIR = Path(".tmp/openai-batches")
MAX_BATCH_REQUESTS = 50_000
MAX_BATCH_FILE_BYTES = 200 * 1024 * 1024


SUMMARY_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "short_title": {"type": "string"},
        "what": {"type": "string"},
        "why": {"type": "string"},
        "summary": {
            "type": "string",
            "description": (
                "Plain-language statement of what the bill does. No leading bill "
                "number or 'The bill …' preamble, and no raw statute citations "
                "(e.g. 'Minnesota Statutes, section 297A.67, subdivision 40'); "
                "describe the effect instead."
            ),
        },
        "plain_language_summary": {
            "type": "string",
            "description": (
                "Plain-language statement of what the bill does. No leading bill "
                "number or 'The bill …' preamble, and no raw statute citations; "
                "describe the effect instead."
            ),
        },
        "key_changes": {"type": "array", "items": {"type": "string"}},
        "who_affected": {"type": "array", "items": {"type": "string"}},
        "supporters_may_say": {"type": "array", "items": {"type": "string"}},
        "concerns_may_raise": {"type": "array", "items": {"type": "string"}},
        "quick_summary": {"type": "string"},
        "key_points": {
            "type": "array",
            "description": (
                "Plain-language bullets, each stating a concrete effect of the "
                "bill. AIM FOR ABOUT SIX after consolidating — six is a target, "
                "not a quota: return fewer when the bill is simple, and more when "
                "genuinely distinct subjects remain. No leading bill number or "
                "'The bill …' preamble, and no raw statute citations; never a "
                "bullet that is only a citation (e.g. 'Amends Minnesota Statutes "
                "2024, section 120B.123, subdivision 5.')."
            ),
            # Runaway guard, deliberately well above the ~6 target — and it only
            # BINDS on the OpenAI path. Read that before trusting it as a limit:
            #
            # * OpenAI (`ai_enrichment` batch, strict Structured Outputs) enforces
            #   `maxItems`, and the model satisfies it by TRUNCATING the tail rather
            #   than merging (verified against /v1/responses: a 12-item request
            #   returned the first 6 and silently dropped the rest). So a ceiling AT
            #   the target would do the exact thing the consolidation rule forbids —
            #   drop the bill's later substance. Hence 12, not 6.
            # * Claude (`anthropic_enrichment`, the PRODUCTION path) pastes this
            #   schema into the prompt as text and validates the reply with
            #   `validate_summary_shape`, which checks types and the confidence enum
            #   and does NOT read `maxItems`. So here the number is advice to the
            #   model, not a limit — one production bill came back with 15 (#836).
            #
            # Over-ceiling replies are therefore REPORTED, not rejected:
            # `combine_output_files` counts them (`over_ceiling`) so a genuine
            # runaway is visible at the end of a run. Rejecting would burn the four
            # retries in `_call_anthropic` and then drop the bill, and a bill with no
            # summary is invisible in every list on the site — worse than a long one.
            # The pathological case this exists for: one production bill once
            # carried 59 key points.
            "maxItems": 12,
            "items": {"type": "string"},
        },
        "policy_areas": {"type": "array", "items": {"type": "string"}},
        "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
        # Whether the model saw the whole bill or a cut-down copy. Costs ~5 chars
        # and nothing displays it, but it is the field that tells you *why* a long
        # bill's key points look thin — check it before blaming anything else.
        "truncated_source": {"type": "boolean"},
        # Per-key-point source anchors (#377): each key point must be tied to a
        # supplied excerpt so the bill page can show a traceable citation marker.
        # `section_id` is the [S#] token from the bracketed excerpt the point was
        # drawn from; `quote` is a short verbatim span copied from that excerpt.
        # Unanchorable points are dropped at apply time (never invented) — see
        # resolve_key_point_citations.
        "key_point_citations": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "point": {"type": "string"},
                    "section_id": {"type": "string"},
                    "quote": {"type": "string"},
                },
                "required": ["point", "section_id", "quote"],
            },
        },
        # System-suggested Ask chips for the bill page (#550). Short, natural
        # reader questions that are answerable *purely* from the supplied bill
        # text, so a chip can never lead to a refusal (grounded-answers rule 2).
        # The bill identifier is attached by the product, so questions omit it.
        "question_prompts": {"type": "array", "items": {"type": "string"}},
    },
    "required": [
        "short_title",
        "what",
        "why",
        "summary",
        "plain_language_summary",
        "key_changes",
        "who_affected",
        "supporters_may_say",
        "concerns_may_raise",
        "quick_summary",
        "key_points",
        "policy_areas",
        "confidence",
        "truncated_source",
        "key_point_citations",
        "question_prompts",
    ],
}


# Minimal schema for the title-only backfill: generate just a neutral short_title
# from bill metadata. Kept separate from SUMMARY_SCHEMA so a title-only request is
# cheap and strict (no full analysis fields).
SHORT_TITLE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {"short_title": {"type": "string"}},
    "required": ["short_title"],
}


SYSTEM_PROMPT = """You write careful, source-grounded legislative analysis for Alethical.

Return JSON matching the provided schema. Base the analysis only on the supplied bill metadata and bill text excerpts. Do not invent vote outcomes, author motives, public opinion, fiscal scores, or legal effects not supported by the text. If a field cannot be supported, use cautious language or an empty array. Keep wording neutral and make both benefits and concerns conditional when the bill text does not prove real-world outcomes. Also produce `short_title`: a neutral, descriptive headline-case title (about 4-8 words, at most 70 characters) that states plainly what the bill does, with no editorializing or advocacy.

Write `summary`, `plain_language_summary`, and every entry in `key_points` as plain-language statements of what the bill does, the way you would explain it to a member of the public. Two hard rules for these three fields:
- Do NOT begin any of them with the bill number or a "The bill …" / "This act …" preamble — the bill identifier is displayed separately, so start with the action itself.
- Do NOT include raw statute citations — no "Minnesota Statutes", no "section 297A.67", "subdivision 40", or "chapter 626" style references. Describe the effect instead. For example, write "Exempts baby products from the state sales tax" rather than "Amends Minnesota Statutes 2024, section 297A.67, subdivision 40, to exempt certain baby products". Every `key_points` entry must state a concrete effect of the bill; never emit a key point that is only a statute citation (for example, never "Amends Minnesota Statutes 2024, section 120B.123, subdivision 5.").
These two rules apply ONLY to `summary`, `plain_language_summary`, and `key_points`. They do NOT apply to the `quote` field in `key_point_citations`, which must still be copied verbatim from the supplied excerpt (statute references and all) so the citation stays grounded.

`key_points` is CONSOLIDATED, and ordered BY SUBJECT rather than by section number: first what the bill creates or establishes, then when those bodies or duties must act, then the money. Sequential section order is not the goal — a section 1 that transfers money belongs with the money, not in first place. Consolidate by these rules:
- Merge bullets that differ only in which body, fund, or agency they name. Two bullets giving the same appointment and first-meeting deadlines for two different bodies are ONE bullet naming both.
- Merge every appropriation and transfer into ONE money bullet naming the amounts, rather than one bullet per appropriation. Give that bullet the HEADLINE amounts and what each pays for; do not itemise every sub-appropriation, base amount, or availability window, which turns the bullet into a paragraph nobody reads.
- Keep every bullet to about one sentence. A bullet that needs a semicolon-separated list to fit is doing the work of two bullets, or is itemising detail that belongs in the bill text rather than the summary.
- Drop any bullet that restates a figure another bullet already carries. Where a mechanism and a single year's number are the same fact at two scales, keep the mechanism and fold the number into it.

However many bullets remain after consolidating is the right number. AIM FOR ABOUT SIX, but six is a TARGET, not a quota — the consolidation rules above decide the count, and the count is whatever they produce:
- Do NOT pad to reach six. A narrow bill that consolidates to three effects gets three bullets; splitting one effect in two to fill the list is worse than a short list.
- Do NOT drop, truncate, or compress away the bill's later substance to get down to six. If a genuine omnibus still has eight distinct subjects after every merge above, return eight. Losing what a bill does is a far worse outcome than a list one or two bullets longer than the target, and merging two things that are NOT the same fact makes both unreadable.
- Only stop merging when the remaining bullets are genuinely different facts. If two bullets can still merge under the rules above, merge them even if you are already at or below six.

Each bill text excerpt is prefixed with a bracketed anchor token like `[S1]`, `[S2]`. Add an entry to `key_point_citations` only for those key points that need verbatim proof — do NOT pair a citation to every bullet. Each entry's `point` repeats its key point verbatim, its `section_id` is the anchor token (e.g. `S3`) of the single excerpt it is most directly drawn from, and its `quote` is a short verbatim span (a phrase or sentence, at most ~30 words) copied exactly from that excerpt's text. Only use anchor tokens that actually appear in the supplied excerpts, and only quote text that appears verbatim there.

A `quote` must read as a finished quotation, because it is displayed on its own: quote a COMPLETE clause and end it at the source's own sentence-ending period. Never stop mid-clause on no punctuation at all (for example, never end at "consists of the following members"). Where you must cut the source short, end the quote with a single ellipsis character "…" and no other terminal mark — never three periods. Add no quotation marks of your own; the display supplies the quotation styling.

Also produce `question_prompts`: 3 to 4 short, natural questions a member of the public would ask about this bill, each fully answerable from the supplied bill text alone. Phrase them the way a curious reader would speak (for example "Who has to complete the training?" or "When do the new requirements take effect?"), not as yes/no or opinion questions. Never ask about anything the supplied text does not settle — votes, sponsors' motives, dollar costs, or real-world outcomes are off limits. Do NOT put the bill number in the question (the product attaches it). Keep each under about 12 words, neutral, and distinct from the others. If the text is too thin to support a specific question, return fewer rather than inventing one."""


SHORT_TITLE_SYSTEM_PROMPT = """You write short, neutral, plain-language titles for Minnesota bills for Alethical.

Return JSON matching the provided schema. Produce a single `short_title`: a neutral, descriptive headline in headline case, about 4-8 words and at most 70 characters, that states plainly what the bill does. Base it only on the supplied bill metadata. Do not editorialize, advocate, praise, or criticize; do not predict outcomes or impute motives. Keep it factual and neutral (for example "Paid Family and Medical Leave Program", not "Landmark Worker Protections")."""


@dataclass(frozen=True)
class ManifestItem:
    custom_id: str
    bill_id: str
    bill_key: str
    bill_version_id: str
    model: str
    source_version_hash: str


def supabase_database_url() -> str | None:
    return _supabase_database_url()


def json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def source_hash(parts: list[str]) -> str:
    digest = hashlib.sha256()
    for part in parts:
        digest.update(part.encode("utf-8"))
        digest.update(b"\0")
    return digest.hexdigest()


def current_bill_version(db: Session, bill_id: Any) -> Any | None:
    return db.scalar(
        select(BillVersion)
        .where(BillVersion.bill_id == bill_id)
        .order_by(BillVersion.is_current.desc(), BillVersion.sequence_number.desc())
        .limit(1)
    )


@dataclass(frozen=True)
class SectionAnchor:
    """One bill-text excerpt fed to the model, with the ordinal anchor token the
    model cites (`S1`, `S2`, …) and the `BillVersionSection.section_id_text` it
    resolves to (None when the excerpt has no linked section — then a key point
    citing it is unanchorable and gets dropped). #377."""

    anchor_id: str
    label: str
    text: str
    source_hash: str
    section_id_text: str | None


def _section_label(section: Any) -> str:
    return " ".join(
        item
        for item in [
            section.article_number,
            section.article_heading,
            section.section_heading or section.section_id_text,
        ]
        if item
    )


def section_anchors(db: Session, version: Any) -> list[SectionAnchor]:
    """Ordered bill-text excerpts for the prompt, each tagged with a stable
    ordinal anchor token. Deterministic ordering so the same list rebuilds at
    apply time and the `S#` tokens the model cited resolve back to sections."""
    rag_rows = db.execute(
        select(RagSectionDocument, BillVersionSection)
        .outerjoin(
            BillVersionSection,
            BillVersionSection.id == RagSectionDocument.bill_version_section_id,
        )
        .where(RagSectionDocument.bill_version_id == version.id)
        .order_by(
            BillVersionSection.source_order.asc().nulls_last(),
            RagSectionDocument.citation_label.asc(),
        )
    ).all()
    if rag_rows:
        return [
            SectionAnchor(
                anchor_id=f"S{index + 1}",
                label=row.citation_label,
                text=row.clean_text,
                source_hash=row.source_hash,
                section_id_text=(
                    section.section_id_text if section is not None else None
                ),
            )
            for index, (row, section) in enumerate(rag_rows)
        ]

    section_rows = db.scalars(
        select(BillVersionSection)
        .where(BillVersionSection.bill_version_id == version.id)
        .order_by(BillVersionSection.source_order.asc())
    ).all()
    return [
        SectionAnchor(
            anchor_id=f"S{index + 1}",
            label=_section_label(section),
            text=section.raw_text,
            source_hash=(
                section.source_hash
                or hashlib.sha256(section.raw_text.encode("utf-8")).hexdigest()
            ),
            section_id_text=section.section_id_text,
        )
        for index, section in enumerate(section_rows)
    ]


def chief_sponsor_names(bill: Any) -> list[str]:
    names: list[str] = []
    for sponsorship in sorted(bill.sponsorships, key=lambda item: item.source_order):
        if (
            sponsorship.role == schema.SponsorshipRole.chief_author
            and sponsorship.legislator is not None
        ):
            names.append(sponsorship.legislator.full_name)
    return names


def bill_prompt(
    db: Session, bill: Any, version: Any, *, max_input_chars: int
) -> tuple[str, str, bool]:
    sections = section_anchors(db, version)
    version_hash = source_hash(
        [bill.bill_key, str(version.id), *[item.source_hash for item in sections]]
    )
    metadata = {
        "bill_key": bill.bill_key,
        "title": bill.title,
        "description": bill.description,
        "current_status": bill.current_status,
        "latest_action_at": bill.latest_action_at.isoformat()
        if bill.latest_action_at
        else None,
        "chief_sponsors": chief_sponsor_names(bill),
        "official_url": bill.official_url,
        "version_code": version.version_code,
        "version_name": version.version_name,
    }

    remaining = max_input_chars
    text_blocks: list[str] = []
    for anchor in sections:
        block = f"[{anchor.anchor_id}] {anchor.label}\n{anchor.text.strip()}"
        if len(block) > remaining:
            if remaining > 500:
                text_blocks.append(block[:remaining])
            break
        text_blocks.append(block)
        remaining -= len(block)
    truncated = len(text_blocks) < len(sections)
    metadata["truncated_source"] = truncated
    metadata["included_section_count"] = len(text_blocks)
    metadata["total_section_count"] = len(sections)

    prompt = (
        "Analyze this Minnesota bill for a public-facing product. Produce neutral JSON only.\n\n"
        f"Bill metadata:\n{json.dumps(metadata, ensure_ascii=False, indent=2)}\n\n"
        "Bill text excerpts:\n" + "\n\n---\n\n".join(text_blocks)
    )
    return prompt, version_hash, truncated


def _normalize_for_match(value: str) -> str:
    return " ".join(value.split()).casefold()


def _quote_body(quote: str) -> str:
    """The part of a quote that must appear verbatim in the source section. The
    prompt asks for a closing "…" where the source was cut short, and that glyph
    is ours, not the bill's — so strip it (and any wrapping quote marks the model
    added anyway) before the grounding match, or every correctly-elided quote
    would fail verification and lose its citation.

    Only a pair the model added AROUND the excerpt is stripped. A statutory
    definition opens with the defined term in quotes ('"Child" means an individual
    …') and a list can close on one, so a pair whose interior holds another quote
    mark is the bill's own punctuation: stripping it left unbalanced quotes behind
    and swallowed the source's final period."""
    body = (quote or "").strip()
    for _ in range(2):
        stripped = re.fullmatch(r"[\"“'‘]([^\"“”'‘’]*)[\"”'’]", body, re.S)
        if not stripped:
            break
        body = stripped.group(1).strip()
    # Only an elision marker is stripped. A dot run attached to a dollar sign is
    # the bill's own blank-fill for an amount it left undecided ("appropriated:
    # $......."), and a run after a space is a table leader — both are source text.
    # (A preceding dot blocks the match too, or the engine would just start one dot
    # later and eat the rest of a blank-fill run.)
    return re.sub(r"(?:…|(?<![$\d\s.])\.{3,})\s*$", "", body).strip()


def _chip_topic(raw: str) -> str:
    """Short sentence-case topic from a section's own statutory heading:
    "TRANSFER." -> "Transfer". Only re-cases and trims — never re-authors, so the
    chip can never claim something the heading did not say.

    Delegates to `section_chip_topic`, the one implementation of this rule, which
    the detail endpoint also uses to fill a chip's topic in at request time. This
    used to be a second, weaker copy: it cut the heading off mid-word at 40
    characters and never split a compound heading, so it wrote 2,033 stored labels
    reading "Sec. 1 · Wright technical center; capital improv…" where the
    request-time path reads the same heading as "Wright technical center". Two
    implementations of one display rule is what let them drift."""
    return section_chip_topic(raw, None)


def _chip_label(anchor: SectionAnchor) -> str:
    """Citation-chip label in the product's one canonical format:

        Sec. 4 · License classes          (heading present)
        Art. 1, Sec. 2 · Appropriations   (article-structured / omnibus bill)
        Sec. 14                           (no usable heading — number alone)

    Built from the curated `anchor.label` ("SF 334, Sec. 2." / "SF 334, Section
    1." / "SF 334, Sec. 14. TRANSFER."). The bill code is dropped — the chip only
    ever renders on that bill's own page, where the code already sits in the rail
    badge — "Section" always abbreviates to "Sec.", and there is no terminal
    period, because a chip is a label and not a sentence. Never exposes the
    internal `section_id_text` key (e.g. "laws.0.1.0"), which is not
    human-readable.

    The frontend mirrors this in `citationChipLabel`
    (apps/frontend/src/lib/billDetail.ts) so bills enriched before this change
    still display the canonical shape; that cleaner no-ops on this output."""
    label = (anchor.label or "").strip()
    if not label:
        return "Cited section"

    # Drop a leading bill code ("SF 334, " / "H.F. No. 12 — ").
    label = re.sub(
        r"^\s*(?:h\.?\s?f\.?|s\.?\s?f\.?|h\.?\s?r\.?|s\.?\s?r\.?)"
        r"\s*(?:no\.?\s*)?\d+\s*[,:—-]?\s*",
        "",
        label,
        flags=re.IGNORECASE,
    )

    # Article prefix on an article-structured bill: "ARTICLE 1," -> "Art. 1, ".
    prefix = ""
    article = re.match(r"^\s*art(?:icle)?\.?\s+([\w.]+?)\.?\s*[,:]?\s*", label, re.I)
    if article:
        prefix = f"Art. {article.group(1)}, "
        label = label[article.end() :]
        # An article HEADING can sit between the article number and the section
        # ("ARTICLE 1, EDUCATION FINANCE, Sec. 2. …") — drop it; the section's
        # own heading is the topic we show.
        section_at = re.search(r"\bsec(?:tion)?\.?\s+[\w.\-]", label, re.I)
        if section_at and section_at.start() > 0:
            label = label[section_at.start() :]

    section = re.match(
        r"^\s*sec(?:tion)?\.?\s+([\w.\-]+?)\.?(?:\s+(.*))?$", label, re.S | re.I
    )
    if not section:
        # Not a recognizable "Sec. N" label — pass it through, minus a trailing
        # period, truncating only if it would overflow the pill.
        fallback = f"{prefix}{label.rstrip('. ')}".strip()
        return fallback if len(fallback) <= 48 else fallback[:47].rstrip() + "…"

    number = f"{prefix}Sec. {section.group(1)}"
    topic = _chip_topic(section.group(2) or "")
    # No dangling middot when a section has no usable heading.
    return f"{number} · {topic}" if topic else number


def resolve_key_point_citations(
    db: Session, version_id: uuid.UUID, content: dict[str, Any]
) -> dict[str, int]:
    """Ground the model's `key_point_citations` against the bill's sections
    (grounded-answers rules 1 & 4): keep only citations whose `section_id` is a
    real supplied anchor that resolves to a `BillVersionSection` AND whose
    `quote` appears verbatim in that excerpt. Rewrites content in place so each
    surviving citation carries the resolved `section_id` (the section identifier)
    plus a display `label`. `key_points` is left intact — an unanchorable point
    is shown without a citation marker (flagged, never invented), not dropped, so
    the summary stays complete. Returns {points, anchored, dropped}, where
    anchored/dropped count key points that did / didn't get a citation."""
    raw = content.get("key_point_citations")
    original_points = [
        item for item in (content.get("key_points") or []) if isinstance(item, str)
    ]
    if not isinstance(raw, list):
        raw = []

    version = db.get(BillVersion, version_id)
    anchors = {a.anchor_id: a for a in section_anchors(db, version)} if version else {}

    resolved: list[dict[str, Any]] = []
    anchored_points: list[str] = []
    seen_points: set[str] = set()
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        point = entry.get("point")
        section_id = entry.get("section_id")
        quote = entry.get("quote")
        if not (
            isinstance(point, str)
            and isinstance(section_id, str)
            and isinstance(quote, str)
            and point.strip()
            and quote.strip()
        ):
            continue
        anchor = anchors.get(section_id.strip())
        if anchor is None or not anchor.section_id_text:
            continue
        body = _quote_body(quote)
        if not body or _normalize_for_match(body) not in _normalize_for_match(
            anchor.text
        ):
            continue
        # Store the quote without the model's own wrapping quote marks (the
        # display supplies the quotation styling) and never unpunctuated: a
        # complete clause keeps the source's terminal mark, and anything cut
        # short closes with the single "…" glyph, because a quote that just stops
        # reads as a rendering bug rather than a quotation.
        # A closing quote mark can sit after the terminal period ('… or "Tribal
        # governments."'), so look past one before deciding the quote was cut off.
        stored = (
            body if re.search(r"[.!?][\"”'’]?$", body) else f"{body.rstrip(',;:-—– ')}…"
        )
        resolved.append(
            {
                "point": point.strip(),
                "section_id": anchor.section_id_text,
                "label": _chip_label(anchor),
                "quote": stored,
            }
        )
        if point.strip() not in seen_points:
            seen_points.add(point.strip())
            anchored_points.append(point.strip())

    content["key_point_citations"] = resolved
    # Leave key_points untouched: an unanchorable point still displays, just
    # without a citation chip (flagged, never invented). Only the anchorable
    # subset carries a resolved citation.
    return {
        "points": len(original_points),
        "anchored": len(seen_points),
        "dropped": len(original_points) - len(seen_points),
    }


@dataclass(frozen=True)
class CitedSectionCandidate:
    """One section a stored citation's `section_id` could be naming.

    `source_order` is the section's position, the only value that identifies it.
    `label` and `text` are the two things a stored citation kept a copy of, and are
    what `resolve_cited_section` matches back against."""

    source_order: int
    label: str | None
    text: str | None


def resolve_cited_section(
    candidates: list[CitedSectionCandidate], label: str, quote: str
) -> CitedSectionCandidate | None:
    """Which section a stored citation was grounded against, or None.

    A stored citation records the section's `section_id_text`, and that does not
    identify a section: `laws.0.1.0` is the id the Revisor hands every section
    sitting outside an article, so 66 current versions repeat one id across as many
    as 30 sections (#763). The position was never stored, so the citation's own two
    copies of its source are what recover it:

    * the `quote`, which `resolve_key_point_citations` above only kept after
      checking it appears VERBATIM in that one section's text — so a candidate
      whose text does not contain it is not the section, and usually exactly one
      does. Measured over every affected citation in production: 88 of 95.
    * the `label`, which is a deterministic function of the section's own heading
      (`_chip_label`, or the raw `citation_label` on a bill enriched before that
      existed). It breaks the tie on the 7 whose quote is boilerplate a bill repeats
      section for section ("This section is effective August 1, 2026."), settling 6
      of them.

    One citation in production resolves to neither, and the honest answer there is
    None: the caller keeps the reader's jump landing on the first section carrying
    the id, but claims nothing about which section a key point came from — the same
    refusal #853 made for the chip's caption (.claude/rules/grounded-answers.md
    rule 1)."""
    if len(candidates) == 1:
        return candidates[0]
    body = _quote_body(quote or "")
    needle = _normalize_for_match(body) if body else ""
    by_quote = [
        candidate
        for candidate in candidates
        if needle and needle in _normalize_for_match(candidate.text or "")
    ]
    if len(by_quote) == 1:
        return by_quote[0]
    wanted = (label or "").strip()
    by_label = [
        candidate
        for candidate in (by_quote or candidates)
        if wanted
        and wanted
        in (
            (candidate.label or "").strip(),
            _chip_label(SectionAnchor("", candidate.label or "", "", "", None)),
        )
    ]
    return by_label[0] if len(by_label) == 1 else None


def bills_for_batch(
    db: Session, *, session_slug: str | None, bill_key: str | None, limit: int | None
) -> list[Any]:
    stmt = select(Bill).options(
        selectinload(Bill.sponsorships).selectinload(Sponsorship.legislator),
        selectinload(Bill.enrichments),
    )
    if session_slug:
        stmt = stmt.join(
            LegislativeSession, LegislativeSession.id == Bill.session_id
        ).where(LegislativeSession.slug == session_slug)
    if bill_key:
        stmt = stmt.where(Bill.bill_key == bill_key)
    stmt = stmt.order_by(Bill.bill_key.asc())
    if limit:
        stmt = stmt.limit(limit)
    return list(db.scalars(stmt).unique().all())


def should_enqueue(bill: Any, model: str, version_hash: str, *, force: bool) -> bool:
    if force:
        return True
    for enrichment in bill.enrichments:
        if (
            enrichment.enrichment_type == EnrichmentType.bill_summary
            and enrichment.model_name == model
            and enrichment.source_version_hash == version_hash
            and enrichment.is_current
        ):
            return False
    return True


def has_current_summary(bill: Any, model: str) -> bool:
    for enrichment in bill.enrichments:
        if (
            enrichment.enrichment_type == EnrichmentType.bill_summary
            and enrichment.model_name == model
            and enrichment.is_current
        ):
            return True
    return False


def batch_request(custom_id: str, model: str, prompt: str) -> dict[str, Any]:
    return {
        "custom_id": custom_id,
        "method": "POST",
        "url": "/v1/responses",
        "body": {
            "model": model,
            "input": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "bill_summary",
                    "description": "Neutral public-facing bill analysis for Alethical.",
                    "strict": True,
                    "schema": SUMMARY_SCHEMA,
                }
            },
            "max_output_tokens": 2400,
        },
    }


def current_summary_content(bill: Any) -> dict[str, Any] | None:
    """Return the content_json of the bill's current bill_summary enrichment, or
    None when there is nothing to patch a short_title into."""
    for enrichment in bill.enrichments:
        if (
            enrichment.enrichment_type == EnrichmentType.bill_summary
            and enrichment.is_current
        ):
            return enrichment.content_json or {}
    return None


def current_key_point_count(bill: Any) -> int | None:
    """How many `key_points` the bill's CURRENT bill_summary carries, or None when
    it has no current summary (or one with no key-point array). Model-agnostic on
    purpose: this screens on what the bill *displays today*, not on which model
    produced it. Used by `prepare --min-key-points` to re-run only the bills whose
    lists the consolidation rule (#722/#725) would shorten (#723)."""
    content = current_summary_content(bill)
    if content is None:
        return None
    points = content.get("key_points")
    return len(points) if isinstance(points, list) else None


def short_title_prompt(bill: Any) -> tuple[str, str]:
    metadata = {
        "bill_key": bill.bill_key,
        "title": bill.title,
        "description": bill.description,
        "current_status": bill.current_status,
    }
    version_hash = source_hash(
        [
            bill.bill_key,
            bill.title or "",
            bill.description or "",
            bill.current_status or "",
        ]
    )
    prompt = (
        "Write one neutral, plain-language short_title for this Minnesota bill. "
        "Return JSON only.\n\n"
        f"Bill metadata:\n{json.dumps(metadata, ensure_ascii=False, indent=2)}"
    )
    return prompt, version_hash


def short_title_batch_request(
    custom_id: str, model: str, prompt: str
) -> dict[str, Any]:
    return {
        "custom_id": custom_id,
        "method": "POST",
        "url": "/v1/responses",
        "body": {
            "model": model,
            "input": [
                {"role": "system", "content": SHORT_TITLE_SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "bill_short_title",
                    "description": "Neutral plain-language short title for a Minnesota bill.",
                    "strict": True,
                    "schema": SHORT_TITLE_SCHEMA,
                }
            },
            "max_output_tokens": 120,
        },
    }


def prepare_batch(args: argparse.Namespace) -> None:
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    database_url = normalize_database_url(
        args.database_url
        or "postgresql+psycopg://alethical:alethical@localhost:54329/alethical"
    )
    engine = create_engine(
        database_url, pool_pre_ping=True, connect_args=NO_PREPARED_STATEMENTS
    )

    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    jsonl_path = output_dir / f"ai-enrichment-{timestamp}.jsonl"
    manifest_path = output_dir / f"ai-enrichment-{timestamp}.manifest.json"

    titles_only = getattr(args, "titles_only", False)
    # Title-only always runs on the cheap metadata model; the full path honors --model.
    model = TITLE_MODEL if titles_only else args.model
    mode = "titles_only" if titles_only else "full"

    manifest: list[ManifestItem] = []
    bytes_written = 0
    pending_custom_ids = (
        pending_manifest_custom_ids(output_dir, model=model)
        if not args.force
        else set()
    )
    skipped_pending = 0
    skipped_existing_current = 0
    skipped_existing_title = 0
    skipped_no_summary = 0
    skipped_key_points_below = 0
    min_key_points = getattr(args, "min_key_points", None)
    with Session(engine) as db, jsonl_path.open("w", encoding="utf-8") as handle:
        for bill in bills_for_batch(
            db, session_slug=args.session, bill_key=args.bill_key, limit=args.limit
        ):
            if min_key_points is not None:
                # Screen on the bill's CURRENT key-point count. A bill with no
                # current summary has nothing to re-consolidate, so it is skipped
                # too rather than treated as zero.
                count = current_key_point_count(bill)
                if count is None or count < min_key_points:
                    skipped_key_points_below += 1
                    continue
            if (
                not titles_only
                and getattr(args, "only_missing_current", False)
                and has_current_summary(bill, model)
            ):
                skipped_existing_current += 1
                continue
            version = current_bill_version(db, bill.id)
            if version is None:
                continue
            if titles_only:
                # The title backfill patches an existing bill_summary; skip bills
                # with none to patch, and skip bills that already carry a
                # short_title unless --force (caching, keyed per bill).
                content = current_summary_content(bill)
                if content is None:
                    skipped_no_summary += 1
                    continue
                existing_title = content.get("short_title")
                if (
                    not args.force
                    and isinstance(existing_title, str)
                    and existing_title.strip()
                ):
                    skipped_existing_title += 1
                    continue
                prompt, version_hash = short_title_prompt(bill)
                custom_id = f"bill_title:{bill.bill_key}:{version_hash[:16]}"
                request = short_title_batch_request(custom_id, model, prompt)
            else:
                prompt, version_hash, _truncated = bill_prompt(
                    db, bill, version, max_input_chars=args.max_input_chars
                )
                if not should_enqueue(bill, model, version_hash, force=args.force):
                    continue
                custom_id = f"bill_summary:{bill.bill_key}:{version_hash[:16]}"
                request = batch_request(custom_id, model, prompt)
            if custom_id in pending_custom_ids:
                skipped_pending += 1
                continue
            line = json_dumps(request) + "\n"
            bytes_written += len(line.encode("utf-8"))
            if len(manifest) + 1 > MAX_BATCH_REQUESTS:
                raise SystemExit(f"Batch request limit exceeded: {MAX_BATCH_REQUESTS}")
            if bytes_written > MAX_BATCH_FILE_BYTES:
                raise SystemExit(
                    f"Batch file size limit exceeded: {MAX_BATCH_FILE_BYTES} bytes"
                )
            handle.write(line)
            manifest.append(
                ManifestItem(
                    custom_id=custom_id,
                    bill_id=str(bill.id),
                    bill_key=bill.bill_key,
                    bill_version_id=str(version.id),
                    model=model,
                    source_version_hash=version_hash,
                )
            )

    manifest_path.write_text(
        json.dumps(
            {
                "created_at": timestamp,
                "endpoint": "/v1/responses",
                "mode": mode,
                "jsonl_path": str(jsonl_path),
                "model": model,
                "items": [asdict(item) for item in manifest],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "mode": mode,
                "model": model,
                "requests": len(manifest),
                "skipped_pending": skipped_pending,
                "skipped_existing_current": skipped_existing_current,
                "skipped_existing_title": skipped_existing_title,
                "skipped_no_summary": skipped_no_summary,
                "skipped_key_points_below": skipped_key_points_below,
                "jsonl_path": str(jsonl_path),
                "manifest_path": str(manifest_path),
            },
            indent=2,
        )
    )


def openai_headers(api_key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {api_key}"}


def submit_batch(args: argparse.Namespace) -> None:
    api_key = args.api_key or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise SystemExit("OPENAI_API_KEY is required")
    jsonl_path = Path(args.jsonl_path)
    with jsonl_path.open("rb") as handle:
        file_response = requests.post(
            f"{OPENAI_API_BASE}/files",
            headers=openai_headers(api_key),
            files={"file": (jsonl_path.name, handle, "application/jsonl")},
            data={"purpose": "batch"},
            timeout=120,
        )
    file_response.raise_for_status()
    input_file_id = file_response.json()["id"]

    batch_response = requests.post(
        f"{OPENAI_API_BASE}/batches",
        headers={**openai_headers(api_key), "Content-Type": "application/json"},
        json={
            "input_file_id": input_file_id,
            "endpoint": "/v1/responses",
            "completion_window": "24h",
            "metadata": {"job": "alethical_ai_enrichment", "input": jsonl_path.name},
        },
        timeout=120,
    )
    batch_response.raise_for_status()
    print(json.dumps(batch_response.json(), indent=2))


def batch_status(args: argparse.Namespace) -> None:
    api_key = args.api_key or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise SystemExit("OPENAI_API_KEY is required")
    response = requests.get(
        f"{OPENAI_API_BASE}/batches/{args.batch_id}",
        headers=openai_headers(api_key),
        timeout=60,
    )
    response.raise_for_status()
    print(json.dumps(response.json(), indent=2))


def download_batch_output(api_key: str, batch_id: str, output_path: Path) -> None:
    batch_response = requests.get(
        f"{OPENAI_API_BASE}/batches/{batch_id}",
        headers=openai_headers(api_key),
        timeout=60,
    )
    batch_response.raise_for_status()
    batch = batch_response.json()
    if batch.get("status") != "completed":
        raise SystemExit(
            f"Batch is {batch.get('status')}; output is available only after completion"
        )
    output_file_id = batch.get("output_file_id")
    if not output_file_id:
        raise SystemExit("Completed batch has no output_file_id")
    file_response = requests.get(
        f"{OPENAI_API_BASE}/files/{output_file_id}/content",
        headers=openai_headers(api_key),
        timeout=120,
    )
    file_response.raise_for_status()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(file_response.text, encoding="utf-8")


def extract_response_text(body: dict[str, Any]) -> str:
    if isinstance(body.get("output_text"), str):
        return body["output_text"]
    fragments: list[str] = []
    for item in body.get("output", []) or []:
        for content in item.get("content", []) or []:
            if isinstance(content.get("text"), str):
                fragments.append(content["text"])
    return "".join(fragments).strip()


def load_manifest(path: Path) -> tuple[str, dict[str, ManifestItem]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    mode = payload.get("mode", "full")
    items = {item["custom_id"]: ManifestItem(**item) for item in payload["items"]}
    return mode, items


def pending_manifest_custom_ids(
    output_dir: Path, *, model: str | None = None
) -> set[str]:
    custom_ids: set[str] = set()
    for path in output_dir.glob("ai-enrichment-*.manifest.json"):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        for item in payload.get("items", []):
            if model is not None and item.get("model") != model:
                continue
            custom_id = item.get("custom_id")
            if isinstance(custom_id, str):
                custom_ids.add(custom_id)
    return custom_ids


def apply_output(args: argparse.Namespace) -> None:
    api_key = args.api_key or os.environ.get("OPENAI_API_KEY")
    output_path = Path(args.output_path) if args.output_path else None
    if args.batch_id:
        if not api_key:
            raise SystemExit(
                "OPENAI_API_KEY is required when downloading output by batch id"
            )
        output_path = (
            output_path or Path(args.output_dir) / f"{args.batch_id}.output.jsonl"
        )
        download_batch_output(api_key, args.batch_id, output_path)
    if output_path is None:
        raise SystemExit("--output-path or --batch-id is required")

    mode, manifest = load_manifest(Path(args.manifest_path))
    merge = mode == "titles_only"
    database_url = normalize_database_url(
        args.database_url
        or "postgresql+psycopg://alethical:alethical@localhost:54329/alethical"
    )
    engine = create_engine(
        database_url, pool_pre_ping=True, connect_args=NO_PREPARED_STATEMENTS
    )
    applied = 0
    failed = 0
    citation_points = 0
    citation_anchored = 0
    with Session(engine) as db:
        for line in output_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            custom_id = row.get("custom_id")
            item = manifest.get(custom_id)
            if item is None:
                failed += 1
                continue
            response = row.get("response") or {}
            if response.get("status_code") != 200:
                failed += 1
                continue
            text = extract_response_text(response.get("body") or {})
            try:
                content = json.loads(text)
            except json.JSONDecodeError:
                failed += 1
                continue
            bill_id = uuid.UUID(item.bill_id)

            if merge:
                # Title-only merge: patch short_title into the bill's current
                # bill_summary content_json without clobbering the other fields
                # or touching is_current. Skip bills with no current summary.
                new_title = (
                    content.get("short_title") if isinstance(content, dict) else None
                )
                if not isinstance(new_title, str) or not new_title.strip():
                    failed += 1
                    continue
                existing = db.scalar(
                    select(AIEnrichment).where(
                        AIEnrichment.bill_id == bill_id,
                        AIEnrichment.enrichment_type == EnrichmentType.bill_summary,
                        AIEnrichment.is_current.is_(True),
                    )
                )
                if existing is None:
                    failed += 1
                    continue
                # Reassign content_json (rather than mutating in place) so
                # SQLAlchemy detects the JSONB change.
                patched = dict(existing.content_json or {})
                patched["short_title"] = new_title.strip()
                meta = dict(patched.get("_meta") or {})
                meta["short_title_model"] = item.model
                if args.batch_id:
                    meta["short_title_openai_batch_id"] = args.batch_id
                patched["_meta"] = meta
                existing.content_json = patched
                applied += 1
                continue

            bill_version_id = uuid.UUID(item.bill_version_id)
            # Ground per-key-point citations against the bill's sections before
            # persisting (#377): unanchorable points are dropped, never invented.
            stats = resolve_key_point_citations(db, bill_version_id, content)
            citation_points += stats["points"]
            citation_anchored += stats["anchored"]

            content["_meta"] = {
                "model": item.model,
                "source_version_hash": item.source_version_hash,
                "openai_batch_id": args.batch_id,
            }

            db.execute(
                update(AIEnrichment)
                .where(
                    AIEnrichment.bill_id == bill_id,
                    AIEnrichment.enrichment_type == EnrichmentType.bill_summary,
                    AIEnrichment.is_current.is_(True),
                )
                .values(is_current=False)
            )
            existing = db.scalar(
                select(AIEnrichment).where(
                    AIEnrichment.bill_id == bill_id,
                    AIEnrichment.bill_version_id == bill_version_id,
                    AIEnrichment.enrichment_type == EnrichmentType.bill_summary,
                    AIEnrichment.model_name == item.model,
                    AIEnrichment.source_version_hash == item.source_version_hash,
                )
            )
            if existing is None:
                existing = AIEnrichment(
                    bill_id=bill_id,
                    bill_version_id=bill_version_id,
                    enrichment_type=EnrichmentType.bill_summary,
                    model_name=item.model,
                    source_version_hash=item.source_version_hash,
                    content_json=content,
                    is_current=True,
                )
                db.add(existing)
            else:
                existing.content_json = content
                existing.is_current = True
            applied += 1
        if args.dry_run:
            db.rollback()
        else:
            db.commit()
            # Policy areas just changed, so refresh the precomputed /policy-areas
            # issue-chip counts (#501) that the endpoint reads instead of the live
            # ~278ms rollup. Zero-cost -- derived from the enrichments we just wrote.
            from alethical.pipeline.policy_area_counts import refresh_all_counts

            refresh_all_counts(db)
            db.commit()
    summary: dict[str, Any] = {
        "applied": applied,
        "failed": failed,
        "dry_run": args.dry_run,
    }
    if not merge:
        summary["key_points"] = citation_points
        summary["key_points_anchored"] = citation_anchored
    print(json.dumps(summary, indent=2))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Prepare, submit, and apply OpenAI Batch API bill AI enrichments."
    )
    parser.add_argument(
        "--database-url",
        default=os.environ.get("DATABASE_URL")
        or supabase_database_url()
        or get_database_url(),
    )
    parser.add_argument("--api-key", default=None)
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    subparsers = parser.add_subparsers(dest="command", required=True)

    prepare = subparsers.add_parser(
        "prepare", help="Build a Batch API JSONL file and local manifest."
    )
    prepare.add_argument(
        "--model", default=os.environ.get("OPENAI_AI_ENRICHMENT_MODEL", DEFAULT_MODEL)
    )
    prepare.add_argument("--session", default=CURRENT_SESSION_SLUG)
    prepare.add_argument("--bill-key", default=None)
    prepare.add_argument("--limit", type=int, default=None)
    prepare.add_argument("--max-input-chars", type=int, default=60_000)
    prepare.add_argument("--force", action="store_true")
    prepare.add_argument("--only-missing-current", action="store_true")
    prepare.add_argument(
        "--min-key-points",
        type=int,
        default=None,
        help=(
            "Only include bills whose CURRENT bill_summary carries at least N "
            "key points (any model). The screen for a re-consolidation run: "
            "--min-key-points 7 selects exactly the bills showing more than six "
            "(#723). Bills with no current summary are skipped."
        ),
    )
    prepare.add_argument(
        "--titles-only",
        action="store_true",
        help=(
            "Generate only a neutral short_title from bill metadata (pinned to "
            f"{TITLE_MODEL}); apply merges it into the existing bill_summary."
        ),
    )
    prepare.set_defaults(func=prepare_batch)

    submit = subparsers.add_parser(
        "submit", help="Upload a JSONL file and create an OpenAI batch."
    )
    submit.add_argument("jsonl_path")
    submit.set_defaults(func=submit_batch)

    status = subparsers.add_parser("status", help="Retrieve an OpenAI batch status.")
    status.add_argument("batch_id")
    status.set_defaults(func=batch_status)

    apply = subparsers.add_parser(
        "apply", help="Download or read batch output and upsert ai_enrichment rows."
    )
    apply.add_argument("--manifest-path", required=True)
    apply.add_argument("--batch-id", default=None)
    apply.add_argument("--output-path", default=None)
    apply.add_argument("--dry-run", action="store_true")
    apply.set_defaults(func=apply_output)
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    if not args.database_url:
        raise SystemExit("DATABASE_URL or Supabase env vars are required")
    args.func(args)


if __name__ == "__main__":
    main()
