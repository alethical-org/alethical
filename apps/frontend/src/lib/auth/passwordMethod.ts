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
      title: 'Add a password',
      description: `You sign in with Google. A password lets you sign in with ${email} as well. You choose that password here, and your Google password doesn’t change.`,
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
      doneDescription: `Use the new password the next time you sign in with ${email}.`,
    };
  }

  return {
    kind: 'fallback',
    rowLabel: 'Password',
    title: 'Set or change password',
    description: `Choose a password for ${email}.`,
    doneTitle: 'Password saved',
    doneDescription: `Use the new password the next time you sign in with ${email}. Other sign-in options, if you have them, are unchanged.`,
  };
}
