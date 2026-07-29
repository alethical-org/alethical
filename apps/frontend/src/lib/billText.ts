// Bill Text tab parsing.
//
// The Revisor publishes an amending bill's change markers as screen-reader-only
// spans wrapping the changed run:
//
//   (CHAMPUS)<span class="sr-only">deleted text begin </span>
//            <span class="del" style="text-decoration: line-through">.</span>
//            <span class="sr-only">deleted text end </span>
//
// Ingestion flattens that HTML to text, so the hidden marker words land in
// `BillVersionSection.raw_text` as prose and the strike/underline styling is
// lost. These helpers turn the words back into formatting, and recover the
// section/subdivision landmarks the same flattening buried.
//
// Known corpus gap: `normalize_space` in alethical/pipeline/minnesota.py drops
// "new text begin"/"new text end" but keeps the deleted pair, so today only
// removals are marked in stored text. `parseChangeRuns` handles both kinds, so
// added text starts underlining on its own once ingestion stops stripping it
// (#TBD). Nothing here needs to change when it does.

/** How a run of section text differs from current law. */
export type ChangeKind = 'plain' | 'removed' | 'added';

export interface TextRun {
  kind: ChangeKind;
  text: string;
}

/** One paragraph of a section body, classified for rendering. */
export type SectionBlockKind = 'subheading' | 'clause' | 'subclause' | 'para';

export interface SectionBlock {
  kind: SectionBlockKind;
  text: string;
}

export interface SectionBody {
  /** The "Minnesota Statutes 2024, section 62A.011 … is amended to read:" line,
   *  promoted out of the body to serve as the section's heading line when the
   *  stored heading carries no title of its own. Null when there isn't one. */
  leadIn: string | null;
  blocks: SectionBlock[];
}

// A well-formed marker pair. The backreference keeps a "deleted" begin from
// closing on a "new" end; non-greedy so adjacent pairs stay separate.
const MARKER_PAIR = /(deleted|new) text begin([\s\S]*?)\1 text end/g;
// Any marker word left over once the pairs are consumed — an unclosed begin, a
// stray end. Stripped silently: a malformed source must never leak the words,
// and must never strike the rest of the section either.
const STRAY_MARKER = /(?:deleted|new) text (?:begin|end)/g;

const SUBHEADING_MAX = 80;
const LEAD_IN_MAX = 400;
const CLAUSE_START = /^\(\d+\)/;
// Statutory drafting nests (a) → (1) → (i). A roman-numeral clause is a child of
// the numbered clause above it, so it indents one level deeper — otherwise the
// numbered parent sits indented while its own children run flush left, which
// reads as the wrong way round. Only treated as roman when a clause precedes it,
// so a lone "(i)" in an (h) → (i) → (j) letter sequence stays a paragraph.
const ROMAN_CLAUSE_START = /^\([ivx]+\)/;
// A headnote is a noun phrase ("Direct fees.", "Conduct of business."); a short
// body sentence that happens to end in a period is not. A finite verb is what
// separates them — without this test, 15% of the paragraphs matching every other
// headnote rule are ordinary sentences, mostly effective-date and appropriation
// lines ("This section is effective the day following final enactment.").
const FINITE_VERB =
  /\b(?:is|are|was|were|shall|must|may|means?|include|includes|including|does|do|has|have|applies|apply)\b/i;
const SECTION_LABEL = /^(?:Sec\.|Section)\s*\d+[a-z]?\s*\./i;
const STATUTE_CITE_START = /^(?:Minnesota Statutes|Minnesota Rules|Laws\s+\d{4})\b/;
const AMENDS_OR_REPEALS = /\b(?:is|are)\s+(?:amended|repealed)\b|\bto\s+read:\s*$/i;

/** Drop marker words and tidy the gap they leave behind. */
function stripMarkers(value: string): string {
  if (!value.includes('text b') && !value.includes('text e')) return value;
  return value.replace(STRAY_MARKER, '').replace(/[ \t]{2,}/g, ' ');
}

/**
 * Split section text into plain / removed / added runs so the marker words can
 * render as strike-through and underline instead of printing as language.
 */
export function parseChangeRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];

  const push = (kind: ChangeKind, raw: string) => {
    const stripped = stripMarkers(raw);
    const body = kind === 'plain' ? stripped : stripped.trim();
    if (!body) return;
    const last = runs[runs.length - 1];
    if (last && last.kind === kind) last.text += body;
    else runs.push({ kind, text: body });
  };

  let cursor = 0;
  for (const match of text.matchAll(MARKER_PAIR)) {
    const at = match.index ?? 0;
    push('plain', text.slice(cursor, at));
    push(match[1] === 'deleted' ? 'removed' : 'added', match[2]);
    cursor = at + match[0].length;
  }
  push('plain', text.slice(cursor));

  return runs;
}

/** Section text with every marker word removed — for classifying and labelling. */
export function plainSectionText(text: string): string {
  return stripMarkers(text.replace(MARKER_PAIR, '$2')).trim();
}

/** Which kinds of change a bill's sections actually contain, so the legend only
 *  claims the treatments the reader can see (grounded-answers rule 6). */
export function changeKindsPresent(texts: Array<string | null | undefined>): {
  removed: boolean;
  added: boolean;
} {
  let removed = false;
  let added = false;
  for (const text of texts) {
    if (!text) continue;
    for (const match of text.matchAll(MARKER_PAIR)) {
      if (match[1] === 'deleted') removed = true;
      else added = true;
    }
    if (removed && added) break;
  }
  return { removed, added };
}

/**
 * Split a stored heading into its number and its title. The Revisor puts both
 * in one line ("Sec. 16. REPEALER."), which is why the number badge was
 * printing whole headings.
 */
export function splitSectionLabel(heading: string | null | undefined): {
  number: string | null;
  title: string | null;
} {
  const value = plainSectionText(heading ?? '');
  if (!value) return { number: null, title: null };
  const match = value.match(/^(?:Section|Sec\.)\s*(\d+[a-z]?)\s*\.\s*([\s\S]*)$/i);
  if (!match) return { number: null, title: value };
  return { number: `SEC. ${match[1].toUpperCase()}`, title: match[2].trim() || null };
}

/** Statute source text carries long runs of blank lines between headnotes and
 *  their bodies; collapse them so paragraphs split cleanly. */
export function cleanSectionText(raw: string): string {
  return raw
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{2,}/g, '\n\n')
    .trim();
}

function isAmendmentClause(plain: string): boolean {
  if (plain.length > LEAD_IN_MAX) return false;
  return STATUTE_CITE_START.test(plain) || AMENDS_OR_REPEALS.test(plain);
}

// A subdivision headnote ("Health plan.", "Direct fees."). The Revisor marks
// these as <h3 class="headnote">, but ingestion strips only h1/h2 headings, so
// they survive as bare one-line paragraphs — recognisable by standing alone,
// being short, ending in a period and carrying no clause or section number.
function isSubheading(plain: string): boolean {
  if (!plain || plain.includes('\n')) return false;
  if (plain.length > SUBHEADING_MAX) return false;
  if (!plain.endsWith('.')) return false;
  if (plain.startsWith('(')) return false;
  if (FINITE_VERB.test(plain)) return false;
  // Never absorb a real section header into a section's body.
  if (SECTION_LABEL.test(plain)) return false;
  return !isAmendmentClause(plain);
}

/**
 * Classify a section body into its landmarks. When the section's stored heading
 * carries no title, the opening amendment clause is promoted to `leadIn` and
 * rendered as the heading line — otherwise 17 of the 21 sections on a bill like
 * SF 4214 would show a blank heading and no landmark at all.
 */
export function parseSectionBody(text: string, { hasTitle }: { hasTitle: boolean }): SectionBody {
  const paragraphs = cleanSectionText(text)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  let leadIn: string | null = null;
  if (!hasTitle && paragraphs.length && isAmendmentClause(plainSectionText(paragraphs[0]))) {
    leadIn = paragraphs.shift() ?? null;
  }

  const blocks: SectionBlock[] = [];
  for (const paragraph of paragraphs) {
    const plain = plainSectionText(paragraph);
    const previous = blocks[blocks.length - 1]?.kind;
    const nested = previous === 'clause' || previous === 'subclause';
    let kind: SectionBlockKind = 'para';
    if (isSubheading(plain)) kind = 'subheading';
    else if (CLAUSE_START.test(plain)) kind = 'clause';
    else if (nested && ROMAN_CLAUSE_START.test(plain)) kind = 'subclause';
    blocks.push({ kind, text: paragraph });
  }

  return { leadIn, blocks };
}

/**
 * The short label a section index row shows under its number. Empty when the
 * source gives nothing to say, so the row shows its number alone rather than
 * repeating it as a label.
 */
export function sectionIndexLabel(heading: string | null | undefined, text: string): string {
  const { title } = splitSectionLabel(heading);
  if (title) return title;
  const { leadIn, blocks } = parseSectionBody(text, { hasTitle: false });
  // Prefer the first subdivision headnote ("Due dates.") over the amendment
  // clause: the clause is a long citation that truncates to the same
  // "Minnesota Statutes 2024, section …" on row after row, making neighbouring
  // rows indistinguishable.
  const headnote = blocks.find((b) => b.kind === 'subheading')?.text;
  return plainSectionText(headnote ?? leadIn ?? '');
}
