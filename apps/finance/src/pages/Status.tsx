import { useEffect, useState } from 'react';

import { useFinanceSession } from '../auth/session';
import { Link } from '../router';

export function Checking() {
  return (
    <main id="main" className="access">
      <h1 tabIndex={-1}>Checking access…</h1>
    </main>
  );
}

export function Unavailable() {
  const { retry, retrying } = useFinanceSession();
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    if (retrying) setAsked(true);
  }, [retrying]);
  const failedAgain = asked && !retrying;
  return (
    <main id="main" className="access">
      <h1 tabIndex={-1}>We couldn’t check your access</h1>
      <p>This is a problem on our side. Try again in a moment.</p>
      {/* aria-disabled keeps keyboard focus on the button while it works. */}
      <button
        type="button"
        aria-disabled={retrying}
        onClick={() => {
          if (!retrying) retry();
        }}
      >
        {retrying ? 'Trying again…' : 'Try again'}
      </button>
      <p role="status" className="note">
        {failedAgain ? 'Still unavailable. Try again in a moment.' : ''}
      </p>
    </main>
  );
}

export function NotFound() {
  return (
    <main id="main" className="page">
      <h1 tabIndex={-1}>We couldn’t find that page</h1>
      <Link to="/" className="text-link">
        Go to Finance home
      </Link>
    </main>
  );
}

export function NotConfigured() {
  return (
    <main id="main" className="access">
      <h1>Alethical Finance is not configured</h1>
      <p>This copy of the app is missing its sign-in or server settings.</p>
    </main>
  );
}
