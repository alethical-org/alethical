import { useFinanceSession } from '../auth/session';
import { Link } from '../router';

export function Checking() {
  return (
    <main id="main" className="access">
      <p role="status">Checking access…</p>
    </main>
  );
}

export function Unavailable() {
  const { retry } = useFinanceSession();
  return (
    <main id="main" className="access">
      <h1>We couldn’t check your access</h1>
      <p>This is a problem on our side. Try again in a moment.</p>
      <button type="button" onClick={retry}>
        Try again
      </button>
    </main>
  );
}

export function NotFound() {
  return (
    <main id="main" className="page">
      <h1>We couldn’t find that page</h1>
      <Link to="/">Go to Finance home</Link>
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
