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

export interface BillSponsor {
  name: string;
  role: 'chief_author' | 'co_author' | 'sponsor' | string;
  legislatorId?: string;
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
  /** The session the bill belongs to, worded as the API serves it ("94th Legislature
   *  (2025) First Special Session"); render it through `formatSessionLabel`. Carried
   *  per bill because a special session is its own session, so a page must not
   *  assume the current one (#746). "Current session" where not served. */
  sessionLabel: string;
  topics: string[];
  chiefSponsorIds: string[];
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
  name: string;
  shortName: string;
  chamber: Chamber;
  district: string;
  party: Party;
  role: string;
  bio: string;
  email?: string;
  phone?: string;
  officeAddress?: string;
  profileUrl?: string;
  /** Official portrait URL (senate.mn / lrl.mn.gov headshot). Undefined for the
   *  handful of members without a scraped photo — render an initials fallback. */
  photoUrl?: string;
  committees: string[];
  /** Committees with their leadership role preserved, for the profile's badge
   *  rows. `committees` keeps the flattened name-only strings for older screens.
   *  Optional: only the live API mapper populates it (mock data omits it). */
  committeeAssignments?: CommitteeAssignment[];
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
  address: string;
  districtSummary: string;
  legislators: Legislator[];
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
  status: string;
  statusKey?: string;
  summary?: string;
  officialUrl?: string;
  policyAreas?: string[];
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
  sessionName?: string;
  dataAsOf?: string;
  // For topic_bills this counts bills; for topic_legislators it counts
  // legislators, with totalBills carrying the underlying bill count.
  totalMatches: number;
  totalBills?: number;
  bills: AskAnswerBill[];
  legislators: AskAnswerLegislator[];
  // legislator_vote (§4.5 vote deflection): the bill the question named, if it
  // resolved. When absent, the deflection degrades to the `bills` list above.
  resolvedBill?: AskAnswerBill;
  // bill_text (§4.1 / §9.4): the RAG prose answer, its passage citations, and
  // the single bill it is scoped to. Present only for a bill_text answer.
  billText?: string;
  citations?: AskCitation[];
  answeringBill?: AskAnswerBill;
}

export interface AskCitation {
  label: string;
  billId: string;
  excerpt: string;
  url: string;
}
