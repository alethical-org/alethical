import { useFinanceSession } from '../auth/session';
import { navigate } from '../router';

export const CONTACT_ADDRESS = 'ask@alethical.com';

/** The 1 answer for every account Finance refuses; it never names a reason. */
export function NoAccess() {
  const { email, signOut } = useFinanceSession();
  return (
    <main className="access" id="main">
      <p className="lockup">
        Alethical <span>Finance</span>
      </p>
      <h1>This account doesn’t have access to Alethical Finance</h1>
      {email && <p>Signed in as {email}</p>}
      <div className="stack">
        <button
          type="button"
          onClick={async () => {
            await signOut();
            navigate('/sign-in', { replace: true });
          }}
        >
          Switch account
        </button>
        <a
          className="button secondary"
          href={`mailto:${CONTACT_ADDRESS}?subject=${encodeURIComponent('Alethical Finance access')}`}
        >
          Contact us
        </a>
      </div>
    </main>
  );
}
