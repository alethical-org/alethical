// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
vi.mock('../../../data/api', () => ({ publicApiRequest: vi.fn() }));
vi.mock('../../../hooks/useLobbying', () => ({
  useLobbyingSummary: () => ({
    data: { state: 'reported', first_year: 2014 },
    isPending: false,
  }),
}));
vi.mock('../../../hooks/useHistoryScrollRestoration', () => ({
  useHistoryScrollRestoration: () => ({}),
}));
vi.mock('../../../hooks/useResponsive', () => ({
  useResponsive: () => ({ isMobile: false, isTablet: false }),
}));
vi.mock('../../../navigation/documentTitle', () => ({ useDocumentTitle: vi.fn() }));
vi.mock('../../../theme/primitives', async () => {
  const { View } = await import('react-native');
  return { PageBackground: View, Container: View, TopNav: () => null, Footer: () => null };
});
vi.mock('react-native-svg', () => ({ default: () => null, Path: () => null, Circle: () => null }));

import { publicApiRequest } from '../../../data/api';
import { LobbyingLandingScreen } from '../LobbyingLandingScreen';
import { LOBBYING_SEARCH_COPY as copy } from '../../../lib/lobbyingSearch';
import type { LobbyingLobbyistListRow, LobbyingPrincipalListRow } from '../../../lib/lobbyingTypes';

const request = vi.mocked(publicApiRequest);
const lobbyist: LobbyingLobbyistListRow = {
  registration_number: '00141',
  name: 'Kozak, Andrew',
  formatted_name: 'Andrew Kozak',
  principal_count: 13,
};
const principal: LobbyingPrincipalListRow = {
  entity_id: 7325,
  name: 'ACTwireless',
  registered_names: ['Association for Wireless Communications'],
  state: 'reported',
  linkable: true,
  latest_reported_year: 2017,
};
function response(kind: string, rows: unknown[] = [], extra: Record<string, unknown> = {}) {
  return {
    data: {
      state: 'reported',
      release_id: 'test-release',
      copied_at: null,
      sources: { expenditures: null, lobbyists: null },
      q: '',
      limit: 5,
      offset: 0,
      total: rows.length,
      has_more: false,
      latest_reported_year: 2025,
      matched_on: 'substring_of_the_filed_name',
      [kind]: rows,
      ...extra,
    },
  };
}
const kindOf = (path: string) => (path.includes('/lobbyists?') ? 'lobbyists' : 'principals');
let host: HTMLDivElement;
let root: Root;
let client: QueryClient;
const navigate = vi.fn();
const setParams = vi.fn();
let changeAddress: (q: string | undefined) => void;
const words = () => host.textContent ?? '';
const input = () => host.querySelector('input')!;
function button(label: string) {
  const found = [...host.querySelectorAll<HTMLElement>('[role="button"],button')].find(
    (node) => node.textContent === label,
  );
  expect(found, `button ${label}`).toBeDefined();
  return found!;
}
function click(label: string) {
  act(() => button(label).click());
}
function type(text: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), text);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function open(initialQuery?: string) {
  function Harness() {
    const [q, setQuery] = useState(initialQuery);
    changeAddress = setQuery;
    return (
      <LobbyingLandingScreen
        navigation={
          {
            navigate,
            setParams: (next: { q?: string }) => {
              setParams(next);
              setQuery(next.q);
            },
          } as never
        }
        route={{ key: 'lobbying', name: 'LobbyingLanding', params: { q } } as never}
      />
    );
  }
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    ),
  );
}
async function settle() {
  for (let pass = 0; pass < 4; pass += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}
function group(title: string) {
  return [...host.querySelectorAll('[role="heading"]')].find(
    (node) => node.textContent === title && node.getAttribute('aria-level') === '3',
  )?.parentElement?.parentElement;
}
beforeEach(() => {
  vi.clearAllMocks();
  request.mockImplementation(async (path) => response(kindOf(path)) as never);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
  host.remove();
});

describe('lobbying landing submits the name in place', () => {
  it('submits with Enter and refreshes both groups when the same name is submitted again', async () => {
    open();
    type('Kozak');
    act(() => {
      input().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }),
      );
    });
    await settle();
    expect(setParams).toHaveBeenCalledExactlyOnceWith({ q: 'Kozak' });
    expect(request).toHaveBeenCalledTimes(2);
    click('Search');
    await settle();
    expect(request).toHaveBeenCalledTimes(4);
    expect(setParams).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('waits for submit, trims the name, and requests 5 rows from each group with safe encoding', async () => {
    open();
    type('  A & B  ');
    await settle();
    expect(request).not.toHaveBeenCalled();
    expect(setParams).not.toHaveBeenCalled();
    click('Search');
    await settle();
    expect(setParams).toHaveBeenCalledExactlyOnceWith({ q: 'A & B' });
    expect(navigate).not.toHaveBeenCalled();
    expect(input().value).toBe('A & B');
    expect(request.mock.calls.map(([path]) => path).sort()).toEqual([
      '/lobbying/lobbyists?limit=5&offset=0&q=A+%26+B',
      '/lobbying/principals?limit=5&offset=0&q=A+%26+B',
    ]);
    expect(words()).toContain('Results for “A & B”');
  });

  it('keeps the last submitted results when a 2-character draft is rejected', async () => {
    request.mockImplementation(
      async (path) =>
        response(kindOf(path), kindOf(path) === 'lobbyists' ? [lobbyist] : []) as never,
    );
    open('Kozak');
    await settle();
    type('ab');
    click('Search');
    await settle();
    expect(words()).toContain(copy.tooShort);
    expect(words()).toContain('Results for “Kozak”');
    expect(words()).toContain(lobbyist.name);
    expect(input().value).toBe('ab');
    expect(setParams).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('clears the address and results, restores the starting view, and focuses the field', async () => {
    open('Kozak');
    await settle();
    click(copy.clear);
    await settle();
    expect(setParams).toHaveBeenCalledExactlyOnceWith({ q: undefined });
    expect(input().value).toBe('');
    expect(document.activeElement).toBe(input());
    expect(words()).not.toContain('Results for');
    expect(words()).not.toContain(copy.noMatchHint);
    expect(host.querySelector('a[href="/money/lobbying/lobbyists"]')).not.toBeNull();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('loads a saved search and follows later address changes without another submit', async () => {
    open('Kozak');
    await settle();
    act(() => changeAddress('Wireless'));
    await settle();
    expect(input().value).toBe('Wireless');
    expect(words()).toContain('Results for “Wireless”');
    expect(request.mock.calls.filter(([path]) => path.endsWith('q=Wireless'))).toHaveLength(2);
    expect(setParams).not.toHaveBeenCalled();
  });
});

describe('lobbying results distinguish absent records from failed searches', () => {
  it('shows exact zero counts and the shorter-name hint only after both groups succeed', async () => {
    open('Nobody');
    await settle();
    expect(group('Lobbyists')?.textContent).toContain('0 MATCHES');
    expect(group('Principals')?.textContent).toContain('0 MATCHES');
    expect(words()).toContain(copy.lobbyists.empty);
    expect(words()).toContain(copy.principals.empty);
    expect(words()).toContain(copy.noMatchHint);
  });

  it('retries only the failed group and preserves the other group', async () => {
    let fail = true;
    request.mockImplementation(async (path) => {
      if (kindOf(path) === 'principals' && fail) throw new Error('offline');
      return response(
        kindOf(path),
        kindOf(path) === 'lobbyists' ? [lobbyist] : [principal],
      ) as never;
    });
    open('Kozak');
    await settle();
    expect(group('Lobbyists')?.textContent).toContain(lobbyist.name);
    expect(group('Principals')?.textContent).toContain(copy.principals.unavailable);
    expect(group('Principals')?.textContent).not.toContain('0 MATCHES');
    expect(words()).not.toContain(copy.noMatchHint);
    fail = false;
    click('Try again');
    await settle();
    expect(group('Principals')?.textContent).toContain(principal.name);
    expect(words()).not.toContain(copy.principals.unavailable);
    expect(request.mock.calls.filter(([path]) => kindOf(path) === 'lobbyists')).toHaveLength(1);
    expect(request.mock.calls.filter(([path]) => kindOf(path) === 'principals')).toHaveLength(2);
  });

  it('shows a combined failure and retries both groups when neither request succeeds', async () => {
    request.mockRejectedValue(new Error('offline'));
    open('Kozak');
    await settle();
    expect(words()).toContain(copy.unavailable);
    expect(words()).not.toContain('0 MATCHES');
    expect(words()).not.toContain(copy.noMatchHint);
    request.mockImplementation(async (path) => response(kindOf(path)) as never);
    click('Try again');
    await settle();
    expect(request).toHaveBeenCalledTimes(4);
    expect(words()).toContain(copy.noMatchHint);
  });

  it('shows one retry when both responses report unavailable records', async () => {
    request.mockImplementation(
      async (path) => response(kindOf(path), [], { state: 'unavailable', total: null }) as never,
    );
    open('Kozak');
    await settle();
    expect(words()).toContain(copy.unavailable);
    expect(words()).not.toContain('0 MATCHES');
    expect(words()).not.toContain(copy.noMatchHint);
    request.mockImplementation(async (path) => response(kindOf(path)) as never);
    click('Try again');
    await settle();
    expect(request).toHaveBeenCalledTimes(4);
    expect(words()).toContain(copy.noMatchHint);
  });

  it('does not show stale rows or zero counts in a group marked unavailable', async () => {
    request.mockImplementation(
      async (path) =>
        response(
          kindOf(path),
          kindOf(path) === 'principals' ? [principal] : [],
          kindOf(path) === 'principals' ? { state: 'unavailable', total: null } : {},
        ) as never,
    );
    open('Wireless');
    await settle();
    expect(group('Principals')?.textContent).toContain(copy.principals.unavailable);
    expect(group('Principals')?.textContent).not.toContain(principal.name);
    expect(group('Principals')?.textContent).not.toContain('0 MATCHES');
    expect(words()).not.toContain(copy.noMatchHint);
  });

  it('keeps successful same-name rows after a refresh fails and clears the error on retry', async () => {
    let fail = false;
    request.mockImplementation(async (path) => {
      if (kindOf(path) === 'principals' && fail) throw new Error('offline');
      return response(
        kindOf(path),
        kindOf(path) === 'principals' ? [principal] : [lobbyist],
      ) as never;
    });
    open('Wireless');
    await settle();
    expect(group('Principals')?.textContent).toContain(principal.name);
    fail = true;
    click('Search');
    await settle();
    expect(group('Principals')?.textContent).toContain(principal.name);
    expect(group('Principals')?.textContent).toContain(copy.principals.unavailable);
    expect(group('Lobbyists')?.textContent).toContain(lobbyist.name);
    expect(words()).not.toContain(copy.noMatchHint);
    fail = false;
    click('Try again');
    await settle();
    expect(group('Principals')?.textContent).toContain(principal.name);
    expect(words()).not.toContain(copy.principals.unavailable);
    expect(request.mock.calls.filter(([path]) => kindOf(path) === 'principals')).toHaveLength(3);
    expect(request.mock.calls.filter(([path]) => kindOf(path) === 'lobbyists')).toHaveLength(2);
  });
});

it('uses filed IDs for links, shows registered spellings, and keeps principals without spending unlinked', async () => {
  const listOnly = {
    ...principal,
    entity_id: 9999,
    name: 'Current Register Only',
    registered_names: [],
    linkable: false,
    state: 'no_spending_rows',
    latest_reported_year: null,
  };
  request.mockImplementation(
    async (path) =>
      response(kindOf(path), kindOf(path) === 'lobbyists' ? [lobbyist] : [principal, listOnly], {
        total: 6,
        has_more: true,
      }) as never,
  );
  open('Wireless & Co');
  await settle();
  expect(
    host.querySelector('a[href="/money/lobbying/lobbyists/kozak-andrew-00141"]'),
  ).not.toBeNull();
  expect(
    host.querySelector('a[href="/money/lobbying/principals/actwireless-7325"]'),
  ).not.toBeNull();
  expect(words()).toContain('Registration 00141 · 13 clients listed');
  expect(words()).toContain(
    'Registered as Association for Wireless Communications in the lobbyist list',
  );
  const plain = [...host.querySelectorAll('[role="listitem"]')].find((node) =>
    node.textContent?.includes(listOnly.name),
  );
  expect(plain?.querySelector('a,[role="link"]')).toBeNull();
  expect(plain?.textContent).toContain(
    'No spending rows in the Board’s file through 2025, so no page to open',
  );
  for (const kind of ['lobbyists', 'principals']) {
    const link = host.querySelector<HTMLAnchorElement>(`a[href^="/money/lobbying/${kind}?"]`)!;
    expect(new URL(link.href).searchParams.get('q')).toBe('Wireless & Co');
    expect(link.textContent).toBe(`View all matching ${kind}`);
  }
  const wider = host.querySelector<HTMLAnchorElement>('a[href^="/money/search?"]')!;
  expect(new URL(wider.href).searchParams.get('q')).toBe('Wireless & Co');
});

describe('request cancellation keeps the latest submitted name authoritative', () => {
  it('ignores a late reply from the previous name after new results arrive', async () => {
    const old: Array<{ resolve: (value: unknown) => void; signal: AbortSignal; kind: string }> = [];
    request.mockImplementation((path, signal) => {
      const kind = kindOf(path);
      if (path.endsWith('q=Old'))
        return new Promise((resolve) => old.push({ resolve, signal: signal!, kind })) as never;
      return Promise.resolve(
        response(kind, kind === 'lobbyists' ? [{ ...lobbyist, name: 'New Name' }] : []),
      ) as never;
    });
    open('Old');
    type('New');
    click('Search');
    await settle();
    expect(old).toHaveLength(2);
    expect(old.every(({ signal }) => signal.aborted)).toBe(true);
    await act(async () =>
      old.forEach(({ resolve, kind }) =>
        resolve(response(kind, kind === 'lobbyists' ? [{ ...lobbyist, name: 'Old Name' }] : [])),
      ),
    );
    await settle();
    expect(words()).toContain('Results for “New”');
    expect(words()).toContain('New Name');
    expect(words()).not.toContain('Old Name');
  });

  it('aborts both outstanding requests when the reader clears the search', async () => {
    const signals: AbortSignal[] = [];
    request.mockImplementation((_path, signal) => {
      signals.push(signal!);
      return new Promise(() => {});
    });
    open('Pending');
    expect(signals).toHaveLength(2);
    click(copy.clear);
    await settle();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(words()).not.toContain(copy.loading);
    expect(words()).not.toContain('Results for');
  });
});
