/**
 * The published pieces without their text: each one's address, kind, title and
 * dates, for the surfaces every page loads before any screen does.
 *
 * `navigation/webRoutes.ts` answers whether a `/read/...` address exists,
 * `navigation/documentTitle.ts` names the browser tab and `lib/share.ts` builds a
 * piece's page metadata, and all 3 are in the program every page downloads before
 * anything draws. Reading the registry in `lib/research.ts` for that put every
 * published article's full text into that first download. This module holds only
 * what those readers need and imports only the top bar's items.
 *
 * Each piece in `lib/researchPieces/` spreads its own entry from here into its
 * full record, so a slug, title or date is written once. `lib/research.ts`
 * re-exports every name here and keeps the full pieces, the /read page's other
 * wording and everything that needs a piece's text.
 */

import { IA } from '../navigation/ia';

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

/** What every surface that loads before a screen may know about a piece. */
export interface PieceIndexEntry {
  /**
   * URL slug under the piece's own folder: /read/research/ for a piece
   * carrying the research trait, /read/guides/ for one carrying only the
   * guide trait (§2.1). `pieceAddressFolder` is the single place that decides.
   */
  slug: string;
  /** Which kinds this piece carries. The reader-facing label derives from it. */
  traits: PieceTraits;
  /**
   * Whether search engines may list the piece. **Every published piece is
   * visible from the day it posts (Eugene, 25 Aug 2026)**, so this is `true` on
   * anything we publish and the field exists only to hold a piece back for a
   * reason Eugene names. It governs the sitemap row, the indexing tag and the
   * canonical link together, so all 3 follow from the one value.
   */
  indexed: boolean;
  title: string;
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
 * about it (Design, 27 Aug 2026).
 *
 * No terminal period on this line or on the 2 empty-state lines
 * (`READ_PAGE_EMPTY_TITLE` and `READ_PAGE_EMPTY_BODY` in `lib/research.ts`): a
 * period says another sentence is coming, so on a line with nothing after it the
 * eye waits for something that never arrives (Eugene, 2 Sep 2026). A piece's own
 * standfirst, drawn on its card, keeps the period its author wrote.
 */
export const READ_PAGE_INTRO =
  'What we found in Minnesota\u2019s public records, plus guides to how state government works';

/**
 * The label a reader sees for a piece: **Research** when it carries the research
 * trait, otherwise **Guide** (§2.7). Derived, never stored, so a both-traits
 * piece shows 1 label and cannot claim 2 sets of promises.
 */
export function pieceKindLabel(piece: Pick<PieceIndexEntry, 'traits'>): 'Research' | 'Guide' {
  return piece.traits.research ? 'Research' : 'Guide';
}

/**
 * The folder a piece's address sits in: `research` for anything carrying the
 * research trait, including a piece that also teaches, and `guides` for a piece
 * carrying only the guide trait (§2.1). One place decides, so a piece has
 * exactly 1 address and the router can reject the other one.
 */
export function pieceAddressFolder(piece: Pick<PieceIndexEntry, 'traits'>): 'research' | 'guides' {
  return piece.traits.research ? 'research' : 'guides';
}

/** A piece's own address, the only one it answers on. */
export function piecePath(piece: Pick<PieceIndexEntry, 'traits' | 'slug'>): string {
  return `/read/${pieceAddressFolder(piece)}/${encodeURIComponent(piece.slug)}`;
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

/** What search metadata and prepared share text may carry: the piece's two dates. */
export function researchShareDescription(
  piece: Pick<PieceIndexEntry, 'publishedOn' | 'recordsThrough'>,
): string {
  return `Published ${isoDateLabel(piece.publishedOn)} · records through ${isoDateLabel(piece.recordsThrough)}.`;
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
export function pieceWrittenLine(
  piece: Pick<PieceIndexEntry, 'publishedOn' | 'checkedOn'>,
): string {
  return piece.checkedOn
    ? `CHECKED ${isoMonthYearCapsLabel(piece.checkedOn)}`
    : `WRITTEN ${isoMonthYearCapsLabel(piece.publishedOn)}`;
}

/** The sentence-case form of the same slot, for a share preview and a page description. */
export function pieceWrittenSentence(
  piece: Pick<PieceIndexEntry, 'publishedOn' | 'checkedOn'>,
): string {
  const line = pieceWrittenLine(piece);
  const [word, ...rest] = line.split(' ');
  const month = rest[0] ? `${rest[0][0]}${rest[0].slice(1).toLowerCase()}` : '';
  return `${word[0]}${word.slice(1).toLowerCase()} ${[month, rest[1]].filter(Boolean).join(' ')}.`;
}

/** What a piece's own page metadata and prepared share text may carry: its dates. */
export function pieceShareDescription(
  piece: Pick<PieceIndexEntry, 'traits' | 'publishedOn' | 'recordsThrough' | 'checkedOn'>,
): string {
  return piece.traits.research ? researchShareDescription(piece) : pieceWrittenSentence(piece);
}

export const WHAT_THE_RECORDS_NAME_INDEX_ENTRY: PieceIndexEntry = {
  slug: 'what-the-records-name',
  traits: { research: false, guide: true },
  indexed: true,
  title: 'What the records name, and what they leave out',
  searchDescription:
    'Why a Minnesota campaign account’s published list of donors is real and is still not everyone who gave, and what decides who lands on it.',
  publishedOn: '2026-08-27',
  recordsThrough: '2026-08-12',
};

export const WHO_HAS_TO_REPORT_THEIR_MONEY_INDEX_ENTRY: PieceIndexEntry = {
  slug: 'who-has-to-report-their-money',
  traits: { research: false, guide: true },
  indexed: true,
  title: 'Who has to report their money',
  searchDescription:
    'Why looking up a Minnesota politician’s money finds an account rather than a person, and which accounts have to report what they raise and spend.',
  publishedOn: '2026-08-27',
  recordsThrough: '2026-08-12',
};

export const WHY_TWO_OFFICIAL_NUMBERS_CAN_BOTH_BE_RIGHT_INDEX_ENTRY: PieceIndexEntry = {
  slug: 'why-2-official-numbers-can-both-be-right',
  traits: { research: false, guide: true },
  indexed: true,
  title: 'Why 2 official numbers can both be right',
  searchDescription:
    'Why a Minnesota filing reports the money that came in 2 ways, the payments it lists by name and all of it, and why neither figure is wrong.',
  publishedOn: '2026-08-27',
  recordsThrough: '2026-08-27',
};

export const MONEY_SPENT_WITHOUT_A_CAMPAIGNS_SAY_INDEX_ENTRY: PieceIndexEntry = {
  slug: 'money-spent-without-a-campaigns-say',
  traits: { research: false, guide: true },
  indexed: true,
  title: 'Money spent without a campaign’s say',
  searchDescription:
    'The money aimed at Minnesota government that never goes into a campaign’s own account, who spends it, and where it is reported instead.',
  publishedOn: '2026-08-27',
  recordsThrough: '2026-08-27',
};

export const WHY_NOBODY_CAN_FOLLOW_A_DOLLAR_INDEX_ENTRY: PieceIndexEntry = {
  slug: 'why-nobody-can-follow-a-dollar',
  traits: { research: false, guide: true },
  indexed: true,
  title: 'Why nobody can follow a dollar',
  searchDescription:
    'Why Minnesota’s records can show what one political account paid another to the cent and still cannot say where any particular dollar ended up.',
  publishedOn: '2026-08-27',
  recordsThrough: '2026-08-27',
};

export const MONEY_ONLY_GOES_ONE_WAY_INDEX_ENTRY: PieceIndexEntry = {
  slug: 'the-money-only-goes-one-way',
  // Research only: it concludes, and it adds figures up across members, which is
  // rule 13's exception. It teaches nothing as its purpose, so it carries no guide
  // trait, and the label a reader sees derives from that
  // (docs/architecture/published-writing-decisions.md §2.7 and §2.8).
  traits: { research: true, guide: false },
  indexed: true,
  title: 'The Money Only Goes One Way',
  publishedOn: '2026-08-20',
  recordsThrough: '2026-07-20',
};

/**
 * Every posted piece, newest first, in the order `PUBLISHED_RESEARCH` lists the
 * full pieces (`lib/research.ts`).
 */
export const PUBLISHED_PIECE_INDEX: PieceIndexEntry[] = [
  WHAT_THE_RECORDS_NAME_INDEX_ENTRY,
  WHO_HAS_TO_REPORT_THEIR_MONEY_INDEX_ENTRY,
  WHY_TWO_OFFICIAL_NUMBERS_CAN_BOTH_BE_RIGHT_INDEX_ENTRY,
  MONEY_SPENT_WITHOUT_A_CAMPAIGNS_SAY_INDEX_ENTRY,
  WHY_NOBODY_CAN_FOLLOW_A_DOLLAR_INDEX_ENTRY,
  MONEY_ONLY_GOES_ONE_WAY_INDEX_ENTRY,
];

export function pieceIndexBySlug(slug: string): PieceIndexEntry | undefined {
  return PUBLISHED_PIECE_INDEX.find((piece) => piece.slug === slug);
}
