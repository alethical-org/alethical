import { createCandidateFlow } from '../components/candidates/candidateFlow';
import type {
  CandidateAddressChoice,
  CandidateElection,
  CandidateLookupResponse,
  CandidateProfileRecord,
  CandidateSearchServices,
} from '../components/candidates/types';
import { ApiError, publicApiPost, publicApiRequest } from './api';
import { registerCandidatePrivacyReset } from '../lib/candidatePrivacy';

/** Search requests deliberately bypass caches and never put private fields in a URL. */
export const candidateSearchServices: CandidateSearchServices = {
  getElections: (signal) =>
    publicApiRequest<CandidateElection[]>('/candidates/elections', signal, {
      cache: 'no-store',
      credentials: 'omit',
    }),
  suggest: (address, signal) =>
    publicApiPost<CandidateAddressChoice[]>(
      '/candidates/suggest',
      { address: address.trim() },
      { signal, cache: 'no-store', credentials: 'omit' },
    ).catch((error: unknown) => {
      // The form can still submit a complete address when suggestions are throttled.
      if (error instanceof ApiError && error.status === 429) return [];
      throw error;
    }),
  lookup: (request, signal) =>
    publicApiPost<CandidateLookupResponse>('/candidates/lookup', request, {
      signal,
      cache: 'no-store',
      credentials: 'omit',
    }).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 429) return { kind: 'rate-limited' };
      throw error;
    }),
};

/** One temporary flow for the app lifetime, including profile/back navigation. */
export const candidateFlow = createCandidateFlow(candidateSearchServices);
registerCandidatePrivacyReset(candidateFlow.clear);

/** Homepage handoff: a newer address also invalidates an older pending search. */
export function handoffCandidateAddress(address: string) {
  candidateFlow.clear();
  candidateFlow.setDraftAddress(address.trim());
}

export async function getCandidateProfile(id: string, signal: AbortSignal) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new ApiError(404, 'Candidate record not found');
  const record = await publicApiRequest<CandidateProfileRecord>(`/candidates/${id}`, signal, {
    cache: 'no-store',
    credentials: 'omit',
  });
  if (record.candidate?.id !== id || !record.election?.id || !record.candidate.name?.trim())
    throw new Error('Invalid candidate record');
  return record;
}
