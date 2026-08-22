#!/usr/bin/env python3
"""Check the 27 repaired bills' official pages without calling any model (#457).

This is a release gate for the saved-context parser and prompt formatter. It
downloads only fixed Minnesota Revisor bill-version pages, saves the parsed legal
roles in a rolled-back local database savepoint, reloads them, and refuses any
missing role, changed reference count, or input over the approved ceilings.

It never reads or writes production data and never calls Anthropic or OpenAI.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import uuid
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

import requests
from sqlalchemy import create_engine, func, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from alethical.db import models as schema
from alethical.db.session import (
    NO_PREPARED_STATEMENTS,
    database_url_for_target,
    normalize_database_url,
)
from alethical.pipeline.ai_enrichment import (
    APPENDIX_TEXT_CHAR_LIMIT,
    APPENDIX_WARNING,
    CHANGE_ROLE_WARNING,
    COMBINED_TEXT_CHAR_LIMIT,
    PROPOSED_TEXT_CHAR_LIMIT,
    WHOLE_REQUEST_CHAR_LIMIT,
    AppendixAnchor,
    SectionAnchor,
    _change_role_hash,
    appendix_anchors,
    bill_prompt,
    bill_prompt_measurement,
    section_anchors,
)
from alethical.pipeline.bill_summary_requests import (
    canonical_source_text_fingerprint,
)
from alethical.pipeline.minnesota import (
    parse_bill_text_html,
    replace_bill_version_prompt_context,
)


# Fixed official version pages from the exact 27-bill section-repair incident.
# A later official version is a different source and must not silently replace
# one of these inputs in this regression check.
COHORT: dict[str, tuple[str, int, int, bool, str]] = {
    "94-2025-HF1058": (
        "https://www.revisor.mn.gov/bills/94/2025/0/HF/1058/versions/1/",
        10,
        0,
        False,
        "f333077916cb7abbe325c1cef4d5dd4b0f1250515a234a9d529667ad2f384d1d",
    ),
    "94-2025-HF1435": (
        "https://www.revisor.mn.gov/bills/94/2025/0/HF/1435/versions/1/",
        6,
        1,
        True,
        "66f15e13a0461f02177d8399b907f45b7f32165f673f559129e6b54cd77ed118",
    ),
    "94-2025-HF1837": (
        "https://www.revisor.mn.gov/bills/94/2025/0/HF/1837/versions/1/",
        79,
        12,
        True,
        "3d9fbb4a4ef12a02a1153afd5988816d27d0f5a454c4fd1bb0f592c8ffa9ecd3",
    ),
    "94-2025-HF2115": (
        "https://www.revisor.mn.gov/bills/94/2025/0/HF/2115/versions/3/",
        331,
        13,
        True,
        "3b2454749e6aa34171ccd3d6acf1887308c3cd023981144a17c51f604f75c3a6",
    ),
    "94-2025-HF2434": (
        "https://www.revisor.mn.gov/bills/94/2025/0/HF/2434/versions/ue/1/",
        338,
        32,
        True,
        "3e171628119f5bd729ae6ef051f6bd9b4cd6fa796467d3846c618128636879c2",
    ),
    "94-2025-SF2443": (
        "https://www.revisor.mn.gov/bills/94/2025/0/SF/2443/versions/1/",
        168,
        8,
        True,
        "d42846bccffa0f86a7c296d732abf4c3cd24f509ab231dde0cf4f60de16badeb",
    ),
    "94-2025-SF3045": (
        "https://www.revisor.mn.gov/bills/94/2025/0/SF/3045/versions/4/",
        316,
        5,
        True,
        "cb0f18e5051be95c41a478c4162c49ef9c06b73cf8194fd59c510344d4c836b9",
    ),
    "94-2025-SF3054": (
        "https://www.revisor.mn.gov/bills/94/2025/0/SF/3054/versions/2/",
        325,
        30,
        True,
        "1181b254ce10a39645bb92fcc48097c5fdcc1a866216340481e14758b603f92a",
    ),
    "94-2025-SF626": (
        "https://www.revisor.mn.gov/bills/94/2025/0/SF/626/versions/2/",
        66,
        16,
        True,
        "5e94260e218179c827389dd33348a756a26751cf22fbc8a3b2f497045e052f83",
    ),
    "94-2025s1-HF3": (
        "https://www.revisor.mn.gov/bills/94/2025/1/HF/3/versions/0/",
        313,
        17,
        True,
        "4c500574aab18772b717231386586197ab3dc49b28a893c5ba11ac0f774314ec",
    ),
    "94-2025s1-SF7": (
        "https://www.revisor.mn.gov/bills/94/2025/1/SF/7/versions/0/",
        313,
        17,
        True,
        "b6c0731d478adf84910b04e6587bf36255050bc9faa2661b2528b61ba156eb59",
    ),
    "94-2025s1-SF9": (
        "https://www.revisor.mn.gov/bills/94/2025/1/SF/9/versions/1/",
        14,
        0,
        False,
        "7d462ac37885f2eeb839db2608b3ca79ca1466e81f0b9a0aa38121ad80da63c1",
    ),
    "94-2026-HF3830": (
        "https://www.revisor.mn.gov/bills/94/2026/0/HF/3830/versions/0/",
        2,
        1,
        True,
        "7cce1eba13b05031017c957aa3a773081bc0268860fb19c3f1c0ae1691b63884",
    ),
    "94-2026-HF3969": (
        "https://www.revisor.mn.gov/bills/94/2026/0/HF/3969/versions/0/",
        1,
        1,
        True,
        "bee927715028aa826793c73d760e8933e0c7ae1cdba2e9cdc903ccbc96562d59",
    ),
    "94-2026-HF4057": (
        "https://www.revisor.mn.gov/bills/94/2026/0/HF/4057/versions/0/",
        237,
        37,
        True,
        "12dd618ecbaf03a5c0bf2571a0fdacc5c2317b69ce1704d28f87ac49012fe3a8",
    ),
    "94-2026-HF4407": (
        "https://www.revisor.mn.gov/bills/94/2026/0/HF/4407/versions/0/",
        26,
        1,
        True,
        "39ab40740372f1e71f74484c38342b08b706a0af97f75b03ddd1aa47a1ff8938",
    ),
    "94-2026-HF4430": (
        "https://www.revisor.mn.gov/bills/94/2026/0/HF/4430/versions/0/",
        38,
        2,
        True,
        "f81f108eac2e76c2151bf21ce70c89227aece0ff6560b1fe9bb25535f592de3e",
    ),
    "94-2026-HF4441": (
        "https://www.revisor.mn.gov/bills/94/2026/0/HF/4441/versions/0/",
        1,
        9,
        True,
        "202257eff2e6e03e6b4e91348dc0dee159b0be33ed06a143321ec848d853fef3",
    ),
    "94-2026-HF4935": (
        "https://www.revisor.mn.gov/bills/94/2026/0/HF/4935/versions/0/",
        31,
        1,
        True,
        "57e4bdf9e3bec1089ab73399d99bba6926cab9a08b1921c1adfec45a5dd14f10",
    ),
    "94-2026-HF5125": (
        "https://www.revisor.mn.gov/bills/94/2026/0/HF/5125/versions/0/",
        6,
        2,
        True,
        "f1bbc898cfea9e631022c3678704e503b6c5d37c08cdfb26121b26954814a0c7",
    ),
    "94-2026-SF3755": (
        "https://www.revisor.mn.gov/bills/94/2026/0/SF/3755/versions/2/",
        12,
        2,
        True,
        "5460f13ca30de211ae00bb9e70ec6b0c10ebc680fbc63e8422f2f788b475c9b2",
    ),
    "94-2026-SF3909": (
        "https://www.revisor.mn.gov/bills/94/2026/0/SF/3909/versions/0/",
        1,
        1,
        True,
        "bed9937bd4059ba913b42130dea60137b7037486b6df19ea8d3818baf9454f92",
    ),
    "94-2026-SF3954": (
        "https://www.revisor.mn.gov/bills/94/2026/0/SF/3954/versions/0/",
        2,
        1,
        True,
        "4c1241419de14ecbdd36ae1d260337df72c685aa33bfd94fa1497309497cc70c",
    ),
    "94-2026-SF4184": (
        "https://www.revisor.mn.gov/bills/94/2026/0/SF/4184/versions/0/",
        1,
        9,
        True,
        "d5f55cc54c6627e75e21afd69893b06d4723ee9a9eb7477a722e4184dbddf5de",
    ),
    "94-2026-SF4217": (
        "https://www.revisor.mn.gov/bills/94/2026/0/SF/4217/versions/0/",
        38,
        2,
        True,
        "eec219419918663bb4accb54a2b807bf82237a4d8d10caab502c895485588c81",
    ),
    "94-2026-SF4244": (
        "https://www.revisor.mn.gov/bills/94/2026/0/SF/4244/versions/0/",
        237,
        37,
        True,
        "2cb74961978851d68c7f64a6bb8b5f9f8681dcb8f0558030f147dcdab7f714d4",
    ),
    "94-2026-SF5231": (
        "https://www.revisor.mn.gov/bills/94/2026/0/SF/5231/versions/0/",
        6,
        2,
        True,
        "2bd5623f39e2a1acd8e0d04460ed0a4f4a3fac85225fda1d74e261de7e6396ff",
    ),
}

EXPECTED_TOTALS = {
    "proposed_prompt_references": 2_918,
    "appendix_prompt_references": 259,
    "appendix_statute_prompt_references": 182,
    "appendix_session_law_prompt_references": 75,
    "appendix_rule_prompt_references": 2,
    "appendix_raw_official_slots": 556,
    "appendix_legal_source_blocks": 553,
    "statute_legal_source_bodies": 476,
    "statute_subdivision_source_bodies": 451,
    "statute_unsubdivided_legal_source_bodies": 25,
    "statute_empty_notice_slots": 3,
    "session_law_source_blocks": 75,
    "session_law_nested_subdivision_bodies": 166,
    "appendix_literal_subdivision_bodies": 617,
    "rule_part_source_blocks": 2,
}
SF3755_ADDED = "publish the text of all public comments on the agency's website and"
SF3755_CARRIED_DUTIES = (
    "at least 30 days before submitting a new Medicaid waiver request",
    "publish the text of the waiver request or state plan amendment",
    "provide a 30-day public comment period",
    "publish on the agency's website notice of any federal decision",
)
SF3755_REPEALED_DUTY = (
    "This reimbursement is limited to services provided by facilities of the "
    "Indian Health Service and facilities owned or operated by a Tribe or Tribal "
    "organization."
)


@dataclass
class _AuditHtmlNode:
    tag: str
    attrs: dict[str, str]
    parent: _AuditHtmlNode | None
    order: int
    children: list[_AuditHtmlNode | str] = field(default_factory=list)


@dataclass(frozen=True)
class _RawAppendixReference:
    position: int
    reference_kind: str
    official_reference: str
    source_block_texts: tuple[str, ...]
    statute_subdivision_texts: tuple[str, ...] = ()
    session_law_subdivision_texts: tuple[str, ...] = ()


@dataclass(frozen=True)
class _RawAppendixInventory:
    references: tuple[_RawAppendixReference, ...]
    literal_subdivision_bodies: int
    empty_notice_slots: int


_VOID_HTML_ELEMENTS = {
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
}


class _AuditHtmlParser(HTMLParser):
    """Small, audit-only tree reader independent of the ingestion parser."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root = _AuditHtmlNode("document", {}, None, 0)
        self._stack = [self.root]
        self._order = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._order += 1
        node = _AuditHtmlNode(
            tag.casefold(),
            {name.casefold(): value or "" for name, value in attrs},
            self._stack[-1],
            self._order,
        )
        self._stack[-1].children.append(node)
        if node.tag not in _VOID_HTML_ELEMENTS:
            self._stack.append(node)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        if self._stack[-1].tag == tag.casefold():
            self._stack.pop()

    def handle_endtag(self, tag: str) -> None:
        lowered = tag.casefold()
        for index in range(len(self._stack) - 1, 0, -1):
            if self._stack[index].tag == lowered:
                del self._stack[index:]
                return

    def handle_data(self, data: str) -> None:
        self._stack[-1].children.append(data)


def _node_classes(node: _AuditHtmlNode) -> set[str]:
    return set(node.attrs.get("class", "").casefold().split())


def _descendant_nodes(node: _AuditHtmlNode) -> list[_AuditHtmlNode]:
    descendants: list[_AuditHtmlNode] = []
    for child in node.children:
        if isinstance(child, str):
            continue
        descendants.append(child)
        descendants.extend(_descendant_nodes(child))
    return descendants


def _node_text(node: _AuditHtmlNode, *, omit: _AuditHtmlNode | None = None) -> str:
    pieces: list[str] = []
    for child in node.children:
        if child is omit:
            continue
        if isinstance(child, str):
            pieces.append(child)
        else:
            pieces.append(_node_text(child, omit=omit))
    return " ".join(" ".join(pieces).replace("\xa0", " ").split())


_SAVED_SECTION_HEADING_CLASSES = {
    "section_number",
    "statute_section_number",
    "subd_no",
    "effective_date",
    "shn",
    "title",
}


def _saved_section_body_text(node: _AuditHtmlNode) -> str:
    pieces: list[str] = []
    for child in node.children:
        if isinstance(child, str):
            pieces.append(child)
        elif child.tag in {"h1", "h2"} and (
            _node_classes(child) & _SAVED_SECTION_HEADING_CLASSES
        ):
            continue
        else:
            pieces.append(_saved_section_body_text(child))
    return " ".join(" ".join(pieces).replace("\xa0", " ").split())


def _has_ancestor_class(node: _AuditHtmlNode, class_name: str) -> bool:
    parent = node.parent
    while parent is not None:
        if class_name in _node_classes(parent):
            return True
        parent = parent.parent
    return False


def _raw_appendix_inventory(page: str) -> _RawAppendixInventory:
    """Read source blocks straight from official HTML, not parsed bill data."""
    parser = _AuditHtmlParser()
    parser.feed(page)
    all_nodes = _descendant_nodes(parser.root)
    appendix_blocks = [
        node
        for node in all_nodes
        if node.tag == "div"
        and "rlang" in _node_classes(node)
        and any(
            candidate.tag == "h2"
            and "title" in _node_classes(candidate)
            and _node_text(candidate).casefold() == "appendix"
            for candidate in _descendant_nodes(node)
        )
        and not _has_ancestor_class(node, "rlang")
    ]

    references: list[_RawAppendixReference] = []
    literal_subdivision_bodies = 0
    empty_notice_slots = 0
    for appendix in appendix_blocks:
        appendix_nodes = _descendant_nodes(appendix)
        literal_subdivision_bodies += sum(
            node.tag == "div" and "subd" in _node_classes(node)
            for node in appendix_nodes
        )
        paragraphs = [
            node
            for node in appendix_nodes
            if node.tag == "p" and not _has_ancestor_class(node, "bill_section")
        ]

        statute_wrappers = [
            node
            for node in appendix_nodes
            if node.tag == "div" and "repealed_statutes" in _node_classes(node)
        ]
        for wrapper in statute_wrappers:
            wrapper_nodes = _descendant_nodes(wrapper)
            wrapper_text = _node_text(wrapper)
            text_cursor = 0
            headings = [
                node
                for node in wrapper_nodes
                if node.tag == "h1" and "shn" in _node_classes(node)
            ]
            subdivisions = [
                node
                for node in wrapper_nodes
                if node.tag == "div" and "subd" in _node_classes(node)
            ]
            for index, heading in enumerate(headings):
                next_position = (
                    headings[index + 1].order
                    if index + 1 < len(headings)
                    else sys.maxsize
                )
                body_texts = tuple(
                    _node_text(subdivision)
                    for subdivision in subdivisions
                    if heading.order < subdivision.order < next_position
                    and not _has_ancestor_class(subdivision, "bill_section")
                )
                heading_text = _node_text(heading)
                heading_position = wrapper_text.find(heading_text, text_cursor)
                body_start = heading_position + len(heading_text)
                if index + 1 < len(headings):
                    next_heading_text = _node_text(headings[index + 1])
                    body_end = wrapper_text.find(next_heading_text, body_start)
                else:
                    body_end = len(wrapper_text)
                ungrouped_body = wrapper_text[body_start:body_end].strip()
                text_cursor = max(body_start, body_end)
                body_paragraphs = [
                    paragraph
                    for paragraph in wrapper_nodes
                    if paragraph.tag == "p"
                    and heading.order < paragraph.order < next_position
                ]
                notice_only = (
                    not body_texts
                    and bool(body_paragraphs)
                    and all(
                        _node_text(paragraph)
                        .casefold()
                        .startswith("no active language found for:")
                        for paragraph in body_paragraphs
                    )
                    and _audit_text_tokens(ungrouped_body)
                    == _audit_text_tokens(
                        " ".join(_node_text(paragraph) for paragraph in body_paragraphs)
                    )
                )
                if notice_only:
                    # This is an official source slot, but it expressly says no
                    # repealed law text exists. Keep it visible in the raw count
                    # without turning the notice into model context.
                    empty_notice_slots += 1
                    continue
                source_blocks = body_texts or (
                    (ungrouped_body,) if ungrouped_body else ()
                )
                references.append(
                    _RawAppendixReference(
                        position=heading.order,
                        reference_kind="repealed_statute",
                        official_reference=heading_text,
                        source_block_texts=source_blocks,
                        statute_subdivision_texts=body_texts,
                    )
                )

        session_sections = [
            node
            for node in appendix_nodes
            if node.tag == "div" and "bill_section" in _node_classes(node)
        ]
        for section in session_sections:
            preceding = [
                paragraph
                for paragraph in paragraphs
                if paragraph.order < section.order
                and _node_text(paragraph).casefold().startswith("laws ")
            ]
            direct_subdivisions = tuple(
                _saved_section_body_text(subdivision)
                for subdivision in _descendant_nodes(section)
                if subdivision.tag == "div"
                and "subd" in _node_classes(subdivision)
                and next(
                    (
                        ancestor
                        for ancestor in _ancestor_nodes(subdivision, stop=appendix)
                        if "bill_section" in _node_classes(ancestor)
                    ),
                    None,
                )
                is section
            )
            references.append(
                _RawAppendixReference(
                    position=section.order,
                    reference_kind="repealed_session_law",
                    official_reference=_node_text(preceding[-1]) if preceding else "",
                    source_block_texts=(_saved_section_body_text(section),),
                    session_law_subdivision_texts=direct_subdivisions,
                )
            )

        rule_parts = [
            node
            for node in appendix_nodes
            if node.tag == "div"
            and "part" in _node_classes(node)
            and _has_ancestor_class(node, "repealed_rules")
            and not any(
                "part" in _node_classes(ancestor)
                for ancestor in _ancestor_nodes(node, stop=appendix)
            )
        ]
        for part in rule_parts:
            heading = next(
                (
                    node
                    for node in _descendant_nodes(part)
                    if node.tag == "h1" and "headnote" in _node_classes(node)
                ),
                None,
            )
            references.append(
                _RawAppendixReference(
                    position=part.order,
                    reference_kind="repealed_rule",
                    official_reference=_node_text(heading) if heading else "",
                    source_block_texts=(_node_text(part, omit=heading),),
                )
            )

    return _RawAppendixInventory(
        references=tuple(sorted(references, key=lambda reference: reference.position)),
        literal_subdivision_bodies=literal_subdivision_bodies,
        empty_notice_slots=empty_notice_slots,
    )


def _ancestor_nodes(
    node: _AuditHtmlNode, *, stop: _AuditHtmlNode
) -> list[_AuditHtmlNode]:
    ancestors: list[_AuditHtmlNode] = []
    parent = node.parent
    while parent is not None and parent is not stop:
        ancestors.append(parent)
        parent = parent.parent
    return ancestors


def _appendix_source_errors(
    raw_references: list[_RawAppendixReference] | tuple[_RawAppendixReference, ...],
    prompt_references: list[AppendixAnchor],
) -> list[str]:
    """Prove that prompt A records cover each raw source block under its parent."""
    errors: list[str] = []
    if len(raw_references) != len(prompt_references):
        return [
            "raw APPENDIX legal references do not match prompt A references "
            f"({len(raw_references)} != {len(prompt_references)})"
        ]
    for raw, prompt in zip(raw_references, prompt_references, strict=True):
        if raw.reference_kind != prompt.reference_kind:
            errors.append(
                f"{prompt.anchor_id} changed raw APPENDIX kind "
                f"{raw.reference_kind} to {prompt.reference_kind}"
            )
            continue
        if not (
            prompt.label == raw.official_reference
            or prompt.label.startswith(f"{raw.official_reference} | ")
        ):
            errors.append(
                f"{prompt.anchor_id} is not labeled with its official reference"
            )
        prompt_tokens = _audit_text_tokens(prompt.text)
        cursor = 0
        for source_index, source_text in enumerate(raw.source_block_texts, start=1):
            if not source_text:
                if prompt_tokens:
                    errors.append(
                        f"{prompt.anchor_id} changed empty source block {source_index}"
                    )
                continue
            source_tokens = _audit_text_tokens(source_text)
            position = _find_token_sequence(prompt_tokens, source_tokens, cursor)
            if position < 0:
                errors.append(
                    f"{prompt.anchor_id} does not contain raw source block "
                    f"{source_index} under its correct legal reference"
                )
                continue
            cursor = position + len(source_tokens)
        subdivision_cursor = 0
        for subdivision_index, subdivision_text in enumerate(
            raw.session_law_subdivision_texts, start=1
        ):
            subdivision_tokens = _audit_text_tokens(subdivision_text)
            position = _find_token_sequence(
                prompt_tokens, subdivision_tokens, subdivision_cursor
            )
            if position < 0:
                errors.append(
                    f"{prompt.anchor_id} does not contain session-law subdivision "
                    f"{subdivision_index} under its closest bill-section parent"
                )
                continue
            subdivision_cursor = position + len(subdivision_tokens)
    return errors


_CHANGE_TEXT_MARKER_RE = re.compile(r"(new|deleted)\s+text\s+(?:begin|end)", flags=re.I)


def _audit_text_tokens(value: str) -> tuple[str, ...]:
    value = _CHANGE_TEXT_MARKER_RE.sub(
        lambda match: (
            "" if match.group(1).casefold() == "new" else f" {match.group()} "
        ),
        value,
    ).replace("\xa0", " ")
    return tuple(re.findall(r"\w+|[^\w\s]", value, flags=re.UNICODE))


def _find_token_sequence(
    full: tuple[str, ...], wanted: tuple[str, ...], start: int
) -> int:
    if not wanted:
        return start
    limit = len(full) - len(wanted) + 1
    for position in range(start, limit):
        if full[position : position + len(wanted)] == wanted:
            return position
    return -1


def _read_page(
    http: requests.Session,
    url: str,
    cache_path: Path | None,
    *,
    expected_sha256: str,
) -> tuple[str, str]:
    from_cache = cache_path is not None and cache_path.exists()
    if from_cache:
        page = cache_path.read_text(encoding="utf-8")
    else:
        response = http.get(url, timeout=90)
        response.raise_for_status()
        page = response.text

    page_sha256 = hashlib.sha256(page.encode("utf-8")).hexdigest()
    if page_sha256 != expected_sha256:
        raise RuntimeError(
            "source page SHA-256 changed: "
            f"expected {expected_sha256}, received {page_sha256}"
        )
    if cache_path is not None and not from_cache:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(page, encoding="utf-8")
    return page, page_sha256


def _article_lookup(parsed: dict[str, Any]) -> dict[str, dict[str, Any]]:
    lookup: dict[str, dict[str, Any]] = {}
    for article in parsed.get("articles", []):
        for section in article.get("sections", []):
            lookup[str(section.get("section_id") or "")] = article
    return lookup


def _create_audit_reference_data(
    db: Session, *, run_token: str
) -> tuple[uuid.UUID, dict[str, uuid.UUID]]:
    jurisdiction = schema.Jurisdiction(
        slug=f"issue-457-audit-{run_token}",
        name="Issue 457 saved-context audit",
        country_code="US",
        subdivision_code="MN",
    )
    db.add(jurisdiction)
    db.flush()
    legislative_session = schema.LegislativeSession(
        jurisdiction_id=jurisdiction.id,
        slug="audit-session",
        session_number=94,
        session_type=schema.SessionType.regular,
        year_start=2025,
        year_end=2026,
        name="Issue 457 saved-context audit session",
        is_current=False,
    )
    db.add(legislative_session)
    chambers = {
        "HF": schema.Chamber(
            jurisdiction_id=jurisdiction.id,
            chamber_type=schema.ChamberType.house,
            slug="house",
            name="House",
            short_name="House",
            display_order=1,
        ),
        "SF": schema.Chamber(
            jurisdiction_id=jurisdiction.id,
            chamber_type=schema.ChamberType.senate,
            slug="senate",
            name="Senate",
            short_name="Senate",
            display_order=2,
        ),
    }
    db.add_all(chambers.values())
    db.flush()
    return legislative_session.id, {
        file_type: chamber.id for file_type, chamber in chambers.items()
    }


def _store_parsed_page(
    db: Session,
    *,
    run_token: str,
    bill_key: str,
    url: str,
    parsed: dict[str, Any],
    session_id: uuid.UUID,
    chamber_ids: dict[str, uuid.UUID],
) -> tuple[uuid.UUID, uuid.UUID]:
    identity = re.search(r"-(HF|SF)(\d+)$", bill_key)
    if identity is None:
        raise RuntimeError(f"could not read the bill number from {bill_key}")
    file_type, file_number_text = identity.groups()
    bill = schema.Bill(
        session_id=session_id,
        chamber_id=chamber_ids[file_type],
        bill_key=f"issue457-audit-{run_token}-{bill_key}",
        file_type=file_type,
        file_number=int(file_number_text),
        title=str(
            parsed.get("bill_title_text") or parsed.get("page_title") or bill_key
        ),
        official_url=url,
    )
    db.add(bill)
    db.flush()
    version = schema.BillVersion(
        bill_id=bill.id,
        version_code="audit",
        version_name=str(parsed.get("page_title") or "") or None,
        sequence_number=1,
        html_url=url,
        is_current=True,
        bill_summary_context_baselined=True,
    )
    db.add(version)
    db.flush()

    article_by_id = _article_lookup(parsed)
    for source_order, section in enumerate(parsed.get("sections", []), start=1):
        article = article_by_id.get(str(section.get("section_id") or ""), {})
        raw_text = str(section.get("text") or "")
        db.add(
            schema.BillVersionSection(
                bill_version_id=version.id,
                section_id_text=str(section.get("section_id") or ""),
                source_order=source_order,
                article_id_text=str(article.get("article_id") or "") or None,
                article_number=str(article.get("article_number") or "") or None,
                article_heading=str(article.get("article_heading") or "") or None,
                section_heading=str(section.get("heading") or "") or None,
                statute_heading=str(section.get("statute_heading") or "") or None,
                cite_heading=str(section.get("cite_heading") or "") or None,
                effective_date_heading=(
                    str(section.get("effective_date_heading") or "") or None
                ),
                raw_text=raw_text,
                body_blocks=section.get("blocks") or None,
                source_hash=hashlib.sha256(raw_text.encode("utf-8")).hexdigest(),
            )
        )
    db.flush()
    replace_bill_version_prompt_context(db, version, parsed)
    db.flush()
    return bill.id, version.id


def _saved_reader_bytes_match(
    db: Session, version_id: uuid.UUID, parsed: dict[str, Any]
) -> bool:
    saved = list(
        db.scalars(
            select(schema.BillVersionSection)
            .where(schema.BillVersionSection.bill_version_id == version_id)
            .order_by(schema.BillVersionSection.source_order.asc())
        )
    )
    expected = list(parsed.get("sections") or [])
    return len(saved) == len(expected) and all(
        row.source_order == source_order
        and row.section_id_text == str(section.get("section_id") or "")
        and row.raw_text == str(section.get("text") or "")
        and row.source_hash
        == hashlib.sha256(str(section.get("text") or "").encode("utf-8")).hexdigest()
        for source_order, (row, section) in enumerate(
            zip(saved, expected, strict=True), start=1
        )
    )


def _sf3755_errors(
    proposed: list[SectionAnchor],
    appendix: list[AppendixAnchor],
    raw_appendix: list[_RawAppendixReference],
) -> list[str]:
    errors: list[str] = []
    sec5 = next((anchor for anchor in proposed if "Sec. 5" in anchor.label), None)
    if sec5 is None:
        return ["SF3755 Sec. 5 was not found in the proposed lane"]
    added = [
        str(segment.get("text") or "")
        for segment in sec5.change_role_segments or []
        if segment.get("role") == "added"
    ]
    if [value.strip() for value in added].count(SF3755_ADDED) != 1:
        errors.append("SF3755 Sec. 5 did not mark the exact new publication duty once")
    carried = [
        str(segment.get("text") or "")
        for segment in sec5.change_role_segments or []
        if segment.get("role") == "carried_forward"
    ]
    joined_carried = " ".join(carried)
    for duty in SF3755_CARRIED_DUTIES:
        if duty not in joined_carried:
            errors.append(f"SF3755 carried-forward duty was mislabeled: {duty}")
    if any(duty in " ".join(added) for duty in SF3755_CARRIED_DUTIES):
        errors.append("SF3755 carried-forward duties leaked into added text")
    joined_proposed = "\n".join(anchor.text for anchor in proposed)
    joined_appendix = "\n".join(anchor.text for anchor in appendix)
    if SF3755_REPEALED_DUTY in joined_proposed:
        errors.append("SF3755 old Indian Health Service duty leaked into an S anchor")
    if (
        len(appendix) != 2
        or appendix[0].reference_kind != "repealed_statute"
        or appendix[-1].anchor_id != "A2"
        or appendix[-1].reference_kind != "repealed_session_law"
        or SF3755_REPEALED_DUTY not in appendix[-1].text
    ):
        errors.append("SF3755 old Indian Health Service duty is not confined to A2")
    if SF3755_REPEALED_DUTY not in joined_appendix:
        errors.append("SF3755 APPENDIX lost the old Indian Health Service duty")
    statute_sources = [
        reference
        for reference in raw_appendix
        if reference.reference_kind == "repealed_statute"
    ]
    if (
        len(statute_sources) != 1
        or len(statute_sources[0].source_block_texts) != 12
        or not appendix
        or appendix[0].anchor_id != "A1"
        or appendix[0].reference_kind != "repealed_statute"
    ):
        errors.append("SF3755 did not keep all 12 statute subdivisions under A1")
    return errors


def audit(*, cache_dir: Path | None, db: Session) -> tuple[dict[str, Any], list[str]]:
    http = requests.Session()
    errors: list[str] = []
    rows: list[dict[str, Any]] = []
    prompt_kind_totals = {
        "repealed_statute": 0,
        "repealed_session_law": 0,
        "repealed_rule": 0,
    }

    audit_savepoint = db.begin_nested()
    try:
        run_token = uuid.uuid4().hex[:12]
        session_id, chamber_ids = _create_audit_reference_data(db, run_token=run_token)
        for bill_key, (
            url,
            expected_s,
            expected_a,
            expected_appendix,
            expected_page_sha256,
        ) in COHORT.items():
            cache_path = cache_dir / f"{bill_key}.html" if cache_dir else None
            try:
                page, page_sha256 = _read_page(
                    http,
                    url,
                    cache_path,
                    expected_sha256=expected_page_sha256,
                )
                raw_inventory = _raw_appendix_inventory(page)
                raw_appendix = raw_inventory.references
                parsed = parse_bill_text_html(page, url)
            except Exception as exc:  # noqa: BLE001 - report every cohort failure together
                errors.append(f"{bill_key}: official page could not be checked ({exc})")
                continue

            page_savepoint = db.begin_nested()
            try:
                bill_id, version_id = _store_parsed_page(
                    db,
                    run_token=run_token,
                    bill_key=bill_key,
                    url=url,
                    parsed=parsed,
                    session_id=session_id,
                    chamber_ids=chamber_ids,
                )
                db.expire_all()
                bill = db.get(schema.Bill, bill_id)
                version = db.get(schema.BillVersion, version_id)
                if bill is None or version is None:
                    raise RuntimeError("saved bill context could not be reloaded")

                measurement = bill_prompt_measurement(
                    db,
                    bill,
                    version,
                    max_proposed_chars=PROPOSED_TEXT_CHAR_LIMIT,
                    max_appendix_chars=APPENDIX_TEXT_CHAR_LIMIT,
                    max_combined_chars=COMBINED_TEXT_CHAR_LIMIT,
                    max_request_chars=WHOLE_REQUEST_CHAR_LIMIT,
                )
                prompt, prepared_fingerprint, prompt_refused = bill_prompt(
                    db,
                    bill,
                    version,
                    max_input_chars=PROPOSED_TEXT_CHAR_LIMIT,
                    max_appendix_chars=APPENDIX_TEXT_CHAR_LIMIT,
                    max_combined_chars=COMBINED_TEXT_CHAR_LIMIT,
                    max_request_chars=WHOLE_REQUEST_CHAR_LIMIT,
                )
                source_fingerprint = canonical_source_text_fingerprint(
                    db, bill, version
                )
                proposed_anchors = section_anchors(db, version)
                appendix = appendix_anchors(db, version)
                rag_documents = int(
                    db.scalar(
                        select(func.count(schema.RagSectionDocument.id)).where(
                            schema.RagSectionDocument.bill_id == bill.id
                        )
                    )
                    or 0
                )

                for anchor in appendix:
                    if anchor.reference_kind in prompt_kind_totals:
                        prompt_kind_totals[anchor.reference_kind] += 1
                errors.extend(
                    f"{bill_key}: {error}"
                    for error in _appendix_source_errors(raw_appendix, appendix)
                )
                if bool(version.appendix_present) != expected_appendix:
                    errors.append(f"{bill_key}: APPENDIX presence changed")
                if len(proposed_anchors) != expected_s:
                    errors.append(
                        f"{bill_key}: proposed references "
                        f"{len(proposed_anchors)} != {expected_s}"
                    )
                if len(appendix) != expected_a:
                    errors.append(
                        f"{bill_key}: APPENDIX prompt references "
                        f"{len(appendix)} != {expected_a}"
                    )
                for anchor in proposed_anchors:
                    if (
                        not anchor.change_role_parse_complete
                        or not anchor.change_role_segments
                        or anchor.change_role_source_hash
                        != _change_role_hash(anchor.change_role_segments)
                    ):
                        errors.append(
                            f"{bill_key}: {anchor.anchor_id} change roles are not provable"
                        )
                if not _saved_reader_bytes_match(db, version.id, parsed):
                    errors.append(f"{bill_key}: saved reader/search text bytes changed")
                if source_fingerprint is None:
                    errors.append(f"{bill_key}: saved source fingerprint is incomplete")
                if len(str(prepared_fingerprint or "")) != 64:
                    errors.append(
                        f"{bill_key}: prepared prompt fingerprint is incomplete"
                    )
                if not measurement.get("is_complete") or prompt_refused:
                    errors.append(f"{bill_key}: saved prompt input was refused")
                if CHANGE_ROLE_WARNING not in prompt:
                    errors.append(
                        f"{bill_key}: proposed change-role warning is missing"
                    )
                if appendix and APPENDIX_WARNING not in prompt:
                    errors.append(f"{bill_key}: APPENDIX warning is missing")
                if rag_documents:
                    errors.append(f"{bill_key}: audit unexpectedly created search rows")
                if bill_key == "94-2026-SF3755":
                    errors.extend(
                        _sf3755_errors(proposed_anchors, appendix, raw_appendix)
                    )

                statute_legal_source_bodies = sum(
                    len(reference.source_block_texts)
                    for reference in raw_appendix
                    if reference.reference_kind == "repealed_statute"
                )
                statute_subdivision_source_bodies = sum(
                    len(reference.statute_subdivision_texts)
                    for reference in raw_appendix
                    if reference.reference_kind == "repealed_statute"
                )
                statute_unsubdivided_legal_source_bodies = (
                    statute_legal_source_bodies - statute_subdivision_source_bodies
                )
                session_law_source_blocks = sum(
                    len(reference.source_block_texts)
                    for reference in raw_appendix
                    if reference.reference_kind == "repealed_session_law"
                )
                session_law_nested_subdivision_bodies = sum(
                    len(reference.session_law_subdivision_texts)
                    for reference in raw_appendix
                    if reference.reference_kind == "repealed_session_law"
                )
                rule_part_source_blocks = sum(
                    len(reference.source_block_texts)
                    for reference in raw_appendix
                    if reference.reference_kind == "repealed_rule"
                )
                if raw_inventory.literal_subdivision_bodies != (
                    statute_subdivision_source_bodies
                    + session_law_nested_subdivision_bodies
                ):
                    errors.append(
                        f"{bill_key}: literal APPENDIX subdivisions were not assigned "
                        "exactly once to a statute or session-law parent"
                    )

                proposed_measurement = measurement["proposed"]
                appendix_measurement = measurement["appendix"]
                combined_measurement = measurement["combined"]
                request_measurement = measurement["request"]
                rows.append(
                    {
                        "bill_key": bill_key,
                        "official_page_sha256": page_sha256,
                        "proposed_prompt_references": len(proposed_anchors),
                        "proposed_chars": proposed_measurement["total_chars"],
                        "appendix_prompt_references": len(appendix),
                        "appendix_legal_source_blocks": (
                            statute_legal_source_bodies
                            + session_law_source_blocks
                            + rule_part_source_blocks
                        ),
                        "appendix_raw_official_slots": (
                            statute_legal_source_bodies
                            + session_law_source_blocks
                            + rule_part_source_blocks
                            + raw_inventory.empty_notice_slots
                        ),
                        "statute_legal_source_bodies": statute_legal_source_bodies,
                        "statute_subdivision_source_bodies": (
                            statute_subdivision_source_bodies
                        ),
                        "statute_unsubdivided_legal_source_bodies": (
                            statute_unsubdivided_legal_source_bodies
                        ),
                        "statute_empty_notice_slots": raw_inventory.empty_notice_slots,
                        "session_law_source_blocks": session_law_source_blocks,
                        "session_law_nested_subdivision_bodies": (
                            session_law_nested_subdivision_bodies
                        ),
                        "appendix_literal_subdivision_bodies": (
                            raw_inventory.literal_subdivision_bodies
                        ),
                        "rule_part_source_blocks": rule_part_source_blocks,
                        "appendix_chars": appendix_measurement["total_chars"],
                        "combined_chars": combined_measurement["total_chars"],
                        "request_chars": request_measurement["total_chars"],
                        "prompt_input_complete": bool(measurement["is_complete"]),
                        "source_text_fingerprint": source_fingerprint,
                        "prepared_prompt_fingerprint": prepared_fingerprint,
                        "rag_section_documents": rag_documents,
                    }
                )
            except Exception as exc:  # noqa: BLE001 - report every cohort failure together
                errors.append(f"{bill_key}: saved context could not be checked ({exc})")
            finally:
                page_savepoint.rollback()
                db.expire_all()
    finally:
        audit_savepoint.rollback()
        db.expire_all()

    totals = {
        "proposed_prompt_references": sum(
            row["proposed_prompt_references"] for row in rows
        ),
        "appendix_prompt_references": sum(
            row["appendix_prompt_references"] for row in rows
        ),
        "appendix_statute_prompt_references": prompt_kind_totals["repealed_statute"],
        "appendix_session_law_prompt_references": prompt_kind_totals[
            "repealed_session_law"
        ],
        "appendix_rule_prompt_references": prompt_kind_totals["repealed_rule"],
        "appendix_raw_official_slots": sum(
            row["appendix_raw_official_slots"] for row in rows
        ),
        "appendix_legal_source_blocks": sum(
            row["appendix_legal_source_blocks"] for row in rows
        ),
        "statute_legal_source_bodies": sum(
            row["statute_legal_source_bodies"] for row in rows
        ),
        "statute_subdivision_source_bodies": sum(
            row["statute_subdivision_source_bodies"] for row in rows
        ),
        "statute_unsubdivided_legal_source_bodies": sum(
            row["statute_unsubdivided_legal_source_bodies"] for row in rows
        ),
        "statute_empty_notice_slots": sum(
            row["statute_empty_notice_slots"] for row in rows
        ),
        "session_law_source_blocks": sum(
            row["session_law_source_blocks"] for row in rows
        ),
        "session_law_nested_subdivision_bodies": sum(
            row["session_law_nested_subdivision_bodies"] for row in rows
        ),
        "appendix_literal_subdivision_bodies": sum(
            row["appendix_literal_subdivision_bodies"] for row in rows
        ),
        "rule_part_source_blocks": sum(row["rule_part_source_blocks"] for row in rows),
    }
    for name, expected in EXPECTED_TOTALS.items():
        if totals[name] != expected:
            errors.append(f"cohort {name} {totals[name]} != {expected}")

    return {
        "bills_checked": len(rows),
        "totals": totals,
        "max_proposed_chars": max((row["proposed_chars"] for row in rows), default=0),
        "max_appendix_chars": max((row["appendix_chars"] for row in rows), default=0),
        "max_combined_chars": max((row["combined_chars"] for row in rows), default=0),
        "max_request_chars": max((row["request_chars"] for row in rows), default=0),
        "saved_context_round_trips": len(rows),
        "paid_model_calls": 0,
        "rag_rebuild_calls": 0,
        "limits": {
            "proposed_chars": PROPOSED_TEXT_CHAR_LIMIT,
            "appendix_chars": APPENDIX_TEXT_CHAR_LIMIT,
            "combined_chars": COMBINED_TEXT_CHAR_LIMIT,
            "whole_request_chars": WHOLE_REQUEST_CHAR_LIMIT,
        },
        "rows": rows,
    }, errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--cache-dir",
        type=Path,
        help="Read or save the 27 official HTML pages here for a repeatable free run.",
    )
    parser.add_argument(
        "--database-url",
        help=(
            "Local PostgreSQL database used only inside a rolled-back savepoint. "
            "Remote database hosts are refused."
        ),
    )
    parser.add_argument("--json", action="store_true", help="Print the full report.")
    args = parser.parse_args()

    database_url = normalize_database_url(
        database_url_for_target("local", args.database_url)
    )
    parsed_url = make_url(database_url)
    if not parsed_url.drivername.startswith("postgresql") or (
        parsed_url.host or ""
    ).lower() not in {"", "localhost", "127.0.0.1", "::1", "db"}:
        raise RuntimeError(
            "The 27-bill prompt audit accepts only a local PostgreSQL database"
        )
    engine = create_engine(
        database_url,
        pool_pre_ping=True,
        connect_args=NO_PREPARED_STATEMENTS,
    )
    try:
        with Session(engine) as db:
            report, errors = audit(cache_dir=args.cache_dir, db=db)
    finally:
        engine.dispose()
    if args.json:
        print(json.dumps({**report, "errors": errors}, indent=2))
    elif errors:
        print(f"FAILED: {len(errors)} prompt-context checks did not pass.")
        for error in errors:
            print(f"    {error}")
    else:
        print(
            "OK: all 27 official pages preserve complete proposed-change and "
            "APPENDIX roles under every input gate."
        )
        print(
            json.dumps(
                {key: value for key, value in report.items() if key != "rows"}, indent=2
            )
        )
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
