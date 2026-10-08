import type { ImageSourcePropType } from 'react-native';

export interface CandidateElection {
  id: string;
  label: string;
  /** ISO calendar date. The election record owns this date. */
  date: string;
  type: 'general' | 'primary' | 'special';
  canonicalKey?: string;
  capabilities?: {
    addressLookup: 'current-ballot' | 'unavailable';
    results: boolean;
    historicalRecords: boolean;
  };
  officialResultsUrl?: string;
}
export interface CandidateAddressChoice {
  id: string;
  label: string;
  address: string;
}
export interface CandidateLookupRequest {
  address: string;
  electionId: string;
  confirmedChoice?: CandidateAddressChoice;
}
export interface CandidateSource {
  authority: string;
  url: string;
  checkedDate: string;
  stale?: boolean;
  retained?: boolean;
  checkedAt?: string;
  sha256?: string;
}
export interface PublicPersonLink {
  id: string;
  name: string;
  profileUrl: string;
}
export interface CandidateElectionResult {
  status: 'pending' | 'unofficial' | 'certified' | 'recount' | 'tie' | 'unavailable';
  outcome?: 'elected' | 'not-elected' | 'withdrew';
  source?: CandidateSource;
  certification?: { date?: string; authority: string; url: string };
}
export interface CandidatePerson {
  /** Election-specific record ID, not a guessed match to an incumbent. */
  id: string;
  name: string;
  sortName: string;
  party?: string;
  role?: string;
  people?: PublicPersonLink[];
  result?: CandidateElectionResult;
  electionEnded?: boolean;
}
export type CandidateEntry =
  | { kind: 'candidate'; candidate: CandidatePerson }
  | {
      kind: 'ticket';
      id: string;
      label?: string;
      members: CandidatePerson[];
      party?: string;
      result?: CandidateElectionResult;
      people?: PublicPersonLink[];
    };
export type CandidateOfficeGroup = 'state' | 'county' | 'municipal' | 'school' | 'other';
export interface CandidateRace {
  id: string;
  group: CandidateOfficeGroup;
  office: string;
  votingArea: string;
  seatCount?: number;
  entries: CandidateEntry[];
  source: CandidateSource;
  result?: CandidateElectionResult;
}
export interface CandidateCoverageGap {
  kind: 'district-unconfirmed' | 'records-unavailable' | 'coverage-unconfirmed';
  office: string;
  authority: string;
  url: string;
}
export interface CandidateResults {
  kind: 'results';
  electionId: string;
  matchedAddress: string;
  races: CandidateRace[];
  coverage: CandidateCoverageGap[];
  resultsAvailable?: boolean;
  electionEnded?: boolean;
}
export type CandidateLookupResponse =
  | CandidateResults
  | {
      kind: 'historical-match-unavailable';
      message: string;
      electionId: string;
      officialResultsUrl: string;
    }
  | { kind: 'ambiguous'; choices: CandidateAddressChoice[] }
  | { kind: 'no-match' | 'outside-minnesota' | 'rate-limited' | 'no-elections' };
export interface CandidateSearchServices {
  getElections(signal: AbortSignal): Promise<CandidateElection[]>;
  suggest(address: string, signal: AbortSignal): Promise<CandidateAddressChoice[]>;
  lookup(request: CandidateLookupRequest, signal: AbortSignal): Promise<CandidateLookupResponse>;
}
export interface CandidateSearchContentBaseProps {
  /** A public destination can exist before candidate records are connected. */
  recordsAvailable?: boolean;
  services: CandidateSearchServices;
  onOpenProfile(id: string): void;
  initialAddress?: string;
  addressLost?: boolean;
  /** Source disclosure for the injected lookup service. */
  privacyDisclosure?: string;
  imageSource?: ImageSourcePropType;
}
export interface CandidateProfileRecord {
  candidate: CandidatePerson;
  election: CandidateElection;
  office: string;
  votingArea: string;
  source: CandidateSource;
  people?: PublicPersonLink[];
  result?: CandidateElectionResult;
  /** Server cutoff at the end of election day in Minnesota. */
  electionEnded?: boolean;
  filedDate?: string;
  filedWith?: string;
  website?: string;
  runningMate?: CandidatePerson;
  isJointTicket?: boolean;
  photo?: { url: string; credit?: string };
  legislator?: {
    id: string;
    slug: string;
    name: string;
    profileUrl: string;
    serviceStatus: 'current' | 'former' | 'unknown';
    isReelection: boolean;
    office?: string;
    votingArea?: string;
    photoUrl?: string;
    source?: { authority: string; url: string };
  };
}
