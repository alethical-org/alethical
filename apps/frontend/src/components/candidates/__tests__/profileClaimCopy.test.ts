import { expect, it } from 'vitest';
import {
  profileClaimDate,
  profileClaimExplanationError,
  profileClaimCopy,
  savedProfileClaimRequest,
  statementDateLine,
} from '../profileClaimCopy';

it('reads a role only from an exact role prefix followed by 2 newlines', () => {
  expect(savedProfileClaimRequest('Candidate\n\nI am the candidate.')).toEqual({
    role: 'Candidate',
    explanation: 'I am the candidate.',
  });
  expect(savedProfileClaimRequest('Authorized campaign representative\n\nA\n\n\n\nB ')).toEqual({
    role: 'Authorized campaign representative',
    explanation: 'A\n\n\n\nB ',
  });
  for (const value of [
    'Candidate\nOne newline',
    'candidate\n\nlower case',
    'Campaign manager\n\nX',
  ])
    expect(savedProfileClaimRequest(value)).toEqual({ role: null, explanation: value });
  expect(savedProfileClaimRequest('  Legacy words\n\n\n\nkept  ').explanation).toBe(
    '  Legacy words\n\n\n\nkept  ',
  );
});
it('dates a statement from server evidence only, latest edit first', () => {
  expect(statementDateLine({ published_at: '2026-09-18T15:00:00Z', edited_at: null })).toBe(
    'Published September 18, 2026',
  );
  expect(
    statementDateLine({ published_at: '2026-09-18T15:00:00Z', edited_at: '2026-11-12T15:00:00Z' }),
  ).toBe('Edited November 12, 2026');
  // A missing field (an older cached response) prints nothing rather than a borrowed date.
  expect(statementDateLine({} as never)).toBe('');
  expect(statementDateLine({ published_at: 'not a date', edited_at: null })).toBe('');
});
it('uses the Minnesota calendar day for a late-evening time', () => {
  expect(profileClaimDate('2026-10-09T03:30:00+00:00')).toBe('October 8, 2026');
  expect(profileClaimDate(null)).toBe('');
});
it('gives each explanation length its own message', () => {
  expect(profileClaimExplanationError('   ')).toBe(
    'Explain your role and how Alethical can confirm it',
  );
  expect(profileClaimExplanationError('too short')).toBe(
    'Add more detail about how we can confirm your role (at least 20 characters)',
  );
  expect(profileClaimExplanationError('x'.repeat(1901))).toBe(
    'Keep your explanation to 1900 characters or fewer',
  );
  expect(profileClaimExplanationError('x'.repeat(20))).toBeUndefined();
});
it('speaks for Alethical, never an administrator, in applicant and voter lines', () => {
  const applicantLines = Object.entries(profileClaimCopy)
    .filter(([key]) => !['admin', 'noteGuidance', 'noteHelp', 'noteHelpRevoke'].includes(key))
    .map(([, value]) => value);
  for (const line of applicantLines) expect(line).not.toMatch(/administrator/i);
});
