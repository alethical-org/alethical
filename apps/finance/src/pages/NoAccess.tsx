import { useFinanceSession } from '../auth/session';
import { navigate } from '../router';
import { AccessPage } from './AccessPage';

export const CONTACT_ADDRESS = 'ask@alethical.com';

/** The 1 answer for every account Finance refuses; it never names a reason.
 * An account refused after having access in this session (Access drawing,
 * "Revoked") also hears that what it held is no longer shown. */
export function NoAccess() {
  const { email, signOut, revoked } = useFinanceSession();
  return (
    <AccessPage linked={false}>
      {revoked ? (
        <>
          <h1 tabIndex={-1}>This account does not have access to Alethical.AI</h1>
          <p>{email ? `${email}. ` : ''}Results kept from this account are no longer shown.</p>
        </>
      ) : (
        <>
          <h1 tabIndex={-1}>This account doesn’t have access to Alethical.AI</h1>
          {email && <p>Signed in as {email}</p>}
        </>
      )}
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
          href={`mailto:${CONTACT_ADDRESS}?subject=${encodeURIComponent('Alethical.AI access')}`}
        >
          Contact us
        </a>
      </div>
    </AccessPage>
  );
}
