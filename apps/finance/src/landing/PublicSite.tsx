import { useEffect } from 'react';

import { useFinanceSession } from '../auth/session';
import { AuthReturn } from '../pages/AuthReturn';
import { NoAccess } from '../pages/NoAccess';
import { SignIn } from '../pages/SignIn';
import { NotFound } from '../pages/Status';
import { useLocation } from '../router';
import { Landing } from './Landing';

/**
 * What Finance serves until its screens are approved (`VITE_FINANCE_SCREENS` is
 * not `on`): the landing page, sign-in and the sign-in return. Every other
 * address is not found, so no unfinished screen is public. A signed-in account
 * that is not on the list is told so; a listed one sees the landing page.
 */
export function PublicSite() {
  const { pathname } = useLocation();
  const { status } = useFinanceSession();
  const page =
    pathname === '/'
      ? 'landing'
      : pathname === '/sign-in'
        ? 'sign-in'
        : pathname === '/auth/return'
          ? 'auth-return'
          : 'not-found';

  useEffect(() => {
    const titles = {
      'sign-in': 'Sign in',
      'auth-return': 'Signing in',
      'not-found': 'Page not found',
    };
    document.title =
      page === 'landing' ? 'Alethical Finance' : `${titles[page]} · Alethical Finance`;
  }, [page]);

  if (page === 'sign-in') return <SignIn />;
  if (page === 'auth-return') return <AuthReturn />;
  if (page === 'not-found') return <NotFound />;
  if (status === 'no-access') return <NoAccess />;
  return <Landing />;
}
