import { registerCandidatePrivacyReset } from './candidatePrivacy';

/** Unsent profile claim answers for one signed-in account and one candidate.
 *
 * Kept in memory only, so a visit to /candidates/features and back returns the
 * claim step as it was left. Never written to browser storage or an address: the
 * answers are private evidence. Any account change clears every draft. */
export interface ProfileClaimDraft {
  role: string;
  link: string;
  explanation: string;
  errors: { role?: string; link?: string; explanation?: string };
}

const drafts = new Map<string, ProfileClaimDraft>();
const key = (accountId: string, candidateId: string) => `${accountId}\u0000${candidateId}`;

export function readProfileClaimDraft(accountId: string, candidateId: string) {
  return drafts.get(key(accountId, candidateId)) ?? null;
}
export function saveProfileClaimDraft(
  accountId: string,
  candidateId: string,
  draft: ProfileClaimDraft,
) {
  const empty = !draft.role && !draft.link && !draft.explanation;
  if (empty && !Object.values(draft.errors).some(Boolean))
    drafts.delete(key(accountId, candidateId));
  else drafts.set(key(accountId, candidateId), draft);
}
export function clearProfileClaimDraft(accountId: string, candidateId: string) {
  drafts.delete(key(accountId, candidateId));
}
export function clearAllProfileClaimDrafts() {
  drafts.clear();
}
registerCandidatePrivacyReset(clearAllProfileClaimDrafts);
