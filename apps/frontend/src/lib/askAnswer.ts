/**
 * Display logic for the chip-reached Ask answer page.
 *
 * Spec of record: `docs/product-onboarding/grounded-ask-spec.md` §9.5 (The
 * chip-reached answer page — decided web design). Everything here is *display* —
 * it re-shapes what the answer path returned, and never re-words it
 * (`.claude/rules/grounded-answers.md` rules 3 and 4). Pure functions, so the
 * frontend test suite can pin them.
 */
import { AskCitation } from '../data/types';
import { citationChipLabel, DEFAULT_ASK_CHIPS } from './billDetail';

/** One block of the generated answer, in the order the model wrote it. */
export type AnswerBlock = { kind: 'paragraph'; text: string } | { kind: 'list'; items: string[] };

// A line the model wrote as a list item: "1. Silver Lake", "3) Cook", "- Cook",
// "• Cook". The marker is presentation, so it is dropped and the layout supplies
// its own; the item's own words pass through untouched.
const LIST_MARKER = /^\s*(?:\d{1,3}[.)]|[-*•])\s+/;

// The synthesis returns light markdown (**bold**); there is no markdown renderer
// on this page, so strip the emphasis markers rather than print them.
export function stripInlineMarkdown(value: string): string {
  return value.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1');
}

/**
 * Split the generated prose into paragraphs and lists, keeping the model's own
 * order and wording. A run of consecutive list lines becomes one list block; any
 * other run of lines becomes one paragraph, joined with single spaces (the model
 * hard-wraps mid-sentence, and a hard wrap is not a paragraph break).
 */
export function parseAnswerBlocks(prose: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    const text = paragraph.join(' ').trim();
    paragraph = [];
    if (text) blocks.push({ kind: 'paragraph', text });
  };
  const flushList = () => {
    const items = list;
    list = [];
    if (items.length) blocks.push({ kind: 'list', items });
  };

  for (const rawLine of stripInlineMarkdown(prose ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    if (LIST_MARKER.test(line)) {
      flushParagraph();
      list.push(line.replace(LIST_MARKER, '').trim());
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}

// The multi-column A→Z index is GATED (§9.5 decision 6). Re-ordering short names
// for scanning is a display choice, like sorting a table; re-flowing sentences
// into a grid is not, so a list of real sentences keeps the model's own order and
// shape. Nineteen city names pass; four explanatory clauses do not.
const INDEX_MIN_ITEMS = 8;
const INDEX_MAX_ITEM_CHARS = 32;

// "Reads as a sentence": it closes on sentence punctuation. Inside a 32-character
// cap that is the whole signal — nothing longer than a short name phrase fits,
// and a name phrase does not take a terminal mark.
//
// Deliberately NOT also checking for a period-plus-space *inside* the entry: that
// flagged "St. Francis", one of the nineteen real city names in the HF 719 answer,
// and abbreviations ("St.", "Mt.", "No.") are exactly what a list of place names
// is full of. The gate errs toward leaving the answer's own order alone, which is
// the safe direction — an un-sorted list is plainer than a mangled one.
function readsAsSentence(item: string): boolean {
  return /[.!?;:]$/.test(item);
}

/**
 * The list re-laid-out as a scannable A→Z index, or `null` to keep the answer's
 * own order and shape. Sorting is deterministic (locale compare, then a raw
 * tie-break) because a `?q=` link must re-render identically (§4.2).
 */
export function alphabeticalIndex(items: string[]): string[] | null {
  if (items.length < INDEX_MIN_ITEMS) return null;
  if (items.some((item) => item.length > INDEX_MAX_ITEM_CHARS)) return null;
  if (items.some(readsAsSentence)) return null;
  return [...items].sort((a, b) => a.localeCompare(b, 'en') || (a < b ? -1 : a > b ? 1 : 0));
}

/** One "From the bill" card: a cited section, quoted once. */
export interface CitedSection {
  /** Stable key + grouping identity. */
  key: string;
  /** Statute section id, when the answer path resolved one; '' otherwise. */
  sectionId: string;
  /** The served citation label and section topic, passed to the card unchanged so
   *  the card composes the chip through `citationChipLabel` exactly once. */
  label: string;
  sectionTopic: string;
  /** Normalized chip text ("Art. 1, Sec. 24 · Public facilities authority"), for
   *  grouping and for the card's accessible name. */
  chipLabel: string;
  /** The best-matching passage from this section, verbatim. */
  excerpt: string;
  /** Official source URL, the fallback target when the section id does not resolve. */
  url: string;
  /** How many further passages this section contributed, beyond the one quoted. */
  extraPassages: number;
}

/**
 * One card per cited SECTION, not per retrieved passage (§9.5 decision 1).
 * Retrieval returns up to four chunks and they frequently share a section — the
 * sample question on HF 719 returns three from Art. 1 Sec. 24 — which drew three
 * near-identical cards. Grouping keeps the first passage of each section, which
 * is the best-matching one (retrieval returns them by similarity), and counts the
 * rest so the card can say so once.
 *
 * Grouped by section id where the answer path resolved one, else by the
 * normalized chip label, so passages from one section still collapse on a bill
 * whose retrieval carries no section row.
 */
export function citedSections(citations: AskCitation[]): CitedSection[] {
  const order: string[] = [];
  const byKey = new Map<string, CitedSection>();
  for (const citation of citations) {
    const chipLabel = citationChipLabel(citation.label, citation.sectionTopic);
    const key = citation.sectionId || chipLabel || citation.label;
    const existing = byKey.get(key);
    if (existing) {
      existing.extraPassages += 1;
      continue;
    }
    order.push(key);
    byKey.set(key, {
      key,
      sectionId: citation.sectionId,
      label: citation.label,
      sectionTopic: citation.sectionTopic,
      chipLabel,
      excerpt: citation.excerpt,
      url: citation.url,
      extraPassages: 0,
    });
  }
  return order.map((key) => byKey.get(key)!);
}

/**
 * Where a "From the bill" card should send the reader.
 *
 *  - `passage`  — the cited section inside our own Bill Text tab, scrolled to and
 *                 highlighted (`?tab=text#ft-<sectionId>`).
 *  - `bill-text` — the Bill Text tab with no anchor: our text carries that section
 *                 but cannot point at one of them (see below).
 *  - `official`  — out to the bill's official source, because our own text does
 *                 not carry the cited section at all.
 */
export type PassageTarget = 'passage' | 'bill-text' | 'official';

/**
 * Pick the target for one cited section (§9.5 decision 4 — a cited section links
 * to the passage in our own Bill Text tab, and falls back to the official source
 * rather than rendering a dead card).
 *
 * `renderedSectionCounts` counts how many times each id appears among the sections
 * the Bill Text tab actually renders, because `section_id_text` is NOT unique
 * within a version — 66 (version, id) pairs in production name several sections,
 * and the tab anchors them all on the same `#ft-<id>`. So:
 *
 *  - exactly one section answers to the id → anchor to it.
 *  - several do → which one the citation means is genuinely unknowable, so no
 *    anchor: the tab plus its section index gets the reader there, and we never
 *    land them confidently on the wrong paragraph
 *    (`.claude/rules/grounded-answers.md` rule 1).
 *  - none does → our text does not carry it (retrieval ran on an earlier version),
 *    so the official record is the only honest target.
 *
 * `sectionsLoaded` is false while the text is still being fetched; until it lands
 * we cannot check the id, so the card links to the tab without an anchor rather
 * than guessing.
 */
export function passageTarget(
  sectionId: string,
  renderedSectionCounts: Map<string, number>,
  sectionsLoaded: boolean,
): PassageTarget {
  if (!sectionId) return 'official';
  if (!sectionsLoaded) return 'bill-text';
  const count = renderedSectionCounts.get(sectionId) ?? 0;
  if (count === 1) return 'passage';
  if (count > 1) return 'bill-text';
  return 'official';
}

/** "+2 more passages in this section", or null for a section that contributed one. */
export function extraPassagesLabel(extraPassages: number): string | null {
  if (extraPassages < 1) return null;
  return `+${extraPassages} more ${extraPassages === 1 ? 'passage' : 'passages'} in this section`;
}

// A chip label is scoped to its bill ("HF 719: Which cities …") before it is
// asked, so comparing the question the reader arrived with against the bill's
// stored prompts has to look past that prefix.
const SCOPE_PREFIX = /^\s*[hs]\.?\s*f\.?\s*(?:no\.?\s*)?\d{1,5}\s*:\s*/i;

function samePrompt(a: string, b: string): boolean {
  const normalize = (value: string) =>
    value.replace(SCOPE_PREFIX, '').trim().replace(/\s+/g, ' ').toLowerCase();
  return normalize(a) === normalize(b);
}

// "Ask another question" offers three (§9.5 decision 7).
const FOLLOW_UP_LIMIT = 3;

/**
 * The bill's own remaining suggested questions (§9.5 decision 7). Every enriched
 * bill stores four (`ai_analysis.question_prompts`); the reader just used one, so
 * offer the other three. They come from the bill, so a chip cannot dead-end in a
 * refusal (`.claude/rules/grounded-answers.md` rule 2).
 *
 * Deliberately NOT `askCardPrompts`, which Bill Detail's Ask card uses: that
 * helper spends the first prompt on the field's placeholder and offers prompts
 * 1–3 as chips, so here it would only ever leave two. Same field, same fallback
 * (`DEFAULT_ASK_CHIPS`) for a bill with no stored prompts.
 */
export function followUpPrompts(
  questionPrompts: string[] | undefined,
  askedQuestion: string,
): string[] {
  const prompts = (questionPrompts ?? [])
    .map((prompt) => prompt.trim())
    .filter((prompt) => prompt.length > 0)
    .filter((prompt) => !samePrompt(prompt, askedQuestion));
  const pool = prompts.length ? prompts : DEFAULT_ASK_CHIPS;
  return pool.slice(0, FOLLOW_UP_LIMIT);
}
