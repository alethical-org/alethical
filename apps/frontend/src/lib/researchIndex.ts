/**
 * The published pieces without their text: each one's address, kind, title and
 * dates, for the surfaces every page loads before any screen does.
 *
 * `navigation/webRoutes.ts` answers whether a `/blog/...` address exists,
 * `navigation/documentTitle.ts` names the browser tab. Both are in the program
 * every page downloads before anything draws. Reading the registry in
 * `lib/research.ts` for that put every published article's full text into that
 * first download. This module holds only
 * what those readers need. Blog-only wording lives in `blogPageCopy.ts`.
 *
 * Article-only date and share wording lives in `articleDateLabels.ts`, so
 * formatting it never adds code to another page’s first download.
 *
 * Each piece in `lib/researchPieces/` spreads its own entry from here into its
 * full record, so a slug, title or date is written once. `lib/research.ts`
 * re-exports every name here and keeps the full pieces, the /blog page's other
 * wording and everything that needs a piece's text.
 */

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

export const TOPICS = [
  { slug: 'campaign-finance', label: 'Campaign finance' },
  { slug: 'lobbying', label: 'Lobbying' },
  { slug: 'elections', label: 'Elections' },
] as const;

export type TopicSlug = (typeof TOPICS)[number]['slug'];

/** The shared page size for Short posts and topic collections. */
export const SHORT_POST_PAGE_SIZE = 6;

/** The public Short post layout must show its evidence and disclosures before any can post. */
export const SHORT_POST_PRESENTATION_READY = true;

export function topicFromSlug(value: string): TopicSlug | undefined {
  return TOPICS.find((topic) => topic.slug === value)?.slug;
}

export function topicPath(topic: TopicSlug): string {
  return `/blog/topics/${topic}`;
}

/** What every surface that loads before a screen may know about a piece. */
export interface PieceIndexEntry {
  /** Whether AI helped prepare any of the article, including its method text. */
  aiAssisted?: boolean;
  /** Published guide group membership, kept in the lightweight listing index. */
  set?: { name: string; position: number };
  /** Stable identity for later article features. A Short post must set this. */
  articleId?: string;
  /** Short posts are a format, independent of the Research and Guide traits. */
  format?: 'short-post';
  /** Controlled subject names, independent of kind and format. */
  topics?: readonly TopicSlug[];
  /** Editorial, published related-reading picks. Empty until reviewed. */
  relatedSlugs?: readonly string[];
  /** Full ISO publication instant for Short post ordering. Never changed by checks. */
  publishedAt?: string;
  /**
   * URL slug under the piece's own folder: /blog/research/ for a piece
   * carrying the research trait, /blog/guides/ for one carrying only the
   * guide trait (§2.1). `pieceAddressFolder` is the single place that decides.
   */
  slug: string;
  /** Which kinds this piece carries. The reader-facing label derives from it. */
  traits: PieceTraits;
  /**
   * Whether search engines may list the piece. **Every published piece is
   * visible from the day it posts (25 Aug 2026)**, so this is `true` on
   * anything we publish and the field exists only to hold a piece back for a
   * separately approved editorial reason. It governs the sitemap row, the indexing
   * tag and the canonical link together, so all 3 follow from the one value.
   */
  indexed: boolean;
  title: string;
  /** ISO date the piece was published, e.g. "2026-08-17". */
  publishedOn: string;
  /**
   * ISO date the records run through, e.g. "2026-08-11". A research piece's
   * masthead prints it beside the publication date (rule 13's publishing order,
   * point 8). A guide's masthead prints 1 date and no second one, so on a guide
   * this is the record of which release its figures were computed from rather
   * than a line a reader sees; the guide's own prose states that date beside the
   * figure. A purely explanatory Short Guide with no dated source uses its
   * publication date as this required legacy field's internal placeholder. It
   * never prints that placeholder as a source or reporting-period date.
   */
  recordsThrough: string;
  /**
   * ISO date somebody last re-checked the piece against the records, distinct
   * from the publication date (settled 26 Aug 2026,
   * `docs/architecture/published-writing-decisions.md` §4.4).
   *
   * Absent, the slot reads "Published August 2026" and promises no new check. Present,
   * the same slot reads "Checked March 2027": one word swapped, never a second
   * date. That is the point of the swap — re-verifying a piece moves its date
   * forward, so staying accurate makes a piece look current instead of old,
   * while a "Checked" date that never moves would say we stopped looking.
   */
  checkedOn?: string;
}

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
  return `/blog/${pieceAddressFolder(piece)}/${encodeURIComponent(piece.slug)}`;
}

export const WHAT_THE_RECORDS_NAME_INDEX_ENTRY: PieceIndexEntry = {
  aiAssisted: true,
  set: { name: 'How the Money Works', position: 2 },
  articleId: 'guide-what-the-records-name',
  slug: 'what-the-records-name',
  relatedSlugs: ['2-records-not-always-2-donations', 'organizations-both-parties'],
  topics: ['campaign-finance'],
  traits: { research: false, guide: true },
  indexed: true,
  title: 'What the records name, and what they leave out',
  publishedOn: '2026-08-27',
  recordsThrough: '2026-08-12',
};

export const WHO_HAS_TO_REPORT_THEIR_MONEY_INDEX_ENTRY: PieceIndexEntry = {
  aiAssisted: true,
  set: { name: 'How the Money Works', position: 1 },
  articleId: 'guide-who-has-to-report-their-money',
  slug: 'who-has-to-report-their-money',
  relatedSlugs: ['organizations-both-parties', 'lobbyist-giving'],
  topics: ['campaign-finance'],
  traits: { research: false, guide: true },
  indexed: true,
  title: 'Who has to report their money',
  publishedOn: '2026-08-27',
  recordsThrough: '2026-08-12',
};

export const WHY_TWO_OFFICIAL_NUMBERS_CAN_BOTH_BE_RIGHT_INDEX_ENTRY: PieceIndexEntry = {
  aiAssisted: true,
  set: { name: 'How the Money Works', position: 3 },
  articleId: 'guide-why-2-official-numbers-can-both-be-right',
  slug: 'why-2-official-numbers-can-both-be-right',
  relatedSlugs: ['2-records-not-always-2-donations', 'lobbyist-giving'],
  topics: ['campaign-finance'],
  traits: { research: false, guide: true },
  indexed: true,
  title: 'Why 2 official numbers can both be right',
  publishedOn: '2026-08-27',
  recordsThrough: '2026-08-27',
};

export const MONEY_SPENT_WITHOUT_A_CAMPAIGNS_SAY_INDEX_ENTRY: PieceIndexEntry = {
  aiAssisted: true,
  set: { name: 'How the Money Works', position: 4 },
  articleId: 'guide-money-spent-without-a-campaigns-say',
  slug: 'money-spent-without-a-campaigns-say',
  relatedSlugs: ['the-money-only-goes-one-way', 'lobbyist-giving'],
  topics: ['campaign-finance', 'elections'],
  traits: { research: false, guide: true },
  indexed: true,
  title: 'Money spent without a campaign’s say',
  publishedOn: '2026-08-27',
  recordsThrough: '2026-08-27',
};

export const WHY_NOBODY_CAN_FOLLOW_A_DOLLAR_INDEX_ENTRY: PieceIndexEntry = {
  aiAssisted: true,
  set: { name: 'How the Money Works', position: 5 },
  articleId: 'guide-why-nobody-can-follow-a-dollar',
  slug: 'why-nobody-can-follow-a-dollar',
  relatedSlugs: ['organizations-both-parties', 'the-money-only-goes-one-way'],
  topics: ['campaign-finance'],
  traits: { research: false, guide: true },
  indexed: true,
  title: 'Why nobody can follow a dollar',
  publishedOn: '2026-08-27',
  recordsThrough: '2026-08-27',
};

export const MONEY_ONLY_GOES_ONE_WAY_INDEX_ENTRY: PieceIndexEntry = {
  aiAssisted: true,
  articleId: 'research-the-money-only-goes-one-way',
  slug: 'the-money-only-goes-one-way',
  relatedSlugs: ['why-nobody-can-follow-a-dollar', '2-records-not-always-2-donations'],
  topics: ['campaign-finance', 'lobbying'],
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

export const COMMITTEE_OFFICERS_INDEX_ENTRY: PieceIndexEntry = {
  articleId: 'short-committee-officers-and-vendors',
  slug: 'committee-officers-and-the-firms-they-pay',
  format: 'short-post',
  topics: ['campaign-finance', 'elections'],
  traits: { research: true, guide: true },
  indexed: true,
  title: 'Who keeps the books, and who gets paid?',
  publishedOn: '2026-10-08',
  recordsThrough: '2026-09-30',
  publishedAt: '2026-10-08T09:10:00Z',
};

export const TWO_RECORDS_NOT_TWO_DONATIONS_INDEX_ENTRY: PieceIndexEntry = {
  articleId: 'short-records-not-donations-2023',
  slug: '2-records-not-always-2-donations',
  format: 'short-post',
  topics: ['campaign-finance', 'lobbying'],
  traits: {
    research: true,
    guide: true,
  },
  indexed: true,
  title: '2 records do not always mean 2 donations',
  publishedOn: '2026-09-26',
  recordsThrough: '2023-12-20',
  publishedAt: '2026-09-26T20:32:16Z',
};

export const ORGANIZATIONS_BOTH_PARTIES_INDEX_ENTRY: PieceIndexEntry = {
  articleId: 'short-organizations-both-parties-2015-2025',
  slug: 'organizations-both-parties',
  format: 'short-post',
  topics: ['campaign-finance'],
  traits: { research: true, guide: false },
  indexed: true,
  title: 'Political donors appearing in both parties’ Minnesota caucus records',
  publishedOn: '2026-09-26',
  recordsThrough: '2025-12-31',
  publishedAt: '2026-09-26T20:54:05Z',
};

export const LOBBYIST_GIVING_INDEX_ENTRY: PieceIndexEntry = {
  articleId: 'short-lobbyist-giving-2015-2026',
  slug: 'lobbyist-giving',
  format: 'short-post',
  topics: ['campaign-finance', 'lobbying'],
  traits: { research: true, guide: false },
  indexed: true,
  title: 'What Minnesota’s records show about lobbyist contributions, 2015–2026',
  publishedOn: '2026-09-26',
  recordsThrough: '2025-12-31',
  publishedAt: '2026-09-26T20:54:05Z',
};

export const REALTOR_PACS_INDEX_ENTRY: PieceIndexEntry = {
  articleId: 'realtor-pacs-shared-candidates',
  slug: 'realtor-pacs-shared-candidates',
  title: '3 Realtor PACs. 12 shared campaigns.',
  traits: {
    research: true,
    guide: false,
  },
  format: 'short-post',
  topics: ['campaign-finance', 'elections'],
  indexed: true,
  publishedOn: '2026-10-08',
  recordsThrough: '2024-03-31',
  publishedAt: '2026-10-08T08:57:17.929Z',
};

/**
 * Every posted piece, newest first, in the order `PUBLISHED_RESEARCH` lists the
 * full pieces (`lib/research.ts`).
 */
export const PUBLISHED_PIECE_INDEX: PieceIndexEntry[] = [
  COMMITTEE_OFFICERS_INDEX_ENTRY,
  REALTOR_PACS_INDEX_ENTRY,
  LOBBYIST_GIVING_INDEX_ENTRY,
  ORGANIZATIONS_BOTH_PARTIES_INDEX_ENTRY,
  TWO_RECORDS_NOT_TWO_DONATIONS_INDEX_ENTRY,
  WHAT_THE_RECORDS_NAME_INDEX_ENTRY,
  WHO_HAS_TO_REPORT_THEIR_MONEY_INDEX_ENTRY,
  WHY_TWO_OFFICIAL_NUMBERS_CAN_BOTH_BE_RIGHT_INDEX_ENTRY,
  MONEY_SPENT_WITHOUT_A_CAMPAIGNS_SAY_INDEX_ENTRY,
  WHY_NOBODY_CAN_FOLLOW_A_DOLLAR_INDEX_ENTRY,
  MONEY_ONLY_GOES_ONE_WAY_INDEX_ENTRY,
];

/** A guide group is one numbered collection item, whatever its member count. */
export const READING_COLLECTION_PAGE_SIZE = 10;

export function guideSetSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function guideIndexEntries(entries: readonly PieceIndexEntry[] = PUBLISHED_PIECE_INDEX) {
  return entries.filter(
    (piece) => piece.traits.guide && !piece.traits.research && piece.format !== 'short-post',
  );
}

export function guideCollectionCount(entries: readonly PieceIndexEntry[] = PUBLISHED_PIECE_INDEX) {
  const guides = guideIndexEntries(entries);
  return (
    guides.filter((piece) => !piece.set).length +
    new Set(guides.flatMap((piece) => (piece.set ? [piece.set.name] : []))).size
  );
}

export function guideSetBySlug(
  slug: string,
  entries: readonly PieceIndexEntry[] = PUBLISHED_PIECE_INDEX,
) {
  return guideIndexEntries(entries).find(
    (piece) => piece.set && guideSetSlug(piece.set.name) === slug,
  )?.set?.name;
}

export function pieceIndexBySlug(slug: string): PieceIndexEntry | undefined {
  return PUBLISHED_PIECE_INDEX.find((piece) => piece.slug === slug);
}
