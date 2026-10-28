import { useEffect, useRef, useState } from 'react';

import { takeReturnPath } from '../auth/returnPath';
import { useFinanceSession } from '../auth/session';
import { Link, navigate } from '../router';

/**
 * What the address carried when the page opened, read once and then removed.
 * An emailed link carries its 1-use token after `#`, where it never reaches a
 * web server; the query string is read too, for Google's own parameters.
 */
function readArrival() {
  const query = new URLSearchParams(window.location.search);
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const read = (name: string) => fragment.get(name) ?? query.get(name);
  const arrival = {
    source: read('source'),
    tokenHash: read('token_hash'),
    providerError: read('error'),
  };
  if (arrival.tokenHash) {
    // The 1-use token leaves the address bar before anything else runs.
    window.history.replaceState(null, '', '/auth/return');
  }
  return arrival;
}

/**
 * Where Google, and a first-time address's emailed confirmation link, return.
 * Google's code is exchanged by the Supabase client as the page loads. An
 * emailed link waits for a visible Continue: mail filters that open links
 * would otherwise use the 1-use token before the person does.
 */
export function AuthReturn() {
  const { supabase } = useFinanceSession();
  const [arrival] = useState(readArrival);
  const [state, setState] = useState<'confirm' | 'finishing' | 'failed'>(
    arrival.tokenHash ? 'confirm' : 'finishing',
  );
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, [state]);

  useEffect(() => {
    if (arrival.tokenHash) return;
    let active = true;
    async function finish() {
      if (!arrival.providerError) {
        const { data } = await supabase.auth.getSession();
        if (!active) return;
        if (data.session) {
          navigate(takeReturnPath(), { replace: true });
          return;
        }
      }
      if (arrival.source === 'google') navigate('/sign-in?google=cancelled', { replace: true });
      else setState('failed');
    }
    void finish();
    return () => {
      active = false;
    };
  }, [arrival, supabase]);

  async function confirm() {
    setState('finishing');
    const { error } = await supabase.auth.verifyOtp({
      token_hash: arrival.tokenHash!,
      type: 'email',
    });
    if (error) setState('failed');
    else navigate(takeReturnPath(), { replace: true });
  }

  return (
    <main className="access" id="main">
      <p className="lockup">
        Alethical <span>Finance</span>
      </p>
      {state === 'confirm' && (
        <div className="stack">
          <h1 ref={heading} tabIndex={-1}>
            Finish signing in
          </h1>
          <button type="button" onClick={confirm}>
            Continue
          </button>
        </div>
      )}
      {state === 'finishing' && (
        <h1 ref={heading} tabIndex={-1} role="status">
          Signing in…
        </h1>
      )}
      {state === 'failed' && (
        <div className="stack">
          <h1 ref={heading} tabIndex={-1}>
            That sign-in link didn’t work
          </h1>
          <p>It may have been used already or expired. Ask for a new code.</p>
          <Link to="/sign-in" className="text-link">
            Back to sign-in options
          </Link>
        </div>
      )}
    </main>
  );
}
