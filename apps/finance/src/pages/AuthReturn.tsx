import { useEffect, useRef, useState } from 'react';

import { takeReturnPath } from '../auth/returnPath';
import { useFinanceSession } from '../auth/session';
import { Link, navigate } from '../router';

/**
 * What the address carried when the page opened, read once. Finance's emails
 * carry no link, so a sign-in token in the address is never used: it is taken
 * out of the address bar at once, and a crafted link cannot sign a visitor into
 * someone else's account. The query string carries Google's own parameters.
 */
function readArrival() {
  const query = new URLSearchParams(window.location.search);
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  if (query.has('token_hash') || fragment.has('token_hash')) {
    window.history.replaceState(null, '', '/auth/return');
    return { source: null, providerError: null };
  }
  const read = (name: string) => fragment.get(name) ?? query.get(name);
  return { source: read('source'), providerError: read('error') };
}

/**
 * Where Google returns. Google's code is exchanged by the Supabase client as
 * the page loads; without a session the page says sign-in didn't work.
 */
export function AuthReturn() {
  const { supabase } = useFinanceSession();
  const [arrival] = useState(readArrival);
  const [state, setState] = useState<'finishing' | 'failed'>('finishing');
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, [state]);

  useEffect(() => {
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

  return (
    <main className="access" id="main">
      <p className="lockup">
        Alethical <span>Finance</span>
      </p>
      {state === 'finishing' && (
        <h1 ref={heading} tabIndex={-1}>
          Signing in…
        </h1>
      )}
      {state === 'failed' && (
        <div className="stack">
          <h1 ref={heading} tabIndex={-1}>
            That sign-in link didn’t work
          </h1>
          <p>
            It may have been used already, expired, or lost when this page was reloaded. Ask for a
            new code.
          </p>
          <Link to="/sign-in" className="text-link">
            Back to sign-in options
          </Link>
        </div>
      )}
    </main>
  );
}
