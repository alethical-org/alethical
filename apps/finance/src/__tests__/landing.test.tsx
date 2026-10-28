import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionProvider } from '../auth/session';
import { screensApproved } from '../config';
import { CONNECTIONS, linePaths, type Measured } from '../landing/connections';
import { copyDate, fetchCounts, figuresFrom, type ServedCounts } from '../landing/counts';
import { DEMO_MAIL } from '../landing/Landing';
import { PublicSite } from '../landing/PublicSite';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const API = 'https://api.example.test';

const SERVED: ServedCounts = {
  campaign_money_records: {
    state: 'reported',
    count: 1084277,
    first_year: 2015,
    last_year: 2026,
    copied_at: '2026-09-01T11:30:00+00:00',
  },
  lobbying_spending_reports: {
    state: 'reported',
    count: 17842,
    first_year: 2014,
    last_year: 2025,
    copied_at: '2026-08-28T15:00:00+00:00',
    organizations: 3184,
  },
  current_legislature_bills: {
    state: 'reported',
    count: 10518,
    first_year: 2025,
    last_year: 2026,
    copied_at: '2026-07-14T18:48:17+00:00',
  },
  tv_station_files: {
    state: 'unavailable',
    count: null,
    first_year: null,
    last_year: null,
    copied_at: null,
  },
};

function fakeSupabase() {
  return {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null } })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe() {} } } })),
      signOut: vi.fn(async () => ({ error: null })),
    },
  } as unknown as SupabaseClient;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderAt(path: string, counts: unknown = { data: SERVED }, status = 200) {
  window.history.replaceState(null, '', path);
  const fetcher = vi.fn(async () => new Response(JSON.stringify(counts), { status }));
  vi.stubGlobal('fetch', fetcher);
  await act(async () => {
    root.render(
      <SessionProvider supabase={fakeSupabase()} apiBaseUrl={API}>
        <PublicSite />
      </SessionProvider>,
    );
  });
  await act(async () => {});
  return fetcher;
}

describe('the public Finance site', () => {
  it('prints the landing drawing’s words', async () => {
    await renderAt('/');
    const text = container.textContent ?? '';
    for (const words of [
      'Turn policy priorities into a focused giving strategy',
      'Political intelligence for law firms and PACs',
      'Connect money, people and policy',
      'Printed names not yet confirmed, kept apart',
      'Roll-call votes, by legislator',
      'The connections we make',
      'One record for each person and organization across elections, offices and roles',
      'BUILT ON MINNESOTA PUBLIC RECORDS',
      'WHAT IT DOES',
      'Decide where to give, with evidence',
      'Sources and updates',
    ]) {
      expect(text).toContain(words);
    }
    expect(document.title).toBe('Alethical Finance');
  });

  it('opens a demo request draft and links Sign in to the sign-in page', async () => {
    await renderAt('/');
    const demos = [...container.querySelectorAll('a')].filter(
      (a) => a.textContent === 'Request a demo',
    );
    expect(demos).toHaveLength(2);
    for (const demo of demos) expect(demo.getAttribute('href')).toBe(DEMO_MAIL);
    const mail = new URL(DEMO_MAIL);
    expect(mail.pathname).toBe('angel@alethical.com');
    expect(mail.searchParams.get('cc')).toBe('ask@alethical.com');
    expect(mail.searchParams.get('subject')).toBe('Alethical Finance demo');
    const signIns = [...container.querySelectorAll('a')].filter((a) => a.textContent === 'Sign in');
    expect(signIns.length).toBeGreaterThan(0);
    for (const link of signIns) expect(link.getAttribute('href')).toBe('/sign-in');
  });

  it('reads the counts live and hides one the server could not read', async () => {
    const fetcher = await renderAt('/');
    expect(fetcher).toHaveBeenCalledWith(`${API}/api/v1/finance/landing/counts`);
    const text = container.textContent ?? '';
    expect(text).toContain('1,084,277');
    expect(text).toContain('From 3,184 organizations, 2014 to 2025');
    expect(text).toContain('2025–2026 Legislature');
    expect(text).not.toContain('TV station files on political ad time');
    expect(text).toContain('Payment files copied Sep 1, 2026');
    expect(text).toContain('Bills updated Jul 14, 2026');
    // The station source stays named; only its unsupported date is left out.
    expect(text).toContain('Media buys · Station files');
    expect(text).not.toMatch(/Station files copied/);
  });

  it('shows no count tiles, and no 0, when the counts cannot be read', async () => {
    await renderAt('/', { detail: 'down' }, 503);
    const text = container.textContent ?? '';
    expect(text).not.toContain('BUILT ON MINNESOTA PUBLIC RECORDS');
    expect(text).toContain('Sources and updates');
    expect(container.querySelector('.lp-figure-value')).toBeNull();
  });

  it.each(['/money', '/media-buys/review', '/search', '/nope'])(
    'shows not-found at %s until the screens are approved',
    async (path) => {
      await renderAt(path);
      expect(container.textContent).toContain('We couldn’t find that page');
      expect(container.querySelector('.lp')).toBeNull();
    },
  );

  it('keeps the screens off unless the setting is exactly on', () => {
    expect(screensApproved({})).toBe(false);
    expect(screensApproved({ VITE_FINANCE_SCREENS: 'off' })).toBe(false);
    expect(screensApproved({ VITE_FINANCE_SCREENS: 'yes' })).toBe(false);
    expect(screensApproved({ VITE_FINANCE_SCREENS: ' on ' })).toBe(true);
  });
});

describe('landing counts', () => {
  it('never draws a 0, a negative or a missing count', () => {
    const figures = figuresFrom({
      campaign_money_records: { ...SERVED.campaign_money_records!, count: 0 },
      lobbying_spending_reports: { ...SERVED.lobbying_spending_reports!, count: -1 },
      current_legislature_bills: { ...SERVED.current_legislature_bills!, count: null },
      tv_station_files: {
        state: 'reported',
        count: 5070,
        first_year: 2022,
        last_year: 2026,
        copied_at: null,
      },
    });
    expect(figures.map((f) => [f.label, f.value, f.span])).toEqual([
      ['TV station files on political ad time', '5,070', '2022 to 2026'],
    ]);
  });

  it('drops a lobbying organizations clause it cannot support, and a missing year', () => {
    const [figure] = figuresFrom({
      lobbying_spending_reports: {
        ...SERVED.lobbying_spending_reports!,
        organizations: 0,
        first_year: null,
      },
    });
    expect(figure.span).toBe('2025');
  });

  it('dates in Minnesota time', () => {
    // 2:00 UTC on 2 Sep is still 1 Sep in Minnesota.
    const counts: ServedCounts = {
      campaign_money_records: {
        ...SERVED.campaign_money_records!,
        copied_at: '2026-09-02T02:00:00+00:00',
      },
    };
    expect(copyDate(counts, 'campaign_money_records')).toBe('Sep 1, 2026');
    expect(copyDate(counts, 'tv_station_files')).toBeNull();
  });

  it('answers no counts when the request fails or the answer is malformed', async () => {
    const failing = vi.fn(async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    expect(await fetchCounts(API, failing)).toEqual({});
    const malformed = vi.fn(async () => new Response('not json')) as unknown as typeof fetch;
    expect(await fetchCounts(API, malformed)).toEqual({});
  });
});

describe('the connections diagram', () => {
  it('draws the drawing’s 24 lines, only between neighbouring panes', () => {
    expect(CONNECTIONS).toHaveLength(24);
    for (const [from, to] of CONNECTIONS) {
      expect(`${from[0]}${to[0]}`).toMatch(/^(mp|pq)$/);
    }
  });

  const box = (left: number, top: number, width = 10, height = 10) => ({
    left,
    right: left + width,
    top,
    height,
  });

  it('runs each line from its record to the gutter and on to the target dot', () => {
    const measured: Measured = {
      frame: box(0, 0, 1000, 600),
      text: () => box(20, 0, 200, 20),
      dot: (id) =>
        id[0] === 'm' ? box(0, 0, 7, 7) : id[0] === 'p' ? box(400, 100, 7, 7) : box(800, 200, 7, 7),
      pane: (id) => (id === 'm' ? box(0, 0, 300, 500) : box(400, 0, 300, 500)),
    };
    const paths = linePaths(measured);
    expect(paths).toHaveLength(24);
    expect(paths[0]).toBe('M228 3.5 H306 C350.5 3.5 350.5 103.5 395 103.5');
  });

  it('draws no line when the panes are stacked', () => {
    const stacked: Measured = {
      frame: box(0, 0, 360, 2000),
      text: () => box(20, 0, 200, 20),
      dot: (id) => box(0, id[0] === 'm' ? 0 : 900, 7, 7),
      pane: () => box(0, 0, 360, 600),
    };
    expect(linePaths(stacked)).toEqual([]);
  });
});
