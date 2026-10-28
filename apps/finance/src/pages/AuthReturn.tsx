import { useEffect, useState } from 'react';

import { takeReturnPath } from '../auth/returnPath';
import { useFinanceSession } from '../auth/session';
import { Link, navigate, useLocation } from '../router';

/**
 * Where Google and a first-time address's emailed confirmation link return.
 * Google's code is exchanged by the Supabase client as the page loads; an
 * emailed link carries a 1-use token this page proves.
 */
export function AuthReturn() {
  const { supabase } = useFinanceSession();
  const location = useLocation();
  const [failed, setFailed] = useState(false);
  const source = location.searchParams.get('source');
  const tokenHash = location.searchParams.get('token_hash');
  const providerError = location.searchParams.get('error');

  useEffect(() => {
    let active = true;
    async function finish() {
      if (providerError) {
        if (source === 'google') navigate('/sign-in?google=cancelled', { replace: true });
        else setFailed(true);
        return;
      }
      if (tokenHash) {
        const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'email' });
        if (!active) return;
        if (error) {
          setFailed(true);
          return;
        }
      } else {
        const { data } = await supabase.auth.getSession();
        if (!active) return;
        if (!data.session) {
          if (source === 'google') navigate('/sign-in?google=cancelled', { replace: true });
          else setFailed(true);
          return;
        }
      }
      navigate(takeReturnPath(), { replace: true });
    }
    void finish();
    return () => {
      active = false;
    };
  }, [providerError, source, supabase, tokenHash]);

  return (
    <main className="access" id="main">
      <p className="lockup">
        Alethical <span>Finance</span>
      </p>
      {failed ? (
        <div className="stack">
          <h1>That sign-in link didn’t work</h1>
          <p>It may have been used already or expired. Ask for a new code.</p>
          <Link to="/sign-in">Back to sign-in options</Link>
        </div>
      ) : (
        <p role="status">Signing in…</p>
      )}
    </main>
  );
}
