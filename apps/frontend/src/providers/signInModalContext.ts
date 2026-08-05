import { createContext, useContext } from 'react';

import { SignInRequest } from '../lib/signIn';

// The context lives apart from SignInModalProvider so `theme/primitives.tsx` can
// read it without importing the provider — the provider renders SignInDialog,
// which imports primitives, and a direct import would close that circle.

export interface SignInModalValue {
  /** Open the one app-wide sign-in dialog. Ignored when already signed in. */
  openSignIn: (request: SignInRequest) => void;
}

export const SignInModalContext = createContext<SignInModalValue | null>(null);

export function useSignInModal(): SignInModalValue {
  const context = useContext(SignInModalContext);
  if (!context) {
    throw new Error('useSignInModal must be used within SignInModalProvider');
  }
  return context;
}
