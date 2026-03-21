#!/usr/bin/env python3
"""Rough Minnesota bill RAG-ingestion prototype.

This script consumes canonical-ish bill JSON produced by the source ingestion
prototype and derives retrieval-safe section documents and chunks.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
from pathlib import Path
from typing import Dict, List, Tuple


CLEANING_VERSION = "v0.1"
CHUNKING_VERSION = "v0.1"
TARGET_CHUNK_WORDS = 220
MAX_CHUNK_WORDS = 320
MIN_CHUNK_WORDS = 40
OVERLAP_BLOCKS = 0
LOW_INFO_WORDS = 20

BANNED_MARKERS = [
    "new text begin",
    "new text end",
    "deleted text begin",
    "deleted text end",
]


def read_json(path: Path) -> Dict[str, object]:
    return json.loads(path.read_text())


def write_json(path: Path, payload: Dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")


def collapse_inline_whitespace(text: str) -> str:
    text = html.unescape(text)
    text = text.replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\s+([,.;:)\]])", r"\1", text)
    text = re.sub(r"([(\[])\s+", r"\1", text)
    text = re.sub(r"\s+([/%])", r"\1", text)
    return text.strip()


def rewrite_amendment_markers(text: str) -> str:
    text = re.sub(
        r"deleted text begin\s*(.*?)\s*deleted text end",
        lambda match: f"[deleted: {collapse_inline_whitespace(match.group(1))}]",
        text,
        flags=re.I | re.S,
    )
    text = re.sub(r"new text begin\s*", "", text, flags=re.I)
    text = re.sub(r"\s*new text end", "", text, flags=re.I)
    return text


def normalize_source_text(text: str) -> str:
    text = rewrite_amendment_markers(text)
    text = text.replace("\r", "")
    text = re.sub(r"\n[ \t]+\n", "\n\n", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n[ \t]+", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def merge_currency_lines(lines: List[str]) -> List[str]:
    merged: List[str] = []
    index = 0
    while index < len(lines):
        line = lines[index]
        if line == "$" and index + 1 < len(lines):
            merged.append(f"${lines[index + 1]}")
            index += 2
            continue
        merged.append(line)
        index += 1
    return merged


def is_marker_line(line: str) -> bool:
    return bool(
        re.match(
            r"^(Section \d+\.|Sec\. \d+\.|Subdivision \d+\.|Subd\. [0-9A-Za-z]+\."
            r"|\([a-z0-9]+\)|[A-Z][A-Z0-9'&,/\- ]+\."
            r"|ARTICLE \d+)$",
            line,
        )
    )


def is_tableish_line(line: str) -> bool:
    if not line:
        return False
    if is_marker_line(line):
        return False
    if len(line) > 55:
        return False
    if re.search(r"[.!?]$", line):
        return False
    word_count = len(line.split())
    if line.startswith("[deleted:"):
        return False
    return word_count <= 8 or bool(re.fullmatch(r"[$0-9,\-]+", line))


def lines_to_blocks(lines: List[str]) -> List[str]:
    blocks: List[str] = []
    prose: List[str] = []
    index = 0

    def flush_prose() -> None:
        if prose:
            blocks.append(collapse_inline_whitespace(" ".join(prose)))
            prose.clear()

    while index < len(lines):
        line = lines[index]
        if is_tableish_line(line):
            flush_prose()
            table_lines = [line]
            index += 1
            while index < len(lines) and is_tableish_line(lines[index]):
                table_lines.append(lines[index])
                index += 1
            blocks.append(" | ".join(table_lines))
            continue

        if is_marker_line(line):
            flush_prose()
            blocks.append(line)
            index += 1
            continue

        prose.append(line)
        if re.search(r"[.!?]$", line):
            flush_prose()
        index += 1

    flush_prose()
    return [block for block in blocks if block]


def clean_section_text(raw_text: str) -> Tuple[str, Dict[str, int]]:
    normalized = normalize_source_text(raw_text)
    lines = [collapse_inline_whitespace(line) for line in normalized.split("\n")]
    lines = [line for line in lines if line]
    lines = merge_currency_lines(lines)
    blocks = lines_to_blocks(lines)

    paragraphs: List[str] = []
    for block in blocks:
        if paragraphs and block.startswith("[deleted:"):
            paragraphs[-1] = f"{paragraphs[-1]} {block}"
        else:
            paragraphs.append(block)

    clean_text = "\n\n".join(paragraphs).strip()
    clean_text = re.sub(r":\s+((?:or\s+)?\([0-9ivx]+\))", r":\n\n\1", clean_text, flags=re.I)
    clean_text = re.sub(r";\s+((?:or\s+)?\([0-9ivx]+\))", r";\n\n\1", clean_text, flags=re.I)
    clean_text = re.sub(r"\n{3,}", "\n\n", clean_text)

    metrics = {
        "raw_newline_count": raw_text.count("\n"),
        "clean_newline_count": clean_text.count("\n"),
        "raw_deleted_marker_count": len(re.findall(r"deleted text begin", raw_text, flags=re.I)),
        "clean_deleted_marker_count": len(re.findall(r"\[deleted:", clean_text, flags=re.I)),
        "block_count": len(blocks),
        "paragraph_count": len(paragraphs),
    }
    return clean_text, metrics


def word_count(text: str) -> int:
    return len(re.findall(r"\S+", text))


def pack_parts(parts: List[str], target_words: int) -> List[str]:
    split_blocks: List[str] = []
    current: List[str] = []
    current_words = 0

    for part in parts:
        part = collapse_inline_whitespace(part)
        if not part:
            continue
        part_words = word_count(part)
        if current and current_words + part_words > target_words:
            split_blocks.append(" ".join(current).strip())
            current = []
            current_words = 0
        current.append(part)
        current_words += part_words

    if current:
        split_blocks.append(" ".join(current).strip())

    return split_blocks


def split_with_pattern(block: str, pattern: str) -> List[str]:
    return [part.strip() for part in re.split(pattern, block) if part.strip()]


def split_large_block(block: str, pattern_index: int = 0) -> List[str]:
    if word_count(block) <= MAX_CHUNK_WORDS:
        return [block]

    patterns = [
        r"(?<=[.!?])\s+(?=[A-Z\[(])",
        r"\s+(?=\([0-9a-z]+\))",
        r"(?<=;)\s+",
        r"(?<=:)\s+(?=\([0-9ivx]+\)|[A-Z\[])",
    ]
    target = max(TARGET_CHUNK_WORDS - 40, MIN_CHUNK_WORDS)

    for index in range(pattern_index, len(patterns)):
        parts = split_with_pattern(block, patterns[index])
        if len(parts) <= 1:
            continue
        packed = pack_parts(parts, target)
        if not packed:
            continue
        output: List[str] = []
        for piece in packed:
            if word_count(piece) > MAX_CHUNK_WORDS and index + 1 < len(patterns):
                output.extend(split_large_block(piece, index + 1))
            else:
                output.append(piece)
        return output if output else [block]

    return [block]


def chunk_paragraphs(paragraphs: List[str], prefix: str) -> List[str]:
    if not paragraphs:
        return [prefix.strip()]

    normalized_blocks: List[str] = []
    for paragraph in paragraphs:
        normalized_blocks.extend(split_large_block(paragraph))

    chunks: List[str] = []
    current: List[str] = []
    current_words = 0

    def finalize_chunk() -> None:
        if current:
            chunk_body = "\n\n".join(current)
            chunks.append(f"{prefix}\n\n{chunk_body}".strip())

    for index, paragraph in enumerate(normalized_blocks):
        paragraph_words = word_count(paragraph)
        if current and current_words + paragraph_words > TARGET_CHUNK_WORDS and current_words >= MIN_CHUNK_WORDS:
            finalize_chunk()
            overlap = current[-OVERLAP_BLOCKS:] if OVERLAP_BLOCKS and len(current) > 1 else []
            current = overlap.copy()
            current_words = sum(word_count(block) for block in current)

        current.append(paragraph)
        current_words += paragraph_words

        if current_words > MAX_CHUNK_WORDS and len(current) > 1:
            overflow = current.pop()
            finalize_chunk()
            current = [overflow]
            current_words = word_count(overflow)

        if (
            current
            and current_words >= TARGET_CHUNK_WORDS
            and index < len(normalized_blocks) - 1
        ):
            finalize_chunk()
            overlap = current[-OVERLAP_BLOCKS:] if OVERLAP_BLOCKS and len(current) > 1 else []
            current = overlap.copy()
            current_words = sum(word_count(block) for block in current)

    if current:
        chunk_body = "\n\n".join(current)
        if chunks and word_count(chunk_body) < MIN_CHUNK_WORDS:
            chunks[-1] = f"{chunks[-1]}\n\n{chunk_body}".strip()
        else:
            chunks.append(f"{prefix}\n\n{chunk_body}".strip())

    return chunks


def compact_chunk_prefix(file_type: str, file_number: str, article_meta: Dict[str, str], section: Dict[str, str]) -> str:
    lines = [f"Bill: {file_type} {file_number}"]
    if article_meta.get("article_number") or article_meta.get("article_heading"):
        article_label = " ".join(
            part for part in [article_meta.get("article_number", ""), article_meta.get("article_heading", "")] if part
        )
        lines.append(f"Article: {article_label}")
    if section.get("heading"):
        lines.append(f"Section: {section['heading']}")
    if section.get("statute_heading"):
        lines.append(f"Statute heading: {section['statute_heading']}")
    if section.get("cite_heading"):
        lines.append(f"Citation heading: {section['cite_heading']}")
    return "\n".join(lines).strip()


def full_section_prefix(
    file_type: str,
    file_number: str,
    bill_title: str,
    article_meta: Dict[str, str],
    section: Dict[str, str],
) -> str:
    prefix_parts = [
        f"Bill: {file_type} {file_number}.",
        f"Bill title: {bill_title}",
    ]
    if article_meta.get("article_number") or article_meta.get("article_heading"):
        prefix_parts.append(
            f"Article: {article_meta.get('article_number', '')} {article_meta.get('article_heading', '')}".strip()
        )
    if section.get("heading"):
        prefix_parts.append(f"Section: {section['heading']}")
    if section.get("statute_heading"):
        prefix_parts.append(f"Statute heading: {section['statute_heading']}")
    if section.get("cite_heading"):
        prefix_parts.append(f"Citation heading: {section['cite_heading']}")
    return "\n".join(part for part in prefix_parts if part)


def source_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def build_rag_payload(bill_payload: Dict[str, object]) -> Dict[str, object]:
    canonical_bill = bill_payload["canonical_bill"]  # type: ignore[index]
    bill_text = bill_payload["bill_text"]  # type: ignore[index]

    bill_key = canonical_bill["bill_key"]  # type: ignore[index]
    file_type = canonical_bill["file_type"]  # type: ignore[index]
    file_number = canonical_bill["file_number"]  # type: ignore[index]
    version_source_url = bill_text["source_url"]  # type: ignore[index]
    bill_title = bill_text["bill_title_text"]  # type: ignore[index]
    page_title = bill_text["page_title"]  # type: ignore[index]

    article_by_section: Dict[str, Dict[str, str]] = {}
    for article in bill_text.get("articles", []):  # type: ignore[union-attr]
        article_meta = {
            "article_id": article.get("article_id", ""),
            "article_number": article.get("article_number", ""),
            "article_heading": article.get("article_heading", ""),
        }
        for section in article.get("sections", []):
            article_by_section[section.get("section_id", "")] = article_meta

    rag_sections: List[Dict[str, object]] = []
    rag_chunks: List[Dict[str, object]] = []

    for section_index, section in enumerate(bill_text["sections"]):  # type: ignore[index]
        article_meta = article_by_section.get(section.get("section_id", ""), {})
        clean_text, clean_metrics = clean_section_text(section.get("text", ""))
        paragraphs = [paragraph for paragraph in clean_text.split("\n\n") if paragraph]

        citation_parts = [f"{file_type} {file_number}"]
        if article_meta.get("article_number"):
            citation_parts.append(article_meta["article_number"])
        if section.get("heading"):
            citation_parts.append(section["heading"])
        citation_label = ", ".join(citation_parts)

        section_prefix = full_section_prefix(file_type, file_number, bill_title, article_meta, section)
        chunk_prefix = compact_chunk_prefix(file_type, file_number, article_meta, section)

        section_document = {
            "bill_key": bill_key,
            "version_source_url": version_source_url,
            "page_title": page_title,
            "bill_title": bill_title,
            "article_id": article_meta.get("article_id", ""),
            "article_number": article_meta.get("article_number", ""),
            "article_heading": article_meta.get("article_heading", ""),
            "section_id": section.get("section_id", ""),
            "section_heading": section.get("heading", ""),
            "statute_heading": section.get("statute_heading", ""),
            "cite_heading": section.get("cite_heading", ""),
            "effective_date_heading": section.get("effective_date_heading", ""),
            "citation_label": citation_label,
            "raw_text": section.get("text", ""),
            "clean_text": clean_text,
            "search_text": f"{section_prefix}\n\n{clean_text}".strip(),
            "cleaning_version": CLEANING_VERSION,
            "source_hash": source_hash(section.get("text", "")),
            "clean_metrics": clean_metrics,
        }
        rag_sections.append(section_document)

        chunk_texts = chunk_paragraphs(paragraphs, chunk_prefix)
        for chunk_index, chunk_text in enumerate(chunk_texts):
            rag_chunks.append(
                {
                    "chunk_id": f"{bill_key}:{section.get('section_id', '')}:{chunk_index}",
                    "bill_key": bill_key,
                    "article_id": article_meta.get("article_id", ""),
                    "section_id": section.get("section_id", ""),
                    "chunk_index": chunk_index,
                    "citation_label": citation_label,
                    "chunk_text": chunk_text,
                    "word_count": word_count(chunk_text),
                    "cleaning_version": CLEANING_VERSION,
                    "chunking_version": CHUNKING_VERSION,
                    "source_hash": source_hash(section.get("text", "")),
                }
            )

    return {
        "prototype": "bill_rag_ingestion",
        "bill_key": bill_key,
        "version_source_url": version_source_url,
        "cleaning_version": CLEANING_VERSION,
        "chunking_version": CHUNKING_VERSION,
        "section_count": len(rag_sections),
        "chunk_count": len(rag_chunks),
        "rag_sections": rag_sections,
        "rag_chunks": rag_chunks,
    }


def validate_rag_payload(payload: Dict[str, object]) -> Dict[str, object]:
    rag_sections = payload["rag_sections"]  # type: ignore[index]
    rag_chunks = payload["rag_chunks"]  # type: ignore[index]

    section_ids = {section["section_id"] for section in rag_sections}
    chunk_section_ids = {chunk["section_id"] for chunk in rag_chunks}
    section_word_counts = {section["section_id"]: word_count(section["clean_text"]) for section in rag_sections}

    banned_counts = {
        marker: sum(section["clean_text"].lower().count(marker) for section in rag_sections)
        + sum(chunk["chunk_text"].lower().count(marker) for chunk in rag_chunks)
        for marker in BANNED_MARKERS
    }

    html_tag_count = sum(len(re.findall(r"<[^>]+>", section["clean_text"])) for section in rag_sections)
    html_tag_count += sum(len(re.findall(r"<[^>]+>", chunk["chunk_text"])) for chunk in rag_chunks)

    total_raw_newlines = sum(section["raw_text"].count("\n") for section in rag_sections)
    total_clean_newlines = sum(section["clean_text"].count("\n") for section in rag_sections)
    low_info_chunks = [
        chunk
        for chunk in rag_chunks
        if chunk["word_count"] < LOW_INFO_WORDS and section_word_counts.get(chunk["section_id"], 0) >= LOW_INFO_WORDS
    ]
    oversize_chunks = [chunk for chunk in rag_chunks if chunk["word_count"] > MAX_CHUNK_WORDS]
    orphan_currency_chunks = [
        chunk
        for chunk in rag_chunks
        if re.search(r"(^|\s)\$(\s|$)", chunk["chunk_text"])
    ]
    duplicate_chunk_count = len(rag_chunks) - len({chunk["chunk_text"] for chunk in rag_chunks})

    return {
        "bill_key": payload["bill_key"],
        "ok": not any(banned_counts.values()) and html_tag_count == 0 and not oversize_chunks,
        "section_count": len(rag_sections),
        "chunk_count": len(rag_chunks),
        "section_coverage_ok": section_ids == chunk_section_ids,
        "uncovered_sections": sorted(section_ids - chunk_section_ids),
        "html_tag_count": html_tag_count,
        "banned_marker_counts": banned_counts,
        "total_raw_newlines": total_raw_newlines,
        "total_clean_newlines": total_clean_newlines,
        "newline_reduction": total_raw_newlines - total_clean_newlines,
        "low_info_chunk_count": len(low_info_chunks),
        "oversize_chunk_count": len(oversize_chunks),
        "orphan_currency_chunk_count": len(orphan_currency_chunks),
        "duplicate_chunk_count": duplicate_chunk_count,
        "chunk_word_stats": {
            "min": min(chunk["word_count"] for chunk in rag_chunks) if rag_chunks else 0,
            "max": max(chunk["word_count"] for chunk in rag_chunks) if rag_chunks else 0,
            "avg": round(sum(chunk["word_count"] for chunk in rag_chunks) / len(rag_chunks), 1) if rag_chunks else 0,
        },
    }


def build_many(input_paths: List[Path]) -> Dict[str, object]:
    builds = []
    validations = []
    for path in input_paths:
        build = build_rag_payload(read_json(path))
        validation = validate_rag_payload(build)
        builds.append(
            {
                "input_path": str(path),
                "bill_key": build["bill_key"],
                "section_count": build["section_count"],
                "chunk_count": build["chunk_count"],
                "validation": validation,
            }
        )
        validations.append(validation)

    return {
        "prototype": "bill_rag_ingestion_validation",
        "builds": builds,
        "summary": {
            "bills": len(builds),
            "ok_count": sum(1 for item in validations if item["ok"]),
            "all_ok": all(item["ok"] for item in validations),
            "total_sections": sum(item["section_count"] for item in validations),
            "total_chunks": sum(item["chunk_count"] for item in validations),
            "total_newline_reduction": sum(item["newline_reduction"] for item in validations),
            "total_low_info_chunks": sum(item["low_info_chunk_count"] for item in validations),
            "total_oversize_chunks": sum(item["oversize_chunk_count"] for item in validations),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    build_parser = subparsers.add_parser("build")
    build_parser.add_argument("--in", dest="input_path", type=Path, required=True)
    build_parser.add_argument("--out", type=Path, required=True)

    validate_parser = subparsers.add_parser("validate")
    validate_parser.add_argument("--in", dest="input_paths", type=Path, nargs="+", required=True)
    validate_parser.add_argument("--out", type=Path, required=True)

    args = parser.parse_args()

    if args.command == "build":
        payload = build_rag_payload(read_json(args.input_path))
        write_json(args.out, payload)
    elif args.command == "validate":
        payload = build_many(args.input_paths)
        write_json(args.out, payload)


if __name__ == "__main__":
    main()
