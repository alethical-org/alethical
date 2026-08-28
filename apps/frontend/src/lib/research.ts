/**
 * The registry of everything Alethical publishes in its own name — research
 * pieces and guides both (`.claude/rules/grounded-answers.md` rule 13;
 * `docs/architecture/published-writing-decisions.md`).
 *
 * A piece carries 2 trait flags rather than 1 kind, and the label a reader sees
 * is derived from them. The names here still say `research` throughout because
 * the research piece shipped first; the container concept is a **piece**, and
 * renaming the type, the constant and the screen is recorded as naming debt on
 * issue 1752 rather than done in the same change that adds guides.
 *
 * A signed piece is the one surface allowed to add figures up across members,
 * cite filing bodies beyond Minnesota's Campaign Finance Board, and define
 * derived classifications — under rule 13's conditions. This file holds the
 * machinery for that surface. Posting a piece means adding its entry to
 * `PUBLISHED_RESEARCH`: the piece's page, the share preview, the /read page,
 * the money landing and the sitemap all read this registry. A piece's `indexed` flag
 * decides only whether search engines may list it.
 *
 * Framework-free, in the style of lib/billDetail.ts: every sentence the piece
 * chrome shows is decided by data in this shape, so tests can exercise the
 * populated states (masthead, correction, newer-filings banner) with sample
 * content that never ships on a route.
 */

import { IA } from '../navigation/ia';
import { MONEY_ONLY_GOES_ONE_WAY } from './researchPieces/moneyOnlyGoesOneWay';
import { MONEY_SPENT_WITHOUT_A_CAMPAIGNS_SAY } from './researchPieces/moneySpentWithoutACampaignsSay';
import { WHAT_THE_RECORDS_NAME } from './researchPieces/whatTheRecordsName';
import { WHO_HAS_TO_REPORT_THEIR_MONEY } from './researchPieces/whoHasToReportTheirMoney';
import { WHY_NOBODY_CAN_FOLLOW_A_DOLLAR } from './researchPieces/whyNobodyCanFollowADollar';
import { WHY_TWO_OFFICIAL_NUMBERS_CAN_BOTH_BE_RIGHT } from './researchPieces/whyTwoOfficialNumbersCanBothBeRight';

/**
 * One run of piece prose.
 *
 * An `externalLink` leaves the site, to a filing body or the statutes. An
 * `internalLink` points at another page of ours, and exists only because a piece
 * may now name a term another posted piece owns: issue 1752's linking rule 6
 * allows a link the day its destination posts and not before, and
 * `docs/architecture/published-writing-decisions.md` §2.6 requires a person to
 * author each one. Nothing here matches terms automatically. A committee record
 * page is still not a valid destination, because none exists.
 */
export type ResearchInline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'externalLink'; text: string; href: string }
  | { kind: 'internalLink'; text: string; href: string };

export type ResearchBlock =
  | { kind: 'paragraph'; runs: ResearchInline[] }
  | { kind: 'bullets'; items: ResearchInline[][] }
  /** A small table the piece's prose introduces. Plain strings: a table states
   * filed figures, so it carries no links, no emphasis and no derived label. */
  | { kind: 'table'; columns: string[]; rows: string[][] }
  /**
   * A short note qualifying a figure the prose has just given: where 2 official
   * records disagree, or where a figure comes from records we do not hold. Drawn
   * as the method box's twin, one family with `methodologyInset`, because both
   * are us showing our work rather than warning of a problem (Design, 27 Aug
   * 2026). The words carry the meaning; the box only helps a scanning reader
   * notice, so nothing is lost by a reader who cannot see the styling.
   */
  | { kind: 'note'; text: string };

export interface ResearchSection {
  /** The section heading, exactly as the piece's text writes it. The heading is
   * also what the section's link target is built from — see
   * `researchSectionAnchors` — so there is no second, hand-kept list to fall out of
   * step with it. */
  heading: string;
  /** The short label the contents rail shows for this section. */
  railLabel: string;
  blocks: ResearchBlock[];
  /**
   * Layout-owned method inset drawn after this section's prose (rule 13: a
   * derived classification publishes its complete method beside its first use,
   * stating the window it was computed on).
   */
  methodologyInset?: { title: string; body: string };
}

/** One entry in the where-these-numbers-come-from block. */
export interface ResearchSource {
  text: string;
  /** Clarifying sentence after the source name, in the same ink as the source. */
  note?: string;
  /** Outward link inside the note (e.g. to the FEC). Never an inward link the
   * site cannot honor yet. */
  noteLink?: { text: string; href: string };
}

export interface ResearchCorrection {
  /** e.g. "CORRECTED SEP 2 2026" */
  datedLabel: string;
  /** One banner sentence saying what moved. The piece's own text already holds
   * the corrected wording: rule 13 replaces a wrong figure rather than leaving it
   * readable with a line through it, so this banner is the only trace of the
   * change (Eugene, 25 Aug 2026). */
  note: string;
}

/**
 * Which of Alethical's 2 kinds of writing a piece carries. Two flags rather
 * than one `kind` value, because a piece can carry both and 1 of the planned
 * pieces already does: a guide that adds a figure up across legislators needs
 * `.claude/rules/grounded-answers.md` rule 13 in full
 * (`docs/architecture/published-writing-decisions.md` §2.8). A single-value
 * field would make that case impossible to state.
 *
 * The label a reader sees is derived, never stored: research trait present means
 * the label reads Research (§2.7), so a both-traits piece cannot show 2 labels
 * and claim 2 sets of promises when only the stricter one governs.
 */
export interface PieceTraits {
  research: boolean;
  guide: boolean;
}

/**
 * A set is a group of pieces written to be read together. A piece does not need
 * one (§2.2).
 *
 * `position` is the reading order inside the set and is used for ORDERING ONLY.
 * No reader-facing surface prints it — not "piece 1", not "piece 1 of 5", not a
 * numbered row (§2.12, Eugene 27 Aug 2026). The set's name alone is what a
 * reader is told.
 */
export interface PieceSet {
  name: string;
  position: number;
}

export interface ResearchPiece {
  /**
   * URL slug under the piece's own folder: /read/research/ for a piece
   * carrying the research trait, /read/guides/ for one carrying only the
   * guide trait (§2.1). `pieceAddressFolder` is the single place that decides.
   */
  slug: string;
  /** Which kinds this piece carries. The reader-facing label derives from it. */
  traits: PieceTraits;
  /** The set this piece belongs to, where it belongs to one. */
  set?: PieceSet;
  /**
   * Whether search engines may list the piece. **Every published piece is
   * visible from the day it posts (Eugene, 25 Aug 2026)**, so this is `true` on
   * anything we publish and the field exists only to hold a piece back for a
   * reason Eugene names. It governs the sitemap row, the indexing tag and the
   * canonical link together, so all 3 follow from the one value.
   */
  indexed: boolean;
  title: string;
  /** Masthead and listing standfirst. Never appears in share previews (rule 13:
   * share previews carry title and dates only). */
  dek: string;
  /**
   * The byline. Kept on the record, rendered nowhere since 20 Aug 2026: the
   * masthead now carries the 2 dates alone (rule 13's publishing order, point
   * 8), and a piece published in Alethical's own name needs no byline because
   * the site is the author. A piece signed by a person names them in its own
   * text. Never an invented name.
   */
  authorLine: string;
  /** ISO date the piece was published, e.g. "2026-08-17". */
  publishedOn: string;
  /**
   * ISO date the records run through, e.g. "2026-08-11". A research piece's
   * masthead prints it beside the publication date (rule 13's publishing order,
   * point 8). A guide's masthead prints 1 date and no second one, so on a guide
   * this is the record of which release its figures were computed from rather
   * than a line a reader sees; the guide's own prose states that date beside the
   * figure.
   */
  recordsThrough: string;
  /**
   * ISO date somebody last re-checked the piece against the records, distinct
   * from the publication date (settled 26 Aug 2026,
   * `docs/architecture/published-writing-decisions.md` §4.4).
   *
   * Absent, the slot reads "Written August 2026" and promises nothing. Present,
   * the same slot reads "Checked March 2027": one word swapped, never a second
   * date. That is the point of the swap — re-verifying a piece moves its date
   * forward, so staying accurate makes a piece look current instead of old,
   * while a "Checked" date that never moves would say we stopped looking.
   */
  checkedOn?: string;
  /**
   * Every filing body the piece used. Kept on the record, rendered nowhere
   * since 20 Aug 2026: the sources block names the bodies in its own prose
   * (rule 13).
   */
  filingBodies: string[];
  /**
   * Set when the piece draws a figure from records Alethical does not hold, so
   * that figure has no records-through date. Kept on the record, rendered
   * nowhere since 20 Aug 2026 (Eugene's call): the sources block names those
   * records and the years they cover instead (rule 13's publishing order, point
   * 11).
   */
  undatedRecordsNote?: string;
  /** The boxed opening summary ("SHORT VERSION"). Empty when a piece has none. */
  shortVersion: ResearchBlock[];
  /**
   * Prose before the first section heading, drawn as ordinary paragraphs rather
   * than in a box. A guide opens by saying what it is about; that is not a short
   * version of a set of findings and must not be dressed as one.
   */
  intro?: ResearchBlock[];
  sections: ResearchSection[];
  /** The where-these-numbers-come-from block: 1 outward link per entry. */
  sources: ResearchSource[];
  /**
   * The same block for a piece whose source sentences carry MORE than 1 outward
   * link each. The guide's closing block names 7 sources across 11 links, and
   * `ResearchSource` holds 1 link per entry, so squeezing it into that shape
   * would break sentences that rule 13 forbids editing.
   *
   * A piece sets exactly one of `sources` and `sourceRuns` (pinned by
   * research.test.ts); new pieces should reach for this one, which is the general
   * shape.
   *
   * This used to add that `sources` is kept "because the posted research piece is
   * served from it today and rearranging a live page's served text buys nothing".
   * That was true when written and stopped being true on 28 Aug 2026, so the
   * research piece has moved. Rule 13 now requires the records behind a
   * cross-member figure computed from records we do not hold to be named AND
   * LINKED, and *The Money Only Goes One Way*'s lobbying entry needs 2 addresses
   * to satisfy it: the list a reader looks 1 organisation up in, and the download
   * its $886 million total reproduces from. One entry, 2 links, and this shape
   * holds 1. So the conversion now buys the thing the old note priced at nothing.
   * `sources` stays for the pieces still served from it.
   */
  sourceRuns?: ResearchInline[][];
  /** Set when a figure was corrected after publication. */
  correction?: ResearchCorrection;
  /**
   * Set when the Board has accepted filings newer than recordsThrough. The
   * banner is dated, never a silent edit (rule 13).
   */
  newerFilingsNote?: string;
}

/**
 * The /read page's own fixed wording, in one place because 3 surfaces draw
 * it: the screen, its search description in lib/share.ts, and the text
 * served in the first response before any JavaScript runs
 * (lib/pageSnapshot.ts). A second copy is how a served page and a rendered page
 * start disagreeing, which is worse than either one being wrong alone.
 */

/**
 * The page's own name, taken from the label the top bar already draws for it
 * rather than typed again here.
 *
 * The page shows no visible title: the bar and the address both say the word
 * already, and a third visible instance is what the naming rule forbids (Design,
 * 27 Aug 2026). So this is the name a screen reader reads off the visually
 * hidden `h1` and the name the browser tab carries, and nothing draws it in ink.
 *
 * Read off the bar's own item because that is Design's whole reason for hiding
 * the title: 2 copies of the word could disagree, and this one cannot.
 */
export const READ_PAGE_NAME = IA.find((item) => item.id === 'read')?.label ?? 'Read';

/**
 * The page's descriptive title, for the 2 places its name has to survive out of
 * context: the back link at the top of a piece, and the share card. Neither has
 * the bar or the address beside it to supply the subject, so neither can use
 * `READ_PAGE_NAME`, because "Read" alone tells a person nothing about what they
 * would be opening.
 */
export const READ_PAGE_HEADING = 'Campaign money research and guides';

/**
 * The note under the hidden title. A note rather than a heading, in regular
 * weight and grey, because the bold heads on this page are the kind sections and
 * a reader should see the shape of what we publish before reading a sentence
 * about it (Design, 27 Aug 2026). No terminal period: nothing on this page takes
 * one.
 */
export const READ_PAGE_INTRO =
  'What we found in Minnesota\u2019s public records, plus guides to how state government works';
export const READ_PAGE_EMPTY_TITLE = 'Nothing published yet.';
export const READ_PAGE_EMPTY_BODY =
  'When we publish research or a guide on these records, it appears here, dated and carrying the date its records run through.';

/**
 * The 2 group headings on the /read page, research first (Eugene, 27 Aug
 * 2026, overruling the drawn order). Grouping by our own 2 kinds is deliberate
 * and its objection is recorded: a reader arrives with a subject in mind rather
 * than a genre, and the page is revisited at 4 sets or a dozen research pieces
 * (§2.11).
 *
 * A card under one of these headings prints no kind word of its own: the heading
 * is the source and the card inherits, or the page says "Guide" twice in one
 * glance (§2.10).
 */
export const READ_RESEARCH_GROUP_HEADING = 'RESEARCH';
export const READ_GUIDES_GROUP_HEADING = 'GUIDES';

/**
 * One run of piece prose as a reader sees it: the runs joined, because the
 * screen draws them as neighbouring texts inside one paragraph. Emphasis and an
 * outward link contribute their words and nothing else, so this is the same
 * sentence in both places.
 */
export function researchRunsText(runs: ResearchInline[]): string {
  return runs.map((run) => run.text).join('');
}

/** Every source line as the sources block draws it: the entry, its note, its link text. */
export function researchSourceText(source: ResearchSource): string {
  // The link's own words are deliberately absent: a snapshot renders them as a real
  // anchor beside this sentence, so including them here would print them twice.
  return [source.text, source.note].filter(Boolean).join(' ');
}

/**
 * Every posted piece, newest first. Posting puts a piece on the site, so this
 * is what the /read page, the money landing and every address-based reader
 * show. Whether a search engine may list it is the separate `indexed` flag.
 */
export const PUBLISHED_RESEARCH: ResearchPiece[] = [
  WHAT_THE_RECORDS_NAME,
  WHO_HAS_TO_REPORT_THEIR_MONEY,
  WHY_TWO_OFFICIAL_NUMBERS_CAN_BOTH_BE_RIGHT,
  MONEY_SPENT_WITHOUT_A_CAMPAIGNS_SAY,
  WHY_NOBODY_CAN_FOLLOW_A_DOLLAR,
  MONEY_ONLY_GOES_ONE_WAY,
];

/** Every posted piece, of either kind: the /read page reads this. */
export function publishedResearch(): ResearchPiece[] {
  return PUBLISHED_RESEARCH;
}

/**
 * The label a reader sees for a piece: **Research** when it carries the research
 * trait, otherwise **Guide** (§2.7). Derived, never stored, so a both-traits
 * piece shows 1 label and cannot claim 2 sets of promises.
 */
export function pieceKindLabel(piece: Pick<ResearchPiece, 'traits'>): 'Research' | 'Guide' {
  return piece.traits.research ? 'Research' : 'Guide';
}

/**
 * The folder a piece's address sits in: `research` for anything carrying the
 * research trait, including a piece that also teaches, and `guides` for a piece
 * carrying only the guide trait (§2.1). One place decides, so a piece has
 * exactly 1 address and the router can reject the other one.
 */
export function pieceAddressFolder(piece: Pick<ResearchPiece, 'traits'>): 'research' | 'guides' {
  return piece.traits.research ? 'research' : 'guides';
}

/** A piece's own address, the only one it answers on. */
export function piecePath(piece: Pick<ResearchPiece, 'traits' | 'slug'>): string {
  return `/read/${pieceAddressFolder(piece)}/${encodeURIComponent(piece.slug)}`;
}

/** Posted pieces the page labels Research, newest first. */
export function piecesLabelledResearch(): ResearchPiece[] {
  return PUBLISHED_RESEARCH.filter((piece) => pieceKindLabel(piece) === 'Research');
}

/** Posted pieces the page labels Guide, newest first. */
export function piecesLabelledGuide(): ResearchPiece[] {
  return PUBLISHED_RESEARCH.filter((piece) => pieceKindLabel(piece) === 'Guide');
}

/**
 * The pieces a search engine may list. Only the sitemap reads this, so a piece
 * still waiting on its figure check is out of the sitemap by construction rather
 * than by the sitemap remembering to check.
 */
export function indexedResearch(): ResearchPiece[] {
  return PUBLISHED_RESEARCH.filter((piece) => piece.indexed);
}

/**
 * The link target for one section heading: the heading's own words, lowercased,
 * with punctuation dropped and spaces turned into hyphens.
 *
 * Built from the words rather than the section's position, because a shared
 * `/read/research/{slug}#{anchor}` link has to survive a section being inserted above
 * it — a positional `#s3` would silently start pointing at a different section
 * (rule 13 is explicit that a posted piece's addresses are stable). Apostrophes
 * and quote marks are removed rather than hyphenated, so "the candidate's
 * behalf" reads as `the-candidates-behalf` and not `the-candidate-s-behalf`.
 */
export function researchSectionAnchor(heading: string): string {
  const slug = heading
    .toLowerCase()
    .replace(/['\u2018\u2019"\u201c\u201d]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'section';
}

/**
 * Every section's link target, in document order, aligned index-for-index with
 * the sections passed in. Two headings that slug the same way get a numeric
 * suffix (`-2`, `-3`) in document order, so an id never names two places.
 *
 * The contents rail and the article both read this one list, which is why the
 * rail cannot drift out of step with the headings it points at.
 */
export function researchSectionAnchors(sections: Pick<ResearchSection, 'heading'>[]): string[] {
  const used = new Map<string, number>();
  return sections.map((section) => {
    const base = researchSectionAnchor(section.heading);
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    return seen === 0 ? base : `${base}-${seen + 1}`;
  });
}

export function researchBySlug(slug: string): ResearchPiece | undefined {
  return PUBLISHED_RESEARCH.find((piece) => piece.slug === slug);
}

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * "2026-08-17" → "Aug 17, 2026". Parsed by hand so the label cannot shift a day
 * with the reader's time zone, which `new Date(iso)` (UTC midnight) would do.
 */
export function isoDateLabel(isoDate: string): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return isoDate;
  const month = MONTH_LABELS[Number(match[2]) - 1];
  if (!month) return isoDate;
  return `${month} ${Number(match[3])}, ${match[1]}`;
}

/**
 * The mono-caps card form: "AUG 20, 2026". The comma is Design's, and it is the
 * only place the 2 forms differ: a card's date sits inside a sentence of mono
 * caps beside the minutes, where the comma is what stops the day and the year
 * running together.
 */
export function isoDateCommaCapsLabel(isoDate: string): string {
  return isoDateLabel(isoDate).toUpperCase();
}

/** The mono-caps masthead form: "AUG 17 2026". */
export function isoDateCapsLabel(isoDate: string): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return isoDate.toUpperCase();
  const month = MONTH_LABELS[Number(match[2]) - 1];
  if (!month) return isoDate.toUpperCase();
  return `${month.toUpperCase()} ${Number(match[3])} ${match[1]}`;
}

/** "PUBLISHED AUG 17 2026 · RECORDS THROUGH AUG 11 2026" — listing and masthead. */
export function researchDatesLine(piece: Pick<ResearchPiece, 'publishedOn' | 'recordsThrough'>) {
  return `PUBLISHED ${isoDateCapsLabel(piece.publishedOn)} · RECORDS THROUGH ${isoDateCapsLabel(piece.recordsThrough)}`;
}

/** What search metadata and prepared share text may carry: the piece's two dates. */
export function researchShareDescription(
  piece: Pick<ResearchPiece, 'publishedOn' | 'recordsThrough'>,
): string {
  return `Published ${isoDateLabel(piece.publishedOn)} · records through ${isoDateLabel(piece.recordsThrough)}.`;
}

/** The quiet identity line shown inside the Share panel. */
export function researchSharePanelDescription(piece: Pick<ResearchPiece, 'publishedOn'>): string {
  return `Published ${isoDateLabel(piece.publishedOn)}`;
}

// --- Reading time, and the written-or-checked date ---

/**
 * How many words a reader reads in the piece itself: every heading, every
 * sentence, every bullet, every table cell, every inset, and the closing sources
 * block. The title and the standfirst are the masthead rather than the piece, so
 * they are left out.
 *
 * Counted from the piece's own stored words and never typed, because a typed
 * number goes stale the first time a sentence changes (§4.3, and the 25 Aug 2026
 * ruling behind it).
 */
export function pieceWordCount(piece: ResearchPiece): number {
  const runs = (items: ResearchInline[]) => researchRunsText(items);
  const fromBlocks = (blocks: readonly ResearchBlock[]): string[] =>
    blocks.flatMap((block) => {
      if (block.kind === 'paragraph') return [runs(block.runs)];
      if (block.kind === 'bullets') return block.items.map(runs);
      if (block.kind === 'note') return [block.text];
      return [...block.columns, ...block.rows.flat()];
    });

  const text = [
    ...fromBlocks(piece.shortVersion),
    ...fromBlocks(piece.intro ?? []),
    ...piece.sections.flatMap((section) => [
      section.heading,
      ...fromBlocks(section.blocks),
      ...(section.methodologyInset
        ? [section.methodologyInset.title, section.methodologyInset.body]
        : []),
    ]),
    ...piece.sources.map(researchSourceText),
    ...piece.sources.flatMap((source) => (source.noteLink ? [source.noteLink.text] : [])),
    ...(piece.sourceRuns ?? []).map(runs),
  ].join(' ');

  return text.split(/\s+/).filter(Boolean).length;
}

/** Words a reader gets through in a minute. The ordinary adult silent-reading rate. */
export const WORDS_PER_MINUTE = 200;

/** The piece's reading time in whole minutes, never below 1. */
export function pieceReadingMinutes(piece: ResearchPiece): number {
  return Math.max(1, Math.round(pieceWordCount(piece) / WORDS_PER_MINUTE));
}

const FULL_MONTH_LABELS = [
  'JANUARY',
  'FEBRUARY',
  'MARCH',
  'APRIL',
  'MAY',
  'JUNE',
  'JULY',
  'AUGUST',
  'SEPTEMBER',
  'OCTOBER',
  'NOVEMBER',
  'DECEMBER',
] as const;

/**
 * "2026-08-27" → "AUGUST 2026". Month and year only: the day a guide was written
 * is precision nobody needs about a piece that explains a standing rule, and
 * parsed by hand for the same reason `isoDateLabel` is, so the label cannot shift
 * a month with the reader's time zone.
 */
export function isoMonthYearCapsLabel(isoDate: string): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})/);
  if (!match) return isoDate.toUpperCase();
  const month = FULL_MONTH_LABELS[Number(match[2]) - 1];
  if (!month) return isoDate.toUpperCase();
  return `${month} ${match[1]}`;
}

/**
 * "WRITTEN AUGUST 2026" until somebody re-checks the piece, "CHECKED MARCH 2027"
 * from then on. Same slot, 1 word swapped, and never 2 dates (§4.4).
 */
export function pieceWrittenLine(piece: Pick<ResearchPiece, 'publishedOn' | 'checkedOn'>): string {
  return piece.checkedOn
    ? `CHECKED ${isoMonthYearCapsLabel(piece.checkedOn)}`
    : `WRITTEN ${isoMonthYearCapsLabel(piece.publishedOn)}`;
}

/** The sentence-case form of the same slot, for a share preview and a page description. */
export function pieceWrittenSentence(
  piece: Pick<ResearchPiece, 'publishedOn' | 'checkedOn'>,
): string {
  const line = pieceWrittenLine(piece);
  const [word, ...rest] = line.split(' ');
  const month = rest[0] ? `${rest[0][0]}${rest[0].slice(1).toLowerCase()}` : '';
  return `${word[0]}${word.slice(1).toLowerCase()} ${[month, rest[1]].filter(Boolean).join(' ')}.`;
}

/**
 * The masthead line under a piece's title.
 *
 * A research piece carries its 2 dates and nothing else — rule 13's publishing
 * order, point 8, is explicit — so no kind word and no minutes join it there.
 * A guide carries its kind, its reading time and its 1 date, which is the line
 * Design settled and Eugene ruled on: "GUIDE · 5 MIN · WRITTEN AUGUST 2026",
 * with no piece number anywhere in it (§2.12).
 */
export function pieceMastheadLine(piece: ResearchPiece): string {
  if (piece.traits.research) return researchDatesLine(piece);
  return [
    pieceKindLabel(piece).toUpperCase(),
    `${pieceReadingMinutes(piece)} MIN`,
    pieceWrittenLine(piece),
  ].join(' · ');
}

/** What a piece's own page metadata and prepared share text may carry: its dates. */
export function pieceShareDescription(piece: ResearchPiece): string {
  return piece.traits.research ? researchShareDescription(piece) : pieceWrittenSentence(piece);
}

/** The quiet identity line inside the Share panel, for either kind. */
export function pieceSharePanelDescription(piece: ResearchPiece): string {
  return piece.traits.research
    ? researchSharePanelDescription(piece)
    : pieceWrittenSentence(piece).replace(/\.$/, '');
}

/**
 * The label above the closing sources block. A guide states rules rather than
 * figures, so the piece's own wording is the honest one; the research piece keeps
 * the words it posted with.
 */
export function pieceSourcesLabel(piece: ResearchPiece): string {
  return piece.traits.research ? 'WHERE THESE NUMBERS COME FROM' : 'WHERE THIS COMES FROM';
}

/**
 * The quiet mono line at the top of a piece's card on the /read page: its
 * reading time, then its date.
 *
 * Every card in a column is one shape, because a column that changes shape per
 * kind reads as 2 columns (Design, 27 Aug 2026). So both kinds carry minutes, and
 * the date is the half that differs: a research piece states the day it was
 * published, a guide states the month it was written and states "checked" instead
 * from the day somebody re-checks it (§4.4).
 *
 * This supersedes the 26 Aug 2026 settlement that kept a guide's card dateless.
 * That decision was about a date's staleness reading worst on a listing row, and
 * the swap-one-word slot is the answer to it: a re-checked guide's row moves
 * forward instead of ageing, so the date now earns its place beside the minutes.
 */
export function pieceCardMetaLine(piece: ResearchPiece): string {
  const minutes = `${pieceReadingMinutes(piece)} MIN`;
  return piece.traits.research
    ? `${minutes} \u00b7 PUBLISHED ${isoDateCommaCapsLabel(piece.publishedOn)}`
    : `${minutes} \u00b7 ${pieceWrittenLine(piece)}`;
}

/**
 * The smaller line under a card's title, one slot whatever the kind holds. A
 * research piece puts its standfirst there; a guide puts the set it belongs to,
 * which is the set's name and never its position in it (§2.12). A guide outside
 * every set has neither, and the slot is not drawn.
 */
export function pieceCardSecondaryLine(piece: ResearchPiece): string {
  return piece.traits.research ? piece.dek : (piece.set?.name ?? '');
}

// --- Sets ---

/**
 * A set's own name slugged, for the id the fold control's `aria-controls` points
 * at and for `/read/sets/{slug}` when that page is built. Computed from the
 * name by the same rule a section heading uses, so there is no second field to
 * fall out of step with the name a reader sees.
 */
export function pieceSetSlug(name: string): string {
  return researchSectionAnchor(name);
}

/** One set as the /read page draws it: its name, and its published pieces in reading order. */
export interface PieceSetGroup {
  name: string;
  slug: string;
  /** Published pieces only, ordered by `set.position` (\u00a72.3: never an unwritten title). */
  pieces: ResearchPiece[];
}

/**
 * Every set holding at least 1 published piece, in the order their first piece
 * appears in the registry.
 *
 * A set with nothing published has no entry, so the page draws no box for it
 * (\u00a72.4); its own page stays reachable for anyone holding the link. Both the
 * count and the total minutes are computed from these rows rather than stored, so
 * neither can drift from the list underneath them (\u00a74.2).
 */
export function publishedSets(
  pieces: readonly ResearchPiece[] = PUBLISHED_RESEARCH,
): PieceSetGroup[] {
  const byName = new Map<string, ResearchPiece[]>();
  for (const piece of pieces) {
    if (!piece.set) continue;
    const existing = byName.get(piece.set.name);
    if (existing) existing.push(piece);
    else byName.set(piece.set.name, [piece]);
  }
  return [...byName.entries()].map(([name, members]) => ({
    name,
    slug: pieceSetSlug(name),
    pieces: [...members].sort((a, b) => (a.set?.position ?? 0) - (b.set?.position ?? 0)),
  }));
}

/** Posted pieces the page labels Guide that belong to no set, newest first. */
export function guidesOutsideEverySet(): ResearchPiece[] {
  return piecesLabelledGuide().filter((piece) => !piece.set);
}

/** A set's total reading time: the sum of its published rows, which a reader can check. */
export function setReadingMinutes(group: PieceSetGroup): number {
  return group.pieces.reduce((total, piece) => total + pieceReadingMinutes(piece), 0);
}

/**
 * A set box's meta line: "2 GUIDES \u00b7 10 MIN". The count names the kind once for
 * the set, so the rows below it carry no kind word of their own.
 *
 * Singular at 1 piece, which is a state \u00a72.5 ratified rather than a hypothetical.
 * The kind word is GUIDES because every set that exists holds only guides; a set
 * holding anything else needs a word nobody has chosen, so `research.test.ts`
 * fails the day one appears rather than letting this print the wrong noun.
 */
export function setMetaLine(group: PieceSetGroup): string {
  const count = group.pieces.length;
  return `${count} ${count === 1 ? 'GUIDE' : 'GUIDES'} \u00b7 ${setReadingMinutes(group)} MIN`;
}

/** The time in a set row's right-hand column: "5 min", never a decimal. */
export function pieceRowTime(piece: ResearchPiece): string {
  return `${pieceReadingMinutes(piece)} min`;
}
