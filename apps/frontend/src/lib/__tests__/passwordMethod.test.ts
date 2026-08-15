import { describe, expect, it } from 'vitest';

import { passwordMethodCopy } from '../auth/passwordMethod';

const EMAIL = 'jordan@example.com';

describe('signed-in password wording', () => {
  it('uses Add only when Google works and no password exists', () => {
    expect(passwordMethodCopy({ google: true, password: false }, EMAIL)).toEqual({
      kind: 'add',
      rowLabel: 'Add a password',
      title: 'Add a password',
      // The one-door warning (rev 12/15, #1533): a Google-only account is one
      // lost Google account away from losing Alethical.
      description:
        'You sign in with Google. A password lets you sign in with jordan@example.com as well — and still works if you ever lose access to Google.',
      doneTitle: 'Password added',
      doneDescription:
        'You can now sign in with jordan@example.com and this password, or with Google. It’s the same Alethical account.',
    });
  });

  it('uses the password-only Change wording', () => {
    expect(passwordMethodCopy({ google: false, password: true }, EMAIL)).toMatchObject({
      kind: 'change',
      rowLabel: 'Change password',
      title: 'Change password',
      description:
        'You sign in with jordan@example.com and a password. Your next sign-in uses the new one.',
      doneTitle: 'Password changed',
      doneDescription: 'Use the new password the next time you sign in with jordan@example.com',
    });
  });

  it('keeps Google named when both methods work', () => {
    expect(passwordMethodCopy({ google: true, password: true }, EMAIL)).toMatchObject({
      kind: 'change',
      rowLabel: 'Change password',
      title: 'Change password',
      description:
        'You sign in with Google or with jordan@example.com and a password. This changes only that password — your Google sign-in stays as it is.',
    });
  });

  it('claims no method when the read is unavailable or contradictory', () => {
    for (const methods of [null, { google: false, password: false }]) {
      expect(passwordMethodCopy(methods, EMAIL)).toEqual({
        kind: 'fallback',
        rowLabel: 'Password',
        title: 'Set or change password',
        description: 'Choose a password for jordan@example.com',
        doneTitle: 'Password saved',
        doneDescription:
          'Use the new password the next time you sign in with jordan@example.com. Other sign-in options, if you have them, are unchanged.',
      });
    }
  });
});
