import type {
  CandidateElection,
  CandidateElectionResult,
  CandidateSource,
} from '../components/candidates/types';
import { publicApiRequest } from './api';

export interface PreciseDate {
  value: string;
  precision: 'day' | 'month' | 'year';
}
export interface PersonServiceRecord {
  id: string;
  status: 'current' | 'elected' | 'former' | 'unknown';
  office: string;
  votingArea: string;
  source?: Omit<CandidateSource, 'checkedDate'> & { checkedDate?: string };
  profileUrl?: string;
  startDate?: string;
  endDate?: string;
  termStart?: PreciseDate;
  termEnd?: PreciseDate;
  expectedStart?: PreciseDate;
  expectedEnd?: PreciseDate;
  expectedDateSource?: CandidateSource;
  expectedStartPassed?: boolean;
  currentServiceConfirmed?: boolean;
}
export interface PersonElectionRecord {
  candidateId: string;
  profileUrl: string;
  name: string;
  election: CandidateElection;
  office: string;
  votingArea: string;
  source: CandidateSource;
  result?: CandidateElectionResult;
  isJointTicket: boolean;
}
export type ResearchType = 'official-record' | 'article' | 'debate';
export interface PersonResearchRecord {
  id: string;
  type: ResearchType;
  title: string;
  publisher: string;
  eventDate?: string;
  publishedDate?: string;
  source: CandidateSource;
  context:
    | { kind: 'election'; candidateId: string; election: CandidateElection; office: string }
    | { kind: 'service'; serviceId: string; office: string };
  status: 'available' | 'corrected' | 'withdrawn' | 'unavailable';
  correctionDate?: string;
  correctionNote?: string;
}
export interface PersonResearchPage {
  items: PersonResearchRecord[];
  nextCursor: string | null;
}
export interface PersonRecord {
  id: string;
  name: string;
  service: PersonServiceRecord[];
  elections: PersonElectionRecord[];
  research: PersonResearchPage;
  legislator?: { id?: string; slug: string; profileUrl: string };
}
const options = { cache: 'no-store', credentials: 'omit' } as const;
export function getPersonRecord(id: string, signal: AbortSignal) {
  return publicApiRequest<PersonRecord>(`/people/${encodeURIComponent(id)}`, signal, options);
}
export function getPersonResearch(
  id: string,
  signal: AbortSignal,
  cursor?: string,
  type?: ResearchType,
) {
  const query = new URLSearchParams();
  if (cursor) query.set('cursor', cursor);
  if (type) query.set('type', type);
  return publicApiRequest<PersonResearchPage>(
    `/people/${encodeURIComponent(id)}/research?${query}`,
    signal,
    options,
  );
}
export function getLegislatorPerson(slug: string, signal: AbortSignal) {
  return publicApiRequest<{ id: string; name: string; profileUrl: string }>(
    `/people/for-legislator/${encodeURIComponent(slug)}`,
    signal,
    options,
  );
}
