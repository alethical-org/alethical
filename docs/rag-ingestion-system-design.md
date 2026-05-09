# Alethical RAG Ingestion System Design

Status: first prototype loop

## Goal

Define what "good quality" means for Alethical's RAG ingestion pipeline, then shape the pipeline so bill text can be transformed from source-faithful canonical records into retrieval-safe chunks with strong provenance.

This document is intentionally separate from the source ingestion design. The source ingestion pipeline answers:

- what did the legislature publish
- when did it publish it
- where did it come from

The RAG ingestion pipeline answers:

- what text should we retrieve
- how should that text be cleaned
- how should it be chunked
- how do we preserve citations and traceability

## Executive Summary

The correct design is a second pipeline layered on top of canonical ingestion.

The canonical pipeline should preserve raw source artifacts and minimally normalized bill structure. The RAG pipeline should:

- derive a retrieval-safe text representation
- canonicalize amendment markers and whitespace
- preserve section-level provenance
- build chunked documents with stable citations
- validate output against explicit quality gates

The first prototype loop is good if it can take large omnibus bills and produce:

- no raw HTML
- no raw `new text begin/end` or `deleted text begin/end` markers
- no chunk without a bill, article, and section citation path when available
- no dropped sections
- bounded chunk sizes
- materially lower newline and formatting noise than source-shaped extraction

## Quality Bar

### 1. Fidelity

The RAG pipeline must preserve legal meaning and traceability.

Acceptance criteria:

- every RAG section document must reference:
  - bill key
  - bill version source URL
  - section ID
  - article ID when present
- every source section must produce at least one RAG section document
- every source section must be covered by at least one final chunk
- the pipeline must keep enough metadata to reconstruct a user-facing citation

### 2. Cleanliness

The RAG text must be materially cleaner than the source-shaped extraction.

Acceptance criteria:

- zero HTML tags in final section or chunk text
- zero raw `new text begin`, `new text end`, `deleted text begin`, `deleted text end` markers
- spaces before punctuation normalized away
- repeated blank-line noise collapsed
- isolated currency symbols and isolated short line fragments merged where possible

### 3. Legibility

The retrieved text should read like deliberate prose or structured notes, not like scraped DOM residue.

Acceptance criteria:

- section headings are preserved
- article headings are preserved when present
- amendatory text remains interpretable
- appendix material remains retrievable
- table-like appropriations blocks are converted into readable line groups instead of thousands of raw line breaks

### 4. Retrieval Quality

The text should be chunked for semantic retrieval rather than storage convenience.

Acceptance criteria:

- chunks stay within a target word range
- chunks respect section boundaries first
- large sections are split on paragraph-like boundaries, not arbitrary character cuts
- chunks include enough local context to stand alone in retrieval results
- low-information chunks are avoided unless the source section is itself very short

### 5. Reprocessability

RAG transforms will change. Reprocessing should not require re-scraping the Legislature.

Acceptance criteria:

- the RAG pipeline consumes canonical bill output, not live source pages
- cleaning version and chunking version are recorded
- chunk outputs can be rebuilt from canonical records alone

## Recommended Data Flow

1. `raw_source_artifact`
2. `canonical_bill` and `canonical_bill_version`
3. `rag_section_document`
4. `rag_chunk`
5. embeddings and retrieval index

## Proposed RAG Entities

### `rag_section_document`

Purpose:

- cleaned, citation-safe representation of a single section-level unit

Suggested fields:

- `bill_key`
- `version_source_url`
- `bill_title`
- `article_id`
- `article_number`
- `article_heading`
- `section_id`
- `section_heading`
- `statute_heading`
- `cite_heading`
- `effective_date_heading`
- `raw_text`
- `clean_text`
- `search_text`
- `cleaning_version`
- `source_hash`

### `rag_chunk`

Purpose:

- final retrieval unit

Suggested fields:

- `chunk_id`
- `bill_key`
- `section_id`
- `article_id`
- `chunk_index`
- `citation_label`
- `chunk_text`
- `search_text`
- `word_count`
- `chunking_version`
- `embedding_model`

## Cleaning Strategy

Recommended transforms, in order:

1. remove HTML and parser residue
2. normalize whitespace
3. rewrite amendment markers into readable inline forms
4. normalize punctuation spacing
5. convert table-like line sequences into readable grouped lines
6. preserve headings as explicit context fields

Important design choice:

- source-faithful text and RAG text are different products
- RAG text is allowed to be more readable than source text as long as provenance is preserved and legal meaning is not silently dropped

For amendatory language, a good v1 transform is:

- keep added language as normal text
- rewrite deleted language into explicit readable markers like `[deleted: ...]`

This is materially better than raw Revisor marker text and materially safer than simply deleting all struck language.

## Chunking Strategy

Recommended v1 chunking policy:

- split by section first
- for large sections, split by paragraph-like blocks
- include article and section context in every chunk
- target roughly 140 to 260 words per chunk
- hard cap around 320 words per chunk
- keep one-block overlap between adjacent chunks within the same section

This is a pragmatic v1 choice:

- small enough for retrieval precision
- large enough to preserve legislative meaning
- easy to cite

## Validation Strategy

Every RAG build should emit a validation report.

Minimum checks:

- source sections == cleaned section documents
- every section has at least one chunk
- banned markers count == 0 in cleaned text and chunk text
- HTML tag count == 0
- oversize chunk count == 0
- low-information chunk count is small and explainable
- before/after newline count is materially reduced

## Prototype Standard

For the current prototype loop, the standard is:

- run on at least two omnibus bills
- prove full section coverage
- produce section-level cleaned text and chunk-level outputs
- emit a machine-readable validation report
- show measurable reduction in newline and marker noise

## Out Of Scope For This Loop

- embedding model selection
- reranking
- retrieval evaluation against a labeled QA set
- hybrid search scoring
- cross-document synthesis prompts

Those matter, but they come after the text representation itself is trustworthy.
