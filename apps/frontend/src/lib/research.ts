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

import {
  isoDateCapsLabel,
  isoDateCommaCapsLabel,
  isoDateLabel,
  pieceKindLabel,
  pieceWrittenLine,
  pieceWrittenSentence,
  type PieceIndexEntry,
} from './researchIndex';

export {
  isoDateCapsLabel,
  isoDateCommaCapsLabel,
  isoDateLabel,
  isoMonthYearCapsLabel,
  pieceAddressFolder,
  pieceKindLabel,
  piecePath,
  pieceShareDescription,
  pieceWrittenLine,
  pieceWrittenSentence,
  PUBLISHED_PIECE_INDEX,
  pieceIndexBySlug,
  READ_PAGE_HEADING,
  READ_PAGE_INTRO,
  READ_PAGE_NAME,
  researchShareDescription,
} from './researchIndex';
export type { PieceIndexEntry, PieceTraits } from './researchIndex';
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

export interface ResearchPiece extends PieceIndexEntry {
  /**
   * What a search result says under the title: what this piece covers, in the
   * piece's own words, carrying no figure and no finding (Eugene, 18 Sep 2026).
   *
   * A guide used to tell a search engine only its date, which says nothing about
   * whether the page answers the question somebody typed. Rule 13's bar is
   * unchanged and is what keeps this narrow: a piece's claims and derived labels
   * stay out of metadata, and a share preview still carries title and dates only
   * (`socialDescription` on the page's metadata). Describing the subject is not
   * making the claim.
   *
   * Absent on a research piece, whose dates are the more useful line beside a
   * title that already names its subject.
   */
  searchDescription?: string;
  /** The set this piece belongs to, where it belongs to one. */
  set?: PieceSet;
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
  /**
   * Every filing body the piece used. Kept on the record, rendered nowhere
   * since 20 Aug 2026: the sources block names the bodies in its own prose
   * (rule 13).
   */
  filingBodies: string[];
  /**
   * Set when the piece draws a figure the masthead's records-through date does
   * not speak for — records Alethical does not hold, or ones it holds on a
   * separate filing cycle with its own coverage end. Kept on the record,
   * rendered nowhere since 20 Aug 2026 (Eugene's call): the sources block names
   * those records and the years they cover instead (rule 13's publishing order,
   * point 11). Reworded 31 Aug 2026, when the lobbying file became the second
   * kind rather than the first (#1862).
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

/** The /read page's 2 empty-state lines. No terminal period on either: see
 *  `READ_PAGE_INTRO` in `lib/researchIndex.ts`. */
export const READ_PAGE_EMPTY_TITLE = 'Nothing published yet';
export const READ_PAGE_EMPTY_BODY =
  'When we publish research or a guide on these records, it appears here, dated and carrying the date its records run through';

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
 *
 * `PUBLISHED_PIECE_INDEX` in `lib/researchIndex.ts` lists the same pieces in the
 * same order without their text, for the address table and page metadata every
 * page loads. Each piece spreads its own index entry, so the 2 lists cannot
 * disagree about a slug, a title or a date; research.test.ts pins the order.
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

/** "PUBLISHED AUG 17 2026 · RECORDS THROUGH AUG 11 2026" — listing and masthead. */
export function researchDatesLine(piece: Pick<ResearchPiece, 'publishedOn' | 'recordsThrough'>) {
  return `PUBLISHED ${isoDateCapsLabel(piece.publishedOn)} · RECORDS THROUGH ${isoDateCapsLabel(piece.recordsThrough)}`;
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
 * The spoken name of the contents list inside a piece. It names the piece's own
 * kind, because a screen reader is handed this label *instead of* the visible
 * "CONTENTS" heading, and a fixed word tells a person reading a guide they are
 * in research (`.claude/rules/grounded-answers.md` rule 10 on what an
 * `accessibilityLabel` replaces).
 */
export function pieceContentsLabel(piece: Pick<ResearchPiece, 'traits'>): string {
  return `Sections in this ${pieceKindLabel(piece).toLowerCase()}`;
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
