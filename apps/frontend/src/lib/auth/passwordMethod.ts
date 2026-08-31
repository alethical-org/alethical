export interface CurrentSignInMethods {
  google: boolean;
  password: boolean;
}

export type PasswordMethodKind = 'add' | 'change' | 'fallback';

export interface PasswordMethodCopy {
  kind: PasswordMethodKind;
  rowLabel: string;
  title: string;
  description: string;
  doneTitle: string;
  doneDescription: string;
}

export function passwordMethodCopy(
  methods: CurrentSignInMethods | null,
  email: string,
): PasswordMethodCopy {
  if (methods?.google && !methods.password) {
    return {
      kind: 'add',
      rowLabel: 'Add a password',
      // The one-door warning: a Google-only account is one lost Google account
      // away from losing Alethical, and this is the only surface candid enough
      // to hold that (rev 12/15, #1533).
      description: `You sign in with Google. A password lets you sign in with ${email} as well — and still works if you ever lose access to Google.`,
      title: 'Add a password',
      doneTitle: 'Password added',
      doneDescription: `You can now sign in with ${email} and this password, or with Google. It’s the same Alethical account.`,
    };
  }

  if (methods?.password) {
    return {
      kind: 'change',
      rowLabel: 'Change password',
      title: 'Change password',
      description: methods.google
        ? `You sign in with Google or with ${email} and a password. This changes only that password — your Google sign-in stays as it is.`
        : `You sign in with ${email} and a password. Your next sign-in uses the new one.`,
      doneTitle: 'Password changed',
      doneDescription: `Use the new password the next time you sign in with ${email}`,
    };
  }

  return {
    kind: 'fallback',
    rowLabel: 'Password',
    title: 'Set or change password',
    description: `Choose a password for ${email}`,
    doneTitle: 'Password saved',
    doneDescription: `Use the new password the next time you sign in with ${email}. Other sign-in options, if you have them, are unchanged.`,
  };
}
