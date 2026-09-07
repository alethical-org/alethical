import { PropsWithChildren, useMemo, useRef, useState } from 'react';

import { loadSignInBundle } from '../lib/auth/loadSignInBundle';
import { signInWorkPendingOnLoad } from '../lib/auth/signInWorkPending';
import { loadOnDemand } from '../lib/loadOnDemand';
import type { SignInRequest } from '../lib/signIn';
import { SignInModalContext, type SignInModalValue } from './signInModalContext';

/**
 * Where sign-in stops being part of every page.
 *
 * The dialog, the fields, the account flows and the client that talks to the
 * sign-in service are about 260,000 minified bytes, and a reader who is not
 * signed in and is not signing in uses none of it — which on the campaign-money
 * pages is nearly everybody
 * ([#1976](https://github.com/alethical-org/alethical/issues/1976)). So this file
 * is what every page carries: it hands each screen an `openSignIn` from the first
 * byte and fetches the rest the moment one is actually needed.
 *
 * **Two things can need it, and both are covered.** Somebody presses a button, so
 * the press is held and replayed once the machinery is running. Or the page load
 * itself already has sign-in work waiting — a saved session to restore, a sign-in
 * returning from Google, a request stashed before that redirect, a link naming a
 * screen — which `signInWorkPendingOnLoad` answers before anything is fetched.
 *
 * **The machinery is a sibling of the page, not a wrapper around it.** It sits
 * exactly where the dialog used to sit, after `children`, so arriving does not
 * remount the page underneath it and nothing a reader had on screen is lost.
 * That is why the one function screens read comes from here and is redirected
 * inward, rather than the machinery providing it: the value a screen holds must
 * not change identity when the fetch lands.
 */
const SignInMachinery = loadOnDemand(() =>
  loadSignInBundle().then((bundle) => ({ default: bundle.SignInMachinery })),
);

export function SignInModalProvider({ children }: PropsWithChildren) {
  const [wanted, setWanted] = useState(signInWorkPendingOnLoad);
  const [heldPress, setHeldPress] = useState<SignInRequest | null>(null);
  const realOpen = useRef<((request: SignInRequest) => void) | null>(null);

  const value = useMemo<SignInModalValue>(
    () => ({
      openSignIn: (request) => {
        const open = realOpen.current;
        if (open) {
          open(request);
          return;
        }
        // Nothing to open yet. Hold what was asked for and fetch what opens it;
        // the machinery replays this press as soon as it is running.
        setHeldPress({ ...request });
        setWanted(true);
      },
    }),
    [],
  );

  return (
    <SignInModalContext.Provider value={value}>
      {children}
      {wanted ? (
        <SignInMachinery
          onReady={(open: (request: SignInRequest) => void) => {
            realOpen.current = open;
          }}
          initialRequest={heldPress}
        />
      ) : null}
    </SignInModalContext.Provider>
  );
}
