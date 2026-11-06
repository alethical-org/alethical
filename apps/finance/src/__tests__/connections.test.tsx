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
  edgePosition,
  loadedLine,
  moreLabel,
  paymentCopyLine,
  nodeHref,
  nodeSub,
  type ConnectionsPage,
  type GraphEdge,
  type GraphNode,
} from '../pages/connections/data';
import { columnOf, wrapLabel } from '../pages/connections/Map';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../auth/session', () => ({
  useFinanceSession: () => ({
    apiBaseUrl: 'https://api.example.test',
    accessToken: 'token',
  }),
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
    const missing = {
      ...payment,
      amount: null,
      amount_state: 'incomplete' as const,
    };
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
      edgeAmount({
        ...payment,
        relationship: 'station_payer',
        amount_state: 'not_applicable',
      }),
    ).toBe('');
  });
  it('dates a station-file line by its page and a representation by its list copy', () => {
    const station = {
      ...payment,
      relationship: 'station_payer',
      amount: null,
      amount_state: 'not_applicable' as const,
      period_basis: 'not_applicable' as const,
      source: {
        dataset: 'station_file',
        file_key: 'kstp/1',
        version_id: 'v2',
        page: 2,
      },
    };
    expect(edgePeriod(station)).toBe('Payer, as printed on page 2');
    expect(edgePeriod({ ...station, relationship: 'station_named' })).toBe('Named on page 2');
  });
});

describe('names and links', () => {
  it('keeps a printed name separate from a confirmed identity', () => {
    expect(nodeSub(payee)).toBe('Printed payee name');
    expect(nodeSub(org)).toBe('Confirmed organization');
    expect(nodeSub(committee)).toBe('Registration number 18135');
    expect(nodeSub({ ...committee, kind: 'lobbyist', record_id: '141' })).toBe(
      'Lobbyist registration number 141',
    );
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
        source: {
          dataset: 'station_file',
          file_key: 'f',
          version_id: 'v',
          page: 3,
          quote: 'Q',
        },
      },
      payee,
      committee,
    );
    expect(evidence.sourceHref).toBe('/media-buys/files/f?version=v&page=3');
    expect(evidence.quote).toBe('Q');
  });

  it('names a source copy by its date, never by an internal id', () => {
    const evidence = edgeEvidence(
      {
        ...payment,
        source: {
          dataset: 'contributions',
          snapshot_id: '44187155-f738-4b63-a455-9f026c0789f3',
          version_id: 'abc123',
          copied_at: '2026-10-28T15:00:00Z',
        },
      },
      payee,
      committee,
    );
    const shown = evidence.rows.map((row) => `${row.label}: ${row.value}`).join(' | ');
    expect(shown).toContain('Source version: Copy of Oct 28, 2026');
    expect(shown).not.toContain('44187155');
    expect(shown).not.toContain('abc123');
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
    // Large counts carry their commas, as production's 272,407 does.
    expect(loadedLine(100, 272407)).toBe('100 of 272,407 connections loaded');
    expect(loadedLine(80, 80)).toBe('');
  });
  it('counts confirmed records and printed names over the loaded set only', () => {
    const nodes = new Map([committee, payee, org].map((n) => [n.key, n]));
    expect(countLine([payment], nodes)).toBe(
      '1 connection · 1 confirmed people, organizations and committees · 1 printed name',
    );
  });
});

describe('copy dates (grounded-answers rule 12; settled wording row 74)', () => {
  const gift: GraphEdge = {
    ...payment,
    id: 'contributions:a',
    source: { dataset: 'contributions', copied_at: '2026-11-03T15:18:00Z' },
  };
  const spent: GraphEdge = {
    ...payment,
    source: { dataset: 'expenditures', copied_at: '2026-10-09T21:05:10Z' },
  };

  it('names each payment file with its own copy date, never 1 combined date', () => {
    expect(paymentCopyLine([spent, gift])).toBe(
      'Minnesota Campaign Finance and Public Disclosure Board contribution file, copied Nov 3, 2026; expenditure file, copied Oct 9, 2026. These are copy dates, not reporting periods.',
    );
  });

  it('says 1 file’s date is a copy date, and borrows no date for an undated file', () => {
    expect(paymentCopyLine([spent, { ...gift, source: { dataset: 'contributions' } }])).toBe(
      'Minnesota Campaign Finance and Public Disclosure Board expenditure file, copied Oct 9, 2026. This is a copy date, not a reporting period.',
    );
  });

  it('prints no copy line without a dated payment file', () => {
    expect(
      paymentCopyLine([
        {
          ...spent,
          source: {
            dataset: 'station_file',
            copied_at: '2026-10-09T21:05:10Z',
          },
        },
      ]),
    ).toBeNull();
    expect(
      paymentCopyLine([{ ...spent, source: { dataset: 'expenditures', copied_at: 'soon' } }]),
    ).toBeNull();
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
    version: 'aaaaaaaaaaaaaaaa',
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
  it('updates and clears search as you type while keeping filters', async () => {
    window.history.replaceState(
      null,
      '',
      '/money/connections?year=2026&rel=payments&focus=committee&edge=edge&pages=2&q=before',
    );
    serve(() => answer(page()));
    await act(async () => root.render(<MoneyConnections />));
    await flush();
    const input = container.querySelector<HTMLInputElement>('#conn-q')!;
    async function enter(value: string) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          input,
          value,
        );
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => vi.advanceTimersByTimeAsync(250));
    }
    vi.useFakeTimers();
    try {
      await enter('Example');
      const params = new URLSearchParams(window.location.search);
      expect(params.get('q')).toBe('Example');
      expect(params.get('year')).toBe('2026');
      expect(params.get('rel')).toBe('payments');
      expect(params.has('focus')).toBe(false);
      expect(params.has('edge')).toBe(false);
      expect(params.has('pages')).toBe(false);
      expect(requests.at(-1)?.searchParams.get('q')).toBe('Example');
      expect(requests.at(-1)?.searchParams.get('relationship')).toBe('payments');
      await enter('');
      expect(new URLSearchParams(window.location.search).has('q')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

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
    // Opened with no earlier page: the drawn fallback to Home, named by its heading.
    const back = container.querySelector<HTMLAnchorElement>('.f-back');
    expect(back?.textContent).toBe('Back to Research public records');
    expect(back?.getAttribute('href')).toBe('/home');
  });

  it('keeps an explicit Table choice in the address and prints the amount heading words', async () => {
    window.history.replaceState(null, '', '/money/connections?view=table');
    serve(() =>
      answer(
        page({
          edges: [{ ...payment, amount: null, amount_state: 'incomplete' }],
        }),
      ),
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

  it('starts at page one when returning to a filter after loading more', async () => {
    const first = Array.from({ length: 100 }, (_, i) => ({
      ...payment,
      id: `e${i}`,
    }));
    serve((url) =>
      url.searchParams.get('q') === 'other'
        ? answer(page({ q: 'other', edges: [{ ...payment, id: 'other' }] }))
        : url.searchParams.get('offset') === '100'
          ? answer(
              page({
                edges: [{ ...payment, id: 'last' }],
                total: 101,
                offset: 100,
              }),
            )
          : answer(page({ edges: first, total: 101, has_more: true })),
    );
    await act(async () => root.render(<MoneyConnections />));
    await flush();
    await act(async () => button('Show 1 more connection')!.click());
    await flush();
    await act(async () => {
      window.history.pushState(null, '', '/money/connections?q=other');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await flush();
    const before = requests.length;
    await act(async () => {
      window.history.pushState(null, '', '/money/connections');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await flush();
    expect(requests.slice(before).some((url) => url.searchParams.get('offset') === '100')).toBe(
      false,
    );
    expect(container.textContent).toContain('100 of 101 connections loaded');
  });

  it('shows held record metadata in map nodes as well as table subtitles', async () => {
    const named = {
      ...org,
      printed_names: [' Example Media LLC ', 'Example Media Inc'],
    };
    const account = { ...committee, register_kind: 'candidate_committee' };
    serve(() =>
      answer(
        page({
          nodes: [account, named],
          edges: [{ ...payment, to: named.key }],
        }),
      ),
    );
    await act(async () => root.render(<MoneyConnections />));
    await flush();
    const map = container.querySelector('.mc-map svg')!;
    const subtitles = [...map.querySelectorAll('.mc-node-sub')]
      .map((el) => el.textContent)
      .join(' ')
      .replace(/\s+/g, ' ');
    expect(subtitles).toContain('Candidate committee');
    expect(subtitles).toContain('printed as');
    expect(subtitles).toContain('Example Media Inc');
    expect(nodeSub(named)).toContain('“ Example Media LLC ”');
    expect(nodeSub({ ...committee, kind: 'file', saved_at: '2026-11-03T12:00:00Z' })).toContain(
      'Nov 3, 2026',
    );
  });

  it('loads the next 100 on Show more and keeps the loaded count', async () => {
    const first = Array.from({ length: 100 }, (_, i) => ({
      ...payment,
      id: `e${i}`,
    }));
    serve((url) =>
      url.searchParams.get('offset') === '100'
        ? answer(
            page({
              edges: [{ ...payment, id: 'last' }],
              total: 101,
              offset: 100,
            }),
          )
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

  it('restarts the whole graph after a changed source without combining versions', async () => {
    const first = Array.from({ length: 100 }, (_, i) => ({
      ...payment,
      id: `old${i}`,
    }));
    let changed = false;
    serve((url) => {
      if (url.searchParams.get('offset') === '100') {
        changed = true;
        return new Response(
          JSON.stringify({
            type: 'https://api.alethical.com/problems/records-changed',
          }),
          { status: 409 },
        );
      }
      return answer(
        changed
          ? page({
              version: 'bbbbbbbbbbbbbbbb',
              edges: [{ ...payment, id: 'fresh', amount: '987' }],
            })
          : page({ edges: first, total: 101, has_more: true }),
      );
    });
    await act(async () => root.render(<MoneyConnections />));
    await flush();
    await act(async () => button('Show 1 more connection')!.click());
    await flush();
    expect(requests.at(-1)!.searchParams.get('version')).toBe('aaaaaaaaaaaaaaaa');
    expect(container.textContent).toContain(
      'These records changed. Reload the list. Previous results are shown.',
    );
    expect(container.textContent).toContain('100 connections');
    await act(async () => button('Try again')!.click());
    await flush();
    expect(requests.at(-1)!.searchParams.get('offset')).toBe('0');
    expect(requests.at(-1)!.searchParams.has('version')).toBe(false);
    expect(container.textContent).toContain('1 connection ·');
    expect(container.textContent).not.toContain('100 connections');
    expect(container.textContent).not.toContain('These records changed');
  });

  it('reloads the pages a return names, so a line beyond the first page is selected again', async () => {
    window.history.replaceState(null, '', '/money/connections?edge=last&pages=2');
    const first = Array.from({ length: 100 }, (_, i) => ({
      ...payment,
      id: `e${i}`,
    }));
    serve((url) =>
      url.searchParams.get('offset') === '100'
        ? answer(
            page({
              edges: [{ ...payment, id: 'last' }],
              total: 101,
              offset: 100,
            }),
          )
        : answer(page({ edges: first, total: 101, has_more: true })),
    );
    await act(async () => root.render(<MoneyConnections />));
    await flush();
    await flush();
    expect(requests.map((url) => url.searchParams.get('offset'))).toEqual(['0', '100']);
    expect(container.textContent).toContain('101 of 101 connections loaded');
    expect(container.querySelector('[aria-pressed="true"], [data-selected="true"]')).not.toBeNull();
  });

  it('keeps loaded rows when the next page fails, with Try again', async () => {
    const first = Array.from({ length: 100 }, (_, i) => ({
      ...payment,
      id: `e${i}`,
    }));
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

  it('keeps loaded rows with the drawn busy notice when the server stays busy', async () => {
    const first = Array.from({ length: 100 }, (_, i) => ({
      ...payment,
      id: `e${i}`,
    }));
    serve((url) =>
      url.searchParams.get('offset') === '100'
        ? new Response(null, {
            status: 503,
            headers: { 'Retry-After': '0.01' },
          })
        : answer(page({ edges: first, total: 150, has_more: true })),
    );
    await act(async () => root.render(<MoneyConnections />));
    await flush();
    await act(async () => button('Show 50 more connections')!.click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    await flush();
    const notice = container.querySelector('.mc-notice-busy');
    expect(notice?.getAttribute('role')).toBe('status');
    expect(notice?.textContent).toContain(
      'The service is busy. The connections shown are the last loaded.',
    );
    expect(container.textContent).not.toContain('Some connections could not be loaded');
    expect(button('Show 50 more connections')).toBeUndefined();
    expect(container.textContent).toContain('100 connections');
    expect(button('Try again')).toBeDefined();
  });

  it('shows the loaded payment files’ copy dates under Sources and updates', async () => {
    serve(() => answer(page()));
    await act(async () => root.render(<MoneyConnections />));
    await flush();
    const sources = container.querySelector('[aria-labelledby="sources-heading"]');
    expect(sources?.textContent).toContain('expenditure file, copied');
    expect(sources?.textContent).toContain('This is a copy date, not a reporting period.');
  });

  it('names unavailable sources without counting them', async () => {
    serve(() =>
      answer(
        page({
          state: 'partial',
          unavailable_sources: ['independent_expenditures'],
        }),
      ),
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
    expect(panel.textContent).toContain('Registration number 18135');
    expect(panel.textContent).toContain('Payments · to');
    expect(panel.textContent).toContain('$420');
    expect(panel.textContent).toContain('Filing year 2025');
  });
});

it('preserves exact source spaces when wrapping quoted graph spellings', () => {
  const text = '“  Target  ”';
  const lines = wrapLabel(text, 24, (line) => line.length * 8, true);
  expect(lines.join('')).toBe(text);
  expect(lines.every((line) => line.length <= 3)).toBe(true);
});

it('keeps filed positions separate from the identity and names missing positions', () => {
  const outside = {
    ...payment,
    source: { dataset: 'independent_expenditures' },
    positions: ['Against', 'For'],
    position_missing_count: 2,
  };
  expect(edgePosition(outside)).toBe(
    'Position as filed: Against; For · Position not held for 2 records',
  );
  expect(edgePosition({ ...outside, positions: [], position_missing_count: 1 })).toBe(
    'Position not held for 1 record',
  );
  expect(edgePosition({ ...outside, source: { dataset: 'expenditures' } })).toBeNull();
});
