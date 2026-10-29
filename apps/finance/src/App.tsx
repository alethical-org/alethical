import { useEffect, useRef, type ReactNode } from 'react';

import { useFinanceSession } from './auth/session';
import { Landing } from './landing/Landing';
import './landing/fonts.css';
import { AuthReturn } from './pages/AuthReturn';
import { FinanceHome } from './pages/FinanceHome';
import { PaymentsUnderName } from './pages/PaymentsUnderName';
import { MoneyByRace } from './pages/MoneyByRace';
import { Recipients } from './pages/Recipients';
import { Lobbying } from './pages/Lobbying';
import { Lobbyist } from './pages/Lobbyist';
import { Principal } from './pages/Principal';
import { Organization } from './pages/Organization';
import { DonorsByEmployer } from './pages/DonorsByEmployer';
import { SearchResults } from './pages/Search';
import { People } from './pages/People';
import { CandidateProfile } from './pages/Candidate';
import { LegislatorProfile } from './pages/Legislator';
import { CampaignMoney } from './pages/CampaignMoney';
import { Committee } from './pages/Committee';
import { CommitteeMembers } from './pages/CommitteeMembers';
import { Legislation } from './pages/Legislation';
import { Bill } from './pages/Bill';
import { RollCall } from './pages/RollCall';
import { NoAccess } from './pages/NoAccess';
import { SignIn } from './pages/SignIn';
import { Checking, NotFound, Unavailable } from './pages/Status';
import { cameByHistory, navigate, savedScroll, useLocation } from './router';
import { isBuilt, matchRoute, type RouteMatch, type RouteName } from './routes';
import { AppShell } from './shell/AppShell';
import './ui/finance.css';

/** Each built signed-in screen. A route missing here answers "not found". */
const SCREENS: Partial<Record<RouteName, (match: RouteMatch) => ReactNode>> = {
  home: () => <FinanceHome />,
  'payments-under-name': (match) => <PaymentsUnderName match={match} />,
  'money-by-race': (match) => <MoneyByRace match={match} />,
  recipients: (match) => <Recipients match={match} />,
  lobbying: (match) => <Lobbying match={match} />,
  lobbyist: (match) => <Lobbyist match={match} />,
  principal: (match) => <Principal match={match} />,
  organization: (match) => <Organization match={match} />,
  employers: (match) => <DonorsByEmployer match={match} />,
  employer: (match) => <DonorsByEmployer match={match} />,
  search: (match) => <SearchResults match={match} />,
  people: (match) => <People match={match} />,
  candidate: (match) => <CandidateProfile match={match} />,
  legislator: (match) => <LegislatorProfile match={match} />,
  'campaign-money': (match) => <CampaignMoney match={match} />,
  committee: (match) => <Committee match={match} />,
  'committee-members': (match) => <CommitteeMembers match={match} />,
  legislation: (match) => <Legislation match={match} />,
  bill: (match) => <Bill match={match} />,
  'roll-call': (match) => <RollCall match={match} />,
};

/** The whole Finance site while its signed-in screens are on. */
export function App() {
  const location = useLocation();
  const { status, accessToken } = useFinanceSession();
  const found = matchRoute(location.pathname);
  // An address whose screen is not built answers exactly as an unknown one.
  const match = found && isBuilt(found.route.name) ? found : null;
  const signedOutRoute = match?.route.signedOut === true;

  // A page's own title only once the reader can see that page.
  const pageVisible = signedOutRoute || status === 'granted';
  useEffect(() => {
    if (match?.route.name === 'landing') document.title = 'Alethical Finance';
    else if (!pageVisible) document.title = 'Alethical Finance';
    else if (match) document.title = `${match.route.title} · Alethical Finance`;
    else document.title = 'Page not found · Alethical Finance';
  }, [match, pageVisible]);

  useEffect(() => {
    if (!signedOutRoute && status === 'signed-out') {
      const next = location.pathname + location.search;
      navigate(`/sign-in?next=${encodeURIComponent(next)}`, { replace: true });
    }
  }, [location, signedOutRoute, status]);

  // When the screen changes after the first one, focus its heading so keyboard
  // and screen-reader users start at the new content. The first screen keeps
  // the browser's own starting point.
  const signInShowsUnavailable =
    match?.route.name === 'sign-in' && accessToken !== null && status === 'unavailable';
  const screen = signedOutRoute
    ? `${location.pathname}|${signInShowsUnavailable ? 'unavailable' : 'page'}`
    : `${location.pathname}|${status === 'granted' ? 'page' : status}`;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const back = cameByHistory() ? savedScroll() : null;
    window.scrollTo(0, back ?? 0);
    document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true });
  }, [screen]);

  // The landing page is for everyone, signed in or not (Design decision D20).
  if (match?.route.name === 'landing') return status === 'no-access' ? <NoAccess /> : <Landing />;
  if (match?.route.name === 'sign-in') {
    // Signed in by code but access could not be checked: offer Try again here.
    return accessToken && status === 'unavailable' ? <Unavailable /> : <SignIn />;
  }
  if (match?.route.name === 'auth-return') return <AuthReturn />;
  if (status === 'loading' || status === 'checking' || status === 'signed-out') return <Checking />;
  if (status === 'no-access') return <NoAccess />;
  if (status === 'unavailable') return <Unavailable />;
  const render = match ? SCREENS[match.route.name] : undefined;
  return (
    <AppShell section={match?.route.section}>
      {render && match ? render(match) : <NotFound />}
    </AppShell>
  );
}
