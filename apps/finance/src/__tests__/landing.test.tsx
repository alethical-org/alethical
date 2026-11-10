import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionProvider } from '../auth/session';
import { screensApproved } from '../config';
import { copyDate, fetchCounts, figuresFrom, type ServedCounts } from '../landing/counts';
import { FinanceSite, PublicSite } from '../landing/PublicSite';

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

function fakeSupabase(session: { access_token: string; user: { email: string } } | null = null) {
  return {
    auth: {
      getSession: vi.fn(async () => ({ data: { session } })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe() {} } },
      })),
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

async function renderAt(
  path: string,
  counts: unknown = { data: SERVED },
  status = 200,
  {
    session = null as Parameters<typeof fakeSupabase>[0],
    screens = false,
    accessStatus = 200,
  } = {},
) {
  window.history.replaceState(null, '', path);
  const fetcher = vi.fn(async (url: string) =>
    url.endsWith('/landing/counts')
      ? new Response(JSON.stringify(counts), { status })
      : new Response(null, { status: accessStatus }),
  );
  vi.stubGlobal('fetch', fetcher);
  await act(async () => {
    root.render(
      <SessionProvider supabase={fakeSupabase(session)} apiBaseUrl={API} screens={screens}>
        {screens ? <FinanceSite screens /> : <PublicSite />}
      </SessionProvider>,
    );
  });
  await act(async () => {});
  return fetcher;
}

describe('the public Finance site', () => {
  it('prints the hero, every heading and a line from each section', async () => {
    await renderAt('/');
    const text = container.textContent ?? '';
    for (const words of [
      'Connect political money, people and policy',
      'Political intelligence for law firms, PACs and research teams',
      'Start with a name, follow the connections',
      'See who gives, who spends and who gets paid',
      'Compare political money with election results',
      'Put your research to work',
      'Build on your research',
      'Go straight to the evidence',
      'Keep client work moving',
      'BUILT ON MINNESOTA PUBLIC RECORDS',
      'Share Alethical Finance',
      'Sources and updates',
      'Minnesota Campaign Finance and Public Disclosure Board',
      'KSTP-TV, KARE and KMSP-TV, from the FCC’s public files',
    ]) {
      expect(text).toContain(words);
    }
    expect(text).not.toContain('Printed names not yet confirmed');
    expect(text).not.toContain('alethicalfinance.com');
    expect(document.title).toBe('Alethical Finance');
  });

  it('opens investor access only from the hero and keeps ordinary sign-in separate', async () => {
    await renderAt('/', { data: SERVED }, 200, { screens: true });
    const investor = [...container.querySelectorAll('a')].filter(
      (a) => a.textContent === 'Investor access',
    );
    expect(investor).toHaveLength(1);
    expect(investor[0].getAttribute('href')).toBe('/investor-access');
    expect(investor[0].closest('.lp-hero-copy')).not.toBeNull();
    expect(container.textContent).not.toContain('Request access');
    expect(container.querySelector('.lp-close')).toBeNull();
    const signIns = [...container.querySelectorAll('a')].filter((a) => a.textContent === 'Sign in');
    expect(signIns.length).toBeGreaterThan(0);
    for (const link of signIns) expect(link.getAttribute('href')).toBe('/sign-in');
    await act(async () => investor[0].click());
    expect(window.location.pathname).toBe('/investor-access');
    expect(container.querySelector('h1')).toBeNull();
    expect(container.querySelector('label')?.textContent).toBe('Investor access code');
    const home = container.querySelector<HTMLAnchorElement>(
      'a[aria-label="Alethical Finance home"]',
    );
    expect(home?.getAttribute('href')).toBe('/');
    expect(document.activeElement).toBe(container.querySelector('main'));
    expect(container.querySelector('#password')?.getAttribute('type')).toBe('text');
    expect(container.querySelector('input[type="email"]')).toBeNull();
    expect(container.textContent).not.toContain('Sign in with email');
    await act(async () => home!.click());
    expect(window.location.pathname).toBe('/');
  });

  it('reads the counts live and hides one the server could not read', async () => {
    const fetcher = await renderAt('/');
    expect(fetcher).toHaveBeenCalledWith(`${API}/api/v1/finance/landing/counts`);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const text = container.textContent ?? '';
    expect(text).toContain('1,084,277');
    expect(text).toContain('From 3,184 organizations, 2014 to 2025');
    expect(text).toContain('2025–2026 Legislature');
    expect(text).not.toContain('TV station files on political ad time');
    expect(text).toContain('Payment files copied Sep 1, 2026');
    expect(text).toContain('Bills updated Jul 14, 2026');
    // The station source stays named; only its unsupported date is left out.
    expect(text).toContain('Media buys · TV station files');
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

  it('focuses nothing on arrival, though the sign-in state settles after the first draw', async () => {
    await renderAt('/');
    expect(container.querySelector('.lp')).not.toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it('moves focus to the new heading after Sign in is followed', async () => {
    await renderAt('/');
    const signIn = container.querySelector<HTMLAnchorElement>('.lp-top a[href="/sign-in"]')!;
    await act(async () => {
      signIn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    });
    expect(window.location.pathname).toBe('/sign-in');
    expect(document.activeElement?.tagName).toBe('H1');
  });

  it.each(['/sign-in', '/auth/return'])('answers %s, not with not-found', async (path) => {
    await renderAt(path);
    expect(container.textContent).not.toContain('We couldn’t find that page');
    expect(container.querySelector('main h1')).not.toBeNull();
  });

  it('offers Try again on sign-in when a signed-in account’s access cannot be checked', async () => {
    await renderAt('/sign-in', undefined, 200, {
      session: { access_token: 't', user: { email: 'reader@example.test' } },
      accessStatus: 503,
    });
    expect(container.textContent).toContain('We couldn’t check your access');
    expect(container.textContent).toContain('Try again');
  });

  it('tells a signed-in account that is not on the list, at the landing address', async () => {
    await renderAt('/', undefined, 200, {
      session: { access_token: 't', user: { email: 'reader@example.test' } },
      accessStatus: 403,
    });
    expect(container.textContent).toContain('This account doesn’t have access');
  });

  it('serves the full app only when the screens are approved', async () => {
    await renderAt('/money', undefined, 200, { screens: true });
    expect(window.location.pathname).toBe('/sign-in');
    expect(container.textContent).not.toContain('We couldn’t find that page');
  });

  it('keeps the screens off unless the setting is on', () => {
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
      lobbying_spending_reports: {
        ...SERVED.lobbying_spending_reports!,
        count: -1,
      },
      current_legislature_bills: {
        ...SERVED.current_legislature_bills!,
        count: null,
      },
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
  it('names the supported paths for phone readers and assistive technology', async () => {
    await renderAt('/');
    const diagram = container.querySelector('figure[aria-label="Records connected"]')!;
    const paths = [...diagram.querySelectorAll('.lp-named-paths > li')].map((row) => ({
      sources: row.querySelector('.lp-path-source')!.textContent!.replace(/:$/, '').split(', '),
      targets: [...row.querySelectorAll('.lp-path-targets > li')].map(
        (target) => target.textContent,
      ),
    }));
    const targetsOf = (source: string) =>
      paths.find(({ sources }) => sources.includes(source))!.targets;
    expect(
      paths.reduce((sum, { sources, targets }) => sum + sources.length * targets.length, 0),
    ).toBe(57);
    expect(targetsOf('Contributions')).toEqual([
      'Campaign committees',
      'Committees and Funds',
      'Party Units',
    ]);
    expect(targetsOf('Outside spending')).toEqual([
      'Supports Candidates',
      'Opposes Candidates',
      'Races and results',
    ]);
    expect(paths).toContainEqual({
      sources: [
        'Campaign committees',
        'Committees and Funds',
        'Party Units',
        'Media agencies',
        'Buyers and signers',
      ],
      targets: ['TV ad buys'],
    });
    expect(paths).toContainEqual({
      sources: ['People', 'Organizations'],
      targets: ['Testimony', 'Documented involvement Bills', 'Issues and regulatory activity'],
    });
  });
});
