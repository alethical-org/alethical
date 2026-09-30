import type { ImageSourcePropType } from 'react-native';

export interface CandidateElection {
  id: string;
  label: string;
  /** ISO calendar date. The election record owns this date. */
  date: string;
  type: 'general' | 'primary' | 'special';
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
}
export interface CandidatePerson {
  /** Election-specific record ID, not a guessed match to an incumbent. */
  id: string;
  name: string;
  sortName: string;
  party?: string;
  role?: string;
}
export type CandidateEntry =
  | { kind: 'candidate'; candidate: CandidatePerson }
  | { kind: 'ticket'; id: string; members: CandidatePerson[]; party?: string };
export type CandidateOfficeGroup = 'state' | 'county' | 'municipal' | 'school' | 'other';
export interface CandidateRace {
  id: string;
  group: CandidateOfficeGroup;
  office: string;
  votingArea: string;
  seatCount?: number;
  entries: CandidateEntry[];
  source: CandidateSource;
}
export interface CandidateCoverageGap {
  kind: 'district-unconfirmed' | 'records-unavailable';
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
}
export type CandidateLookupResponse =
  | CandidateResults
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
  filedDate?: string;
  filedWith?: string;
  website?: string;
  runningMate?: CandidatePerson;
}
