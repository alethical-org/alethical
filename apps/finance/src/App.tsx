import { useEffect } from 'react';

import { useFinanceSession } from './auth/session';
import { AuthReturn } from './pages/AuthReturn';
import { NoAccess } from './pages/NoAccess';
import { Placeholder } from './pages/Placeholder';
import { SignIn } from './pages/SignIn';
import { Checking, NotFound, Unavailable } from './pages/Status';
import { navigate, useLocation } from './router';
import { matchRoute } from './routes';
import { AppShell } from './shell/AppShell';

export function App() {
  const location = useLocation();
  const { status } = useFinanceSession();
  const match = matchRoute(location.pathname);
  const signedOutRoute = match?.route.signedOut === true;

  // A page's own title only once the reader can see that page.
  const pageVisible = signedOutRoute || status === 'granted';
  useEffect(() => {
    document.title =
      match && pageVisible ? `${match.route.title} · Alethical Finance` : 'Alethical Finance';
  }, [match, pageVisible]);

  useEffect(() => {
    if (!signedOutRoute && status === 'signed-out') {
      const next = location.pathname + location.search;
      navigate(`/sign-in?next=${encodeURIComponent(next)}`, { replace: true });
    }
  }, [location, signedOutRoute, status]);

  if (match?.route.name === 'sign-in') return <SignIn />;
  if (match?.route.name === 'auth-return') return <AuthReturn />;
  if (status === 'loading' || status === 'checking' || status === 'signed-out') return <Checking />;
  if (status === 'no-access') return <NoAccess />;
  if (status === 'unavailable') return <Unavailable />;
  return (
    <AppShell section={match?.route.section}>
      {match ? <Placeholder title={match.route.title} /> : <NotFound />}
    </AppShell>
  );
}
