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
// (issue #741). Nothing here needs to change when it does.

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
   *  promoted out of the body. This is provenance — which existing law the
   *  section rewrites — not the section's title, and renders as such. Null when
   *  there isn't one. */
  leadIn: string | null;
  /** The Legislature's own caption for the section ("Health plan.",
   *  "Definitions."), promoted out of the body to serve as the section's title
   *  when the stored heading carries none. Null when the source gives none, or
   *  when the caption carries a change marker — a struck caption stays in the
   *  body so its strike-through renders rather than reading as current law. */
  caption: string | null;
  blocks: SectionBlock[];
}

// A well-formed marker pair. The backreference keeps a "deleted" begin from
// closing on a "new" end; non-greedy so adjacent pairs stay separate.
const MARKER_PAIR = /(deleted|new) text begin([\s\S]*?)\1 text end/g;
// Any marker word left over once the pairs are consumed — an unclosed begin, a
// stray end. Stripped silently: a malformed source must never leak the words,
// and must never strike the rest of the section either.
const STRAY_MARKER = /(?:deleted|new) text (?:begin|end)/g;
// Non-global twin of STRAY_MARKER for one-off tests. `.test()` on a /g regex
// advances its lastIndex, so the same pattern must never serve both jobs.
const HAS_MARKER = /(?:deleted|new) text (?:begin|end)/;

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

// A statute number as the Revisor writes it: 115A.554, 62A.011, 3.732.
const STATUTE_NUMBER = String.raw`\d+[A-Z]?\.\d+`;
// "…, subdivision 3a, …" — carried into the short form because it is often the
// only thing that differs between two neighbouring sections. Without it a bill
// amending subdivisions 9 and 10 of one statute produces two identical rows,
// which is the failure the fallback exists to prevent.
const SUBDIVISION = /\bsubdivisions?\s+(\d+[a-z]?)/i;
// The citation forms a section can open with, most specific first.
const STATUTE_REFS: Array<{ pattern: RegExp; format: (m: RegExpMatchArray) => string }> = [
  // "Minnesota Statutes 2024, section 115A.554, subdivision 2, is amended…"
  {
    pattern: new RegExp(
      String.raw`Minnesota Statutes[^,]*,\s*sections?\s+(${STATUTE_NUMBER})`,
      'i',
    ),
    format: (m) => `§ ${m[1]}`,
  },
  // A new statute section states its own number in brackets: "[62A.011] …"
  { pattern: new RegExp(String.raw`^\[(${STATUTE_NUMBER})\]`), format: (m) => `§ ${m[1]}` },
  // "Minnesota Rules, part 7000.0100, is amended…"
  {
    pattern: /Minnesota Rules[^,]*,\s*parts?\s+(\d+\.\d+)/i,
    format: (m) => `Rules ${m[1]}`,
  },
  // "Laws 2023, chapter 71, article 1, section 10, subdivision 9…" — a bill
  // amending a past session law needs chapter, article AND section: 4 of the 10
  // sampled Laws citations shared a chapter with a sibling section.
  {
    pattern:
      /Laws\s+(\d{4})[^,]*,\s*chapter\s+(\d+)(?:[^,]*,\s*article\s+(\d+))?(?:[^,]*,\s*sections?\s+(\d+[a-z]?))?/i,
    format: (m) =>
      [`Laws ${m[1]}`, `ch. ${m[2]}`, m[3] ? `art. ${m[3]}` : null, m[4] ? `§ ${m[4]}` : null]
        .filter(Boolean)
        .join(', '),
  },
];
// An initialism ("U.S.C.", "M.S.A.") ends in a period that belongs to the word.
const INITIALISM_END = /(?:\b[A-Za-z]\.){2,}$/;

// Ingestion strips the Revisor's tags and leaves a space wherever one stood
// between a word and its punctuation, so a third of sections render "duties ." and
// "firefighters ; emergency". Closing that gap is presentation only — it moves no
// word and changes no claim, the same latitude the summary cleaners take
// (.claude/rules/grounded-answers.md rule 9). Only spaces and tabs, never a line
// break, so a paragraph that legitimately opens on punctuation is left alone.
// The durable fix belongs at ingestion (#741); this keeps the page readable until
// then, and stays as a guard afterwards.
//
// One guard, because the naive rule corrupts real statute text: a full stop
// followed by a digit is a DECIMAL POINT, not the end of a sentence. Statutes
// write bare decimals after a comma — "shall include, .22 caliber tube feeders",
// "$ .0025 per gallon" — and closing those gaps glued the number onto the
// punctuation before it (",.22 caliber").
//
// Deliberately NOT also requiring a letter or digit before the gap. Statutes end
// clauses on a closing bracket constantly — "paragraph (a) ." and "clause (3) ,"
// — and that stricter rule left 195 sampled sections with the space still there.
const SPACE_BEFORE_PUNCTUATION = /[ \t]+([;,:!?]|\.(?!\d))/g;

/** Tidy the whitespace flattening left behind. Presentation only. */
function tidySpacing(value: string): string {
  return value.replace(SPACE_BEFORE_PUNCTUATION, '$1');
}

/** Drop marker words and tidy the gap they leave behind. */
function stripMarkers(value: string): string {
  if (!value.includes('text b') && !value.includes('text e')) return value;
  return tidySpacing(value.replace(STRAY_MARKER, '').replace(/[ \t]{2,}/g, ' '));
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

  // The same stray space can straddle two runs — a plain run ending in a space
  // followed by a struck full stop — where tidying each run in isolation cannot
  // reach it. Same decimal guard as SPACE_BEFORE_PUNCTUATION.
  for (let i = 0; i < runs.length - 1; i++) {
    if (/^([;,:!?]|\.(?!\d))/.test(runs[i + 1].text)) {
      runs[i].text = runs[i].text.replace(/[ \t]+$/, '');
    }
  }

  return runs.filter((run) => run.text !== '');
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
 * A caption ("Health plan.", "REPEALER.") reads as a sentence fragment with its
 * trailing period but as a title without one, so drop it when the caption is
 * used as a heading. Capitalisation is left exactly as the source wrote it:
 * re-casing mangles the acronyms these captions carry (DNR, CHAMPUS) and an
 * exceptions list would need per-bill upkeep.
 */
export function asHeadingCaption(caption: string | null | undefined): string | null {
  const value = (caption ?? '').trim();
  if (!value) return null;
  if (!value.endsWith('.') || INITIALISM_END.test(value)) return value;
  return value.slice(0, -1).trim() || null;
}

/**
 * Condense a section's opening citation to a short reference ("§ 115A.554") for
 * an index row that has no caption to show. Returns null when the text carries
 * no citation to condense.
 */
export function condenseStatuteRef(text: string | null | undefined): string | null {
  const value = plainSectionText(text ?? '');
  if (!value) return null;
  for (const { pattern, format } of STATUTE_REFS) {
    const match = value.match(pattern);
    if (!match) continue;
    const short = format(match);
    // The subdivision always goes in when the opening citation names one: a bill
    // amending subdivisions 9 and 10 of one statute is two sections whose only
    // difference is that number, and dropping it made two identical rows.
    // Searched only up to the verb, so a "subdivision" mentioned later in the
    // body can't be mistaken for part of the citation.
    const verbAt = value.search(/\b(?:is|are)\s+(?:amended|repealed)\b/i);
    const subdivision = value.slice(0, verbAt === -1 ? 200 : verbAt).match(SUBDIVISION);
    return subdivision ? `${short}, subd. ${subdivision[1]}` : short;
  }
  return null;
}

/**
 * Split a stored heading into its number and its title. The Revisor puts both
 * in one line ("Sec. 16. REPEALER."), which is why the number badge was
 * printing whole headings. The title comes back heading-ready — no trailing
 * period, original capitals.
 */
export function splitSectionLabel(heading: string | null | undefined): {
  number: string | null;
  title: string | null;
} {
  const value = plainSectionText(heading ?? '');
  if (!value) return { number: null, title: null };
  const match = value.match(/^(?:Section|Sec\.)\s*(\d+[a-z]?)\s*\.\s*([\s\S]*)$/i);
  if (!match) return { number: null, title: asHeadingCaption(value) };
  return { number: `SEC. ${match[1].toUpperCase()}`, title: asHeadingCaption(match[2]) };
}

/** Statute source text carries long runs of blank lines between headnotes and
 *  their bodies; collapse them so paragraphs split cleanly. */
export function cleanSectionText(raw: string): string {
  return tidySpacing(raw)
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
 * Classify a section body into its landmarks.
 *
 * The Revisor publishes a section's caption two ways. When it sits inside the
 * `section_number` heading ("Sec. 3. APPROPRIATION EXTENSIONS.") the stored
 * heading carries it and `splitSectionLabel` recovers it — 21% of sampled
 * sections. When it sits in a sibling `<h3 class="headnote">` ("Health plan.")
 * ingestion leaves it loose in the body — 60% — so it is promoted to `caption`
 * here and rendered as the section's title. The opening amendment clause is
 * promoted separately to `leadIn`: it names which law the section rewrites, so
 * it is provenance above the title, not the title itself.
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

  // Promote the caption only when the heading gave no title, only when it opens
  // the body, and only when it is unchanged text. A struck caption stays in the
  // body so its strike-through renders — shown as a title it would read as
  // current law when the Legislature is removing it.
  let caption: string | null = null;
  if (!hasTitle && paragraphs.length) {
    const first = paragraphs[0];
    if (!HAS_MARKER.test(first) && isSubheading(plainSectionText(first))) {
      caption = plainSectionText(paragraphs.shift() ?? '');
    }
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

  return { leadIn, caption, blocks };
}

/**
 * The short label a section index row shows under its number — the same caption
 * the section's own card shows, so a row and its destination read alike.
 *
 * A row never shows a truncated statute sentence: where the source names no
 * caption (19% of sampled sections) the amendment clause is condensed to a short
 * reference instead ("§ 115A.554"), which fits a row and still distinguishes it
 * from its neighbours. Empty only when there is neither (6% of sections), where
 * the number stands alone.
 */
export function sectionIndexLabel(heading: string | null | undefined, text: string): string {
  const { title } = splitSectionLabel(heading);
  if (title) return title;
  const { leadIn, caption, blocks } = parseSectionBody(text, { hasTitle: false });
  const headnote = caption ?? blocks.find((b) => b.kind === 'subheading')?.text;
  if (headnote) return asHeadingCaption(plainSectionText(headnote)) ?? '';
  return condenseStatuteRef(leadIn ?? blocks[0]?.text ?? '') ?? '';
}
