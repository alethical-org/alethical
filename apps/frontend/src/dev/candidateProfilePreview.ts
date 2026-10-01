/** Development-only combinations for reviewing the real public profile controls. */
import { ApiError } from '../data/api';
import type { CandidateProfileRecord } from '../components/candidates/types';
import type { CandidateStatementResponse } from '../data/candidateClaims';

export type ProfilePerson =
  | 'no connection'
  | 'reelection'
  | 'different office'
  | 'former'
  | 'service unknown'
  | 'ticket'
  | 'long name';
export type ProfilePhoto = 'missing' | 'loaded' | 'failed';
export type ProfileCampaign = 'published' | 'absent' | 'failure';
export type ProfileReport = 'success' | 'failure' | 'limited' | 'changed' | 'removed';
export function previewProfile(
  base: CandidateProfileRecord,
  person: ProfilePerson,
  photo: ProfilePhoto,
  old: boolean,
): CandidateProfileRecord {
  const portrait = require('../../assets/dev/candidate-review-portrait.svg');
  const imageUrl = new URL(
    photo === 'failed'
      ? '/candidate-preview-missing-image.png'
      : typeof portrait === 'string'
        ? portrait
        : portrait.uri,
    window.location.origin,
  ).href;
  const record = {
    ...base,
    candidate: { ...base.candidate },
    source: { ...base.source, stale: old },
  };
  if (person === 'long name')
    record.candidate.name = 'Alexandra Example-Sample With A Very Long Candidate Name';
  if (photo !== 'missing') record.photo = { url: imageUrl };
  if (!['no connection', 'long name'].includes(person)) {
    record.legislator = {
      id: 'illustrative',
      slug: 'illustrative-person',
      name: 'Alex Example',
      profileUrl: '/legislators/illustrative-person',
      serviceStatus:
        person === 'former' ? 'former' : person === 'service unknown' ? 'unknown' : 'current',
      isReelection: person === 'reelection',
      office: 'State Representative',
      votingArea: 'House District 59B',
      source: { authority: 'Illustrative service record', url: 'https://www.leg.mn.gov/' },
    };
    if (person === 'different office') {
      record.office = 'Attorney General';
      record.votingArea = 'Statewide';
    }
    if (person === 'ticket') {
      record.isJointTicket = true;
      record.candidate.name = 'Alex Example and Sam Sample';
      record.office = 'Governor and Lieutenant Governor';
      record.votingArea = 'Statewide';
      if (photo !== 'missing') record.legislator.photoUrl = imageUrl;
    }
  }
  return record;
}
export function profilePreviewServices(
  campaign: ProfileCampaign,
  report: ProfileReport,
  slow: boolean,
) {
  let changed = false;
  let attempt = 0;
  async function delay(signal: AbortSignal) {
    if (slow)
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 1800);
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(new Error('Aborted'));
          },
          { once: true },
        );
      });
    if (signal.aborted) throw new Error('Aborted');
  }
  return {
    async getStatement(_id: string, signal: AbortSignal): Promise<CandidateStatementResponse> {
      await delay(signal);
      if (campaign === 'failure') throw new Error('Illustrative failure');
      return {
        statement:
          campaign === 'absent' || (changed && report === 'removed')
            ? null
            : {
                body: changed
                  ? 'This updated illustrative statement is the version you are reporting.'
                  : 'This is an illustrative campaign statement for testing.\n\nThese words are not a real campaign’s statement.',
                updated_at: '2026-10-01T12:00:00Z',
                version: changed ? 2 : 1,
              },
      };
    },
    async getClaims() {
      return { claims: [], account_id: 'private-preview' };
    },
    async reportStatement(_id: string, _reason: string, _version: number, signal: AbortSignal) {
      await delay(signal);
      attempt += 1;
      if (report === 'failure') throw new ApiError(500, 'Illustrative failure');
      if (report === 'limited' && attempt === 1)
        throw new ApiError(429, 'Illustrative wait', null, 3);
      if ((report === 'changed' || report === 'removed') && !changed) {
        changed = true;
        throw new ApiError(409, 'Illustrative changed version');
      }
      return { received: true };
    },
  };
}
