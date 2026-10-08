import type { CandidateClaimStatus } from '../../data/candidateClaims';

export const profileClaimCopy = {
  claim:
    'Request campaign access to add a statement to this candidate profile. An Alethical administrator must confirm that you are the candidate or an authorized campaign representative.',
  manage:
    'Add, edit or remove your campaign statement on this candidate profile. Your approved profile claim does not let you edit official records.',
  admin:
    'Review requests to claim candidate profiles. Confirm each applicant’s identity and authority to represent the campaign before approving campaign access.',
  adminBlock: 'Admin accounts cannot claim candidate profiles or manage campaign statements',
  closedTitle: 'Profile claims closed for this election',
  closed:
    'Claiming a candidate profile requests campaign access to add a statement. This election has ended, so new profile claim requests are closed.',
  disclosure:
    'An Alethical administrator approved this account’s profile claim after confirming its authority to represent the campaign. This does not mean Alethical has verified the statement’s accuracy.',
  loading: 'Loading profile claim status…',
  failed: 'We couldn’t load your profile claim status',
  link: 'Link to a campaign website or official record',
  explanation: 'Explain your role and how Alethical can confirm it',
  ended:
    'This election has ended, so your profile claim request can no longer be approved. You can still view or withdraw your request.',
  pending:
    'Your profile claim request is waiting for an Alethical administrator’s review. Approval gives you campaign access to add a statement to this candidate profile.',
  approved:
    'An Alethical administrator approved your profile claim request. You can now add, edit or remove your campaign statement on this candidate profile.',
  rejected:
    'Your profile claim request was not approved, so you do not have campaign access to manage this candidate profile’s statement',
  withdrawn:
    'You withdrew your profile claim. You do not have campaign access through this profile claim.',
  revoked:
    'An Alethical administrator revoked your profile claim. You no longer have campaign access to manage this candidate profile’s statement.',
  taken:
    'Another account has approved campaign access to this candidate profile. You can request a review if you are the candidate or an authorized campaign representative.',
  submitUnknown:
    'We couldn’t confirm whether your profile claim request was submitted. Reload its status before trying again.',
  withdrawUnknown:
    'We couldn’t confirm whether your profile claim request was withdrawn. Reload its status before trying again.',
  giveUnknown:
    'We couldn’t confirm whether your profile claim was given up. Reload its status before trying again.',
  givenUp:
    'You gave up your profile claim. You no longer have campaign access to manage this candidate profile’s statement.',
  changed: 'This profile claim request changed. Review the latest status before continuing.',
  decisionUnknown:
    'We couldn’t confirm whether this profile claim decision was saved. Reload the request before trying again.',
  noteHelp:
    'Record how you confirmed the applicant’s identity and campaign authority, or why you are rejecting the profile claim request or revoking the profile claim. Use at least 20 characters.',
  noteShort: 'Write a private review note with at least 20 characters',
  noteLong: 'Keep the private review note to 2000 characters or fewer',
  verifyError:
    'Confirm that you independently verified the applicant’s identity and campaign authority before approving',
};
export const profileClaimHeadings: Record<CandidateClaimStatus, string> = {
  pending: 'Profile claim pending review',
  approved: 'Profile claim approved',
  rejected: 'Profile claim not approved',
  revoked: 'Profile claim revoked',
  withdrawn: 'Profile claim withdrawn',
};
export function profileClaimErrorReason(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const value = error as { reason?: string | null; problem?: string | null };
  return value.reason ?? value.problem?.replaceAll('-', '_') ?? null;
}
export function claimAccountBlock(reason?: string | null) {
  if (reason === 'applicant_is_admin') return profileClaimCopy.adminBlock;
  if (reason === 'email_unconfirmed')
    return 'Confirm your account email before managing a candidate profile';
  if (reason === 'account_inactive') return 'This account has been deactivated';
  if (reason === 'official_record_unavailable')
    return 'The official candidate record could not be confirmed, so new profile claim requests are unavailable';
  return null;
}
export function profileClaimNoteError(note: string) {
  return note.trim().length < 20
    ? profileClaimCopy.noteShort
    : note.length > 2000
      ? profileClaimCopy.noteLong
      : null;
}
export function profileClaimFormErrors(role: string, link: string, explanation: string) {
  const errors: { role?: string; link?: string; explanation?: string } = {};
  if (!['Candidate', 'Authorized campaign representative'].includes(role))
    errors.role = 'Choose your role';
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
  if (explanation.trim().length < 20)
    errors.explanation =
      'Explain your role and how Alethical can confirm it in at least 20 characters';
  else if (explanation.trim().length > 1900)
    errors.explanation = 'Keep your explanation to 1900 characters or fewer';
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
