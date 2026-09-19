// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
const request = vi.hoisted(() => vi.fn());
vi.mock('../../data/api', () => ({ publicApiRequest: request }));

import {
  getLobbyingLobbyist,
  getLobbyingLobbyists,
  getLobbyingPrincipal,
  getLobbyingPrincipals,
  getLobbyingSummary,
} from '../../data/lobbying';
import live from '../../data/__tests__/fixtures/lobbying-live.json';
import { lobbyingSummaryQueryKey } from '../../lib/lobbyingTypes';
import { renderPageData, resetSeededPayloadsForTests } from '../../lib/pageData';
import { useLobbyingLobbyist, useLobbyingLobbyists, useLobbyingSummary } from '../useLobbying';

let root: Root | undefined;
let client: QueryClient | undefined;
function mount(probe: () => ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
  function Probe() {
    return probe();
  }
  act(() =>
    root!.render(
      <QueryClientProvider client={client!}>
        <Probe />
      </QueryClientProvider>,
    ),
  );
  return () =>
    act(() =>
      root!.render(
        <QueryClientProvider client={client!}>
          <Probe />
        </QueryClientProvider>,
      ),
    );
}
async function settle() {
  for (let n = 0; n < 3; n += 1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
}
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  client?.clear();
  document.body.innerHTML = '';
  resetSeededPayloadsForTests();
  request.mockReset();
});

describe('the lobbying source reads', () => {
  it('preserves the real source fields, zero, null and separate payment copy date', async () => {
    request.mockResolvedValueOnce({ data: live.summary });
    expect(await getLobbyingSummary()).toEqual(live.summary);
    request.mockResolvedValueOnce({ data: live.principal });
    const principal = await getLobbyingPrincipal(2263);
    expect(principal).toEqual(live.principal);
    expect(principal.spending.rows[0].puc_lobbying_amount).toBe('0.0000');
    request.mockResolvedValueOnce({ data: live.absent });
    const absent = await getLobbyingLobbyist('999999999');
    expect(absent).toEqual(live.absent);
    expect(absent.name).toBeNull();
    expect(absent.contributions.copied_at).not.toBe(absent.copied_at);
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/lobbying/summary',
      '/lobbying/principals/2263',
      '/lobbying/lobbyists/999999999',
    ]);
  });

  it('requests numbered pages of 50 and preserves the typed filter', async () => {
    request.mockResolvedValueOnce({ data: live.lobbyists_page_2 });
    expect(await getLobbyingLobbyists({ page: 2 })).toEqual(live.lobbyists_page_2);
    expect(request.mock.calls[0][0]).toBe(
      '/lobbying/lobbyists?limit=50&offset=50&sort=donations_desc',
    );
    request.mockResolvedValueOnce({ data: live.principals_page_2 });
    await getLobbyingPrincipals({ page: 2, q: ' A & B ' });
    expect(request.mock.calls[1][0]).toBe('/lobbying/principals?limit=50&offset=50&q=A+%26+B');
  });

  it('requests year and dollar order and gives each combination its own cached result', async () => {
    let year = 2025;
    let sort: 'donations_desc' | 'donations_asc' = 'donations_desc';
    let current: unknown;
    request.mockResolvedValueOnce({ data: live.lobbyists_page_2 });
    const rerender = mount(() => {
      current = useLobbyingLobbyists({ year, sort, q: 'Ann', page: 2 }).data;
      return null;
    });
    await settle();
    // The order is always stated in the request, whatever the API's own default is.
    expect(request.mock.calls[0][0]).toBe(
      '/lobbying/lobbyists?limit=50&offset=50&q=Ann&year=2025&sort=donations_desc',
    );
    request.mockImplementation(() => new Promise(() => {}));
    year = 2024;
    rerender();
    await settle();
    expect(current).toBeUndefined();
    const signal = request.mock.calls[1][1] as AbortSignal;
    sort = 'donations_asc';
    rerender();
    await settle();
    expect(signal.aborted).toBe(true);
    expect(request.mock.calls[2][0]).toContain('year=2024&sort=donations_asc');
  });

  it('keeps a failed read as an error, never as an empty source', async () => {
    request.mockRejectedValue(new Error('read failed'));
    await expect(getLobbyingSummary()).rejects.toThrow('read failed');
    request.mockResolvedValue({ data: {} });
    await expect(getLobbyingSummary()).rejects.toThrow('incomplete');
  });

  it('uses the unchanged first-response seed without a second read', () => {
    document.body.innerHTML = renderPageData([
      { key: lobbyingSummaryQueryKey(), payload: { data: live.summary } },
    ]);
    let data: unknown;
    mount(() => {
      data = useLobbyingSummary().data;
      return null;
    });
    expect(data).toEqual(live.summary);
    expect(request).not.toHaveBeenCalled();
  });

  it('reads a lobbyist when the panel opens, preserving a leading-zero number', async () => {
    request.mockResolvedValue({ data: live.absent });
    let enabled = false;
    const rerender = mount(() => {
      useLobbyingLobbyist('0141', enabled);
      return null;
    });
    expect(request).not.toHaveBeenCalled();
    enabled = true;
    rerender();
    await settle();
    expect(request.mock.calls[0][0]).toBe('/lobbying/lobbyists/0141');
    expect(request.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
  });

  it('clears the former list when its page changes and cancels an abandoned read', async () => {
    let page = 1;
    let current: unknown;
    request.mockResolvedValueOnce({ data: live.lobbyists_page_2 });
    const rerender = mount(() => {
      current = useLobbyingLobbyists({ page }).data;
      return null;
    });
    await settle();
    expect(current).toEqual(live.lobbyists_page_2);
    request.mockImplementation(() => new Promise(() => {}));
    page = 2;
    rerender();
    await settle();
    expect(current).toBeUndefined();
    const signal = request.mock.calls[1][1] as AbortSignal;
    page = 3;
    rerender();
    await settle();
    expect(signal.aborted).toBe(true);
  });
});
