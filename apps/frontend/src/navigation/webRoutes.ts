import { NavigationState, PartialState } from '@react-navigation/native';

import { MainTabParamList, RootStackParamList } from './types';

type WebRouteTarget =
  | { kind: 'tab'; screen: keyof MainTabParamList }
  | { kind: 'bill'; billId: string }
  | { kind: 'legislator'; legislatorId: string }
  | { kind: 'findMyLegislator' }
  | { kind: 'vote'; billId: string; voteEventId: string }
  | { kind: 'chatSession'; sessionId: string };

function normalizePathname(pathname: string) {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed.length > 0 ? trimmed : '/';
}

export function targetFromPathname(pathname: string): WebRouteTarget {
  const normalized = normalizePathname(pathname);
  const segments = normalized.split('/').filter(Boolean);

  if (segments.length === 0) {
    return { kind: 'tab', screen: 'Home' };
  }

  if (segments.length === 1) {
    if (segments[0] === 'search') {
      return { kind: 'tab', screen: 'Search' };
    }
    if (segments[0] === 'tracked') {
      return { kind: 'tab', screen: 'Tracked' };
    }
    if (segments[0] === 'chat') {
      return { kind: 'tab', screen: 'Chat' };
    }
    if (segments[0] === 'account') {
      return { kind: 'tab', screen: 'Account' };
    }
    if (segments[0] === 'find-my-legislator') {
      return { kind: 'findMyLegislator' };
    }
  }

  if (segments.length === 2 && segments[0] === 'bills') {
    return { kind: 'bill', billId: decodeURIComponent(segments[1]) };
  }

  if (segments.length === 2 && segments[0] === 'legislators') {
    return { kind: 'legislator', legislatorId: decodeURIComponent(segments[1]) };
  }

  if (segments.length === 3 && segments[0] === 'chat' && segments[1] === 'sessions') {
    return { kind: 'chatSession', sessionId: decodeURIComponent(segments[2]) };
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

function activeRouteFromState(
  state: AnyNavState
):
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
  state: NavigationState | PartialState<NavigationState>
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
    case 'Tracked':
      return '/tracked';
    case 'Chat':
      return '/chat';
    case 'Account':
      return '/account';
    case 'BillDetail':
      return `/bills/${encodeURIComponent(String(activeRoute.params?.billId ?? ''))}`;
    case 'LegislatorProfile':
      return `/legislators/${encodeURIComponent(String(activeRoute.params?.legislatorId ?? ''))}`;
    case 'FindMyLegislator':
      return '/find-my-legislator';
    case 'VoteDetail':
      return `/bills/${encodeURIComponent(String(activeRoute.params?.billId ?? ''))}/votes/${encodeURIComponent(String(activeRoute.params?.voteEventId ?? ''))}`;
    case 'ChatSession':
      return activeRoute.params?.sessionId
        ? `/chat/sessions/${encodeURIComponent(String(activeRoute.params.sessionId))}`
        : '/chat';
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
        routes: [homeTabs, { name: 'BillDetail', params: { billId: target.billId } }],
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
            params: { sessionId: target.sessionId },
          },
        ],
        index: 1,
      };
  }
}
