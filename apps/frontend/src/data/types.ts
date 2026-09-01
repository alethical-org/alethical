import type {
  FilingSchedule,
  CommitteeMatchCheck,
  CommitteeOutsideThisYear,
  LinkState,
  MoneyBlockState,
  SplitState,
} from '../lib/legislatorCampaignMoney';

export type Chamber = 'House' | 'Senate';
export type Party = 'DFL' | 'R' | 'I';
export type ChatSubjectType = 'bill' | 'legislator' | 'general';

export interface Citation {
  id: string;
  label: string;
  excerpt: string;
  fullText?: string;
  highlightText?: string;
  url: string;
  /** Statute section this key point cites, keyed to a Bill Text section (#377). */
  sectionId: string;
  /** The cited section's 1-based position in the version, when the API could pin
   *  the citation to ONE section. `sectionId` cannot do that on its own: 66
   *  current versions repeat one id across several sections (#854). Absent when
   *  the id is repeated and the stored citation does not say which of them it was
   *  grounded against — then the chip still jumps to the first, but no section
   *  claims the CITED IN SUMMARY badge. */
  sectionOrder?: number | null;
  /** Short topic from the cited section's own heading ("License classes"), served
   *  separately from `label` because the stored label's shape varies by when the
   *  bill was enriched. citationChipLabel appends it only when normalizing the
   *  label leaves no topic. Empty when the section has none worth showing. */
  sectionTopic?: string;
}

export interface OfficialLink {
  id: string;
  label: string;
  url: string;
}

export interface BillAction {
  id: string;
  date: string;
  description: string;
  /**
   * Raw source label / detail, carried through unchanged from the feed. The web
   * Actions timeline (buildActionTimeline) normalizes these into curated
   * plain-language rows, so it works from the source phrasing rather than the
   * already-cooked `description`. `description` stays the display label used by
   * the mobile timeline (unchanged).
   */
  actionText?: string;
  actionDescription?: string;
  /**
   * Committee named by the source on a referral/re-refer action (e.g. "Ways and
   * Means"), from committee_name. Lets the timeline / card render "Referred to
   * {committee}" instead of the generic "…a committee" fallback (#599). Only set
   * when the source actually provided it — never inferred.
   */
  committee?: string;
  /** Roll-call tally for recorded-vote actions (e.g. "62-0"), from roll_call_text. */
  tally?: string;
  /**
   * Source action_number (per-chamber, ascending). The API returns actions
   * grouped by chamber in this order, so a DROP in actionNumber marks a chamber
   * boundary — the timeline uses it to place dateless rows next to their
   * sequence neighbors instead of stranding them (see orderActionsForTimeline).
   */
  actionNumber?: number;
  /**
   * When this action first appeared in our copy of the record (the API's
   * `first_seen_at`). NOT when the Legislature took the step — `date` is that, and
   * it is genuinely empty on entries the Legislature files undated. Used only to
   * place such an entry relative to a reader's last visit, so the tracked-bills
   * page can report it as a change instead of dropping it (#1009). Never displayed.
   */
  firstSeenAt?: string;
  /**
   * Bills this action's target names, already resolved to a bill_key by the API
   * (detail route only). The Actions timeline renders each `code` as a link to
   * `/bills/{id}`. Absent when the row names nothing we serve a page for — a
   * special-session file, or a bare chapter-and-section — in which case the target
   * stays plain text rather than becoming a link that goes nowhere (#745).
   *
   * `title` (the target's plain-language short title) and `status` (its display
   * status label) are facts we store about THAT bill, so the row can say what it
   * is and where it got to instead of showing a bare code (#757). Each is absent
   * when we hold it for no such bill. Neither describes how the two bills relate —
   * the source row states a pointer, not a mechanism.
   */
  crossReferences?: { code: string; id: string; title?: string; status?: string }[];
}

export interface BillVersion {
  id: string;
  label: string;
  date: string;
  summary: string;
  url: string;
  /** True for the API's `version_code="current"` alias row — a pointer at whichever
   *  version is current, carrying a stale "last-touched" date rather than a real
   *  posting date. Dedup in orderBillVersions prefers the real record over it. */
  isCurrentPointer?: boolean;
  /** Revisor version_code (e.g. "1", "e1"); addresses the version's text endpoint. */
  versionCode: string;
  /** Whether this is the bill's current/latest version. */
  isCurrent: boolean;
}

export interface VoteBreakdown {
  yes: number;
  no: number;
  absent: number;
}

export interface IndividualVote {
  legislatorId: string;
  /** Readable profile-URL segment ("melissa-hortman"); links use it in place of
   *  the UUID. Undefined for rows served before slugs were carried through. */
  slug?: string;
  vote: 'YES' | 'NO' | 'ABSENT';
  /** Member name + party carried inline on the roll-call record (the /legislators
   *  list doesn't serve party), so the roster groups by party without a join. */
  name?: string;
  party?: string;
}

export interface VoteEvent {
  id: string;
  motion: string;
  date: string;
  result: string;
  /** Definitive chamber of this roll call, from the DB (never inferred from tallies).
   *  Powers the card's chamber label and consistent per-member honorifics. */
  chamber?: Chamber;
  breakdown: VoteBreakdown;
  votes: IndividualVote[];
  /** Official roll-call record URL (revisor), when served. */
  officialUrl?: string;
}

/** One saved roll-call choice for a legislator, with the record facts needed by
 * the profile's roadmap preview. Missing facts are filtered out by the mapper so
 * the preview never substitutes a made-up bill or date. */
export interface LegislatorVote {
  id: string;
  vote: 'yes' | 'no' | 'absent' | 'excused' | 'present' | 'abstain';
  billId: string;
  billCode: string;
  date: string;
  chamber: Chamber;
}

export interface BillSponsor {
  name: string;
  role: 'chief_author' | 'co_author' | 'sponsor' | string;
  legislatorId?: string;
  /** Readable profile-URL segment ("melissa-hortman"); links use it in place of
   *  the UUID. Undefined for rows served before slugs were carried through. */
  slug?: string;
  chamber?: Chamber;
  party?: string;
  district?: string;
  /** Current city of residence ("Bloomington"), ingested from the official LRL
   *  record (#551). Renders the author card's "{City} (SD 51)"; undefined when
   *  the source states no residence, so the card shows the code alone. */
  representedCity?: string;
}

export interface BillProgressStep {
  key: string;
  label: string;
  reached: boolean;
  current: boolean;
}

export interface BillBriefing {
  what: string;
  why: string;
  keyChanges: string[];
  whoAffected: string[];
  supportersMaySay: string[];
  concernsMayRaise: string[];
}

export interface BillAIAnalysis {
  shortTitle: string | null;
  summary: string;
  keyPoints: string[];
  policyAreas: string[];
}

/** One date a law states about itself, and how many of its sections start then. */
export interface EffectiveScheduleRow {
  /** Display date ("May 28, 2026") — the same shape the rail value uses. */
  date: string;
  /** Sections that state THIS date. Never a count that rests on an inferred date. */
  sections: number;
  /** True when the sections said "the day following final enactment" rather than
   *  naming a calendar date, which the timeline row explains in words. */
  fromEnactment: boolean;
}

/** What a signed law shows for EFFECTIVE (#715).
 *
 *  `single` — every section shares one date (the rail shows it; the timeline gets
 *  one "Law effective" row). `phased` — the law's own text proves two or more
 *  dates, so the rail leads with the earliest (`value`) and the timeline gets one
 *  row per stated date. A phased law whose earliest is NOT provable has a null
 *  `value` and reads "Various dates" instead. */
export interface EffectiveSchedule {
  kind: 'single' | 'phased';
  value: string | null;
  /** Newest first, like every other row on the Actions timeline. */
  rows: EffectiveScheduleRow[];
  totalSections: number;
  /** Sections stating no date at all, which take one of `defaultCandidates`. Plus
   *  the sections in `rows` this need not equal `totalSections`: a section can
   *  state only a coverage window, which is neither a start date nor silence. */
  undatedSections: number;
  /** The two dates Minn. Stat. 645.02 allows a section that states none. */
  defaultCandidates: string[];
}

export interface BillCompanion {
  /** The companion's bill key (e.g. "94-2025-HF2431"); links to /bills/{id}. */
  id: string;
  /** Display code, e.g. "HF 2431". */
  identifier: string;
  chamber: Chamber;
  status: string;
}

export interface Bill {
  id: string;
  identifier: string;
  title: string;
  chamber: Chamber;
  status: string;
  /** Raw latest-action text (e.g. "Referred to", "Effective date"), distinct from
   *  the derived `status` label. Undefined when the source has no action text. */
  latestActionText?: string;
  /** Verbatim statutory effective date (e.g. "July 1, 2027"), served only when the
   *  enacted bill text states one unambiguously (#483). Undefined otherwise — the
   *  UI then falls back to the honest LATEST ACTION treatment (#455 / #480). */
  effectiveDate?: string;
  /** The full EFFECTIVE story for a signed law, shared by the facts rail and the
   *  Actions timeline so they can never disagree (#715). Undefined for anything
   *  that keeps the LATEST ACTION fallback. */
  effectiveSchedule?: EffectiveSchedule;
  isOmnibus?: boolean;
  /** The House/Senate companion bill, when the pair is linked. `id` is the
   *  companion's bill key, so a "Companion" label + "{chamber} ({identifier})"
   *  value row can link to /bills/{id}. Undefined when unlinked or not served (#293). */
  companion?: BillCompanion | null;
  updatedAt: string;
  /** When we last pulled this bill from the Legislature, as the API serves it
   *  (ISO). This is the page's source-line date (#861) — `updatedAt` is the
   *  Legislature's own last action on the bill, which the meta rows already state,
   *  so labelling it "Updated" claimed something about our copy that it never
   *  measured. Undefined when not served; `pulledLabel` then drops the segment
   *  rather than substituting a date that means something else. */
  lastPulledAt?: string;
  /** The session the bill belongs to, worded as the API serves it ("94th Legislature
   *  (2025) First Special Session"); render it through `formatSessionLabel`. Carried
   *  per bill because a special session is its own session, so a page must not
   *  assume the current one (#746). "Current session" where not served. */
  sessionLabel: string;
  /** The session record behind the display label. Older cached list rows may not
   *  carry it, so the raw name above remains as a safe fallback. */
  session?: LegislativeSession;
  topics: string[];
  chiefSponsorIds: string[];
  /** Readable profile-URL slug per chief sponsor, index-aligned with
   *  chiefSponsorIds. Null where a sponsor row carries no slug; the card falls
   *  back to the id, which the backend still resolves. */
  chiefSponsorSlugs?: (string | null)[];
  /** Number of co-authors (co_author-role sponsorships) on the bill, for the
   *  "+N co-authors" line on list cards. Undefined when not served (#295). */
  coAuthorCount?: number;
  sponsors?: BillSponsor[];
  progress?: BillProgressStep[];
  actionCount: number;
  versionCount: number;
  rollCallCount: number;
  briefing: BillBriefing;
  aiAnalysis: BillAIAnalysis | null;
  questionPrompts: string[];
  actions: BillAction[];
  versions: BillVersion[];
  votes: VoteEvent[];
  citations: Citation[];
  officialLinks: OfficialLink[];
}

export interface ServicePeriod {
  id: string;
  startYear: number;
  endYear: number | null;
  chamber: Chamber;
  district: string;
  party: Party;
  role: string;
}

export interface LegislativeSession {
  slug: string;
  name: string;
  isCurrent: boolean;
  sessionNumber: number;
  yearStart: number;
  yearEnd: number;
}

/** One chamber tenure in a member's Legislative Service history (issue #486),
 *  formatted for display. `elected` is the ready-to-render year string
 *  ("2012, re-elected 2014, 2016"); `label` names the chamber elected to. */
export interface ElectionServiceLine {
  chamber: Chamber;
  label: string;
  elected: string;
}

/** A member's Legislative Service: the ordered per-chamber election lines
 *  (earliest first) plus the current-chamber term ordinal ("1st"). Null when the
 *  bio carried no parseable history. */
export interface LegislativeService {
  lines: ElectionServiceLine[];
  term: string | null;
}

export interface CommitteeAssignment {
  name: string;
  /** Leadership role on the committee (e.g. "Chair", "Vice Chair", "Co-Chair",
   *  "Ranking Minority Member"); null for a plain member. */
  role: string | null;
}

export interface Legislator {
  id: string;
  /** Readable profile-URL segment ("melissa-hortman"), unique per jurisdiction.
   *  Profile links and share URLs use it in place of the UUID. */
  slug?: string;
  name: string;
  shortName: string;
  chamber: Chamber;
  district: string;
  party: Party;
  role: string;
  /** Official biography prose. Undefined when the record carries none — every
   *  surface that renders it must check first rather than print a stand-in. */
  bio?: string;
  email?: string;
  phone?: string;
  officeAddress?: string;
  representedCity?: string;
  profileUrl?: string;
  /** Official portrait URL (senate.mn / lrl.mn.gov headshot). Undefined for the
   *  handful of members without a scraped photo — render an initials fallback. */
  photoUrl?: string;
  committees: string[];
  /** Committees with their leadership role preserved, for the profile's badge
   *  rows. `committees` keeps the flattened name-only strings for older screens.
   *  Optional: only the live API mapper populates it (mock data omits it). */
  committeeAssignments?: CommitteeAssignment[];
  issueAreas?: string[];
  totalAuthoredBills?: number;
  chiefAuthoredBills?: number;
  focusAreas: string[];
  serviceHistory: ServicePeriod[];
  /** Ordered Legislative Service history from the official bio (issue #486).
   *  Only the live API detail mapper populates it; undefined on list items and
   *  where the bio carried no history. */
  legislativeService?: LegislativeService | null;
  questionPrompts: string[];
  sponsoredBillIds: string[];
  voteEventRefs: Array<{ billId: string; voteEventId: string }>;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  citations?: Citation[];
}

export interface ChatSession {
  id: string;
  title: string;
  userId: string;
  subjectType: ChatSubjectType;
  subjectId?: string;
  subjectLabel?: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export interface NotificationPreference {
  billUpdates: boolean;
  weeklyDigest: boolean;
  hearingAlerts: boolean;
}

export interface SavedPlace {
  id: string;
  label: string;
  address: string;
  districtSummary: string;
}

export interface UserAccount {
  id: string;
  name: string;
  email: string;
}

export interface RepresentativeLookupResult {
  status: 'found' | 'address-choice';
  address: string;
  districtSummary: string;
  legislators: Legislator[];
  houseLegislator?: Legislator;
  senateLegislator?: Legislator;
  choices?: RepresentativeAddressChoice[];
  coordinate?: RepresentativeLookupCoordinates;
  houseDistrict?: string;
  senateDistrict?: string;
  otherHouseDistrict?: string;
  congressionalDistrict?: string;
  houseGeometry?: GeoJsonGeometry;
  senateGeometry?: GeoJsonGeometry;
  session?: LegislativeSession;
  sourceUpdatedAt?: string;
}

export interface RepresentativeAddressChoice extends RepresentativeLookupCoordinates {
  matchedAddress: string;
}

export interface GeoJsonGeometry {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: number[][][][] | number[][][];
}

export interface RepresentativeLookupCoordinates {
  latitude: number;
  longitude: number;
}

export type RepresentativeLookupInput = string | RepresentativeLookupCoordinates;

export interface AskAnswerBill {
  id: string;
  identifier: string;
  title: string;
  /** The plain-language title (`ai_analysis.short_title`), which is what a card
   *  DISPLAYS. `title` is the full statutory "A bill for an act relating to…" and
   *  stays a hover tooltip / screen-reader label only
   *  (.claude/rules/grounded-answers.md rule 10). */
  shortTitle?: string;
  status: string;
  statusKey?: string;
  summary?: string;
  officialUrl?: string;
  policyAreas?: string[];
  /** Which session this bill is from, served ONLY when it is not the Legislature's
   *  regular session (#810). A special session numbers its files from 1 again, so
   *  two cards can both read "HF 5" and mean different laws; this is what tells
   *  them apart. Absent for every regular-session bill. */
  session?: LegislativeSession;
}

// One routed Ask answer (POST /api/v1/ask). `hasAnswer` is false for intents
// whose answer paths haven't shipped yet — the UI falls back to the interim
// funnel for those.
export interface AskAnswerLegislatorBill {
  id: string;
  identifier: string;
  title: string;
}

export interface AskAnswerLegislator {
  id: string;
  /** Readable profile-URL segment ("melissa-hortman"); links use it in place of
   *  the UUID. Undefined for rows served before slugs were carried through. */
  slug?: string;
  fullName: string;
  party?: string;
  district?: string;
  chamber?: string;
  profileUrl?: string;
  authoredCount: number;
  coauthoredCount: number;
  bills: AskAnswerLegislatorBill[];
}

export interface AskAnswer {
  intent: string;
  hasAnswer: boolean;
  topic?: string;
  session?: LegislativeSession;
  dataAsOf?: string;
  // For topic_bills this counts bills; for topic_legislators it counts
  // legislators, with totalBills carrying the underlying bill count.
  totalMatches: number;
  totalBills?: number;
  /** Set when the list is not a topic result but the answer to a bill number that
   *  names more than one bill ("HF 5" exists in both the regular and the first
   *  special session). Carries the number asked about, so the page says why it is
   *  offering a choice instead of answering (#810). */
  ambiguousReference?: string;
  bills: AskAnswerBill[];
  /** The same topic matches in the 2 orderings the issue-answer control offers.
   * Both are full Bill rows because that page reuses Bill Search's full card. */
  billCards: Bill[];
  latestActionBillCards: Bill[];
  legislators: AskAnswerLegislator[];
  // legislator_vote (§4.5 vote deflection): the bill the question named, if it
  // resolved. When absent, the deflection degrades to the `bills` list above.
  resolvedBill?: AskAnswerBill;
  // bill_text (§4.1 / §9.4): the RAG prose answer, its passage citations, and
  // the single bill it is scoped to. Present only for a bill_text answer.
  billText?: string;
  citations?: AskCitation[];
  answeringBill?: AskAnswerBill;
  /** Full current bill-card facts served with a public saved answer. */
  answeringBillCard?: Bill;
  /** Canonical public question rebuilt from the bill's current saved prompt. */
  question?: string;
  /** How much of the bill the answer was written from: the passages retrieval used,
   *  how many the bill's current version has, and whether the reader asked for EVERY
   *  instance of something (grounded-ask-spec §9.5 decision 11). Absent when the total
   *  could not be established, in which case the page says nothing rather than
   *  guessing. The counts describe OUR retrieval, never the bill's contents.
   *
   *  `enumerating` is what lets a FULLY-read bill still carry a caveat: reading every
   *  passage does not mean the answer listed every item, and without it a list answer
   *  would lose its warning precisely because coverage improved (#868). */
  coverage?: { used: number; total: number; enumerating?: boolean };
}

export interface AskCitation {
  label: string;
  billId: string;
  excerpt: string;
  url: string;
  /** Statute section the passage came from, so the answer page's "From the bill"
   *  card can link into the bill's own Bill Text tab
   *  (`?tab=text#ft-<sectionId>-<sectionOrder>`). Empty when the retrieved chunk
   *  carried no section row — the card then falls back to `url`
   *  (grounded-ask-spec §9.5 decision 4). */
  sectionId: string;
  /** WHICH section that id names: its position in the version. Needed because
   *  `sectionId` is not unique within one (#854), so an id-only anchor lands on the
   *  first section carrying it. Exact on this path — a retrieval chunk holds its
   *  section's own key. Null only when `sectionId` is empty too. */
  sectionOrder: number | null;
  /** Short topic from that section's own heading ("Public facilities authority").
   *  citationChipLabel appends it only when normalizing `label` leaves no topic. */
  sectionTopic: string;
  /** Whether this exact section still exists in the bill's current version. */
  sectionAvailable?: boolean;
}

/**
 * One committee's campaign money for one year, as
 * `GET /api/v1/legislators/{id}/campaign-finance` reports it (#1329).
 *
 * Amounts arrive as strings, deliberately. They are decimals in Postgres and JSON
 * numbers are doubles, so parsing every one into a float here would round cents on
 * figures in the millions — and a figure a reader cannot check against Minnesota's
 * own filing is the one thing this page cannot ship
 * (`.claude/rules/grounded-answers.md` rule 12).
 */
export interface CampaignCommitteeMoney {
  registrationNumber: string;
  /** The committee's name as the reviewer read it when they confirmed the link. */
  committeeNameAsReviewed: string;
  /** The name the current download carries. Can legitimately differ from the above:
   *  the Board publishes a committee's current name against all of its history. */
  committeeName: string | null;
  /** Which office the committee is for. Keeps a race for another office off this
   *  page, which no filing supports putting here. */
  office: string | null;
  /** What a person read when they confirmed this account is this member's, and the day
   *  they did. Read off the stored decision and never recomputed, so a later download
   *  changing a name does not rewrite the basis of a decision already made. Null only for
   *  a decision written before those columns existed, where the card says nothing. */
  checked: CommitteeMatchCheck | null;
  moneyIn: {
    state: MoneyBlockState;
    itemizedContributionTotal: string | null;
    itemizedContributionPayments: number | null;
    otherReceipts: { receiptType: string; total: string; payments: number }[];
    sourceUrl: string | null;
  } | null;
  moneyOut: {
    state: MoneyBlockState;
    itemizedPaymentTotal: string | null;
    itemizedPayments: number | null;
    /** How much of ``itemizedPaymentTotal`` was goods and services rather than money,
     *  from the payments file's own In-kind? column. The money-out twin of
     *  `split.namedInKindTotal`, and the reason the money-out note can name an amount
     *  instead of naming goods and services as a general possibility (#1894). Null
     *  wherever we cannot speak for this committee-year's payment rows at all; a
     *  measured "0" where we hold the rows and none of them is in kind. */
    inKindTotal: string | null;
    /** The committee's own reported figure for the period, and the day that period
     *  ends. Rule 12's second number for money out, which this tab drew nowhere until
     *  now. Null where our copy holds none, and null on a special-election filer-year
     *  whose totals copy cannot speak for the year: 39 such filer-years exist in the
     *  live snapshot, and Rep. Xp Lee's committee 19223 for 2025 is one of them. */
    reportedTotal: string | null;
    reportedThrough: string | null;
    byType: { type: string; total: string; payments: number }[];
    sourceUrl: string | null;
  } | null;
  /** How much of the year's money carried a donor's name and how much did not.
   *  `state` decides whether the numbers may be drawn at all. */
  split: {
    state: SplitState;
    reportedTotal: string | null;
    reportedThrough: string | null;
    namedTotal: string | null;
    namedPayments: number | null;
    /** The cash part of `namedTotal`, which is the only part the subtraction may use:
     *  the state's reported figure excludes donated goods and services. */
    namedCashTotal: string | null;
    /** Named donations of goods and services rather than money. */
    namedInKindTotal: string | null;
    unnamedTotal: string | null;
    /** Whether the committee's own filed report was checked against our rows.
     *  'agrees' is the only value that means verified. */
    statedSplitState: string;
    firstPaymentOn: string | null;
    lastPaymentOn: string | null;
  };
  /** Why this committee-year may have nothing to show: which of the 6 filing-schedule
   *  states it is in, and the dates that go with it. Three of the 6 are facts about
   *  the committee and 3 are our own unfinished work, and rule 12 forbids a page
   *  letting one read like the other. */
  filingSchedule: FilingSchedule;
}

/** One row of the /money landing's filed-reports module: whose committee filed,
 *  which report, the period it covers, and the day the Board received it where
 *  the report's own document states one — never an amount. */
export interface MoneyFilingRow {
  /** The filer's name exactly as registered. */
  filerName: string;
  /** The report's name, e.g. "2026 Pre-Primary Report". */
  reportName: string;
  /** ISO date the period starts, when the filing resolves one — never an
   *  assumed 1 January. */
  periodStart: string | null;
  /** ISO date the period ends (the filing's cutoff). */
  periodEnd: string | null;
  /** ISO date the Board received this report's effective version, read off the
   *  document's own "Received by the Board" line (issue #1670). Null wherever
   *  the Board serves no readable document — the ordinary answer before 2023 —
   *  and null NEVER means unfiled. A null row prints no filed date at all;
   *  falling back to `periodEnd` would be a fabricated fact. */
  filedDate: string | null;
}

/** The filed-reports feed (GET /campaign-finance/filings). `state`
 *  "unavailable" means our gap, never that nobody filed. */
export interface MoneyFilingsFeed {
  state: 'reported' | 'unavailable';
  /** What the feed is ordered by: "filed_date_then_period_end" when some rows
   *  carry a filed date, "period_end" when none does. The printed ordering
   *  sentence derives from this through one mapping (lib/moneyLanding.ts), so
   *  the words and the order cannot drift apart. */
  orderedBy: string;
  filings: MoneyFilingRow[];
  /** The newest completed filing period and how many REPORTS cover it, carried
   *  together because a count must never appear beside a period it does not
   *  describe (grounded-answers rule 12). Null when the server serves no such
   *  block. The count is reports, not committees: a committee that corrects a
   *  filing files a second report for the same period. */
  newestPeriod: { periodEnd: string | null; filingCount: number } | null;
}

/** The landing's counts and dates (GET /campaign-finance/summary). Three
 *  independent blocks, each with its own state, so one gap cannot blank the
 *  others. A null count is our gap and never renders as 0; a served 0 is a
 *  verified zero and renders as the number it is. */
export interface MoneyLandingSummary {
  register: {
    state: 'reported' | 'unavailable';
    filerCount: number | null;
  };
  confirmations: {
    state: 'reported' | 'unavailable';
    confirmedMemberCount: number | null;
    sittingMemberCount: number | null;
    /** ISO timestamp of the newest confirmation; null while there is none. */
    newestConfirmationAt: string | null;
  };
  freshness: {
    /** ISO timestamp we last copied new filings from the Board — the page's one
     *  freshness date. Printed in Central time. */
    downloadsFetchedAt: string | null;
  };
}

/** A legislator's own campaign money for one year. Read `linkState` before
 *  `committees`: an empty list is never on its own a statement about the person. */
export interface LegislatorCampaignMoney {
  legislatorId: string;
  year: number;
  linkState: LinkState;
  /** The day we downloaded Minnesota's files. Not the period the money covers,
   *  which is per committee and always earlier. */
  fetchedAt: string | null;
  committees: CampaignCommitteeMoney[];
  /** Confirmed committees left out because they are for a race other than a
   *  legislative seat. Counted rather than dropped in silence, so a reader who knows
   *  their member ran for something else is told the money exists and is not this. */
  otherOfficeCommittees: number;
  /** Confirmed committees left out because they reported no money in this year.
   *  `closedOn` is the Board's own closing date for the registration, and the only
   *  thing that licenses saying a registration ended. `null` covers 2 cases we cannot
   *  tell apart, still open and absent from the filer list we hold, so both get the
   *  same honest wording. Never infer a closing date from the years on the link:
   *  those are the years money was reported. */
  committeesOutsideThisYear: CommitteeOutsideThisYear[];
}

/** One filer as our copy of the Board's registered-filer directory lists them.
 *  `state` "not_registered" means our copy does not carry the number — a fact
 *  about our copy, never "no such committee". `kind` is the register's own
 *  vocabulary and the only kind label a page may print. */
export interface CommitteeRegisterEntry {
  state: 'reported' | 'not_registered' | 'unavailable';
  kind: string | null;
  name: string | null;
  party: string | null;
  office: string | null;
  district: string | null;
  registrationDate: string | null;
  /** Set when the Board records the committee as terminated. Registration-level:
   *  it makes a closed committee its own display state on every year's view. */
  terminationDate: string | null;
  /** The day our copy of the register was taken (ISO date). */
  asOf: string | null;
}

/** One committee's money for one year (GET /committees/{n}/finance), keyed on the
 *  registration number — the identity, since names collide and numbers do not. */
/** Who a committee has been confirmed to belong to, and where their money lives. */
export interface ConfirmedCommitteeMember {
  legislatorId: string;
  /** The profile's own address part (`/legislators/melissa-hortman`). */
  slug: string;
  fullName: string;
  /** What the person read when they decided, and the day. Read off the stored decision
   *  and never recomputed. Null only for a decision written before those columns
   *  existed, where the page says the match was made and nothing about its basis. */
  checked: CommitteeMatchCheck | null;
}

export interface CommitteeMoney {
  registrationNumber: string;
  /** The name the current download carries (the filer's own wording). */
  committeeName: string | null;
  /** The Board's filer-kind code on the money rows (PCC / PTU / PCF). */
  entityType: string | null;
  /** The Board's sub-type code (CAU a caucus, BC/BF a ballot-question filer). */
  entitySubType: string | null;
  year: number;
  /** ISO timestamp we last copied Minnesota's downloads — the page's one
   *  freshness date, printed in Central time. Never the period money covers. */
  fetchedAt: string | null;
  register: CommitteeRegisterEntry;
  /** The one legislator a **person** has confirmed this committee belongs to, or
   *  null. Never derived from a name, a score, or any agreement between rules: it
   *  is a row somebody signed (design §5.1). Null is the ordinary answer and means
   *  only that nobody has confirmed one — never that the committee is nobody's, and
   *  never that a rejection was recorded, which is a decision about our own proposal
   *  rather than a claim about the committee (§7). */
  confirmedFor: ConfirmedCommitteeMember | null;
  moneyIn: {
    state: MoneyBlockState;
    itemizedContributionTotal: string | null;
    itemizedContributionPayments: number | null;
    otherReceipts: { receiptType: string; total: string; payments: number }[];
    /** The period start the Board's own transcribed disclosure calendars print
     *  against this filing's period end — never an assumed 1 January. Null is
     *  the covers-through state, not a fault. */
    reportedPeriodStart: string | null;
    sourceUrl: string | null;
  };
  moneyOut: {
    state: MoneyBlockState;
    itemizedPaymentTotal: string | null;
    itemizedPayments: number | null;
    byType: { type: string; total: string; payments: number }[];
    /** How much of ``itemizedPaymentTotal`` was goods and services rather than money,
     *  from the payments file's own In-kind? column. The money-out twin of
     *  `split.namedInKindTotal`, and the reason the money-out note can name an amount
     *  instead of naming goods and services as a general possibility (#1894). Null
     *  wherever we cannot speak for this committee-year's payment rows at all; a
     *  measured "0" where we hold the rows and none of them is in kind. */
    inKindTotal: string | null;
    /** The filing's own "Total expenditures" figure — rule 12's second number for
     *  money out. A separate claim by a separate source, never added to or
     *  subtracted from the payments we can list. */
    reportedTotal: string | null;
    reportedThrough: string | null;
    sourceUrl: string | null;
  };
  /** Served, never computed by the page: the 4 withheld states are each a way a
   *  client-side subtraction would state something false (rule 12; design §7). */
  split: {
    state: SplitState;
    reportedTotal: string | null;
    reportedThrough: string | null;
    namedTotal: string | null;
    namedPayments: number | null;
    namedCashTotal: string | null;
    namedInKindTotal: string | null;
    unnamedTotal: string | null;
    statedSplitState: string;
    firstPaymentOn: string | null;
    lastPaymentOn: string | null;
  };
}

/** One payment into a committee, as its own filing lists it. */
export interface CommitteeReceivedPayment {
  contributor: string | null;
  contributorRegistrationNumber: string | null;
  contributorType: string | null;
  employer: string | null;
  amount: string | null;
  receivedOn: string | null;
  receiptType: string | null;
  inKind: string | null;
}

/** One payment out of a committee. A `Contribution`-typed row names another
 *  committee (the affected fields); every other row names a supplier. */
export interface CommitteeMadePayment {
  vendorName: string | null;
  vendorCity: string | null;
  vendorState: string | null;
  affectedCommitteeName: string | null;
  affectedCommitteeRegistrationNumber: string | null;
  amount: string | null;
  paidOn: string | null;
  expenditureType: string | null;
  purpose: string | null;
  inKind: string | null;
}

/** One page of a committee's payments (GET /committees/{n}/payments). Read
 *  `state` before the rows: an empty list is 3 different facts. */
export interface CommitteePaymentsPage<Payment> {
  state: MoneyBlockState;
  payments: Payment[];
  hasMore: boolean;
  /** Every matching row, counted with the same filter as the rows, so a capped
   *  list can say what it is not showing. Null when no count is served. */
  totalPayments: number | null;
  /** Counterparty numbers on this page that this release holds as a filer — the
   *  only names that may render as links. */
  linkableRegistrationNumbers: string[];
  sourceUrl: string | null;
  fetchedAt: string | null;
}

/** One report a committee filed, as the Board's own catalogue records it — never
 *  an amount and never an amendment date (the catalogue's amendment record is
 *  version indexes only). It carries the day the Board received it where the
 *  report's own document states one (issue #1670). */
export interface CommitteeFilingRow {
  /** The report's name as catalogued, e.g. "2026 Pre-Primary Report". */
  reportName: string;
  reportType: string;
  filingYear: number;
  /** ISO date the period starts, only when one of the Board's own filing
   *  calendars prints it — never an assumed 1 January. */
  periodStart: string | null;
  /** ISO date the period ends (the filing's cutoff). Null on a filed report the
   *  catalogue gives no period end for; the row then carries no period line. */
  periodEnd: string | null;
  /** ISO date the Board received this report's effective version, read off the
   *  document's own "Received by the Board" line (issue #1670). Null wherever
   *  the Board serves no readable document, which is most of a committee's
   *  history before 2023 — and null never means unfiled. A null row prints no
   *  filed date rather than falling back to `periodEnd`. */
  filedDate: string | null;
  /** The effective version's index: 0 is the original, 1 and up mean the report
   *  was amended. The AMENDED chip draws from this and carries no date. */
  effectiveAmendmentIndex: number | null;
  amendmentCount: number | null;
}

/** One committee's filed reports (GET /committees/{n}/filings), newest period
 *  first. `state` "unavailable" is our gap, never that nobody filed. */
export interface CommitteeFilingsPage {
  state: 'reported' | 'unavailable';
  /** What the list is ordered by: "filed_date_then_period_end" when some rows
   *  carry a filed date, "period_end" when none does. The printed ordering
   *  sentence derives from this so the words and the order cannot drift apart. */
  orderedBy: string;
  filings: CommitteeFilingRow[];
  hasMore: boolean;
  /** Every filed report, counted with the same filter as the rows. Null when no
   *  count is served. */
  total: number | null;
  /** Catalogue rows for this committee with no filing record — either never
   *  filed, or too old for the Board to serve a version history — so the page
   *  can say the list's boundary instead of implying completeness. */
  cataloguedWithoutRecord: number | null;
}

/** One row of the register as the committees list draws it (GET
 *  /campaign-finance/committees). `subType` is the Board's own code and
 *  deliberately not a label: the wording a reader sees is derived in one place
 *  (`committeeEyebrow` in lib/committeeMoney.ts) so this list cannot label a
 *  filer differently from its own page. `office` and `district` are null on most
 *  rows and that is the register, not a gap — 0 of the 299 party units carry
 *  one. */
export interface CommitteeRegisterRow {
  registrationNumber: string;
  name: string;
  kind: string | null;
  subType: string | null;
  office: string | null;
  district: string | null;
  isClosed: boolean;
  /** ISO date the committee terminated, beside `isClosed` and never instead of
   *  it. */
  terminationDate: string | null;
}

/** One page of the register, A to Z by the filed name. No row carries an amount
 *  and nothing sorts by one: these filers file to different calendars, so 2
 *  dollar figures side by side would set one period against another
 *  (grounded-answers rule 12). */
export interface CommitteeRegisterPage {
  state: 'reported' | 'unavailable';
  /** What the list is ordered by ("name"), so the printed order sentence and the
   *  real order cannot drift apart. */
  orderedBy: string;
  committees: CommitteeRegisterRow[];
  hasMore: boolean;
  /** Counted with the same filter the rows came from, so "showing 50 of 778
   *  candidate committees" is true of the list on screen. */
  total: number | null;
  /** The whole register, whatever filter is applied, so a count on the page can
   *  speak for the register rather than for the filter. */
  registerTotal: number | null;
  /** How many of each of the register's 3 kinds, unfiltered — the filter chips
   *  label themselves from this, and counts that moved when a filter was applied
   *  would read as the filter having found fewer of a kind than exist. */
  byKind: Record<string, number>;
  /** The plain calendar date our copy of the register was counted from. */
  asOf: string | null;
}

/** One result row of the name search. Each carries its own `kind` so a caller
 *  reads the row rather than inferring its shape from the group it arrived in. */
export type NameSearchRow =
  | {
      kind: 'person';
      legislatorId: string;
      slug: string;
      fullName: string;
      chamber: string | null;
      districtCode: string | null;
      party: string | null;
    }
  | {
      kind: 'committee';
      registrationNumber: string;
      name: string;
      filerKind: string | null;
      subType: string | null;
      office: string | null;
      district: string | null;
      isClosed: boolean;
      terminationDate: string | null;
    }
  | {
      kind: 'payment_name';
      name: string;
      /** The role the payments-under-a-name view takes, served verbatim so a
       *  caller never translates it. */
      role: string;
      /** Records carrying this exact spelling. Never an amount. */
      paymentCount: number | null;
    };

/** One group of the name search's answer. A group with nothing in it is still
 *  served and still drawn, so a missing group can never be read as "no matches"
 *  when it meant "we did not look".
 *
 *  Three states, and the middle one is the whole point: `not_reported` means we
 *  searched this part of the records and nothing carried that spelling, while
 *  `unavailable` means we could not read it at all. Collapsing them would print
 *  "a gap on our side" over a verified nothing, which is the missing-versus-zero
 *  failure `.claude/rules/grounded-answers.md` rule 12 forbids. */
export interface NameSearchGroup {
  kind: string;
  state: 'reported' | 'not_reported' | 'unavailable';
  results: NameSearchRow[];
  /** Exact up to the server's counting ceiling, then null with `atLeast` saying
   *  how far the count got. A ceiling printed as a total would be a fabricated
   *  fact (grounded-answers rule 11). */
  total: number | null;
  atLeast: number | null;
  hasMore: boolean;
  reason: string | null;
}

/** One typed name matched across the 5 kinds of record (GET
 *  /campaign-finance/search). `state` "unavailable" with reason
 *  "query_too_short" is a served state, not an error: the page says "type at
 *  least 3 characters" rather than "nothing found", which would be a false claim
 *  about the records. */
export interface NameSearchAnswer {
  state: 'reported' | 'unavailable';
  query: string;
  /** The smallest query the name index can answer on. */
  minQueryLength: number | null;
  /** How many distinct names the server counts before it stops. */
  countedUpTo: number | null;
  groups: NameSearchGroup[];
  reason: string | null;
}
