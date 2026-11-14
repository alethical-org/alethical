import { lazy, useEffect, type ReactNode } from 'react';

import { useFinanceSession } from './auth/session';
import { Landing } from './landing/Landing';
import './landing/fonts.css';
import { AuthReturn } from './pages/AuthReturn';
import { FinanceHome } from './pages/FinanceHome';
import { NoAccess } from './pages/NoAccess';
import { SignIn } from './pages/SignIn';
import { Checking, NotFound, Unavailable } from './pages/Status';
import { navigate, useLocation } from './router';
import { DeferredScreen, ScreenReady, useScreenFocus } from './routeLoading';
import { isBuilt, matchRoute, type RouteMatch, type RouteName } from './routes';
import { AppShell } from './shell/AppShell';
import './ui/finance.css';

const ElectionSource = lazy(() =>
  import('./pages/elections/Source').then((module) => ({ default: module.ElectionSource })),
);
const PaymentsUnderName = lazy(() =>
  import('./pages/PaymentsUnderName').then((module) => ({ default: module.PaymentsUnderName })),
);
const MoneyByRace = lazy(() =>
  import('./pages/MoneyByRace').then((module) => ({ default: module.MoneyByRace })),
);
const Recipients = lazy(() =>
  import('./pages/Recipients').then((module) => ({ default: module.Recipients })),
);
const Lobbying = lazy(() =>
  import('./pages/Lobbying').then((module) => ({ default: module.Lobbying })),
);
const Lobbyist = lazy(() =>
  import('./pages/Lobbyist').then((module) => ({ default: module.Lobbyist })),
);
const Principal = lazy(() =>
  import('./pages/Principal').then((module) => ({ default: module.Principal })),
);
const Organization = lazy(() =>
  import('./pages/Organization').then((module) => ({ default: module.Organization })),
);
const DonorsByEmployer = lazy(() =>
  import('./pages/DonorsByEmployer').then((module) => ({ default: module.DonorsByEmployer })),
);
const SearchResults = lazy(() =>
  import('./pages/Search').then((module) => ({ default: module.SearchResults })),
);
const MediaBuys = lazy(() =>
  import('./pages/MediaBuys').then((module) => ({ default: module.MediaBuys })),
);
const CheckStationFiles = lazy(() =>
  import('./pages/CheckStationFiles').then((module) => ({ default: module.CheckStationFiles })),
);
const StationFile = lazy(() =>
  import('./pages/StationFile').then((module) => ({ default: module.StationFile })),
);
const StationFolder = lazy(() =>
  import('./pages/StationRecords').then((module) => ({ default: module.StationFolder })),
);
const TVStation = lazy(() =>
  import('./pages/StationRecords').then((module) => ({ default: module.TVStation })),
);
const PrintedAgency = lazy(() =>
  import('./pages/StationRecords').then((module) => ({ default: module.PrintedAgency })),
);
const People = lazy(() => import('./pages/People').then((module) => ({ default: module.People })));
const Person = lazy(() => import('./pages/Person').then((module) => ({ default: module.Person })));
const MoneyConnections = lazy(() =>
  import('./pages/MoneyConnections').then((module) => ({ default: module.MoneyConnections })),
);
const CandidateProfile = lazy(() =>
  import('./pages/Candidate').then((module) => ({ default: module.CandidateProfile })),
);
const LegislatorProfile = lazy(() =>
  import('./pages/Legislator').then((module) => ({ default: module.LegislatorProfile })),
);
const CampaignMoney = lazy(() =>
  import('./pages/CampaignMoney').then((module) => ({ default: module.CampaignMoney })),
);
const Committee = lazy(() =>
  import('./pages/Committee').then((module) => ({ default: module.Committee })),
);
const CommitteeMembers = lazy(() =>
  import('./pages/CommitteeMembers').then((module) => ({ default: module.CommitteeMembers })),
);
const Legislation = lazy(() =>
  import('./pages/Legislation').then((module) => ({ default: module.Legislation })),
);
const Bill = lazy(() => import('./pages/Bill').then((module) => ({ default: module.Bill })));
const RollCall = lazy(() =>
  import('./pages/RollCall').then((module) => ({ default: module.RollCall })),
);

/** Each built signed-in screen. A route missing here answers "not found". */
const SCREENS: Partial<Record<RouteName, (match: RouteMatch) => ReactNode>> = {
  home: () => <FinanceHome />,
  'election-source': (match) => <ElectionSource match={match} />,
  'media-buys': () => <MediaBuys />,
  'check-station-files': () => <CheckStationFiles />,
  'station-file': (match) => <StationFile match={match} />,
  'station-folder': (match) => <StationFolder match={match} />,
  station: (match) => <TVStation match={match} />,
  'printed-agency-name': (match) => <PrintedAgency match={match} />,
  'payments-under-name': (match) => <PaymentsUnderName match={match} />,
  'payments-name-search': (match) => <PaymentsUnderName match={match} />,
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
  person: (match) => <Person match={match} />,
  'money-connections': () => <MoneyConnections />,
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
  const { status, accessToken, canEdit, signInPath } = useFinanceSession();
  const found = matchRoute(location.pathname);
  // An address whose screen is not built answers exactly as an unknown one.
  const editing = found?.route.name === 'check-station-files';
  const match =
    found && isBuilt(found.route.name) && !(canEdit === false && editing) ? found : null;
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
      navigate(`${signInPath}?next=${encodeURIComponent(next)}`, {
        replace: true,
      });
    }
  }, [location, signedOutRoute, status, signInPath]);

  // When the screen changes after the first one, focus its heading so keyboard
  // and screen-reader users start at the new content. The first screen keeps
  // the browser's own starting point.
  const signInShowsUnavailable =
    (match?.route.name === 'sign-in' || match?.route.name === 'investor-access') &&
    accessToken !== null &&
    status === 'unavailable';
  const screen = signedOutRoute
    ? `${location.pathname}|${signInShowsUnavailable ? 'unavailable' : 'page'}`
    : `${location.pathname}|${status === 'granted' ? 'page' : status}`;
  const ready = useScreenFocus(screen);
  const eager = (content: ReactNode) => <ScreenReady onReady={ready}>{content}</ScreenReady>;

  // The landing page is for everyone, signed in or not (Design decision D20).
  if (match?.route.name === 'landing')
    return eager(status === 'no-access' ? <NoAccess /> : <Landing />);
  if (match?.route.name === 'sign-in' || match?.route.name === 'investor-access') {
    // Signed in by code but access could not be checked: offer Try again here.
    return eager(
      accessToken && status === 'unavailable' ? (
        <Unavailable />
      ) : (
        <SignIn key={match.route.name} investor={match.route.name === 'investor-access'} />
      ),
    );
  }
  if (match?.route.name === 'auth-return') return eager(<AuthReturn />);
  if (status === 'loading' || status === 'checking' || status === 'signed-out')
    return eager(<Checking />);
  if (status === 'no-access') return eager(<NoAccess />);
  if (status === 'unavailable') return eager(<Unavailable />);
  const render = match ? SCREENS[match.route.name] : undefined;
  // These address pairs render the same page and retain its in-place search state.
  const family =
    match?.route.name === 'payments-name-search'
      ? 'payments-under-name'
      : match?.route.name === 'employer'
        ? 'employers'
        : match?.route.name;
  return (
    <AppShell section={match?.route.section}>
      <DeferredScreen
        key={family ?? 'not-found'}
        resetKey={location.pathname + location.search}
        onReady={ready}
      >
        {render && match ? render(match) : <NotFound />}
      </DeferredScreen>
    </AppShell>
  );
}
