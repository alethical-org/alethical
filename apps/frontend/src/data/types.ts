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
  /** Roll-call tally for recorded-vote actions (e.g. "62-0"), from roll_call_text. */
  tally?: string;
  /**
   * Source action_number (per-chamber, ascending). The API returns actions
   * grouped by chamber in this order, so a DROP in actionNumber marks a chamber
   * boundary — the timeline uses it to place dateless rows next to their
   * sequence neighbors instead of stranding them (see orderActionsForTimeline).
   */
  actionNumber?: number;
}

export interface BillVersion {
  id: string;
  label: string;
  date: string;
  summary: string;
  url: string;
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
  isOmnibus?: boolean;
  /** The House/Senate companion bill, when the pair is linked. `id` is the
   *  companion's bill key, so a "Companion → {chamber} ({identifier})" row can
   *  link to /bills/{id}. Undefined when unlinked or not served (#293). */
  companion?: BillCompanion | null;
  updatedAt: string;
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
  committees: string[];
  focusAreas: string[];
  serviceHistory: ServicePeriod[];
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
