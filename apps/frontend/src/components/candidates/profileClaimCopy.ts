import type { CandidateClaimStatus, CandidateStatement } from '../../data/candidateClaims';
import { candidateDate } from '../../lib/candidatePublicCopy';

/** Fixed profile claim wording, printed exactly. Applicant and voter lines say "Alethical";
 * only admin screens name the administrator role. */
export const profileClaimCopy = {
  claimLabel: 'Claim this candidate profile',
  claim:
    'Alethical reviews requests from candidates and authorized campaign representatives. Approved access lets you manage campaign information, not official records.',
  manage: 'Manage your campaign’s information on this candidate profile',
  admin:
    'Review requests to claim candidate profiles. Confirm each applicant’s identity and authority to represent the campaign before approving campaign access.',
  pendingAction:
    'Your profile claim request is waiting for Alethical’s review. Approval lets you manage your campaign’s information on this candidate profile.',
  endedAction:
    'This election has ended, so your profile claim request can no longer be approved. You can still view or withdraw your request.',
  rejectedAction:
    'Your profile claim request was not approved. View its status and available next steps.',
  withdrawnAction: 'Your profile claim was withdrawn. View its status and available next steps.',
  revokedAction: 'Alethical revoked your profile claim. View its status and available next steps.',
  closedTitle: 'Profile claims closed for this election',
  closed:
    'Claiming a candidate profile requests access to manage campaign information. This election has ended.',
  electionEnded: 'This election has ended',
  claimsClosed: 'Profile claims are closed for this election',
  disclosure:
    'Alethical verified this account’s authority to represent the campaign, not the statement’s accuracy',
  loading: 'Loading profile claim status…',
  failed: 'We couldn’t load your profile claim status',
  intro:
    'Help voters understand what you stand for, the experience you bring and your plans for the community. Give them one place to find answers, follow your campaign and make an informed choice.',
  featuresLink: 'Explore candidate profile features',
  reviewNote:
    'Alethical reviews requests from candidates and authorized campaign representatives. Approved access lets you manage campaign information, not official records.',
  formIntro:
    'Alethical reviews each request. We may contact you, the candidate or the campaign by email or phone to confirm your identity and permission to manage this profile.',
  link: 'Link to a campaign website or official record',
  linkHelp:
    'A public record can confirm the candidacy, but not your identity or permission to manage this profile',
  explanation: 'Explain your role and how Alethical can confirm it',
  explanationHelp: 'Tell us your role and where we can independently confirm it',
  receivedTitle: 'Profile claim request received',
  received:
    'An Alethical team member will review your request. We may contact you, the candidate or the campaign by email or phone to confirm your identity and permission to manage this profile.',
  returnNote: 'You can leave this page and return to check your request’s status',
  submittedHeading: 'Your submitted information',
  privacyNote: 'This information is not shown on your public profile',
  endedTitle: 'Election ended',
  ended: 'Your profile claim request can no longer be approved',
  alreadyTitle: 'Request already submitted',
  already: 'Your request is waiting for Alethical’s review',
  approved:
    'Alethical approved your profile claim request. You can now manage your campaign’s information on this candidate profile.',
  rejectedOpen:
    'You don’t have access to manage this profile. You can submit another request with information that helps us confirm your role.',
  rejectedClosed:
    'You don’t have access to manage this profile. Profile claims are closed for this election.',
  withdrawnOpen: 'Your request is no longer awaiting review',
  revokedOpen: 'Alethical removed your access to manage this profile',
  revokedClosed:
    'Alethical removed your access to manage this profile. Profile claims are closed for this election.',
  revokedRemoved: 'Your published statement was removed',
  takenTitle: 'This profile is already claimed',
  taken:
    'If you’re the candidate or an authorized campaign representative, you can ask Alethical to review your access',
  adminTitle: 'You’re signed in as an admin',
  adminBody: 'Admin accounts cannot claim candidate profiles or manage campaign information',
  sourceBlocked:
    'The official candidate record could not be confirmed, so new profile claim requests are unavailable',
  submitUnknown:
    'We couldn’t confirm whether your profile claim request was submitted. Reload its status before trying again.',
  withdrawUnknown:
    'We couldn’t confirm whether your profile claim request was withdrawn. Reload its status before trying again.',
  giveUnknown:
    'We couldn’t confirm whether your profile claim was given up. Reload its status before trying again.',
  givenUp:
    'You gave up your profile claim. You can no longer manage your campaign’s information on this candidate profile.',
  givenUpRemoved: ' Your published campaign statement was removed.',
  manageIntro:
    'Manage the campaign information voters see on this profile. Official records are shown separately and can’t be edited here.',
  manageRevoked:
    'Alethical revoked your profile claim. You can no longer manage your campaign’s information on this candidate profile.',
  statementGuidance: 'Tell voters about your experience, priorities and plans in your own words',
  statementGuidancePublished:
    'Edit your statement, then save your changes to update the public profile',
  notSavedUntilPublished: 'Your statement is not saved until you publish it',
  statementTooLong: 'Keep your statement to 2000 characters or fewer',
  statementEmpty: 'Write a statement before publishing',
  giveUpPublished: 'This ends your access and removes your published statement',
  giveUpUnpublished: 'This ends your access to manage this profile',
  giveUpBodyPublished:
    'You’ll lose access to manage campaign information, and your published statement will be removed. The public profile and official records will remain.',
  giveUpBodyUnpublished:
    'You’ll lose access to manage campaign information. The public profile and official records will remain.',
  giveUpUnsaved: 'Your unsaved changes will also be discarded.',
  removeBody: 'Voters will no longer see your statement. You keep access to manage this profile.',
  writeFailed: 'We couldn’t complete this request',
  checking: 'Checking whether your changes were saved…',
  changed: 'This profile claim request changed. Review the latest status before continuing.',
  decisionUnknown:
    'We couldn’t confirm whether this profile claim decision was saved. Reload the request before trying again.',
  noteGuidance:
    'Before approving, confirm the applicant’s identity and campaign authority using contact details you find independently',
  noteHelp:
    'Record who confirmed their authority, how and when, or explain why you are rejecting the request',
  noteHelpRevoke: 'Explain why you are revoking campaign access',
  noteMinimum: 'At least 20 characters',
  noteShort: 'Write a private review note with at least 20 characters',
  noteLong: 'Keep the private review note to 2000 characters or fewer',
  verifyError:
    'Confirm that you independently verified the applicant’s identity and campaign authority before approving',
};
/** Admin status chips; the applicant claim page has its own headings. */
export const profileClaimHeadings: Record<CandidateClaimStatus, string> = {
  pending: 'Pending review',
  approved: 'Profile claim approved',
  rejected: 'Profile claim not approved',
  revoked: 'Profile claim revoked',
  withdrawn: 'Profile claim withdrawn',
};
export const PROFILE_CLAIM_ROLES = ['Candidate', 'Authorized campaign representative'] as const;
/** The saved request is role + 2 newlines + explanation. Only an exact role prefix is a role;
 * anything else, including older requests, is shown whole as the explanation. Never guessed. */
export function savedProfileClaimRequest(value: string): {
  role: string | null;
  explanation: string;
} {
  const role = PROFILE_CLAIM_ROLES.find((item) => value.startsWith(`${item}\n\n`)) ?? null;
  const rest = role ? value.slice(role.length + 2) : value;
  return { role, explanation: rest.trim().replace(/\n{3,}/g, '\n\n') };
}
export function profileClaimErrorReason(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const value = error as { reason?: string | null; problem?: string | null };
  return value.reason ?? value.problem?.replaceAll('-', '_') ?? null;
}
export function claimAccountBlock(reason?: string | null) {
  if (reason === 'applicant_is_admin') return profileClaimCopy.adminBody;
  if (reason === 'email_unconfirmed')
    return 'Confirm your account email before managing a candidate profile';
  if (reason === 'account_inactive') return 'This account has been deactivated';
  if (reason === 'official_record_unavailable') return profileClaimCopy.sourceBlocked;
  return null;
}
export function profileClaimNoteError(note: string) {
  return note.trim().length < 20
    ? profileClaimCopy.noteShort
    : note.length > 2000
      ? profileClaimCopy.noteLong
      : null;
}
export function profileClaimExplanationError(explanation: string) {
  const length = explanation.trim().length;
  if (!length) return 'Explain your role and how Alethical can confirm it';
  if (length < 20)
    return 'Add more detail about how we can confirm your role (at least 20 characters)';
  if (length > 1900) return 'Keep your explanation to 1900 characters or fewer';
  return undefined;
}
export function profileClaimFormErrors(role: string, link: string, explanation: string) {
  const errors: { role?: string; link?: string; explanation?: string } = {};
  if (!(PROFILE_CLAIM_ROLES as readonly string[]).includes(role)) errors.role = 'Choose your role';
  const url = link.trim();
  if (!url) errors.link = 'Add a link to a campaign website or official record';
  else if (url.length > 2000) errors.link = 'Use a web address with no more than 2000 characters';
  else {
    try {
      const parsed = new URL(url);
      if (
        !['https:', 'http:'].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password ||
        !parsed.hostname.includes('.') ||
        /[\s\\]/.test(url) ||
        /\.(localhost|local|internal|test|invalid)$/.test(parsed.hostname) ||
        /^(127\.|10\.|192\.168\.|0\.)/.test(parsed.hostname)
      )
        throw new Error();
    } catch {
      errors.link = 'Enter a valid public campaign or official-record web address';
    }
  }
  const explanationError = profileClaimExplanationError(explanation);
  if (explanationError) errors.explanation = explanationError;
  return errors;
}
export function profileClaimTime(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Chicago',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      }).format(date);
}
/** A calendar date in Minnesota time, or '' when the server value is missing or invalid. */
export function profileClaimDate(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  return candidateDate(parts);
}
/** "Published {first publication}" or "Edited {latest saved edit}", from server evidence only. */
export function statementDateLine(
  statement: Pick<CandidateStatement, 'published_at' | 'edited_at'> | null | undefined,
) {
  if (!statement) return '';
  const edited = profileClaimDate(statement.edited_at);
  if (edited) return `Edited ${edited}`;
  const published = profileClaimDate(statement.published_at);
  return published ? `Published ${published}` : '';
}
