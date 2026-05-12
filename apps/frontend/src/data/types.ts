export type Chamber = 'House' | 'Senate';
export type Party = 'D' | 'R' | 'I';
export type ChatSubjectType = 'bill' | 'legislator' | 'general';

export interface Citation {
  id: string;
  label: string;
  excerpt: string;
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
}

export interface VoteEvent {
  id: string;
  motion: string;
  date: string;
  result: string;
  breakdown: VoteBreakdown;
  votes: IndividualVote[];
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
  summary: string;
  keyPoints: string[];
  policyAreas: string[];
}

export interface Bill {
  id: string;
  identifier: string;
  title: string;
  chamber: Chamber;
  status: string;
  updatedAt: string;
  sessionLabel: string;
  topics: string[];
  chiefSponsorIds: string[];
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
