import type { LinkState, MoneyBlockState, SplitState } from '../lib/legislatorCampaignMoney';

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
}
