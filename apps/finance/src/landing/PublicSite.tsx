import { useEffect, useRef } from 'react';

import { App } from '../App';

import { useFinanceSession } from '../auth/session';
import { AuthReturn } from '../pages/AuthReturn';
import { NoAccess } from '../pages/NoAccess';
import { SignIn } from '../pages/SignIn';
import { NotFound, Unavailable } from '../pages/Status';
import { useLocation } from '../router';
import { Landing } from './Landing';

/**
 * What Finance serves until its screens are approved (`VITE_FINANCE_SCREENS` is
 * not `on`): the landing page, sign-in and the sign-in return. Every other
 * address is not found, so no unfinished screen is public. A signed-in account
 * that is not on the list is told so; a listed one sees the landing page.
 */
/** The whole app while the screens are approved, the public site otherwise. */
export function FinanceSite({ screens }: { screens: boolean }) {
  return screens ? <App /> : <PublicSite />;
}

export function PublicSite() {
  const { pathname } = useLocation();
  const { status, accessToken } = useFinanceSession();
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

  // When the screen changes after the first one, focus its heading so keyboard
  // and screen-reader users start at the new content, as the full app does.
  const screen = `${pathname}|${status}`;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    document.querySelector<HTMLElement>('main h1')?.focus();
  }, [screen]);

  if (page === 'sign-in') {
    // Signed in by code but access could not be checked: offer Try again here.
    return accessToken && status === 'unavailable' ? <Unavailable /> : <SignIn />;
  }
  if (page === 'auth-return') return <AuthReturn />;
  if (page === 'not-found') return <NotFound />;
  if (status === 'no-access') return <NoAccess />;
  return <Landing />;
}
