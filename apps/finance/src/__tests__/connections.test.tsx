import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearReadCache } from '../api/read';
import { MoneyConnections } from '../pages/MoneyConnections';
import {
  combinePages,
  committeeEdgeHref,
  countLine,
  edgeAmount,
  edgeEvidence,
  edgePeriod,
  loadedLine,
  moreLabel,
  nodeHref,
  nodeSub,
  type ConnectionsPage,
  type GraphEdge,
  type GraphNode,
} from '../pages/connections/data';
import { columnOf, wrapLabel } from '../pages/connections/Map';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../auth/session', () => ({
  useFinanceSession: () => ({ apiBaseUrl: 'https://api.example.test', accessToken: 'token' }),
}));
// Every screen the page links to counts as built here, so link targets are tested.
vi.mock('../routes', async (original) => {
  const real = await original<typeof import('../routes')>();
  return { ...real, isBuilt: () => true };
});

const payee: GraphNode = {
  key: 'printed_name:vendor:Example Printing',
  kind: 'printed_name',
  label: 'Example Printing',
  record_id: 'Example Printing',
  role: 'vendor',
  unresolved: true,
  target: { kind: 'printed_name', id: 'Example Printing', role: 'vendor' },
};
const committee: GraphNode = {
  key: 'committee:18135',
  kind: 'committee',
  label: 'Example Committee',
  record_id: '18135',
  role: 'committee',
  unresolved: false,
  target: { kind: 'committee', id: '18135' },
};
const org: GraphNode = {
  key: 'identity:7',
  kind: 'organization',
  label: 'Example Media LLC',
  record_id: '7',
  unresolved: false,
  target: { kind: 'identity', id: '7' },
};
const payment: GraphEdge = {
  id: 'payments:a',
  from: committee.key,
  to: payee.key,
  relationship: 'payments',
  amount: '420',
  amount_state: 'reported',
  period_basis: 'years',
  first_year: 2025,
  last_year: 2025,
  first_date: null,
  last_date: null,
  undated_count: 1,
  record_count: 2,
  source: {
    dataset: 'expenditures',
    url: 'https://cfb.mn.gov/example.csv',
    copied_at: '2026-10-09',
  },
};

describe('the shared total rule on edges (Rounds 34, 36, 41, 43)', () => {
  it('prints a held sum with its filing-year basis', () => {
    expect(edgeAmount(payment)).toBe('$420');
    expect(edgePeriod(payment)).toBe('Filing year 2025');
    expect(edgePeriod({ ...payment, last_year: 2026 })).toBe('Filing years 2025–2026');
  });
  it('withholds a total with a missing amount, worded by position', () => {
    const missing = { ...payment, amount: null, amount_state: 'incomplete' as const };
    expect(edgeAmount(missing, { heading: true })).toBe('Incomplete');
    expect(edgeAmount(missing)).toBe('Missing payment amount');
  });
  it('withholds a total when neither dates nor filing years are complete', () => {
    const unknown = {
      ...payment,
      amount: null,
      amount_state: 'incomplete_period' as const,
      period_basis: 'unknown' as const,
    };
    expect(edgeAmount(unknown)).toBe('Reporting period incomplete');
    expect(edgePeriod(unknown)).toBe('Reporting period incomplete');
  });
  it('keeps a refund signed, a verified zero as $0, and no amount on a station-file line', () => {
    expect(edgeAmount({ ...payment, amount: '-150' })).toMatch(/^[-−]\$150$/);
    expect(edgeAmount({ ...payment, amount: '0' })).toBe('$0');
    expect(
      edgeAmount({ ...payment, relationship: 'station_payer', amount_state: 'not_applicable' }),
    ).toBe('');
  });
  it('dates a station-file line by its page and a representation by its list copy', () => {
    const station = {
      ...payment,
      relationship: 'station_payer',
      amount: null,
      amount_state: 'not_applicable' as const,
      period_basis: 'not_applicable' as const,
      source: { dataset: 'station_file', file_key: 'kstp/1', version_id: 'v2', page: 2 },
    };
    expect(edgePeriod(station)).toBe('Payer, as printed on page 2');
    expect(edgePeriod({ ...station, relationship: 'station_named' })).toBe('Named on page 2');
  });
});

describe('names and links', () => {
  it('keeps a printed name separate from a confirmed identity', () => {
    expect(nodeSub(payee)).toBe('Printed payee name');
    expect(nodeSub(org)).toBe('Confirmed organization');
    expect(nodeSub(committee)).toBe('Registration 18135');
    expect(nodeHref(payee)).toContain('/money/names/');
    expect(nodeHref(payee)).toContain('role=payee');
    expect(nodeHref(org)).toBe('/organizations/7');
    // A node with no explicit target from the server opens nothing.
    expect(nodeHref({ ...org, target: null })).toBeNull();
  });
  it('opens a paying committee on its Expenditures tab, year and payee name', () => {
    const href = committeeEdgeHref(payment, committee, payee)!;
    expect(href).toContain('/money/committees/18135');
    expect(href).toContain('tab=expenditures');
    expect(href).toContain('year=2025');
    expect(href).toContain('q=Example+Printing');
    const outside = { ...payee, role: 'independent_vendor' };
    expect(committeeEdgeHref(payment, committee, outside)).toContain('tab=independent');
  });
  it('keeps the exact station-file version and page in evidence', () => {
    const evidence = edgeEvidence(
      {
        ...payment,
        source: { dataset: 'station_file', file_key: 'f', version_id: 'v', page: 3, quote: 'Q' },
      },
      payee,
      committee,
    );
    expect(evidence.sourceHref).toBe('/media-buys/files/f?version=v&page=3');
    expect(evidence.quote).toBe('Q');
  });
});

describe('the loaded set (Rounds 37 item 7 and 41 item 6)', () => {
  const page = (offset: number, ids: string[], total: number): ConnectionsPage => ({
    state: 'reported',
    nodes: [committee, payee],
    edges: ids.map((id) => ({ ...payment, id })),
    total,
    has_more: offset + ids.length < total,
    limit: 100,
    offset,
    q: '',
    year: null,
    relationship: 'all',
    focus: null,
    years: [2025],
    relationships: [],
    unavailable_sources: [],
  });
  it('adds pages without repeating a relationship and counts what is left', () => {
    const one = Array.from({ length: 100 }, (_, i) => `e${i}`);
    const set = combinePages([page(0, one, 230), page(100, ['e99', 'x'], 230)]);
    expect(set.edges).toHaveLength(101);
    expect(set.total).toBe(230);
  });
  it('offers min(100, remaining) more and states the loaded count only past 1 page', () => {
    expect(moreLabel(130)).toBe('Show 100 more connections');
    expect(moreLabel(30)).toBe('Show 30 more connections');
    expect(moreLabel(1)).toBe('Show 1 more connection');
    expect(loadedLine(100, 230)).toBe('100 of 230 connections loaded');
    expect(loadedLine(80, 80)).toBe('');
  });
  it('counts confirmed records and printed names over the loaded set only', () => {
    const nodes = new Map([committee, payee, org].map((n) => [n.key, n]));
    expect(countLine([payment], nodes)).toBe(
      '1 connection · 1 confirmed people, organizations and committees · 1 printed name',
    );
  });
});

describe('the map', () => {
  it('wraps long words without losing letters or exceeding the measured width', () => {
    const text = 'A verylongunbrokenorganizationnamewithallitsletters remains readable';
    const lines = wrapLabel(text, 45, (s) => s.length * 5);
    expect(lines.every((line) => line.length <= 9)).toBe(true);
    expect(lines.join('').replaceAll(' ', '')).toBe(text.replaceAll(' ', ''));
  });
  it('puts committees in the middle, givers left and recipients right', () => {
    expect(columnOf(committee, [payment])).toBe(1);
    expect(columnOf(payee, [payment])).toBe(2);
    expect(columnOf(org, [{ ...payment, from: org.key }])).toBe(0);
  });
});

let container: HTMLDivElement, root: Root;
let requests: URL[];
beforeEach(() => {
  clearReadCache();
  requests = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  window.history.replaceState(null, '', '/money/connections');
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function flush() {
  for (let i = 0; i < 6; i++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
}
function answer(data: unknown, status = 200) {
  return new Response(status === 200 ? JSON.stringify({ data }) : '{}', {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function page(overrides: Partial<ConnectionsPage> = {}): ConnectionsPage {
  return {
    state: 'reported',
    nodes: [committee, payee],
    edges: [payment],
    total: 1,
    has_more: false,
    limit: 100,
    offset: 0,
    q: '',
    year: null,
    relationship: 'all',
    focus: null,
    years: [2026, 2025],
    relationships: [],
    unavailable_sources: [],
    ...overrides,
  };
}
function serve(respond: (url: URL) => Response | Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input);
      requests.push(url);
      return respond(url);
    }),
  );
}
const button = (text: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(text));

describe('Money connections page', () => {
  it('opens on Map with the drawn footer and the grounding note, reading 100 per page', async () => {
    serve(() => answer(page()));
    await act(async () => root.render(<MoneyConnections />));
    await flush();
    expect(requests[0].searchParams.get('limit')).toBe('100');
    expect(requests[0].searchParams.get('offset')).toBe('0');
    expect(container.querySelector('svg[aria-label^="Map of the connections"]')).not.toBeNull();
    expect(container.textContent).toContain(
      '1 connection · 1 confirmed people, organizations and committees · 1 printed name',
    );
    expect(container.textContent).toContain('Select a name or a line to see its connections.');
    expect(container.textContent).toContain(
      'A connection does not show that one payment funded another.',
    );
    expect(button('Show ')).toBeUndefined();
  });

  it('keeps an explicit Table choice in the address and prints the amount heading words', async () => {
    window.history.replaceState(null, '', '/money/connections?view=table');
    serve(() =>
      answer(page({ edges: [{ ...payment, amount: null, amount_state: 'incomplete' }] })),
    );
    await act(async () => root.render(<MoneyConnections />));
    await flush();
    const table = container.querySelector('table')!;
    expect(table.textContent).toContain('Incomplete');
    expect(table.textContent).not.toContain('Missing payment amount');
    const link = [...table.querySelectorAll('a')].find(
      (a) => a.textContent === 'Example Committee',
    )!;
    expect(link.getAttribute('href')).toContain('tab=expenditures');
    expect(decodeURIComponent(link.getAttribute('href')!)).toContain('edge=payments%3Aa');
  });

  it('loads the next 100 on Show more and keeps the loaded count', async () => {
    const first = Array.from({ length: 100 }, (_, i) => ({ ...payment, id: `e${i}` }));
    serve((url) =>
      url.searchParams.get('offset') === '100'
        ? answer(page({ edges: [{ ...payment, id: 'last' }], total: 101, offset: 100 }))
        : answer(page({ edges: first, total: 101, has_more: true })),
    );
    await act(async () => root.render(<MoneyConnections />));
    await flush();
    expect(container.textContent).toContain('100 of 101 connections loaded');
    await act(async () => button('Show 1 more connection')!.click());
    await flush();
    expect(requests.at(-1)!.searchParams.get('offset')).toBe('100');
    expect(container.textContent).toContain('101 of 101 connections loaded');
    expect(container.textContent).toContain('101 connections');
    expect(button('more connection')).toBeUndefined();
  });

  it('keeps loaded rows when the next page fails, with Try again', async () => {
    const first = Array.from({ length: 100 }, (_, i) => ({ ...payment, id: `e${i}` }));
    serve((url) =>
      url.searchParams.get('offset') === '100'
        ? answer(null, 500)
        : answer(page({ edges: first, total: 150, has_more: true })),
    );
    await act(async () => root.render(<MoneyConnections />));
    await flush();
    await act(async () => button('Show 50 more connections')!.click());
    await flush();
    expect(container.textContent).toContain('Some connections could not be loaded');
    expect(container.textContent).toContain('100 connections');
    expect(button('Try again')).toBeDefined();
  });

  it('names unavailable sources without counting them', async () => {
    serve(() =>
      answer(page({ state: 'partial', unavailable_sources: ['independent_expenditures'] })),
    );
    await act(async () => root.render(<MoneyConnections />));
    await flush();
    expect(container.textContent).toContain(
      'Some sources are unavailable · Independent expenditure file',
    );
    expect(container.textContent).toContain('1 connection ·');
  });

  it('shows a first failure with Try again, never as no connections', async () => {
    serve(() => answer(null, 500));
    await act(async () => root.render(<MoneyConnections />));
    await flush();
    expect(container.querySelector('[role="alert"]')!.textContent).toContain(
      'We couldn’t load these connections',
    );
    expect(container.textContent).not.toContain('No connections held');
  });

  it('treats an all-sources-unavailable answer as a failure', async () => {
    serve(() => answer(page({ state: 'unavailable', edges: [], nodes: [], total: 0 })));
    await act(async () => root.render(<MoneyConnections />));
    await flush();
    expect(container.textContent).toContain('We couldn’t load these connections');
  });

  it('says an unknown focus is not held, and an empty selection is empty', async () => {
    window.history.replaceState(null, '', '/money/connections?focus=identity%3A999');
    serve(() => answer(page({ edges: [], nodes: [], total: 0, state: 'not_reported' })));
    await act(async () => root.render(<MoneyConnections />));
    await flush();
    expect(container.textContent).toContain('This record is not held in the connections');
    act(() => root.unmount());
    clearReadCache();
    root = createRoot(container);
    window.history.replaceState(null, '', '/money/connections?year=2026');
    await act(async () => root.render(<MoneyConnections />));
    await flush();
    expect(container.textContent).toContain('No connections held for this selection');
  });

  it('keeps the earlier results visible while a new selection loads and when it fails', async () => {
    let fail = false;
    serve(() => (fail ? answer(null, 500) : answer(page())));
    await act(async () => root.render(<MoneyConnections />));
    await flush();
    fail = true;
    const node = container.querySelector<SVGGElement>('g.mc-node')!;
    await act(async () => node.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();
    expect(new URL(window.location.href).searchParams.get('focus')).toBeTruthy();
    expect(container.textContent).toContain('We couldn’t update these results');
    expect(container.textContent).toContain('Example Printing');
  });

  it('selects a name from the map and lists its own connections', async () => {
    serve(() => answer(page()));
    await act(async () => root.render(<MoneyConnections />));
    await flush();
    const committeeNode = [...container.querySelectorAll<SVGGElement>('g.mc-node')].find((g) =>
      g.getAttribute('aria-label')?.startsWith('Example Committee'),
    )!;
    await act(async () =>
      committeeNode.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
    );
    await flush();
    const panel = container.querySelector('aside')!;
    expect(panel.textContent).toContain('Registration 18135');
    expect(panel.textContent).toContain('Payments · to');
    expect(panel.textContent).toContain('$420');
    expect(panel.textContent).toContain('Filing year 2025');
  });
});
