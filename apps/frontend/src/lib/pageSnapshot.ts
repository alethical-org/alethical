import {
  authorNameOnly,
  bienniumEyebrow,
  billOverviewUrl,
  chiefAuthor,
  citationChipLabel,
  citationsBySection,
  partyFull,
  plainBillSummary,
  plainKeyPoints,
  stageLabel,
  statusLabel,
} from './billDetail';
import { citationSectionHref } from './billText';
import {
  legislativeServiceFromHistory,
  legislatorDisplayName,
  legislatorDistrictLine,
  splitOfficeAddress,
} from './legislatorProfile';
import type { Citation } from '../data/types';
import { billNumberFromId, escapeHtml } from './share';
import {
  BILL_DIRECTORY_HEADING,
  directoryJumpPages,
  directoryPagePath,
  directoryTotalPages,
  LEGISLATOR_DIRECTORY_HEADING,
} from './directoryPagination';
import {
  READ_PAGE_EMPTY_BODY,
  READ_PAGE_EMPTY_TITLE,
  READ_PAGE_HEADING,
  READ_PAGE_INTRO,
  READ_PAGE_NAME,
  pieceCardMetaLine,
  pieceCardSecondaryLine,
  pieceMastheadLine,
  pieceSourcesLabel,
  piecePath,
  researchRunsText,
  researchSourceText,
  type ResearchInline,
  type ResearchPiece,
  type ResearchBlock,
} from './research';
import {
  COMMITTEE_LIST_DEK,
  COMMITTEE_LIST_NOTE,
  COMMITTEE_LIST_TITLE,
  committeeRowMeta,
  committeeShowingLine,
  registerCountLine,
} from './committeeList';
import {
  CLOSED_EMPTY_VALUE,
  CLOSED_MONEY_IN_WHY,
  CLOSED_MONEY_OUT_WHY,
  closedChipLabel,
  closedPeriodDetail,
  closedPeriodLine,
  committeeEyebrow,
  committeeSlug,
  confirmedMemberLinkLabel,
  confirmedMemberMoneyPath,
  coveredPeriodDetail,
  coveredPeriodLine,
  emptyListTitle,
  emptyListWhy,
  EMPTY_YEAR_MONEY_OUT_WHY,
  EMPTY_YEAR_VALUE,
  emptyYearMoneyInWhy,
  IN_KIND_CHIP,
  isBallotQuestionFiler,
  listLinkNote,
  MONEY_OUT_FIGURE_LABEL,
  MONEY_OUT_REPORTED_LABEL,
  moneyOutKindLabel,
  inKindDonationsNote,
  inKindOutNote,
  listedExceedsReported,
  moneyOutNote,
  statedSpendingNote,
  NOT_IN_REGISTER_LINE,
  paymentsEyebrow,
  paymentsTitle,
  RECORD_COVERS_HEADING,
  recordCoverageLines,
  registeredForLine,
  registerKindFromEntityType,
  showingLine,
  uncoveredPeriodDetail,
  uncoveredPeriodLine,
  unnamedMoneyExplanation,
  whoseCommitteeText,
  yearDisplayState,
  ZERO_REPORTED_NOTE,
  type PaymentRow,
} from './committeeMoney';
import {
  formatMoney,
  moneyFigure,
  paymentCountLabel,
  reportedThroughLabel,
  splitExplanation,
  statedSplitNote,
  type MoneyBlockState,
  type SplitState,
} from './legislatorCampaignMoney';
import {
  centralDateLabel,
  FILES_LAST_COPIED_LABEL,
  FILES_LAST_COPIED_NOTE,
  laneCountLine,
  MONEY_LANDING_HEADING,
  MONEY_LANDING_SUBTITLE,
  MONEY_LANE_COMMITTEES,
  MONEY_LANE_LEGISLATORS,
  RECORD_DOES_NOT_COVER,
  RECORD_DOES_NOT_COVER_HEADING,
} from './moneyLanding';
import { formatSessionLabel } from './sessionLabel';
import { FIND_MY_LEGISLATOR_INSTRUCTIONS } from './findMyLegislator';
import { HOME_PUBLIC_INTRO } from './homepage';

/**
 * The short factual snapshot that ships INSIDE the first server response. Bill
 * and legislator records use the release-2 form from issue #1325. Home and the
 * unfiltered public directories use the crawlable path added in issue #1396.
 *
 * Release 1 gave every address its own title and description. This gives it
 * something to read. A search engine frequently ignores a supplied description
 * and writes its result text from what is visible on the page, so a body that
 * arrives empty has nothing to offer it; a reader whose JavaScript fails gets
 * nothing at all; and a broken app looks exactly like a blank page.
 *
 * The hard rule this file exists to keep: **every string here is a string the
 * app itself then draws.** There is no robot-only wording to keep honest. That
 * is why the values below come from the very helpers the screens call
 * (`plainKeyPoints`, `stageLabel`, `chiefAuthor`, `partyFull`, …) rather than
 * from anything written for this file, and why `pageSnapshot.test.ts` renders
 * the real components and asserts each line appears in what they produce.
 *
 * One deliberate exception, and it says less rather than more: a bill with no
 * plain-language short title is headed by its number alone. The app's own
 * heading falls back to the bill's statutory title, which is a paragraph of
 * legal cross-references that `.claude/rules/grounded-answers.md` rule 10 keeps
 * off the page.
 */

export interface SnapshotFact {
  label: string;
  /** One entry per displayed line — an address is several lines, not one. */
  lines: string[];
}

export interface SnapshotLink {
  label: string;
  href: string;
}

export interface SnapshotRecordLink extends SnapshotLink {
  /** A second text run the app also draws, such as a bill title or district. */
  detail?: string;
}

export interface PageSnapshot {
  /** The page's `<h1>`. */
  heading: string;
  /** The identifying line beneath it, e.g. `HF 719 · 2025–26 LEGISLATIVE SESSION`. */
  subheading: string;
  /** Heading above the prose block, worded as the app labels it. */
  bodyHeading: string;
  /** Bullets when `bodyIsList`, otherwise paragraphs. */
  body: string[];
  facts: SnapshotFact[];
  bodyIsList: boolean;
  /** The records shown on this directory page, each as a normal crawlable link. */
  records?: SnapshotRecordLink[];
  /** Extra factual blocks that the loaded page also draws. */
  sections?: SnapshotSection[];
  links: SnapshotLink[];
}

export interface SnapshotSectionItem {
  label: string;
  /** Absent when the record cannot identify one safe destination. */
  href?: string;
}

/**
 * One piece of a section, in the order the page draws it. Prose, bullets and a
 * table interleave inside a published piece, and the order carries meaning: a
 * table introduced by "The biggest spenders:" has to arrive after that sentence
 * and before the ones that comment on it.
 */
export type SnapshotBlock =
  | { kind: 'prose'; lines: string[] }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'table'; columns: string[]; rows: string[][] }
  /**
   * Real anchors inside a section's blocks. A published piece's sources name
   * official filing bodies, and rule 13 requires those to be named **and
   * linked** at their source; a link that only reaches the reader after the app
   * runs is not linked for anything reading the first response.
   */
  | { kind: 'links'; items: SnapshotSectionItem[] };

export interface SnapshotSection {
  heading: string;
  /** Ordered pieces. A section uses this OR `body`/`items`, never both. */
  blocks?: SnapshotBlock[];
  body?: string[];
  bodyIsList?: boolean;
  items?: SnapshotSectionItem[];
}

function clean(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function fact(label: string, value: string | null | undefined): SnapshotFact[] {
  const lines = (value ?? '')
    .split('\n')
    .map((line) => clean(line))
    .filter(Boolean);
  return lines.length ? [{ label, lines }] : [];
}

function resultCount(total: number, noun: string): string {
  return `${total.toLocaleString('en-US')} ${total === 1 ? noun : `${noun}s`}`;
}

function directoryNavigation(
  basePath: '/bills' | '/legislators',
  page: number,
  totalPages: number,
  other: SnapshotLink,
): SnapshotLink[] {
  const jumps = directoryJumpPages(page, totalPages).map((target) => ({
    label: `Page ${target}`,
    href: directoryPagePath(basePath, target),
  }));
  return [
    ...(page > 1 ? [{ label: 'Previous', href: directoryPagePath(basePath, page - 1) }] : []),
    ...(page < totalPages ? [{ label: 'Next', href: directoryPagePath(basePath, page + 1) }] : []),
    ...jumps,
    other,
  ];
}

// --- Home and public directories ---

export function homePageSnapshot(): PageSnapshot {
  return {
    heading: 'Grounded answers on Minnesota politics',
    subheading: 'TRUTH, UNCONCEALED',
    bodyHeading: '',
    body: [HOME_PUBLIC_INTRO],
    facts: [],
    bodyIsList: false,
    links: [
      { label: 'Search Bills', href: '/bills' },
      { label: 'Search Legislators', href: '/legislators' },
      { label: 'Find My Legislator', href: '/find-my-legislator' },
    ],
  };
}

export function findMyLegislatorPageSnapshot(): PageSnapshot {
  return {
    heading: 'Find my legislator',
    subheading: '',
    bodyHeading: '',
    body: [FIND_MY_LEGISLATOR_INSTRUCTIONS],
    facts: [],
    bodyIsList: false,
    links: [],
  };
}

export interface BillDirectorySnapshotSource {
  id: string;
  ai_analysis?: { short_title?: string | null } | null;
  current_status?: string | null;
  status_key?: string | null;
  session?: {
    name?: string | null;
    session_number?: number | null;
    year_start?: number | null;
    year_end?: number | null;
  } | null;
}

export function billDirectoryPageSnapshot(
  bills: readonly BillDirectorySnapshotSource[],
  total: number,
  page: number,
  pageSize: number,
): PageSnapshot {
  return {
    heading: BILL_DIRECTORY_HEADING,
    subheading: resultCount(total, 'bill'),
    bodyHeading: '',
    body: [],
    facts: [],
    bodyIsList: false,
    records: bills.map((bill) => {
      const session = bill.session;
      const sessionLabel = session
        ? formatSessionLabel({
            name: session.name ?? undefined,
            sessionNumber: session.session_number ?? undefined,
            yearStart: session.year_start ?? undefined,
            yearEnd: session.year_end ?? undefined,
          })
        : '';
      return {
        label: billNumberFromId(bill.id),
        detail: [
          clean(bill.ai_analysis?.short_title) ||
            stageLabel(statusLabel(bill.status_key, bill.current_status)),
          sessionLabel,
        ]
          .filter(Boolean)
          .join(' · '),
        href: `/bills/${encodeURIComponent(bill.id)}`,
      };
    }),
    links: directoryNavigation('/bills', page, directoryTotalPages(total, pageSize), {
      label: 'Legislators',
      href: '/legislators',
    }),
  };
}

export interface LegislatorDirectorySnapshotSource {
  id: string;
  slug?: string | null;
  full_name?: string | null;
  current_service?: {
    chamber?: string | null;
    district?: { code?: string | null } | null;
  } | null;
}

export function legislatorDirectoryPageSnapshot(
  legislators: readonly LegislatorDirectorySnapshotSource[],
  total: number,
  page: number,
  pageSize: number,
): PageSnapshot {
  return {
    heading: LEGISLATOR_DIRECTORY_HEADING,
    subheading: resultCount(total, 'legislator'),
    bodyHeading: '',
    body: [],
    facts: [],
    bodyIsList: false,
    records: legislators.map((legislator) => {
      const service = legislator.current_service ?? {};
      const chamberValue = (service.chamber ?? '').toLowerCase();
      const chamber =
        chamberValue === 'house' ? 'House' : chamberValue === 'senate' ? 'Senate' : '';
      const district = clean(service.district?.code);
      return {
        label: clean(legislator.full_name) || 'Minnesota legislator',
        detail: [chamber, district ? `District ${district}` : ''].filter(Boolean).join(' · '),
        href: `/legislators/${encodeURIComponent(legislator.slug || legislator.id)}`,
      };
    }),
    links: directoryNavigation('/legislators', page, directoryTotalPages(total, pageSize), {
      label: 'Bills',
      href: '/bills',
    }),
  };
}

// --- Bill ---

export interface BillSnapshotSource {
  id: string;
  session?: { name?: string | null } | null;
  current_status?: string | null;
  status_key?: string | null;
  official_url?: string | null;
  chief_sponsors?:
    | {
        name?: string | null;
        role?: string | null;
        slug?: string | null;
        chamber?: string | null;
        source_chamber?: string | null;
      }[]
    | null;
  ai_analysis?: {
    short_title?: string | null;
    summary?: string | null;
    key_points?: string[] | null;
    citations?: Array<{
      id?: string | null;
      label?: string | null;
      excerpt?: string | null;
      url?: string | null;
      section_id?: string | null;
      section_order?: number | null;
      section_topic?: string | null;
    }> | null;
  } | null;
}

/** `house` / `HF 719` → `House`. The same normalisation the app's mapper applies. */
function billChamber(value: string): 'House' | 'Senate' {
  const normalized = value.trim().toLowerCase();
  return normalized === 'house' || normalized.startsWith('hf') ? 'House' : 'Senate';
}

/**
 * A sponsor's chamber stays absent when the record does not carry one, because
 * `chiefAuthor` filters to the bill's own chamber only when it can, and guessing
 * here would pick a different author than the profile shows.
 */
function sponsorChamber(value: string | null | undefined): 'House' | 'Senate' | undefined {
  return value?.trim() ? billChamber(value) : undefined;
}

export function billPageSnapshot(bill: BillSnapshotSource): PageSnapshot {
  const identifier = billNumberFromId(bill.id);
  const shortTitle = clean(bill.ai_analysis?.short_title);
  const eyebrow = bienniumEyebrow(bill.id, bill.session?.name ?? undefined);
  const keyPoints = plainKeyPoints(bill.ai_analysis?.key_points ?? undefined);
  const summary = plainBillSummary(bill.ai_analysis?.summary ?? null);

  const sponsors = (bill.chief_sponsors ?? []).map((sponsor) => ({
    name: sponsor.name ?? '',
    role: sponsor.role ?? '',
    slug: sponsor.slug ?? undefined,
    chamber: sponsorChamber(sponsor.chamber ?? sponsor.source_chamber),
  }));
  const author = chiefAuthor({ sponsors, chamber: billChamber(identifier) });
  const authorName = author ? authorNameOnly(author.name) : '';

  const overview = billOverviewUrl(bill.official_url ?? undefined);
  const citations: Citation[] = (bill.ai_analysis?.citations ?? [])
    .filter((citation) => clean(citation.label).length > 0)
    .map((citation, index) => ({
      id: clean(citation.id) || `citation-${index}`,
      label: clean(citation.label),
      excerpt: clean(citation.excerpt),
      url: clean(citation.url),
      sectionId: clean(citation.section_id),
      sectionOrder: typeof citation.section_order === 'number' ? citation.section_order : null,
      sectionTopic: clean(citation.section_topic),
    }));
  const citedSections = citationsBySection(citations).map((citation) => {
    const label = citationChipLabel(citation.label, citation.sectionTopic);
    const href = citationSectionHref(bill.id, citation);
    return href ? { label, href } : { label };
  });

  return {
    heading: shortTitle || identifier,
    subheading: [identifier, eyebrow].filter(Boolean).join(' · '),
    bodyHeading: keyPoints.length ? 'Key points' : 'Summary',
    body: keyPoints.length ? keyPoints : summary ? [summary] : [],
    bodyIsList: keyPoints.length > 0,
    sections: citedSections.length
      ? [{ heading: 'Cited sections', items: citedSections }]
      : undefined,
    facts: [
      ...fact('Where it stands', stageLabel(statusLabel(bill.status_key, bill.current_status))),
      ...fact('Chief author', authorName),
    ],
    links: [
      ...(overview ? [{ label: 'Bill overview', href: overview }] : []),
      ...(author?.slug && authorName
        ? [{ label: authorName, href: `/legislators/${encodeURIComponent(author.slug)}` }]
        : []),
      { label: 'Bills', href: '/bills' },
    ],
  };
}

// --- Legislator ---

export interface LegislatorSnapshotSource {
  full_name?: string | null;
  biography?: string | null;
  current_service?: {
    chamber?: string | null;
    party?: string | null;
    district?: { code?: string | null } | null;
    phone?: string | null;
    office_address?: string | null;
    profile_url?: string | null;
  } | null;
  committees?: { name?: string | null; role?: string | null }[] | null;
  service_history?: {
    term?: number | null;
    periods: Array<{
      chamber: string;
      initial_year: number;
      reelection_years: number[];
    }>;
  } | null;
}

export function legislatorPageSnapshot(legislator: LegislatorSnapshotSource): PageSnapshot {
  const service = legislator.current_service ?? {};
  const chamber = (service.chamber ?? '').toLowerCase() === 'house' ? 'House' : 'Senate';
  const displayName = legislatorDisplayName(legislator.full_name ?? '', chamber);
  const districtLine = legislatorDistrictLine(chamber, service.district?.code ?? undefined);
  const committees = (legislator.committees ?? [])
    .map((committee) => {
      const name = clean(committee.name);
      const role = clean(committee.role);
      return name && role ? `${name} (${role})` : name;
    })
    .filter(Boolean);
  const office = splitOfficeAddress(service.office_address ?? '');
  const biography = clean(legislator.biography);
  const serviceHistory = legislativeServiceFromHistory(legislator.service_history);
  const serviceLines = serviceHistory
    ? [
        ...serviceHistory.lines.map((line) => `${line.label}: ${line.elected}`),
        ...(serviceHistory.term ? [`Term: ${serviceHistory.term}`] : []),
      ]
    : [];
  const sections: SnapshotSection[] = [
    ...(biography ? [{ heading: 'Biography', body: [biography], bodyIsList: false }] : []),
    ...(serviceLines.length
      ? [{ heading: 'Legislative Service', body: serviceLines, bodyIsList: false }]
      : []),
  ];

  return {
    heading: displayName,
    subheading: [districtLine, partyFull(service.party ?? undefined)].filter(Boolean).join(' · '),
    bodyHeading: 'Committees',
    body: committees.length ? committees : ['No current committee assignments on record.'],
    bodyIsList: committees.length > 0,
    sections: sections.length ? sections : undefined,
    facts: [
      ...fact('Leadership', office.leadership),
      ...fact('Capitol office', office.address),
      ...fact('Phone', service.phone),
    ],
    links: [
      ...(service.profile_url
        ? [{ label: `Official ${chamber} profile`, href: service.profile_url }]
        : []),
      { label: 'Legislators', href: '/legislators' },
    ],
  };
}

// --- Published research ---

/**
 * A published piece's own writing, in the first server response
 * (issue #1760). Every other snapshot in this file reads a record out of the
 * database; these two read the piece registry, so the text is already on the
 * server and no data call is involved. One pair of functions covers both kinds:
 * a research piece and a guide are the same document shape with different
 * mastheads.
 *
 * Rule 13 of `.claude/rules/grounded-answers.md` keeps a piece's claims out of
 * its share preview and metadata, and that is untouched: this is the piece
 * page's own body, the same words a reader sees, and the `indexed` flag still
 * decides on its own whether a search engine may list the page. The same rule
 * forbids editing a piece's words at all, which is why nothing here shortens,
 * re-punctuates or summarises a stored sentence.
 *
 * An outward link inside a SENTENCE contributes its words and not its address,
 * because a bare address mid-prose reads as noise. A source's link is different
 * and does carry its address: rule 13 requires a filing body to be named and
 * linked at its source, and a link the reader only gets after the app runs is not
 * a link at all to anything reading the first response.
 */

/** One piece block as the screen draws it, in the piece's own order. */
function researchBlocks(blocks: readonly ResearchBlock[]): SnapshotBlock[] {
  return blocks.map((block): SnapshotBlock => {
    if (block.kind === 'paragraph') {
      return { kind: 'prose', lines: [researchRunsText(block.runs)] };
    }
    if (block.kind === 'bullets') {
      return { kind: 'bullets', items: block.items.map((item) => researchRunsText(item)) };
    }
    // A note is prose in the first response. Its box is styling the screen owns,
    // and the sentence inside it qualifies a figure, so it is exactly the text a
    // search engine must read on the first visit rather than after a script runs.
    if (block.kind === 'note') {
      return { kind: 'prose', lines: [block.text] };
    }
    return { kind: 'table', columns: block.columns, rows: block.rows };
  });
}

/** Every link inside a run list, inward or outward, in order. */
function runLinks(runs: readonly ResearchInline[]): SnapshotSectionItem[] {
  return runs
    .filter(
      (run): run is Extract<ResearchInline, { kind: 'externalLink' | 'internalLink' }> =>
        run.kind === 'externalLink' || run.kind === 'internalLink',
    )
    .map((run) => ({ label: run.text, href: run.href }));
}

/**
 * Every inward link a piece's own prose carries, in document order, served as
 * real anchors after the sections.
 *
 * A link inside a sentence contributes its words to the prose and not its
 * address, because a bare address mid-prose reads as noise. An INWARD one still
 * has to be followable: it is the route from one posted piece to another, and a
 * route that only exists once the app has run is not a route at all to anything
 * reading the first response. So the words stay in the sentence and the address
 * is served beside it, the way a source's link already is.
 */
function pieceBodyLinks(piece: ResearchPiece): SnapshotSectionItem[] {
  const runsIn = (blocks: readonly ResearchBlock[]): ResearchInline[] =>
    blocks.flatMap((block) =>
      block.kind === 'paragraph' ? block.runs : block.kind === 'bullets' ? block.items.flat() : [],
    );
  const runs = [
    ...runsIn(piece.shortVersion),
    ...runsIn(piece.intro ?? []),
    ...piece.sections.flatMap((section) => runsIn(section.blocks)),
  ];
  return runs
    .filter(
      (run): run is Extract<ResearchInline, { kind: 'internalLink' }> =>
        run.kind === 'internalLink',
    )
    .map((run) => ({ label: run.text, href: run.href }));
}

/**
 * The closing sources block, whichever shape the piece stores it in.
 *
 * Both shapes serve their sentences as prose and then every address they hold as
 * real anchors, because rule 13 requires a filing body to be named AND linked at
 * its source, and a link the reader only gets once the app has run is not a link
 * at all to anything reading the first response. The guide's block holds 11
 * addresses across 7 sentences, so without the anchor list its citations would be
 * words with nothing to follow.
 */
function pieceSourceBlocks(piece: ResearchPiece): SnapshotBlock[] {
  const runLists = piece.sourceRuns ?? [];
  const prose = [
    ...piece.sources.map(researchSourceText),
    ...runLists.map((runs) => researchRunsText(runs)),
  ];
  const links = [
    ...piece.sources.flatMap((source) =>
      source.noteLink ? [{ label: source.noteLink.text, href: source.noteLink.href }] : [],
    ),
    ...runLists.flatMap(runLinks),
  ];
  return [
    { kind: 'prose', lines: prose },
    ...(links.length ? [{ kind: 'links' as const, items: links }] : []),
  ];
}

export function researchPageSnapshot(piece: ResearchPiece): PageSnapshot {
  // The piece's own label wording. The screen draws these same words in mono
  // caps; case is styling this file has never copied, the way a bill's
  // "Where it stands" is served in sentence case too.
  const bodyLinks = pieceBodyLinks(piece);
  const sections: SnapshotSection[] = [
    ...(piece.newerFilingsNote
      ? [
          {
            heading: 'Newer filings exist',
            blocks: [{ kind: 'prose' as const, lines: [piece.newerFilingsNote] }],
          },
        ]
      : []),
    ...(piece.correction
      ? [
          {
            heading: piece.correction.datedLabel,
            blocks: [{ kind: 'prose' as const, lines: [piece.correction.note] }],
          },
        ]
      : []),
    ...(piece.shortVersion.length
      ? [{ heading: 'Short version', blocks: researchBlocks(piece.shortVersion) }]
      : []),
    ...piece.sections.map((section) => ({
      heading: section.heading,
      blocks: [
        ...researchBlocks(section.blocks),
        ...(section.methodologyInset
          ? [
              {
                kind: 'prose' as const,
                lines: [section.methodologyInset.title, section.methodologyInset.body],
              },
            ]
          : []),
      ],
    })),
    {
      heading: pieceSourcesLabel(piece)
        .toLowerCase()
        .replace(/^./, (first) => first.toUpperCase()),
      blocks: pieceSourceBlocks(piece),
    },
    // The pieces this one's own prose links to, as real anchors. A piece links to
    // another only where a person authored the link and the destination is
    // already posted, so this is absent on a piece that names no other.
    ...(bodyLinks.length
      ? [
          {
            heading: 'Also on Alethical',
            blocks: [{ kind: 'links' as const, items: bodyLinks }],
          },
        ]
      : []),
  ];

  return {
    heading: piece.title,
    // A research piece's 2 dates, or a guide's kind, minutes and 1 date — the
    // same line the screen draws under the title.
    subheading: pieceMastheadLine(piece),
    bodyHeading: '',
    // The standfirst, where the piece has one. A guide has none and names its set
    // instead, then opens with plain prose before its first heading — so this is
    // the run of paragraphs the loaded page draws above the first section, in the
    // same order.
    body: [
      ...(piece.dek ? [piece.dek] : []),
      ...(piece.set ? [piece.set.name] : []),
      ...researchBlocks(piece.intro ?? []).flatMap((block) =>
        block.kind === 'prose' ? block.lines : [],
      ),
    ],
    bodyIsList: false,
    facts: [],
    sections,
    links: [{ label: READ_PAGE_HEADING, href: '/read' }],
  };
}

/**
 * The /read page, with one crawlable link per posted piece. The link is the
 * point: without it the route to an older piece exists only after the app has
 * run, so an archive is unreachable on a first visit.
 */
export function readPageSnapshot(pieces: readonly ResearchPiece[]): PageSnapshot {
  return {
    // The page's own name, the same word the visually hidden `h1` carries, so the
    // served document and the loaded page name the page identically. What the page
    // is about is the note below it, which is where the loaded page puts it too.
    heading: READ_PAGE_NAME,
    subheading: '',
    bodyHeading: '',
    body: pieces.length
      ? [READ_PAGE_INTRO]
      : [READ_PAGE_INTRO, READ_PAGE_EMPTY_TITLE, READ_PAGE_EMPTY_BODY],
    bodyIsList: false,
    facts: [],
    records: pieces.map((piece) => ({
      label: piece.title,
      // The same lines the card draws: its minutes and date, then its standfirst
      // or the set it belongs to.
      detail: [pieceCardMetaLine(piece), pieceCardSecondaryLine(piece)].filter(Boolean).join(' · '),
      // Each piece's own address, from the one function that decides the folder.
      href: piecePath(piece),
    })),
    // The page's own back link, to the section the nav calls "Money in politics".
    links: [{ label: 'Money in politics', href: '/money' }],
  };
}

// --- The campaign money section ---

/**
 * The money section's first server response: the landing, the register of
 * filers, one committee's record, and that committee's full payments list
 * (issue #1812).
 *
 * Until this, all 4 addresses sent a title and an empty body, so the 1,603
 * committee records had no sentence and no link a search engine could read, and
 * the register's own list served 0 anchors. This is exactly the defect §20.4
 * recorded on the research page and §21 cured there, applied to the money
 * section — the addresses in
 * `docs/architecture/page-metadata-for-search-and-sharing-decisions.md` §22.
 *
 * **Rule 12 of `.claude/rules/grounded-answers.md` binds every figure below, and
 * a served figure is a published claim about a named organisation.** So none of
 * these functions formats a number of its own: every amount goes through
 * `formatMoney`, every absent one through `moneyFigure`, and both the total the
 * committee reported and the payments we can list are served with the sentence
 * that says they are different figures. Nothing here subtracts one from the
 * other, nothing implies one payment funded another, and every page carrying a
 * money figure carries the day we copied the Board's files.
 *
 * The year and the tab in an address are deliberately ignored: the body serves
 * the page's canonical state, exactly as a bill's body serves its Summary
 * whichever tab the address names. The app then draws the requested year.
 */

/** The server's own vocabulary for whether a block of figures may be read at
 *  all. Anything it does not name is "we could not tell", never a 0. */
function committeeBlockState(state: string | null | undefined): MoneyBlockState {
  if (state === 'reported') return 'reported';
  if (state === 'not_reported') return 'not_reported';
  return 'unavailable';
}

export interface MoneyLandingSnapshotSource {
  /** The register's own size, read live. Null when the count is not served. */
  registerFilerCount: number | null;
  /** When we last copied the Board's files, as the served instant. */
  filesLastCopiedAt: string | null;
}

export function moneyLandingPageSnapshot(source: MoneyLandingSnapshotSource): PageSnapshot {
  const committeeCount = laneCountLine(source.registerFilerCount, 'registered filers');
  return {
    heading: MONEY_LANDING_HEADING,
    subheading: '',
    bodyHeading: '',
    body: [MONEY_LANDING_SUBTITLE],
    bodyIsList: false,
    // The 2 lanes that lead to something worth crawling. All 3 cards on the drawn
    // page open a page since #1780, but the 3rd opens the name search, which is
    // `noindex` because its address is whatever somebody typed — so a link to it
    // here would hand a crawler a page it is told not to index. A reader still
    // gets all 3 the moment the app renders.
    records: [
      {
        label: MONEY_LANE_LEGISLATORS.title,
        detail: MONEY_LANE_LEGISLATORS.body,
        href: '/legislators',
      },
      {
        label: MONEY_LANE_COMMITTEES.title,
        detail: [MONEY_LANE_COMMITTEES.body, committeeCount].filter(Boolean).join(' · '),
        href: '/money/committees',
      },
    ],
    // The one freshness date this page shows, with the sentence that says what it
    // is: the day we copied the files, never the period any money covers.
    facts: source.filesLastCopiedAt
      ? [
          {
            label: FILES_LAST_COPIED_LABEL,
            lines: [centralDateLabel(source.filesLastCopiedAt), FILES_LAST_COPIED_NOTE],
          },
        ]
      : [],
    sections: [
      {
        heading: RECORD_DOES_NOT_COVER_HEADING,
        body: [...RECORD_DOES_NOT_COVER],
        bodyIsList: true,
      },
    ],
    links: [{ label: READ_PAGE_HEADING, href: '/read' }],
  };
}

export interface CommitteeDirectorySnapshotSource {
  registration_number?: string | null;
  name?: string | null;
  kind?: string | null;
  sub_type?: string | null;
  office?: string | null;
  district?: string | null;
  termination_date?: string | null;
}

/**
 * One numbered page of the register, with an ordinary link per filer.
 *
 * The links are the whole point: the register was a "Show more" button, and
 * Google states it does not press buttons, so 1,553 of the 1,603 committee pages
 * had no ordinary link anywhere on the site (§20.5 rule 2).
 */
export function committeeDirectoryPageSnapshot(
  committees: readonly CommitteeDirectorySnapshotSource[],
  totals: { listTotal: number; registerTotal: number | null; asOf: string | null },
  page: number,
  pageSize: number,
): PageSnapshot {
  const totalPages = directoryTotalPages(totals.listTotal, pageSize);
  const showing = committeeShowingLine(page, committees.length, totals.listTotal, 'all');
  return {
    heading: COMMITTEE_LIST_TITLE,
    subheading: registerCountLine(totals.registerTotal, totals.asOf) ?? '',
    bodyHeading: '',
    body: [COMMITTEE_LIST_DEK, ...(showing ? [showing] : []), COMMITTEE_LIST_NOTE],
    bodyIsList: false,
    facts: [],
    records: committees.map((committee) => {
      const registrationNumber = clean(committee.registration_number);
      const name = clean(committee.name);
      const closed = closedChipLabel(committee.termination_date);
      return {
        label: name,
        detail: [
          committeeRowMeta({
            kind: committee.kind ?? null,
            subType: committee.sub_type ?? null,
            office: committee.office ?? null,
            district: committee.district ?? null,
          }),
          closed,
          `REG ${registrationNumber}`,
        ]
          .filter(Boolean)
          .join(' · '),
        href: `/money/committees/${encodeURIComponent(committeeSlug(name, registrationNumber))}`,
      };
    }),
    sections: [
      {
        heading: RECORD_DOES_NOT_COVER_HEADING,
        body: [...RECORD_DOES_NOT_COVER],
        bodyIsList: true,
      },
    ],
    links: [
      ...(page > 1
        ? [{ label: 'Previous', href: directoryPagePath('/money/committees', page - 1) }]
        : []),
      ...(page < totalPages
        ? [{ label: 'Next', href: directoryPagePath('/money/committees', page + 1) }]
        : []),
      ...directoryJumpPages(page, totalPages).map((target) => ({
        label: `Page ${target}`,
        href: directoryPagePath('/money/committees', target),
      })),
      { label: MONEY_LANDING_HEADING, href: '/money' },
    ],
  };
}

/** One committee-year, exactly as `/committees/{number}/finance` serves it. */
export interface CommitteeMoneySnapshotSource {
  registration_number?: string | null;
  committee_name?: string | null;
  entity_type?: string | null;
  entity_sub_type?: string | null;
  year?: number | null;
  fetched_at?: string | null;
  register?: {
    state?: string | null;
    kind?: string | null;
    name?: string | null;
    office?: string | null;
    district?: string | null;
    registration_date?: string | null;
    termination_date?: string | null;
  } | null;
  confirmed_for?: {
    slug?: string | null;
    full_name?: string | null;
  } | null;
  money_in?: {
    state?: string | null;
    other_receipts?: { receipt_type: string; total: string; payments: number }[] | null;
    reported_period_start?: string | null;
    source_url?: string | null;
  } | null;
  money_out?: {
    state?: string | null;
    itemized_payment_total?: string | null;
    itemized_payments?: number | null;
    in_kind_total?: string | null;
    by_type?: { type: string; total: string; payments: number }[] | null;
    reported_total?: string | null;
    reported_through?: string | null;
    stated_spending_state?: string | null;
    source_url?: string | null;
  } | null;
  split?: {
    state?: string | null;
    reported_total?: string | null;
    reported_through?: string | null;
    named_total?: string | null;
    named_payments?: number | null;
    named_in_kind_total?: string | null;
    unnamed_total?: string | null;
    stated_split_state?: string | null;
  } | null;
}

/** The one shape both money snapshots read, so they cannot disagree about a
 *  committee's identity, its state, or the day we copied its figures. */
interface CommitteeIdentity {
  registrationNumber: string;
  name: string;
  slug: string;
  registerKind: string | null;
  isBallot: boolean;
  isPartyUnit: boolean;
  eyebrow: string | null;
  subheading: string;
  checkedOn: string | null;
  state: 'closed-empty' | 'empty-year' | 'figures';
  periodLine: string | null;
  periodDetail: string;
}

/**
 * The header's one line: the register's kind, the registration number, what the
 * committee registered for, and the closed chip.
 *
 * The drawn page puts the kind in an eyebrow above the title and the
 * registered-for line in a chip below it, so a filer whose register entry states
 * only its kind reads correctly there. On one served line the same 2 strings
 * would read "Political committee or fund · Kind as registered: political
 * committee or fund", so the second is dropped when it only repeats the first.
 */
function subheadingFor(parts: {
  eyebrow: string | null;
  registrationNumber: string;
  registeredFor: string | null;
  notInRegister: boolean;
  closed: string | null;
}): string {
  const eyebrow = clean(parts.eyebrow).toLowerCase();
  const registeredFor = clean(parts.registeredFor);
  const repeatsTheKind = Boolean(eyebrow) && registeredFor.toLowerCase().endsWith(eyebrow);
  return [
    parts.eyebrow ?? '',
    `REG ${parts.registrationNumber}`,
    repeatsTheKind ? '' : registeredFor,
    parts.notInRegister ? NOT_IN_REGISTER_LINE : '',
    parts.closed ?? '',
  ]
    .filter(Boolean)
    .join(' · ');
}

function committeeIdentity(
  money: CommitteeMoneySnapshotSource,
  fallbackRegistrationNumber: string,
): CommitteeIdentity {
  const register = money.register ?? {};
  const split = money.split ?? {};
  const moneyIn = money.money_in ?? {};
  const moneyOut = money.money_out ?? {};
  const registrationNumber = clean(money.registration_number) || fallbackRegistrationNumber;
  // The register's own spelling wins, exactly as the screen's canonical forward
  // decides it, so the served address is the one the app rewrites to.
  const name =
    clean(register.name) || clean(money.committee_name) || `Committee ${registrationNumber}`;
  const registerKind =
    register.state === 'reported'
      ? (register.kind ?? null)
      : registerKindFromEntityType(money.entity_type);
  const state = yearDisplayState({
    register: { terminationDate: register.termination_date ?? null },
    split: { reportedTotal: split.reported_total ?? null },
    moneyIn: {
      state: moneyIn.state ?? '',
      otherReceipts: moneyIn.other_receipts ?? [],
    },
    moneyOut: {
      state: moneyOut.state ?? '',
      reportedTotal: moneyOut.reported_total ?? null,
      byType: moneyOut.by_type ?? [],
    },
  });
  const checkedOn = money.fetched_at ? centralDateLabel(money.fetched_at) : null;
  const year = money.year ?? new Date().getFullYear();
  const isPartyUnit = registerKind === 'party_unit';
  return {
    registrationNumber,
    name,
    slug: committeeSlug(name, registrationNumber),
    registerKind,
    isBallot: isBallotQuestionFiler(money.entity_sub_type),
    isPartyUnit,
    eyebrow: committeeEyebrow(registerKind, money.entity_sub_type),
    subheading: subheadingFor({
      eyebrow: committeeEyebrow(registerKind, money.entity_sub_type),
      registrationNumber,
      registeredFor: registeredForLine({
        kind: registerKind,
        office: register.office ?? null,
        district: register.district ?? null,
      }),
      notInRegister: register.state === 'not_registered',
      closed: closedChipLabel(register.termination_date),
    }),
    state,
    checkedOn,
    periodLine:
      state === 'closed-empty'
        ? closedPeriodLine(register.termination_date)
        : state === 'empty-year'
          ? uncoveredPeriodLine(year)
          : coveredPeriodLine(split.reported_through, moneyIn.reported_period_start),
    periodDetail:
      state === 'closed-empty'
        ? closedPeriodDetail(register.termination_date, checkedOn)
        : state === 'empty-year'
          ? uncoveredPeriodDetail(year, checkedOn)
          : coveredPeriodDetail(split.reported_through, checkedOn, {
              isPartyUnit,
              reportedPeriodStart: moneyIn.reported_period_start ?? null,
            }),
  };
}

/** The address a committee's record actually lives at, from its register name. */
export function committeeSnapshotPath(
  money: CommitteeMoneySnapshotSource,
  fallbackRegistrationNumber: string,
  view: 'page' | 'payments' = 'page',
): string {
  const { slug } = committeeIdentity(money, fallbackRegistrationNumber);
  const base = `/money/committees/${encodeURIComponent(slug)}`;
  return view === 'payments' ? `${base}/payments` : base;
}

/** The heading a committee's record carries, for its own title tag. */
export function committeeSnapshotName(
  money: CommitteeMoneySnapshotSource,
  fallbackRegistrationNumber: string,
): string {
  return committeeIdentity(money, fallbackRegistrationNumber).name;
}

export function committeePageSnapshot(
  money: CommitteeMoneySnapshotSource,
  fallbackRegistrationNumber: string,
): PageSnapshot {
  const identity = committeeIdentity(money, fallbackRegistrationNumber);
  const split = money.split ?? {};
  const moneyIn = money.money_in ?? {};
  const moneyOut = money.money_out ?? {};
  const year = money.year ?? new Date().getFullYear();
  const closed = identity.state === 'closed-empty';
  // Both fields or nothing, matching the app's own mapper: the sentence naming a
  // member is also the link to them, so a name with no address is half a fact.
  const confirmedMember =
    money.confirmed_for?.slug && money.confirmed_for.full_name
      ? { slug: money.confirmed_for.slug, fullName: money.confirmed_for.full_name }
      : null;

  const moneyInBlocks: SnapshotBlock[] = [];
  const moneyOutBlocks: SnapshotBlock[] = [];

  if (identity.state !== 'figures') {
    // A missing year says which of the 2 reasons it is, and never prints a 0.
    moneyInBlocks.push({
      kind: 'prose',
      lines: [
        `Donations this committee reported to the state: ${
          closed ? CLOSED_EMPTY_VALUE : EMPTY_YEAR_VALUE
        }`,
        closed ? CLOSED_MONEY_IN_WHY : emptyYearMoneyInWhy(year),
      ],
    });
    moneyOutBlocks.push({
      kind: 'prose',
      lines: [
        `${MONEY_OUT_FIGURE_LABEL}: ${closed ? CLOSED_EMPTY_VALUE : EMPTY_YEAR_VALUE}`,
        closed ? CLOSED_MONEY_OUT_WHY : EMPTY_YEAR_MONEY_OUT_WHY,
      ],
    });
  } else {
    const reported = formatMoney(split.reported_total ?? null);
    const named = moneyFigure(committeeBlockState(moneyIn.state), split.named_total ?? null);
    const unnamed = split.state === 'shown' ? formatMoney(split.unnamed_total ?? null) : null;
    const inKind =
      Number(split.named_in_kind_total ?? 0) > 0
        ? formatMoney(split.named_in_kind_total ?? null)
        : null;
    // A reported zero is a verified zero: the total draws as $0.00 and its own
    // sentence carries the story, with no named/unnamed division of nothing.
    const reportedZero =
      split.state === 'shown' &&
      Number(split.reported_total) === 0 &&
      (split.named_total ?? null) === null;
    const inLines = [
      // Rule 12's 2 numbers. A missing total reads "Not reported"; a filed 0 reads
      // "$0.00"; and the 2 are never subtracted from one another.
      `Donations this committee reported to the state: ${reported ?? 'Not reported'}`,
      ...(reported ? [reportedThroughLabel(split.reported_through) ?? ''] : []),
      ...(reportedZero ? [ZERO_REPORTED_NOTE] : [`Donations with a donor’s name: ${named.text}`]),
      ...(inKind ? [inKindDonationsNote(inKind, true)] : []),
      ...(split.state === 'shown' && unnamed !== null && !reportedZero
        ? [
            `Donations with nobody’s name on them: ${unnamed}`,
            unnamedMoneyExplanation(identity.isBallot),
            statedSplitNote(split.stated_split_state) ?? '',
          ]
        : []),
      splitExplanation((split.state ?? 'no_reported_total') as SplitState) ?? '',
    ].filter(Boolean);
    moneyInBlocks.push({ kind: 'prose', lines: inLines });
    if ((moneyIn.other_receipts ?? []).length) {
      moneyInBlocks.push({
        kind: 'bullets',
        items: (moneyIn.other_receipts ?? []).map((receipt) =>
          [
            receipt.receipt_type,
            formatMoney(receipt.total) ?? '',
            paymentCountLabel(receipt.payments) ?? '',
          ]
            .filter(Boolean)
            .join(' · '),
        ),
      });
    }

    const outTotal = moneyFigure(
      committeeBlockState(moneyOut.state),
      moneyOut.itemized_payment_total ?? null,
    );
    const reportedOut = formatMoney(moneyOut.reported_total ?? null);
    moneyOutBlocks.push({
      kind: 'prose',
      lines: [
        ...(reportedOut
          ? [
              `${MONEY_OUT_REPORTED_LABEL}: ${reportedOut}`,
              reportedThroughLabel(moneyOut.reported_through) ?? '',
            ]
          : []),
        `${MONEY_OUT_FIGURE_LABEL}: ${outTotal.text}`,
        // The goods-and-services line the 2 live cards draw under this figure. It
        // belongs in the first response too: this is what a search engine and a reader
        // on a slow connection see, and a payments total with no such line reads as
        // cash the committee spent (#1894).
        inKindOutNote(moneyOut.in_kind_total ?? null) ?? '',
        moneyOutNote(
          committeeBlockState(moneyOut.state),
          identity.isBallot,
          reportedOut !== null,
          Number(moneyOut.reported_total) === 0,
          listedExceedsReported(moneyOut.reported_total, moneyOut.itemized_payment_total),
        ),
        // Whether the committee's own filed report was read against these payments.
        // The first response is what a search engine and a reader on a slow
        // connection get, so a spending figure nobody has checked must not read as
        // checked here either (#1650). `not_run` and never `not_checked` when the
        // field is absent: our own silence may not borrow Minnesota's excuse.
        statedSpendingNote(moneyOut.stated_spending_state ?? 'not_run') ?? '',
      ].filter(Boolean),
    });
    if ((moneyOut.by_type ?? []).length) {
      moneyOutBlocks.push({
        kind: 'bullets',
        items: (moneyOut.by_type ?? []).map((entry) =>
          [
            moneyOutKindLabel(entry.type),
            formatMoney(entry.total) ?? '',
            paymentCountLabel(entry.payments) ?? '',
          ]
            .filter(Boolean)
            .join(' · '),
        ),
      });
    }
  }

  return {
    heading: identity.name,
    subheading: identity.subheading,
    bodyHeading: '',
    body: [whoseCommitteeText(identity.registerKind, money.entity_sub_type, confirmedMember)],
    bodyIsList: false,
    facts: [],
    sections: [
      {
        heading: identity.periodLine ?? 'Filing period',
        blocks: [{ kind: 'prose', lines: [identity.periodDetail] }],
      },
      { heading: 'Money in', blocks: moneyInBlocks },
      { heading: 'Money out', blocks: moneyOutBlocks },
      {
        heading: RECORD_COVERS_HEADING,
        body: recordCoverageLines(identity.isBallot),
        bodyIsList: true,
      },
    ],
    links: [
      // First, and only when a person confirmed it: this is the crossing from a
      // committee record to the member it belongs to, and it has to be a real anchor
      // in the first response or nothing outside the running app can follow it.
      ...(confirmedMember
        ? [
            {
              label: confirmedMemberLinkLabel(confirmedMember.fullName),
              href: confirmedMemberMoneyPath(confirmedMember.slug),
            },
          ]
        : []),
      {
        label: paymentsTitle('gave'),
        href: `/money/committees/${encodeURIComponent(identity.slug)}/payments`,
      },
      ...(moneyIn.source_url
        ? [{ label: 'Minnesota’s list of named donations', href: moneyIn.source_url }]
        : []),
      { label: COMMITTEE_LIST_TITLE, href: '/money/committees' },
    ],
  };
}

/**
 * One committee's full payments list. Amounts appear here, largest first:
 * ranking payments inside one committee is a fact about that committee, not a
 * comparison between filers on different filing calendars (design doc §7).
 *
 * Every row is built by the same 2 shapers the screen calls, so a served line is
 * a drawn line rather than a second wording of it.
 */
export function committeePaymentsPageSnapshot(
  money: CommitteeMoneySnapshotSource,
  fallbackRegistrationNumber: string,
  payments: {
    state?: string | null;
    rows: readonly PaymentRow[];
    totalPayments: number | null;
  },
): PageSnapshot {
  const identity = committeeIdentity(money, fallbackRegistrationNumber);
  const year = money.year ?? new Date().getFullYear();
  const served = payments.state === 'reported';
  const showing = served ? showingLine(payments.rows.length, payments.totalPayments) : null;
  return {
    heading: paymentsTitle('gave'),
    subheading: [identity.name, `REG ${identity.registrationNumber}`].join(' · '),
    bodyHeading: '',
    body: [
      ...(showing ? [showing] : []),
      ...(served ? [] : [emptyListTitle('gave', year), emptyListWhy(year)]),
      listLinkNote('gave', identity.isBallot),
    ],
    bodyIsList: false,
    facts: [],
    sections: [
      {
        heading: identity.periodLine ?? 'Filing period',
        blocks: [{ kind: 'prose', lines: [identity.periodDetail] }],
      },
      ...(payments.rows.length
        ? [
            {
              heading: paymentsEyebrow('gave'),
              items: payments.rows.map((row) => ({
                label: [
                  row.name,
                  row.inKind ? IN_KIND_CHIP : '',
                  row.meta,
                  row.date ?? '',
                  row.amount ?? '',
                ]
                  .filter(Boolean)
                  .join(' · '),
                href:
                  row.linkNumber && row.linkName
                    ? `/money/committees/${encodeURIComponent(
                        committeeSlug(row.linkName, row.linkNumber),
                      )}`
                    : undefined,
              })),
            },
          ]
        : []),
    ],
    links: [
      { label: identity.name, href: `/money/committees/${encodeURIComponent(identity.slug)}` },
      { label: COMMITTEE_LIST_TITLE, href: '/money/committees' },
    ],
  };
}

// --- Rendering ---

/**
 * One ordered piece of a section. A table is marked up as a real table so a
 * screen reader announces each figure with its column, which is how the loaded
 * page draws it too.
 */
function renderSnapshotBlock(block: SnapshotBlock): string {
  if (block.kind === 'prose') {
    return block.lines.map((line) => `<p class="ps-prose">${escapeHtml(line)}</p>`).join('');
  }
  if (block.kind === 'bullets') {
    return `<ul class="ps-list">${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
  }
  if (block.kind === 'links') {
    const links = block.items
      .map(
        (item) => `<li><a href="${escapeHtml(item.href ?? '')}">${escapeHtml(item.label)}</a></li>`,
      )
      .join('');
    return `<ul class="ps-list">${links}</ul>`;
  }
  const head = `<tr>${block.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('')}</tr>`;
  const body = block.rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
    .join('');
  return `<table class="ps-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

/**
 * The snapshot as HTML. Every value is escaped: 10,471 AI-written summaries are
 * 10,471 chances for one stray character to break the markup.
 *
 * The class names are styled by the static block in
 * `apps/frontend/public/index.html`, so a page carries no per-address CSS.
 */
export function renderPageSnapshot(snapshot: PageSnapshot): string {
  const body = snapshot.body.length
    ? snapshot.bodyIsList
      ? `<ul class="ps-list">${snapshot.body.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
      : snapshot.body.map((item) => `<p class="ps-prose">${escapeHtml(item)}</p>`).join('')
    : '';

  const facts = snapshot.facts.length
    ? `<dl class="ps-facts">${snapshot.facts
        .map(
          (item) =>
            `<dt>${escapeHtml(item.label)}</dt><dd>${item.lines.map((line) => escapeHtml(line)).join('<br />')}</dd>`,
        )
        .join('')}</dl>`
    : '';

  const sections = (snapshot.sections ?? [])
    .map((section) => {
      const orderedBlocks = (section.blocks ?? [])
        .map((block) => renderSnapshotBlock(block))
        .join('');
      const sectionBody = section.body?.length
        ? section.bodyIsList
          ? `<ul class="ps-list">${section.body
              .map((item) => `<li>${escapeHtml(item)}</li>`)
              .join('')}</ul>`
          : section.body.map((item) => `<p class="ps-prose">${escapeHtml(item)}</p>`).join('')
        : '';
      const items = section.items?.length
        ? `<ul class="ps-list">${section.items
            .map((item) =>
              item.href
                ? `<li><a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a></li>`
                : `<li>${escapeHtml(item.label)}</li>`,
            )
            .join('')}</ul>`
        : '';
      return orderedBlocks || sectionBody || items
        ? `<h2>${escapeHtml(section.heading)}</h2>${orderedBlocks}${sectionBody}${items}`
        : '';
    })
    .join('');

  const records = snapshot.records?.length
    ? `<ol class="ps-records">${snapshot.records
        .map(
          (record) =>
            `<li><a href="${escapeHtml(record.href)}"><span class="ps-record-label">${escapeHtml(record.label)}</span>${record.detail ? `<span class="ps-record-detail">${escapeHtml(record.detail)}</span>` : ''}</a></li>`,
        )
        .join('')}</ol>`
    : '';

  const links = snapshot.links.length
    ? `<nav class="ps-links">${snapshot.links
        .map((link) => `<a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`)
        .join('')}</nav>`
    : '';

  return [
    '<div class="page-snapshot">',
    '<div class="ps-inner">',
    `<h1>${escapeHtml(snapshot.heading)}</h1>`,
    snapshot.subheading ? `<p class="ps-sub">${escapeHtml(snapshot.subheading)}</p>` : '',
    body
      ? `${snapshot.bodyHeading ? `<h2>${escapeHtml(snapshot.bodyHeading)}</h2>` : ''}${body}`
      : '',
    sections,
    facts,
    records,
    links,
    '</div>',
    '</div>',
  ]
    .filter(Boolean)
    .join('');
}

/**
 * The markers inside `<div id="root">` in `apps/frontend/public/index.html`.
 *
 * The snapshot goes INSIDE the app's own mount point on purpose. React clears
 * that element's existing children on its first render, so the app replacing the
 * snapshot is the same single browser paint as the app appearing — there is no
 * moment where both are on screen, and no extra script to run. It also means a
 * failed or blocked program leaves the snapshot standing, which is the whole
 * point of putting real text there.
 */
export const SNAPSHOT_MARKER_START = '<!--alethical:page-snapshot-->';
export const SNAPSHOT_MARKER_END = '<!--/alethical:page-snapshot-->';

export function injectPageSnapshot(shellHtml: string, snapshotHtml: string): string {
  const start = shellHtml.indexOf(SNAPSHOT_MARKER_START);
  const end = shellHtml.indexOf(SNAPSHOT_MARKER_END);
  if (start < 0 || end < 0 || end < start) {
    throw new Error('page shell is missing its snapshot markers');
  }
  return (
    shellHtml.slice(0, start + SNAPSHOT_MARKER_START.length) + snapshotHtml + shellHtml.slice(end)
  );
}
