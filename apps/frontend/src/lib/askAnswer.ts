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
function stripInlineMarkdown(value: string): string {
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

/** One "From the bill" card: a cited section, and every passage it contributed. */
export interface CitedSection {
  /** Stable key + grouping identity. */
  key: string;
  /** Statute section id, when the answer path resolved one; '' otherwise. */
  sectionId: string;
  /** Which section that id names — its position in the version. */
  sectionOrder: number | null;
  /** The served citation label and section topic, passed to the card unchanged so
   *  the card composes the chip through `citationChipLabel` exactly once. */
  label: string;
  sectionTopic: string;
  /** Normalized chip text ("Art. 1, Sec. 24 · Public facilities authority"), for
   *  grouping and for the card's accessible name. */
  chipLabel: string;
  /** EVERY passage retrieval returned from this section, verbatim, in the order it
   *  returned them (best match first). Never trimmed — see `citedSections`. */
  excerpts: string[];
  /** Official source URL, the fallback target when the section anchor won't resolve. */
  url: string;
}

/**
 * One card per cited SECTION — with every one of that section's passages kept
 * (§9.5 decision 1, as revised Jul 31 2026).
 *
 * Retrieval returns up to four passages and they frequently share a section: the
 * sample question on HF 719 returns Sec. 24 (Silver Lake), Sec. 24 (International
 * Falls), Sec. 16 (Freeport), Sec. 24 (Cohasset). The mockup drew that as three
 * near-identical cards, which reads as broken. But those three are **three
 * different grants**, so keeping only the best-matching one and counting the rest
 * would throw away two thirds of the evidence while the answer kept its claim.
 *
 * So the grouping is about the LABEL, not the quotes: one purple location chip per
 * section, and all of that section's quotes stacked beneath it. On the HF 719
 * example that is two cards, one holding three quotes and one holding one.
 *
 * Deliberately NOT `citationsBySection` (`lib/billDetail.ts`), which the mobile
 * bill page uses: that surface shows the section label ALONE, so a repeat carries
 * no information and is dropped. Here every repeat carries a different passage.
 *
 * Grouped on the section's anchor — id AND position, because `section_id_text` is
 * not unique within a version (#854) and two genuinely different sections can
 * share an id. Falls back to the normalized chip label when the answer path
 * resolved no section, so passages from one section still share a card.
 */
export function citedSections(citations: AskCitation[]): CitedSection[] {
  const order: string[] = [];
  const byKey = new Map<string, CitedSection>();
  for (const citation of citations) {
    const chipLabel = citationChipLabel(citation.label, citation.sectionTopic);
    const anchor = citation.sectionId ? `${citation.sectionId}-${citation.sectionOrder ?? ''}` : '';
    const key = anchor || chipLabel || citation.label;
    const existing = byKey.get(key);
    if (existing) {
      existing.excerpts.push(citation.excerpt);
      continue;
    }
    order.push(key);
    byKey.set(key, {
      key,
      sectionId: citation.sectionId,
      sectionOrder: citation.sectionOrder,
      label: citation.label,
      sectionTopic: citation.sectionTopic,
      chipLabel,
      excerpts: [citation.excerpt],
      url: citation.url,
    });
  }
  return order.map((key) => byKey.get(key)!);
}

/**
 * Where a "From the bill" card should send the reader.
 *
 *  - `passage`  — the cited section inside our own Bill Text tab, scrolled to and
 *                 highlighted (`?tab=text#ft-<sectionId>-<sectionOrder>`).
 *  - `bill-text` — the Bill Text tab with no anchor, while its sections are still
 *                 loading and the anchor cannot be checked yet.
 *  - `official`  — out to the bill's official source, because our own text does
 *                 not carry the cited section at all.
 */
export type PassageTarget = 'passage' | 'bill-text' | 'official';

/**
 * Pick the target for one cited section (§9.5 decision 4 — a cited section links
 * to the passage in our own Bill Text tab, and falls back to the official source
 * rather than rendering a dead card).
 *
 * `resolves` answers "does an anchor for this section exist among the sections the
 * Bill Text tab actually renders?" — the caller supplies it from
 * `resolveSectionAnchor` (`lib/billText.ts`), the same resolver the tab itself uses
 * for an incoming URL fragment, so the two cannot disagree about where a link
 * lands. That check is not optional: retrieval may have run on a version whose
 * sections a later re-read of the bill has moved, and a link into text that no
 * longer carries the quoted passage is exactly the rule 5 failure the deep link
 * exists to avoid.
 *
 * `sectionsLoaded` is false while that text is still being fetched; until it lands
 * the anchor cannot be checked, so the card opens the tab without one rather than
 * guessing.
 */
export function passageTarget(
  sectionId: string,
  resolves: boolean,
  sectionsLoaded: boolean,
): PassageTarget {
  if (!sectionId) return 'official';
  if (!sectionsLoaded) return 'bill-text';
  return resolves ? 'passage' : 'official';
}

/**
 * The partial-coverage note that sits ABOVE the answer, or null for no note
 * (§9.5 decision 11, [#883]).
 *
 * **Why the page carries this and not the model.** On a long bill an answer is
 * routinely written from a fraction of the text and reads as complete. The #865
 * eval (`docs/product-onboarding/answer-quality-bar.md` §9) settled that a wider
 * passage window is NOT the fix — the overclaim rate is flat at 80% with 4
 * passages, 89% with 8, 80% with 16, and one model given four times the text
 * produced a longer list with a *stronger* completeness claim. Only 1 of 9 models
 * ever volunteered that its list was partial, and even that sentence landed at the
 * END of a long list, where a reader who skims and leaves never reaches it. A
 * guarantee cannot rest on that, so the caveat is fixed UI copy the layout owns
 * and the model cannot influence (`.claude/rules/grounded-answers.md` rule 3).
 *
 * Returns null in both safe directions: no served coverage (say nothing rather
 * than guess, so this ships before or after the backend), and full coverage (a
 * caveat on every answer teaches people to ignore it).
 *
 * The two numbers are a fact about OUR retrieval, not a count of the bill's
 * contents, which is why they are allowed here at all — decision 5 forbids a count
 * that reads as "this list is complete", and this sentence says the opposite.
 */
export function partialCoverageNote(
  coverage: { used: number; total: number } | undefined,
): string | null {
  if (!coverage) return null;
  const { used, total } = coverage;
  if (!(used > 0) || !(total > used)) return null;
  return `This answer draws on ${used} of the ${total} passages in this bill, so there may be more it doesn’t cover.`;
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
