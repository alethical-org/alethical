import { NavigationState, PartialState } from '@react-navigation/native';

import { MainTabParamList, RootStackParamList } from './types';

type WebRouteTarget =
  | { kind: 'tab'; screen: keyof MainTabParamList }
  | { kind: 'bill'; billId: string; tab?: string; track?: boolean }
  | { kind: 'legislator'; legislatorId: string }
  | { kind: 'bills'; params: Record<string, string> }
  | { kind: 'legislators'; params: Record<string, string> }
  | { kind: 'findMyLegislator' }
  | { kind: 'privacy' }
  | { kind: 'terms' }
  | { kind: 'vote'; billId: string; voteEventId: string }
  | { kind: 'chatSession'; params: RootStackParamList['ChatSession'] }
  | { kind: 'ask'; params: RootStackParamList['Ask'] };

// Sign-in returnTo for a signed-out user who tapped Track: land back on the
// bill and auto-complete the track (see BillDetailScreen). Kept here so every
// call site shares one URL shape (grounded-answers.md rule 5).
export function trackSignInReturnTo(billId: string) {
  return `/bills/${encodeURIComponent(billId)}?track=1`;
}

function normalizePathname(pathname: string) {
  const trimmed = pathname.split('?')[0].replace(/\/+$/, '');
  return trimmed.length > 0 ? trimmed : '/';
}

function searchParamsFromPathname(pathname: string) {
  const queryIndex = pathname.indexOf('?');
  return new URLSearchParams(queryIndex >= 0 ? pathname.slice(queryIndex + 1) : '');
}

// URL-addressable Search Bills filters (issue #135). One list drives both
// directions so the query string and the Bills route params stay in lockstep.
const BILLS_FILTER_PARAMS = [
  'q',
  'chamber',
  'status',
  'session',
  'issue',
  'omnibus',
  'sort',
  'page',
] as const;

function billsFilterParams(searchParams: URLSearchParams): Record<string, string> {
  const params: Record<string, string> = {};
  for (const key of BILLS_FILTER_PARAMS) {
    const value = searchParams.get(key);
    if (value) {
      params[key] = value;
    }
  }
  return params;
}

// URL-addressable Search Legislators filters — same shape as Bills so a filtered
// roster is shareable, reload-safe, and survives the browser Back button after
// visiting a legislator profile.
const LEGISLATORS_FILTER_PARAMS = ['q', 'chamber', 'party', 'session', 'page'] as const;

function legislatorsFilterParams(searchParams: URLSearchParams): Record<string, string> {
  const params: Record<string, string> = {};
  for (const key of LEGISLATORS_FILTER_PARAMS) {
    const value = searchParams.get(key);
    if (value) {
      params[key] = value;
    }
  }
  return params;
}

export function targetFromPathname(pathname: string): WebRouteTarget {
  const normalized = normalizePathname(pathname);
  const searchParams = searchParamsFromPathname(pathname);
  const segments = normalized.split('/').filter(Boolean);

  if (segments.length === 0) {
    return { kind: 'tab', screen: 'Home' };
  }

  if (segments.length === 1) {
    if (segments[0] === 'bills') {
      return { kind: 'bills', params: billsFilterParams(searchParams) };
    }
    if (segments[0] === 'legislators') {
      return { kind: 'legislators', params: legislatorsFilterParams(searchParams) };
    }
    if (segments[0] === 'ask') {
      return { kind: 'ask', params: { q: searchParams.get('q') ?? undefined } };
    }
    if (segments[0] === 'privacy') {
      return { kind: 'privacy' };
    }
    if (segments[0] === 'terms') {
      return { kind: 'terms' };
    }
    // '/search', '/tracked', '/chat', '/account', '/find-my-legislator' are
    // old-design or auth-gated surfaces — redirect a stray bookmark/link to a
    // live page instead of resolving to them.
    if (segments[0] === 'search') {
      return { kind: 'bills', params: {} };
    }
    if (
      segments[0] === 'tracked' ||
      segments[0] === 'chat' ||
      segments[0] === 'account' ||
      segments[0] === 'find-my-legislator'
    ) {
      return { kind: 'tab', screen: 'Home' };
    }
  }

  // Bill detail and legislator detail resolve to their redesigned profile
  // screens (docs/mockups/bill-detail-*, legislator-profile-web). Chat sessions
  // are still old-design — redirect those to Home.
  if (segments.length === 2 && segments[0] === 'bills') {
    return {
      kind: 'bill',
      billId: decodeURIComponent(segments[1]),
      tab: searchParams.get('tab') ?? undefined,
      track: searchParams.get('track') === '1' ? true : undefined,
    };
  }

  if (segments.length === 2 && segments[0] === 'legislators') {
    return { kind: 'legislator', legislatorId: decodeURIComponent(segments[1]) };
  }

  if (segments.length === 3 && segments[0] === 'chat' && segments[1] === 'sessions') {
    return { kind: 'tab', screen: 'Home' };
  }

  if (segments.length === 2 && segments[0] === 'chat' && segments[1] === 'new') {
    return { kind: 'tab', screen: 'Home' };
  }

  if (segments.length === 4 && segments[0] === 'bills' && segments[2] === 'votes') {
    return {
      kind: 'vote',
      billId: decodeURIComponent(segments[1]),
      voteEventId: decodeURIComponent(segments[3]),
    };
  }

  return { kind: 'tab', screen: 'Home' };
}

type AnyNavState = NavigationState | PartialState<NavigationState> | undefined;

function activeRouteFromState(state: AnyNavState):
  | {
      name: keyof RootStackParamList | keyof MainTabParamList;
      params?: Record<string, unknown>;
      state?: AnyNavState;
    }
  | undefined {
  if (!state || !state.routes || state.routes.length === 0) {
    return undefined;
  }

  const index = state.index ?? 0;
  const route = state.routes[index] as {
    name: keyof RootStackParamList | keyof MainTabParamList;
    params?: Record<string, unknown>;
    state?: AnyNavState;
  };

  if (route.state) {
    return activeRouteFromState(route.state) ?? route;
  }

  return route;
}

export function pathnameFromNavigationState(
  state: NavigationState | PartialState<NavigationState>,
) {
  const activeRoute = activeRouteFromState(state);

  if (!activeRoute) {
    return '/';
  }

  switch (activeRoute.name) {
    case 'Home':
      return '/';
    case 'Search':
      return '/search';
    case 'Bills': {
      const params = new URLSearchParams();
      for (const key of BILLS_FILTER_PARAMS) {
        const value = (activeRoute.params as Record<string, unknown> | undefined)?.[key];
        if (value) {
          params.set(key, String(value));
        }
      }
      const query = params.toString();
      return query ? `/bills?${query}` : '/bills';
    }
    case 'Legislators': {
      const params = new URLSearchParams();
      for (const key of LEGISLATORS_FILTER_PARAMS) {
        const value = (activeRoute.params as Record<string, unknown> | undefined)?.[key];
        if (value) {
          params.set(key, String(value));
        }
      }
      const query = params.toString();
      return query ? `/legislators?${query}` : '/legislators';
    }
    case 'Tracked':
      return '/tracked';
    case 'Chat':
      return '/chat';
    case 'Account':
      return '/account';
    case 'Ask': {
      const params = new URLSearchParams();
      if (activeRoute.params?.q) {
        params.set('q', String(activeRoute.params.q));
      }
      const query = params.toString();
      return query ? `/ask?${query}` : '/ask';
    }
    case 'BillDetail': {
      const path = `/bills/${encodeURIComponent(String(activeRoute.params?.billId ?? ''))}`;
      const params = new URLSearchParams();
      if (activeRoute.params?.tab) {
        params.set('tab', String(activeRoute.params.tab));
      }
      if (activeRoute.params?.track) {
        params.set('track', '1');
      }
      const query = params.toString();
      return query ? `${path}?${query}` : path;
    }
    case 'LegislatorProfile':
      return `/legislators/${encodeURIComponent(String(activeRoute.params?.legislatorId ?? ''))}`;
    case 'FindMyLegislator':
      return '/find-my-legislator';
    case 'Privacy':
      return '/privacy';
    case 'Terms':
      return '/terms';
    case 'VoteDetail':
      return `/bills/${encodeURIComponent(String(activeRoute.params?.billId ?? ''))}/votes/${encodeURIComponent(String(activeRoute.params?.voteEventId ?? ''))}`;
    case 'ChatSession':
      if (
        !activeRoute.params?.sessionId &&
        activeRoute.params?.subjectType === 'bill' &&
        activeRoute.params?.subjectId
      ) {
        const params = new URLSearchParams();
        if (activeRoute.params.title) {
          params.set('title', String(activeRoute.params.title));
        }
        if (activeRoute.params.seedPrompt) {
          params.set('prompt', String(activeRoute.params.seedPrompt));
        }
        params.set('subjectType', String(activeRoute.params.subjectType));
        params.set('subjectId', String(activeRoute.params.subjectId));
        if (activeRoute.params.subjectLabel) {
          params.set('subjectLabel', String(activeRoute.params.subjectLabel));
        }
        return `/chat/new?${params.toString()}`;
      }
      return activeRoute.params?.sessionId
        ? `/chat/sessions/${encodeURIComponent(String(activeRoute.params.sessionId))}`
        : '/';
    default:
      return '/';
  }
}

const tabOrder: (keyof MainTabParamList)[] = ['Home', 'Search', 'Tracked', 'Chat', 'Account'];

function tabState(screen: keyof MainTabParamList): PartialState<NavigationState> {
  return {
    routes: tabOrder.map((name) => ({ name })),
    index: tabOrder.indexOf(screen),
  };
}

export function stateFromPathname(pathname: string): PartialState<NavigationState> {
  const target = targetFromPathname(pathname);
  const homeTabs = {
    name: 'Tabs',
    state: tabState('Home'),
  };

  switch (target.kind) {
    case 'tab':
      return {
        routes: [
          {
            name: 'Tabs',
            state: tabState(target.screen),
          },
        ],
        index: 0,
      };
    case 'bill':
      return {
        routes: [
          homeTabs,
          {
            name: 'BillDetail',
            params: { billId: target.billId, tab: target.tab, track: target.track },
          },
        ],
        index: 1,
      };
    case 'legislator':
      return {
        routes: [
          homeTabs,
          {
            name: 'LegislatorProfile',
            params: { legislatorId: target.legislatorId },
          },
        ],
        index: 1,
      };
    case 'findMyLegislator':
      return {
        routes: [homeTabs, { name: 'FindMyLegislator' }],
        index: 1,
      };
    case 'bills':
      return {
        routes: [homeTabs, { name: 'Bills', params: target.params }],
        index: 1,
      };
    case 'legislators':
      return {
        routes: [homeTabs, { name: 'Legislators', params: target.params }],
        index: 1,
      };
    case 'privacy':
      return {
        routes: [homeTabs, { name: 'Privacy' }],
        index: 1,
      };
    case 'terms':
      return {
        routes: [homeTabs, { name: 'Terms' }],
        index: 1,
      };
    case 'vote':
      return {
        routes: [
          homeTabs,
          {
            name: 'VoteDetail',
            params: {
              billId: target.billId,
              voteEventId: target.voteEventId,
            },
          },
        ],
        index: 1,
      };
    case 'chatSession':
      return {
        routes: [
          {
            name: 'Tabs',
            state: tabState('Chat'),
          },
          {
            name: 'ChatSession',
            params: target.params,
          },
        ],
        index: 1,
      };
    case 'ask':
      return {
        routes: [homeTabs, { name: 'Ask', params: target.params }],
        index: 1,
      };
  }
}
